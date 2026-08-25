import fs from 'node:fs';
import path from 'node:path';

import { compileToClaudeMarkdown, modelFor } from '../../src/core/agents/compile';
import { listAgentNames, loadAgent, readAgentPrompt } from '../../src/core/agents/load';
import { adapterConfig, loadConfig } from '../../src/core/config/load';
import { renderContext } from '../../src/core/context/render';
import { EXIT, exitCodeFor, HarnessError } from '../../src/core/errors';
import { crapReport } from '../../src/core/metrics/crap';
import { harnessPaths, type HarnessPaths } from '../../src/core/paths';
import { loadRules } from '../../src/core/rules/load';
import { parseTasks } from '../../src/core/tasks/store';
import type { Task } from '../../src/core/tasks/schema';
import { cleanupTempDirs, tempDir, write } from '../helpers/fixture';

afterAll(cleanupTempDirs);

describe('exitCodeFor', () => {
  it('maps a usage error to the conventional exit 2', () => {
    expect(exitCodeFor(new HarnessError('USAGE', 'bad flag'))).toBe(EXIT.USAGE);
  });

  it('maps a failed gate to 10 so a shell pipeline can branch on it', () => {
    expect(exitCodeFor(new HarnessError('GATE_FAILED', 'write scope'))).toBe(EXIT.GATE_FAILED);
  });

  it('treats every other harness error as a plain failure', () => {
    expect(exitCodeFor(new HarnessError('TASK_NOT_FOUND', 'nope'))).toBe(EXIT.ERROR);
  });

  it('treats an unknown throwable as a plain failure too', () => {
    expect(exitCodeFor(new TypeError('something else'))).toBe(EXIT.ERROR);
  });
});

describe('adapterConfig', () => {
  function config(): ReturnType<typeof loadConfig> {
    const paths = harnessPaths(tempDir());
    fs.mkdirSync(paths.dir, { recursive: true });
    return loadConfig(paths);
  }

  it('returns the adapter by name', () => {
    expect(adapterConfig(config(), 'codex').bin).toBe('codex');
  });

  it('names the configured adapters when asked for one that does not exist', () => {
    try {
      adapterConfig(config(), 'telepathy');
      throw new Error('expected a failure');
    } catch (err) {
      expect((err as HarnessError).code).toBe('CONFIG_INVALID');
      expect((err as HarnessError).detail).toContain('claude');
    }
  });
});

// --- agents ----------------------------------------------------------------

function agentProject(yaml: string, promptFile = 'prompts/a.md'): HarnessPaths {
  const paths = harnessPaths(tempDir());
  fs.mkdirSync(paths.agents, { recursive: true });
  write(`${paths.agents}/a.yaml`, yaml);
  if (promptFile !== '') write(path.join(paths.dir, promptFile), 'PROMPT\n');
  return paths;
}

describe('modelFor', () => {
  it('falls back when the agent declares no model for this adapter', () => {
    const paths = agentProject('name: a\nmodel: { claude: opus }\nprompt: prompts/a.md\n');
    expect(modelFor(loadAgent(paths, 'a'), 'codex', 'gpt-5')).toBe('gpt-5');
  });

  it('falls back to an empty string when no fallback is given', () => {
    const paths = agentProject('name: a\nprompt: prompts/a.md\n');
    expect(modelFor(loadAgent(paths, 'a'), 'claude')).toBe('');
  });
});

describe('compileToClaudeMarkdown', () => {
  it('omits the write-scope section for an agent that declares none', () => {
    const paths = agentProject('name: a\nprompt: prompts/a.md\n');
    expect(compileToClaudeMarkdown(paths, loadAgent(paths, 'a'))).not.toContain('Write scope');
  });

  it('marks the model as inherited when the agent names none for claude', () => {
    const paths = agentProject('name: a\nprompt: prompts/a.md\n');
    expect(compileToClaudeMarkdown(paths, loadAgent(paths, 'a'))).toContain('model: inherit');
  });
});

describe('readAgentPrompt', () => {
  it('points at the missing file rather than failing obscurely', () => {
    const paths = agentProject('name: a\nprompt: prompts/gone.md\n');
    try {
      readAgentPrompt(paths, loadAgent(paths, 'a'));
      throw new Error('expected a failure');
    } catch (err) {
      expect((err as HarnessError).code).toBe('SCHEMA_INVALID');
      expect((err as HarnessError).detail).toContain('prompts/gone.md');
    }
  });
});

describe('listAgentNames', () => {
  it('accepts .yml as well as .yaml', () => {
    const paths = agentProject('name: a\nprompt: prompts/a.md\n');
    write(`${paths.agents}/b.yml`, 'name: b\nprompt: prompts/a.md\n');
    expect(listAgentNames(paths)).toEqual(['a', 'b']);
  });
});

// --- context ---------------------------------------------------------------

const AGENT_YAML = `name: coder
description: implements slices
model: { claude: sonnet }
write_scope: ["src/**"]
prompt: prompts/coder.md
handoff_to: cleaner
checklist: [tests_first]
`;

