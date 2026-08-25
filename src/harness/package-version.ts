import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HarnessError } from "./harness-error.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads the `version` of a package manifest.
 *
 * The harness records its own version in an installed project's manifest, so
 * the value has to come from the real package rather than from a constant that
 * would drift out of step with `package.json` on the next release.
 */
export const readPackageVersion = (packageDirectory: string): string => {
  const path = join(packageDirectory, "package.json");
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error: unknown) {
    throw new HarnessError(
      "invalid-config",
      `could not read the package manifest at ${path}`,
      // `String` rather than a narrowing branch: `readFileSync` and
      // `JSON.parse` only ever throw errors, so a branch for anything else
      // could never be reached, let alone tested.
      [String(error)]
    );
  }

  const version = isRecord(parsed) ? parsed.version : undefined;

  if (typeof version !== "string") {
    throw new HarnessError(
      "invalid-config",
      `${path} does not declare a string \`version\``
    );
  }

  return version;
};
