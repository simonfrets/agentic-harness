import fs from 'node:fs';
import path from 'node:path';

import { wireTooling } from '../../src/cli/tooling';
import { cleanupTempDirs, read, tempDir, write } from '../helpers/fixture';

afterAll(cleanupTempDirs);

function project(pkg?: Record<string, unknown>): string {
  const root = tempDir('harness-host-');
  if (pkg !== undefined) write(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2));
  return root;
}

describe('wireTooling', () => {
  it('writes an eslint config when the project has none', () => {
    const root = project({ name: 'demo' });
    wireTooling(root);
    expect(fs.existsSync(path.join(root, 'eslint.config.mjs'))).toBe(true);
  });

  it('never overwrites an eslint config the project already has', () => {
    const root = project({ name: 'demo' });
    write(path.join(root, 'eslint.config.mjs'), '// mine\n');
    const report = wireTooling(root);
    expect(read(path.join(root, 'eslint.config.mjs'))).toBe('// mine\n');
    expect(report.manual.join(' ')).toMatch(/eslint/i);
  });

  it('recognises the legacy .eslintrc form as an existing config', () => {
    const root = project({ name: 'demo' });
    write(path.join(root, '.eslintrc.json'), '{}');
    wireTooling(root);
    expect(fs.existsSync(path.join(root, 'eslint.config.mjs'))).toBe(false);
  });

  it('installs both git hooks', () => {
    const root = project({ name: 'demo' });
    wireTooling(root);
    expect(read(path.join(root, '.husky', 'commit-msg'))).toContain('guard.sh');
    expect(fs.existsSync(path.join(root, '.husky', 'pre-commit'))).toBe(true);
  });

  it('appends the tdd gate to a commit-msg hook that already exists', () => {
    const root = project({ name: 'demo' });
    write(path.join(root, '.husky', 'commit-msg'), 'npx commitlint --edit "$1"\n');
    wireTooling(root);
    const hook = read(path.join(root, '.husky', 'commit-msg'));
    expect(hook).toContain('commitlint');
    expect(hook).toContain('guard.sh');
  });

  it('does not add the gate twice when re-run', () => {
    const root = project({ name: 'demo' });
    wireTooling(root);
    wireTooling(root);
    const hook = read(path.join(root, '.husky', 'commit-msg'));
    expect(hook.match(/guard\.sh/g)).toHaveLength(1);
  });

  it('adds the scripts a harness project needs, without touching existing ones', () => {
    const root = project({ name: 'demo', scripts: { test: 'vitest' } });
    wireTooling(root);
    const pkg = JSON.parse(read(path.join(root, 'package.json'))) as { scripts: Record<string, string> };
    expect(pkg.scripts['test']).toBe('vitest');
    expect(pkg.scripts['prepare']).toContain('husky');
    expect(pkg.scripts['harness']).toBeDefined();
  });

  it('registers lint-staged so the hooks have something to run', () => {
    const root = project({ name: 'demo' });
    wireTooling(root);
    const pkg = JSON.parse(read(path.join(root, 'package.json'))) as Record<string, unknown>;
    expect(pkg['lint-staged']).toBeDefined();
  });

  it('leaves a lint-staged config the project already defined alone', () => {
    const root = project({ name: 'demo', 'lint-staged': { '*.ts': ['mine'] } });
    wireTooling(root);
    const pkg = JSON.parse(read(path.join(root, 'package.json'))) as { 'lint-staged': Record<string, unknown> };
    expect(pkg['lint-staged']['*.ts']).toEqual(['mine']);
  });

  it('writes a CI workflow so enforcement survives outside developer machines', () => {
    const root = project({ name: 'demo' });
    wireTooling(root);
    expect(fs.existsSync(path.join(root, '.github', 'workflows', 'harness.yml'))).toBe(true);
  });

  it('reports what it did and what the human still has to do', () => {
    const root = project({ name: 'demo' });
    write(path.join(root, 'tsconfig.json'), '{}');
    const report = wireTooling(root);
    expect(report.wrote.length).toBeGreaterThan(0);
    expect(report.manual.join(' ')).toMatch(/tsconfig/i);
  });

  it('survives a project with no package.json', () => {
    const root = project();
    const report = wireTooling(root);
    expect(report.manual.join(' ')).toMatch(/package\.json/);
    expect(fs.existsSync(path.join(root, '.husky', 'commit-msg'))).toBe(true);
  });
});
