import path from 'node:path';

import type { HarnessError } from '../../src/core/errors';
import { crapReport, crapScore } from '../../src/core/metrics/crap';
import { hasErrors, lintSpec } from '../../src/core/specs/lint';
import { cleanupTempDirs, tempDir, write } from '../helpers/fixture';

afterAll(cleanupTempDirs);

describe('crapScore', () => {
  it('is just the complexity when a function is fully covered', () => {
    expect(crapScore(8, 1)).toBe(8);
  });

  it('explodes for complex uncovered code', () => {
    expect(crapScore(8, 0)).toBe(72);
  });

  it('rewards covering the complex function more than the simple one', () => {
    expect(crapScore(10, 0.5) - crapScore(10, 1)).toBeGreaterThan(
      crapScore(2, 0.5) - crapScore(2, 1),
    );
  });

  it('clamps coverage reported outside 0..1', () => {
    expect(crapScore(5, 1.4)).toBe(crapScore(5, 1));
  });
});

function coverageFixture(): string {
  const root = tempDir();
  const file = path.join(root, 'coverage-final.json');
  write(
    file,
    JSON.stringify({
      [path.join(root, 'src/risky.ts')]: {
        path: path.join(root, 'src/risky.ts'),
        fnMap: {
          '0': { name: 'risky', loc: { start: { line: 1 }, end: { line: 20 } } },
          '1': { name: 'safe', loc: { start: { line: 30 }, end: { line: 34 } } },
        },
        f: { '0': 1, '1': 1 },
        branchMap: {
          '0': { loc: { start: { line: 4 }, end: { line: 4 } } },
          '1': { loc: { start: { line: 8 }, end: { line: 8 } } },
          '2': { loc: { start: { line: 31 }, end: { line: 31 } } },
        },
        b: { '0': [1, 0], '1': [1, 0], '2': [1, 1] },
        statementMap: {
          '0': { start: { line: 2 }, end: { line: 2 } },
          '1': { start: { line: 5 }, end: { line: 5 } },
          '2': { start: { line: 9 }, end: { line: 9 } },
          '3': { start: { line: 31 }, end: { line: 31 } },
        },
        s: { '0': 3, '1': 0, '2': 0, '3': 5 },
      },
    }),
  );
  return root;
}

describe('crapReport', () => {
  it('ranks the worst function first', () => {
    const root = coverageFixture();
    const report = crapReport(path.join(root, 'coverage-final.json'), root);
    expect(report[0]?.fn).toBe('risky');
  });

  it('derives complexity from the branches inside each function', () => {
    const root = coverageFixture();
    const report = crapReport(path.join(root, 'coverage-final.json'), root);
    expect(report.find((e) => e.fn === 'risky')?.complexity).toBe(3);
    expect(report.find((e) => e.fn === 'safe')?.complexity).toBe(2);
  });

  it('measures coverage from the statements inside the function only', () => {
    const root = coverageFixture();
    const report = crapReport(path.join(root, 'coverage-final.json'), root);
    expect(report.find((e) => e.fn === 'risky')?.coverage).toBeCloseTo(1 / 3);
    expect(report.find((e) => e.fn === 'safe')?.coverage).toBe(1);
  });

  it('reports paths relative to the project root', () => {
    const root = coverageFixture();
    expect(crapReport(path.join(root, 'coverage-final.json'), root)[0]?.file).toBe('src/risky.ts');
  });

  it('explains itself when no coverage report exists', () => {
    try {
      crapReport(path.join(tempDir(), 'missing.json'), '/tmp');
      throw new Error('expected a failure');
    } catch (err) {
      expect((err as HarnessError).code).toBe('USAGE');
      expect((err as HarnessError).detail).toMatch(/coverage/);
    }
  });
});

describe('lintSpec', () => {
  const GOOD = `Feature: Password reset
  Scenario: A user resets their password
    Given a registered user
    When they request a reset
    Then they receive an email
`;

  it('accepts a complete scenario', () => {
    expect(lintSpec(GOOD)).toEqual([]);
  });

  it('rejects a file with no Feature line', () => {
    const issues = lintSpec(GOOD.replace('Feature: Password reset', '# nothing'));
    expect(issues.some((i) => i.message.includes('Feature:'))).toBe(true);
    expect(hasErrors(issues)).toBe(true);
  });

  it('rejects a spec with no scenarios', () => {
    expect(hasErrors(lintSpec('Feature: Empty\n'))).toBe(true);
  });

  it('rejects a scenario missing its Then', () => {
    const issues = lintSpec(GOOD.replace('    Then they receive an email\n', ''));
    expect(issues.some((i) => i.level === 'error' && i.message.includes('Then'))).toBe(true);
  });

  it('warns rather than fails when only Given is missing', () => {
    const issues = lintSpec(GOOD.replace('    Given a registered user\n', ''));
    expect(issues.some((i) => i.level === 'warn' && i.message.includes('Given'))).toBe(true);
    expect(hasErrors(issues)).toBe(false);
  });

  it('counts And and But toward neither Given nor Then', () => {
    const issues = lintSpec(`Feature: F
  Scenario: S
    And something
`);
    expect(issues.filter((i) => i.level === 'error')).not.toHaveLength(0);
  });

  it('requires an Examples table on a Scenario Outline', () => {
    const issues = lintSpec(`Feature: F
  Scenario Outline: S
    Given a <thing>
    When it happens
    Then it works
`);
    expect(issues.some((i) => i.message.includes('Examples:'))).toBe(true);
  });

  it('accepts a Scenario Outline that has one', () => {
    const issues = lintSpec(`Feature: F
  Scenario Outline: S
    Given a <thing>
    When it happens
    Then it works
    Examples:
      | thing |
      | cat   |
`);
    expect(hasErrors(issues)).toBe(false);
  });

  it('flags a scenario with no name', () => {
    expect(hasErrors(lintSpec('Feature: F\n  Scenario:\n    Given a\n    When b\n    Then c\n'))).toBe(true);
  });

  it('warns about placeholder text left behind', () => {
    const issues = lintSpec(GOOD.replace('a registered user', 'TODO decide'));
    expect(issues.some((i) => i.level === 'warn' && i.message.includes('placeholder'))).toBe(true);
  });

  it('reports issues in line order', () => {
    const issues = lintSpec('Scenario:\n  Given a\n');
    expect(issues.map((i) => i.line)).toEqual([...issues.map((i) => i.line)].sort((a, b) => a - b));
  });
});
