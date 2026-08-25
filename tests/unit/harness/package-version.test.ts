import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { HarnessError } from "../../../src/harness/harness-error.js";
import { readPackageVersion } from "../../../src/harness/package-version.js";
import {
  createTempDirectory,
  removeTempDirectories,
} from "../../helpers/temp-directory.js";

afterEach(() => {
  removeTempDirectories();
});

const withManifest = (contents: string): string => {
  const directory = createTempDirectory("agentic-harness-version-");

  writeFileSync(join(directory, "package.json"), contents);

  return directory;
};

describe("readPackageVersion", () => {
  it("reads the version from a package manifest", () => {
    const directory = withManifest('{ "name": "x", "version": "1.2.3" }');

    expect(readPackageVersion(directory)).toBe("1.2.3");
  });

  it("rejects a manifest that cannot be read", () => {
    const directory = createTempDirectory("agentic-harness-version-");

    expect(() => readPackageVersion(directory)).toThrow(HarnessError);
  });

  it("rejects a manifest that is not an object", () => {
    const directory = withManifest("[1, 2, 3]");

    expect(() => readPackageVersion(directory)).toThrow(
      /does not declare a string `version`/
    );
  });

  it("rejects a manifest without a string version", () => {
    const directory = withManifest('{ "name": "x" }');

    expect(() => readPackageVersion(directory)).toThrow(
      /does not declare a string `version`/
    );
  });
});
