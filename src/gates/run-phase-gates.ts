import { createHash, randomUUID } from "node:crypto";

import type { AgentId } from "../agents/agent-id.js";
import { describeCommandResult } from "../processes/command-runner.js";
import type {
  CommandResult,
  CommandRunner,
  CommandSpec,
} from "../processes/command-runner.js";
import type { ProjectProfile } from "../project/project-profile-schema.js";
import type {
  ResolvedRule,
  ResolvedRuleSet,
} from "../rules/resolve-rule-set.js";
import type {
  Phase,
  ProjectScriptCheck,
  RuleCheck,
  Severity,
} from "../rules/rule-schema.js";
import { resolveProjectScript } from "./resolve-project-script.js";

export type GateStatus =
  "passed" | "failed" | "skipped" | "timed-out" | "spawn-failed";

export interface GateResult {
  readonly ruleId: string;
  readonly checkId: string;
  readonly severity: Severity;
  readonly required: boolean;
  /** A required check on an error rule. Only a blocking failure stops a phase. */
  readonly blocking: boolean;
  readonly status: GateStatus;
  /** Null when the check never resolved to something runnable. */
  readonly command: CommandSpec | null;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly outputTruncated: boolean;
  readonly durationMs: number;
  /** One printable line stating what happened. Always populated. */
  readonly detail: string;
}

export type PhaseGateStatus = "passed" | "passed-with-warnings" | "failed";

export interface PhaseGateReport {
  readonly reportId: string;
  readonly phase: Phase;
  readonly agentId: AgentId | null;
  readonly ruleSetSha256: string;
  readonly status: PhaseGateStatus;
  readonly blocked: boolean;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly results: readonly GateResult[];
  /** Checks that exist in the rule set but do not apply to this phase or agent. */
  readonly skippedCheckIds: readonly string[];
  readonly blockingFailureCount: number;
  readonly warningFailureCount: number;
}

export interface RunPhaseGatesOptions {
  readonly ruleSet: ResolvedRuleSet;
  readonly phase: Phase;
  /** Null runs every check for the phase, regardless of which agent owns it. */
  readonly agentId: AgentId | null;
  readonly profile: ProjectProfile;
  readonly runner: CommandRunner;
  readonly now: () => Date;
  readonly createReportId: () => string;
}

export const createDefaultReportId = (): string => randomUUID();

/** Stable id for callers that need a report reproducible from its inputs. */
export const createDeterministicReportId = (input: {
  readonly phase: Phase;
  readonly agentId: AgentId | null;
  readonly ruleSetSha256: string;
  readonly startedAt: string;
}): string =>
  createHash("sha256")
    .update(
      [
        input.phase,
        input.agentId ?? "",
        input.ruleSetSha256,
        input.startedAt,
      ].join(" "),
      "utf8"
    )
    .digest("hex")
    .slice(0, 32);

const statusOfResult = (result: CommandResult): GateStatus => {
  switch (result.outcome) {
    case "exited":
      return result.exitCode === 0 ? "passed" : "failed";
    case "signaled":
      return "failed";
    case "timed-out":
      return "timed-out";
    case "spawn-failed":
      return "spawn-failed";
  }
};

const exitCodeOf = (result: CommandResult): number | null =>
  result.outcome === "exited" ? result.exitCode : null;

const signalOf = (result: CommandResult): NodeJS.Signals | null =>
  result.outcome === "signaled" ? result.signal : null;

interface SharedGateFields {
  readonly ruleId: string;
  readonly checkId: string;
  readonly severity: Severity;
  readonly required: boolean;
  readonly blocking: boolean;
}

const toGateResult = (
  shared: SharedGateFields,
  result: CommandResult
): GateResult => ({
  ...shared,
  status: statusOfResult(result),
  command: result.command,
  exitCode: exitCodeOf(result),
  signal: signalOf(result),
  stdout: result.output.stdout,
  stderr: result.output.stderr,
  outputTruncated: result.output.truncated,
  durationMs: result.durationMs,
  detail: describeCommandResult(result),
});

