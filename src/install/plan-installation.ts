import { readFileSync } from "node:fs";

import { HarnessError } from "../harness/harness-error.js";
import { HARNESS_DIRECTORY, harnessPath } from "../harness/layout.js";
import { compareCodeUnits } from "../rules/hash-rule-set.js";
import type { HarnessTemplateFile } from "./harness-templates.js";
import { hashManagedFile } from "./install-manifest.js";
import type { InstallManifest } from "./install-manifest.js";

export const INSTALL_ACTIONS = ["create", "keep", "replace"] as const;
export type InstallAction = (typeof INSTALL_ACTIONS)[number];

export interface PlannedFile {
  /** Path relative to the `.harness` directory, with `/` separators. */
  readonly path: string;
  readonly action: InstallAction;
  readonly contents: string;
  readonly sha256: string;
}

export interface InstallationPlan {
  readonly files: readonly PlannedFile[];
  /**
   * Files the previous install managed that this version no longer ships.
   *
   * They are reported rather than deleted. Removing a file from a project is
   * exactly the irreversible act this installer refuses to perform on its own,
   * and a stale managed file is harmless where a wrongly deleted one is not.
   */
  readonly orphaned: readonly string[];
}

export interface PlanInstallationInput {
  readonly projectRoot: string;
  /** Managed content keyed by path relative to `.harness`, already rendered. */
  readonly desired: readonly PlannedFileSource[];
  readonly manifest: InstallManifest | null;
  readonly update: boolean;
}

export interface PlannedFileSource {
  readonly path: string;
  readonly contents: string;
}

/** Renders a template file into the content the installer intends to write. */
export const toPlannedFileSource = (
  file: HarnessTemplateFile,
  contents: string
): PlannedFileSource => ({ path: file.installedPath, contents });

const readIfPresent = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/**
 * Decides what installing would do to each managed file, without touching disk.
 *
 * Every conflict in the project is collected before any is raised, so a person
 * resolving a half-adopted installation sees the whole list once instead of
 * discovering the next one on every re-run. Nothing is written until the plan
 * is conflict-free, which is what makes `harness init` safe to attempt.
 */
export const planInstallation = (
  input: PlanInstallationInput
): InstallationPlan => {
  const managed = new Map(
    (input.manifest?.managedFiles ?? []).map((entry) => [
      entry.path,
      entry.sha256,
    ])
  );
  const files: PlannedFile[] = [];
  const conflicts: string[] = [];

  for (const source of input.desired) {
    const absolute = harnessPath(input.projectRoot, ...source.path.split("/"));
    const existing = readIfPresent(absolute);
    const sha256 = hashManagedFile(source.contents);
    const where = `${HARNESS_DIRECTORY}/${source.path}`;
    const plan = (action: InstallAction): void => {
      files.push({
        path: source.path,
        action,
        contents: source.contents,
        sha256,
      });
    };

    if (existing === null) {
      plan("create");
      continue;
    }

    if (existing === source.contents) {
      plan("keep");
      continue;
    }

    const recorded = managed.get(source.path);

    if (recorded === undefined) {
      conflicts.push(
        `${where} already exists and was not installed by the harness`
      );
      continue;
    }

    if (hashManagedFile(existing) !== recorded) {
      conflicts.push(
        `${where} was changed after it was installed; move your version aside to accept the shipped one`
      );
      continue;
    }

    if (!input.update) {
      conflicts.push(`${where} is out of date; re-run with \`--update\``);
      continue;
    }

    plan("replace");
  }

  if (conflicts.length > 0) {
    throw new HarnessError(
      "unsafe-overwrite",
      `installing would overwrite ${String(conflicts.length)} file(s) the harness does not own`,
      conflicts
    );
  }

  const desired = new Set(input.desired.map((source) => source.path));

  return {
    files,
    orphaned: [...managed.keys()]
      .filter((path) => !desired.has(path))
      .sort(compareCodeUnits),
  };
};
