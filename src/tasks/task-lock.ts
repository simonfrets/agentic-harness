import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { lock } from "proper-lockfile";

import { HarnessError, describeFailure } from "../harness/harness-error.js";
import { TASK_FILE_SOURCE, taskFilePath } from "./task-file.js";

export interface TaskLockOptions {
  /**
   * How long a lock left behind by a dead process stays honoured.
   *
   * `proper-lockfile` raises anything below two seconds to two seconds, so a
   * smaller value here is a request rather than a setting.
   */
  readonly staleMs: number;
  /** How many times to wait for a lock another process is holding. */
  readonly retries: number;
}

/**
 * Ten retries with the backoff below wait roughly three seconds in total,
 * which covers one gate run finishing its own transition. Waiting longer would
 * mean a git hook hanging on a workflow that is not coming back; waiting less
 * would fail on ordinary contention.
 */
export const TASK_LOCK_DEFAULTS: TaskLockOptions = {
  staleMs: 10_000,
  retries: 10,
};

const MIN_RETRY_MS = 25;
const RETRY_FACTOR = 1.5;

/**
 * Runs something while holding an exclusive lock on the task file.
 *
 * `proper-lockfile` is used rather than a lock written here: it already
 * implements the parts that are easy to get wrong — a directory `mkdir` as the
 * atomic primitive, an mtime heartbeat so a lock held by a process that died
 * expires, and a compromise callback for the case where the heartbeat itself
 * fails. The design says to prefer a reviewed library over a partial protocol,
 * and this is the protocol it meant.
 *
 * A lock is needed at all because two harness processes genuinely overlap: a
 * git hook runs `harness gate pre-commit` while an agent runtime is recording
 * the transition that produced the commit. Both do read-modify-write on one
 * file, so without a lock the later writer silently discards the earlier one's
 * revision.
 *
 * The default `onCompromised` throws from inside a timer callback, which is an
 * uncaught exception and takes the process down. It is replaced with one that
 * records the failure, so the caller's work finishes and then the loss of the
 * lock is reported as an error it can act on.
 */
export const withTaskLock = async <T>(
  projectRoot: string,
  run: () => T | Promise<T>,
  options: TaskLockOptions = TASK_LOCK_DEFAULTS
): Promise<T> => {
  const path = taskFilePath(projectRoot);

  // `tasks.yaml` is not installed, so on the first transition neither it nor
  // the directory holding it exists yet, and the lock has nowhere to live.
  mkdirSync(dirname(path), { recursive: true });

  const compromises: Error[] = [];
  let release: () => Promise<void>;

  try {
    release = await lock(path, {
      // The file legitimately does not exist before the first write, and
      // `realpath` would refuse to lock a path it cannot resolve.
      realpath: false,
      stale: options.staleMs,
      retries: {
        retries: options.retries,
        factor: RETRY_FACTOR,
        minTimeout: MIN_RETRY_MS,
        maxTimeout: options.staleMs,
      },
      onCompromised: (error: Error) => {
        compromises.push(error);
      },
    });
  } catch (error: unknown) {
    throw new HarnessError(
      "task-lock-failed",
      `another process is holding the lock on ${TASK_FILE_SOURCE}`,
      [describeFailure(error)]
    );
  }

  let outcome: T;

  try {
    outcome = await run();
  } finally {
    await release().catch((error: unknown) => {
      // Releasing a lock that was already compromised fails for the reason
      // that is about to be reported, and releasing one that is simply gone
      // leaves nothing behind that `stale` will not clear. Neither is worth
      // replacing whatever the caller was already throwing.
      compromises.push(new Error(describeFailure(error)));
    });
  }

  const [compromised] = compromises;

  if (compromised !== undefined) {
    throw new HarnessError(
      "task-lock-failed",
      `the lock on ${TASK_FILE_SOURCE} was lost while the harness held it, so the write cannot be trusted`,
      [compromised.message]
    );
  }

  return outcome;
};
