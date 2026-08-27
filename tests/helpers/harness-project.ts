import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createTempDirectory } from "./temp-directory.js";

export interface HarnessProjectFixture {
  /** Written to the project's own package.json. Omit for no manifest. */
  readonly manifest?: Record<string, unknown>;
  /** Bundles under `.harness/rules`, keyed by file name. */
  readonly rules?: Readonly<Record<string, string>>;
  /** Bundles under `.harness/rules/custom`, keyed by file name. */
  readonly customRules?: Readonly<Record<string, string>>;
  /** Any other file, keyed by path relative to the project root. */
  readonly files?: Readonly<Record<string, string>>;
}

const writeFile = (root: string, path: string, contents: string): void => {
  const absolute = join(root, path);

  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
};

/** Materialises a project that already has a `.harness` rules tree. */
export const buildHarnessProject = (
  fixture: HarnessProjectFixture = {}
): string => {
  const root = createTempDirectory("agentic-harness-installed-");

  if (fixture.manifest !== undefined) {
    writeFile(
      root,
      "package.json",
      `${JSON.stringify(fixture.manifest, null, 2)}\n`
    );
  }

  for (const [name, contents] of Object.entries(fixture.rules ?? {})) {
    writeFile(root, join(".harness", "rules", name), contents);
  }

  for (const [name, contents] of Object.entries(fixture.customRules ?? {})) {
    writeFile(root, join(".harness", "rules", "custom", name), contents);
  }

  for (const [path, contents] of Object.entries(fixture.files ?? {})) {
    writeFile(root, path, contents);
  }

  return root;
};
