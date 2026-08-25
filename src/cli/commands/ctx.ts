import fs from 'node:fs';
import path from 'node:path';

import { renderAgentEnv } from '../../core/agents/compile';
import { loadAgent } from '../../core/agents/load';
import { renderContext } from '../../core/context/render';
import { taskStateDir } from '../../core/paths';
import { findTask, readTasksFile } from '../../core/tasks/store';
import { out, session } from '../util';

export interface CtxOptions {
  task: string;
  agent: string;
  adapter?: string;
  mode?: 'headless' | 'interactive';
  model?: string;
}

/**
 * Build one agent's working set for one task: the context document it reads and
 * the env file the shell runtime sources. This is the seam between the two
 * halves of the harness -- past this point the shell needs no YAML.
 */
export function ctx(options: CtxOptions): void {
  const { paths, config, rules } = session();
  const agent = loadAgent(paths, options.agent);
  const task = findTask(readTasksFile(paths), options.task);
  const adapter = options.adapter ?? config.adapter;

  const stateDir = taskStateDir(paths, task.id, agent.name);
  fs.mkdirSync(stateDir, { recursive: true });

  fs.writeFileSync(path.join(stateDir, 'context.md'), renderContext({ paths, agent, task, rules }));
  fs.writeFileSync(
    path.join(stateDir, 'agent.env'),
    renderAgentEnv(paths, agent, {
      adapter,
      taskId: task.id,
      mode: options.mode ?? 'headless',
      ...(options.model === undefined ? {} : { model: options.model }),
    }),
  );

  out(stateDir);
}
