import { loadRuleBundle } from "../../../src/rules/load-rule-bundle.js";
import { RuleResolutionError } from "../../../src/rules/rule-error.js";
import {
  RULE_ORIGIN_PRECEDENCE,
  resolveRuleSet,
} from "../../../src/rules/resolve-rule-set.js";
import type {
  RuleOrigin,
  RuleSource,
} from "../../../src/rules/resolve-rule-set.js";

const source = (
  origin: RuleOrigin,
  bundleId: string,
  rules: string
): RuleSource => ({
  origin,
  location: `rules/${bundleId}.yaml`,
  bundle: loadRuleBundle(
    `version: 1\nid: ${bundleId}\ndescription: ${bundleId} bundle\nrules:\n${rules}`,
    { source: `rules/${bundleId}.yaml` }
  ),
});

const rule = (
  id: string,
  instruction: string,
  extra = ""
): string => `  - id: ${id}
    description: ${id}
    severity: error
    appliesTo: [coder]
    instruction: ${instruction}
${extra}`;

const captureError = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }

  return null;
};

describe("RULE_ORIGIN_PRECEDENCE", () => {
  it("orders sources from built-in to task-local", () => {
    expect([...RULE_ORIGIN_PRECEDENCE]).toEqual([
      "builtin",
      "project",
      "agent",
      "task",
    ]);
  });
});

describe("resolveRuleSet", () => {
  it("merges distinct rules and sorts them by id", () => {
    const resolved = resolveRuleSet([
      source("project", "project", rule("b.two", "Two.")),
      source("builtin", "base", rule("a.one", "One.")),
    ]);

    expect(resolved.rules.map((entry) => entry.id)).toEqual(["a.one", "b.two"]);
    expect(resolved.revision).toBe(1);
    expect(resolved.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records the origin and bundle each rule came from", () => {
    const resolved = resolveRuleSet([
      source("builtin", "base", rule("a.one", "One.")),
    ]);

    expect(resolved.rules[0]).toMatchObject({
      origin: "builtin",
      bundleId: "base",
    });
  });

  it("resolves in precedence order regardless of the order given", () => {
    const builtin = source("builtin", "base", rule("a.one", "Base."));
    const task = source(
      "task",
      "task",
      rule("a.one", "Task.", "    overrides: true\n")
    );

    const forward = resolveRuleSet([builtin, task]);
    const reversed = resolveRuleSet([task, builtin]);

    expect(forward.rules[0]?.instruction).toBe("Task.");
    expect(forward.sha256).toBe(reversed.sha256);
  });

  it("lets a higher-precedence rule replace a lower one when it opts in", () => {
    const resolved = resolveRuleSet([
      source("builtin", "base", rule("a.one", "Base.")),
      source(
        "project",
        "project",
        rule("a.one", "Project.", "    overrides: true\n")
      ),
    ]);

    expect(resolved.rules).toHaveLength(1);
    expect(resolved.rules[0]).toMatchObject({
      instruction: "Project.",
      origin: "project",
      bundleId: "project",
    });
  });

  it("rejects an accidental duplicate that does not declare an override", () => {
    const error = captureError(() =>
      resolveRuleSet([
        source("builtin", "base", rule("a.one", "Base.")),
        source("project", "project", rule("a.one", "Project.")),
      ])
    );

    expect(error).toBeInstanceOf(RuleResolutionError);
    expect((error as RuleResolutionError).ruleId).toBe("a.one");
    expect((error as RuleResolutionError).origins).toEqual([
      "builtin",
      "project",
    ]);
    expect((error as RuleResolutionError).message).toContain("overrides: true");
  });

  it("rejects a duplicate within one precedence tier even with an override", () => {
    const error = captureError(() =>
      resolveRuleSet([
        source("project", "one", rule("a.one", "One.")),
        source(
          "project",
          "two",
          rule("a.one", "Two.", "    overrides: true\n")
        ),
      ])
    );

    expect(error).toBeInstanceOf(RuleResolutionError);
  });

  it("rejects a lower-precedence rule that tries to override a higher one", () => {
    const error = captureError(() =>
      resolveRuleSet([
        source("task", "task", rule("a.one", "Task.")),
        source(
          "builtin",
          "base",
          rule("a.one", "Base.", "    overrides: true\n")
        ),
      ])
    );

    expect(error).toBeInstanceOf(RuleResolutionError);
  });

  it("rejects a duplicate id declared twice inside one bundle", () => {
    const error = captureError(() =>
      resolveRuleSet([
        source(
          "project",
          "project",
          `${rule("a.one", "One.")}${rule("a.one", "Again.")}`
        ),
      ])
    );

    expect(error).toBeInstanceOf(RuleResolutionError);
  });

  it("hashes only the effective rules, not the sources they came from", () => {
    const viaOneBundle = resolveRuleSet([
      source(
        "project",
        "combined",
        `${rule("a.one", "One.")}${rule("b.two", "Two.")}`
      ),
    ]);
    const viaTwoBundles = resolveRuleSet([
      source("project", "first", rule("a.one", "One.")),
      source("agent", "second", rule("b.two", "Two.")),
    ]);

    expect(viaTwoBundles.sha256).toBe(viaOneBundle.sha256);
  });

  it("resolves an empty source list to an empty rule set", () => {
    const resolved = resolveRuleSet([]);

    expect(resolved.rules).toEqual([]);
    expect(resolved.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
