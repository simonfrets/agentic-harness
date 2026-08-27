import {
  RULE_SET_HASH_VERSION,
  canonicalStringify,
  compareCodeUnits,
  hashRuleSet,
  normalizeText,
} from "../../../src/rules/hash-rule-set.js";
import { loadRuleBundle } from "../../../src/rules/load-rule-bundle.js";
import type { Rule } from "../../../src/rules/rule-schema.js";

const rulesOf = (yaml: string): readonly Rule[] =>
  loadRuleBundle(yaml, { source: "test.yaml" }).rules;

const BUNDLE = `version: 1
id: base
description: Baseline
rules:
  - id: base.tests
    description: Tests pass
    severity: error
    appliesTo: [coder, cleaner]
    scopes: ["src/**", "tests/**"]
    instruction: Keep the suite green.
    checks:
      - id: native-test
        runner: project-script
        script: test
        phases: [pre-handoff, pre-commit]
`;

describe("compareCodeUnits", () => {
  it("orders by UTF-16 code unit, not by locale", () => {
    const dotted = ["İ", "I", "i", "ı"];

    expect([...dotted].sort(compareCodeUnits)).toEqual(["I", "i", "İ", "ı"]);
    expect(compareCodeUnits("a", "a")).toBe(0);
  });

  it("differs from a locale-aware comparison, which is why it exists", () => {
    const dotted = ["İ", "I", "i", "ı"];

    expect([...dotted].sort((a, b) => a.localeCompare(b, "tr"))).not.toEqual(
      [...dotted].sort(compareCodeUnits)
    );
  });
});

describe("normalizeText", () => {
  it("normalises line endings, trailing whitespace, and Unicode form", () => {
    expect(normalizeText("a  \r\nb\t\r\n")).toBe("a\nb");
    expect(normalizeText("é")).toBe("é");
    expect(normalizeText("  padded  ")).toBe("padded");
  });
});

describe("canonicalStringify", () => {
  it("sorts object keys so authored order cannot affect the output", () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalStringify({ a: { d: 1, c: 2 } })).toBe(
      '{"a":{"c":2,"d":1}}'
    );
  });

  it("preserves array order, which is semantic", () => {
    expect(canonicalStringify(["b", "a"])).toBe('["b","a"]');
  });

  it("renders primitives and null", () => {
    expect(canonicalStringify(null)).toBe("null");
    expect(canonicalStringify(true)).toBe("true");
    expect(canonicalStringify(7)).toBe("7");
    expect(canonicalStringify("x")).toBe('"x"');
  });
});

describe("hashRuleSet", () => {
  it("produces a stable digest for a fixed rule set", () => {
    const hash = hashRuleSet(rulesOf(BUNDLE));

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Pinned. Updating this value requires bumping RULE_SET_HASH_VERSION.
    expect(hash).toBe(
      "24cf75751d9436d75c7c967a1a41679ef67fbd1e67da647834e7b1d4e993ba5b"
    );
  });

  it("ignores rule order", () => {
    const rules = rulesOf(`version: 1
id: base
description: Baseline
rules:
  - id: a.one
    description: One
    severity: error
    appliesTo: [coder]
    instruction: One.
  - id: b.two
    description: Two
    severity: error
    appliesTo: [coder]
    instruction: Two.
`);

    expect(hashRuleSet(rules)).toBe(hashRuleSet([...rules].reverse()));
  });

  it("ignores the order of agents, scopes, and phases", () => {
    const forward = rulesOf(BUNDLE);
    const shuffled = rulesOf(
      BUNDLE.replace("[coder, cleaner]", "[cleaner, coder]")
        .replace('["src/**", "tests/**"]', '["tests/**", "src/**"]')
        .replace("[pre-handoff, pre-commit]", "[pre-commit, pre-handoff]")
    );

    expect(hashRuleSet(shuffled)).toBe(hashRuleSet(forward));
  });

  it("changes when a single character of an instruction changes", () => {
    const changed = rulesOf(
      BUNDLE.replace("Keep the suite green.", "Keep the suite green!")
    );

    expect(hashRuleSet(changed)).not.toBe(hashRuleSet(rulesOf(BUNDLE)));
  });

  it("changes when a check timeout changes", () => {
    const changed = rulesOf(
      BUNDLE.replace(
        "phases: [pre-handoff, pre-commit]",
        "phases: [pre-handoff, pre-commit]\n        timeoutMs: 60000"
      )
    );

    expect(hashRuleSet(changed)).not.toBe(hashRuleSet(rulesOf(BUNDLE)));
  });

  it("does not change when only the bundle id or description changes", () => {
    const renamed = rulesOf(
      BUNDLE.replace("id: base\n", "id: renamed\n").replace(
        "description: Baseline",
        "description: A different summary"
      )
    );

    expect(hashRuleSet(renamed)).toBe(hashRuleSet(rulesOf(BUNDLE)));
  });

  it("does not change when only the overrides directive changes", () => {
    const overriding = rulesOf(
      BUNDLE.replace(
        "    instruction: Keep the suite green.",
        "    overrides: true\n    instruction: Keep the suite green."
      )
    );

    expect(hashRuleSet(overriding)).toBe(hashRuleSet(rulesOf(BUNDLE)));
  });

  it("distinguishes a command check by its argument order", () => {
    const template = `version: 1
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
        argv: [ARGV]
        phases: [pre-push]
`;

    expect(
      hashRuleSet(rulesOf(template.replace("ARGV", '"npm", "audit"')))
    ).not.toBe(
      hashRuleSet(rulesOf(template.replace("ARGV", '"audit", "npm"')))
    );
  });

  it("declares the hash version it produced", () => {
    expect(RULE_SET_HASH_VERSION).toBe(1);
  });
});
