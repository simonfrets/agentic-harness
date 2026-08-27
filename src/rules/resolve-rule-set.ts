import { hashRuleSet, compareCodeUnits } from "./hash-rule-set.js";
import { RuleResolutionError } from "./rule-error.js";
import type { Rule, RuleBundle } from "./rule-schema.js";

/**
 * Rule sources in ascending precedence. A later origin may replace a rule from
 * an earlier one, but only by declaring `overrides: true`.
 */
export const RULE_ORIGIN_PRECEDENCE = [
  "builtin",
  "project",
  "agent",
  "task",
] as const;

export type RuleOrigin = (typeof RULE_ORIGIN_PRECEDENCE)[number];

export interface RuleSource {
  readonly origin: RuleOrigin;
  readonly bundle: RuleBundle;
  /** Diagnostics only. Never contributes to the rule-set hash. */
  readonly location: string;
}

export interface ResolvedRule extends Rule {
  readonly origin: RuleOrigin;
  readonly bundleId: string;
}

export interface ResolvedRuleSet {
  readonly revision: 1;
  /** Sorted by rule id, so iteration order never depends on input order. */
  readonly rules: readonly ResolvedRule[];
  readonly sha256: string;
}

const precedenceOf = (origin: RuleOrigin): number =>
  RULE_ORIGIN_PRECEDENCE.indexOf(origin);

/**
 * Layers rule bundles into one effective rule set.
 *
 * Sources are folded in precedence order regardless of the order they were
 * given, so resolution is deterministic. A duplicate rule id is an error unless
 * the higher-precedence rule opts in with `overrides: true`; two rules with the
 * same id at the same precedence are always an error, because nothing
 * distinguishes which was meant to win.
 */
export const resolveRuleSet = (
  sources: readonly RuleSource[]
): ResolvedRuleSet => {
  const ordered = [...sources].sort(
    (a, b) => precedenceOf(a.origin) - precedenceOf(b.origin)
  );
  const byId = new Map<string, ResolvedRule>();

  for (const source of ordered) {
    for (const rule of source.bundle.rules) {
      const existing = byId.get(rule.id);
      const candidate: ResolvedRule = {
        ...rule,
        origin: source.origin,
        bundleId: source.bundle.id,
      };

      if (existing === undefined) {
        byId.set(rule.id, candidate);
        continue;
      }

      const isHigherPrecedence =
        precedenceOf(source.origin) > precedenceOf(existing.origin);

      if (!isHigherPrecedence || !rule.overrides) {
        throw new RuleResolutionError(rule.id, [
          existing.origin,
          source.origin,
        ]);
      }

      byId.set(rule.id, candidate);
    }
  }

  const rules = [...byId.values()].sort((a, b) => compareCodeUnits(a.id, b.id));

  return { revision: 1, rules, sha256: hashRuleSet(rules) };
};
