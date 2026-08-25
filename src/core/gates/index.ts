import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import picomatch from 'picomatch';

import type { AgentDefinition } from '../agents/schema';
import type { HarnessConfig } from '../config/schema';
import { loadConfig } from '../config/load';
import type { HarnessPaths } from '../paths';
import { taskStateDir } from '../paths';
import { blockingRulesFor } from '../rules/load';
import type { Rule } from '../rules/schema';
import type { GateResult, Task } from '../tasks/schema';

export interface GateOutcome {
  id: string;
  result: GateResult;
  detail?: string;
}

/**
 * The harness writes its own bookkeeping while an agent runs. Those paths are
 * never a scope violation, whatever the agent declared.
 */
const HARNESS_OWNED = [
  '.harness/state/**',
  '.harness/events/**',
  '.harness/logs/**',
  '.harness/metrics/**',
  '.harness/tasks.yaml',
];

function git(root: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function lines(text: string): string[] {
  return text.split('\n').filter((line) => line.trim() !== '');
}

/**
 * Everything an agent touched: tracked edits (staged or not) plus new files
 * git is not ignoring. Deletions count -- removing production code without
 * touching its tests is exactly what the TDD gate exists to catch.
 */
export function changedFiles(root: string, baseRef?: string): string[] {
  const tracked = baseRef === undefined
    ? git(root, ['diff', '--name-only', '--diff-filter=ACMRD', 'HEAD'])
    : git(root, ['diff', '--name-only', '--diff-filter=ACMRD', baseRef]);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard']);
  return [...new Set([...lines(tracked), ...lines(untracked)])];
}

function trackedFiles(root: string): Set<string> {
  return new Set(lines(git(root, ['ls-files'])));
}

function underPrefix(file: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => file === prefix || file.startsWith(`${prefix}/`));
}

export function isTestPath(file: string, config: HarnessConfig): boolean {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) return true;
  if (/(^|\/)[^/]*_test\.sh$/.test(file)) return true;
  return underPrefix(file, config.tdd.testPrefixes);
}

export function isSourcePath(file: string, config: HarnessConfig): boolean {
  return underPrefix(file, config.tdd.srcPrefixes) && !isTestPath(file, config);
}

function hashFile(absolute: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
  } catch {
    return null;
  }
}

// --- write scope -----------------------------------------------------------

function writeScopeGate(agent: AgentDefinition, changed: string[]): GateOutcome {
  if (agent.writeScope.length === 0) {
    return { id: 'write-scope', result: 'skip', detail: 'agent declares no write_scope' };
  }

  const allowed = picomatch([...agent.writeScope, ...HARNESS_OWNED], { dot: true });
  const escaped = changed.filter((file) => !allowed(file));
  if (escaped.length === 0) return { id: 'write-scope', result: 'pass' };

  return {
    id: 'write-scope',
    result: 'fail',
    detail: `outside ${agent.name}'s write_scope: ${escaped.join(', ')}`,
  };
}

// --- tdd pairing -----------------------------------------------------------

function tddPairGate(config: HarnessConfig, changed: string[]): GateOutcome {
  if (!config.gates.tdd) return { id: 'tdd-pair', result: 'skip', detail: 'gates.tdd is off' };

  const source = changed.filter((file) => isSourcePath(file, config));
  if (source.length === 0) return { id: 'tdd-pair', result: 'pass' };
  if (changed.some((file) => isTestPath(file, config))) return { id: 'tdd-pair', result: 'pass' };

  return {
    id: 'tdd-pair',
    result: 'fail',
    detail: `production code changed with no test changes: ${source.join(', ')}`,
  };
}

// --- red receipts ----------------------------------------------------------

export interface RedReceipt {
  test: string;
  at: string;
  status: 'red';
  failure: string;
  /** Hash of every production file at the moment the test was seen failing. */
  src: Record<string, string>;
}

function receiptFile(paths: HarnessPaths, taskId: string, agent: string): string {
  return path.join(taskStateDir(paths, taskId, agent), 'tdd.jsonl');
}

