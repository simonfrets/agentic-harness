import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HarnessError } from "../../../src/harness/harness-error.js";
import {
  readInstallManifest,
  writeInstallManifest,
} from "../../../src/install/install-manifest.js";
import type { InstallManifest } from "../../../src/install/install-manifest.js";
import { buildHarnessProject } from "../../helpers/harness-project.js";
import { captureError } from "../../helpers/expect-error.js";
import { removeTempDirectories } from "../../helpers/temp-directory.js";

afterEach(() => {
  removeTempDirectories();
});

const MANIFEST: InstallManifest = {
  version: 1,
  harnessVersion: "0.1.0",
  installedAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  managedFiles: [{ path: "rules/base.yaml", sha256: "a".repeat(64) }],
};

describe("readInstallManifest", () => {
  it("returns null when the harness has never been installed", () => {
    expect(readInstallManifest(buildHarnessProject())).toBeNull();
  });

  it("round-trips a manifest through the filesystem", () => {
    const root = buildHarnessProject();

    writeInstallManifest(root, MANIFEST);

    expect(readInstallManifest(root)).toEqual(MANIFEST);
  });

  it("writes the manifest as formatted json with a trailing newline", () => {
    const root = buildHarnessProject();

    writeInstallManifest(root, MANIFEST);

    const text = readFileSync(join(root, ".harness", "version.json"), "utf8");

    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "harnessVersion": "0.1.0"');
  });

  it("refuses a manifest that is not json", () => {
    const root = buildHarnessProject({
      files: { ".harness/version.json": "{" },
    });
    const error = captureError(() => readInstallManifest(root), HarnessError);

    expect(error.kind).toBe("invalid-config");
    expect(error.message).toContain("version.json");
  });

  it("refuses a manifest that does not match the schema", () => {
    const root = buildHarnessProject({
      files: { ".harness/version.json": JSON.stringify({ version: 2 }) },
    });
    const error = captureError(() => readInstallManifest(root), HarnessError);

    expect(error.kind).toBe("invalid-config");
    expect(error.details.join(" ")).toContain("version");
  });
});
