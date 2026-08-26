import { join } from "node:path";

import { formatInstallResult } from "../../../src/cli/format-install-result.js";
import type { InstallHarnessResult } from "../../../src/install/install-harness.js";

const RESULT: InstallHarnessResult = {
  projectRoot: join("/tmp", "host"),
  harnessVersion: "0.1.0",
  created: [],
  replaced: [],
  kept: [],
  orphaned: [],
  dependenciesInstalled: true,
};

const format = (overrides: Partial<InstallHarnessResult> = {}): string =>
  formatInstallResult({ ...RESULT, ...overrides });

describe("formatInstallResult", () => {
  it("names the harness version and the directory it owns", () => {
    expect(format()).toContain(
      `Harness 0.1.0 installed in ${join("/tmp", "host", ".harness")}`
    );
  });

  it("lists what it created and what it replaced", () => {
    const text = format({
      created: ["rules/base.yaml"],
      replaced: ["config/project.yaml"],
      kept: ["agents/coder.yaml", "agents/qa.yaml"],
    });

    expect(text).toContain("1 file created, 1 replaced, 2 already up to date");
    expect(text).toContain("  + rules/base.yaml");
    expect(text).toContain("  ~ config/project.yaml");
  });

  it("counts files that were already correct without listing them", () => {
    expect(format({ kept: ["agents/coder.yaml"] })).not.toContain(
      "agents/coder.yaml"
    );
  });

  it("reports an orphaned managed file and says it was left alone", () => {
    const text = format({ orphaned: ["rules/retired.yaml"] });

    expect(text).toContain("1 managed file this version no longer ships");
    expect(text).toContain("  ? rules/retired.yaml");
    expect(text).toContain("Delete them yourself");
  });

  it("says nothing about orphans when there are none", () => {
    expect(format()).not.toContain("no longer ships");
  });

  it("says whether the private dependency tree was resolved", () => {
    expect(format()).toContain(
      "Runtime dependencies resolved in .harness/node_modules"
    );
    expect(format({ dependenciesInstalled: false })).toContain(
      "Runtime dependencies were not installed"
    );
  });

  it("pluralises the file count", () => {
    expect(format({ created: ["a", "b"] })).toContain("2 files created");
  });
});
