export interface RuleSourceLocation {
  readonly line: number;
  readonly column: number;
}

export interface RuleIssue {
  /** Dotted path to the offending node, for example `rules.0.checks.1.script`. */
  readonly path: string;
  readonly message: string;
  /** Resolved from the YAML document; `null` when no node could be located. */
  readonly location: RuleSourceLocation | null;
}

/** Renders one issue in the `file:line:column: message` form editors linkify. */
export const formatRuleIssue = (source: string, issue: RuleIssue): string => {
  const where =
    issue.location === null
      ? source
      : `${source}:${String(issue.location.line)}:${String(issue.location.column)}`;
  const at = issue.path === "" ? "" : ` (at ${issue.path})`;

  return `${where}: ${issue.message}${at}`;
};

export const formatRuleIssues = (
  source: string,
  issues: readonly RuleIssue[]
): string => issues.map((issue) => formatRuleIssue(source, issue)).join("\n");

/**
 * Raised when a rule bundle cannot be parsed or does not satisfy the schema.
 *
 * Every issue found in the file is carried, so `harness rules validate` can
 * report a whole file in one pass instead of one problem per run.
 */
export class RuleValidationError extends Error {
  public readonly source: string;
  public readonly issues: readonly RuleIssue[];

  public constructor(source: string, issues: readonly RuleIssue[]) {
    super(
      `${source}: invalid rule bundle\n${formatRuleIssues(source, issues)}`
    );
    this.name = "RuleValidationError";
    this.source = source;
    this.issues = issues;
  }
}
