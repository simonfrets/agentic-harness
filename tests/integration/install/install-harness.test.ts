import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { HarnessError } from "../../../src/harness/harness-error.js";
import { installHarness } from "../../../src/install/install-harness.js";
import type { InstallHarnessResult } from "../../../src/install/install-harness.js";
import { readInstallManifest } from "../../../src/install/install-manifest.js";
import { hashManagedFile } from "../../../src/install/install-manifest.js";
import { listHarnessTemplateFiles } from "../../../src/install/harness-templates.js";
import { captureRejection } from "../../helpers/expect-error.js";
import {
  at,
  createFakeCommandRunner,
  exited,
} from "../../helpers/fake-command-runner.js";
import type {
  FakeCommandRunner,
  PlannedCommandResult,
} from "../../helpers/fake-command-runner.js";
import {
  createTempDirectory,
  removeTempDirectories,
} from "../../helpers/temp-directory.js";

afterEach(() => {
  removeTempDirectories();
});

const NOW = new Date("2026-08-26T12:00:00.000Z");
const LATER = new Date("2026-09-01T09:30:00.000Z");

/** A synthetic `agentic-harness` package, so a test controls what ships. */
const buildPackage = (
  templates: Readonly<Record<string, string>>,
  version = "0.1.0"
): string => {
  const root = createTempDirectory("agentic-harness-package-");

  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "agentic-harness", version }, null, 2)}\n`
  );

  for (const [path, contents] of Object.entries(templates)) {
    const absolute = join(root, "templates", ".harness", ...path.split("/"));

    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }

  return root;
};

/** A host project that already has its own toolchain configuration. */
const buildHostProject = (): string => {
  const root = createTempDirectory("agentic-harness-host-");

  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      { name: "host", version: "1.0.0", scripts: { test: "jest" } },
      null,
      2
    )}\n`
  );
  writeFileSync(join(root, "eslint.config.js"), "export default [];\n");
  writeFileSync(join(root, "tsconfig.json"), "{}\n");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "index.ts"), "export const a = 1;\n");

  return root;
};

interface Installation {
  readonly result: InstallHarnessResult;
  readonly runner: FakeCommandRunner;
}

const install = async (options: {
  readonly root: string;
  readonly packageRoot: string;
  readonly update?: boolean;
  readonly installDependencies?: boolean;
  readonly now?: Date;
  readonly npm?: PlannedCommandResult;
  readonly git?: PlannedCommandResult;
}): Promise<Installation> => {
  const runner = createFakeCommandRunner((request) =>
    request.command.executable === "git"
      ? (options.git ?? exited(0, { stdout: `${options.root}\n` }))
      : (options.npm ?? exited(0))
  );

  const result = await installHarness({
    cwd: options.root,
    packageRootDirectory: options.packageRoot,
    runner: runner.run,
    now: () => options.now ?? NOW,
    update: options.update ?? false,
    ...(options.installDependencies === undefined
      ? {}
      : { installDependencies: options.installDependencies }),
  });

  return { result, runner };
};

const read = (root: string, path: string): string =>
  readFileSync(join(root, ".harness", ...path.split("/")), "utf8");

