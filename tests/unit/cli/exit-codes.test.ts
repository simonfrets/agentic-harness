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

  it("refuses to hand a task to an agent under a context that is not its own", () => {
    // Running the stage anyway would run it under whatever policy the
    // mismatched context carries, which is the outcome the check exists to
    // prevent, so the invocation is refused rather than repaired.
    expect(exitCodeForHarnessError("invalid-invocation")).toBe(
      CLI_EXIT_CODES.refused
    );
  });

  it("refuses a completion whose evidence is missing or whose notification failed", () => {
    // Both are requests the harness understood and deliberately did not
    // carry out: the task stays in `qa` until the evidence exists and, under
    // `onFailure: block`, until somebody was actually told.
    expect(exitCodeForHarnessError("incomplete-evidence")).toBe(
      CLI_EXIT_CODES.refused
    );
    expect(exitCodeForHarnessError("notification-failed")).toBe(
      CLI_EXIT_CODES.refused
    );
  });

  it("refuses a handoff whose working tree could not be audited", () => {
    // Git failing to hash or compare the tree leaves the harness unable to say
    // whether the agent stayed in scope. Accepting the work anyway would be
    // the unsafe action, so the handoff is what gets refused.
    expect(exitCodeForHarnessError("working-tree-audit-failed")).toBe(
      CLI_EXIT_CODES.refused
    );
  });
});
