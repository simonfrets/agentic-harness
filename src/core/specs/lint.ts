/**
 * Structural lint for Gherkin. v1 treats `.feature` files as the accepted
 * contract rather than something a runner executes, so this checks that a spec
 * is complete enough for the coder and QA to translate -- not that it runs.
 */
export interface SpecIssue {
  line: number;
  level: 'error' | 'warn';
  message: string;
}

const SCENARIO = /^\s*(Scenario Outline|Scenario Template|Scenario|Example):/;
const STEP = /^\s*(Given|When|Then|And|But)\b/;
const PLACEHOLDER = /\b(TODO|TBD|FIXME|\?\?\?)\b/;

interface Block {
  line: number;
  header: string;
  steps: string[];
  hasExamples: boolean;
}

export function lintSpec(text: string): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const rows = text.split('\n');

  if (!rows.some((row) => /^\s*Feature:/.test(row))) {
    issues.push({ line: 1, level: 'error', message: 'no `Feature:` line' });
  }

  const blocks: Block[] = [];
  for (const [index, row] of rows.entries()) {
    const line = index + 1;
    const scenario = SCENARIO.exec(row);
    if (scenario) {
      blocks.push({ line, header: scenario[1] ?? 'Scenario', steps: [], hasExamples: false });
      if (row.split(':').slice(1).join(':').trim() === '') {
        issues.push({ line, level: 'error', message: 'scenario has no name' });
      }
      continue;
    }

    const current = blocks.at(-1);
    if (current === undefined) continue;
    if (/^\s*(Examples|Scenarios):/.test(row)) current.hasExamples = true;
    const step = STEP.exec(row);
    if (step?.[1] !== undefined) current.steps.push(step[1]);
  }

  if (blocks.length === 0) {
    issues.push({ line: 1, level: 'error', message: 'no scenarios' });
  }

  for (const block of blocks) {
    const keywords = new Set(block.steps);
    for (const required of ['Given', 'When', 'Then'] as const) {
      if (!keywords.has(required)) {
        issues.push({
          line: block.line,
          level: required === 'Given' ? 'warn' : 'error',
          message: `scenario has no \`${required}\` step`,
        });
      }
    }
    if (block.header.startsWith('Scenario Outline') && !block.hasExamples) {
      issues.push({ line: block.line, level: 'error', message: 'Scenario Outline has no `Examples:` table' });
    }
  }

  for (const [index, row] of rows.entries()) {
    if (PLACEHOLDER.test(row)) {
      issues.push({ line: index + 1, level: 'warn', message: 'placeholder text left in the spec' });
    }
  }

  return issues.sort((a, b) => a.line - b.line);
}

export function hasErrors(issues: SpecIssue[]): boolean {
  return issues.some((issue) => issue.level === 'error');
}