describe("installHarness against the real shipped package", () => {
  const packageRoot = process.cwd();

  it("installs every shipped template plus the private manifest", async () => {
    const root = buildHostProject();
    const { result } = await install({ root, packageRoot });

    expect(result.created).toEqual([
      ...listHarnessTemplateFiles(packageRoot).map(
        (file) => file.installedPath
      ),
      "package.json",
    ]);
    expect(result.replaced).toEqual([]);
    expect(result.kept).toEqual([]);
    expect(result.orphaned).toEqual([]);
    expect(read(root, "rules/base.yaml")).toContain("id: harness-base");
  });

  it("renames the undotted gitignore template on the way in", async () => {
    const root = buildHostProject();

    await install({ root, packageRoot });

    expect(read(root, ".gitignore")).toContain("node_modules/");
    expect(existsSync(join(root, ".harness", "gitignore"))).toBe(false);
  });

  it("confines its footprint to .harness and changes no host file", async () => {
    const root = buildHostProject();
    const before = readdirSync(root).sort();
    const manifest = readFileSync(join(root, "package.json"), "utf8");
    const eslint = readFileSync(join(root, "eslint.config.js"), "utf8");

    await install({ root, packageRoot });

    expect(readdirSync(root).sort()).toEqual([...before, ".harness"].sort());
    expect(readFileSync(join(root, "package.json"), "utf8")).toBe(manifest);
    expect(readFileSync(join(root, "eslint.config.js"), "utf8")).toBe(eslint);
  });

  it("records the running harness version in the project manifest", async () => {
    const root = buildHostProject();
    const { result } = await install({ root, packageRoot });
    const stored = readInstallManifest(root);

    expect(stored?.harnessVersion).toBe(result.harnessVersion);
    expect(stored?.managedFiles.map((entry) => entry.path)).toEqual(
      result.created
    );
  });
});

