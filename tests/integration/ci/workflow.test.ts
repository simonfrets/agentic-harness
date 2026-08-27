import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

const workflow = readFileSync(
  join(process.cwd(), ".github", "workflows", "ci.yml"),
  "utf8"
);

interface Step {
  readonly run?: string;
  readonly uses?: string;
  readonly with?: Readonly<Record<string, unknown>>;
}

const steps = (): readonly Step[] => {
  const parsed: unknown = parse(workflow);
  const jobs =
    typeof parsed === "object" && parsed !== null && "jobs" in parsed
      ? parsed.jobs
      : null;
  const gate =
    typeof jobs === "object" && jobs !== null && "gate" in jobs
      ? jobs.gate
      : null;
  const list =
    typeof gate === "object" && gate !== null && "steps" in gate
      ? gate.steps
      : null;

  if (!Array.isArray(list)) {
    throw new Error("the CI workflow has no `gate` job with steps");
  }

  return list as readonly Step[];
};

/** Every Node version the matrix runs, across both the axis and the includes. */
const nodeVersions = (): readonly string[] => {
  const parsed: unknown = parse(workflow);
  const gate =
    typeof parsed === "object" && parsed !== null && "jobs" in parsed
      ? (parsed.jobs as Record<string, unknown>).gate
      : null;
  const strategy =
    typeof gate === "object" && gate !== null && "strategy" in gate
      ? (gate.strategy as Record<string, unknown>)
      : null;
  const matrix =
    strategy === null ? null : (matrixOf(strategy) as Record<string, unknown>);

  if (matrix === null) {
    throw new Error("the CI workflow has no matrix");
  }

  const axis = Array.isArray(matrix.node) ? (matrix.node as string[]) : [];
  const included = Array.isArray(matrix.include)
    ? (matrix.include as Record<string, unknown>[]).map((entry) =>
        String(entry.node)
      )
    : [];

  return [...axis, ...included];
};

const matrixOf = (strategy: Record<string, unknown>): unknown =>
  strategy.matrix;

const commands = (): readonly string[] =>
  steps().flatMap((step) => (step.run === undefined ? [] : [step.run]));

describe("this repository's CI workflow", () => {
  it("runs every command the completion gate requires", () => {
    // `.husky/pre-commit` runs these locally, but a local hook is skippable
    // with `--no-verify`. Asserting them here is what stops one being quietly
    // dropped from the only place that cannot be skipped.
    expect(commands()).toEqual([
      "npm ci",
      "npm run check",
      "npm run build",
      "npm run test:coverage",
      "npm pack --dry-run",
    ]);
  });

  it("proves the project on every shell target it claims to support", () => {
    // WSL runs the Linux build, so these two cover macOS, Linux and WSL.
    expect(workflow).toContain("ubuntu-latest");
    expect(workflow).toContain("macos-latest");
  });

  it("proves the project on the oldest Node it claims to support", () => {
    // `node-version-file: package.json` reads `engines.node`, which is a
    // range, and setup-node resolves a range to the newest version satisfying
    // it - so the declared minimum would never once have been run.
    const engines: unknown = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8")
    );
    const declared =
      typeof engines === "object" && engines !== null && "engines" in engines
        ? engines.engines
        : null;
    const minimum =
      typeof declared === "object" && declared !== null && "node" in declared
        ? String(declared.node).replace(/^>=/, "")
        : "";

    expect(minimum).toMatch(/^\d+\.\d+\.\d+$/);
    expect(nodeVersions()).toContain(minimum);
  });

  it("also runs a newer Node, so a future release cannot break it unseen", () => {
    expect(nodeVersions().length).toBeGreaterThan(1);
  });

  it("never lets a failing step pass", () => {
    // Asserted against the parsed steps rather than the file text: the header
    // comment explains why `--no-verify` makes CI necessary, and matching that
    // would be the test failing on its own reasoning.
    expect(commands().length).toBeGreaterThan(0);

    for (const command of commands()) {
      expect(command).not.toContain("--no-verify");
      expect(command).not.toContain("|| true");
    }

    for (const step of steps()) {
      expect(step).not.toHaveProperty("continue-on-error");
    }
  });

  it("runs on pull requests, which is where a review needs it", () => {
    expect(parse(workflow)).toMatchObject({ on: { pull_request: null } });
  });
});
