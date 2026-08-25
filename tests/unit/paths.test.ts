import fs from 'node:fs';
import path from 'node:path';

import { findHarnessRoot, harnessPaths, requireHarnessRoot, taskStateDir } from '../../src/core/paths';
import { HarnessError } from '../../src/core/errors';
import { cleanupTempDirs, tempDir } from '../helpers/fixture';

afterAll(cleanupTempDirs);

function seedHarness(root: string): void {
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'harness.config.yaml'), 'version: 1\n');
}

describe('findHarnessRoot', () => {
  it('finds .harness in the starting directory', () => {
    const root = tempDir();
    seedHarness(root);
    expect(findHarnessRoot(root)).toBe(root);
  });

  it('walks upward like git does', () => {
    const root = tempDir();
    seedHarness(root);
    const deep = path.join(root, 'a', 'b', 'c');
    fs.mkdirSync(deep, { recursive: true });
    expect(findHarnessRoot(deep)).toBe(root);
  });

  it('returns null when no .harness exists anywhere above', () => {
    expect(findHarnessRoot(tempDir())).toBeNull();
  });

  it('stops at the nearest .harness, not the outermost', () => {
    const outer = tempDir();
    seedHarness(outer);
    const inner = path.join(outer, 'packages', 'inner');
    fs.mkdirSync(inner, { recursive: true });
    seedHarness(inner);
    expect(findHarnessRoot(path.join(inner, 'src'))).toBe(inner);
  });

  it('ignores a .harness that is a file rather than a directory', () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, '.harness'), 'not a directory');
    expect(findHarnessRoot(root)).toBeNull();
  });
});

describe('requireHarnessRoot', () => {
  it('throws a coded error when uninitialized', () => {
    const dir = tempDir();
    expect(() => requireHarnessRoot(dir)).toThrow(HarnessError);
    try {
      requireHarnessRoot(dir);
    } catch (err) {
      expect((err as HarnessError).code).toBe('NO_HARNESS');
    }
  });
});

describe('harnessPaths', () => {
  it('roots every path under <root>/.harness', () => {
    const p = harnessPaths('/project');
    expect(p.dir).toBe('/project/.harness');
    expect(p.tasks).toBe('/project/.harness/tasks.yaml');
    expect(p.config).toBe('/project/.harness/harness.config.yaml');
    expect(p.agents).toBe('/project/.harness/agents');
    expect(p.specs).toBe('/project/.harness/specs');
    expect(p.locks).toBe('/project/.harness/locks');
  });

  it('keeps the project root itself available for src/test globbing', () => {
    expect(harnessPaths('/project').root).toBe('/project');
  });
});

describe('taskStateDir', () => {
  it('isolates state per task and per agent', () => {
    const p = harnessPaths('/project');
    expect(taskStateDir(p, 'T-001', 'coder')).toBe('/project/.harness/state/T-001/coder');
  });
});