describe("installHarness", () => {
  const TEMPLATES = {
    "rules/base.yaml": "version: 1\nid: harness-base\n",
    "config/project.yaml": "version: 1\n",
  } as const;

  it("resolves the project root from git rather than from the cwd", async () => {
    const root = buildHostProject();
    const nested = join(root, "src");
    const runner = createFakeCommandRunner((request) =>
      request.command.executable === "git"
        ? exited(0, { stdout: `${root}\n` })
        : exited(0)
    );

    const result = await installHarness({
      cwd: nested,
      packageRootDirectory: buildPackage(TEMPLATES),
      runner: runner.run,
      now: () => NOW,
      update: false,
    });

    expect(result.projectRoot).toBe(root);
    expect(at(runner.requests, 0).command).toEqual({
      executable: "git",
      args: ["rev-parse", "--show-toplevel"],
    });
    expect(at(runner.requests, 0).cwd).toBe(nested);
    expect(existsSync(join(root, ".harness", "rules", "base.yaml"))).toBe(true);
  });

  it("refuses to install outside a git repository", async () => {
    const root = buildHostProject();
    const error = await captureRejection(
      () =>
        install({
          root,
          packageRoot: buildPackage(TEMPLATES),
          git: exited(128, { stderr: "fatal: not a git repository\n" }),
        }),
      HarnessError
    );

    expect(error.kind).toBe("not-a-git-repository");
    expect(existsSync(join(root, ".harness"))).toBe(false);
  });

  it("installs the private dependency tree inside .harness", async () => {
    const root = buildHostProject();
    const { result, runner } = await install({
      root,
      packageRoot: buildPackage(TEMPLATES, "2.0.0"),
    });
    const npm = runner.requests.filter(
      (request) => request.command.executable === "npm"
    );

    expect(result.dependenciesInstalled).toBe(true);
    expect(at(npm, 0).cwd).toBe(join(root, ".harness"));
    expect(read(root, "package.json")).toContain('"agentic-harness": "2.0.0"');
  });

  it("writes the files and the manifest before resolving dependencies", async () => {
    // An install interrupted by a failing `npm install` must leave a project
    // the harness still recognises as its own, so re-running repairs it.
    const root = buildHostProject();
    const error = await captureRejection(
      () =>
        install({
          root,
          packageRoot: buildPackage(TEMPLATES),
          npm: exited(1, { stderr: "npm error code E404\n" }),
        }),
      HarnessError
    );

    expect(error.kind).toBe("dependency-install-failed");
    expect(readInstallManifest(root)?.managedFiles).toHaveLength(3);
    expect(read(root, "rules/base.yaml")).toBe(TEMPLATES["rules/base.yaml"]);
  });

  it("skips the dependency install when asked to write files only", async () => {
    const root = buildHostProject();
    const { result, runner } = await install({
      root,
      packageRoot: buildPackage(TEMPLATES),
      installDependencies: false,
    });

    expect(result.dependenciesInstalled).toBe(false);
    expect(
      runner.requests.map((request) => request.command.executable)
    ).toEqual(["git"]);
  });

  it("is idempotent: a second run keeps every file", async () => {
    const root = buildHostProject();
    const packageRoot = buildPackage(TEMPLATES);

    await install({ root, packageRoot });
    const { result } = await install({ root, packageRoot });

    expect(result.created).toEqual([]);
    expect(result.replaced).toEqual([]);
    expect(result.kept).toEqual([
      "config/project.yaml",
      "rules/base.yaml",
      "package.json",
    ]);
  });

  it("refuses to replace an out-of-date managed file without --update", async () => {
    const root = buildHostProject();

    await install({ root, packageRoot: buildPackage(TEMPLATES) });

    const error = await captureRejection(
      () =>
        install({
          root,
          packageRoot: buildPackage(
            { ...TEMPLATES, "rules/base.yaml": "version: 1\nid: renamed\n" },
            "0.2.0"
          ),
        }),
      HarnessError
    );

    expect(error.kind).toBe("unsafe-overwrite");
    expect(error.details.join("")).toContain("re-run with `--update`");
    expect(read(root, "rules/base.yaml")).toBe(TEMPLATES["rules/base.yaml"]);
  });

  it("replaces an out-of-date managed file when --update is given", async () => {
    const root = buildHostProject();

    await install({ root, packageRoot: buildPackage(TEMPLATES) });

    const { result } = await install({
      root,
      update: true,
      now: LATER,
      packageRoot: buildPackage(
        { ...TEMPLATES, "rules/base.yaml": "version: 1\nid: renamed\n" },
        "0.2.0"
      ),
    });

    expect(result.replaced).toEqual(["rules/base.yaml", "package.json"]);
    expect(read(root, "rules/base.yaml")).toBe("version: 1\nid: renamed\n");
  });

  it("refuses to overwrite a managed file a project edited, even with --update", async () => {
    const root = buildHostProject();
    const packageRoot = buildPackage(TEMPLATES);

    await install({ root, packageRoot });
    writeFileSync(
      join(root, ".harness", "rules", "base.yaml"),
      "version: 1\nid: locally-tuned\n"
    );

    const error = await captureRejection(
      () => install({ root, packageRoot, update: true }),
      HarnessError
    );

    expect(error.details.join("")).toContain(
      "was changed after it was installed"
    );
    expect(read(root, "rules/base.yaml")).toContain("locally-tuned");
  });

  it("reports a managed file a newer version dropped without deleting it", async () => {
    const root = buildHostProject();

    await install({
      root,
      packageRoot: buildPackage({
        ...TEMPLATES,
        "rules/retired.yaml": "old\n",
      }),
    });

    const { result } = await install({
      root,
      update: true,
      packageRoot: buildPackage(TEMPLATES, "0.2.0"),
    });

    expect(result.orphaned).toEqual(["rules/retired.yaml"]);
    expect(read(root, "rules/retired.yaml")).toBe("old\n");
  });

  it("keeps the original installation date and advances the update date", async () => {
    const root = buildHostProject();
    const packageRoot = buildPackage(TEMPLATES);

    await install({ root, packageRoot });
    await install({ root, packageRoot, now: LATER });

    expect(readInstallManifest(root)).toMatchObject({
      installedAt: NOW.toISOString(),
      updatedAt: LATER.toISOString(),
    });
  });

  it("records the hash of every managed file, including the generated manifest", async () => {
    const root = buildHostProject();

    await install({ root, packageRoot: buildPackage(TEMPLATES) });

    const stored = readInstallManifest(root);

    for (const entry of stored?.managedFiles ?? []) {
      expect(entry.sha256).toBe(hashManagedFile(read(root, entry.path)));
    }
  });
});
