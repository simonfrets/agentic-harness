import {
  CLI_EXIT_CODES,
  exitCodeForHarnessError,
} from "../../../src/cli/exit-codes.js";
import { HARNESS_ERROR_KINDS } from "../../../src/harness/harness-error.js";

describe("CLI exit codes", () => {
  it("keeps the documented codes stable", () => {
    expect(CLI_EXIT_CODES).toEqual({
      ok: 0,
      failure: 1,
      usage: 2,
      invalidConfig: 3,
      gateBlocked: 4,
      refused: 5,
    });
  });

  it("maps every harness error kind to a nonzero code", () => {
    for (const kind of HARNESS_ERROR_KINDS) {
      expect(exitCodeForHarnessError(kind)).toBeGreaterThan(0);
    }
  });

  it("separates a broken configuration from a refused action", () => {
    expect(exitCodeForHarnessError("invalid-config")).toBe(
      CLI_EXIT_CODES.invalidConfig
    );
    expect(exitCodeForHarnessError("not-installed")).toBe(
      CLI_EXIT_CODES.invalidConfig
    );
    expect(exitCodeForHarnessError("not-a-git-repository")).toBe(
      CLI_EXIT_CODES.refused
    );
    expect(exitCodeForHarnessError("unsafe-overwrite")).toBe(
      CLI_EXIT_CODES.refused
    );
    expect(exitCodeForHarnessError("unsafe-hook-chain")).toBe(
      CLI_EXIT_CODES.refused
    );
    expect(exitCodeForHarnessError("dependency-install-failed")).toBe(
      CLI_EXIT_CODES.refused
    );
  });
});
