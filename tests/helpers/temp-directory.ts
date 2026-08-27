import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const created: string[] = [];

/**
 * Creates an isolated directory for a test.
 *
 * The path is resolved through `realpathSync` because on macOS `os.tmpdir()`
 * returns `/var/folders/...` while a child process reports its cwd as the
 * `/private/var/folders/...` it symlinks to.
 */
export const createTempDirectory = (prefix: string): string => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));

  created.push(directory);

  return directory;
};

export const removeTempDirectories = (): void => {
  for (const directory of created.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
};
