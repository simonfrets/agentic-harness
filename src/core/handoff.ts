import { loadAgent } from './agents/load';
import type { AgentDefinition } from './agents/schema';
import type { HarnessConfig } from './config/schema';
import type { GateOutcome } from './gates';
import { gatesPassed } from './gates';
import type { HarnessPaths } from './paths';
import { appendEvent } from './tasks/events';
import type { GateResult, Task, TaskStatus, TasksFile } from './tasks/schema';
import { findTask, updateTasksFile } from './tasks/store';

/**
 * Fallback status per stage, used when an agent does not declare its own.
 * A project that renames its agents just sets `status:` in the agent YAML.
 */
const STAGE_STATUS: Record<string, TaskStatus> = {
  specifier: 'specifying',
  coder: 'coding',
  cleaner: 'cleaning',
  architect: 'architecture-review',
  hardener: 'hardening',
  qa: 'qa',
};

/** An agent's own declared status wins; the stage map is only a fallback. */
function statusForAgent(paths: HarnessPaths, agent: string): TaskStatus {
  try {
    const declared = loadAgent(paths, agent).status;
    if (declared !== undefined) return declared;
  } catch {
    // Unknown agent -- fall back to the stage map.
  }
  return STAGE_STATUS[agent] ?? 'coding';
}

export interface HandoffInput {
  paths: HarnessPaths;
  config: HarnessConfig;
  agent: AgentDefinition;
  taskId: string;
  summary: string;
  checklist: Record<string, boolean>;
  gates: GateOutcome[];
  /** Set when this agent is bouncing the task back rather than advancing it. */
  reject?: string;
  /** Overrides the status the receiving agent's stage would normally imply. */
  status?: TaskStatus;
}

export interface HandoffResult {
  task: Task;
  to: string | undefined;
  status: TaskStatus;
  blocked: boolean;
}

function recordGates(task: Task, gates: GateOutcome[]): void {
  for (const gate of gates) {
    task.gates[gate.id] = gate.result satisfies GateResult;
  }
}

/**
 * Advance, bounce or block a task. This is the only place ownership changes,
 * which is what keeps tasks.yaml a trustworthy record of who held what.
 */
export function applyHandoff(input: HandoffInput): HandoffResult {
  const { paths, config, agent, taskId, gates } = input;
  const now = new Date().toISOString();
  const failed = gates.filter((gate) => gate.result === 'fail');

  let result!: HandoffResult;

  updateTasksFile(paths, (file) => {
    const task = findTask(file, taskId);
    recordGates(task, gates);
    task.updatedAt = now;

    if (!gatesPassed(gates)) {
      task.status = 'blocked';
      result = { task, to: undefined, status: 'blocked', blocked: true };
      return;
    }

    const to =
      input.reject === undefined
        ? agent.handoffTo
        : config.reworkAgent;

    const status: TaskStatus =
      input.status ?? (to === undefined ? 'done' : statusForAgent(paths, to));

    task.handoffs.push({
      from: agent.name,
      to: to ?? 'done',
      at: now,
      summary: input.summary,
      checklist: input.checklist,
      ...(input.reject === undefined ? {} : { reason: input.reject }),
    });

    task.owner = to ?? agent.name;
    task.status = status;
    result = { task, to, status, blocked: false };
  });

  if (result.blocked) {
    for (const gate of failed) {
      appendEvent(paths, taskId, {
        type: 'gate.failed',
        agent: agent.name,
        gate: gate.id,
        detail: gate.detail ?? '',
      });
    }
  } else {
    appendEvent(paths, taskId, {
      type: input.reject === undefined ? 'handoff' : 'handoff.rejected',
      agent: agent.name,
      to: result.to ?? 'done',
      status: result.status,
      summary: input.summary,
      ...(input.reject === undefined ? {} : { reason: input.reject }),
    });
  }

  return result;
}

export interface NextUp {
  task: string;
  agent: string;
}

/** The first task that is neither finished nor stuck, and who owns it. */
export function nextUp(file: TasksFile): NextUp | undefined {
  const task = file.tasks.find((candidate) => candidate.status !== 'done' && candidate.status !== 'blocked');
  return task === undefined ? undefined : { task: task.id, agent: task.owner };
}
