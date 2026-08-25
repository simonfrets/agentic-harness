import fs from 'node:fs';
import path from 'node:path';

import { harnessPaths, findHarnessRoot } from '../../core/paths';
import { wireTooling } from '../tooling';
import { note, out, templatesDir, usage } from '../util';

interface InitOptions {
  force?: boolean;
  cwd?: string;
  /** Set false to scaffold `.harness/` only, leaving host tooling alone. */
  tooling?: boolean;
}

function copyTree(from: string, to: string, force: boolean, copied: string[], skipped: string[]): void {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      copyTree(source, target, force, copied, skipped);
      continue;
    }
    if (fs.existsSync(target) && !force) {
      skipped.push(target);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    if (source.endsWith('.sh')) fs.chmodSync(target, 0o755);
    copied.push(target);
  }
}

const SHIM = `#!/bin/sh
# Thin shim so \`.harness/bin/harness\` works from anywhere in the project.
# The real CLI lives in node_modules; this only finds it.
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
exec node "$root/node_modules/agentic-harness/dist/cli/index.js" "$@"
`;

const GITIGNORE = `# harness runtime state is machine-local
state/
locks/
logs/
metrics/
`;

/**
 * Scaffold `.harness/` into a project. Existing files are left alone unless
 * --force: init must be safe to re-run after an upgrade.
 */
export function init(options: InitOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const existing = findHarnessRoot(cwd);
  if (existing === cwd && options.force !== true) {
    note(`.harness already exists in ${cwd} -- filling in anything missing (use --force to overwrite)`);
  }

  const paths = harnessPaths(cwd);
  const templates = templatesDir();
  if (!fs.existsSync(templates)) {
    usage(`no templates directory at ${templates}`, 'the package looks incomplete -- reinstall it');
  }

  for (const dir of [paths.dir, paths.state, paths.events, paths.locks, paths.logs, paths.bin]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const copied: string[] = [];
  const skipped: string[] = [];
  copyTree(path.join(templates, 'harness'), paths.dir, options.force === true, copied, skipped);

  const shim = path.join(paths.bin, 'harness');
  fs.writeFileSync(shim, SHIM);
  fs.chmodSync(shim, 0o755);

  const ignore = path.join(paths.dir, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, GITIGNORE);

  out(`initialized ${path.relative(cwd, paths.dir) || '.harness'}`);
  out(`  ${copied.length} file(s) written`);
  if (skipped.length > 0) out(`  ${skipped.length} left untouched (already present)`);

  if (options.tooling !== false) {
    const report = wireTooling(cwd);
    if (report.wrote.length > 0) {
      out('');
      out('tooling wired:');
      for (const file of report.wrote) out(`  ${path.relative(cwd, file) || file}`);
    }
    if (report.manual.length > 0) {
      out('');
      out('still yours to do:');
      for (const item of report.manual) out(`  - ${item}`);
    }
  }

  out('');
  out('next:');
  out('  harness doctor                 # check adapters and hooks');
  out('  harness sync                   # compile agents into .claude/agents');
  out('  harness task add "<title>"     # create the first task');
}
