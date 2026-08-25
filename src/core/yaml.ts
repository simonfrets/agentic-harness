import fs from 'node:fs';

import YAML from 'yaml';
import type { TypeOf, ZodError, ZodTypeAny } from 'zod';

import { HarnessError, type HarnessErrorCode } from './errors';

export function describeZodError(err: ZodError): string {
  return err.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}

/**
 * YAML files use snake_case because that is what reads naturally in config;
 * TypeScript uses camelCase. Normalising keys on the way in lets both sides
 * keep their own idiom instead of leaking one into the other.
 */
export function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelizeKeys);
  if (value === null || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const camel = key.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
    out[camel] = camelizeKeys(item);
  }
  return out;
}

export function parseYaml(text: string, source: string, code: HarnessErrorCode): unknown {
  try {
    return YAML.parse(text);
  } catch (err) {
    throw new HarnessError(code, `${source} is not valid YAML`, (err as Error).message);
  }
}

/** Parse + camelize + validate in one step, with a stable error code. */
export function parseYamlWith<S extends ZodTypeAny>(
  text: string,
  schema: S,
  source: string,
  code: HarnessErrorCode,
): TypeOf<S> {
  const raw = camelizeKeys(parseYaml(text, source, code) ?? {});
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HarnessError(code, `${source} failed validation`, describeZodError(parsed.error));
  }
  return parsed.data as TypeOf<S>;
}

export function readYamlWith<S extends ZodTypeAny>(
  file: string,
  schema: S,
  code: HarnessErrorCode,
): TypeOf<S> {
  return parseYamlWith(fs.readFileSync(file, 'utf8'), schema, file, code);
}
