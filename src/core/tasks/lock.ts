import fs from 'node:fs';
import path from 'node:path';

import { HarnessError } from '../errors';

/**
 * Advisory locking via atomic `mkdir`.
 *
 * macOS ships no `flock(1)`, and the shell layer must be able to take the same
 * lock as the TypeScript layer -- `mkdir` is the one primitive that is atomic
 * on every POSIX filesystem and available to both.
 */
export interface LockOptions {
  /** How long to wait for the holder to let go. */
  timeoutMs?: number;
  /** Poll interval while waiting. */
  pollMs?: number;
  /**
   * Age past which a lock owned by a *live* process is considered abandoned.
   * A lock whose owner is dead is always reclaimable regardless of this value;
   * 0 disables age-based breaking entirely.
   */
  staleMs?: number;
}

export interface LockHandle {
  readonly dir: string;
  release(): void;
}

const DEFAULTS = { timeoutMs: 10_000, pollMs: 50, staleMs: 15 * 60_000 } as const;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readHolder(dir: string): { pid: number; ageMs: number } | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(path.join(dir, 'pid'), 'utf8').trim(), 10);
    const ageMs = Date.now() - fs.statSync(dir).mtimeMs;
    return { pid, ageMs };
  } catch {
    // The holder released it between our mkdir failing and this read.
    return null;
  }
}

function isStale(dir: string, staleMs: number): boolean {
  const holder = readHolder(dir);
  if (holder === null) return true;
  if (!processAlive(holder.pid)) return true;
  return staleMs > 0 && holder.ageMs > staleMs;
}

export function acquireLock(dir: string, options: LockOptions = {}): LockHandle {
  const { timeoutMs, pollMs, staleMs } = { ...DEFAULTS, ...options };
  const deadline = Date.now() + timeoutMs;
  fs.mkdirSync(path.dirname(dir), { recursive: true });

  let released = false;
  const handle: LockHandle = {
    dir,
    release(): void {
      if (released) return;
      released = true;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };

  for (;;) {
    try {
      // `recursive: false` is what makes this atomic: it fails if it exists.
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'pid'), `${process.pid}\n`);
      return handle;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }

    if (isStale(dir, staleMs)) {
      fs.rmSync(dir, { recursive: true, force: true });
      continue;
    }

    if (Date.now() >= deadline) {
      const holder = readHolder(dir);
      throw new HarnessError(
        'LOCK_TIMEOUT',
        `timed out waiting for lock ${dir}`,
        holder ? `held by pid ${holder.pid} for ${Math.round(holder.ageMs / 1000)}s` : undefined,
      );
    }

    sleepSync(pollMs);
  }
}

export function withLock<T>(dir: string, fn: () => T, options: LockOptions = {}): T {
  const held = acquireLock(dir, options);
  try {
    return fn();
  } finally {
    held.release();
  }
}
