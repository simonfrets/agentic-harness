import fs from 'node:fs';
import path from 'node:path';

import { readAgentPrompt } from '../agents/load';
import type { AgentDefinition } from '../agents/schema';
import type { HarnessPaths } from '../paths';
import { rulesFor } from '../rules/load';
import type { Rule } from '../rules/schema';
import type { Handoff, Task } from '../tasks/schema';

export interface ContextInput {
  paths: HarnessPaths;
  agent: AgentDefinition;
  task: Task;
  rules: Rule[];
}

/**
 * The last handoff addressed to this agent. Everything earlier belongs to
 * other agents' histories and is deliberately not shown.
 */
function inboundHandoff(task: Task, agent: string): Handoff | undefined {
  return [...task.handoffs].reverse().find((handoff) => handoff.to === agent);
}

function readSpec(paths: HarnessPaths, task: Task): string | undefined {
  if (task.spec === undefined) return undefined;
  try {
    return fs.readFileSync(path.resolve(paths.dir, task.spec), 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Build the single document an agent is given for one task.
 *
 * Context isolation is the point: an agent sees its own prompt, its own rules,
 * the task row, the accepted spec and the *summary* of the handoff addressed to
 * it. It never sees another agent's transcript or working notes -- those stay
 * in that agent's own state directory.
 */
export function renderContext(input: ContextInput): string {
  const { paths, agent, task, rules } = input;
  const applicable = rulesFor(rules, agent.name);
  const inbound = inboundHandoff(task, agent.name);
  const spec = readSpec(paths, task);
  const out: string[] = [];

  out.push(`# ${agent.name} — ${task.id}`);
  out.push('');
  out.push(`> ${agent.description || `You are the ${agent.name} agent.`}`);
  out.push('');
  out.push(readAgentPrompt(paths, agent).trimEnd());
  out.push('');

  out.push('## Task');
  out.push('');
  out.push(`- **id**: ${task.id}`);
  out.push(`- **title**: ${task.title}`);
  out.push(`- **status**: ${task.status}`);
  if (task.branch !== undefined) out.push(`- **branch**: ${task.branch}`);
  if (task.intent !== '') {
    out.push('');
    out.push('### Original intent');
    out.push('');
    out.push(task.intent);
  }
  if (task.artifacts.length > 0) {
    out.push('');
    out.push('### Artifacts so far');
    out.push('');
    for (const artifact of task.artifacts) out.push(`- \`${artifact}\``);
  }
  out.push('');

  if (inbound !== undefined) {
    out.push(`## Handoff from ${inbound.from}`);
    out.push('');
    out.push(inbound.summary);
    if (inbound.reason !== undefined) {
      out.push('');
      out.push(`**Sent back because:** ${inbound.reason}`);
    }
    const declared = Object.entries(inbound.checklist);
    if (declared.length > 0) {
      out.push('');
      out.push('They reported:');
      for (const [id, done] of declared) out.push(`- [${done ? 'x' : ' '}] ${id}`);
    }
    out.push('');
  }

  if (spec !== undefined) {
    out.push('## Accepted specification');
    out.push('');
    out.push('```gherkin');
    out.push(spec.trimEnd());
    out.push('```');
    out.push('');
  }

  if (applicable.length > 0) {
    out.push('## Rules');
    out.push('');
    for (const rule of applicable) {
      const label = rule.enforcement === 'blocking' ? '**blocking**' : 'advisory';
      out.push(`### ${rule.id} (${label})`);
      out.push('');
      out.push(rule.body.trim());
      out.push('');
    }
  }

  if (agent.writeScope.length > 0) {
    out.push('## Write scope');
    out.push('');
    out.push('You may only create or modify files matching these globs. The handoff gate diffs');
    out.push('the worktree and blocks you if anything else changed.');
    out.push('');
    for (const glob of agent.writeScope) out.push(`- \`${glob}\``);
    out.push('');
  }

  out.push('## Finishing');
  out.push('');
  out.push(`Write your summary to \`output.md\` in your state directory, then report this checklist:`);
  out.push('');
  if (agent.checklist.length > 0) {
    for (const item of agent.checklist) out.push(`- \`${item.id}\` — ${item.description}`);
  } else {
    out.push('- _(no checklist declared)_');
  }
  out.push('');
  out.push(
    agent.handoffTo === undefined
      ? 'You are the final stage: on success the task is marked done.'
      : `On success the task hands off to **${agent.handoffTo}**.`,
  );
  out.push('');

  return out.join('\n');
}
