import { chmodSync } from "node:fs";

import { loadHooksConfig } from "../config/hooks-config.js";
import { HarnessError } from "../harness/harness-error.js";
import {
  HARNESS_DIRECTORY,
  HARNESS_GIT_HOOKS_PATH,
  HARNESS_PATHS,
  harnessPath,
} from "../harness/layout.js";
import { readPackageVersion } from "../harness/package-version.js";
import { resolveProjectRoot } from "../harness/resolve-project-root.js";
import { describeCommandResult } from "../processes/command-runner.js";
import type { CommandRunner } from "../processes/command-runner.js";
import { compareCodeUnits } from "../rules/hash-rule-set.js";
import { writeFileAtomic } from "./atomic-write.js";
import { discoverHookEnvironment } from "./discover-hooks.js";
import {
  listHarnessTemplateFiles,
  readHarnessTemplateFile,
} from "./harness-templates.js";
import {
  EXECUTABLE_MODE,
  LAUNCHER_PATH,
  buildHarnessLauncher,
  buildHookDispatcher,
  hookScriptPath,
} from "./hook-scripts.js";
import {
  INSTALL_MANIFEST_VERSION,
  readInstallManifest,
  writeInstallManifest,
} from "./install-manifest.js";
import type { HookRecord, ManagedFileEntry } from "./install-manifest.js";
import { planHooks } from "./plan-hooks.js";
import { planInstallation } from "./plan-installation.js";
import type {
  InstallationPlan,
  PlannedFileSource,
} from "./plan-installation.js";
import {
  buildRuntimePackageManifest,
  installRuntimeDependencies,
} from "./runtime-dependencies.js";

const REGULAR_FILE_MODE = 0o644;
const GIT_TIMEOUT_MS = 10_000;

/**
 * The launcher and the hook dispatchers are the only managed files git or a
 * developer executes, so they are the only ones that need the executable bit.
 */
const modeFor = (path: string): number =>
  path === LAUNCHER_PATH || path.startsWith(`${HARNESS_PATHS.hooks}/`)
    ? EXECUTABLE_MODE
    : REGULAR_FILE_MODE;

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
  /** The hooks git now dispatches, and what each of them preserved. */
  readonly hooks: readonly HookRecord[];
  /** `core.hooksPath` as it was before this install, or null when unset. */
  readonly previousHooksPath: string | null;
  /** True when this install changed git's `core.hooksPath`. */
  readonly gitHooksPathChanged: boolean;
}

const collect = (plan: InstallationPlan, action: string): readonly string[] =>
  plan.files.filter((file) => file.action === action).map((file) => file.path);

const readHooksConfig = (desired: readonly PlannedFileSource[]) => {
  const source = `${HARNESS_DIRECTORY}/${HARNESS_PATHS.hooksConfig}`;
  const template = desired.find(
    (file) => file.path === HARNESS_PATHS.hooksConfig
  );

  if (template === undefined) {
    throw new HarnessError(
      "invalid-config",
      `this build of the harness ships no ${source}, so it cannot decide which git hooks to manage`
    );
  }

  return loadHooksConfig(template.contents, { source });
};

const setGitHooksPath = async (
  projectRoot: string,
  runner: CommandRunner
): Promise<void> => {
  const result = await runner({
    command: {
      executable: "git",
      args: ["config", "--local", "core.hooksPath", HARNESS_GIT_HOOKS_PATH],
    },
    cwd: projectRoot,
    env: null,
    timeoutMs: GIT_TIMEOUT_MS,
  });

  if (result.outcome !== "exited" || result.exitCode !== 0) {
    throw new HarnessError(
      "git-config-failed",
      `\`git config --local core.hooksPath ${HARNESS_GIT_HOOKS_PATH}\` ${describeCommandResult(result)}, so git still runs its own hooks`,
      result.output.stderr.trim() === ""
        ? []
        : result.output.stderr.trim().split("\n")
    );
  }
};

/**
 * Installs, or updates, the harness inside the project that owns `cwd`.
 *
 * The order is deliberate. Files are written first, then the manifest, then
 * git's hooks path, then the private dependency tree. Writing the manifest
 * before the rest means an install interrupted by a failing `npm install`
 * leaves a project the harness still recognises as its own, so re-running
 * repairs it instead of reporting every file it just wrote as an unmanaged
 * conflict — and pointing git at dispatchers that exist beats pointing it at
 * ones that do not.
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

  const managedContent: readonly PlannedFileSource[] = [
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
  const environment = await discoverHookEnvironment({
    projectRoot,
    runner: options.runner,
  });
  const dispatchers = planHooks({
    hooks: readHooksConfig(managedContent),
    environment,
    recorded: previous?.hooks ?? [],
  });

  const desired: readonly PlannedFileSource[] = [
    ...managedContent,
    ...(dispatchers.length === 0
      ? []
      : [{ path: LAUNCHER_PATH, contents: buildHarnessLauncher() }]),
    ...dispatchers.map((dispatcher) => ({
      path: hookScriptPath(dispatcher.hook),
      contents: buildHookDispatcher(dispatcher),
    })),
  ].sort((a, b) => compareCodeUnits(a.path, b.path));

  const plan = planInstallation({
    projectRoot,
    desired,
    manifest: previous,
    update: options.update,
  });

  for (const file of plan.files) {
    const absolute = harnessPath(projectRoot, ...file.path.split("/"));
    const mode = modeFor(file.path);

    if (file.action === "keep") {
      // The mode is the harness's to own, and re-applying it is what repairs
      // the hook `harness doctor` reports as present but not executable.
      chmodSync(absolute, mode);
      continue;
    }

    writeFileAtomic(absolute, file.contents, mode);
  }

  const timestamp = options.now().toISOString();
  const managedFiles: ManagedFileEntry[] = plan.files.map((file) => ({
    path: file.path,
    sha256: file.sha256,
  }));
  const hooks: HookRecord[] = dispatchers.map((dispatcher) => ({
    hook: dispatcher.hook,
    chained: dispatcher.chained,
  }));
  const previousHooksPath = environment.dispatchedByHarness
    ? (previous?.previousHooksPath ?? null)
    : environment.hooksPath;

  writeInstallManifest(projectRoot, {
    version: INSTALL_MANIFEST_VERSION,
    harnessVersion,
    installedAt: previous?.installedAt ?? timestamp,
    updatedAt: timestamp,
    managedFiles,
    hooks,
    previousHooksPath,
  });

  const gitHooksPathChanged =
    dispatchers.length > 0 && environment.hooksPath !== HARNESS_GIT_HOOKS_PATH;

  if (gitHooksPathChanged) {
    await setGitHooksPath(projectRoot, options.runner);
  }

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
    hooks,
    previousHooksPath,
    gitHooksPathChanged,
  };
};
