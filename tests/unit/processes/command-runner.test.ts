import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_KILL_GRACE_MS,
  DEFAULT_KILL_SIGNAL,
  DEFAULT_MAX_OUTPUT_BYTES,
  EMPTY_COMMAND_OUTPUT,
  commandSucceeded,
  describeCommand,
  describeCommandResult,
  toSpawnFailure,
} from "../../../src/processes/command-runner.js";
import type {
  CommandResult,
  CommandSpec,
} from "../../../src/processes/command-runner.js";

const COMMAND: CommandSpec = { executable: "npm", args: ["run", "lint"] };

const base = {
  command: COMMAND,
  output: EMPTY_COMMAND_OUTPUT,
  startedAt: "2026-08-25T00:00:00.000Z",
  durationMs: 12,
};

const exited = (exitCode: number): CommandResult => ({
  ...base,
  outcome: "exited",
  exitCode,
});

describe("command runner defaults", () => {
  it("documents the timeout, grace, signal, and capture budget", () => {
    expect(DEFAULT_COMMAND_TIMEOUT_MS).toBe(120_000);
    expect(DEFAULT_KILL_GRACE_MS).toBe(5_000);
    expect(DEFAULT_KILL_SIGNAL).toBe("SIGTERM");
    expect(DEFAULT_MAX_OUTPUT_BYTES).toBe(4 * 1024 * 1024);
    expect(EMPTY_COMMAND_OUTPUT).toEqual({
      stdout: "",
      stderr: "",
      truncated: false,
    });
  });
});

describe("commandSucceeded", () => {
  it("is true only for a zero exit code", () => {
    expect(commandSucceeded(exited(0))).toBe(true);
    expect(commandSucceeded(exited(1))).toBe(false);
    expect(
      commandSucceeded({ ...base, outcome: "signaled", signal: "SIGKILL" })
    ).toBe(false);
    expect(
      commandSucceeded({
        ...base,
        outcome: "timed-out",
        timeoutMs: 100,
        forceKilled: false,
      })
    ).toBe(false);
    expect(
      commandSucceeded({
        ...base,
        outcome: "spawn-failed",
        errorCode: "ENOENT",
        message: "not found",
      })
    ).toBe(false);
  });
});

describe("describeCommand", () => {
  it("joins argv without quoting, for logs only", () => {
    expect(describeCommand(COMMAND)).toBe("npm run lint");
    expect(describeCommand({ executable: "node", args: [] })).toBe("node");
  });
});

describe("describeCommandResult", () => {
  it("returns a distinct honest line for every outcome", () => {
    expect(describeCommandResult(exited(3))).toBe("exited with code 3");
    expect(
      describeCommandResult({ ...base, outcome: "signaled", signal: "SIGKILL" })
    ).toBe("terminated by SIGKILL");
    expect(
      describeCommandResult({
        ...base,
        outcome: "timed-out",
        timeoutMs: 250,
        forceKilled: false,
      })
    ).toBe("timed out after 250ms");
    expect(
      describeCommandResult({
        ...base,
        outcome: "timed-out",
        timeoutMs: 250,
        forceKilled: true,
      })
    ).toBe("timed out after 250ms and required SIGKILL");
    expect(
      describeCommandResult({
        ...base,
        outcome: "spawn-failed",
        errorCode: "ENOENT",
        message: "spawn npm ENOENT",
      })
    ).toBe("could not be started: spawn npm ENOENT");
  });
});

describe("toSpawnFailure", () => {
  const failure = (error: unknown) => toSpawnFailure({ ...base, error });

  it("reads a string error code when the error carries one", () => {
    const result = failure(
      Object.assign(new Error("boom"), { code: "ENOENT" })
    );

    expect(result.errorCode).toBe("ENOENT");
    expect(result.message).toBe("boom");
    expect(result.outcome).toBe("spawn-failed");
  });

  it("reports a null code for an error without one", () => {
    expect(failure(new Error("boom")).errorCode).toBeNull();
  });

  it("reports a null code when the code is not a string", () => {
    expect(
      failure(Object.assign(new Error("boom"), { code: 7 })).errorCode
    ).toBeNull();
  });

  it("stringifies a thrown non-error value", () => {
    const result = failure("exploded");

    expect(result.errorCode).toBeNull();
    expect(result.message).toBe("exploded");
  });

  it("reports a null code for a thrown null", () => {
    expect(failure(null).errorCode).toBeNull();
  });
});
