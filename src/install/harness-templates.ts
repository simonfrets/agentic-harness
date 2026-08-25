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

export interface HarnessTemplateFile {
  /** Path inside the template tree. */
  readonly templatePath: string;
  /** Path relative to the installed `.harness` directory. */
  readonly installedPath: string;
}

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
    .map((templatePath) => ({
      templatePath: toPosix(templatePath),
      installedPath: installedPathOf(toPosix(templatePath)),
    }))
    .sort((a, b) => compareCodeUnits(a.installedPath, b.installedPath));
};

export const readHarnessTemplateFile = (
  packageRootDirectory: string,
  file: HarnessTemplateFile
): string =>
  readFileSync(
    join(
      harnessTemplateRoot(packageRootDirectory),
      ...file.templatePath.split("/")
    ),
    "utf8"
  );
