import { readTaskFile, writeTaskFile } from "./task-file.js";
import { withTaskLock } from "./task-lock.js";
import type { TaskLockOptions } from "./task-lock.js";
import type { TaskFile } from "./task-schema.js";

/**
 * Reads the task file, applies a change, and writes it back under one lock.
 *
 * The read has to happen inside the lock. A caller that read the file first
 * and then asked for the write would be deciding the next revision from state
 * that another process may already have replaced, which is the race the
 * expected-revision check exists to catch and this exists to avoid.
 *
 * The mutator may be asynchronous so that work which belongs to the same
 * transition — writing the next agent's context, for one — happens while the
 * file is still held, rather than in a window where another process could
 * record a different transition against the same revision.
 */
export const updateTaskFile = async (
  projectRoot: string,
  mutate: (file: TaskFile) => TaskFile | Promise<TaskFile>,
  options?: TaskLockOptions
): Promise<TaskFile> =>
  withTaskLock(
    projectRoot,
    async () => {
      const updated = await mutate(readTaskFile(projectRoot));

      writeTaskFile(projectRoot, updated);

      return updated;
    },
    options
  );
