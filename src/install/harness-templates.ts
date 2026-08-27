import { readFileSync, readdirSync } from "node:fs";
import { join, posix, sep } from "node:path";

import { HarnessError } from "../harness/harness-error.js";
import { HARNESS_DIRECTORY } from "../harness/layout.js";
import { compareCodeUnits } from "../rules/hash-rule-set.js";

/**
 * npm removes a file named `.gitignore` from a published tarball, so the
 * template ships without the dot and is renamed as it is installed. Verified
 * against `npm pack --dry-run`, not assumed.
 */
const GITIGNORE_TEMPLATE_NAME = "gitignore";

/**
 * Templates the project owns once they exist.
 *
 * These two files carry the only decisions discovery cannot make, so they are
 * written to be edited. Reconciling them against the shipped copy would mean
 * that editing one is what stops the next `harness init` from running, which
 * makes the harness refuse to work because it was configured.
 *
 * The list is explicit rather than a `config/` prefix so that adding a template
 * is a decision about ownership rather than an accident of where it was filed.
 * A test asserts it against the shipped tree, so a path that stops existing
 * fails the build instead of silently seeding nothing.
 */
export const SEEDED_TEMPLATE_PATHS = [
  "config/hooks.yaml",
  "config/project.yaml",
] as const;

export interface HarnessTemplateFile {
  /** Path inside the template tree. */
  readonly templatePath: string;
  /** Path relative to the installed `.harness` directory. */
  readonly installedPath: string;
  /** True when the project owns this file after it is first written. */
  readonly seeded: boolean;
}

export const isSeededTemplate = (installedPath: string): boolean =>
  (SEEDED_TEMPLATE_PATHS as readonly string[]).includes(installedPath);

export const harnessTemplateRoot = (packageRootDirectory: string): string =>
  join(packageRootDirectory, "templates", HARNESS_DIRECTORY);

/** Paths are reported with `/` separators regardless of the host platform. */
const toPosix = (path: string): string => path.split(sep).join(posix.sep);

const installedPathOf = (templatePath: string): string =>
  templatePath === GITIGNORE_TEMPLATE_NAME ? ".gitignore" : templatePath;

const walk = (directory: string, prefix: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;

    return entry.isDirectory()
      ? walk(join(directory, entry.name), path)
      : [path];
  });

/**
 * Lists the files the installer copies into a project.
 *
 * The tree is walked rather than hard-coded so a template that is added to the
 * package cannot be forgotten by the installer. A test asserts the resulting
 * list, which is what turns an accidental deletion into a failure instead of a
 * silently smaller installation.
 */
export const listHarnessTemplateFiles = (
  packageRootDirectory: string
): readonly HarnessTemplateFile[] => {
  const root = harnessTemplateRoot(packageRootDirectory);
  let paths: readonly string[];

  try {
    paths = walk(root, "");
  } catch (error: unknown) {
    throw new HarnessError(
      "invalid-config",
      `the agentic-harness package at ${packageRootDirectory} has no templates directory`,
      [String(error)]
    );
  }

  return paths
    .map((path) => {
      const templatePath = toPosix(path);
      const installedPath = installedPathOf(templatePath);

      return {
        templatePath,
        installedPath,
        seeded: isSeededTemplate(installedPath),
      };
    })
    .sort((a, b) => compareCodeUnits(a.installedPath, b.installedPath));
};

export const readHarnessTemplateFile = (
  packageRootDirectory: string,
  templatePath: string
): string =>
  readFileSync(
    join(harnessTemplateRoot(packageRootDirectory), ...templatePath.split("/")),
    "utf8"
  );
