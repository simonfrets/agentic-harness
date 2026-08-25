export interface RuleYamlOptions {
  readonly bundleId: string;
  readonly ruleId: string;
  readonly severity?: "error" | "warning";
  readonly overrides?: boolean;
  readonly instruction?: string;
  readonly checks?: string;
}

/**
 * Renders a minimal valid rule bundle.
 *
 * Bundles are built as text rather than committed as fixtures because
 * `prettier --check .` runs over the whole repository, and a fixture with a
 * deliberate formatting quirk could not pass that gate.
 */
export const ruleBundleYaml = (options: RuleYamlOptions): string =>
  [
    "version: 1",
    `id: ${options.bundleId}`,
    `description: Bundle ${options.bundleId}`,
    "",
    "rules:",
    `  - id: ${options.ruleId}`,
    `    description: Rule ${options.ruleId}`,
    `    severity: ${options.severity ?? "error"}`,
    "    appliesTo: [coder]",
    `    instruction: ${options.instruction ?? "Do the right thing."}`,
    ...(options.overrides === true ? ["    overrides: true"] : []),
    ...(options.checks === undefined ? [] : [options.checks]),
    "",
  ].join("\n");

/** A `project-script` check block, indented for a rule in `ruleBundleYaml`. */
export const projectScriptCheckYaml = (options: {
  readonly checkId: string;
  readonly script: string;
  readonly phases: readonly string[];
  readonly required?: boolean;
  readonly whenMissing?: "fail" | "skip";
}): string =>
  [
    "    checks:",
    `      - id: ${options.checkId}`,
    "        runner: project-script",
    `        script: ${options.script}`,
    `        phases: [${options.phases.join(", ")}]`,
    `        required: ${String(options.required ?? true)}`,
    `        whenMissing: ${options.whenMissing ?? "fail"}`,
  ].join("\n");
