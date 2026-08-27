import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { HarnessError } from "../../../src/harness/harness-error.js";
import { hashManagedFile } from "../../../src/install/install-manifest.js";
import type { InstallManifest } from "../../../src/install/install-manifest.js";
import {
  INSTALL_ACTIONS,
  planInstallation,
  toPlannedFileSource,
} from "../../../src/install/plan-installation.js";
import type {
  InstallationPlan,
  PlannedFileSource,
} from "../../../src/install/plan-installation.js";
import { captureError } from "../../helpers/expect-error.js";
import { buildHarnessProject } from "../../helpers/harness-project.js";
import { removeTempDirectories } from "../../helpers/temp-directory.js";

afterEach(() => {
  removeTempDirectories();
});

const SHIPPED = "shipped\n";
const RULE = "rules/base.yaml";

const desiredRule = (contents = SHIPPED): readonly PlannedFileSource[] => [
  { path: RULE, contents, kind: "managed" },
];

/** A manifest recording the content the harness believes it wrote. */
const manifestOf = (
  recorded: Readonly<Record<string, string>>
): InstallManifest => ({
  version: 1,
  harnessVersion: "0.1.0",
  installedAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  managedFiles: Object.entries(recorded).map(([path, contents]) => ({
    path,
    sha256: hashManagedFile(contents),
    kind: "managed" as const,
  })),
  hooks: [],
  previousHooksPath: null,
});

const actionsOf = (plan: InstallationPlan): readonly string[] =>
  plan.files.map((file) => `${file.action} ${file.path}`);

const refuse = (input: Parameters<typeof planInstallation>[0]): HarnessError =>
  captureError(() => planInstallation(input), HarnessError);

describe("planInstallation", () => {
  it("creates a file that is absent", () => {
    const plan = planInstallation({
      projectRoot: buildHarnessProject(),
      desired: desiredRule(),
      manifest: null,
      update: false,
    });

    expect(actionsOf(plan)).toEqual([`create ${RULE}`]);
    expect(plan.files[0]?.contents).toBe(SHIPPED);
    expect(plan.files[0]?.sha256).toBe(hashManagedFile(SHIPPED));
  });

  it("keeps a file that already equals the shipped content", () => {
    const plan = planInstallation({
      projectRoot: buildHarnessProject({
        files: { [`.harness/${RULE}`]: SHIPPED },
      }),
      desired: desiredRule(),
      manifest: null,
      update: false,
    });

    expect(actionsOf(plan)).toEqual([`keep ${RULE}`]);
  });

  it("keeps an identical file even when the manifest records another hash", () => {
    // The file on disk is what the harness would write, so replacing it would
    // change nothing; a stale manifest entry is not a reason to raise a
    // conflict a person cannot act on.
    const plan = planInstallation({
      projectRoot: buildHarnessProject({
        files: { [`.harness/${RULE}`]: SHIPPED },
      }),
      desired: desiredRule(),
      manifest: manifestOf({ [RULE]: "something else\n" }),
      update: false,
    });

    expect(actionsOf(plan)).toEqual([`keep ${RULE}`]);
  });

  it("refuses a differing file the harness never installed", () => {
    const error = refuse({
      projectRoot: buildHarnessProject({
        files: { [`.harness/${RULE}`]: "the project wrote this\n" },
      }),
      desired: desiredRule(),
      manifest: null,
      update: false,
    });

    expect(error.kind).toBe("unsafe-overwrite");
    expect(error.details).toEqual([
      `.harness/${RULE} already exists and was not installed by the harness`,
    ]);
  });

  it("refuses a managed file that was edited after it was installed", () => {
    const error = refuse({
      projectRoot: buildHarnessProject({
        files: { [`.harness/${RULE}`]: "locally tuned\n" },
      }),
      desired: desiredRule(),
      manifest: manifestOf({ [RULE]: "previously shipped\n" }),
      update: true,
    });

    expect(error.kind).toBe("unsafe-overwrite");
    expect(error.details.join("")).toContain(
      "was changed after it was installed"
    );
  });

  it("requires --update before replacing a file the harness still owns", () => {
    const error = refuse({
      projectRoot: buildHarnessProject({
        files: { [`.harness/${RULE}`]: "previously shipped\n" },
      }),
      desired: desiredRule(),
      manifest: manifestOf({ [RULE]: "previously shipped\n" }),
      update: false,
    });

    expect(error.kind).toBe("unsafe-overwrite");
    expect(error.details).toEqual([
      `.harness/${RULE} is out of date; re-run with \`--update\``,
    ]);
  });

  it("replaces a file the harness still owns when --update is given", () => {
    const plan = planInstallation({
      projectRoot: buildHarnessProject({
        files: { [`.harness/${RULE}`]: "previously shipped\n" },
      }),
      desired: desiredRule(),
      manifest: manifestOf({ [RULE]: "previously shipped\n" }),
      update: true,
    });

    expect(actionsOf(plan)).toEqual([`replace ${RULE}`]);
    expect(plan.files[0]?.contents).toBe(SHIPPED);
  });

  it("collects every conflict and raises them once", () => {
    const error = refuse({
      projectRoot: buildHarnessProject({
        files: {
          ".harness/rules/base.yaml": "one\n",
          ".harness/rules/git.yaml": "two\n",
          ".harness/config/project.yaml": "three\n",
        },
      }),
      desired: [
        { path: "rules/base.yaml", contents: SHIPPED, kind: "managed" },
        { path: "rules/git.yaml", contents: SHIPPED, kind: "managed" },
        { path: "config/project.yaml", contents: SHIPPED, kind: "managed" },
      ],
      manifest: null,
      update: false,
    });

    expect(error.message).toContain("3 file(s)");
    expect(error.details).toHaveLength(3);
  });

  it("plans every non-conflicting file even when it raises no conflict", () => {
    const plan = planInstallation({
      projectRoot: buildHarnessProject({
        files: { ".harness/rules/git.yaml": SHIPPED },
      }),
      desired: [
        { path: "rules/base.yaml", contents: SHIPPED, kind: "managed" },
        { path: "rules/git.yaml", contents: SHIPPED, kind: "managed" },
      ],
      manifest: null,
      update: false,
    });

    expect(actionsOf(plan)).toEqual([
      "create rules/base.yaml",
      "keep rules/git.yaml",
    ]);
  });

  it("reports a managed file this version no longer ships without deleting it", () => {
    const root = buildHarnessProject({
      files: { ".harness/rules/legacy.yaml": "retired\n" },
    });

    const plan = planInstallation({
      projectRoot: root,
      desired: desiredRule(),
      manifest: manifestOf({
        "rules/legacy.yaml": "retired\n",
        "rules/old.yaml": "also retired\n",
      }),
      update: true,
    });

    expect(plan.orphaned).toEqual(["rules/legacy.yaml", "rules/old.yaml"]);
    expect(
      readFileSync(join(root, ".harness", "rules", "legacy.yaml"), "utf8")
    ).toBe("retired\n");
  });

  it("writes nothing at all", () => {
    // The `.harness` directory has to exist, or the ENOENT this used to assert
    // came from the fixture rather than from the planner declining to write.
    const root = buildHarnessProject({
      files: { ".harness/rules/git.yaml": SHIPPED },
    });

    planInstallation({
      projectRoot: root,
      desired: [
        { path: RULE, contents: SHIPPED, kind: "managed" },
        { path: "rules/git.yaml", contents: "changed\n", kind: "seeded" },
      ],
      manifest: null,
      update: true,
    });

    expect(readdirSync(join(root, ".harness", "rules"))).toEqual(["git.yaml"]);
    expect(
      readFileSync(join(root, ".harness", "rules", "git.yaml"), "utf8")
    ).toBe(SHIPPED);
  });
});

