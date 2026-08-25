import fs from 'node:fs';

import { loadAgent } from '../../src/core/agents/load';
import { renderContext } from '../../src/core/context/render';
import { harnessPaths, type HarnessPaths } from '../../src/core/paths';
import { loadRules } from '../../src/core/rules/load';
import { parseTasks } from '../../src/core/tasks/store';
import type { Task } from '../../src/core/tasks/schema';
import { cleanupTempDirs, tempDir, write } from '../helpers/fixture';

afterAll(cleanupTempDirs);

const TASKS = `version: 1
tasks:
  - id: T-001
    title: Add password reset
    intent: users forget passwords
    status: coding
    owner: coder
    spec: specs/T-001.feature
    handoffs:
      - from: specifier
        to: coder
        at: "2026-08-25T10:00:00Z"
        summary: three scenarios accepted
        checklist: { spec_accepted: true }
`;

function seed(): { paths: HarnessPaths; task: Task } {
  const paths = harnessPaths(tempDir());
  fs.mkdirSync(paths.dir, { recursive: true });
  write(
    `${paths.agents}/coder.yaml`,
    `name: coder
description: Implements one approved behavior slice with TDD.
model: { claude: sonnet }
effort: high
tools: [Read, Edit]
write_scope: ["src/**", "tests/**"]
rules: [tdd]
prompt: prompts/coder.md
handoff_to: cleaner
checklist:
  - id: tests_first
    description: Every new test was observed failing first.
`,
  );
  write(`${paths.prompts}/coder.md`, 'PROMPT-BODY: you implement one slice.\n');
  write(
    `${paths.rules}/tdd.md`,
    '---\nid: tdd\napplies_to: [coder]\nenforcement: blocking\n---\nRULE-BODY: red before green.\n',
  );
  write(
    `${paths.rules}/architecture.md`,
    '---\nid: architecture\napplies_to: [architect]\nenforcement: advisory\n---\nRULE-BODY: boundaries.\n',
  );
  write(`${paths.specs}/T-001.feature`, 'Feature: Password reset\n  Scenario: SPEC-BODY\n');
  const task = parseTasks(TASKS, 'tasks.yaml').tasks[0]!;
  return { paths, task };
}

function render(): string {
  const { paths, task } = seed();
  return renderContext({
    paths,
    agent: loadAgent(paths, 'coder'),
    task,
    rules: loadRules(paths),
  });
}

describe('renderContext', () => {
  it("includes the agent's own prompt", () => {
    expect(render()).toContain('PROMPT-BODY: you implement one slice.');
  });

  it('states the task the agent is holding', () => {
    const out = render();
    expect(out).toContain('T-001');
    expect(out).toContain('Add password reset');
    expect(out).toContain('users forget passwords');
  });

  it('injects only the rules that apply to this agent', () => {
    const out = render();
    expect(out).toContain('RULE-BODY: red before green.');
    expect(out).not.toContain('RULE-BODY: boundaries.');
  });

  it('marks blocking rules so the agent knows which ones fail a handoff', () => {
    expect(render()).toMatch(/blocking/i);
  });

  it('inlines the accepted spec', () => {
    expect(render()).toContain('Scenario: SPEC-BODY');
  });

  it('passes on the previous handoff summary', () => {
    expect(render()).toContain('three scenarios accepted');
  });

  it('never leaks another agent transcript into this context', () => {
    const { paths, task } = seed();
    write(`${paths.state}/T-001/specifier/transcript.log`, 'SECRET-TRANSCRIPT reasoning trace');
    const out = renderContext({
      paths,
      agent: loadAgent(paths, 'coder'),
      task,
      rules: loadRules(paths),
    });
    expect(out).not.toContain('SECRET-TRANSCRIPT');
  });

  it('declares the write scope the handoff gate will enforce', () => {
    const out = render();
    expect(out).toContain('src/**');
    expect(out).toContain('tests/**');
  });

  it('lists the checklist the agent must report at handoff', () => {
    const out = render();
    expect(out).toContain('tests_first');
    expect(out).toContain('Every new test was observed failing first.');
  });

  it('names the next agent so the handoff is unambiguous', () => {
    expect(render()).toContain('cleaner');
  });
});
