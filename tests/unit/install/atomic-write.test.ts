import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "../../../src/install/atomic-write.js";
import {
  createTempDirectory,
  removeTempDirectories,
} from "../../helpers/temp-directory.js";

afterEach(() => {
  removeTempDirectories();
});

const mode = (path: string): number => statSync(path).mode & 0o777;

describe("writeFileAtomic", () => {
  it("creates missing parent directories", () => {
    const root = createTempDirectory("agentic-harness-atomic-");
    const target = join(root, "a", "b", "file.txt");

    writeFileAtomic(target, "hello\n", 0o644);

    expect(readFileSync(target, "utf8")).toBe("hello\n");
    expect(mode(target)).toBe(0o644);
  });

  it("replaces an existing file and leaves no temporary behind", () => {
    const root = createTempDirectory("agentic-harness-atomic-");
    const target = join(root, "file.txt");

    writeFileSync(target, "old\n");
    writeFileAtomic(target, "new\n", 0o644);

    expect(readFileSync(target, "utf8")).toBe("new\n");
    expect(readdirSync(root)).toEqual(["file.txt"]);
  });

  it("applies an executable mode exactly, whatever the umask is", () => {
    const root = createTempDirectory("agentic-harness-atomic-");
    const target = join(root, "hook");

    writeFileAtomic(target, "#!/usr/bin/env bash\n", 0o755);

    expect(mode(target)).toBe(0o755);
  });

  it("removes the temporary file when the write cannot be completed", () => {
    const root = createTempDirectory("agentic-harness-atomic-");
    const target = join(root, "directory-in-the-way");

    writeFileAtomic(join(target, "child.txt"), "x\n", 0o644);

    expect(() => {
      writeFileAtomic(target, "x\n", 0o644);
    }).toThrow();
    // The temporary is a sibling of the destination, so it lands in `root`.
    // Listing `target` inspected a directory it could never appear in, and
    // stayed green with the cleanup deleted entirely.
    expect(readdirSync(root)).toEqual(["directory-in-the-way"]);
  });
});
