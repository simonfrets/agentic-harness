import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { loadHooksConfig } from "../config/hooks-config.js";
import type { HooksConfig } from "../config/hooks-config.js";
import { loadProjectConfig } from "../config/project-config.js";
import { describeFailure } from "../harness/harness-error.js";
import {
  HARNESS_DIRECTORY,
  HARNESS_GIT_HOOKS_PATH,
  HARNESS_PATHS,
  harnessPath,
} from "../harness/layout.js";
import { loadHarnessRuleSet } from "../harness/load-harness-rule-set.js";
import { readPackageVersion } from "../harness/package-version.js";
import { describeCommandResult } from "../processes/command-runner.js";
import type { CommandRunner } from "../processes/command-runner.js";
import { readInstallManifest } from "./install-manifest.js";
import { HARNESS_PACKAGE_NAME } from "./runtime-dependencies.js";

const TOOL_TIMEOUT_MS = 10_000;

/**
 * The Node version the harness needs, kept beside the check that enforces it.
 * A test asserts it still matches `engines.node`, so the two cannot drift.
 */
export const REQUIRED_NODE_VERSION = "22.22.1";

/**
 * External programs the harness runs. Each is probed with its own version
 * flag rather than assumed present: a missing `bash` fails a git hook at the
 * worst possible moment, and a diagnosis is the cheap place to find out.
 */
export const REQUIRED_TOOLS = [
  { id: "npm", title: "npm", executable: "npm", args: ["--version"] },
  { id: "git", title: "Git", executable: "git", args: ["--version"] },
  { id: "bash", title: "Bash", executable: "bash", args: ["--version"] },
] as const;

export const DIAGNOSTIC_STATUSES = ["ok", "warning", "problem"] as const;
export type DiagnosticStatus = (typeof DIAGNOSTIC_STATUSES)[number];

export interface Diagnostic {
  readonly id: string;
  readonly title: string;
  readonly status: DiagnosticStatus;
  /** One printable explanation. May span lines; always populated. */
  readonly detail: string;
}

export interface HarnessDiagnosis {
  readonly projectRoot: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly problemCount: number;
  readonly warningCount: number;
  /** False when at least one diagnostic is a problem. Warnings do not count. */
  readonly healthy: boolean;
}

export interface DiagnoseHarnessOptions {
  readonly projectRoot: string;
  readonly runner: CommandRunner;
  /** The Node runtime executing the harness, as `process.versions.node`. */
  readonly nodeVersion: string;
  /** The version of the `agentic-harness` package that is running. */
  readonly harnessVersion: string;
}

const diagnostic = (
  id: string,
  title: string,
  status: DiagnosticStatus,
  detail: string
): Diagnostic => ({ id, title, status, detail });

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)/;

/**
 * Orders a dotted version for comparison. Returns null when the string is not
 * a version at all, which is reported rather than silently treated as zero.
 */
export const versionOrder = (version: string): number | null => {
  const match = VERSION_PATTERN.exec(version);

  if (match === null) {
    return null;
  }

  const [major = 0, minor = 0, patch = 0] = match
    .slice(1)
    .map((part) => Number.parseInt(part, 10));

  return major * 1_000_000 + minor * 1_000 + patch;
};

const diagnoseNode = (nodeVersion: string): Diagnostic => {
  const running = versionOrder(nodeVersion);
  const required = versionOrder(REQUIRED_NODE_VERSION);

  if (running === null || required === null) {
    return diagnostic(
      "node",
      "Node.js",
      "problem",
      `\`${nodeVersion}\` is not a version this check can compare against ${REQUIRED_NODE_VERSION}`
    );
  }

  return running >= required
    ? diagnostic("node", "Node.js", "ok", nodeVersion)
    : diagnostic(
        "node",
        "Node.js",
        "problem",
        `${nodeVersion} is older than the required ${REQUIRED_NODE_VERSION}`
      );
};

