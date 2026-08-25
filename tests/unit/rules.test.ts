import fs from 'node:fs';

import { HarnessError } from '../../src/core/errors';
import { harnessPaths, type HarnessPaths } from '../../src/core/paths';
import { blockingRulesFor, loadRules, parseFrontmatter, rulesFor } from '../../src/core/rules/load';
import { cleanupTempDirs, tempDir, write } from '../helpers/fixture';

afterAll(cleanupTempDirs);

const TDD = `---
id: tdd
applies_to: [coder, cleaner]
enforcement: blocking
check: checks/tdd-pair.sh
---
Write the failing test first. Never write production code without a red test.
`;

const STYLE = `---
id: code-style
applies_to: ["*"]
enforcement: advisory
---
Match the surrounding code.
`;

function seedRules(): HarnessPaths {
  const paths = harnessPaths(tempDir());
  fs.mkdirSync(paths.rules, { recursive: true });
  write(`${paths.rules}/tdd.md`, TDD);
  write(`${paths.rules}/code-style.md`, STYLE);
  return paths;
}

describe('parseFrontmatter', () => {
  it('splits the YAML head from the markdown body', () => {
    const { data, body } = parseFrontmatter(TDD, 'tdd.md');
    expect((data as { id: string }).id).toBe('tdd');
    expect(body.trim()).toMatch(/^Write the failing test first/);
  });

  it('rejects a file with no frontmatter fence', () => {
    try {
      parseFrontmatter('just prose\n', 'loose.md');
      throw new Error('expected a parse failure');
    } catch (err) {
      expect((err as HarnessError).code).toBe('RULE_INVALID');
    }
  });

  it('rejects an unterminated fence', () => {
    expect(() => parseFrontmatter('---\nid: x\nbody without close\n', 'bad.md')).toThrow(HarnessError);
  });
});

describe('loadRules', () => {
  it('loads every rule, sorted by id', () => {
    expect(loadRules(seedRules()).map((r) => r.id)).toEqual(['code-style', 'tdd']);
  });

  it('keeps the body as the text injected into agent context', () => {
    const tdd = loadRules(seedRules()).find((r) => r.id === 'tdd');
    expect(tdd?.body).toContain('Write the failing test first');
  });

  it('resolves check paths against .harness/rules', () => {
    const paths = seedRules();
    const tdd = loadRules(paths).find((r) => r.id === 'tdd');
    expect(tdd?.checkPath).toBe(`${paths.rules}/checks/tdd-pair.sh`);
  });

  it('leaves checkPath undefined for a rule with no executable check', () => {
    const style = loadRules(seedRules()).find((r) => r.id === 'code-style');
    expect(style?.checkPath).toBeUndefined();
    expect(style?.enforcement).toBe('advisory');
  });

  it('is empty rather than throwing when no rules directory exists', () => {
    expect(loadRules(harnessPaths(tempDir()))).toEqual([]);
  });

  it('rejects a rule whose id disagrees with its filename', () => {
    const paths = seedRules();
    write(`${paths.rules}/mismatch.md`, TDD);
    expect(() => loadRules(paths)).toThrow(HarnessError);
  });

  it('ignores non-markdown files and the checks directory', () => {
    const paths = seedRules();
    write(`${paths.ruleChecks}/tdd-pair.sh`, '#!/bin/sh\nexit 0\n');
    write(`${paths.rules}/README.txt`, 'not a rule');
    expect(loadRules(paths).map((r) => r.id)).toEqual(['code-style', 'tdd']);
  });
});

describe('rulesFor', () => {
  it('matches an agent named in applies_to', () => {
    expect(rulesFor(loadRules(seedRules()), 'coder').map((r) => r.id)).toEqual(['code-style', 'tdd']);
  });

  it('treats "*" as applying to every agent', () => {
    expect(rulesFor(loadRules(seedRules()), 'architect').map((r) => r.id)).toEqual(['code-style']);
  });
});

describe('blockingRulesFor', () => {
  it('returns only blocking rules that have a check to run', () => {
    expect(blockingRulesFor(loadRules(seedRules()), 'coder').map((r) => r.id)).toEqual(['tdd']);
  });

  it('excludes advisory rules even when they declare a check', () => {
    expect(blockingRulesFor(loadRules(seedRules()), 'architect')).toEqual([]);
  });
});
