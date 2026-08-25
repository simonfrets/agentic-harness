import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { loadAgent } from '../../src/core/agents/load';
import { loadConfig } from '../../src/core/config/load';
import { changedFiles, recordRedReceipt, runGates } from '../../src/core/gates';
import { harnessPaths, taskStateDir, type HarnessPaths } from '../../src/core/paths';
import { loadRules } from '../../src/core/rules/load';
import { parseTasks } from '../../src/core/tasks/store';
import { cleanupTempDirs, tempGitRepo, write } from '../helpers/fixture';

afterAll(cleanupTempDirs);

const TASK = parseTasks(
  `version: 1
tasks:
  - id: T-001
    title: Add reset
    status: coding
    owner: coder
`,
  'tasks.yaml',
).tasks[0]!;

interface Fixture {
  root: string;
  paths: HarnessPaths;
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function seed(agentYaml?: string): Fixture {
  const root = tempGitRepo();
  const paths = harnessPaths(root);
  fs.mkdirSync(paths.dir, { recursive: true });
  write(
    `${paths.agents}/coder.yaml`,
    agentYaml ??
      `name: coder
model: { claude: sonnet }
tools: [Read, Edit]
write_scope: ["src/**", "tests/**"]
prompt: prompts/coder.md
`,
  );
  write(`${paths.prompts}/coder.md`, 'implement.\n');
  // Harness config is committed in a real project; only agent work shows up as
  // a change. Committing it here keeps the fixture honest.
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'harness config');
  return { root, paths };
}

function gates(fixture: Fixture, agent = 'coder'): ReturnType<typeof runGates> {
  return runGates({
    paths: fixture.paths,
    config: loadConfig(fixture.paths),
    agent: loadAgent(fixture.paths, agent),
    task: TASK,
    rules: loadRules(fixture.paths),
  });
}

function outcome(results: ReturnType<typeof runGates>, id: string): { result: string; detail?: string } {
  const found = results.find((r) => r.id === id);
  if (found === undefined) throw new Error(`no gate "${id}" in ${results.map((r) => r.id).join(', ')}`);
  return found;
}

describe('changedFiles', () => {
  it('sees both tracked edits and brand new files', () => {
    const { root } = seed();
    write(path.join(root, 'src', 'tracked.ts'), 'export const a = 1;\n');
    git(root, 'add', 'src/tracked.ts');
    git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'add');
    write(path.join(root, 'src', 'tracked.ts'), 'export const a = 2;\n');
    write(path.join(root, 'src', 'fresh.ts'), 'export const b = 1;\n');
    expect(changedFiles(root).sort()).toEqual(['src/fresh.ts', 'src/tracked.ts']);
  });

  it('ignores files git is told to ignore', () => {
    const { root } = seed();
    write(path.join(root, '.gitignore'), 'ignored/\n');
    write(path.join(root, 'ignored', 'junk.ts'), 'nope\n');
    expect(changedFiles(root)).not.toContain('ignored/junk.ts');
  });
});

describe('write-scope gate', () => {
  it('passes when every change is inside the declared globs', () => {
    const fixture = seed();
    write(path.join(fixture.root, 'src', 'reset.ts'), 'export const x = 1;\n');
    write(path.join(fixture.root, 'tests', 'reset.test.ts'), 'test("x", () => {});\n');
    expect(outcome(gates(fixture), 'write-scope').result).toBe('pass');
  });

  it('fails and names the file that escaped the scope', () => {
    const fixture = seed();
    write(path.join(fixture.root, 'src', 'reset.ts'), 'export const x = 1;\n');
    write(path.join(fixture.root, 'tests', 'reset.test.ts'), 'test("x", () => {});\n');
    write(path.join(fixture.root, 'infra', 'deploy.tf'), 'resource "x" {}\n');
    const result = outcome(gates(fixture), 'write-scope');
    expect(result.result).toBe('fail');
    expect(result.detail).toContain('infra/deploy.tf');
  });

  it('always allows the harness to write its own state', () => {
    const fixture = seed();
    write(`${taskStateDir(fixture.paths, 'T-001', 'coder')}/output.md`, 'done\n');
    write(`${fixture.paths.events}/T-001.jsonl`, '{}\n');
    expect(outcome(gates(fixture), 'write-scope').result).toBe('pass');
  });

  it('is skipped for an agent that declares no scope', () => {
    const fixture = seed(`name: coder
model: { claude: sonnet }
prompt: prompts/coder.md
`);
    write(path.join(fixture.root, 'anywhere.ts'), 'x\n');
    expect(outcome(gates(fixture), 'write-scope').result).toBe('skip');
  });
});

