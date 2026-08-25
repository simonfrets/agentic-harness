import {
  buildPackageManagerCommand,
  resolveProjectScript,
} from "../../../src/gates/resolve-project-script.js";
import { PACKAGE_MANAGERS } from "../../../src/project/project-profile-schema.js";

describe("buildPackageManagerCommand", () => {
  it("uses an explicit run subcommand for every package manager", () => {
    expect(buildPackageManagerCommand("npm", "lint", [])).toEqual({
      executable: "npm",
      args: ["run", "lint"],
    });
    expect(buildPackageManagerCommand("pnpm", "lint", [])).toEqual({
      executable: "pnpm",
      args: ["run", "lint"],
    });
    expect(buildPackageManagerCommand("yarn", "lint", [])).toEqual({
      executable: "yarn",
      args: ["run", "lint"],
    });
    expect(buildPackageManagerCommand("bun", "lint", [])).toEqual({
      executable: "bun",
      args: ["run", "lint"],
    });
  });

  it("forwards arguments through a separator for npm only", () => {
    expect(buildPackageManagerCommand("npm", "lint", ["--fix"]).args).toEqual([
      "run",
      "lint",
      "--",
      "--fix",
    ]);
    expect(buildPackageManagerCommand("pnpm", "lint", ["--fix"]).args).toEqual([
      "run",
      "lint",
      "--fix",
    ]);
    expect(buildPackageManagerCommand("yarn", "lint", ["--fix"]).args).toEqual([
      "run",
      "lint",
      "--fix",
    ]);
    expect(buildPackageManagerCommand("bun", "lint", ["--fix"]).args).toEqual([
      "run",
      "lint",
      "--fix",
    ]);
  });

  it("never lets a script name collide with a package manager subcommand", () => {
    for (const packageManager of PACKAGE_MANAGERS) {
      expect(
        buildPackageManagerCommand(packageManager, "build", []).args[0]
      ).toBe("run");
    }
  });

  it("keeps shell metacharacters in arguments as separate literal values", () => {
    const command = buildPackageManagerCommand("npm", "lint", [
      "; rm -rf .",
      "$(touch pwned)",
      "&& echo pwned",
    ]);

    expect(command.args).toEqual([
      "run",
      "lint",
      "--",
      "; rm -rf .",
      "$(touch pwned)",
      "&& echo pwned",
    ]);
  });
});

describe("resolveProjectScript", () => {
  it("resolves a script the project defines", () => {
    const resolution = resolveProjectScript({
      packageManager: "pnpm",
      script: "test",
      args: [],
      availableScripts: ["lint", "test"],
      whenMissing: "fail",
    });

    expect(resolution).toEqual({
      kind: "resolved",
      command: { executable: "pnpm", args: ["run", "test"] },
    });
  });

  it("reports a script the project does not define, preserving the policy", () => {
    expect(
      resolveProjectScript({
        packageManager: "npm",
        script: "typecheck",
        args: [],
        availableScripts: ["lint"],
        whenMissing: "fail",
      })
    ).toEqual({ kind: "missing", behaviour: "fail", available: ["lint"] });

    expect(
      resolveProjectScript({
        packageManager: "npm",
        script: "typecheck",
        args: [],
        availableScripts: [],
        whenMissing: "skip",
      })
    ).toEqual({ kind: "missing", behaviour: "skip", available: [] });
  });
});
