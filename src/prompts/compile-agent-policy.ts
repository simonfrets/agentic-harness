import type { AgentId } from "../agents/agent-id.js";
import type {
  ResolvedRule,
  ResolvedRuleSet,
} from "../rules/resolve-rule-set.js";
import { PHASES } from "../rules/rule-schema.js";
import type { Phase, RuleCheck } from "../rules/rule-schema.js";

export interface CompileAgentPolicyInput {
  readonly agentId: AgentId;
  readonly ruleSet: ResolvedRuleSet;
}

const HEADING_OR_QUOTE = /^(\s*)(#{1,6}\s|>|\||-\s|\d+\.\s)/;

/**
 * Renders rule text as a block quote with structural markers escaped, so a rule
 * that contains Markdown control characters cannot forge a heading, a list, or
 * a table row in the compiled policy.
 */
const quoteRuleText = (text: string): string =>
  text
    .split("\n")
    .map((line) => {
      if (line.trim() === "") {
        return ">";
      }

      return `> ${line.replace(HEADING_OR_QUOTE, "$1\\$2")}`;
    })
    .join("\n");

/** Escapes a value for a table cell, where a pipe or newline would break the row. */
const escapeCell = (text: string): string =>
  text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

const inlineCode = (text: string): string => `\`${escapeCell(text)}\``;

const formatScopes = (rule: ResolvedRule): string =>
  rule.scopes.length === 0
    ? "the whole project"
    : rule.scopes.map(inlineCode).join(", ");

/**
 * Describes a check without naming a package manager or a provider CLI flag.
 * Resolution to a concrete argument vector needs a project profile and belongs
 * to the gate runner, not to the prompt.
 */
const describeCheck = (check: RuleCheck): string => {
  switch (check.runner) {
    case "project-script":
      return `project script ${inlineCode(check.script)}`;
    case "command":
      return inlineCode(check.argv.join(" "));
  }
};

const renderRuleSection = (rule: ResolvedRule): string =>
  [
    `### ${rule.id}`,
    "",
    rule.description,
    "",
    `Applies to: ${formatScopes(rule)}`,
    "",
    quoteRuleText(rule.instruction),
  ].join("\n");

const renderRuleGroup = (
  title: string,
  rules: readonly ResolvedRule[],
  emptyNote: string
): readonly string[] => [
  `## ${title}`,
  "",
  ...(rules.length === 0
    ? [emptyNote]
    : rules.map(renderRuleSection).join("\n\n").split("\n")),
];

interface PhaseCheck {
  readonly rule: ResolvedRule;
  readonly check: RuleCheck;
}

const renderPhaseTable = (
  entries: readonly PhaseCheck[]
): readonly string[] => [
  "| Check | Rule | Required | Command |",
  "| --- | --- | --- | --- |",
  ...entries.map(
    ({ rule, check }) =>
      `| ${inlineCode(check.id)} | ${inlineCode(rule.id)} | ${
        check.required ? "yes" : "no"
      } | ${describeCheck(check)} |`
  ),
];

const renderGates = (rules: readonly ResolvedRule[]): readonly string[] => {
  const lines: string[] = ["## Verification gates", ""];
  const byPhase = PHASES.map((phase: Phase) => ({
    phase,
    entries: rules.flatMap((rule) =>
      rule.checks
        .filter((check) => check.phases.includes(phase))
        .map((check) => ({ rule, check }))
    ),
  })).filter(({ entries }) => entries.length > 0);

  if (byPhase.length === 0) {
    lines.push("No executable checks apply to this agent.");

    return lines;
  }

  for (const { phase, entries } of byPhase) {
    lines.push(`### ${phase}`, "", ...renderPhaseTable(entries), "");
  }

  lines.pop();

  return lines;
};

/**
 * Compiles a resolved rule set into the policy document for one agent.
 *
 * The output is provider-neutral: it names no Codex or Claude CLI flag, and it
 * contains no filesystem path, so the same rule set produces the same document
 * on any machine. Only rules that apply to the agent are emitted.
 */
export const compileAgentPolicy = (input: CompileAgentPolicyInput): string => {
  const applicable = input.ruleSet.rules.filter((rule) =>
    rule.appliesTo.includes(input.agentId)
  );

  const sections = [
    `# Agent policy: ${input.agentId}`,
    "",
    `Rule set revision ${String(input.ruleSet.revision)}, SHA-256 \`${
      input.ruleSet.sha256
    }\`.`,
    "",
    "Required checks block handoff. A failing required check is not advisory: the handoff is rejected until the check passes.",
    "",
    ...renderRuleGroup(
      "Mandatory rules",
      applicable.filter((rule) => rule.severity === "error"),
      "No mandatory rules apply to this agent."
    ),
    "",
    ...renderRuleGroup(
      "Advisory rules",
      applicable.filter((rule) => rule.severity === "warning"),
      "No advisory rules apply to this agent."
    ),
    "",
    ...renderGates(applicable),
  ];

  return `${sections.join("\n")}\n`;
};
