import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { HarnessError } from "../../../src/harness/harness-error.js";
import { installHarness } from "../../../src/install/install-harness.js";
import type { InstallHarnessResult } from "../../../src/install/install-harness.js";
import { readInstallManifest } from "../../../src/install/install-manifest.js";
import { nodeCommandRunner } from "../../../src/processes/node-command-runner.js";
import { captureRejection } from "../../helpers/expect-error.js";
import { cleanEnvironment, initRepository, runGit } from "../../helpers/git.js";
import {
  createTempDirectory,
  removeTempDirectories,
} from "../../helpers/temp-directory.js";

afterEach(() => {
  removeTempDirectories();
});

const packageRoot = process.cwd();

const git = runGit;

const write = (
  root: string,
  path: string,
  contents: string,
  mode = 0o644
): string => {
  const absolute = join(root, ...path.split("/"));

  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
  chmodSync(absolute, mode);

  return absolute;
};

/**
 * A hook that records that it ran, so chaining can be observed. It writes to
 * the working tree root, which is the directory git runs every hook from.
 */
const recordingHook = (marker: string, exitCode = 0): string =>
  [
    "#!/usr/bin/env bash",
    `printf '%s %s\\n' "${marker}" "$*" >> "\${PWD}/ran.log"`,
    `exit ${String(exitCode)}`,
    "",
  ].join("\n");

const buildRepository = (): string => {
  const root = createTempDirectory("agentic-harness-hooks-");

  initRepository(root);
  write(root, "package.json", '{ "name": "host", "version": "1.0.0" }\n');

  return root;
};

const install = async (
  root: string,
  cwd = root
): Promise<InstallHarnessResult> =>
  installHarness({
    cwd,
    packageRootDirectory: packageRoot,
    runner: nodeCommandRunner,
    now: () => new Date("2026-08-26T00:00:00.000Z"),
    update: false,
    installDependencies: false,
  });

/**
 * Stands in for the runtime `npm install` would have resolved. It reports the
 * arguments the launcher passed it, which is how a test sees which gate ran.
 */
const fakeRuntime = (root: string): void => {
  write(
    root,
    ".harness/node_modules/agentic-harness/dist/cli/index.js",
    [
      "const args = process.argv.slice(2).join(' ');",
      "process.stdout.write(`harness ${args}\\n`);",
      "process.exitCode = Number(process.env.HARNESS_FAKE_EXIT ?? 0);",
      "",
    ].join("\n")
  );
};

const runHook = (
  root: string,
  hook: string,
  options: {
    readonly args?: readonly string[];
    readonly exitCode?: string;
    readonly stdin?: string;
  } = {}
): SpawnSyncReturns<string> =>
  spawnSync(
    "bash",
    [join(root, ".harness", "hooks", hook), ...(options.args ?? [])],
    {
      cwd: root,
      encoding: "utf8",
      input: options.stdin ?? "",
      env: cleanEnvironment(
        options.exitCode === undefined
          ? {}
          : { HARNESS_FAKE_EXIT: options.exitCode }
      ),
    }
  );

const ranLog = (root: string): string => {
  try {
    return readFileSync(join(root, "ran.log"), "utf8");
  } catch {
    return "";
  }
};

const hooksPathOf = (root: string): string =>
  git(root, ["config", "--local", "--get", "core.hooksPath"]).stdout.trim();

describe("hook dispatch with no prior hook", () => {
  it("points git at the harness with a relative path", async () => {
    const root = buildRepository();
    const result = await install(root);

    // Relative, because git resolves it against the working tree it is run
    // in, which is the only value that is correct in every worktree.
    expect(hooksPathOf(root)).toBe(".harness/hooks");
    expect(result.gitHooksPathChanged).toBe(true);
    expect(result.previousHooksPath).toBeNull();
    expect(result.hooks).toEqual([
      { hook: "pre-commit", chained: null },
      { hook: "pre-push", chained: null },
    ]);
  });

  it("runs the phase gate for the hook git invoked", async () => {
    const root = buildRepository();

    await install(root);
    fakeRuntime(root);

    expect(runHook(root, "pre-commit")).toMatchObject({
      status: 0,
      stdout: "harness gate pre-commit\n",
    });
    expect(runHook(root, "pre-push")).toMatchObject({
      status: 0,
      stdout: "harness gate pre-push\n",
    });
  });

  it("blocks a real commit when the gate fails", async () => {
    const root = buildRepository();

    await install(root);
    fakeRuntime(root);
    git(root, ["add", "."]);

    const blocked = git(root, ["commit", "-m", "blocked"], {
      HARNESS_FAKE_EXIT: "4",
    });

    expect(blocked.status).not.toBe(0);
    expect(`${blocked.stdout}${blocked.stderr}`).toContain(
      "harness gate pre-commit"
    );

    const allowed = git(root, ["commit", "-m", "allowed"], {
      HARNESS_FAKE_EXIT: "0",
    });

    expect(allowed.status).toBe(0);
  });

  it("refuses to run before the runtime is installed, rather than silently passing", async () => {
    const root = buildRepository();

    await install(root);

    const result = runHook(root, "pre-commit");

    expect(result.status).toBe(3);
    expect(result.stderr).toContain("the harness runtime is not installed");
  });
});

