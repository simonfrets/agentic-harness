import { loadAgent } from '../../core/agents/load';
import { EXIT } from '../../core/errors';
import { gatesPassed, runGates, type GateOutcome } from '../../core/gates';
import { findTask, readTasksFile } from '../../core/tasks/store';
import { note, out, session } from '../util';

export interface GateOptions {
  task: string;
  agent: string;
  base?: string;
  json?: boolean;
}

export function collectGates(options: GateOptions): GateOutcome[] {
  const { paths, config, rules } = session();
  return runGates({
    paths,
    config,
    agent: loadAgent(paths, options.agent),
    task: findTask(readTasksFile(paths), options.task),
    rules,
    ...(options.base === undefined ? {} : { baseRef: options.base }),
  });
}

export function printGates(outcomes: GateOutcome[]): void {
  for (const outcome of outcomes) {
    const line = `${outcome.result.padEnd(5)} ${outcome.id}`;
    if (outcome.result === 'fail') note(`${line}\n        ${outcome.detail ?? ''}`);
    else note(outcome.detail === undefined ? line : `${line}  (${outcome.detail})`);
  }
}

/** Exits 10 when any gate fails, so a shell pipeline can branch on it. */
export function gate(options: GateOptions): void {
  const outcomes = collectGates(options);

  if (options.json === true) out(JSON.stringify(outcomes, null, 2));
  else printGates(outcomes);

  if (!gatesPassed(outcomes)) process.exitCode = EXIT.GATE_FAILED;
}
