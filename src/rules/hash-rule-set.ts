import { createHash } from "node:crypto";

import type { Rule, RuleCheck } from "./rule-schema.js";

export interface CanonicalObject {
  readonly [key: string]: CanonicalValue;
}

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | CanonicalObject;

/**
 * Bumping this invalidates every stored hash, so it is deliberately explicit:
 * a change to canonicalisation must be a visible, test-breaking act.
 */
export const RULE_SET_HASH_VERSION = 1;

/**
 * Compares by UTF-16 code unit.
 *
 * `String.prototype.localeCompare` is not used anywhere in rule hashing: it
 * orders dotted identifiers differently under a Turkish locale, and its ICU
 * data varies between Node builds, so it would make the hash machine-dependent.
 */
export const compareCodeUnits = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

const sortStrings = (values: readonly string[]): readonly string[] =>
  [...values].sort(compareCodeUnits);

/**
 * Normalises free text so that visually identical instructions hash identically
 * regardless of editor, checkout settings, or YAML block-scalar chomping.
 */
export const normalizeText = (text: string): string =>
  text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .trim();

export const canonicalStringify = (value: CanonicalValue): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }

  const entries = Object.entries(value as CanonicalObject);
  const rendered = entries
    .sort(([a], [b]) => compareCodeUnits(a, b))
    .map(
      ([key, member]) => `${JSON.stringify(key)}:${canonicalStringify(member)}`
    );

  return `{${rendered.join(",")}}`;
};

const canonicalCheck = (check: RuleCheck): CanonicalValue => {
  const shared = {
    id: check.id,
    phases: sortStrings(check.phases),
    required: check.required,
    runner: check.runner,
    timeoutMs: check.timeoutMs,
  };

  switch (check.runner) {
    case "project-script":
      return {
        ...shared,
        // Argument order is semantic, so it is never sorted.
        args: check.args,
        script: check.script,
        whenMissing: check.whenMissing,
      };
    case "command":
      return { ...shared, argv: check.argv, cwd: check.cwd };
  }
};

/**
 * Reduces a rule to the content that decides what it *means*.
 *
 * `overrides` is a resolution directive rather than semantic content, and the
 * originating bundle id, source path, and file layout are all excluded, so a
 * rule set reorganised across differently named files keeps the same hash.
 */
export const canonicalRule = (rule: Rule): CanonicalValue => ({
  appliesTo: sortStrings(rule.appliesTo),
  checks: [...rule.checks]
    .sort((a, b) => compareCodeUnits(a.id, b.id))
    .map(canonicalCheck),
  description: normalizeText(rule.description),
  id: rule.id,
  instruction: normalizeText(rule.instruction),
  scopes: sortStrings(rule.scopes),
  severity: rule.severity,
});

export const canonicalRuleSet = (rules: readonly Rule[]): CanonicalValue => ({
  hashVersion: RULE_SET_HASH_VERSION,
  rules: [...rules]
    .sort((a, b) => compareCodeUnits(a.id, b.id))
    .map(canonicalRule),
});

/**
 * Hashes the effective content of a rule set.
 *
 * The digest is a function of the resolved rules alone: no absolute path, no
 * source filename, no timestamp, and no observed key order contributes to it,
 * so the same logical rule set hashes identically on any machine.
 */
export const hashRuleSet = (rules: readonly Rule[]): string =>
  createHash("sha256")
    .update(canonicalStringify(canonicalRuleSet(rules)), "utf8")
    .digest("hex");
