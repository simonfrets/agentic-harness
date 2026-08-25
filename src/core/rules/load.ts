import fs from 'node:fs';
import path from 'node:path';

import { HarnessError } from '../errors';
import type { HarnessPaths } from '../paths';
import { camelizeKeys, describeZodError, parseYaml } from '../yaml';
import { ruleFrontmatterSchema, type Rule } from './schema';

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface Frontmatter {
  data: unknown;
  body: string;
}

/** Split `---` fenced YAML from the markdown that follows it. */
export function parseFrontmatter(text: string, source: string): Frontmatter {
  const match = FENCE.exec(text);
  if (match === null) {
    throw new HarnessError(
      'RULE_INVALID',
      `${source} has no --- frontmatter block`,
      'a rule starts with a --- fenced YAML header declaring at least an id',
    );
  }
  return {
    data: parseYaml(match[1] ?? '', source, 'RULE_INVALID'),
    body: text.slice(match[0].length),
  };
}

function loadRule(file: string, rulesDir: string): Rule {
  const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'), file);
  const parsed = ruleFrontmatterSchema.safeParse(camelizeKeys(data ?? {}));
  if (!parsed.success) {
    throw new HarnessError('RULE_INVALID', `${file} failed validation`, describeZodError(parsed.error));
  }

  const expected = path.basename(file, path.extname(file));
  if (parsed.data.id !== expected) {
    throw new HarnessError(
      'RULE_INVALID',
      `${file} declares id "${parsed.data.id}" but is filed as "${expected}"`,
      'the filename is the rule id -- rename one of them',
    );
  }

  return {
    ...parsed.data,
    body,
    checkPath: parsed.data.check === undefined ? undefined : path.resolve(rulesDir, parsed.data.check),
    file,
  };
}

export function loadRules(paths: HarnessPaths): Rule[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(paths.rules);
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.endsWith('.md'))
    .sort()
    .map((entry) => loadRule(path.join(paths.rules, entry), paths.rules));
}

export function rulesFor(rules: Rule[], agent: string): Rule[] {
  return rules.filter((rule) => rule.appliesTo.includes('*') || rule.appliesTo.includes(agent));
}

/** Rules that can actually fail a handoff: blocking, and with something to run. */
export function blockingRulesFor(rules: Rule[], agent: string): Rule[] {
  return rulesFor(rules, agent).filter(
    (rule) => rule.enforcement === 'blocking' && rule.checkPath !== undefined,
  );
}
