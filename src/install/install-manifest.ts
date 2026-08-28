import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";

import { writeFileAtomic } from "../harness/atomic-write.js";
import { HarnessError } from "../harness/harness-error.js";
import { HARNESS_PATHS, harnessPath } from "../harness/layout.js";

export const INSTALL_MANIFEST_VERSION = 1;
const MANIFEST_MODE = 0o644;

/**
 * Who owns a file the harness put in a project.
 *
 * A `managed` file is the harness's: it is kept in step with the template it
 * came from, and an edit to it is a conflict. A `seeded` file is written once,
 * when it is absent, and then belongs to the project — `config/project.yaml`
 * exists to be edited, so reconciling it against the template would make
 * editing it the thing that breaks the next `harness init`.
 */
export const MANAGED_FILE_KINDS = ["managed", "seeded"] as const;
export const managedFileKindSchema = z.enum(MANAGED_FILE_KINDS);

export const managedFileEntrySchema = z.strictObject({
  /** Path relative to the `.harness` directory, with `/` separators. */
  path: z.string().min(1),
  /** Hash of the content on disk after the install that recorded it. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /**
   * Defaults to `managed` so a manifest written before seeding existed still
   * parses. Nothing reads it to decide an outcome: ownership is a property of
   * the shipped template, which is what migrates an older installation.
   */
  kind: managedFileKindSchema.default("managed"),
});

/** What the manifest remembers about one hook the harness took over. */
export const hookRecordSchema = z.strictObject({
  hook: z.string().min(1),
  /**
   * The preserved hook this dispatcher runs first, or null when the project
   * had none. Relative to the project root when it lives inside it, so the
   * record means the same thing on every machine that checks the project out.
   */
  chained: z.string().min(1).nullable(),
});

/**
 * The record of what the harness installed and what it looked like.
 *
 * Without the hashes, `--update` could not tell a file the harness wrote from
 * one a project deliberately changed, and would have to either overwrite local
 * work or never update anything.
 */
export const installManifestSchema = z.strictObject({
  version: z.literal(INSTALL_MANIFEST_VERSION),
  harnessVersion: z.string().min(1),
  installedAt: z.string().min(1),
  updatedAt: z.string().min(1),
  managedFiles: z.array(managedFileEntrySchema),
  /**
   * Once `core.hooksPath` points at the harness, the dispatchers are the only
   * hooks git can see. These two fields are therefore the only surviving
   * record of what the project had before, and a re-install reads them rather
   * than inspecting its own output and concluding there was never anything.
   */
  hooks: z.array(hookRecordSchema).default([]),
  previousHooksPath: z.string().min(1).nullable().default(null),
});

export type ManagedFileKind = z.output<typeof managedFileKindSchema>;
export type ManagedFileEntry = z.output<typeof managedFileEntrySchema>;
export type HookRecord = z.output<typeof hookRecordSchema>;
export type InstallManifest = z.output<typeof installManifestSchema>;

/**
 * Hashes one managed file's content.
 *
 * The hash is over the bytes as written, with no normalisation: an installed
 * file that differs from the template only by line ending was still changed by
 * something, and an installer that shrugged at that could not tell a checkout
 * setting from a deliberate edit.
 */
export const hashManagedFile = (contents: string): string =>
  createHash("sha256").update(contents, "utf8").digest("hex");

const manifestPath = (projectRoot: string): string =>
  harnessPath(projectRoot, HARNESS_PATHS.manifest);

/** Returns null when the harness has never been installed in this project. */
export const readInstallManifest = (
  projectRoot: string
): InstallManifest | null => {
  const path = manifestPath(projectRoot);
  let text: string;

  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    throw new HarnessError(
      "invalid-config",
      `${HARNESS_PATHS.manifest} is not valid JSON`,
      [String(error)]
    );
  }

  const result = installManifestSchema.safeParse(parsed);

  if (!result.success) {
    throw new HarnessError(
      "invalid-config",
      `${HARNESS_PATHS.manifest} is not a valid harness manifest`,
      result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`
      )
    );
  }

  return result.data;
};

export const writeInstallManifest = (
  projectRoot: string,
  manifest: InstallManifest
): void => {
  writeFileAtomic(
    manifestPath(projectRoot),
    `${JSON.stringify(manifest, null, 2)}\n`,
    MANIFEST_MODE
  );
};
