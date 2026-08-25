import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const checkerPath = resolve("scripts/check-shell-syntax.sh");
const temporaryDirectories: string[] = [];

const createFixture = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "agentic-harness-shell-"));
  temporaryDirectories.push(directory);
  return directory;
};

const runChecker = (directory: string) =>
  spawnSync("bash", [checkerPath, directory], {
    encoding: "utf8",
  });

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("check-shell-syntax.sh", () => {
  it("accepts valid shell files recursively", () => {
    const directory = createFixture();
    const nestedDirectory = join(directory, "nested");
    mkdirSync(nestedDirectory);
    writeFileSync(
      join(nestedDirectory, "valid.sh"),
      "#!/usr/bin/env bash\nset -euo pipefail\nprintf 'ok\\n'\n"
    );

    const result = runChecker(directory);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("rejects invalid shell files", () => {
    const directory = createFixture();
    writeFileSync(join(directory, "invalid.sh"), "if true; then\n");

    const result = runChecker(directory);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid.sh");
  });

  it("returns a usage error for a missing directory", () => {
    const directory = join(createFixture(), "missing");

    const result = runChecker(directory);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("is not a directory");
  });
});
