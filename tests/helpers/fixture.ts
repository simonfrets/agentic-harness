import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REPO_ROOT = path.resolve(__dirname, '..', '..');

const created: string[] = [];

/** A throwaway directory, removed when the suite finishes. */
export function tempDir(prefix = 'harness-'): string {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  created.push(dir);
  return dir;
}

export function cleanupTempDirs(): void {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function write(file: string, contents: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

export function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

/** A temp directory that is a real git repo with one empty commit. */
export function tempGitRepo(prefix = 'harness-git-'): string {
  const dir = tempDir(prefix);
  const git = (...args: string[]): void => {
    execFileSync('git', args, {
      cwd: dir,
      stdio: 'pipe',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    });
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'harness@test.local');
  git('config', 'user.name', 'Harness Test');
  git('config', 'commit.gpgsign', 'false');
  git('commit', '-q', '--allow-empty', '-m', 'root');
  return dir;
}