interface SelectedCheck {
  readonly rule: ResolvedRule;
  readonly check: RuleCheck;
}

const appliesToAgent = (rule: ResolvedRule, agentId: AgentId | null): boolean =>
  agentId === null || rule.appliesTo.includes(agentId);

const isFailure = (result: GateResult): boolean =>
  result.status !== "passed" && result.status !== "skipped";

/**
 * Runs the checks that apply to a phase and reports what happened.
 *
 * Checks run sequentially so the report order is deterministic and two gates
 * never contend for the same build cache. Every check produces a result: a
 * failure is recorded rather than thrown, and a warning-severity check is
 * recorded in full but never contributes to `blocked`.
 */
export const runPhaseGates = async (
  options: RunPhaseGatesOptions
): Promise<PhaseGateReport> => {
  const startedAtDate = options.now();
  const startedAt = startedAtDate.toISOString();

  const selected: SelectedCheck[] = [];
  const skippedCheckIds: string[] = [];

  for (const rule of options.ruleSet.rules) {
    for (const check of rule.checks) {
      const applies =
        check.phases.includes(options.phase) &&
        appliesToAgent(rule, options.agentId);

      if (applies) {
        selected.push({ rule, check });
      } else {
        skippedCheckIds.push(check.id);
      }
    }
  }

  const results: GateResult[] = [];

  for (const { rule, check } of selected) {
    const shared: SharedGateFields = {
      ruleId: rule.id,
      checkId: check.id,
      severity: rule.severity,
      required: check.required,
      blocking: check.required && rule.severity === "error",
    };

    // The discriminant is read inline so the missing-script branch keeps the
    // narrowed project-script check rather than the whole union.
    let command: CommandSpec;

    if (check.runner === "command") {
      const [executable, ...args] = check.argv;

      command = { executable, args };
    } else {
      const resolution = resolveProjectScript({
        packageManager: options.profile.packageManager,
        script: check.script,
        args: check.args,
        availableScripts: options.profile.availableScripts,
        whenMissing: check.whenMissing,
      });

      if (resolution.kind === "missing") {
        results.push(missingScriptResult(shared, check, options.profile));
        continue;
      }

      command = resolution.command;
    }

    results.push(
      toGateResult(
        shared,
        await options.runner({
          command,
          cwd: options.profile.root,
          env: null,
          timeoutMs: check.timeoutMs,
        })
      )
    );
  }

  const blockingFailureCount = results.filter(
    (result) => result.blocking && isFailure(result)
  ).length;
  const warningFailureCount = results.filter(
    (result) => !result.blocking && isFailure(result)
  ).length;

  const finishedAtDate = options.now();

  return {
    reportId: options.createReportId(),
    phase: options.phase,
    agentId: options.agentId,
    ruleSetSha256: options.ruleSet.sha256,
    status:
      blockingFailureCount > 0
        ? "failed"
        : warningFailureCount > 0
          ? "passed-with-warnings"
          : "passed",
    blocked: blockingFailureCount > 0,
    startedAt,
    finishedAt: finishedAtDate.toISOString(),
    durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
    results,
    skippedCheckIds,
    blockingFailureCount,
    warningFailureCount,
  };
};

function missingScriptResult(
  shared: SharedGateFields,
  check: ProjectScriptCheck,
  profile: ProjectProfile
): GateResult {
  const available =
    profile.availableScripts.length === 0
      ? "the project defines none of them"
      : `available: ${profile.availableScripts.join(", ")}`;

  return {
    ...shared,
    status: check.whenMissing === "skip" ? "skipped" : "failed",
    command: null,
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "",
    outputTruncated: false,
    durationMs: 0,
    detail: `project script "${check.script}" is not defined (${available})`,
  };
}
