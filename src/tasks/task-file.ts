import { stringify } from "yaml";

import { loadYamlConfig } from "../config/load-yaml-config.js";
import { writeFileAtomic } from "../harness/atomic-write.js";
import { HarnessError } from "../harness/harness-error.js";
import {
  HARNESS_DIRECTORY,
  HARNESS_PATHS,
  harnessPath,
} from "../harness/layout.js";
import { readTextFileIfPresent } from "../harness/read-text-file.js";
import { TASK_FILE_VERSION, taskFileSchema } from "./task-schema.js";
import type { Task, TaskFile } from "./task-schema.js";

const TASK_FILE_MODE = 0o644;

/**
 * Written above the document so that the first person to open the file knows
 * it is generated. It is a YAML comment, so reading the file back ignores it
 * and the round trip stays exact.
 */
const BANNER = `# Managed by Agentic Harness. Written by the workflow after every
# transition; edit a task through the harness rather than by hand.
`;

/** How the file is named in diagnostics. Never an absolute machine path. */
export const TASK_FILE_SOURCE = `${HARNESS_DIRECTORY}/${HARNESS_PATHS.tasks}`;

/**
 * Task state sits beside the rules rather than under `state/`.
 *
 * `state/` is gitignored because it holds transcripts and locks. Task state is
 * the opposite: the shipped `.gitignore` deliberately leaves `tasks.yaml`
 * tracked, so what the workflow decided is reviewable in a pull request.
 */
export const taskFilePath = (projectRoot: string): string =>
  harnessPath(projectRoot, HARNESS_PATHS.tasks);

/**
 * A project with no task state yet.
 *
 * A function rather than a shared constant: every caller mutates the file it
 * is given while building the next revision, and one frozen-by-convention
 * object handed to all of them is the shared mutable state this milestone
 * exists to avoid.
 */
export const emptyTaskFile = (): TaskFile => ({
  version: TASK_FILE_VERSION,
  tasks: [],
});

/**
 * Reads the task file, treating "absent" as "no tasks yet".
 *
 * `tasks.yaml` is not installed by `harness init` — it is neither a managed
 * file the harness reconciles nor a seeded one the project owns, so it never
 * goes through the installation plan. The first transition creates it.
 */
export const readTaskFile = (projectRoot: string): TaskFile => {
  const text = readTextFileIfPresent(taskFilePath(projectRoot));

  if (text === null) {
    return emptyTaskFile();
  }

  return loadYamlConfig(text, taskFileSchema, { source: TASK_FILE_SOURCE });
};

/**
 * Replaces the task file with a validated rendering of `file`.
 *
 * The state is validated on the way out as well as on the way in. A workflow
 * that wrote a task file it could not read back would fail on the next run,
 * somewhere unrelated, with no record of which write produced it.
 */
export const writeTaskFile = (projectRoot: string, file: TaskFile): void => {
  const result = taskFileSchema.safeParse(file);

  if (!result.success) {
    throw new HarnessError(
      "invalid-config",
      `refusing to write ${TASK_FILE_SOURCE}: the task state is not valid`,
      result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`
      )
    );
  }

  writeFileAtomic(
    taskFilePath(projectRoot),
    // `lineWidth: 0` disables folding: a wrapped title reads as several lines
    // in a diff, so a one-word change would show as a whole paragraph moving.
    `${BANNER}${stringify(result.data, { lineWidth: 0 })}`,
    TASK_FILE_MODE
  );
};

export const findTask = (file: TaskFile, id: string): Task | null =>
  file.tasks.find((task) => task.id === id) ?? null;

/** The same lookup for callers that have no sensible answer without it. */
export const requireTask = (file: TaskFile, id: string): Task => {
  const task = findTask(file, id);

  if (task === null) {
    throw new HarnessError(
      "unknown-task",
      `${TASK_FILE_SOURCE} has no task \`${id}\``,
      file.tasks.length === 0
        ? ["it declares no tasks at all"]
        : [`it declares: ${file.tasks.map((entry) => entry.id).join(", ")}`]
    );
  }

  return task;
};
