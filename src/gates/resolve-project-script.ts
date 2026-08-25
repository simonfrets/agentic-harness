import type { CommandSpec } from "../processes/command-runner.js";
import type { PackageManager } from "../project/project-profile-schema.js";
import type {
  MissingScriptBehaviour,
  ProjectScriptName,
} from "../rules/rule-schema.js";

export type ProjectScriptResolution =
  | { readonly kind: "resolved"; readonly command: CommandSpec }
  | {
      readonly kind: "missing";
      readonly behaviour: MissingScriptBehaviour;
      readonly available: readonly ProjectScriptName[];
    };

/**
 * Builds the argument vector that runs a package script.
 *
 * Every manager gets an explicit `run`. Bare `yarn <script>` is avoided because
 * in Yarn Classic a script named `install`, `add`, or `link` collides with a
 * built-in subcommand and would silently run the wrong thing.
 *
 * npm needs `--` to forward arguments to the script; pnpm, Yarn and Bun pass
 * them through directly and warn about a stray separator.
 */
export const buildPackageManagerCommand = (
  packageManager: PackageManager,
  script: ProjectScriptName,
  args: readonly string[]
): CommandSpec => {
  switch (packageManager) {
    case "npm":
      return {
        executable: "npm",
        args:
          args.length > 0 ? ["run", script, "--", ...args] : ["run", script],
      };
    case "pnpm":
      return { executable: "pnpm", args: ["run", script, ...args] };
    case "yarn":
      return { executable: "yarn", args: ["run", script, ...args] };
    case "bun":
      return { executable: "bun", args: ["run", script, ...args] };
  }
};

export interface ResolveProjectScriptInput {
  readonly packageManager: PackageManager;
  readonly script: ProjectScriptName;
  readonly args: readonly string[];
  readonly availableScripts: readonly ProjectScriptName[];
  readonly whenMissing: MissingScriptBehaviour;
}

/**
 * Resolves a semantic script name against a project.
 *
 * A script the project does not define is reported as missing rather than
 * attempted, so the gate reports the real reason instead of a spawn failure.
 */
export const resolveProjectScript = (
  input: ResolveProjectScriptInput
): ProjectScriptResolution => {
  if (!input.availableScripts.includes(input.script)) {
    return {
      kind: "missing",
      behaviour: input.whenMissing,
      available: input.availableScripts,
    };
  }

  return {
    kind: "resolved",
    command: buildPackageManagerCommand(
      input.packageManager,
      input.script,
      input.args
    ),
  };
};
