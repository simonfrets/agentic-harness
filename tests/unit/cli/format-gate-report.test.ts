import { formatPhaseGateReport } from "../../../src/cli/format-gate-report.js";
import type {
  GateResult,
  PhaseGateReport,
} from "../../../src/gates/run-phase-gates.js";

const gateResult = (overrides: Partial<GateResult> = {}): GateResult => ({
  ruleId: "typescript.lint-clean",
  checkId: "native-lint",
  severity: "error",
  required: true,
  blocking: true,
  status: "passed",
  command: { executable: "npm", args: ["run", "lint"] },
  exitCode: 0,
  signal: null,
  stdout: "",
  stderr: "",
  outputTruncated: false,
  durationMs: 12,
  detail: "exited with code 0",
  ...overrides,
});

const report = (overrides: Partial<PhaseGateReport> = {}): PhaseGateReport => ({
  reportId: "report-1",
  phase: "pre-commit",
  agentId: null,
  ruleSetSha256: "a".repeat(64),
  status: "passed",
  blocked: false,
  startedAt: "2026-08-26T00:00:00.000Z",
  finishedAt: "2026-08-26T00:00:01.000Z",
  durationMs: 1000,
  results: [gateResult()],
  skippedCheckIds: [],
  blockingFailureCount: 0,
  warningFailureCount: 0,
  ...overrides,
});

describe("formatPhaseGateReport", () => {
  it("reports a passing phase with its rule set hash", () => {
    const text = formatPhaseGateReport(report());

    expect(text).toContain("Phase: pre-commit");
    expect(text).toContain("Agent: any");
    expect(text).toContain(`Rule set: sha256 ${"a".repeat(64)}`);
    expect(text).toContain(
      "PASS typescript.lint-clean / native-lint — exited with code 0 (12ms)"
    );
    expect(text).toContain("Result: passed");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("names the agent when the phase was restricted to one", () => {
    expect(formatPhaseGateReport(report({ agentId: "coder" }))).toContain(
      "Agent: coder"
    );
  });

  it("counts checks that did not apply to the phase", () => {
    expect(
      formatPhaseGateReport(report({ skippedCheckIds: ["native-test"] }))
    ).toContain("1 not applicable to this phase or agent");
  });

  it("shows the command and captured output of a blocking failure", () => {
    const text = formatPhaseGateReport(
      report({
        status: "failed",
        blocked: true,
        blockingFailureCount: 1,
        results: [
          gateResult({
            status: "failed",
            exitCode: 1,
            detail: "exited with code 1",
            stdout: "checking\n",
            stderr: "error: no explicit any\n",
          }),
        ],
      })
    );

    expect(text).toContain("FAIL typescript.lint-clean / native-lint");
    expect(text).toContain("command: npm run lint");
    expect(text).toContain("stdout:");
    expect(text).toContain("checking");
    expect(text).toContain("stderr:");
    expect(text).toContain("error: no explicit any");
    expect(text).toContain("Result: blocked by 1 required check");
  });

  it("records a warning failure without blocking", () => {
    const text = formatPhaseGateReport(
      report({
        status: "passed-with-warnings",
        warningFailureCount: 1,
        results: [
          gateResult({
            severity: "warning",
            blocking: false,
            status: "failed",
            exitCode: 1,
            detail: "exited with code 1",
          }),
        ],
      })
    );

    expect(text).toContain("WARN typescript.lint-clean / native-lint");
    expect(text).toContain("Result: passed with 1 warning failure");
  });

  it("marks a truncated capture and a check with no command", () => {
    const text = formatPhaseGateReport(
      report({
        results: [
          gateResult({
            status: "skipped",
            command: null,
            exitCode: null,
            detail: 'project script "test" is not defined',
          }),
          gateResult({
            status: "timed-out",
            blocking: false,
            exitCode: null,
            stdout: "a lot\n",
            outputTruncated: true,
            detail: "timed out after 1000ms",
          }),
        ],
      })
    );

    expect(text).toContain("SKIP typescript.lint-clean / native-lint");
    expect(text).not.toContain("command: null");
    expect(text).toContain("output was truncated");
  });

  it("caps echoed output and says how much it omitted", () => {
    const text = formatPhaseGateReport(
      report({
        results: [
          gateResult({
            status: "failed",
            exitCode: 1,
            stdout: Array.from(
              { length: 25 },
              (_value, index) => `line ${String(index)}`
            ).join("\n"),
          }),
        ],
      })
    );

    expect(text).toContain("line 19");
    expect(text).not.toContain("line 20");
    expect(text).toContain("5 further line(s) omitted");
  });

  it("pluralises the failure counts", () => {
    expect(
      formatPhaseGateReport(
        report({ status: "failed", blocked: true, blockingFailureCount: 2 })
      )
    ).toContain("Result: blocked by 2 required checks");
    expect(
      formatPhaseGateReport(
        report({ status: "passed-with-warnings", warningFailureCount: 3 })
      )
    ).toContain("Result: passed with 3 warning failures");
  });

  it("states plainly when a phase has no applicable checks", () => {
    expect(formatPhaseGateReport(report({ results: [] }))).toContain(
      "No checks apply to this phase."
    );
  });
});
