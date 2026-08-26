import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";

/**
 * An environment with every `GIT_*` variable removed.
 *
 * Git exports `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` to the hooks it
 * runs, and this repository's own pre-commit hook runs the whole suite. A test
 * that spawned `git init` or `git commit` with the ambient environment would
 * therefore act on *this* repository rather than on its temporary fixture.
 *
 * That is not a hypothetical: before this helper existed it rewrote this
 * branch's HEAD, created a stray branch and registered a worktree pointing
 * into a temporary directory.
 *
 * `nodeCommandRunner` is unaffected — its environment allowlist already drops
 * every `GIT_*` variable — so only tests that spawn a process themselves need
 * this.
 */
export const cleanEnvironment = (
  overrides: Readonly<Record<string, string>> = {}
): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("GIT_")) {
      environment[key] = value;
    }
  }

  return { ...environment, ...overrides };
};

/** Runs git against a fixture, never against the repository under test. */
export const runGit = (
  cwd: string,
  args: readonly string[]
): SpawnSyncReturns<string> =>
  spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: cleanEnvironment(),
  });

/**
 * Creates a repository and proves it is the one git will act on.
 *
 * The assertion is the guard: a leaked `GIT_DIR` makes this fail loudly in the
 * first line of a test instead of quietly committing a fixture into whichever
 * repository the environment happened to point at.
 */
export const initRepository = (root: string): void => {
  runGit(root, ["init", "--quiet"]);
  runGit(root, ["config", "user.email", "harness@example.invalid"]);
  runGit(root, ["config", "user.name", "Harness Test"]);

  const resolved = runGit(root, ["rev-parse", "--show-toplevel"]).stdout.trim();

  if (resolved !== root) {
    throw new Error(
      `git resolved ${root} to ${resolved}; the fixture is not the repository git would act on`
    );
  }
};
