import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { lock } from "proper-lockfile";

import { HarnessError } from "../../../src/harness/harness-error.js";
import { readTaskFile, taskFilePath } from "../../../src/tasks/task-file.js";
import { withTaskLock } from "../../../src/tasks/task-lock.js";
import { updateTaskFile } from "../../../src/tasks/update-task-file.js";
import { captureRejection } from "../../helpers/expect-error.js";
import { buildHarnessProject } from "../../helpers/harness-project.js";
import { buildTask } from "../../helpers/tasks.js";
import { removeTempDirectories } from "../../helpers/temp-directory.js";

afterEach(() => {
  removeTempDirectories();
});

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const lockPath = (root: string): string =>
  join(root, ".harness", "tasks.yaml.lock");

/** Takes the same filesystem lock a second harness process would take. */
const holdTaskLock = async (root: string): Promise<() => Promise<void>> => {
  mkdirSync(join(root, ".harness"), { recursive: true });

  return lock(taskFilePath(root), { realpath: false, stale: 10_000 });
};

describe("withTaskLock", () => {
  it("takes the lock even though the harness directory does not exist yet", async () => {
    const root = buildHarnessProject();

    await expect(withTaskLock(root, () => "ran")).resolves.toBe("ran");
    expect(existsSync(lockPath(root))).toBe(false);
  });

  it("waits for a lock another process is holding", async () => {
    const root = buildHarnessProject();
    const releaseOther = await holdTaskLock(root);
    const order: string[] = [];
    const pending = withTaskLock(root, () => {
      order.push("harness ran");

      return "done";
    });

    await delay(150);
    order.push("other released");
    await releaseOther();

    await expect(pending).resolves.toBe("done");
    // Without mutual exclusion the harness would have run first, immediately.
    expect(order).toEqual(["other released", "harness ran"]);
  });

  it("reports a lock it cannot get rather than writing anyway", async () => {
    const root = buildHarnessProject();
    const releaseOther = await holdTaskLock(root);
    let ran = false;
    const error = await captureRejection(
      () =>
        withTaskLock(
          root,
          () => {
            ran = true;

            return "done";
          },
          { staleMs: 10_000, retries: 0 }
        ),
      HarnessError
    );

    expect(error.kind).toBe("task-lock-failed");
    expect(ran).toBe(false);
    await releaseOther();
  });

  it("releases the lock when the work throws", async () => {
    const root = buildHarnessProject();

    await expect(
      withTaskLock(root, () => {
        throw new Error("the transition was rejected");
      })
    ).rejects.toThrow("the transition was rejected");

    expect(existsSync(lockPath(root))).toBe(false);
    await expect(withTaskLock(root, () => "ran again")).resolves.toBe(
      "ran again"
    );
  });

  it("reports a lock lost while it was held instead of crashing the process", async () => {
    // The library's default `onCompromised` throws from a timer callback,
    // which is an uncaught exception. The heartbeat is driven from `stale`,
    // so the shortest honest version of this test waits for one interval.
    const root = buildHarnessProject();
    const error = await captureRejection(
      () =>
        withTaskLock(
          root,
          async () => {
            rmSync(lockPath(root), { force: true, recursive: true });
            await delay(1_800);

            return "done";
          },
          { staleMs: 2_000, retries: 0 }
        ),
      HarnessError
    );

    expect(error.kind).toBe("task-lock-failed");
    expect(error.message).toContain("was lost while the harness held it");
  });
});

describe("updateTaskFile", () => {
  it("writes what the mutator returned", async () => {
    const root = buildHarnessProject();

    await updateTaskFile(root, (file) => ({
      ...file,
      tasks: [...file.tasks, buildTask()],
    }));

    expect(readTaskFile(root).tasks).toHaveLength(1);
  });

  it("serialises overlapping updates instead of losing one", async () => {
    const root = buildHarnessProject();
    // The mutator yields between the read and the write, which is exactly what
    // a real one does when it writes the next agent's context. Without the
    // lock both would read an empty file and the second would overwrite the
    // first, leaving one task instead of two.
    const append = (id: string): Promise<unknown> =>
      updateTaskFile(root, async (file) => {
        await delay(20);

        return { ...file, tasks: [...file.tasks, buildTask({ id })] };
      });

    await Promise.all([append("first"), append("second")]);

    expect(
      readTaskFile(root)
        .tasks.map((task) => task.id)
        .sort()
    ).toEqual(["first", "second"]);
  });

  it("leaves the file untouched when the mutator rejects the change", async () => {
    const root = buildHarnessProject();

    await expect(
      updateTaskFile(root, () => {
        throw new HarnessError("stale-task-revision", "expected revision 4");
      })
    ).rejects.toThrow("expected revision 4");

    expect(existsSync(taskFilePath(root))).toBe(false);
  });
});
