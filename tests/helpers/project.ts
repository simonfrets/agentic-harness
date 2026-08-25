import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { REPO_ROOT, tempGitRepo, write } from './fixture';

export const CLI = path.join(REPO_ROOT, 'dist', 'cli', 'index.js');
export const FAKE_BIN = path.join(REPO_ROOT, 'tests', 'fixtures', 'bin');

export interface Project {
  root: string;
  fakeLog: string;
  /** Run the harness CLI inside the project. */
  cli(args: string[], env?: Record<string, string>): SpawnSyncReturns<string>;
  /** Run one of the shipped runtime shell scripts inside the project. */
  runtime(script: string, args: string[], env?: Record<string, string>): SpawnSyncReturns<string>;
  /** Invocations the fake adapters recorded, as `agent|bin|argv` rows. */
  invocations(): string[];
  read(relative: string): string;
  exists(relative: string): boolean;
}

/**
 * A throwaway git project with `.harness/` initialized and the fake adapters
 * first on PATH -- everything a pipeline run needs, with nothing real behind it.
 */
export function makeProject(options: { config?: string; branch?: string } = {}): Project {
  const root = tempGitRepo('harness-project-');
  const fakeLog = path.join(root, 'invocations.log');

  execFileSync('node', [CLI, 'init'], { cwd: root, stdio: 'pipe' });

  // Gate defaults are strict on purpose; pipeline tests opt out so they measure
  // the pipeline rather than re-testing the gates.
  write(
    path.join(root, '.harness', 'harness.config.yaml'),
    options.config ??
      `version: 1
adapter: claude
pipeline: [specifier, coder, cleaner, architect, hardener, qa]
gates:
  writeScope: false
  rules: false
  tdd: false
`,
  );

  // Commit the scaffold, as a real project would, so the only thing the
  // write-scope gate sees afterwards is what an agent actually did.
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '--no-verify', '-m', 'chore: harness init'], { cwd: root });

  if (options.branch !== undefined) {
    execFileSync('git', ['checkout', '-q', '-b', options.branch], { cwd: root });
  }

  const baseEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
    ...process.env,
    PATH: `${FAKE_BIN}:${process.env['PATH'] ?? ''}`,
    HARNESS_CLI: `node ${CLI}`,
    HARNESS_FAKE_LOG: fakeLog,
    HARNESS_NO_COLOR: '1',
    ...extra,
  });

  return {
    root,
    fakeLog,
    cli(args, env = {}) {
      return spawnSync('node', [CLI, ...args], { cwd: root, encoding: 'utf8', env: baseEnv(env) });
    },
    runtime(script, args, env = {}) {
      return spawnSync('sh', [path.join(REPO_ROOT, 'runtime', script), ...args], {
        cwd: root,
        encoding: 'utf8',
        env: baseEnv(env),
      });
    },
    invocations() {
      try {
        return fs.readFileSync(fakeLog, 'utf8').split('\n').filter((line) => line !== '');
      } catch {
        return [];
      }
    },
    read(relative) {
      return fs.readFileSync(path.join(root, relative), 'utf8');
    },
    exists(relative) {
      return fs.existsSync(path.join(root, relative));
    },
  };
}

/** Create a task and return its id. */
export function addTask(project: Project, title: string): string {
  const result = project.cli(['task', 'add', title]);
  if (result.status !== 0) throw new Error(`task add failed: ${result.stderr}`);
  return result.stdout.trim();
}
