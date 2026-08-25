import fs from 'node:fs';

import { harnessPaths } from '../../src/core/paths';
import { appendEvent, readEvents } from '../../src/core/tasks/events';
import { cleanupTempDirs, tempDir, write } from '../helpers/fixture';

afterAll(cleanupTempDirs);

describe('appendEvent', () => {
  it('creates the log directory on first write', () => {
    const paths = harnessPaths(tempDir());
    appendEvent(paths, 'T-001', { type: 'task.created', agent: 'specifier' });
    expect(fs.existsSync(`${paths.events}/T-001.jsonl`)).toBe(true);
  });

  it('stamps every event with a time and its task', () => {
    const paths = harnessPaths(tempDir());
    appendEvent(paths, 'T-001', { type: 'handoff', agent: 'coder' });
    const [event] = readEvents(paths, 'T-001');
    expect(event?.task).toBe('T-001');
    expect(event?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('appends rather than overwrites, preserving order', () => {
    const paths = harnessPaths(tempDir());
    appendEvent(paths, 'T-001', { type: 'task.created', agent: 'specifier' });
    appendEvent(paths, 'T-001', { type: 'handoff', agent: 'specifier' });
    appendEvent(paths, 'T-001', { type: 'gate.failed', agent: 'coder' });
    expect(readEvents(paths, 'T-001').map((e) => e.type)).toEqual([
      'task.created',
      'handoff',
      'gate.failed',
    ]);
  });

  it('keeps one event per line so the log stays greppable', () => {
    const paths = harnessPaths(tempDir());
    appendEvent(paths, 'T-001', { type: 'handoff', agent: 'coder', detail: 'multi\nline\nsummary' });
    const text = fs.readFileSync(`${paths.events}/T-001.jsonl`, 'utf8');
    expect(text.trimEnd().split('\n')).toHaveLength(1);
  });

  it('carries arbitrary detail through untouched', () => {
    const paths = harnessPaths(tempDir());
    appendEvent(paths, 'T-001', { type: 'gate.failed', agent: 'coder', gate: 'write-scope' });
    expect(readEvents(paths, 'T-001')[0]?.['gate']).toBe('write-scope');
  });

  it('separates logs per task', () => {
    const paths = harnessPaths(tempDir());
    appendEvent(paths, 'T-001', { type: 'handoff', agent: 'coder' });
    appendEvent(paths, 'T-002', { type: 'handoff', agent: 'qa' });
    expect(readEvents(paths, 'T-001')).toHaveLength(1);
    expect(readEvents(paths, 'T-002')).toHaveLength(1);
  });
});

describe('readEvents', () => {
  it('is empty for a task that has no log yet', () => {
    expect(readEvents(harnessPaths(tempDir()), 'T-404')).toEqual([]);
  });

  it('skips a corrupt line rather than losing the whole history', () => {
    const paths = harnessPaths(tempDir());
    appendEvent(paths, 'T-001', { type: 'task.created', agent: 'specifier' });
    fs.appendFileSync(`${paths.events}/T-001.jsonl`, 'not json at all\n');
    appendEvent(paths, 'T-001', { type: 'handoff', agent: 'coder' });
    expect(readEvents(paths, 'T-001').map((e) => e.type)).toEqual(['task.created', 'handoff']);
  });

  it('ignores blank lines', () => {
    const paths = harnessPaths(tempDir());
    write(`${paths.events}/T-001.jsonl`, '\n\n');
    expect(readEvents(paths, 'T-001')).toEqual([]);
  });
});
