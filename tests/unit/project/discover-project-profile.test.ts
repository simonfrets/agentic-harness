import { join } from "node:path";

import { discoverProjectProfile } from "../../../src/project/discover-project-profile.js";
import { PackageManagerAmbiguityError } from "../../../src/project/package-manager.js";
import { buildProject } from "../../fixtures/projects/build-project.js";
import {
  at,
  createFakeCommandRunner,
  exited,
} from "../../helpers/fake-command-runner.js";
import { removeTempDirectories } from "../../helpers/temp-directory.js";

const hooksPathUnset = () => createFakeCommandRunner(exited(1));
const hooksPathSet = (value: string) =>
  createFakeCommandRunner(exited(0, { stdout: `${value}\n` }));

afterEach(() => {
  removeTempDirectories();
});

describe("discoverProjectProfile", () => {
  it("reports the scripts the harness is allowed to resolve", async () => {
    const root = buildProject({
      manifest: {
        name: "example",
        scripts: {
          lint: "eslint .",
          test: "jest",
          typecheck: "tsc --noEmit",
          deploy: "./deploy.sh",
        },
      },
    });

    const profile = await discoverProjectProfile({
      root,
      runner: hooksPathUnset().run,
    });

    expect(profile.availableScripts).toEqual(["lint", "test", "typecheck"]);
  });

  it("ignores a non-string script entry", async () => {
    const root = buildProject({
      manifest: { name: "example", scripts: { lint: 42, test: "jest" } },
    });

    const profile = await discoverProjectProfile({
      root,
      runner: hooksPathUnset().run,
    });

    expect(profile.availableScripts).toEqual(["test"]);
  });

  it("tolerates a project with no manifest, no scripts, and no configuration", async () => {
    const root = buildProject({});

    const profile = await discoverProjectProfile({
      root,
      runner: hooksPathUnset().run,
    });

    expect(profile).toMatchObject({
      root,
      packageManager: "npm",
      availableScripts: [],
      typescriptConfigFiles: [],
      eslintConfigFiles: [],
      gitHooksPath: null,
      existingHookEntrypoints: [],
      validationMode: "native-plus-harness",
    });
  });

  it("tolerates a malformed manifest without crashing discovery", async () => {
    const root = buildProject({ files: { "package.json": "{ not json" } });

    const profile = await discoverProjectProfile({
      root,
      runner: hooksPathUnset().run,
    });

    expect(profile.availableScripts).toEqual([]);
    expect(profile.packageManager).toBe("npm");
  });

  it("tolerates a manifest whose scripts field is not an object", async () => {
    const root = buildProject({ manifest: { name: "example", scripts: [] } });

    const profile = await discoverProjectProfile({
      root,
      runner: hooksPathUnset().run,
    });

    expect(profile.availableScripts).toEqual([]);
  });

  it.each([
    ["package-lock.json", "npm"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
  ])("detects %s as the %s project", async (lockfile, expected) => {
    const root = buildProject({
      manifest: { name: "example" },
      files: { [lockfile]: "" },
    });

    const profile = await discoverProjectProfile({
      root,
      runner: hooksPathUnset().run,
    });

    expect(profile.packageManager).toBe(expected);
  });

  it("lets an explicit packageManager field win over a lockfile", async () => {
    const root = buildProject({
      manifest: { name: "example", packageManager: "pnpm@9.1.0" },
      files: { "package-lock.json": "" },
    });

    const profile = await discoverProjectProfile({
      root,
      runner: hooksPathUnset().run,
    });

    expect(profile.packageManager).toBe("pnpm");
  });

  it("refuses to guess when lockfiles conflict", async () => {
    const root = buildProject({
      manifest: { name: "example" },
      files: { "package-lock.json": "", "yarn.lock": "" },
    });

    await expect(
      discoverProjectProfile({ root, runner: hooksPathUnset().run })
    ).rejects.toThrow(PackageManagerAmbiguityError);
  });

  it("records TypeScript and ESLint configuration filenames, sorted", async () => {
    const root = buildProject({
      manifest: { name: "example" },
      files: {
        "tsconfig.json": "{}",
        "tsconfig.build.json": "{}",
        "eslint.config.js": "",
        ".eslintrc.json": "{}",
        "vite.config.ts": "",
      },
    });

    const profile = await discoverProjectProfile({
      root,
      runner: hooksPathUnset().run,
    });

    expect(profile.typescriptConfigFiles).toEqual([
      "tsconfig.build.json",
      "tsconfig.json",
    ]);
    expect(profile.eslintConfigFiles).toEqual([
      ".eslintrc.json",
      "eslint.config.js",
    ]);
  });

  it("reads core.hooksPath from the project's local git configuration", async () => {
    const root = buildProject({ manifest: { name: "example" } });
    const runner = hooksPathSet(".husky");

    const profile = await discoverProjectProfile({ root, runner: runner.run });

    expect(profile.gitHooksPath).toBe(".husky");
    expect(at(runner.requests, 0)).toMatchObject({
      command: {
        executable: "git",
        args: ["config", "--local", "--get", "core.hooksPath"],
      },
      cwd: root,
    });
  });

  it("treats an unset core.hooksPath as absent rather than empty", async () => {
    const root = buildProject({ manifest: { name: "example" } });

    const profile = await discoverProjectProfile({
      root,
      runner: createFakeCommandRunner(exited(0, { stdout: "\n" })).run,
    });

    expect(profile.gitHooksPath).toBeNull();
  });

  it("detects Husky, raw git, and Lefthook hook entrypoints", async () => {
    const root = buildProject({
      manifest: { name: "example" },
      files: {
        [join(".husky", "pre-commit")]: "npm test\n",
        [join(".git", "hooks", "pre-push")]: "#!/bin/sh\n",
        [join(".git", "hooks", "pre-commit.sample")]: "#!/bin/sh\n",
        "lefthook.yml": "pre-commit:\n",
      },
    });

    const profile = await discoverProjectProfile({
      root,
      runner: hooksPathUnset().run,
    });

    expect(profile.existingHookEntrypoints).toEqual([
      { runner: "husky", hook: "pre-commit", path: ".husky/pre-commit" },
      { runner: "git", hook: "pre-push", path: ".git/hooks/pre-push" },
      { runner: "lefthook", hook: "pre-commit", path: "lefthook.yml" },
      { runner: "lefthook", hook: "pre-push", path: "lefthook.yml" },
    ]);
  });

  it("returns an empty profile for a directory that does not exist", async () => {
    const root = join(buildProject({}), "missing");

    const profile = await discoverProjectProfile({
      root,
      runner: hooksPathUnset().run,
    });

    expect(profile).toMatchObject({
      root,
      packageManager: "npm",
      availableScripts: [],
      typescriptConfigFiles: [],
      existingHookEntrypoints: [],
    });
  });

  it("never executes a project script while discovering", async () => {
    const root = buildProject({
      manifest: { name: "example", scripts: { lint: "eslint ." } },
    });
    const runner = hooksPathUnset();

    await discoverProjectProfile({ root, runner: runner.run });

    expect(runner.requests).toHaveLength(1);
    expect(at(runner.requests, 0).command.executable).toBe("git");
  });
});
