import fs from 'node:fs';
import path from 'node:path';

import { HarnessError } from './errors';

export const HARNESS_DIR = '.harness';

/**
 * Every location the harness owns, derived from the project root. Resolving
 * these in one place is what keeps `.harness/` self-contained and lets the
 * shell layer receive absolute paths it never has to compute.
 */
export interface HarnessPaths {
  /** The project root -- the directory that contains `.harness/`. */
  root: string;
  dir: string;
  config: string;
  tasks: string;
  agents: string;
  prompts: string;
  rules: string;
  ruleChecks: string;
  specs: string;
  qa: string;
  state: string;
  events: string;
  locks: string;
  logs: string;
  metrics: string;
  bin: string;
}

export function harnessPaths(root: string): HarnessPaths {
  const dir = path.join(root, HARNESS_DIR);
  return {
    root,
    dir,
    config: path.join(dir, 'harness.config.yaml'),
    tasks: path.join(dir, 'tasks.yaml'),
    agents: path.join(dir, 'agents'),
    prompts: path.join(dir, 'prompts'),
    rules: path.join(dir, 'rules'),
    ruleChecks: path.join(dir, 'rules', 'checks'),
    specs: path.join(dir, 'specs'),
    qa: path.join(dir, 'qa'),
    state: path.join(dir, 'state'),
    events: path.join(dir, 'events'),
    locks: path.join(dir, 'locks'),
    logs: path.join(dir, 'logs'),
    metrics: path.join(dir, 'metrics'),
    bin: path.join(dir, 'bin'),
  };
}

/**
 * Walk upward for the nearest `.harness` directory, the way git finds `.git`.
 * Nearest wins, so a package inside a monorepo can run its own harness.
 */
export function findHarnessRoot(startDir: string): string | null {
  let current = path.resolve(startDir);

  for (;;) {
    const candidate = path.join(current, HARNESS_DIR);
    try {
      if (fs.statSync(candidate).isDirectory()) return current;
    } catch {
      // Not here; keep climbing.
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function requireHarnessRoot(startDir: string): string {
  const root = findHarnessRoot(startDir);
  if (root === null) {
    throw new HarnessError(
      'NO_HARNESS',
      `no ${HARNESS_DIR}/ found in ${startDir} or any parent`,
      'run `npx agentic-harness init` in your project root',
    );
  }
  return root;
}

/** Each agent gets its own directory per task -- the unit of context isolation. */
export function taskStateDir(paths: HarnessPaths, taskId: string, agent: string): string {
  return path.join(paths.state, taskId, agent);
}

export function taskEventLog(paths: HarnessPaths, taskId: string): string {
  return path.join(paths.events, `${taskId}.jsonl`);
}