describe("hook dispatch over an existing hook", () => {
  it("chains a hook git ran from its own directory", async () => {
    const root = buildRepository();

    write(root, ".git/hooks/pre-commit", recordingHook("project"), 0o755);

    const result = await install(root);

    fakeRuntime(root);

    expect(result.hooks).toContainEqual({
      hook: "pre-commit",
      chained: ".git/hooks/pre-commit",
    });
    expect(runHook(root, "pre-commit").stdout).toBe(
      "harness gate pre-commit\n"
    );
    expect(ranLog(root)).toContain("project");
  });

  it("chains a hook behind a relative core.hooksPath", async () => {
    const root = buildRepository();

    write(root, ".husky/pre-commit", recordingHook("husky"), 0o755);
    git(root, ["config", "--local", "core.hooksPath", ".husky"]);

    const result = await install(root);

    fakeRuntime(root);

    expect(result.previousHooksPath).toBe(".husky");
    expect(result.hooks).toContainEqual({
      hook: "pre-commit",
      chained: ".husky/pre-commit",
    });
    expect(runHook(root, "pre-commit").status).toBe(0);
    expect(ranLog(root)).toContain("husky");
  });

  it("chains a hook behind an absolute core.hooksPath", async () => {
    const root = buildRepository();
    const elsewhere = createTempDirectory("agentic-harness-external-hooks-");

    writeFileSync(
      join(elsewhere, "pre-commit"),
      "#!/usr/bin/env bash\nexit 0\n"
    );
    chmodSync(join(elsewhere, "pre-commit"), 0o755);
    git(root, ["config", "--local", "core.hooksPath", elsewhere]);

    const result = await install(root);

    expect(result.hooks).toContainEqual({
      hook: "pre-commit",
      chained: join(elsewhere, "pre-commit"),
    });
    expect(
      readFileSync(join(root, ".harness", "hooks", "pre-commit"), "utf8")
    ).toContain(`previous_hook="${join(elsewhere, "pre-commit")}"`);
  });

  it("stops at a failing prior hook and never reaches the gate", async () => {
    const root = buildRepository();

    write(root, ".git/hooks/pre-commit", recordingHook("project", 9), 0o755);

    await install(root);
    fakeRuntime(root);

    const result = runHook(root, "pre-commit");

    expect(result.status).toBe(9);
    expect(result.stdout).toBe("");
    expect(ranLog(root)).toContain("project");
  });

  it("reports the gate's own exit code when the prior hook passed", async () => {
    const root = buildRepository();

    write(root, ".git/hooks/pre-commit", recordingHook("project"), 0o755);

    await install(root);
    fakeRuntime(root);

    expect(runHook(root, "pre-commit", { exitCode: "4" }).status).toBe(4);
  });

  it("keeps running a hook the harness has no gate for", async () => {
    const root = buildRepository();

    write(root, ".git/hooks/commit-msg", recordingHook("commit-msg"), 0o755);

    const result = await install(root);

    expect(result.hooks).toContainEqual({
      hook: "commit-msg",
      chained: ".git/hooks/commit-msg",
    });
    expect(
      runHook(root, "commit-msg", { args: [".git/COMMIT_EDITMSG"] }).status
    ).toBe(0);
    expect(ranLog(root)).toContain("commit-msg .git/COMMIT_EDITMSG");
  });

  it("hands the prior hook the arguments and standard input git gave it", async () => {
    const root = buildRepository();

    write(
      root,
      ".git/hooks/pre-push",
      [
        "#!/usr/bin/env bash",
        'printf "args=%s\\n" "$*" >> "${PWD}/ran.log"',
        'cat >> "${PWD}/ran.log"',
        "exit 0",
        "",
      ].join("\n"),
      0o755
    );

    await install(root);
    fakeRuntime(root);

    runHook(root, "pre-push", {
      args: ["origin", "git@example.invalid:host.git"],
      stdin: "refs/heads/main abc refs/heads/main def\n",
    });

    expect(ranLog(root)).toContain("args=origin git@example.invalid:host.git");
    expect(ranLog(root)).toContain("refs/heads/main abc");
  });

  it("still preserves the prior hook after a second install", async () => {
    const root = buildRepository();

    write(root, ".husky/pre-commit", recordingHook("husky"), 0o755);
    git(root, ["config", "--local", "core.hooksPath", ".husky"]);

    await install(root);
    const second = await install(root);

    expect(second.gitHooksPathChanged).toBe(false);
    expect(second.hooks).toContainEqual({
      hook: "pre-commit",
      chained: ".husky/pre-commit",
    });
    expect(readInstallManifest(root)?.previousHooksPath).toBe(".husky");
    expect(second.created).toEqual([]);
  });

  it("refuses when the project asked it not to take hooks over", () => {
    const root = buildRepository();

    write(root, ".git/hooks/pre-commit", recordingHook("project"), 0o755);
    write(
      root,
      ".harness/config/hooks.yaml",
      "version: 1\nonExistingHook: abort\nhooks: []\n"
    );

    return expect(install(root)).rejects.toMatchObject({
      kind: "unsafe-hook-chain",
    });
  });

  it("honours a hooks config the project edited after installing", async () => {
    // config/hooks.yaml is seeded, so the project owns it. Reading the shipped
    // template here would accept the edit and then ignore it.
    const root = buildRepository();

    await install(root);
    writeFileSync(
      join(root, ".harness", "config", "hooks.yaml"),
      [
        "version: 1",
        "hooks:",
        "  - hook: pre-commit",
        "    enabled: false",
        "    phase: pre-commit",
        "  - hook: pre-push",
        "    enabled: true",
        "    phase: pre-push",
        "",
      ].join("\n")
    );

    const result = await install(root);

    expect(result.hooks.map((hook) => hook.hook)).toEqual(["pre-push"]);
    expect(result.orphaned).toEqual(["hooks/pre-commit"]);
  });

  it("reports a hooks config the project broke, rather than falling back", async () => {
    const root = buildRepository();

    await install(root);
    writeFileSync(
      join(root, ".harness", "config", "hooks.yaml"),
      "version: 1\nhooks: not-a-list\n"
    );

    const error = await captureRejection(() => install(root), HarnessError);

    expect(error.kind).toBe("invalid-config");
    expect(error.message).toContain("config/hooks.yaml");
  });
});

