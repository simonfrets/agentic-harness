import { existsSync } from "node:fs";

import { loadRuleDirectory } from "../rules/load-rule-directory.js";
import { resolveRuleSet } from "../rules/resolve-rule-set.js";
import type { ResolvedRuleSet, RuleSource } from "../rules/resolve-rule-set.js";
import { HarnessError } from "./harness-error.js";
import { HARNESS_DIRECTORY, HARNESS_PATHS, harnessPath } from "./layout.js";

export interface LoadHarnessRuleSetOptions {
  readonly projectRoot: string;
}

/**
 * Loads the effective rule set of an installed project.
 *
 * The two directories are two precedence layers, not one flattened pile.
 * Bundles the installer manages are the `builtin` layer; a project's own
 * bundles in `rules/custom/` are the `project` layer and therefore may replace
 * a shipped rule by declaring `overrides: true`. That is what lets a project
 * change both its compiled agent policy and its gates by editing YAML alone.
 */
export const loadHarnessRuleSet = (
  options: LoadHarnessRuleSetOptions
): ResolvedRuleSet => {
  const rulesDirectory = harnessPath(options.projectRoot, HARNESS_PATHS.rules);

  if (!existsSync(rulesDirectory)) {
    throw new HarnessError(
      "not-installed",
      `${HARNESS_DIRECTORY} is not installed in this project (no ${HARNESS_DIRECTORY}/${HARNESS_PATHS.rules} directory); run \`harness init\``
    );
  }

  const sources: readonly RuleSource[] = [
    ...loadRuleDirectory({
      directory: rulesDirectory,
      origin: "builtin",
      label: `${HARNESS_DIRECTORY}/${HARNESS_PATHS.rules}`,
    }),
    ...loadRuleDirectory({
      directory: harnessPath(options.projectRoot, HARNESS_PATHS.customRules),
      origin: "project",
      label: `${HARNESS_DIRECTORY}/${HARNESS_PATHS.customRules}`,
    }),
  ];

  if (sources.length === 0) {
    throw new HarnessError(
      "invalid-config",
      `no rule bundles were found in ${HARNESS_DIRECTORY}/${HARNESS_PATHS.rules}`
    );
  }

  return resolveRuleSet(sources);
};
