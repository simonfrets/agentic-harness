import fs from 'node:fs';

import { loadAgent } from '../../src/core/agents/load';
import { loadConfig } from '../../src/core/config/load';
import type { GateOutcome } from '../../src/core/gates';
import { applyHandoff, nextUp } from '../../src/core/handoff';
import { harnessPaths, type HarnessPaths } from '../../src/core/paths';
import { readEvents } from '../../src/core/tasks/events';
import { readTasksFile } from '../../src/core/tasks/store';
import { cleanupTempDirs, tempDir, write } from '../helpers/fixture';

afterAll(cleanupTempDirs);

const AGENTS: Record<string, string> = {
  specifier: 'handoff_to: coder\nstatus: specifying\n',
  coder: 'handoff_to: cleaner\nstatus: coding\n',
  cleaner: 'handoff_to: architect\nstatus: cleaning\n',
  architect: 'handoff_to: hardener\nstatus: architecture-review\n',
  hardener: 'handoff_to: qa\nstatus: hardening\n',
  qa: 'status: qa\n',
};

function seed(): HarnessPaths {
  const paths = harnessPaths(tempDir());
  fs.mkdirSync(paths.dir, { recursive: true });
  for (const [name, extra] of Object.entries(AGENTS)) {
    write(`${paths.agents}/${name}.yaml`, `name: ${name}\nprompt: prompts/${name}.md\n${extra}`);
    write(`${paths.prompts}/${name}.md`, `${name} prompt\n`);
  }
  write(
    paths.tasks,
    `version: 1
tasks:
  - id: T-001
    title: Add reset
    status: coding
    owner: coder
`,
  );
  return paths;
}

function handoff(
  paths: HarnessPaths,
  agent: string,
  options: { summary?: string; gates?: GateOutcome[]; reject?: string; checklist?: Record<string, boolean> } = {},
): ReturnType<typeof applyHandoff> {
  return applyHandoff({
    paths,
    config: loadConfig(paths),
    agent: loadAgent(paths, agent),
    taskId: 'T-001',
    summary: options.summary ?? 'did the work',
    checklist: options.checklist ?? {},
    gates: options.gates ?? [],
    ...(options.reject === undefined ? {} : { reject: options.reject }),
  });
}

describe('applyHandoff', () => {
  it('moves the task to the next agent and its status', () => {
    const paths = seed();
    const result = handoff(paths, 'coder');
    expect(result.to).toBe('cleaner');
    const task = readTasksFile(paths).tasks[0];
    expect(task?.owner).toBe('cleaner');
    expect(task?.status).toBe('cleaning');
  });

  it('records the handoff with its summary and checklist', () => {
    const paths = seed();
    handoff(paths, 'coder', { summary: 'three scenarios green', checklist: { suite_green: true } });
    const [entry] = readTasksFile(paths).tasks[0]?.handoffs ?? [];
    expect(entry?.from).toBe('coder');
    expect(entry?.to).toBe('cleaner');
    expect(entry?.summary).toBe('three scenarios green');
    expect(entry?.checklist).toEqual({ suite_green: true });
  });

  it('marks the task done when the final stage hands off', () => {
    const paths = seed();
    const result = handoff(paths, 'qa');
    expect(result.to).toBeUndefined();
    expect(readTasksFile(paths).tasks[0]?.status).toBe('done');
  });

  it('blocks the task when any gate failed, without advancing it', () => {
    const paths = seed();
    const gates: GateOutcome[] = [
      { id: 'write-scope', result: 'fail', detail: 'infra/deploy.tf' },
      { id: 'tdd-pair', result: 'pass' },
    ];
    const result = handoff(paths, 'coder', { gates });
    expect(result.blocked).toBe(true);
    const task = readTasksFile(paths).tasks[0];
    expect(task?.status).toBe('blocked');
    expect(task?.owner).toBe('coder');
  });

  it('writes every gate result onto the task so a block is diagnosable', () => {
    const paths = seed();
    handoff(paths, 'coder', {
      gates: [
        { id: 'write-scope', result: 'fail', detail: 'infra/deploy.tf' },
        { id: 'tdd-pair', result: 'pass' },
      ],
    });
    expect(readTasksFile(paths).tasks[0]?.gates).toEqual({ 'write-scope': 'fail', 'tdd-pair': 'pass' });
  });

  it('sends a rejected task back to the rework agent with the reason', () => {
    const paths = seed();
    const result = handoff(paths, 'hardener', { reject: 'boundary case untested' });
    expect(result.to).toBe('coder');
    const task = readTasksFile(paths).tasks[0];
    expect(task?.owner).toBe('coder');
    expect(task?.status).toBe('coding');
    expect(task?.handoffs.at(-1)?.reason).toBe('boundary case untested');
  });

  it('does not advance a rejected task even when gates passed', () => {
    const paths = seed();
    handoff(paths, 'architect', { reject: 'dependency direction inverted', gates: [{ id: 'tdd-pair', result: 'pass' }] });
    expect(readTasksFile(paths).tasks[0]?.owner).toBe('coder');
  });

  it('appends an event for the handoff', () => {
    const paths = seed();
    handoff(paths, 'coder', { summary: 'done' });
    const events = readEvents(paths, 'T-001');
    expect(events.map((e) => e.type)).toContain('handoff');
    expect(events.at(-1)?.['to']).toBe('cleaner');
  });

  it('appends a gate.failed event when it blocks', () => {
    const paths = seed();
    handoff(paths, 'coder', { gates: [{ id: 'tdd-pair', result: 'fail', detail: 'no tests' }] });
    expect(readEvents(paths, 'T-001').map((e) => e.type)).toContain('gate.failed');
  });
});

describe('nextUp', () => {
  it('names the agent holding the first unfinished task', () => {
    const paths = seed();
    expect(nextUp(readTasksFile(paths))).toEqual({ task: 'T-001', agent: 'coder' });
  });

  it('is undefined once everything is done', () => {
    const paths = seed();
    handoff(paths, 'coder');
    handoff(paths, 'cleaner');
    handoff(paths, 'architect');
    handoff(paths, 'hardener');
    handoff(paths, 'qa');
    expect(nextUp(readTasksFile(paths))).toBeUndefined();
  });

  it('skips blocked tasks rather than presenting them as runnable', () => {
    const paths = seed();
    handoff(paths, 'coder', { gates: [{ id: 'tdd-pair', result: 'fail' }] });
    expect(nextUp(readTasksFile(paths))).toBeUndefined();
  });
});
