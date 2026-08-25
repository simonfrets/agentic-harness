import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { compileToClaudeMarkdown } from '../../core/agents/compile';
import { loadAgents } from '../../core/agents/load';
import { EXIT, HarnessError } from '../../core/errors';
import { recordRedReceipt } from '../../core/gates';
import { crapReport } from '../../core/metrics/crap';
import { hasErrors, lintSpec } from '../../core/specs/lint';
import { note, out, runtimeDir, session, usage } from '../util';

// --- sync ------------------------------------------------------------------

/** Project harness agents onto `.claude/agents/` so Claude Code can use them. */
export function sync(): void {
  const { root, paths } = session();
  const target = path.join(root, '.claude', 'agents');
  fs.mkdirSync(target, { recursive: true });

  const agents = loadAgents(paths);
  if (agents.length === 0) {
    note('no agents to sync');
    return;
  }
  for (const agent of agents) {
    fs.writeFileSync(path.join(target, `${agent.name}.md`), compileToClaudeMarkdown(paths, agent));
    out(`.claude/agents/${agent.name}.md`);
  }
}

// --- doctor ----------------------------------------------------------------

function onPath(bin: string): boolean {
  return spawnSync('sh', ['-c', `command -v ${JSON.stringify(bin)}`], { stdio: 'ignore' }).status === 0;
}

export function doctor(): void {
  const { root, paths, config, rules } = session();
  const checks: [boolean, string][] = [];

  checks.push([fs.existsSync(paths.tasks), `tasks file: ${path.relative(root, paths.tasks)}`]);
  const agents = loadAgents(paths);
  checks.push([agents.length > 0, `agents: ${agents.map((a) => a.name).join(', ') || 'none'}`]);
  checks.push([true, `rules: ${rules.map((r) => r.id).join(', ') || 'none'}`]);

  for (const [name, adapter] of Object.entries(config.adapters)) {
    const present = onPath(adapter.bin);
    checks.push([present, `adapter ${name}: ${present ? adapter.bin : `${adapter.bin} not on PATH`}`]);
  }

  const hooks = spawnSync('git', ['config', 'core.hooksPath'], { cwd: root, encoding: 'utf8' });
  checks.push([hooks.stdout.trim() !== '', `git hooks: ${hooks.stdout.trim() || 'not configured (npm run prepare)'}`]);
  checks.push([onPath('shellcheck'), 'shellcheck: shell lint (brew install shellcheck)']);

  // Every blocking rule must actually be runnable, or the gate is a lie.
  for (const rule of rules) {
    if (rule.enforcement !== 'blocking' || rule.checkPath === undefined) continue;
    let executable = false;
    try {
      fs.accessSync(rule.checkPath, fs.constants.X_OK);
      executable = true;
    } catch {
      executable = false;
    }
    checks.push([executable, `rule ${rule.id}: check ${executable ? 'executable' : 'is not executable'}`]);
  }

  let failed = 0;
  for (const [ok, message] of checks) {
    if (!ok) failed += 1;
    out(`${ok ? ' ok ' : 'WARN'}  ${message}`);
  }
  if (failed > 0) note(`\n${failed} check(s) need attention`);
}

// --- spec ------------------------------------------------------------------

export function specLint(file: string | undefined): void {
  const { paths } = session();
  const targets =
    file !== undefined
      ? [path.resolve(file)]
      : (fs.existsSync(paths.specs) ? fs.readdirSync(paths.specs) : [])
          .filter((entry) => entry.endsWith('.feature'))
          .map((entry) => path.join(paths.specs, entry));

  if (targets.length === 0) {
    note('no .feature files to lint');
    return;
  }

  let bad = 0;
  for (const target of targets) {
    const issues = lintSpec(fs.readFileSync(target, 'utf8'));
    for (const issue of issues) out(`${target}:${issue.line}  ${issue.level}  ${issue.message}`);
    if (hasErrors(issues)) bad += 1;
  }
  if (bad > 0) {
    note(`${bad} spec(s) have errors`);
    process.exitCode = EXIT.GATE_FAILED;
  } else {
    out(`${targets.length} spec(s) ok`);
  }
}

// --- metrics ---------------------------------------------------------------

export function metricsCrap(options: { coverage?: string; max?: string; top?: string }): void {
  const { root } = session();
  const coverage = path.resolve(root, options.coverage ?? 'coverage/coverage-final.json');
  const report = crapReport(coverage, root);
  const top = Number.parseInt(options.top ?? '20', 10);
  const ceiling = options.max === undefined ? undefined : Number.parseFloat(options.max);

  out('crap   cx  cov   where');
  for (const entry of report.slice(0, top)) {
    out(
      `${entry.crap.toFixed(1).padStart(6)}  ${String(entry.complexity).padStart(2)}  ${(entry.coverage * 100)
        .toFixed(0)
        .padStart(3)}%  ${entry.file}:${entry.line} ${entry.fn}`,
    );
  }

  if (ceiling !== undefined) {
    const over = report.filter((entry) => entry.crap > ceiling);
    if (over.length > 0) {
      note(`\n${over.length} function(s) over the CRAP ceiling of ${ceiling}`);
      process.exitCode = EXIT.GATE_FAILED;
    }
  }
}

