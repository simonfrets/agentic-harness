import { readFileSync } from "node:fs";
import { join } from "node:path";

import { stringify } from "yaml";

import { HarnessError } from "../../../src/harness/harness-error.js";
import {
  TASK_FILE_SOURCE,
  emptyTaskFile,
  findTask,
  readTaskFile,
  requireTask,
  taskFilePath,
  writeTaskFile,
} from "../../../src/tasks/task-file.js";
import { captureError } from "../../helpers/expect-error.js";
import { buildHarnessProject } from "../../helpers/harness-project.js";
import { buildTask, buildTaskFile } from "../../helpers/tasks.js";
import { removeTempDirectories } from "../../helpers/temp-directory.js";

afterEach(() => {
  removeTempDirectories();
});

describe("taskFilePath", () => {
  it("puts task state inside the harness directory, not under state/", () => {
    // `state/` is gitignored. Task state is deliberately reviewable, so it
    // lives beside the rules rather than with the transcripts.
    expect(taskFilePath("/tmp/project")).toBe(
      join("/tmp/project", ".harness", "tasks.yaml")
    );
    expect(TASK_FILE_SOURCE).toBe(".harness/tasks.yaml");
  });
});

describe("readTaskFile", () => {
  it("reads a project that has never run a task as having none", () => {
    expect(readTaskFile(buildHarnessProject())).toEqual({
      version: 1,
      tasks: [],
    });
  });

  it("never hands two callers the same tasks array", () => {
    const root = buildHarnessProject();
    const first = readTaskFile(root);

    first.tasks.push(buildTask());

    expect(readTaskFile(root).tasks).toEqual([]);
  });

  it("round-trips a task file through the filesystem", () => {
    const root = buildHarnessProject();
    const file = buildTaskFile(
      buildTask({
        state: "implementing",
        revision: 4,
        agentId: "coder",
        approvedAt: "2026-08-27T00:02:00.000Z",
        approvedBy: "a-reviewer",
        contextPath: ".harness/state/runs/run-1/agents/coder",
      })
    );

    writeTaskFile(root, file);

    expect(readTaskFile(root)).toEqual(file);
  });

  it("reports the file and the line when the yaml is broken", () => {
    const root = buildHarnessProject({
      files: { ".harness/tasks.yaml": "version: 1\ntasks:\n  - id: [\n" },
    });
    const error = captureError(() => readTaskFile(root), HarnessError);

    expect(error.kind).toBe("invalid-config");
    expect(error.message).toContain(".harness/tasks.yaml");
  });

  it("refuses a task interrupted in a state no work happens in", () => {
    // `tasks.yaml` is committed on purpose, so a hand edit or a merge conflict
    // is all it takes to write this. Recovery is computed as the stages up to
    // and including the one named here, so `completed` would open the entire
    // pipeline and let a task reach done without entering `implementing` or
    // `qa`.
    const root = buildHarnessProject({
      files: {
        ".harness/tasks.yaml": stringify({
          version: 1,
          tasks: [
            buildTask({
              state: "blocked",
              interruptedFrom: "completed" as "qa",
            }),
          ],
        }),
      },
    });
    const error = captureError(() => readTaskFile(root), HarnessError);

    expect(error.kind).toBe("invalid-config");
    expect(error.details.join("\n")).toContain("interruptedFrom");
  });

  it("refuses task state that does not validate", () => {
    const root = buildHarnessProject({
      files: {
        ".harness/tasks.yaml": "version: 1\ntasks:\n  - id: add-login\n",
      },
    });
    const error = captureError(() => readTaskFile(root), HarnessError);

    expect(error.kind).toBe("invalid-config");
    expect(error.details.join("\n")).toContain("title");
  });
});

describe("writeTaskFile", () => {
  it("writes yaml a person can read in a pull request", () => {
    const root = buildHarnessProject();

    writeTaskFile(root, buildTaskFile(buildTask()));

    const text = readFileSync(join(root, ".harness", "tasks.yaml"), "utf8");

    expect(text).toContain("# Managed by Agentic Harness");
    expect(text).toContain("version: 1");
    expect(text).toContain("  - id: add-login");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("creates the harness directory when nothing has been installed yet", () => {
    const root = buildHarnessProject();

    writeTaskFile(root, emptyTaskFile());

    expect(
      readFileSync(join(root, ".harness", "tasks.yaml"), "utf8")
    ).toContain("tasks: []");
  });

  it("refuses to write state that could not be read back", () => {
    const root = buildHarnessProject();
    const error = captureError(() => {
      writeTaskFile(root, buildTaskFile(buildTask(), buildTask()));
    }, HarnessError);

    expect(error.kind).toBe("invalid-config");
    expect(error.message).toContain(".harness/tasks.yaml");
    expect(error.details.join("\n")).toContain("more than once");
  });

  it("does not fold a long title into a shape the diff cannot show", () => {
    const root = buildHarnessProject();
    const title = `Rework ${"the authentication flow ".repeat(6)}end to end`;

    writeTaskFile(root, buildTaskFile(buildTask({ title })));

    const text = readFileSync(join(root, ".harness", "tasks.yaml"), "utf8");

    expect(text).toContain(`title: ${title}`);
    expect(readTaskFile(root).tasks[0]?.title).toBe(title);
  });
});

describe("findTask", () => {
  it("returns null for a task the file does not carry", () => {
    expect(findTask(buildTaskFile(buildTask()), "other")).toBeNull();
  });

  it("returns the task with the requested id", () => {
    const task = buildTask({ id: "other" });

    expect(findTask(buildTaskFile(buildTask(), task), "other")).toEqual(task);
  });
});

describe("requireTask", () => {
  it("names the task and what the file does hold", () => {
    const error = captureError(
      () => requireTask(buildTaskFile(buildTask()), "other"),
      HarnessError
    );

    expect(error.kind).toBe("unknown-task");
    expect(error.message).toContain("other");
    expect(error.details.join("\n")).toContain("add-login");
  });
});
