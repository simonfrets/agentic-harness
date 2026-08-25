import { join } from "node:path";

/**
 * The single directory an installed harness owns inside a host project.
 *
 * Everything the harness writes lives here, with one deliberate exception:
 * the repository-local `core.hooksPath` git setting, which cannot live inside
 * a directory git is being told to look at.
 */
export const HARNESS_DIRECTORY = ".harness";

/**
 * Paths of the managed layout, relative to the harness directory.
 *
 * They are collected here rather than spelled out at each use site so the
 * installer, the doctor, the hook dispatchers and the CLI cannot drift into
 * disagreeing about where a file lives.
 */
export const HARNESS_PATHS = {
  agents: "agents",
  bin: "bin",
  config: "config",
  customRules: join("rules", "custom"),
  gitignore: ".gitignore",
  hooks: "hooks",
  launcher: join("bin", "harness"),
  manifest: "version.json",
  packageManifest: "package.json",
  projectConfig: join("config", "project.yaml"),
  rules: "rules",
  runtime: "runtime",
  state: "state",
} as const;

/** Resolves a path inside a project's harness directory. */
export const harnessPath = (
  projectRoot: string,
  ...segments: readonly string[]
): string => join(projectRoot, HARNESS_DIRECTORY, ...segments);
