import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { BUILT_IN_AGENT_IDS } from "../../../src/agents/agent-id.js";
import {
  listHarnessTemplateFiles,
  readHarnessTemplateFile,
} from "../../../src/install/harness-templates.js";
import { compileAgentPolicy } from "../../../src/prompts/compile-agent-policy.js";
import { loadRuleBundle } from "../../../src/rules/load-rule-bundle.js";
import { resolveRuleSet } from "../../../src/rules/resolve-rule-set.js";
import type { RuleSource } from "../../../src/rules/resolve-rule-set.js";
import type { Rule } from "../../../src/rules/rule-schema.js";
import {
  createTempDirectory,
  removeTempDirectories,
} from "../../helpers/temp-directory.js";

afterEach(() => {
  removeTempDirectories();
});

const packageRoot = process.cwd();

const ruleBundleFiles = listHarnessTemplateFiles(packageRoot).filter((file) =>
  /^rules\/[^/]+\.yaml$/.test(file.installedPath)
);

const sources: readonly RuleSource[] = ruleBundleFiles.map((file) => ({
  origin: "builtin" as const,
  location: file.installedPath,
  bundle: loadRuleBundle(readHarnessTemplateFile(packageRoot, file), {
    source: file.installedPath,
  }),
}));

const allRules: readonly Rule[] = sources.flatMap(
  (source) => source.bundle.rules
);

describe("shipped rule bundles", () => {
  it("ships the three documented bundles", () => {
    expect(ruleBundleFiles.map((file) => file.installedPath)).toEqual([
      "rules/base.yaml",
      "rules/git.yaml",
      "rules/typescript.yaml",
    ]);
  });

  it("resolves into one rule set with no duplicate ids", () => {
    const ruleSet = resolveRuleSet(sources);

    expect(ruleSet.rules).toHaveLength(allRules.length);
    expect(ruleSet.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("targets only the six built-in agents", () => {
    for (const rule of allRules) {
      expect(rule.appliesTo.length).toBeGreaterThan(0);
      for (const agent of rule.appliesTo) {
        expect(BUILT_IN_AGENT_IDS).toContain(agent);
      }
    }
  });

  it("gives every rule an instruction an agent can act on", () => {
    for (const rule of allRules) {
      expect(rule.instruction.trim().length).toBeGreaterThan(80);
      expect(rule.instruction).not.toMatch(/TODO|TBD|placeholder|FIXME/i);
    }
  });

  it("never runs a project script that rewrites the working tree", () => {
    // `format` is `--write` in most projects, and a gate that edits files
    // while a commit is being prepared would change what is committed.
    const scripts = allRules.flatMap((rule) =>
      rule.checks.flatMap((check) =>
        check.runner === "project-script" ? [check.script] : []
      )
    );

    expect(scripts).not.toContain("format");
    expect(scripts).toEqual(
      expect.arrayContaining(["test", "build", "lint", "typecheck"])
    );
  });

  it("runs only git as an explicit command check", () => {
    const argvs = allRules.flatMap((rule) =>
      rule.checks.flatMap((check) =>
        check.runner === "command" ? [check.argv] : []
      )
    );

    expect(argvs).toHaveLength(1);
    for (const argv of argvs) {
      expect(argv[0]).toBe("git");
      expect(argv.join(" ")).not.toMatch(/[|;&$`><]/);
    }
  });

  it("compiles into a policy for every built-in agent", () => {
    const ruleSet = resolveRuleSet(sources);

    for (const agentId of BUILT_IN_AGENT_IDS) {
      const policy = compileAgentPolicy({ agentId, ruleSet });

      expect(policy).toContain(`# Agent policy: ${agentId}`);
      expect(policy).toContain(ruleSet.sha256);
      expect(policy).not.toContain(packageRoot);
    }
  });

  it("gives the coder every blocking gate", () => {
    const policy = compileAgentPolicy({
      agentId: "coder",
      ruleSet: resolveRuleSet(sources),
    });

    for (const checkId of [
      "native-test",
      "native-build",
      "native-lint",
      "native-typecheck",
      "git-diff-check",
    ]) {
      expect(policy).toContain(checkId);
    }
  });
});

describe("the shipped .gitignore", () => {
  const git = (root: string, args: readonly string[]) =>
    spawnSync("git", [...args], { cwd: root, encoding: "utf8" });

  const buildRepository = (): string => {
    const root = createTempDirectory("agentic-harness-gitignore-");
    const contents = readHarnessTemplateFile(packageRoot, {
      templatePath: "gitignore",
      installedPath: ".gitignore",
    });
    const target = join(root, ".harness", ".gitignore");

    git(root, ["init", "--quiet"]);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);

    return root;
  };

  const isIgnored = (root: string, path: string): boolean =>
    git(root, ["check-ignore", "--quiet", path]).status === 0;

  it("ignores the private dependency tree, run state and logs", () => {
    const root = buildRepository();

    for (const path of [
      ".harness/node_modules/agentic-harness/package.json",
      ".harness/state/runs/run-1/agents/coder/transcript.json",
      ".harness/debug.log",
      ".harness/install.tmp",
      ".harness/harness.lock",
    ]) {
      expect(isIgnored(root, path)).toBe(true);
    }
  });

  it("keeps rules, agent definitions and task state under review", () => {
    const root = buildRepository();

    for (const path of [
      ".harness/tasks.yaml",
      ".harness/version.json",
      ".harness/rules/base.yaml",
      ".harness/rules/custom/team.yaml",
      ".harness/agents/coder.yaml",
      ".harness/hooks/pre-commit",
      ".harness/bin/harness",
    ]) {
      expect(isIgnored(root, path)).toBe(false);
    }
  });
});