describe('tdd-pair gate', () => {
  it('fails when production code moves alone', () => {
    const fixture = seed();
    write(path.join(fixture.root, 'src', 'reset.ts'), 'export const x = 1;\n');
    const result = outcome(gates(fixture), 'tdd-pair');
    expect(result.result).toBe('fail');
    expect(result.detail).toContain('src/reset.ts');
  });

  it('passes when tests move with it', () => {
    const fixture = seed();
    write(path.join(fixture.root, 'src', 'reset.ts'), 'export const x = 1;\n');
    write(path.join(fixture.root, 'tests', 'reset.test.ts'), 'test("x", () => {});\n');
    expect(outcome(gates(fixture), 'tdd-pair').result).toBe('pass');
  });

  it('is skipped when the project turns the tdd gate off', () => {
    const fixture = seed();
    write(fixture.paths.config, 'version: 1\ngates:\n  tdd: false\n');
    write(path.join(fixture.root, 'src', 'reset.ts'), 'export const x = 1;\n');
    expect(outcome(gates(fixture), 'tdd-pair').result).toBe('skip');
  });
});

describe('red-receipt gate', () => {
  const newTest = 'tests/reset.test.ts';

  function withPairedChange(fixture: Fixture): void {
    write(path.join(fixture.root, 'src', 'reset.ts'), 'export const x = 1;\n');
    write(path.join(fixture.root, newTest), 'test("x", () => {});\n');
  }

  it('fails when a new test has no receipt proving it was ever red', () => {
    const fixture = seed();
    withPairedChange(fixture);
    const result = outcome(gates(fixture), 'red-receipt');
    expect(result.result).toBe('fail');
    expect(result.detail).toContain(newTest);
  });

  it('passes when the test was recorded red before the production change', () => {
    const fixture = seed();
    write(path.join(fixture.root, newTest), 'test("x", () => {});\n');
    // Red is recorded here -- src/reset.ts does not exist yet.
    recordRedReceipt(fixture.paths, {
      taskId: 'T-001',
      agent: 'coder',
      test: newTest,
      failure: 'Cannot find module ../src/reset',
    });
    write(path.join(fixture.root, 'src', 'reset.ts'), 'export const x = 1;\n');
    expect(outcome(gates(fixture), 'red-receipt').result).toBe('pass');
  });

  it('fails a receipt recorded after the production code already existed', () => {
    const fixture = seed();
    withPairedChange(fixture);
    // Red recorded now, with src/reset.ts already in its final state.
    recordRedReceipt(fixture.paths, {
      taskId: 'T-001',
      agent: 'coder',
      test: newTest,
      failure: 'expected 2 got 1',
    });
    const result = outcome(gates(fixture), 'red-receipt');
    expect(result.result).toBe('fail');
    expect(result.detail).toMatch(/unchanged since/i);
  });

  it('is skipped when no production code changed at all', () => {
    const fixture = seed();
    write(path.join(fixture.root, newTest), 'test("x", () => {});\n');
    expect(outcome(gates(fixture), 'red-receipt').result).toBe('skip');
  });
});

describe('rule gates', () => {
  function seedRule(fixture: Fixture, body: string, enforcement = 'blocking'): void {
    write(
      `${fixture.paths.rules}/branch-naming.md`,
      `---\nid: branch-naming\napplies_to: [coder]\nenforcement: ${enforcement}\ncheck: checks/branch-naming.sh\n---\nBranches look like feat/<task>-slug.\n`,
    );
    write(`${fixture.paths.ruleChecks}/branch-naming.sh`, body);
    fs.chmodSync(`${fixture.paths.ruleChecks}/branch-naming.sh`, 0o755);
  }

  it('passes a check that exits zero', () => {
    const fixture = seed();
    seedRule(fixture, '#!/bin/sh\nexit 0\n');
    expect(outcome(gates(fixture), 'rule:branch-naming').result).toBe('pass');
  });

  it('fails a check that exits non-zero and keeps its message', () => {
    const fixture = seed();
    seedRule(fixture, '#!/bin/sh\necho "branch must be feat/T-001-slug" >&2\nexit 1\n');
    const result = outcome(gates(fixture), 'rule:branch-naming');
    expect(result.result).toBe('fail');
    expect(result.detail).toContain('branch must be feat/T-001-slug');
  });

  it('never runs an advisory rule as a gate', () => {
    const fixture = seed();
    seedRule(fixture, '#!/bin/sh\nexit 1\n', 'advisory');
    expect(gates(fixture).find((r) => r.id === 'rule:branch-naming')).toBeUndefined();
  });

  it('tells the check which task and agent it is judging', () => {
    const fixture = seed();
    seedRule(fixture, '#!/bin/sh\n[ "$HARNESS_TASK" = T-001 ] && [ "$HARNESS_AGENT" = coder ]\n');
    expect(outcome(gates(fixture), 'rule:branch-naming').result).toBe('pass');
  });

  it('fails rather than throws when the check is not executable', () => {
    const fixture = seed();
    seedRule(fixture, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(`${fixture.paths.ruleChecks}/branch-naming.sh`, 0o644);
    expect(outcome(gates(fixture), 'rule:branch-naming').result).toBe('fail');
  });
});
