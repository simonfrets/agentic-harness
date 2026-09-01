import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { notificationsConfigSchema } from "../../../src/config/notifications-config.js";
import type { NotificationsConfig } from "../../../src/config/notifications-config.js";
import { createNotifier } from "../../../src/notifications/notifier.js";
import type { TaskNotification } from "../../../src/notifications/notifier.js";
import {
  at,
  createFakeCommandRunner,
  exited,
  spawnFailed,
  timedOut,
} from "../../helpers/fake-command-runner.js";
import type { PlannedCommandResult } from "../../helpers/fake-command-runner.js";
import { buildHarnessProject } from "../../helpers/harness-project.js";
import { removeTempDirectories } from "../../helpers/temp-directory.js";

afterEach(() => {
  removeTempDirectories();
});

const AT = new Date("2026-08-31T15:00:00.000Z");

const NOTIFICATION: TaskNotification = {
  taskId: "add-login",
  title: "Add login",
  state: "completed",
  runId: "run-1",
  revision: 10,
  at: "2026-08-31T15:00:00.000Z",
};

const config = (overrides: Record<string, unknown> = {}): NotificationsConfig =>
  notificationsConfigSchema.parse({ version: 1, ...overrides });

const notify = async (
  root: string,
  given: NotificationsConfig,
  respond: PlannedCommandResult = exited(0)
) => {
  const fake = createFakeCommandRunner(respond);
  const result = await createNotifier({
    projectRoot: root,
    config: given,
    runner: fake.run,
    now: () => AT,
  })(NOTIFICATION);

  return { result, fake };
};

describe("the log channel", () => {
  it("appends one JSON line per notification under state/", async () => {
    const root = buildHarnessProject();

    const first = await notify(root, config());
    const second = await notify(root, config());
    const logPath = join(root, ".harness/state/notifications.jsonl");

    expect(first.result).toEqual({
      channel: "log",
      status: "delivered",
      detail: "appended to .harness/state/notifications.jsonl",
      at: "2026-08-31T15:00:00.000Z",
    });
    expect(second.result.status).toBe("delivered");
    expect(existsSync(logPath)).toBe(true);

    const lines = readFileSync(logPath, "utf8").trim().split("\n");

    expect(lines).toHaveLength(2);
    expect(JSON.parse(at(lines, 0))).toEqual(NOTIFICATION);
  });

  it("runs nothing", async () => {
    const { fake } = await notify(buildHarnessProject(), config());

    expect(fake.requests).toHaveLength(0);
  });

  it("reports a log it could not write as a failure, not an exception", async () => {
    const root = buildHarnessProject({
      // A regular file where the state directory should be.
      files: { ".harness/state": "not a directory" },
    });

    const { result } = await notify(root, config());

    expect(result.channel).toBe("log");
    expect(result.status).toBe("failed");
    expect(result.detail).not.toBe("");
  });
});

describe("the command channel", () => {
  const commandConfig = config({
    channel: "command",
    command: {
      argv: ["notify-send", "harness", "task done"],
      timeoutMs: 5_000,
    },
  });

  it("runs the configured argv with the task in its environment", async () => {
    const root = buildHarnessProject();
    const { result, fake } = await notify(root, commandConfig);

    expect(fake.requests).toEqual([
      {
        command: { executable: "notify-send", args: ["harness", "task done"] },
        cwd: root,
        env: {
          HARNESS_NOTIFIED_AT: "2026-08-31T15:00:00.000Z",
          HARNESS_TASK_ID: "add-login",
          HARNESS_TASK_REVISION: "10",
          HARNESS_TASK_RUN_ID: "run-1",
          HARNESS_TASK_STATE: "completed",
          HARNESS_TASK_TITLE: "Add login",
        },
        timeoutMs: 5_000,
      },
    ]);
    expect(result).toEqual({
      channel: "command",
      status: "delivered",
      detail: "`notify-send harness task done` exited with code 0",
      at: "2026-08-31T15:00:00.000Z",
    });
  });

  it("reports a refusing, hanging or unstartable command as a failure with its own words", async () => {
    const root = buildHarnessProject();

    const refused = await notify(
      root,
      commandConfig,
      exited(1, { stderr: "no session bus\n" })
    );

    expect(refused.result.status).toBe("failed");
    expect(refused.result.detail).toContain("exited with code 1");
    expect(refused.result.detail).toContain("no session bus");

    const hung = await notify(root, commandConfig, timedOut(5_000));

    expect(hung.result.status).toBe("failed");
    expect(hung.result.detail).toContain("timed out");

    const missing = await notify(root, commandConfig, spawnFailed("ENOENT"));

    expect(missing.result.status).toBe("failed");
    expect(missing.result.detail).toContain("could not be started");
  });

  it("writes nothing to the log when the channel is command", async () => {
    const root = buildHarnessProject();

    await notify(root, commandConfig);

    expect(existsSync(join(root, ".harness/state/notifications.jsonl"))).toBe(
      false
    );
  });
});
