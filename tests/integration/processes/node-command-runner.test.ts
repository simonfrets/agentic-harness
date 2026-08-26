import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  ENVIRONMENT_ALLOWLIST,
  NODE_COMMAND_RUNNER_DEFAULTS,
  buildChildEnvironment,
  createNodeCommandRunner,
  nodeCommandRunner,
} from "../../../src/processes/node-command-runner.js";
import type {
  CommandRequest,
  CommandResult,
} from "../../../src/processes/command-runner.js";
import {
  createTempDirectory,
  removeTempDirectories,
} from "../../helpers/temp-directory.js";

const runner = createNodeCommandRunner({
  ...NODE_COMMAND_RUNNER_DEFAULTS,
  killGraceMs: 200,
});

const nodeScript = (
  source: string,
  extraArgs: readonly string[] = []
): CommandRequest["command"] => ({
  executable: process.execPath,
  args: ["-e", source, ...extraArgs],
});

const run = async (
  request: Partial<CommandRequest> & Pick<CommandRequest, "command">
): Promise<CommandResult> =>
  runner({
    cwd: process.cwd(),
    env: null,
    timeoutMs: 10_000,
    ...request,
  });

afterEach(() => {
  removeTempDirectories();
});

describe("createNodeCommandRunner", () => {
  it("captures stdout and stderr from a successful command", async () => {
    const result = await run({
      command: nodeScript(
        "process.stdout.write('out');process.stderr.write('err')"
      ),
    });

    expect(result.outcome).toBe("exited");
    expect(result).toMatchObject({ exitCode: 0 });
    expect(result.output.stdout).toBe("out");
    expect(result.output.stderr).toBe("err");
    expect(result.output.truncated).toBe(false);
    // `>= 0` is satisfied by a hardcoded zero. Spawning a real node process
    // and waiting for it to close takes tens of milliseconds, so a duration
    // that is genuinely measured cannot be zero.
    expect(result.durationMs).toBeGreaterThan(0);
    expect(Date.parse(result.startedAt)).not.toBeNaN();
  });

  it("reports a non-zero exit as a result rather than a rejection", async () => {
    const result = await run({ command: nodeScript("process.exit(3)") });

    expect(result).toMatchObject({ outcome: "exited", exitCode: 3 });
  });

  it("reports a missing executable as a spawn failure", async () => {
    const result = await run({
      command: { executable: "agentic-harness-no-such-binary", args: [] },
    });

    expect(result).toMatchObject({
      outcome: "spawn-failed",
      errorCode: "ENOENT",
    });
  });

  it("runs the command in the requested working directory", async () => {
    const directory = createTempDirectory("agentic-harness-cwd-");

    const result = await run({
      command: nodeScript("process.stdout.write(process.cwd())"),
      cwd: directory,
    });

    expect(result.output.stdout).toBe(directory);
  });

  it("terminates a command that exceeds its timeout", async () => {
    const result = await run({
      command: nodeScript("setTimeout(() => {}, 5000)"),
      timeoutMs: 150,
    });

    expect(result).toMatchObject({
      outcome: "timed-out",
      timeoutMs: 150,
      forceKilled: false,
    });
  });

  it("escalates to SIGKILL when a command ignores the first signal", async () => {
    const result = await run({
      command: nodeScript(
        "process.on('SIGTERM', () => {});setInterval(() => {}, 1000)"
      ),
      timeoutMs: 100,
    });

    expect(result).toMatchObject({ outcome: "timed-out", forceKilled: true });
  });

  it("reports an externally signalled command distinctly from an exit", async () => {
    const result = await run({
      command: nodeScript("process.kill(process.pid, 'SIGKILL')"),
    });

    expect(result).toMatchObject({ outcome: "signaled", signal: "SIGKILL" });
  });

  it("does not hang when a command reads standard input", async () => {
    const result = await run({
      command: nodeScript(
        "process.stdin.resume();process.stdin.on('end', () => { process.exit(0); })"
      ),
      timeoutMs: 3000,
    });

    expect(result).toMatchObject({ outcome: "exited", exitCode: 0 });
  });

  it("captures large output intact and decodes multi-byte characters", async () => {
    const result = await run({
      command: nodeScript(
        "for (let i = 0; i < 20000; i += 1) { process.stdout.write('\\u{1F600}'); }"
      ),
    });

    expect(result.output.stdout).toBe("\u{1F600}".repeat(20000));
    expect(result.output.truncated).toBe(false);
  });

  it("truncates output beyond the capture budget and says so", async () => {
    const limited = createNodeCommandRunner({
      ...NODE_COMMAND_RUNNER_DEFAULTS,
      maxOutputBytes: 16,
    });

    const result = await limited({
      command: nodeScript("process.stdout.write('x'.repeat(100000))"),
      cwd: process.cwd(),
      env: null,
      timeoutMs: 10_000,
    });

    expect(result.output.stdout).toBe("x".repeat(16));
    expect(result.output.truncated).toBe(true);
  });

  it("treats shell metacharacters as literal argument values", async () => {
    const directory = createTempDirectory("agentic-harness-inert-");
    const hostile = [
      "; rm -rf .",
      "$(touch pwned)",
      "`touch pwned`",
      "&& echo pwned",
      "| tee pwned",
      "> pwned",
      "*",
      "$HOME",
    ];

    const result = await run({
      command: nodeScript(
        "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
        hostile
      ),
      cwd: directory,
    });

    expect(JSON.parse(result.output.stdout)).toEqual(hostile);
    expect(existsSync(join(directory, "pwned"))).toBe(false);
    expect(readdirSync(directory)).toEqual([]);
    expect(result.output.stdout).not.toContain(process.env.HOME ?? "@@none@@");
  });

  it("passes explicit environment overrides through to the child", async () => {
    const result = await run({
      command: nodeScript(
        "process.stdout.write(JSON.stringify([process.env.HARNESS_MARKER, Boolean(process.env.PATH)]))"
      ),
      env: { HARNESS_MARKER: "set" },
    });

    expect(JSON.parse(result.output.stdout)).toEqual(["set", true]);
  });

  it("withholds variables outside the allowlist from the child", async () => {
    // The variable has to be set on the runner's base environment, or the
    // child reports `undefined` however the allowlist behaves and the test
    // proves nothing. It used to be set nowhere at all.
    const leaky = createNodeCommandRunner({
      ...NODE_COMMAND_RUNNER_DEFAULTS,
      baseEnv: { ...process.env, AGENTIC_HARNESS_SECRET: "leak" },
    });

    const result = await leaky({
      command: nodeScript(
        "process.stdout.write(String(process.env.AGENTIC_HARNESS_SECRET))"
      ),
      cwd: process.cwd(),
      env: null,
      timeoutMs: 10_000,
    });

    expect(result.output.stdout).toBe("undefined");
  });

  it("exposes a default runner that works without configuration", async () => {
    const result = await nodeCommandRunner({
      command: nodeScript("process.stdout.write('default')"),
      cwd: process.cwd(),
      env: null,
      timeoutMs: 10_000,
    });

    expect(result.output.stdout).toBe("default");
  });
});

