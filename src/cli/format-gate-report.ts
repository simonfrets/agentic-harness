import { describeCommand } from "../processes/command-runner.js";
import type {
  GateResult,
  GateStatus,
  PhaseGateReport,
  PhaseGateStatus,
} from "../gates/run-phase-gates.js";

/** Cap on echoed output lines, so one noisy check cannot bury the report. */
const MAX_OUTPUT_LINES = 20;

const labelFor = (result: GateResult): string => {
  const status: GateStatus = result.status;

  switch (status) {
    case "passed":
      return "PASS";
    case "skipped":
      return "SKIP";
    case "failed":
    case "timed-out":
    case "spawn-failed":
      return result.blocking ? "FAIL" : "WARN";
  }
};

const renderCapture = (name: string, text: string): readonly string[] => {
  const lines = text.replace(/\n$/, "").split("\n");
  const shown = lines.slice(0, MAX_OUTPUT_LINES);
  const omitted = lines.length - shown.length;

  return [
    `       ${name}:`,
    ...shown.map((line) => `         ${line}`),
    ...(omitted === 0
      ? []
      : [`         … ${String(omitted)} further line(s) omitted`]),
  ];
};

const renderResult = (result: GateResult): readonly string[] => {
  const lines = [
    `  ${labelFor(result)} ${result.ruleId} / ${result.checkId} — ${
      result.detail
    } (${String(result.durationMs)}ms)`,
  ];

  if (result.status === "passed") {
    return lines;
  }

  if (result.command !== null) {
    lines.push(`       command: ${describeCommand(result.command)}`);
  }

  if (result.stdout !== "") {
    lines.push(...renderCapture("stdout", result.stdout));
  }

  if (result.stderr !== "") {
    lines.push(...renderCapture("stderr", result.stderr));
  }

  if (result.outputTruncated) {
    lines.push("       output was truncated at the capture limit");
  }

  return lines;
};

const plural = (count: number, noun: string): string =>
  `${String(count)} ${noun}${count === 1 ? "" : "s"}`;

const renderOutcome = (report: PhaseGateReport): string => {
  const status: PhaseGateStatus = report.status;

  switch (status) {
    case "passed":
      return "Result: passed";
    case "passed-with-warnings":
      return `Result: passed with ${plural(
        report.warningFailureCount,
        "warning failure"
      )}`;
    case "failed":
      return `Result: blocked by ${plural(
        report.blockingFailureCount,
        "required check"
      )}`;
  }
};

/**
 * Renders a gate report for a terminal.
 *
 * Every check that ran is listed, including the ones that passed, and a
 * failure carries its command and its captured output: a gate that reported
 * only a verdict would make a developer re-run the tool by hand to find out
 * what happened.
 */
export const formatPhaseGateReport = (report: PhaseGateReport): string => {
  const lines = [
    `Phase: ${report.phase}`,
    `Agent: ${report.agentId ?? "any"}`,
    `Rule set: sha256 ${report.ruleSetSha256}`,
    `Checks: ${String(report.results.length)} run, ${String(
      report.skippedCheckIds.length
    )} not applicable to this phase or agent`,
    "",
    ...(report.results.length === 0
      ? ["No checks apply to this phase."]
      : report.results.flatMap(renderResult)),
    "",
    renderOutcome(report),
  ];

  return `${lines.join("\n")}\n`;
};
