import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import {
  NODE_COMMAND_RUNNER_DEFAULTS,
  createNodeCommandRunner,
} from "../../../src/processes/node-command-runner.js";

jest.mock("node:child_process", () => ({ spawn: jest.fn() }));

/**
 * These two states cannot be produced by a real process: Node always reports
 * either an exit code or a signal on `close`, and a spawn failure that also
 * emits `close` is a race that is hard to provoke deliberately. They are the
 * defensive paths in the runner, so they are exercised against a fake child
 * rather than left as unreachable branches.
 */
class FakeChild extends EventEmitter {
  public readonly stdout = new EventEmitter();
  public readonly stderr = new EventEmitter();

  public kill(): boolean {
    return true;
  }
}

const spawnMock = jest.mocked(spawn);

const runWithFakeChild = async (
  emit: (child: FakeChild) => void
): Promise<Awaited<ReturnType<ReturnType<typeof createNodeCommandRunner>>>> => {
  const child = new FakeChild();

  spawnMock.mockReturnValue(child as unknown as ChildProcess);

  const pending = createNodeCommandRunner(NODE_COMMAND_RUNNER_DEFAULTS)({
    command: { executable: "fake", args: [] },
    cwd: process.cwd(),
    env: null,
    timeoutMs: 10_000,
  });

  emit(child);

  return pending;
};

describe("createNodeCommandRunner defensive paths", () => {
  it("reports a close with neither an exit code nor a signal as a spawn failure", async () => {
    const result = await runWithFakeChild((child) => {
      child.emit("close", null, null);
    });

    expect(result).toMatchObject({
      outcome: "spawn-failed",
      errorCode: null,
    });
    expect(result).toHaveProperty(
      "message",
      "process closed without reporting an exit code or a signal"
    );
  });

  it("keeps the first outcome when an error is followed by a close", async () => {
    const result = await runWithFakeChild((child) => {
      child.emit("error", Object.assign(new Error("boom"), { code: "EACCES" }));
      child.emit("close", 0, null);
    });

    expect(result).toMatchObject({
      outcome: "spawn-failed",
      errorCode: "EACCES",
    });
  });
});
