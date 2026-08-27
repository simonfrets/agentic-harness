import { readdirSync } from "node:fs";
import { join } from "node:path";

import { BUILT_IN_AGENT_IDS } from "../../../src/agents/agent-id.js";
import type { BuiltInAgentId } from "../../../src/agents/agent-id.js";
import { loadAgentDefinition } from "../../../src/agents/agent-definition.js";
import type { AgentDefinition } from "../../../src/agents/agent-definition.js";
import { loadHarnessRuleSet } from "../../../src/harness/load-harness-rule-set.js";
import {
  listHarnessTemplateFiles,
  readHarnessTemplateFile,
} from "../../../src/install/harness-templates.js";
import { compileAgentPolicy } from "../../../src/prompts/compile-agent-policy.js";
import type { ResolvedRuleSet } from "../../../src/rules/resolve-rule-set.js";
import {
  buildAgentContext,
  readAgentContext,
  writeAgentContext,
} from "../../../src/tasks/agent-context.js";
import { readTaskFile, requireTask } from "../../../src/tasks/task-file.js";
import type { Task, TaskState } from "../../../src/tasks/task-schema.js";
import {
  approveSpecification,
  createTask,
  transitionTask,
} from "../../../src/tasks/transition-task.js";
import { updateTaskFile } from "../../../src/tasks/update-task-file.js";
import { completedStages, pendingStages } from "../../../src/tasks/workflow.js";
import { buildHarnessProject } from "../../helpers/harness-project.js";
import { removeTempDirectories } from "../../helpers/temp-directory.js";

afterEach(() => {
  removeTempDirectories();
});

const packageRoot = process.cwd();
const AT = new Date("2026-08-27T10:00:00.000Z");

/** The six definitions the harness actually ships, not test doubles. */
const definitions = new Map<string, AgentDefinition>(
  listHarnessTemplateFiles(packageRoot)
    .filter((file) => /^agents\/[^/]+\.yaml$/.test(file.installedPath))
    .map((file) => {
      const definition = loadAgentDefinition(
        readHarnessTemplateFile(packageRoot, file.templatePath),
        { source: file.installedPath }
      );

      return [definition.id, definition];
    })
);

const definitionOf = (id: string): AgentDefinition => {
  const definition = definitions.get(id);

  if (definition === undefined) {
    throw new Error(`the harness ships no definition for ${id}`);
  }

  return definition;
};

/** A project with the shipped rules in place, so the policy is the real one. */
const buildProject = (): string =>
  buildHarnessProject({
    rules: Object.fromEntries(
      listHarnessTemplateFiles(packageRoot)
        .filter((file) => /^rules\/[^/]+\.yaml$/.test(file.installedPath))
        .map((file) => [
          file.installedPath.slice("rules/".length),
          readHarnessTemplateFile(packageRoot, file.templatePath),
        ])
    ),
  });

const STAGES: readonly (readonly [TaskState, BuiltInAgentId | null])[] = [
  ["specified", "specifier"],
  ["awaiting_approval", null],
  ["implementing", "coder"],
  ["cleaning", "cleaner"],
  ["architecture_review", "architect"],
  ["hardening", "hardener"],
  ["qa", "qa"],
  ["completed", null],
];

const only = (root: string): Task =>
  requireTask(readTaskFile(root), "add-login");

/**
 * Runs one handoff exactly as a runtime would: write the next agent's context
 * first, then record the transition that points at it.
 */
const handOff = async (
  root: string,
  ruleSet: ResolvedRuleSet,
  to: TaskState,
  toAgent: BuiltInAgentId | null
): Promise<void> => {
  await updateTaskFile(root, (file) => {
    const task = requireTask(file, "add-login");
    const approved =
      to === "implementing"
        ? approveSpecification(file, {
            taskId: task.id,
            expectedRevision: task.revision,
            approvedBy: "a-reviewer",
            ruleSetSha256: ruleSet.sha256,
            at: AT,
          })
        : file;
    const current = requireTask(approved, "add-login");
    const definition = toAgent === null ? null : definitionOf(toAgent);
    const contextPath =
      definition === null
        ? null
        : writeAgentContext(
            root,
            buildAgentContext({
              task: current,
              definition,
              policy: compileAgentPolicy({ agentId: definition.id, ruleSet }),
              ruleSetSha256: ruleSet.sha256,
              at: AT,
              attempt: 1,
              handoff: {
                fromAgent: current.agentId,
                fromState: current.state,
                gateReportIds: [],
                artifactPaths: [],
                failure: null,
              },
            })
          );

    return transitionTask(approved, {
      taskId: task.id,
      expectedRevision: current.revision,
      to,
      toAgent,
      ruleSetSha256: ruleSet.sha256,
      at: AT,
      contextPath,
    });
  });
};

