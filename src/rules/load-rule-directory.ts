import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { compareCodeUnits } from "./hash-rule-set.js";
import { loadRuleBundle } from "./load-rule-bundle.js";
import type { RuleOrigin, RuleSource } from "./resolve-rule-set.js";

const RULE_FILE_PATTERN = /\.ya?ml$/;

export interface LoadRuleDirectoryOptions {
  /** Absolute path of the directory to read. */
  readonly directory: string;
  readonly origin: RuleOrigin;
  /** Display prefix used in diagnostics, so no machine path is ever reported. */
  readonly label: string;
}

/**
 * Loads every rule bundle in one directory.
 *
 * The read is shallow: `rules/` and `rules/custom/` are two distinct
 * precedence layers, so recursing would silently merge them. Files are sorted
 * by name before parsing, which keeps the resulting source order — and
 * therefore every diagnostic — independent of directory iteration order.
 *
 * A directory that does not exist yields no sources rather than an error: a
 * project with no custom rules is normal, and refusing to start would be a
 * false failure.
 */
export const loadRuleDirectory = (
  options: LoadRuleDirectoryOptions
): readonly RuleSource[] => {
  let entries: readonly string[];

  try {
    entries = readdirSync(options.directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && RULE_FILE_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort(compareCodeUnits);
  } catch {
    return [];
  }

  return entries.map((name) => ({
    origin: options.origin,
    bundle: loadRuleBundle(
      readFileSync(join(options.directory, name), "utf8"),
      {
        source: `${options.label}/${name}`,
      }
    ),
    location: `${options.label}/${name}`,
  }));
};
