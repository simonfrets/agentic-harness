import { HarnessError } from "../../../src/harness/harness-error.js";
import { readTaskFile, requireTask } from "../../../src/tasks/task-file.js";
import type { Task } from "../../../src/tasks/task-schema.js";
import {
  approveSpecification,
  createTask,
  transitionTask,
} from "../../../src/tasks/transition-task.js";
import { updateTaskFile } from "../../../src/tasks/update-task-file.js";
import { completedStages, pendingStages } from "../../../src/tasks/workflow.js";
import { captureRejection } from "../../helpers/expect-error.js";
import { buildHarnessProject } from "../../helpers/harness-project.js";
import { RULE_SET_SHA256 } from "../../helpers/tasks.js";
import { removeTempDirectories } from "../../helpers/temp-directory.js";

afterEach(() => {
  removeTempDirectories();
});

const AT = new Date("2026-08-27T10:00:00.000Z");

const only = (root: string): Task =>
  requireTask(readTaskFile(root), "add-login");

const HANDOFFS = [
  ["specified", "specifier"],
  ["awaiting_approval", null],
  ["implementing", "coder"],
  ["cleaning", "cleaner"],
  ["architecture_review", "architect"],
  ["hardening", "hardener"],
  ["qa", "qa"],
  ["completed", null],
] as const;

/** Drives the whole pipeline through the file on disk, one write per stage. */
const runPipeline = async (root: string): Promise<void> => {
  await updateTaskFile(root, (file) =>
    createTask(file, {
      id: "add-login",
      title: "Add login",
      runId: "run-1",
      at: AT,
    })
  );

  for (const [to, toAgent] of HANDOFFS) {
    await updateTaskFile(root, (file) => {
      const task = file.tasks[0];

      if (task === undefined) {
        throw new Error("the task disappeared between writes");
      }

      if (to === "implementing") {
        return transitionTask(
          approveSpecification(file, {
            taskId: task.id,
            expectedRevision: task.revision,
            approvedBy: "a-reviewer",
            ruleSetSha256: RULE_SET_SHA256,
            at: AT,
          }),
          {
            taskId: task.id,
            expectedRevision: task.revision + 1,
            to,
            toAgent,
            ruleSetSha256: RULE_SET_SHA256,
            at: AT,
          }
        );
      }

      return transitionTask(file, {
        taskId: task.id,
        expectedRevision: task.revision,
        to,
        toAgent,
        ruleSetSha256: RULE_SET_SHA256,
        at: AT,
      });
    });
  }
};

describe("a task driven through the file on disk", () => {
  it("reaches completed with every revision recorded once, in order", async () => {
    const root = buildHarnessProject();

    await runPipeline(root);

    const task = only(root);

    expect(task.state).toBe("completed");
    // One transition per handoff, plus the approval, which takes its own.
    expect(task.history).toHaveLength(HANDOFFS.length + 1);
    expect(task.revision).toBe(HANDOFFS.length + 2);
    expect(task.history.map((record) => record.revision)).toEqual(
      task.history.map((_, index) => index + 2)
    );
    expect(pendingStages(task)).toEqual([]);
    expect(completedStages(task)).toHaveLength(9);
  });

  it("rejects a second writer working from the revision it read first", async () => {
    const root = buildHarnessProject();

    await updateTaskFile(root, (file) =>
      createTask(file, {
        id: "add-login",
        title: "Add login",
        runId: "run-1",
        at: AT,
      })
    );

    // Both agents read revision 1. The first handoff lands; the second was
    // decided against state that no longer exists and must not overwrite it.
    const stale = only(root).revision;

    await updateTaskFile(root, (file) =>
      transitionTask(file, {
        taskId: "add-login",
        expectedRevision: stale,
        to: "specified",
        toAgent: "specifier",
        ruleSetSha256: RULE_SET_SHA256,
        at: AT,
      })
    );

    const error = await captureRejection(
      () =>
        updateTaskFile(root, (file) =>
          transitionTask(file, {
            taskId: "add-login",
            expectedRevision: stale,
            to: "specified",
            toAgent: "specifier",
            ruleSetSha256: RULE_SET_SHA256,
            at: AT,
          })
        ),
      HarnessError
    );

    expect(error.kind).toBe("stale-task-revision");
    expect(only(root).history).toHaveLength(1);
  });
});
