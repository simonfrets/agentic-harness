import fs from 'node:fs';
import path from 'node:path';

import { HarnessError } from '../errors';

/**
 * CRAP = complexity² × (1 − coverage)³ + complexity.
 *
 * It is the metric that stops "add tests" and "reduce complexity" being traded
 * off against each other: a hairy function can only get a good score by being
 * both simpler and better covered.
 *
 * Istanbul's coverage report carries no cyclomatic complexity, so complexity is
 * approximated as 1 + the number of branch points inside the function. That is
 * exact for the common cases (if/else, ternary, logical short-circuit) and close
 * enough elsewhere to rank work correctly.
 */
export interface CrapEntry {
  file: string;
  fn: string;
  line: number;
  complexity: number;
  coverage: number;
  crap: number;
}

interface Loc {
  start: { line: number };
  end: { line: number };
}

interface FileCoverage {
  path: string;
  fnMap: Record<string, { name: string; decl?: Loc; loc?: Loc }>;
  f: Record<string, number>;
  branchMap: Record<string, { loc?: Loc; locations?: Loc[] }>;
  b: Record<string, number[]>;
  statementMap: Record<string, Loc>;
  s: Record<string, number>;
}

export function crapScore(complexity: number, coverage: number): number {
  const uncovered = 1 - Math.min(Math.max(coverage, 0), 1);
  return complexity ** 2 * uncovered ** 3 + complexity;
}

function within(loc: Loc | undefined, range: Loc): boolean {
  if (loc === undefined) return false;
  return loc.start.line >= range.start.line && loc.start.line <= range.end.line;
}

function analyzeFile(coverage: FileCoverage, root: string): CrapEntry[] {
  const entries: CrapEntry[] = [];

  for (const [id, fn] of Object.entries(coverage.fnMap)) {
    const range = fn.loc ?? fn.decl;
    if (range === undefined) continue;

    let complexity = 1;
    for (const [branchId, branch] of Object.entries(coverage.branchMap)) {
      const loc = branch.loc ?? branch.locations?.[0];
      if (!within(loc, range)) continue;
      // Each additional path through a branch adds one to complexity.
      complexity += Math.max((coverage.b[branchId]?.length ?? 2) - 1, 1);
    }

    let total = 0;
    let covered = 0;
    for (const [statementId, loc] of Object.entries(coverage.statementMap)) {
      if (!within(loc, range)) continue;
      total += 1;
      if ((coverage.s[statementId] ?? 0) > 0) covered += 1;
    }

    // A function never entered is uncovered even if it contains no statements.
    const called = (coverage.f[id] ?? 0) > 0;
    const ratio = total === 0 ? (called ? 1 : 0) : covered / total;

    entries.push({
      file: path.relative(root, coverage.path),
      fn: fn.name || '(anonymous)',
      line: range.start.line,
      complexity,
      coverage: ratio,
      crap: crapScore(complexity, ratio),
    });
  }

  return entries;
}

export function readCoverage(file: string): Record<string, FileCoverage> {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new HarnessError(
      'USAGE',
      `no coverage report at ${file}`,
      'run your test suite with coverage first (npm run test:cov)',
    );
  }
  try {
    return JSON.parse(text) as Record<string, FileCoverage>;
  } catch (err) {
    throw new HarnessError('USAGE', `${file} is not valid JSON`, (err as Error).message);
  }
}

/** Every function, worst CRAP first. */
export function crapReport(coverageFile: string, root: string): CrapEntry[] {
  const report = readCoverage(coverageFile);
  return Object.values(report)
    .flatMap((file) => analyzeFile(file, root))
    .sort((a, b) => b.crap - a.crap);
}
