import fs from 'node:fs';

import { loadConfig } from '../../src/core/config/load';
import type { HarnessError } from '../../src/core/errors';
import { harnessPaths } from '../../src/core/paths';
import type { HarnessPaths } from '../../src/core/paths';
import { cleanupTempDirs, tempDir, write } from '../helpers/fixture';

afterAll(cleanupTempDirs);

function seedConfig(contents?: string): HarnessPaths {
  const paths = harnessPaths(tempDir());
  fs.mkdirSync(paths.dir, { recursive: true });
  if (contents !== undefined) write(paths.config, contents);
  return paths;
}

describe('loadConfig', () => {
  it('falls back to defaults when no config file exists', () => {
    const config = loadConfig(seedConfig());
    expect(config.adapter).toBe('claude');
    expect(config.pipeline).toEqual(['specifier', 'coder', 'cleaner', 'architect', 'hardener', 'qa']);
    expect(config.gates.writeScope).toBe(true);
    expect(config.gates.tdd).toBe(true);
  });

  it('knows the claude and codex adapter binaries out of the box', () => {
    const config = loadConfig(seedConfig());
    expect(config.adapters['claude']?.bin).toBe('claude');
    expect(config.adapters['codex']?.bin).toBe('codex');
  });

  it('applies overrides over the defaults', () => {
    const config = loadConfig(seedConfig('version: 1\nadapter: codex\ngates:\n  tdd: false\n'));
    expect(config.adapter).toBe('codex');
    expect(config.gates.tdd).toBe(false);
    // Untouched gates keep their defaults.
    expect(config.gates.writeScope).toBe(true);
  });

  it('carries the TDD path conventions the guard and gates share', () => {
    const config = loadConfig(seedConfig('version: 1\ntdd:\n  srcPrefixes: [lib]\n'));
    expect(config.tdd.srcPrefixes).toEqual(['lib']);
    expect(config.tdd.testPrefixes).toEqual(['tests']);
    expect(config.tdd.coverageFloor).toBe(80);
  });

  it('rejects a default adapter that is not configured', () => {
    try {
      loadConfig(seedConfig('version: 1\nadapter: telepathy\n'));
      throw new Error('expected a validation failure');
    } catch (err) {
      expect((err as HarnessError).code).toBe('CONFIG_INVALID');
    }
  });

  it('reports CONFIG_INVALID for malformed YAML', () => {
    try {
      loadConfig(seedConfig('adapter: [unclosed\n'));
      throw new Error('expected a parse failure');
    } catch (err) {
      expect((err as HarnessError).code).toBe('CONFIG_INVALID');
    }
  });
});
