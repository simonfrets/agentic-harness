import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from "../../src/processes/command-runner.js";

/**
 * `Omit` over a union collapses it into one non-discriminated object, which
 * loses `outcome`-specific fields. Distributing keeps each member intact.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** A canned result without the command, which the fake fills in from the request. */
export type PlannedCommandResult = DistributiveOmit<CommandResult, "command">;

export interface FakeCommandRunner {
  readonly run: CommandRunner;
  readonly requests: readonly CommandRequest[];
}

const BASE = {
  output: { stdout: "", stderr: "", truncated: false },
  startedAt: "2026-08-25T00:00:00.000Z",
  durationMs: 1,
};

export const exited = (
  exitCode: number,
  output: Partial<CommandResult["output"]> = {}
): PlannedCommandResult => ({
  ...BASE,
  output: { ...BASE.output, ...output },
  outcome: "exited",
  exitCode,
});

export const timedOut = (timeoutMs: number): PlannedCommandResult => ({
  ...BASE,
  outcome: "timed-out",
  timeoutMs,
  forceKilled: false,
});

export const signaled = (signal: NodeJS.Signals): PlannedCommandResult => ({
  ...BASE,
  outcome: "signaled",
  signal,
});

export const spawnFailed = (errorCode: string): PlannedCommandResult => ({
  ...BASE,
  outcome: "spawn-failed",
  errorCode,
  message: `spawn failed with ${errorCode}`,
});

/**
 * A runner that records what it was asked to run and replays canned results,
 * so gate logic can be tested without spawning anything.
 */
export const createFakeCommandRunner = (
  respond:
    | PlannedCommandResult
    | ((request: CommandRequest, index: number) => PlannedCommandResult)
): FakeCommandRunner => {
  const requests: CommandRequest[] = [];

  return {
    requests,
    run: (request: CommandRequest): Promise<CommandResult> => {
      const index = requests.length;

      requests.push(request);

      const result =
        typeof respond === "function" ? respond(request, index) : respond;

      return Promise.resolve({ ...result, command: request.command });
    },
  };
};

/** Indexed access helper; `noUncheckedIndexedAccess` widens every lookup. */
export const at = <T>(items: readonly T[], index: number): T => {
  const item = items[index];

  if (item === undefined) {
    throw new Error(`no item at index ${String(index)}`);
  }

  return item;
};
