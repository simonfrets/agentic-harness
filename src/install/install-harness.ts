import { HARNESS_PATHS, harnessPath } from "../harness/layout.js";
import { readPackageVersion } from "../harness/package-version.js";
import { resolveProjectRoot } from "../harness/resolve-project-root.js";
import type { CommandRunner } from "../processes/command-runner.js";
import { writeFileAtomic } from "./atomic-write.js";
import {
  listHarnessTemplateFiles,
  readHarnessTemplateFile,
} from "./harness-templates.js";
import {
  INSTALL_MANIFEST_VERSION,
  writeInstallManifest,
  readInstallManifest,
} from "./install-manifest.js";
import type { ManagedFileEntry } from "./install-manifest.js";
import { planInstallation } from "./plan-installation.js";
import type {
  InstallationPlan,
  PlannedFileSource,
} from "./plan-installation.js";
import {
  buildRuntimePackageManifest,
  installRuntimeDependencies,
} from "./runtime-dependencies.js";

const MANAGED_FILE_MODE = 0o644;

export interface InstallHarnessOptions {
  readonly cwd: string;
  /** Root of the installed `agentic-harness` package; resolved by the bin entry. */
  readonly packageRootDirectory: string;
  readonly runner: CommandRunner;
  readonly now: () => Date;
  readonly update: boolean;
  /** Set false to write the files without resolving the private tree. */
  readonly installDependencies?: boolean;
}

export interface InstallHarnessResult {
  readonly projectRoot: string;
  readonly harnessVersion: string;
  readonly created: readonly string[];
  readonly replaced: readonly string[];
  readonly kept: readonly string[];
  readonly orphaned: readonly string[];
  readonly dependenciesInstalled: boolean;
}

const collect = (plan: InstallationPlan, action: string): readonly string[] =>
  plan.files.filter((file) => file.action === action).map((file) => file.path);

/**
 * Installs, or updates, the harness inside the project that owns `cwd`.
 *
 * The order is deliberate. Files are written first, then the manifest, then
 * the private dependency tree. Writing the manifest before the dependencies
 * means an install interrupted by a failing `npm install` leaves a project the
 * harness still recognises as its own, so re-running repairs it instead of
 * reporting every file it just wrote as an unmanaged conflict.
 */
export const installHarness = async (
  options: InstallHarnessOptions
): Promise<InstallHarnessResult> => {
  const projectRoot = await resolveProjectRoot({
    cwd: options.cwd,
    runner: options.runner,
  });
  const harnessVersion = readPackageVersion(options.packageRootDirectory);
  const templates = listHarnessTemplateFiles(options.packageRootDirectory);

  const desired: readonly PlannedFileSource[] = [
    ...templates.map((file) => ({
      path: file.installedPath,
      contents: readHarnessTemplateFile(options.packageRootDirectory, file),
    })),
    {
      path: HARNESS_PATHS.packageManifest,
      contents: buildRuntimePackageManifest(harnessVersion),
    },
  ];

  const previous = readInstallManifest(projectRoot);
  const plan = planInstallation({
    projectRoot,
    desired,
    manifest: previous,
    update: options.update,
  });

  for (const file of plan.files) {
    if (file.action === "keep") {
      continue;
    }

    writeFileAtomic(
      harnessPath(projectRoot, ...file.path.split("/")),
      file.contents,
      MANAGED_FILE_MODE
    );
  }

  const timestamp = options.now().toISOString();
  const managedFiles: ManagedFileEntry[] = plan.files.map((file) => ({
    path: file.path,
    sha256: file.sha256,
  }));

  writeInstallManifest(projectRoot, {
    version: INSTALL_MANIFEST_VERSION,
    harnessVersion,
    installedAt: previous?.installedAt ?? timestamp,
    updatedAt: timestamp,
    managedFiles,
  });

  const installDependencies = options.installDependencies ?? true;

  if (installDependencies) {
    await installRuntimeDependencies({
      projectRoot,
      runner: options.runner,
    });
  }

  return {
    projectRoot,
    harnessVersion,
    created: collect(plan, "create"),
    replaced: collect(plan, "replace"),
    kept: collect(plan, "keep"),
    orphaned: plan.orphaned,
    dependenciesInstalled: installDependencies,
  };
};
