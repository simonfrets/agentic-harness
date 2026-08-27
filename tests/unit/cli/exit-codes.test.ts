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
    expect(HARNESS_ERROR_KINDS.length).toBeGreaterThan(0);

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
    expect(exitCodeForHarnessError("git-config-failed")).toBe(
      CLI_EXIT_CODES.refused
    );
  });

  it("refuses a rejected task write rather than calling it a broken config", () => {
    // A stale revision, an illegal transition and a lock another process holds
    // are all requests the harness understood and deliberately did not carry
    // out, which is what code 5 means. Only a task that is simply not there is
    // a question about the state on disk.
    expect(exitCodeForHarnessError("stale-task-revision")).toBe(
      CLI_EXIT_CODES.refused
    );
    expect(exitCodeForHarnessError("invalid-transition")).toBe(
      CLI_EXIT_CODES.refused
    );
    expect(exitCodeForHarnessError("task-lock-failed")).toBe(
      CLI_EXIT_CODES.refused
    );
    expect(exitCodeForHarnessError("unknown-task")).toBe(
      CLI_EXIT_CODES.invalidConfig
    );
    // A context the machine never wrote is a question about the state on disk
    // too: nothing was refused, the file the caller named is simply not here.
    expect(exitCodeForHarnessError("missing-context")).toBe(
      CLI_EXIT_CODES.invalidConfig
    );
  });
});