function readReceipts(paths: HarnessPaths, taskId: string, agent: string): RedReceipt[] {
  try {
    return lines(fs.readFileSync(receiptFile(paths, taskId, agent), 'utf8')).flatMap((line) => {
      try {
        return [JSON.parse(line) as RedReceipt];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function walk(dir: string, root: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, root, out);
    else out.push(path.relative(root, absolute));
  }
}

function snapshotSource(root: string, config: HarnessConfig): Record<string, string> {
  const files: string[] = [];
  for (const prefix of config.tdd.srcPrefixes) walk(path.join(root, prefix), root, files);

  const snapshot: Record<string, string> = {};
  for (const file of files) {
    if (isTestPath(file, config)) continue;
    const hash = hashFile(path.join(root, file));
    if (hash !== null) snapshot[file] = hash;
  }
  return snapshot;
}

export interface RedReceiptInput {
  taskId: string;
  agent: string;
  test: string;
  failure: string;
  config?: HarnessConfig;
}

/**
 * Record that a test was observed failing. The snapshot of production code
 * taken here is the evidence: if none of it changed afterwards, the test was
 * written against code that already existed and the receipt proves nothing.
 */
export function recordRedReceipt(paths: HarnessPaths, input: RedReceiptInput): RedReceipt {
  const config = input.config ?? loadConfig(paths);
  const receipt: RedReceipt = {
    test: input.test,
    at: new Date().toISOString(),
    status: 'red',
    failure: input.failure,
    src: snapshotSource(paths.root, config),
  };

  const file = receiptFile(paths, input.taskId, input.agent);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(receipt)}\n`);
  return receipt;
}

function redReceiptGate(
  paths: HarnessPaths,
  config: HarnessConfig,
  agent: AgentDefinition,
  task: Task,
  changed: string[],
): GateOutcome {
  if (!config.gates.tdd) return { id: 'red-receipt', result: 'skip', detail: 'gates.tdd is off' };

  const source = changed.filter((file) => isSourcePath(file, config));
  if (source.length === 0) {
    return { id: 'red-receipt', result: 'skip', detail: 'no production code changed' };
  }

  const tracked = trackedFiles(paths.root);
  const newTests = changed.filter((file) => isTestPath(file, config) && !tracked.has(file));
  if (newTests.length === 0) {
    return { id: 'red-receipt', result: 'skip', detail: 'no new tests in this change' };
  }

  const receipts = readReceipts(paths, task.id, agent.name);
  const missing: string[] = [];
  const stale: string[] = [];

  for (const test of newTests) {
    const receipt = receipts.findLast((candidate) => candidate.test === test);
    if (receipt === undefined) {
      missing.push(test);
      continue;
    }
    // At least one production file must differ from the red-time snapshot.
    const moved = source.some((file) => receipt.src[file] !== hashFile(path.join(paths.root, file)));
    if (!moved) stale.push(test);
  }

  if (missing.length > 0) {
    return {
      id: 'red-receipt',
      result: 'fail',
      detail: `no red receipt for: ${missing.join(', ')} -- run \`harness tdd red <test>\` before implementing`,
    };
  }
  if (stale.length > 0) {
    return {
      id: 'red-receipt',
      result: 'fail',
      detail: `production code is unchanged since the red receipt for: ${stale.join(', ')} -- the test was recorded after the implementation`,
    };
  }
  return { id: 'red-receipt', result: 'pass' };
}

// --- rule checks -----------------------------------------------------------

function ruleGate(
  paths: HarnessPaths,
  rule: Rule,
  agent: AgentDefinition,
  task: Task,
): GateOutcome {
  const id = `rule:${rule.id}`;
  const check = rule.checkPath;
  if (check === undefined) return { id, result: 'skip' };

  const run = spawnSync(check, [], {
    cwd: paths.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      HARNESS_ROOT: paths.root,
      HARNESS_DIR: paths.dir,
      HARNESS_TASK: task.id,
      HARNESS_AGENT: agent.name,
    },
  });

  if (run.error !== undefined) {
    return { id, result: 'fail', detail: `${check}: ${run.error.message}` };
  }
  if (run.status === 0) return { id, result: 'pass' };

  const output = `${run.stderr}${run.stdout}`.trim();
  return { id, result: 'fail', detail: output === '' ? `${check} exited ${run.status}` : output };
}

// --- runner ----------------------------------------------------------------

export interface GateInput {
  paths: HarnessPaths;
  config: HarnessConfig;
  agent: AgentDefinition;
  task: Task;
  rules: Rule[];
  baseRef?: string;
}

export function runGates(input: GateInput): GateOutcome[] {
  const { paths, config, agent, task, rules } = input;
  const changed = changedFiles(paths.root, input.baseRef);

  const outcomes: GateOutcome[] = [];
  if (config.gates.writeScope) outcomes.push(writeScopeGate(agent, changed));
  outcomes.push(tddPairGate(config, changed));
  outcomes.push(redReceiptGate(paths, config, agent, task, changed));
  if (config.gates.rules) {
    for (const rule of blockingRulesFor(rules, agent.name)) {
      outcomes.push(ruleGate(paths, rule, agent, task));
    }
  }
  return outcomes;
}

export function gatesPassed(outcomes: GateOutcome[]): boolean {
  return outcomes.every((outcome) => outcome.result !== 'fail');
}
