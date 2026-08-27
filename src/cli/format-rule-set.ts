import type {
  ResolvedRule,
  ResolvedRuleSet,
} from "../rules/resolve-rule-set.js";
import type { RuleCheck } from "../rules/rule-schema.js";

const plural = (count: number, noun: string): string =>
  `${String(count)} ${noun}${count === 1 ? "" : "s"}`;

const countChecks = (ruleSet: ResolvedRuleSet): number =>
  ruleSet.rules.reduce((total, rule) => total + rule.checks.length, 0);

/**
 * The one-paragraph answer to "did my rules load, and which rules are they?".
 *
 * The hash is included because it is what a handoff records: two machines that
 * print the same hash are running the same rules, whatever their files look
 * like.
 */
export const formatRuleSetSummary = (ruleSet: ResolvedRuleSet): string => {
  const errors = ruleSet.rules.filter(
    (rule) => rule.severity === "error"
  ).length;

  return [
    `${plural(ruleSet.rules.length, "rule")} resolved (${String(
      errors
    )} error, ${String(ruleSet.rules.length - errors)} warning)`,
    plural(countChecks(ruleSet), "executable check"),
    `Rule set: sha256 ${ruleSet.sha256}`,
    "",
  ].join("\n");
};

const describeCheck = (check: RuleCheck): string => {
  const where = check.phases.join(", ");

  switch (check.runner) {
    case "project-script":
      return `${check.id}: project script \`${check.script}\` at ${where}`;
    case "command":
      return `${check.id}: \`${check.argv.join(" ")}\` at ${where}`;
  }
};

const renderRule = (rule: ResolvedRule): readonly string[] => [
  `${rule.id} [${rule.severity}] from ${rule.origin} bundle ${rule.bundleId}`,
  `  ${rule.description}`,
  `  agents: ${rule.appliesTo.join(", ")}`,
  `  scopes: ${
    rule.scopes.length === 0 ? "the whole project" : rule.scopes.join(", ")
  }`,
  ...(rule.checks.length === 0
    ? ["  no executable checks"]
    : rule.checks.map((check) => `  ${describeCheck(check)}`)),
  "",
];

/**
 * Renders every resolved rule with the origin it came from.
 *
 * Origin is shown because layering is the part that surprises people: a rule
 * that looks wrong is usually a lower-precedence bundle being replaced by a
 * project's own `overrides: true`.
 */
export const formatRuleSetExplanation = (ruleSet: ResolvedRuleSet): string => {
  if (ruleSet.rules.length === 0) {
    return "No rules are resolved.\n";
  }

  return [
    ...ruleSet.rules.flatMap(renderRule),
    formatRuleSetSummary(ruleSet).trimEnd(),
    "",
  ].join("\n");
};
