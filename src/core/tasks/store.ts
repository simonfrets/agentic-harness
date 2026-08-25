import fs from 'node:fs';
import path from 'node:path';

import YAML from 'yaml';

import { HarnessError } from '../errors';
import type { HarnessPaths } from '../paths';
import { describeZodError, parseYaml } from '../yaml';
import { withLock, type LockOptions } from './lock';
import { tasksFileSchema, type Task, type TasksFile } from './schema';

const TASK_ID_PATTERN = /^T-(\d+)$/;

/**
 * Note the absence of `camelizeKeys`: handoff checklists are keyed by
 * user-defined ids like `spec_accepted`, and rewriting those would silently
 * rename an agent's declared checklist.
 */
export function parseTasks(text: string, source: string): TasksFile {
  const raw = parseYaml(text, source, 'SCHEMA_INVALID');
  const parsed = tasksFileSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new HarnessError('SCHEMA_INVALID', `${source} failed validation`, describeZodError(parsed.error));
  }
  return parsed.data;
}

export function readTasksFile(paths: HarnessPaths): TasksFile {
  let text: string;
  try {
    text = fs.readFileSync(paths.tasks, 'utf8');
  } catch {
    throw new HarnessError(
      'NO_TASKS_FILE',
      `no tasks file at ${paths.tasks}`,
      'run `harness init` or `harness task add "<title>"`',
    );
  }
  return parseTasks(text, paths.tasks);
}

/**
 * Drop anything that carries no information -- undefined, null and empty
 * containers. Schema defaults restore them on read, so tasks.yaml stays a file
 * a human can read in a diff rather than a wall of `[]` and `{}`.
 */
function prune(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(prune).filter((item) => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const pruned = prune(item);
      if (pruned !== undefined) out[key] = pruned;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return value === null ? undefined : value;
}

export function serializeTasks(file: TasksFile): string {
  // `tasks` is the point of the file: keep the key even when it is empty.
  const body = (prune(file) as Record<string, unknown> | undefined) ?? {};
  body['tasks'] ??= [];
  return YAML.stringify(body, { lineWidth: 0 });
}

/** Write via temp file + rename so a crash can never leave a half-written tasks.yaml. */
export function writeTasksFile(paths: HarnessPaths, file: TasksFile): void {
  fs.mkdirSync(path.dirname(paths.tasks), { recursive: true });
  const tmp = path.join(path.dirname(paths.tasks), `.tasks.yaml.tmp-${process.pid}`);
  try {
    fs.writeFileSync(tmp, serializeTasks(file));
    fs.renameSync(tmp, paths.tasks);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function tasksLockDir(paths: HarnessPaths): string {
  return path.join(paths.locks, 'tasks.lock');
}

/**
 * Read-modify-write under the lock. Every mutation of tasks.yaml goes through
 * here, which is what lets two agents run concurrently without clobbering
 * each other's rows.
 */
export function updateTasksFile(
  paths: HarnessPaths,
  mutator: (file: TasksFile) => void,
  options: LockOptions = {},
): TasksFile {
  return withLock(
    tasksLockDir(paths),
    () => {
      const file = readTasksFile(paths);
      mutator(file);
      const stamped = new Date().toISOString();
      for (const task of file.tasks) task.updatedAt ??= stamped;
      writeTasksFile(paths, file);
      return file;
    },
    options,
  );
}

export function findTask(file: TasksFile, id: string): Task {
  const task = file.tasks.find((candidate) => candidate.id === id);
  if (task === undefined) {
    const known = file.tasks.map((t) => t.id).join(', ') || '<none>';
    throw new HarnessError('TASK_NOT_FOUND', `no task ${id}`, `known tasks: ${known}`);
  }
  return task;
}

/** Highest id + 1 -- not the task count, which would collide after a deletion. */
export function nextTaskId(file: TasksFile): string {
  const highest = file.tasks.reduce((max, task) => {
    const match = TASK_ID_PATTERN.exec(task.id);
    return match?.[1] ? Math.max(max, Number.parseInt(match[1], 10)) : max;
  }, 0);
  return `T-${String(highest + 1).padStart(3, '0')}`;
}

export function createTask(file: TasksFile, input: { title: string; intent?: string }): Task {
  const now = new Date().toISOString();
  const task: Task = {
    id: nextTaskId(file),
    title: input.title,
    intent: input.intent ?? '',
    status: 'draft',
    owner: file.pipeline[0] ?? 'specifier',
    artifacts: [],
    gates: {},
    handoffs: [],
    notes: [],
    createdAt: now,
    updatedAt: now,
  };
  file.tasks.push(task);
  return task;
}