describe("planInstallation on a seeded file", () => {
  const CONFIG = "config/project.yaml";
  const seeded = (contents = SHIPPED): readonly PlannedFileSource[] => [
    { path: CONFIG, contents, kind: "seeded" },
  ];

  it("writes it when the project does not have it yet", () => {
    const plan = planInstallation({
      projectRoot: buildHarnessProject(),
      desired: seeded(),
      manifest: null,
      update: false,
    });

    expect(actionsOf(plan)).toEqual([`create ${CONFIG}`]);
  });

  it("leaves a copy the project edited alone instead of refusing", () => {
    // This file exists to be edited. Reconciling it against the template is
    // what made editing it the thing that broke the next `harness init`.
    const plan = planInstallation({
      projectRoot: buildHarnessProject({
        files: { [`.harness/${CONFIG}`]: "validationMode: native-only\n" },
      }),
      desired: seeded(),
      manifest: manifestOf({ [CONFIG]: SHIPPED }),
      update: false,
    });

    expect(actionsOf(plan)).toEqual([`keep ${CONFIG}`]);
  });

  it("does not replace it even when --update is given", () => {
    const plan = planInstallation({
      projectRoot: buildHarnessProject({
        files: { [`.harness/${CONFIG}`]: "validationMode: native-only\n" },
      }),
      desired: seeded(),
      manifest: manifestOf({ [CONFIG]: SHIPPED }),
      update: true,
    });

    expect(actionsOf(plan)).toEqual([`keep ${CONFIG}`]);
  });

  it("accepts one the harness never installed, because the project owns it", () => {
    const plan = planInstallation({
      projectRoot: buildHarnessProject({
        files: { [`.harness/${CONFIG}`]: "written by hand\n" },
      }),
      desired: seeded(),
      manifest: null,
      update: false,
    });

    expect(actionsOf(plan)).toEqual([`keep ${CONFIG}`]);
  });

  it("records the hash of the project's copy, not of the template", () => {
    const local = "validationMode: native-only\n";
    const plan = planInstallation({
      projectRoot: buildHarnessProject({
        files: { [`.harness/${CONFIG}`]: local },
      }),
      desired: seeded(),
      manifest: null,
      update: false,
    });

    expect(plan.files[0]?.sha256).toBe(hashManagedFile(local));
    expect(plan.files[0]?.kind).toBe("seeded");
  });
});

describe("toPlannedFileSource", () => {
  it("keys the planned content by the installed path, not the template path", () => {
    expect(
      toPlannedFileSource(
        {
          templatePath: "gitignore",
          installedPath: ".gitignore",
          seeded: false,
        },
        "node_modules/\n"
      )
    ).toEqual({
      path: ".gitignore",
      contents: "node_modules/\n",
      kind: "managed",
    });
  });

  it("carries a seeded template through as a file the project will own", () => {
    expect(
      toPlannedFileSource(
        {
          templatePath: "config/project.yaml",
          installedPath: "config/project.yaml",
          seeded: true,
        },
        "version: 1\n"
      ).kind
    ).toBe("seeded");
  });
});

describe("INSTALL_ACTIONS", () => {
  it("names every outcome the decision table can produce", () => {
    expect([...INSTALL_ACTIONS]).toEqual(["create", "keep", "replace"]);
  });
});