const start = async (root: string): Promise<ResolvedRuleSet> => {
  const ruleSet = loadHarnessRuleSet({ projectRoot: root });

  await updateTaskFile(root, (file) =>
    createTask(file, {
      id: "add-login",
      title: "Add login",
      runId: "run-1",
      at: AT,
    })
  );

  return ruleSet;
};

describe("agent contexts across a run", () => {
  it("gives each of the six shipped agents its own context and tool policy", async () => {
    const root = buildProject();
    const ruleSet = await start(root);

    for (const [to, toAgent] of STAGES) {
      await handOff(root, ruleSet, to, toAgent);
    }

    const agentsDirectory = join(root, ".harness/state/runs/run-1/agents");

    expect(readdirSync(agentsDirectory).sort()).toEqual([
      ...BUILT_IN_AGENT_IDS,
    ]);

    for (const id of BUILT_IN_AGENT_IDS) {
      const context = readAgentContext(
        root,
        `.harness/state/runs/run-1/agents/${id}`
      );
      const definition = definitionOf(id);

      expect(context.agentId).toBe(id);
      expect(context.tools).toEqual(definition.tools);
      expect(context.writeScopes).toEqual(definition.writeScopes);
      expect(context.projectScripts).toEqual(definition.projectScripts);
      expect(context.policy).toContain(`# Agent policy: ${id}`);
      expect(context.ruleSetSha256).toBe(ruleSet.sha256);
    }
  });

  it("compiles a different set of rules into each agent's policy", async () => {
    const root = buildProject();
    const ruleSet = await start(root);

    for (const [to, toAgent] of STAGES) {
      await handOff(root, ruleSet, to, toAgent);
    }

    const policyOf = (id: string): string =>
      readAgentContext(root, `.harness/state/runs/run-1/agents/${id}`).policy;

    // Asserting the six documents merely differ would pass on the heading
    // alone. `typescript.no-explicit-any` is shipped for the three agents that
    // write TypeScript and nobody else, so it is what separates the content.
    for (const id of ["coder", "cleaner", "hardener"]) {
      expect(policyOf(id)).toContain("typescript.no-explicit-any");
    }

    for (const id of ["architect", "qa", "specifier"]) {
      expect(policyOf(id)).not.toContain("typescript.no-explicit-any");
    }

    expect(new Set(BUILT_IN_AGENT_IDS.map(policyOf)).size).toBe(
      BUILT_IN_AGENT_IDS.length
    );
  });

  it("points each transition at the context the agent it handed to received", async () => {
    const root = buildProject();
    const ruleSet = await start(root);

    for (const [to, toAgent] of STAGES) {
      await handOff(root, ruleSet, to, toAgent);
    }

    for (const record of only(root).history) {
      if (record.toAgent === null) {
        continue;
      }

      expect(record.contextPath).toBe(
        `.harness/state/runs/run-1/agents/${record.toAgent}`
      );
      expect(readAgentContext(root, record.contextPath ?? "").agentId).toBe(
        record.toAgent
      );
    }
  });
});

describe("a workflow that was stopped", () => {
  it("resumes from tasks.yaml at the stage it stopped, with the rest done", async () => {
    const root = buildProject();
    const ruleSet = await start(root);

    for (const [to, toAgent] of STAGES.slice(0, 4)) {
      await handOff(root, ruleSet, to, toAgent);
    }

    // Everything above is one process. Nothing below shares state with it:
    // the file on disk is the whole handover.
    const resumed = only(root);

    expect(resumed.state).toBe("cleaning");
    expect(completedStages(resumed)).toEqual([
      "draft",
      "specified",
      "awaiting_approval",
      "implementing",
    ]);
    expect(pendingStages(resumed)).toEqual([
      "cleaning",
      "architecture_review",
      "hardening",
      "qa",
      "completed",
    ]);

    // The specifier and the coder already ran; a resumed run must not run them
    // again, and it does not have to, because their evidence is on disk.
    expect(resumed.history.map((record) => record.to)).toEqual([
      "specified",
      "awaiting_approval",
      "awaiting_approval",
      "implementing",
      "cleaning",
    ]);
    expect(resumed.approvedBy).toBe("a-reviewer");
    expect(
      readAgentContext(root, ".harness/state/runs/run-1/agents/coder").taskId
    ).toBe("add-login");

    for (const [to, toAgent] of STAGES.slice(4)) {
      await handOff(root, ruleSet, to, toAgent);
    }

    const finished = only(root);

    expect(finished.state).toBe("completed");
    // Five transitions before the stop, four after. Nothing was repeated.
    expect(finished.history).toHaveLength(9);
    expect(
      finished.history.filter((record) => record.to === "implementing")
    ).toHaveLength(1);
  });
});