const diagnoseTool = async (
  tool: (typeof REQUIRED_TOOLS)[number],
  projectRoot: string,
  runner: CommandRunner
): Promise<Diagnostic> => {
  const result = await runner({
    command: { executable: tool.executable, args: [...tool.args] },
    cwd: projectRoot,
    env: null,
    timeoutMs: TOOL_TIMEOUT_MS,
  });

  if (result.outcome !== "exited" || result.exitCode !== 0) {
    return diagnostic(
      tool.id,
      tool.title,
      "problem",
      `\`${tool.executable} ${tool.args.join(" ")}\` ${describeCommandResult(result)}`
    );
  }

  // `split(sep, 1).join("")` rather than `[0] ?? ""`: it needs no fallback
  // branch that nothing could ever reach.
  const reported = result.output.stdout.trim().split("\n", 1).join("");

  return diagnostic(tool.id, tool.title, "ok", reported);
};

const readTextFile = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

const isExecutableFile = (path: string): boolean => {
  try {
    const stats = statSync(path);

    return stats.isFile() && (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
};

const diagnoseInstallation = (
  projectRoot: string,
  harnessVersion: string
): Diagnostic => {
  let installedVersion: string;

  try {
    const manifest = readInstallManifest(projectRoot);

    if (manifest === null) {
      return diagnostic(
        "installation",
        "Installation",
        "problem",
        `${HARNESS_DIRECTORY}/${HARNESS_PATHS.manifest} is missing; run \`harness init\``
      );
    }

    installedVersion = manifest.harnessVersion;
  } catch (error: unknown) {
    return diagnostic(
      "installation",
      "Installation",
      "problem",
      describeFailure(error)
    );
  }

  return installedVersion === harnessVersion
    ? diagnostic(
        "installation",
        "Installation",
        "ok",
        `installed by harness ${installedVersion}`
      )
    : diagnostic(
        "installation",
        "Installation",
        "warning",
        `installed by harness ${installedVersion}, but ${harnessVersion} is running; run \`harness init --update\``
      );
};

interface ConfigDiagnosis {
  readonly diagnostic: Diagnostic;
  /** Null when the file is missing or invalid, so the hook check can say so. */
  readonly hooks: HooksConfig | null;
}

const diagnoseConfig = (projectRoot: string): ConfigDiagnosis => {
  const problems: string[] = [];
  let hooks: HooksConfig | null = null;

  const projectSource = `${HARNESS_DIRECTORY}/${HARNESS_PATHS.projectConfig}`;
  const projectText = readTextFile(
    harnessPath(projectRoot, HARNESS_PATHS.projectConfig)
  );

  if (projectText === null) {
    problems.push(`${projectSource} is missing`);
  } else {
    try {
      loadProjectConfig(projectText, { source: projectSource });
    } catch (error: unknown) {
      problems.push(describeFailure(error));
    }
  }

  const hooksSource = `${HARNESS_DIRECTORY}/${HARNESS_PATHS.hooksConfig}`;
  const hooksText = readTextFile(
    harnessPath(projectRoot, HARNESS_PATHS.hooksConfig)
  );

  if (hooksText === null) {
    problems.push(`${hooksSource} is missing`);
  } else {
    try {
      hooks = loadHooksConfig(hooksText, { source: hooksSource });
    } catch (error: unknown) {
      problems.push(describeFailure(error));
    }
  }

  return {
    hooks,
    diagnostic:
      problems.length === 0
        ? diagnostic(
            "config",
            "Configuration",
            "ok",
            `${projectSource} and ${hooksSource} are valid`
          )
        : diagnostic("config", "Configuration", "problem", problems.join("\n")),
  };
};

const diagnoseRules = (projectRoot: string): Diagnostic => {
  try {
    const ruleSet = loadHarnessRuleSet({ projectRoot });

    return diagnostic(
      "rules",
      "Rules",
      "ok",
      `${String(ruleSet.rules.length)} rule(s) resolved, sha256 ${ruleSet.sha256}`
    );
  } catch (error: unknown) {
    return diagnostic("rules", "Rules", "problem", describeFailure(error));
  }
};

const diagnoseRuntime = (projectRoot: string): Diagnostic => {
  const title = "Runtime dependencies";

  if (
    readTextFile(harnessPath(projectRoot, HARNESS_PATHS.packageManifest)) ===
    null
  ) {
    return diagnostic(
      "runtime",
      title,
      "problem",
      `${HARNESS_DIRECTORY}/${HARNESS_PATHS.packageManifest} is missing; run \`harness init\``
    );
  }

  const installed = harnessPath(
    projectRoot,
    "node_modules",
    HARNESS_PACKAGE_NAME
  );

  if (readTextFile(join(installed, "package.json")) === null) {
    return diagnostic(
      "runtime",
      title,
      "problem",
      `${HARNESS_PACKAGE_NAME} is not resolved in ${HARNESS_DIRECTORY}/node_modules; run \`harness init\``
    );
  }

  try {
    return diagnostic(
      "runtime",
      title,
      "ok",
      `${HARNESS_PACKAGE_NAME} ${readPackageVersion(installed)} is resolved in ${HARNESS_DIRECTORY}/node_modules`
    );
  } catch (error: unknown) {
    return diagnostic("runtime", title, "problem", describeFailure(error));
  }
};

const diagnoseHooks = (
  projectRoot: string,
  hooks: HooksConfig | null,
  gitHooksPath: string | null
): Diagnostic => {
  const title = "Git hooks";

  if (hooks === null) {
    return diagnostic(
      "hooks",
      title,
      "warning",
      `hook dispatch cannot be checked while ${HARNESS_DIRECTORY}/${HARNESS_PATHS.hooksConfig} is unreadable`
    );
  }

  const managed = hooks.hooks.filter((entry) => entry.enabled);

  if (managed.length === 0) {
    return diagnostic("hooks", title, "ok", "no git hook is managed");
  }

  if (gitHooksPath !== HARNESS_GIT_HOOKS_PATH) {
    return diagnostic(
      "hooks",
      title,
      "warning",
      gitHooksPath === null
        ? `git runs its own hooks: \`core.hooksPath\` is unset, so no harness gate runs on commit`
        : `git dispatches hooks through \`${gitHooksPath}\`, not \`${HARNESS_GIT_HOOKS_PATH}\``
    );
  }

  const unreachable = managed
    .map((entry) => entry.hook)
    .filter(
      (hook) =>
        !isExecutableFile(harnessPath(projectRoot, HARNESS_PATHS.hooks, hook))
    );

  return unreachable.length === 0
    ? diagnostic(
        "hooks",
        title,
        "ok",
        `git dispatches ${managed.map((entry) => `${entry.hook} (${entry.phase})`).join(", ")} through ${HARNESS_GIT_HOOKS_PATH}`
      )
    : diagnostic(
        "hooks",
        title,
        "problem",
        `\`core.hooksPath\` is ${HARNESS_GIT_HOOKS_PATH} but ${unreachable.join(", ")} is missing or not executable; run \`harness init\``
      );
};

const readGitHooksPath = async (
  projectRoot: string,
  runner: CommandRunner
): Promise<string | null> => {
  const result = await runner({
    command: {
      executable: "git",
      args: ["config", "--local", "--get", "core.hooksPath"],
    },
    cwd: projectRoot,
    env: null,
    timeoutMs: TOOL_TIMEOUT_MS,
  });

  // git exits non-zero when the key is unset, which is not an error here.
  const value =
    result.outcome === "exited" && result.exitCode === 0
      ? result.output.stdout.trim()
      : "";

  return value === "" ? null : value;
};

/**
 * Reports whether an installed harness can actually run.
 *
 * Every check runs even after one fails, because someone repairing an
 * installation should see the whole list once rather than fix one thing, re-run
 * and discover the next. Nothing here writes, installs or repairs: a diagnosis
 * that changed the thing it was diagnosing could not be trusted twice.
 */
export const diagnoseHarness = async (
  options: DiagnoseHarnessOptions
): Promise<HarnessDiagnosis> => {
  const { projectRoot, runner } = options;
  const tools: Diagnostic[] = [];

  for (const tool of REQUIRED_TOOLS) {
    tools.push(await diagnoseTool(tool, projectRoot, runner));
  }

  const config = diagnoseConfig(projectRoot);
  const gitHooksPath = await readGitHooksPath(projectRoot, runner);

  const diagnostics: readonly Diagnostic[] = [
    diagnoseNode(options.nodeVersion),
    ...tools,
    diagnoseInstallation(projectRoot, options.harnessVersion),
    config.diagnostic,
    diagnoseRules(projectRoot),
    diagnoseRuntime(projectRoot),
    diagnoseHooks(projectRoot, config.hooks, gitHooksPath),
  ];

  const problemCount = diagnostics.filter(
    (entry) => entry.status === "problem"
  ).length;

  return {
    projectRoot,
    diagnostics,
    problemCount,
    warningCount: diagnostics.filter((entry) => entry.status === "warning")
      .length,
    healthy: problemCount === 0,
  };
};
