import fs from 'node:fs';

import { appendEvent, readEvents } from '../../core/tasks/events';
import type { TaskStatus } from '../../core/tasks/schema';
import { taskStatusSchema } from '../../core/tasks/schema';
import { createTask, findTask, readTasksFile, updateTasksFile, writeTasksFile } from '../../core/tasks/store';
import { out, session, usage } from '../util';

export function taskAdd(title: string, options: { intent?: string }): void {
  const { paths } = session();

  // A first task can predate tasks.yaml; seed it rather than failing.
  if (!fs.existsSync(paths.tasks)) {
    writeTasksFile(paths, { version: 1, pipeline: [], tasks: [] });
  }

  let id = '';
  updateTasksFile(paths, (file) => {
    const task = createTask(file, { title, ...(options.intent === undefined ? {} : { intent: options.intent }) });
    id = task.id;
  });

  appendEvent(paths, id, { type: 'task.created', title });
  out(id);
}

export function taskList(options: { all?: boolean }): void {
  const { paths } = session();
  const file = readTasksFile(paths);
  const tasks = options.all === true ? file.tasks : file.tasks.filter((t) => t.status !== 'done');

  if (tasks.length === 0) {
    out(options.all === true ? 'no tasks' : 'no open tasks (use --all)');
    return;
  }
  for (const task of tasks) {
    out(`${task.id}  ${task.status.padEnd(20)} ${task.owner.padEnd(10)} ${task.title}`);
  }
}

export function taskShow(id: string): void {
  const { paths } = session();
  const task = findTask(readTasksFile(paths), id);

  out(`${task.id}  ${task.title}`);
  out(`  status   ${task.status}`);
  out(`  owner    ${task.owner}`);
  if (task.branch !== undefined) out(`  branch   ${task.branch}`);
  if (task.spec !== undefined) out(`  spec     ${task.spec}`);
  if (task.intent !== '') out(`  intent   ${task.intent}`);

  const gates = Object.entries(task.gates);
  if (gates.length > 0) {
    out('  gates');
    for (const [gate, result] of gates) out(`    ${result.padEnd(5)} ${gate}`);
  }

  if (task.handoffs.length > 0) {
    out('  handoffs');
    for (const handoff of task.handoffs) {
      const reason = handoff.reason === undefined ? '' : `  (sent back: ${handoff.reason})`;
      out(`    ${handoff.from} -> ${handoff.to}  ${handoff.summary}${reason}`);
    }
  }

  const events = readEvents(paths, id);
  if (events.length > 0) out(`  ${events.length} event(s) in .harness/events/${id}.jsonl`);
}

export function taskSet(
  id: string,
  options: { status?: string; owner?: string; branch?: string; spec?: string; artifact?: string[] },
): void {
  const { paths } = session();

  let status: TaskStatus | undefined;
  if (options.status !== undefined) {
    const parsed = taskStatusSchema.safeParse(options.status);
    if (!parsed.success) usage(`unknown status "${options.status}"`, taskStatusSchema.options.join(', '));
    status = parsed.data;
  }

  updateTasksFile(paths, (file) => {
    const task = findTask(file, id);
    if (status !== undefined) task.status = status;
    if (options.owner !== undefined) task.owner = options.owner;
    if (options.branch !== undefined) task.branch = options.branch;
    if (options.spec !== undefined) task.spec = options.spec;
    for (const artifact of options.artifact ?? []) {
      if (!task.artifacts.includes(artifact)) task.artifacts.push(artifact);
    }
    task.updatedAt = new Date().toISOString();
  });

  appendEvent(paths, id, { type: 'task.updated', ...options });
  out(`${id} updated`);
}
