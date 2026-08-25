import fs from 'node:fs';
import path from 'node:path';

import { loadAgent } from '../../core/agents/load';
import { EXIT } from '../../core/errors';
import type { GateOutcome } from '../../core/gates';
import { applyHandoff, nextUp } from '../../core/handoff';
import { taskStateDir } from '../../core/paths';
import { readTasksFile } from '../../core/tasks/store';
import { note, out, session, usage } from '../util';
import { collectGates, printGates } from './gate';

export interface HandoffOptions {
  task: string;
  agent: string;
  summary?: string;
  checklist?: string[];
  reject?: string;
  base?: string;
  skipGates?: boolean;
}

function parseChecklist(entries: string[] = []): Record<string, boolean> {
  const checklist: Record<string, boolean> = {};
  for (const entry of entries) {
    const [id, value] = entry.split('=', 2);
    if (id === undefined || id === '') usage(`bad --checklist entry "${entry}"`, 'use id=true or id=false');
    checklist[id] = value !== 'false' && value !== '0';
  }
  return checklist;
}

/** Falls back to the agent's own output.md so a summary is never lost. */
function resolveSummary(stateDir: string, given: string | undefined): string {
  if (given !== undefined && given.trim() !== '') return given.trim();
  try {
    return fs.readFileSync(path.join(stateDir, 'output.md'), 'utf8').trim();
  } catch {
    return '(no summary provided)';
  }
}

export function handoff(options: HandoffOptions): void {
  const { paths, config } = session();
  const agent = loadAgent(paths, options.agent);
  const stateDir = taskStateDir(paths, options.task, agent.name);

  const gates: GateOutcome[] =
    options.skipGates === true
      ? []
      : collectGates({
          task: options.task,
          agent: options.agent,
          ...(options.base === undefined ? {} : { base: options.base }),
        });
  printGates(gates);

  const result = applyHandoff({
    paths,
    config,
    agent,
    taskId: options.task,
    summary: resolveSummary(stateDir, options.summary),
    checklist: parseChecklist(options.checklist),
    gates,
    ...(options.reject === undefined ? {} : { reject: options.reject }),
  });

  if (result.blocked) {
    note('');
    note(`${options.task} is blocked -- fix the failing gate(s) and hand off again.`);
    process.exitCode = EXIT.GATE_FAILED;
    return;
  }

  out(result.to === undefined ? `${options.task} done` : `${options.task} -> ${result.to} (${result.status})`);
}

export function next(options: { task?: string }): void {
  const { paths } = session();
  const file = readTasksFile(paths);

  if (options.task !== undefined) {
    const task = file.tasks.find((candidate) => candidate.id === options.task);
    if (task === undefined) usage(`no task ${options.task}`);
    // A finished or blocked task has nobody up: printing an owner here would
    // send the pipeline loop round again forever.
    out(task.status === 'done' || task.status === 'blocked' ? 'nothing to do' : `${task.id} ${task.owner}`);
    return;
  }

  const up = nextUp(file);
  if (up === undefined) {
    out('nothing to do');
    return;
  }
  out(`${up.task} ${up.agent}`);
}
