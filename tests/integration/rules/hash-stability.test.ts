import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { loadRuleBundle } from "../../../src/rules/load-rule-bundle.js";
import { resolveRuleSet } from "../../../src/rules/resolve-rule-set.js";
import {
  createTempDirectory,
  removeTempDirectories,
} from "../../helpers/temp-directory.js";

/**
 * The same logical rule set, written two different ways.
 *
 * The second form differs in every way that must not matter: key order, comment
 * presence, quoting style, flow versus block sequences, block-scalar chomping
 * (`>` versus `>-`), indentation, trailing blank lines, and (applied at write
 * time) a byte order mark with CRLF line endings.
 *
 * Note that a literal block (`|-`) would not belong here: it preserves the line
 * break where a folded block turns it into a space, so the two instructions
 * would genuinely differ in content and *should* hash differently.
 */
const LAYOUT_A = `version: 1
id: typescript
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

const LAYOUT_B = `# Reformatted copy of the same rules.
rules:
  - severity: error
    checks:
      - phases:
          - pre-commit
          - pre-handoff
        timeoutMs: 120000
        whenMissing: "fail"
        script: "lint"
        runner: "project-script"
        required: true
        id: "native-lint"
    instruction: >-
      Do not introduce explicit any. Use a concrete type, generic,
      discriminated union, or unknown with narrowing.
    scopes:
      - "**/*.tsx"
      - "**/*.ts"
    appliesTo:
      - hardener
      - cleaner
      - coder
    description: Reject new explicit any types
    id: typescript.no-explicit-any

description: TypeScript correctness rules
id: typescript
version: 1


`;

const hashFromDirectory = (directory: string, contents: string): string => {
  const path = join(directory, "typescript.yaml");

  writeFileSync(path, contents);

  const bundle = loadRuleBundle(readFileSync(path, "utf8"), {
    source: relative(directory, path),
  });

  return resolveRuleSet([{ origin: "project", bundle, location: path }]).sha256;
};

afterEach(() => {
  removeTempDirectories();
});

describe("rule-set hash stability", () => {
  it("is identical for the same rules written two ways in two directories", () => {
    const directoryA = createTempDirectory("agentic-harness-rules-a-");
    const directoryB = createTempDirectory("agentic-harness-rules-b-");

    const hashA = hashFromDirectory(directoryA, LAYOUT_A);
    const hashB = hashFromDirectory(
      directoryB,
      `\u{FEFF}${LAYOUT_B.replace(/\n/g, "\r\n")}`
    );

    expect(directoryA).not.toBe(directoryB);
    expect(hashB).toBe(hashA);
  });

  it("never embeds a path from either directory in the digest", () => {
    const directory = createTempDirectory("agentic-harness-rules-c-");
    const hash = hashFromDirectory(directory, LAYOUT_A);

    expect(hash).not.toContain(directory);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("still differs when the rules genuinely differ", () => {
    const directoryA = createTempDirectory("agentic-harness-rules-d-");
    const directoryB = createTempDirectory("agentic-harness-rules-e-");

    const hashA = hashFromDirectory(directoryA, LAYOUT_A);
    const hashB = hashFromDirectory(
      directoryB,
      LAYOUT_A.replace("severity: error", "severity: warning")
    );

    expect(hashB).not.toBe(hashA);
  });
});
