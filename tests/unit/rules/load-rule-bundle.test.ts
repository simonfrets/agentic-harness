import { loadRuleBundle } from "../../../src/rules/load-rule-bundle.js";
import { RuleValidationError } from "../../../src/rules/rule-error.js";

const SOURCE = "rules/typescript.yaml";

const load = (text: string) => loadRuleBundle(text, { source: SOURCE });

const expectFailure = (text: string): RuleValidationError => {
  try {
    load(text);
  } catch (error: unknown) {
    if (error instanceof RuleValidationError) {
      return error;
    }

    throw error;
  }

  throw new Error("expected loadRuleBundle to reject the bundle");
};

const VALID_BUNDLE = `version: 1
id: typescript-quality
description: TypeScript correctness rules

rules:
  - id: typescript.no-explicit-any
    description: Reject new explicit any types
    severity: error
    appliesTo: [coder, cleaner, hardener]
    scopes: ["**/*.ts", "**/*.tsx"]
    instruction: >
      Do not introduce explicit any. Use a concrete type, generic,
      discriminated union, or unknown with narrowing.
    checks:
      - id: native-lint
        runner: project-script
        script: lint
        phases: [pre-handoff, pre-commit]
        required: true
        whenMissing: fail
        timeoutMs: 120000
`;

describe("loadRuleBundle", () => {
  it("parses the rule contract from the handoff", () => {
    const bundle = load(VALID_BUNDLE);

    expect(bundle.id).toBe("typescript-quality");
    expect(bundle.rules).toHaveLength(1);

    const [rule] = bundle.rules;

    expect(rule?.severity).toBe("error");
    expect(rule?.appliesTo).toEqual(["coder", "cleaner", "hardener"]);
    expect(rule?.scopes).toEqual(["**/*.ts", "**/*.tsx"]);
    expect(rule?.instruction).toContain("Do not introduce explicit any.");
    expect(rule?.checks[0]).toEqual({
      id: "native-lint",
      runner: "project-script",
      script: "lint",
      args: [],
      phases: ["pre-handoff", "pre-commit"],
      required: true,
      whenMissing: "fail",
      timeoutMs: 120000,
    });
  });

  it("applies documented defaults so downstream code never needs a fallback", () => {
    const bundle = load(`version: 1
id: base
description: Baseline
rules:
  - id: base.tests
    description: Tests pass
    severity: error
    appliesTo: [coder]
    instruction: Keep the suite green.
`);

    const [rule] = bundle.rules;

    expect(rule?.scopes).toEqual([]);
    expect(rule?.checks).toEqual([]);
    expect(rule?.overrides).toBe(false);
  });

  it("defaults a project-script check to required, failing, and 120s", () => {
    const bundle = load(`version: 1
id: base
description: Baseline
rules:
  - id: base.tests
    description: Tests pass
    severity: error
    appliesTo: [coder]
    instruction: Keep the suite green.
    checks:
      - id: native-test
        runner: project-script
        script: test
        phases: [pre-handoff]
`);

    expect(bundle.rules[0]?.checks[0]).toEqual({
      id: "native-test",
      runner: "project-script",
      script: "test",
      args: [],
      phases: ["pre-handoff"],
      required: true,
      whenMissing: "fail",
      timeoutMs: 120000,
    });
  });

  it("accepts a command check as a non-empty argv tuple", () => {
    const bundle = load(`version: 1
id: base
description: Baseline
rules:
  - id: base.audit
    description: Audit dependencies
    severity: warning
    appliesTo: [architect]
    instruction: Review dependency drift.
    checks:
      - id: audit
        runner: command
        argv: ["npm", "audit", "--audit-level=high"]
        phases: [pre-push]
`);

    expect(bundle.rules[0]?.checks[0]).toEqual({
      id: "audit",
      runner: "command",
      argv: ["npm", "audit", "--audit-level=high"],
      cwd: "project-root",
      phases: ["pre-push"],
      required: true,
      timeoutMs: 120000,
    });
  });

  it("keeps shell metacharacters as literal argv entries", () => {
    const bundle = load(`version: 1
id: base
description: Baseline
rules:
  - id: base.audit
    description: Audit
    severity: error
    appliesTo: [coder]
    instruction: Audit.
    checks:
      - id: audit
        runner: command
        argv: ["node", "-e", "process.exit(0)", "; rm -rf /", "$(touch pwned)"]
        phases: [pre-push]
`);

    const check = bundle.rules[0]?.checks[0];

    expect(check?.runner).toBe("command");
    expect(check).toMatchObject({
      argv: ["node", "-e", "process.exit(0)", "; rm -rf /", "$(touch pwned)"],
    });
  });

  it("reports malformed YAML against the source file", () => {
    const error = expectFailure("version: 1\n\tid: broken\n");

    expect(error.source).toBe(SOURCE);
    expect(error.issues.length).toBeGreaterThan(0);
    expect(error.message).toContain(SOURCE);
  });

  it("rejects duplicate mapping keys rather than silently taking the last", () => {
    const error = expectFailure(`version: 1
id: base
id: other
description: Baseline
rules: []
`);

    expect(error.issues[0]?.message).toMatch(/keys must be unique/i);
  });

  it("rejects an unknown key and points at the offending node", () => {
    const error = expectFailure(`version: 1
id: base
description: Baseline
rules:
  - id: base.tests
    description: Tests pass
    sevrity: error
    appliesTo: [coder]
    instruction: Keep the suite green.
`);

    const messages = error.issues.map((issue) => issue.message).join("\n");

    expect(messages).toContain("sevrity");
    expect(error.issues[0]?.location).not.toBeNull();
  });

  it("locates an invalid severity at its exact line and column", () => {
    const error = expectFailure(`version: 1
id: base
description: Baseline
rules:
  - id: base.tests
    description: Tests pass
    severity: blocking
    appliesTo: [coder]
    instruction: Keep the suite green.
`);

    expect(error.issues).toHaveLength(1);
    expect(error.issues[0]?.path).toBe("rules.0.severity");
    expect(error.issues[0]?.location).toEqual({ line: 7, column: 15 });
  });

  it("locates a missing required field at its enclosing node", () => {
    const error = expectFailure(`version: 1
id: base
description: Baseline
rules:
  - id: base.tests
    severity: error
    appliesTo: [coder]
    instruction: Keep the suite green.
`);

    const issue = error.issues.find((candidate) =>
      candidate.path.endsWith("description")
    );

    expect(issue).toBeDefined();
    expect(issue?.location).not.toBeNull();
  });

  it("rejects an invalid agent id", () => {
    const error = expectFailure(`version: 1
id: base
description: Baseline
rules:
  - id: base.tests
    description: Tests pass
    severity: error
    appliesTo: ["Coder"]
    instruction: Keep the suite green.
`);

    expect(error.issues[0]?.path).toBe("rules.0.appliesTo.0");
  });

  it("rejects an empty argv array", () => {
    const error = expectFailure(`version: 1
id: base
description: Baseline
rules:
  - id: base.audit
    description: Audit
    severity: error
    appliesTo: [coder]
    instruction: Audit.
    checks:
      - id: audit
        runner: command
        argv: []
        phases: [pre-push]
`);

    expect(error.issues.length).toBeGreaterThan(0);
  });

  it("rejects an argv given as a shell string instead of an array", () => {
    const error = expectFailure(`version: 1
id: base
description: Baseline
rules:
  - id: base.audit
    description: Audit
    severity: error
    appliesTo: [coder]
    instruction: Audit.
    checks:
      - id: audit
        runner: command
        argv: "npm audit --audit-level=high"
        phases: [pre-push]
`);

    expect(error.issues.length).toBeGreaterThan(0);
  });

  it("rejects an unknown script name and an unknown phase", () => {
    expect(
      expectFailure(`version: 1
id: base
description: Baseline
rules:
  - id: base.tests
    description: Tests
    severity: error
    appliesTo: [coder]
    instruction: Tests.
    checks:
      - id: deploy
        runner: project-script
        script: deploy
        phases: [pre-push]
`).issues[0]?.path
    ).toBe("rules.0.checks.0.script");

    expect(
      expectFailure(`version: 1
id: base
description: Baseline
rules:
  - id: base.tests
    description: Tests
    severity: error
    appliesTo: [coder]
    instruction: Tests.
    checks:
      - id: native-test
        runner: project-script
        script: test
        phases: [post-merge]
`).issues[0]?.path
    ).toBe("rules.0.checks.0.phases.0");
  });

  it("rejects a check with no phases and a timeout below the floor", () => {
    expect(
      expectFailure(`version: 1
id: base
description: Baseline
rules:
  - id: base.tests
    description: Tests
    severity: error
    appliesTo: [coder]
    instruction: Tests.
    checks:
      - id: native-test
        runner: project-script
        script: test
        phases: []
`).issues[0]?.message
    ).toContain("at least one phase");

    expect(
      expectFailure(`version: 1
id: base
description: Baseline
rules:
  - id: base.tests
    description: Tests
    severity: error
    appliesTo: [coder]
    instruction: Tests.
    checks:
      - id: native-test
        runner: project-script
        script: test
        phases: [pre-push]
        timeoutMs: 10
`).issues.length
    ).toBeGreaterThan(0);
  });

  it("rejects an unknown check runner", () => {
    const error = expectFailure(`version: 1
id: base
description: Baseline
rules:
  - id: base.tests
    description: Tests
    severity: error
    appliesTo: [coder]
    instruction: Tests.
    checks:
      - id: builtin-check
        runner: builtin
        phases: [pre-push]
`);

    expect(error.issues.length).toBeGreaterThan(0);
  });

  it("rejects an unsupported bundle version and an empty rule list", () => {
    expect(
      expectFailure(`version: 2
id: base
description: Baseline
rules: []
`).issues.length
    ).toBeGreaterThan(0);

    expect(
      expectFailure(`version: 1
id: base
description: Baseline
rules: []
`).issues[0]?.message
    ).toContain("at least one rule");
  });

  it("reports an empty document as a schema failure at its root", () => {
    const error = expectFailure("");

    expect(error.issues.length).toBeGreaterThan(0);
    expect(error.issues[0]?.location).toBeNull();
  });

  it("locates a YAML syntax error at its exact line and column", () => {
    const error = expectFailure("version: 1\n\tid: broken\n");

    expect(error.issues[0]?.location).toEqual({ line: 2, column: 1 });
  });

  it("reads a bundle written with a byte order mark and CRLF line endings", () => {
    const bundle = load(`\u{FEFF}${VALID_BUNDLE.replace(/\n/g, "\r\n")}`);

    expect(bundle.id).toBe("typescript-quality");
  });
});
