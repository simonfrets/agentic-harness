import fs from 'node:fs';
import path from 'node:path';

import { HarnessError } from '../errors';
import type { HarnessPaths } from '../paths';
import { readYamlWith } from '../yaml';
import { agentSchema, type AgentDefinition } from './schema';

function agentFile(paths: HarnessPaths, name: string): string {
  return path.join(paths.agents, `${name}.yaml`);
}

export function loadAgent(paths: HarnessPaths, name: string): AgentDefinition {
  const file = agentFile(paths, name);
  if (!fs.existsSync(file)) {
    const known = listAgentNames(paths).join(', ') || '<none>';
    throw new HarnessError('AGENT_NOT_FOUND', `no agent "${name}"`, `known agents: ${known}`);
  }

  const agent = readYamlWith(file, agentSchema, 'SCHEMA_INVALID');
  if (agent.name !== name) {
    throw new HarnessError(
      'SCHEMA_INVALID',
      `${file} declares name "${agent.name}" but is filed as "${name}"`,
      'the filename is the agent id -- rename one of them',
    );
  }
  return agent;
}

export function listAgentNames(paths: HarnessPaths): string[] {
  try {
    return fs
      .readdirSync(paths.agents)
      .filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'))
      .map((file) => path.basename(file, path.extname(file)))
      .sort();
  } catch {
    return [];
  }
}

export function loadAgents(paths: HarnessPaths): AgentDefinition[] {
  return listAgentNames(paths).map((name) => loadAgent(paths, name));
}

/** The prompt body an agent's context is built around. */
export function readAgentPrompt(paths: HarnessPaths, agent: AgentDefinition): string {
  const file = path.resolve(paths.dir, agent.prompt);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    throw new HarnessError(
      'SCHEMA_INVALID',
      `agent "${agent.name}" points at a missing prompt: ${agent.prompt}`,
      `expected ${file}`,
    );
  }
}