describe("buildChildEnvironment", () => {
  it("forwards only allowlisted variables", () => {
    const environment = buildChildEnvironment(
      { PATH: "/usr/bin", AWS_SECRET_ACCESS_KEY: "leak", HOME: "/home/x" },
      null
    );

    expect(environment).toEqual({ PATH: "/usr/bin", HOME: "/home/x" });
  });

  it("forwards the index a partial commit is being built from", () => {
    // Without it a gate answers a different question than the commit being
    // made: `git commit -- <path>` builds a temporary index and names it here,
    // and a check that cannot see it reads the stale one.
    expect(
      buildChildEnvironment({ GIT_INDEX_FILE: "/repo/.git/next-index" }, null)
    ).toEqual({ GIT_INDEX_FILE: "/repo/.git/next-index" });
  });

  it("forwards no other git variable, so a hook cannot redirect a gate", () => {
    // Every command runs with an explicit absolute cwd, so git finds the
    // repository itself. Inheriting these would let a hook running in one
    // repository point a gate at another - which is exactly what happened to
    // this repository's own test suite when they were forwarded.
    expect(
      buildChildEnvironment(
        {
          GIT_DIR: "/elsewhere/.git",
          GIT_WORK_TREE: "/elsewhere",
          GIT_PREFIX: "sub/",
          GIT_AUTHOR_NAME: "x",
          GIT_COMMITTER_EMAIL: "y",
        },
        null
      )
    ).toEqual({});
  });

  it("omits allowlisted variables that are absent from the base", () => {
    expect(buildChildEnvironment({}, null)).toEqual({});
  });

  it("lets explicit overrides add and replace values", () => {
    const environment = buildChildEnvironment(
      { PATH: "/usr/bin" },
      { PATH: "/opt/bin", HARNESS_MARKER: "set" }
    );

    expect(environment).toEqual({
      PATH: "/opt/bin",
      HARNESS_MARKER: "set",
    });
  });

  it("keeps the allowlist sorted so the forwarded set is reviewable", () => {
    expect([...ENVIRONMENT_ALLOWLIST]).toEqual(
      [...ENVIRONMENT_ALLOWLIST].sort()
    );
  });
});
