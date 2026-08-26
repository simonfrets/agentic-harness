import { join } from "node:path";

import { HARNESS_DIRECTORY } from "../harness/layout.js";
import type { InstallHarnessResult } from "../install/install-harness.js";

const plural = (count: number, noun: string): string =>
  `${String(count)} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Reports what installation actually did.
 *
 * Created and replaced files are listed individually because they are the ones
 * that changed; files that were already correct are only counted, so a routine
 * re-run stays short enough to read.
 */
export const formatInstallResult = (result: InstallHarnessResult): string => {
  const lines = [
    `Harness ${result.harnessVersion} installed in ${join(
      result.projectRoot,
      HARNESS_DIRECTORY
    )}`,
    "",
    `${plural(result.created.length, "file")} created, ${String(
      result.replaced.length
    )} replaced, ${String(result.kept.length)} already up to date`,
    ...result.created.map((path) => `  + ${path}`),
    ...result.replaced.map((path) => `  ~ ${path}`),
  ];

  if (result.orphaned.length > 0) {
    lines.push(
      "",
      `${plural(
        result.orphaned.length,
        "managed file"
      )} this version no longer ships, left in place:`,
      ...result.orphaned.map((path) => `  ? ${path}`),
      "Delete them yourself once you are sure the project no longer needs them."
    );
  }

  lines.push(
    "",
    result.dependenciesInstalled
      ? `Runtime dependencies resolved in ${HARNESS_DIRECTORY}/node_modules`
      : "Runtime dependencies were not installed"
  );

  return `${lines.join("\n")}\n`;
};