function contextProject(taskYaml: string, agentYaml = AGENT_YAML): { paths: HarnessPaths; task: Task } {
  const paths = harnessPaths(tempDir());
  fs.mkdirSync(paths.dir, { recursive: true });
  write(`${paths.agents}/coder.yaml`, agentYaml);
  write(`${paths.prompts}/coder.md`, 'PROMPT\n');
  return { paths, task: parseTasks(taskYaml, 'tasks.yaml').tasks[0]! };
}

function renderFor(project: { paths: HarnessPaths; task: Task }): string {
  return renderContext({
    paths: project.paths,
    agent: loadAgent(project.paths, 'coder'),
    task: project.task,
    rules: loadRules(project.paths),
  });
}

describe('renderContext edges', () => {
  const base = `version: 1
tasks:
  - id: T-001
    title: Reset
    status: coding
    owner: coder
`;

  it('shows the branch when the task has one', () => {
    expect(renderFor(contextProject(`${base}    branch: feat/T-001-reset\n`))).toContain('feat/T-001-reset');
  });

  it('lists the artifacts produced so far', () => {
    expect(renderFor(contextProject(`${base}    artifacts: [tests/a.test.ts]\n`))).toContain('tests/a.test.ts');
  });

  it('leads with why the task came back when it was rejected', () => {
    const project = contextProject(`${base}    handoffs:
      - from: hardener
        to: coder
        at: "2026-01-01T00:00:00Z"
        summary: sending back
        reason: boundary case untested
`);
    expect(renderFor(project)).toContain('boundary case untested');
  });

  it('says the stage is final when the agent hands off to nobody', () => {
    const project = contextProject(base, AGENT_YAML.replace('handoff_to: cleaner\n', ''));
    expect(renderFor(project)).toContain('final stage');
  });

  it('is explicit when an agent declares no checklist', () => {
    const project = contextProject(base, AGENT_YAML.replace('checklist: [tests_first]\n', ''));
    expect(renderFor(project)).toContain('no checklist declared');
  });

  it('omits the spec section when the referenced spec is missing', () => {
    const project = contextProject(`${base}    spec: specs/gone.feature\n`);
    expect(renderFor(project)).not.toContain('Accepted specification');
  });

  it('omits the intent section when there is no intent', () => {
    expect(renderFor(contextProject(base))).not.toContain('Original intent');
  });
});

// --- crap ------------------------------------------------------------------

describe('crapReport edges', () => {
  function coverage(body: Record<string, unknown>): string {
    const root = tempDir();
    write(path.join(root, 'c.json'), JSON.stringify({ [path.join(root, 'src/a.ts')]: { path: path.join(root, 'src/a.ts'), ...body } }));
    return root;
  }

  it('falls back to the declaration location when there is no body location', () => {
    const root = coverage({
      fnMap: { '0': { name: 'f', decl: { start: { line: 1 }, end: { line: 3 } } } },
      f: { '0': 1 },
      branchMap: {},
      b: {},
      statementMap: { '0': { start: { line: 2 }, end: { line: 2 } } },
      s: { '0': 1 },
    });
    expect(crapReport(path.join(root, 'c.json'), root)[0]?.line).toBe(1);
  });

  it('labels an unnamed function rather than printing an empty column', () => {
    const root = coverage({
      fnMap: { '0': { name: '', loc: { start: { line: 1 }, end: { line: 3 } } } },
      f: { '0': 1 },
      branchMap: {},
      b: {},
      statementMap: {},
      s: {},
    });
    expect(crapReport(path.join(root, 'c.json'), root)[0]?.fn).toBe('(anonymous)');
  });

  it('treats a statement-less function that was never called as uncovered', () => {
    const root = coverage({
      fnMap: { '0': { name: 'never', loc: { start: { line: 1 }, end: { line: 3 } } } },
      f: { '0': 0 },
      branchMap: {},
      b: {},
      statementMap: {},
      s: {},
    });
    expect(crapReport(path.join(root, 'c.json'), root)[0]?.coverage).toBe(0);
  });

  it('skips a function entry with no location at all', () => {
    const root = coverage({
      fnMap: { '0': { name: 'ghost' } },
      f: { '0': 1 },
      branchMap: {},
      b: {},
      statementMap: {},
      s: {},
    });
    expect(crapReport(path.join(root, 'c.json'), root)).toEqual([]);
  });

  it('rejects a coverage file that is not JSON', () => {
    const root = tempDir();
    write(path.join(root, 'c.json'), 'not json');
    expect(() => crapReport(path.join(root, 'c.json'), root)).toThrow(HarnessError);
  });
});

// --- rules -----------------------------------------------------------------

describe('rule defaults', () => {
  it('applies to every agent when applies_to is omitted', () => {
    const paths = harnessPaths(tempDir());
    fs.mkdirSync(paths.rules, { recursive: true });
    write(`${paths.rules}/x.md`, '---\nid: x\n---\nbody\n');
    expect(loadRules(paths)[0]?.appliesTo).toEqual(['*']);
  });

  it('defaults to advisory rather than silently blocking handoffs', () => {
    const paths = harnessPaths(tempDir());
    fs.mkdirSync(paths.rules, { recursive: true });
    write(`${paths.rules}/x.md`, '---\nid: x\n---\nbody\n');
    expect(loadRules(paths)[0]?.enforcement).toBe('advisory');
  });
});
