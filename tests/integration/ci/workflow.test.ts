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

  it("takes its Node version from engines, so the two cannot drift", () => {
    const setup = steps().find((step) =>
      step.uses?.startsWith("actions/setup-node")
    );

    expect(setup?.with).toMatchObject({ "node-version-file": "package.json" });
  });

  it("never lets a failing step pass", () => {
    // Asserted against the parsed steps rather than the file text: the header
    // comment explains why `--no-verify` makes CI necessary, and matching that
    // would be the test failing on its own reasoning.
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