// --- tdd -------------------------------------------------------------------

/**
 * Run a test and require it to FAIL, then record the receipt the handoff gate
 * checks. A passing test here is an error: there is nothing to prove.
 */
export function tddRed(test: string, options: { task: string; agent: string; command?: string }): void {
  const { root, paths } = session();
  const command = options.command ?? `npx jest --findRelatedTests ${JSON.stringify(test)} --passWithNoTests=false`;

  const run = spawnSync('sh', ['-c', command], { cwd: root, encoding: 'utf8' });
  if (run.status === 0) {
    throw new HarnessError(
      'USAGE',
      `${test} passed -- there is no red to record`,
      'write the failing test first, then run `harness tdd red` again',
    );
  }

  const failure = `${run.stdout}${run.stderr}`.trim().slice(-4000);
  const receipt = recordRedReceipt(paths, {
    taskId: options.task,
    agent: options.agent,
    test,
    failure,
  });
  out(`red receipt recorded for ${receipt.test}`);
}

export function tddGuard(args: string[]): void {
  const script = path.join(runtimeDir(), 'tdd', 'guard.sh');
  const run = spawnSync('sh', [script, ...args], { stdio: 'inherit' });
  process.exitCode = run.status ?? EXIT.ERROR;
}

/**
 * Coverage may never fall below the recorded baseline, and the baseline only
 * ever moves up. Without the ratchet a large untested addition barely dents a
 * global percentage.
 */
export function tddRatchet(options: { coverage?: string; floor?: string }): void {
  const { root, paths } = session();
  const summaryFile = path.resolve(root, options.coverage ?? 'coverage/coverage-summary.json');

  let summary: { total?: { lines?: { pct?: number } } };
  try {
    summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8')) as typeof summary;
  } catch {
    usage(`no coverage summary at ${summaryFile}`, 'add "json-summary" to jest coverageReporters');
  }

  const pct = summary.total?.lines?.pct ?? 0;
  const baselineFile = path.join(paths.metrics, 'baseline.json');
  let baseline = 0;
  try {
    baseline = (JSON.parse(fs.readFileSync(baselineFile, 'utf8')) as { lines: number }).lines;
  } catch {
    baseline = 0;
  }

  const floor = options.floor === undefined ? 0 : Number.parseFloat(options.floor);
  out(`coverage ${pct.toFixed(2)}%  baseline ${baseline.toFixed(2)}%  floor ${floor}%`);

  if (pct + 1e-9 < Math.max(baseline, floor)) {
    note('coverage regressed');
    process.exitCode = EXIT.GATE_FAILED;
    return;
  }

  if (pct > baseline) {
    fs.mkdirSync(paths.metrics, { recursive: true });
    fs.writeFileSync(baselineFile, `${JSON.stringify({ lines: pct }, null, 2)}\n`);
    out(`baseline raised to ${pct.toFixed(2)}%`);
  }
}

// --- rules -----------------------------------------------------------------

export function rulesList(): void {
  const { rules } = session();
  if (rules.length === 0) {
    note('no rules');
    return;
  }
  for (const rule of rules) {
    const check = rule.checkPath === undefined ? '' : `  check=${path.basename(rule.checkPath)}`;
    out(`${rule.id.padEnd(20)} ${rule.enforcement.padEnd(9)} ${rule.appliesTo.join(',')}${check}`);
  }
}

const RULE_TEMPLATE = (id: string): string => `---
id: ${id}
applies_to: ["*"]
enforcement: advisory
# check: checks/${id}.sh    # uncomment to make this a blocking gate
---
Describe the rule here. This text is injected into the context of every agent
listed in applies_to.
`;

export function rulesAdd(id: string): void {
  const { paths } = session();
  if (!/^[a-z][a-z0-9-]*$/.test(id)) usage(`"${id}" is not a valid rule id`, 'use lowercase kebab-case');

  const file = path.join(paths.rules, `${id}.md`);
  if (fs.existsSync(file)) usage(`${file} already exists`);

  fs.mkdirSync(paths.rules, { recursive: true });
  fs.writeFileSync(file, RULE_TEMPLATE(id));
  out(file);
}

// --- pipeline (delegates to the shell runtime) -----------------------------

function execRuntime(script: string, args: string[]): void {
  const { root } = session();
  const target = path.join(runtimeDir(), 'pipeline', script);
  if (!fs.existsSync(target)) usage(`missing runtime script ${target}`);

  try {
    execFileSync('sh', [target, ...args], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, HARNESS_ROOT: root },
    });
  } catch (err) {
    process.exitCode = (err as { status?: number }).status ?? EXIT.ERROR;
  }
}

export function run(options: { task?: string; adapter?: string; agent?: string }): void {
  const args: string[] = [];
  if (options.task !== undefined) args.push('--task', options.task);
  if (options.adapter !== undefined) args.push('--adapter', options.adapter);
  if (options.agent !== undefined) args.push('--agent', options.agent);
  execRuntime('run.sh', args);
}

export function open(agent: string, options: { task?: string; adapter?: string }): void {
  const args = ['--agent', agent];
  if (options.task !== undefined) args.push('--task', options.task);
  if (options.adapter !== undefined) args.push('--adapter', options.adapter);
  execRuntime('open.sh', args);
}
