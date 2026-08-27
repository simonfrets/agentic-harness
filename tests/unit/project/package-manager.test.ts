import {
  LOCKFILE_PACKAGE_MANAGERS,
  PackageManagerAmbiguityError,
  detectLockfilePackageManagers,
  parseDeclaredPackageManager,
  resolvePackageManager,
} from "../../../src/project/package-manager.js";

/** Captures a thrown value so assertions stay outside a catch block. */
const captureError = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }

  return null;
};

describe("parseDeclaredPackageManager", () => {
  it("reads the Corepack packageManager field", () => {
    expect(parseDeclaredPackageManager("pnpm@9.1.0")).toBe("pnpm");
    expect(parseDeclaredPackageManager("yarn@4.1.0")).toBe("yarn");
    expect(parseDeclaredPackageManager("bun")).toBe("bun");
  });

  it("returns null for an absent, non-string, or unsupported value", () => {
    expect(parseDeclaredPackageManager(undefined)).toBeNull();
    expect(parseDeclaredPackageManager(42)).toBeNull();
    expect(parseDeclaredPackageManager("deno@1.0.0")).toBeNull();
  });
});

describe("detectLockfilePackageManagers", () => {
  it("maps every known lockfile to its manager", () => {
    expect(LOCKFILE_PACKAGE_MANAGERS.size).toBeGreaterThan(0);

    for (const [lockfile, manager] of LOCKFILE_PACKAGE_MANAGERS) {
      expect(detectLockfilePackageManagers([lockfile])).toEqual([manager]);
    }
  });

  it("ignores unrelated files", () => {
    expect(detectLockfilePackageManagers(["README.md", "src"])).toEqual([]);
  });

  it("collapses the two bun lockfile names to one manager", () => {
    expect(detectLockfilePackageManagers(["bun.lock", "bun.lockb"])).toEqual([
      "bun",
    ]);
  });
});

describe("resolvePackageManager", () => {
  it("prefers an explicit declaration over any lockfile", () => {
    expect(
      resolvePackageManager({
        declared: "yarn",
        lockfiles: ["package-lock.json", "pnpm-lock.yaml"],
      })
    ).toBe("yarn");
  });

  it("uses a single lockfile when nothing is declared", () => {
    expect(
      resolvePackageManager({ declared: null, lockfiles: ["pnpm-lock.yaml"] })
    ).toBe("pnpm");
  });

  it("defaults to npm when there is no lockfile at all", () => {
    expect(resolvePackageManager({ declared: null, lockfiles: [] })).toBe(
      "npm"
    );
  });

  it("refuses to guess between conflicting lockfiles", () => {
    const error = captureError(() =>
      resolvePackageManager({
        declared: null,
        lockfiles: ["package-lock.json", "yarn.lock"],
      })
    );

    expect(error).toBeInstanceOf(PackageManagerAmbiguityError);
    expect((error as PackageManagerAmbiguityError).candidates).toEqual([
      "npm",
      "yarn",
    ]);
    expect((error as PackageManagerAmbiguityError).message).toContain(
      "packageManager"
    );
  });
});
