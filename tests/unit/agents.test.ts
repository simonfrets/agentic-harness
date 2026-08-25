import fs from 'node:fs';

import { compileToClaudeMarkdown, renderAgentEnv } from '../../src/core/agents/compile';
import { loadAgent, loadAgents } from '../../src/core/agents/load';
import { HarnessError } from '../../src/core/errors';
import { harnessPaths, type HarnessPaths } from '../../src/core/paths';
import { cleanupTempDirs, tempDir, write } from '../helpers/fixture';

afterAll(cleanupTempDirs);

const CODER = `name: coder
description: Implements one approved behavior slice with TDD.
model:
  claude: sonnet
  codex: gpt-5-codex
effort: high
tools: [Read, Edit, Write, "Bash(npm test:*)"]
write_scope: ["src/**", "tests/**"]
rules: [tdd, git-workflow]
prompt: prompts/coder.md
accepts_from: [specifier]
handoff_to: cleaner
checklist:
  - id: tests_first
    description: Every new test was observed failing before the implementation.
  - id: suite_green
`;

function seedProject(): HarnessPaths {
  const paths = harnessPaths(tempDir());
  fs.mkdirSync(paths.agents, { recursive: true });
  write(`${paths.agents}/coder.yaml`, CODER);
  write(`${paths.prompts}/coder.md`, 'You implement one slice at a time.\n');
  return paths;
}

describe('loadAgent', () => {
  it('reads the definition and its per-vendor models', () => {
    const agent = loadAgent(seedProject(), 'coder');
    expect(agent.name).toBe('coder');
    expect(agent.model['claude']).toBe('sonnet');
    expect(agent.model['codex']).toBe('gpt-5-codex');
    expect(agent.effort).toBe('high');
  });

  it('exposes snake_case YAML keys as camelCase fields', () => {
    const agent = loadAgent(seedProject(), 'coder');
    expect(agent.writeScope).toEqual(['src/**', 'tests/**']);
    expect(agent.acceptsFrom).toEqual(['specifier']);
    expect(agent.handoffTo).toBe('cleaner');
  });

  it('defaults a checklist entry description to its id', () => {
    const agent = loadAgent(seedProject(), 'coder');
    expect(agent.checklist[1]).toEqual({ id: 'suite_green', description: 'suite_green' });
  });

  it('reports AGENT_NOT_FOUND for an unknown agent', () => {
    try {
      loadAgent(seedProject(), 'nobody');
      throw new Error('expected a lookup failure');
    } catch (err) {
      expect((err as HarnessError).code).toBe('AGENT_NOT_FOUND');
    }
  });

  it('rejects a definition whose name disagrees with its filename', () => {
    const paths = seedProject();
    write(`${paths.agents}/qa.yaml`, CODER);
    try {
      loadAgent(paths, 'qa');
      throw new Error('expected a validation failure');
    } catch (err) {
      expect((err as HarnessError).code).toBe('SCHEMA_INVALID');
    }
  });

  it('rejects an unknown effort level', () => {
    const paths = seedProject();
    write(`${paths.agents}/coder.yaml`, CODER.replace('effort: high', 'effort: extreme'));
    expect(() => loadAgent(paths, 'coder')).toThrow(HarnessError);
  });
});

describe('loadAgents', () => {
  it('returns every agent, sorted by name', () => {
    const paths = seedProject();
    write(`${paths.agents}/architect.yaml`, CODER.replace('name: coder', 'name: architect'));
    expect(loadAgents(paths).map((a) => a.name)).toEqual(['architect', 'coder']);
  });

  it('is empty rather than throwing when no agents directory exists', () => {
    expect(loadAgents(harnessPaths(tempDir()))).toEqual([]);
  });
});

describe('compileToClaudeMarkdown', () => {
  it('emits frontmatter Claude Code can consume, with the prompt as the body', () => {
    const paths = seedProject();
    const md = compileToClaudeMarkdown(paths, loadAgent(paths, 'coder'));
    expect(md).toMatch(/^---\n/);
    expect(md).toContain('name: coder');
    expect(md).toContain('model: sonnet');
    expect(md).toContain('Read, Edit, Write, Bash(npm test:*)');
    expect(md).toContain('You implement one slice at a time.');
  });
});

describe('renderAgentEnv', () => {
  it('emits shell-safe assignments the runtime can source', () => {
    const paths = seedProject();
    const env = renderAgentEnv(paths, loadAgent(paths, 'coder'), {
      adapter: 'claude',
      taskId: 'T-001',
      mode: 'headless',
    });
    expect(env).toContain("HARNESS_AGENT='coder'");
    expect(env).toContain("HARNESS_MODEL='sonnet'");
    expect(env).toContain("HARNESS_TASK='T-001'");
    expect(env).toContain("HARNESS_MODE='headless'");
  });

  it("escapes apostrophes with the POSIX '\\'' idiom so a value cannot break out", () => {
    const paths = seedProject();
    write(`${paths.agents}/coder.yaml`, CODER.replace('description:', "description: it's fine #"));
    const env = renderAgentEnv(paths, loadAgent(paths, 'coder'), {
      adapter: 'claude',
      taskId: 'T-001',
      mode: 'headless',
    });
    expect(env).toContain(String.raw`HARNESS_AGENT_DESC='it'\''s fine'`);
  });
});
