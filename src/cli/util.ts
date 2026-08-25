import path from 'node:path';

import { loadConfig } from '../core/config/load';
import type { HarnessConfig } from '../core/config/schema';
import { HarnessError } from '../core/errors';
import { harnessPaths, requireHarnessRoot, type HarnessPaths } from '../core/paths';
import { loadRules } from '../core/rules/load';
import type { Rule } from '../core/rules/schema';

export { runtimeDir } from '../core/paths';

export interface Session {
  root: string;
  paths: HarnessPaths;
  config: HarnessConfig;
  rules: Rule[];
}

/** Resolve the project's harness once, so every command sees the same view. */
export function session(cwd = process.cwd()): Session {
  const root = requireHarnessRoot(cwd);
  const paths = harnessPaths(root);
  return { root, paths, config: loadConfig(paths), rules: loadRules(paths) };
}

export function templatesDir(): string {
  return path.resolve(__dirname, '..', '..', 'templates');
}

export function usage(message: string, detail?: string): never {
  throw new HarnessError('USAGE', message, detail);
}

export function out(line = ''): void {
  process.stdout.write(`${line}\n`);
}

export function note(line = ''): void {
  process.stderr.write(`${line}\n`);
}