describe("hook dispatch in a linked worktree", () => {
  it("installs into the worktree and resolves its own dispatchers", async () => {
    const main = buildRepository();

    git(main, ["add", "."]);
    git(main, ["commit", "--quiet", "-m", "initial"]);

    const worktree = join(createTempDirectory("agentic-harness-linked-"), "wt");

    git(main, ["worktree", "add", "--quiet", worktree, "-b", "feature"]);

    const result = await install(worktree);

    fakeRuntime(worktree);

    expect(result.projectRoot).toBe(worktree);
    // core.hooksPath is repository-local and therefore shared with the main
    // checkout, which is exactly why the value is relative: each worktree
    // resolves it against its own root.
    expect(hooksPathOf(worktree)).toBe(".harness/hooks");
    expect(hooksPathOf(main)).toBe(".harness/hooks");
    expect(runHook(worktree, "pre-commit")).toMatchObject({
      status: 0,
      stdout: "harness gate pre-commit\n",
    });
  });

  it("chains the hooks the main repository owns, which are the ones git runs", async () => {
    const main = buildRepository();

    write(main, ".git/hooks/pre-commit", recordingHook("common"), 0o755);
    git(main, ["add", "."]);
    git(main, ["commit", "--quiet", "-m", "initial"]);

    const worktree = join(createTempDirectory("agentic-harness-linked-"), "wt");

    git(main, ["worktree", "add", "--quiet", worktree, "-b", "feature"]);

    const result = await install(worktree);

    expect(result.hooks).toContainEqual({
      hook: "pre-commit",
      chained: join(main, ".git", "hooks", "pre-commit"),
    });
  });
});
