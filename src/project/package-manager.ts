import type { PackageManager } from "./project-profile-schema.js";

/**
 * Lockfile to package manager. Bun ships two lockfile names, so the mapping is
 * many-to-one.
 */
export const LOCKFILE_PACKAGE_MANAGERS: ReadonlyMap<string, PackageManager> =
  new Map([
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["npm-shrinkwrap.json", "npm"],
    ["package-lock.json", "npm"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
  ]);

/** Raised when the package manager cannot be determined without guessing. */
export class PackageManagerAmbiguityError extends Error {
  public readonly candidates: readonly PackageManager[];

  public constructor(candidates: readonly PackageManager[]) {
    super(
      `several lockfiles disagree about the package manager (${candidates.join(
        ", "
      )}); set the \`packageManager\` field in package.json to resolve it`
    );
    this.name = "PackageManagerAmbiguityError";
    this.candidates = candidates;
  }
}

/**
 * Reads the Corepack `packageManager` field, for example `pnpm@9.1.0`.
 * Returns null for an absent, malformed, or unsupported value rather than
 * throwing, so discovery can fall back to lockfiles.
 */
export const parseDeclaredPackageManager = (
  value: unknown
): PackageManager | null => {
  if (typeof value !== "string") {
    return null;
  }

  const [name] = value.split("@");

  for (const candidate of LOCKFILE_PACKAGE_MANAGERS.values()) {
    if (candidate === name) {
      return candidate;
    }
  }

  return null;
};

export const detectLockfilePackageManagers = (
  entries: readonly string[]
): readonly PackageManager[] => {
  const found = new Set<PackageManager>();

  for (const entry of entries) {
    const manager = LOCKFILE_PACKAGE_MANAGERS.get(entry);

    if (manager !== undefined) {
      found.add(manager);
    }
  }

  return [...found].sort();
};

/**
 * Resolves the package manager for a project.
 *
 * An explicit `packageManager` field always wins, because it is the only
 * statement of intent. Otherwise a single lockfile decides. Two lockfiles that
 * disagree are an error, not a silent pick: running the wrong manager would
 * install a different dependency graph than the project expects.
 */
export const resolvePackageManager = (input: {
  readonly declared: PackageManager | null;
  readonly lockfiles: readonly string[];
}): PackageManager => {
  if (input.declared !== null) {
    return input.declared;
  }

  const candidates = detectLockfilePackageManagers(input.lockfiles);
  const [first] = candidates;

  if (first === undefined) {
    return "npm";
  }

  if (candidates.length > 1) {
    throw new PackageManagerAmbiguityError(candidates);
  }

  return first;
};
