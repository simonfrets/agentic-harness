import fs from 'node:fs';
import path from 'node:path';

import { acquireLock, withLock } from '../../src/core/tasks/lock';
import { HarnessError } from '../../src/core/errors';
import { cleanupTempDirs, tempDir } from '../helpers/fixture';

afterAll(cleanupTempDirs);

const fast = { timeoutMs: 250, pollMs: 10 } as const;

describe('acquireLock', () => {
  it('creates the lock directory and removes it on release', () => {
    const lock = path.join(tempDir(), 'tasks.lock');
    const held = acquireLock(lock, fast);
    expect(fs.existsSync(lock)).toBe(true);
    held.release();
    expect(fs.existsSync(lock)).toBe(false);
  });

  it('records the owning pid so a stale lock can be diagnosed', () => {
    const lock = path.join(tempDir(), 'tasks.lock');
    const held = acquireLock(lock, fast);
    expect(fs.readFileSync(path.join(lock, 'pid'), 'utf8').trim()).toBe(String(process.pid));
    held.release();
  });

  it('refuses a second holder while the first still holds it', () => {
    const lock = path.join(tempDir(), 'tasks.lock');
    const held = acquireLock(lock, fast);
    expect(() => acquireLock(lock, fast)).toThrow(HarnessError);
    held.release();
  });

  it('reports LOCK_TIMEOUT rather than a generic failure', () => {
    const lock = path.join(tempDir(), 'tasks.lock');
    const held = acquireLock(lock, fast);
    try {
      acquireLock(lock, fast);
      throw new Error('expected a timeout');
    } catch (err) {
      expect((err as HarnessError).code).toBe('LOCK_TIMEOUT');
    }
    held.release();
  });

  it('breaks a lock left behind by a dead process', () => {
    const lock = path.join(tempDir(), 'tasks.lock');
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(path.join(lock, 'pid'), '999999999');
    // staleMs 0 => the abandoned lock is immediately reclaimable.
    const held = acquireLock(lock, { ...fast, staleMs: 0 });
    expect(fs.readFileSync(path.join(lock, 'pid'), 'utf8').trim()).toBe(String(process.pid));
    held.release();
  });

  it('is idempotent on release', () => {
    const lock = path.join(tempDir(), 'tasks.lock');
    const held = acquireLock(lock, fast);
    held.release();
    expect(() => { held.release(); }).not.toThrow();
  });
});

describe('withLock', () => {
  it('returns the callback value and frees the lock', () => {
    const lock = path.join(tempDir(), 'tasks.lock');
    expect(withLock(lock, () => 42, fast)).toBe(42);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it('frees the lock even when the callback throws', () => {
    const lock = path.join(tempDir(), 'tasks.lock');
    expect(() =>
      withLock(lock, () => { throw new Error('boom'); }, fast),
    ).toThrow('boom');
    expect(fs.existsSync(lock)).toBe(false);
  });
});
