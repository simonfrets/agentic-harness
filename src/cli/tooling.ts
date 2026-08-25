import fs from 'node:fs';
import path from 'node:path';

import { templatesDir } from './util';

/**
 * Wire TypeScript, ESLint and the git hooks into a host project.
 *
 * The rule throughout: create what is missing, never overwrite what exists. A
 * project that already has an ESLint config is told what to add rather than
 * having its config replaced -- silently clobbering someone's setup is a far
 * worse failure than leaving a manual step.
 */
export interface ToolingReport {
  wrote: string[];
  manual: string[];
}

const ESLINT_CONFIGS = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
];

const GUARD_LINE = 'sh node_modules/agentic-harness/runtime/tdd/guard.sh --message "$1"';

const SCRIPTS: Record<string, string> = {
  prepare: 'husky',
  harness: 'harness',
  'lint:harness': 'eslint . --max-warnings 0',
  'gate:tdd': 'harness tdd ratchet',
};

const LINT_STAGED = {
  '*.{ts,tsx}': ['eslint --max-warnings 0'],
};

function templateText(name: string): string {
  return fs.readFileSync(path.join(templatesDir(), 'host', name), 'utf8');
}

function writeIfAbsent(target: string, contents: string, report: ToolingReport): boolean {
  if (fs.existsSync(target)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  report.wrote.push(target);
  return true;
}

function wireEslint(root: string, report: ToolingReport): void {
  const existing = ESLINT_CONFIGS.find((name) => fs.existsSync(path.join(root, name)));
  if (existing !== undefined) {
    report.manual.push(
      `${existing} already exists -- copy the rules from node_modules/agentic-harness/templates/host/eslint.config.mjs into it (type-aware linting is the point)`,
    );
    return;
  }
  writeIfAbsent(path.join(root, 'eslint.config.mjs'), templateText('eslint.config.mjs'), report);
}

function wireTsconfig(root: string, report: ToolingReport): void {
  const written = writeIfAbsent(
    path.join(root, 'tsconfig.harness.json'),
    templateText('tsconfig.harness.json'),
    report,
  );
  if (!written) return;

  if (fs.existsSync(path.join(root, 'tsconfig.json'))) {
    report.manual.push('add `"extends": "./tsconfig.harness.json"` to tsconfig.json for strict settings');
  } else {
    report.manual.push('no tsconfig.json -- create one extending ./tsconfig.harness.json');
  }
}

/** Hooks are appended to, never replaced: a project may already run its own. */
function wireHooks(root: string, report: ToolingReport): void {
  const husky = path.join(root, '.husky');
  writeIfAbsent(path.join(husky, 'pre-commit'), templateText('pre-commit'), report);

  const commitMsg = path.join(husky, 'commit-msg');
  if (!fs.existsSync(commitMsg)) {
    writeIfAbsent(commitMsg, templateText('commit-msg'), report);
    return;
  }

  const current = fs.readFileSync(commitMsg, 'utf8');
  if (current.includes('guard.sh')) return;

  fs.writeFileSync(commitMsg, `${current.trimEnd()}\n\n# TDD pair gate, added by harness init.\n${GUARD_LINE}\n`);
  report.wrote.push(`${commitMsg} (appended)`);
}

function wirePackage(root: string, report: ToolingReport): void {
  const file = path.join(root, 'package.json');
  if (!fs.existsSync(file)) {
    report.manual.push('no package.json -- hooks and lint scripts were not registered');
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  const scripts = (pkg['scripts'] ?? {}) as Record<string, string>;

  let changed = false;
  for (const [name, command] of Object.entries(SCRIPTS)) {
    if (scripts[name] === undefined) {
      scripts[name] = command;
      changed = true;
    }
  }
  pkg['scripts'] = scripts;

  if (pkg['lint-staged'] === undefined) {
    pkg['lint-staged'] = LINT_STAGED;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
    report.wrote.push(file);
  }

  report.manual.push('install the dev dependencies: npm i -D eslint typescript typescript-eslint husky lint-staged');
}

export function wireTooling(root: string): ToolingReport {
  const report: ToolingReport = { wrote: [], manual: [] };

  wireEslint(root, report);
  wireTsconfig(root, report);
  wireHooks(root, report);
  wirePackage(root, report);
  writeIfAbsent(
    path.join(root, '.github', 'workflows', 'harness.yml'),
    templateText('workflow.yml'),
    report,
  );

  return report;
}
