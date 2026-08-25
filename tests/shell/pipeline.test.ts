import { cleanupTempDirs } from '../helpers/fixture';
import { addTask, makeProject, type Project } from '../helpers/project';

afterAll(cleanupTempDirs);

function status(project: Project, id: string): string {
  const shown = project.cli(['task', 'show', id]).stdout;
  return /status\s+(\S+)/.exec(shown)?.[1] ?? '';
}

function owner(project: Project, id: string): string {
  const shown = project.cli(['task', 'show', id]).stdout;
  return /owner\s+(\S+)/.exec(shown)?.[1] ?? '';
}

describe('harness init', () => {
  it('lays down a complete .harness the pipeline can run from', () => {
    const project = makeProject();
    for (const file of [
      '.harness/tasks.yaml',
      '.harness/agents/coder.yaml',
      '.harness/prompts/coder.md',
      '.harness/rules/tdd.md',
      '.harness/rules/checks/tdd-pair.sh',
      '.harness/bin/harness',
    ]) {
      expect({ file, present: project.exists(file) }).toEqual({ file, present: true });
    }
  });

  it('ships all six agents', () => {
    const project = makeProject();
    const listed = project.cli(['doctor']).stdout;
    for (const agent of ['specifier', 'coder', 'cleaner', 'architect', 'hardener', 'qa']) {
      expect(listed).toContain(agent);
    }
  });

  it('keeps machine-local state out of git', () => {
    expect(makeProject().read('.harness/.gitignore')).toContain('state/');
  });
});

describe('stage.sh', () => {
  it('renders context, invokes the adapter and advances the task', () => {
    const project = makeProject();
    const id = addTask(project, 'Add password reset');

    const run = project.runtime('pipeline/stage.sh', ['--task', id, '--agent', 'specifier']);
    expect(run.status).toBe(0);
    expect(project.invocations()[0]).toContain('specifier|claude');
    expect(owner(project, id)).toBe('coder');
  });

  it("passes the agent's declared model to the adapter", () => {
    const project = makeProject();
    const id = addTask(project, 'Add password reset');
    project.runtime('pipeline/stage.sh', ['--task', id, '--agent', 'specifier']);
    // The specifier is configured for opus; the coder for sonnet.
    expect(project.invocations()[0]).toMatch(/--model\s+opus/);
  });

  it("passes the agent's tool allowlist to the adapter", () => {
    const project = makeProject();
    const id = addTask(project, 'Add password reset');
    project.runtime('pipeline/stage.sh', ['--task', id, '--agent', 'coder']);
    expect(project.invocations()[0]).toMatch(/--allowedTools/);
    expect(project.invocations()[0]).toContain('Edit');
  });

  it('writes the context document the agent reads', () => {
    const project = makeProject();
    const id = addTask(project, 'Add password reset');
    project.runtime('pipeline/stage.sh', ['--task', id, '--agent', 'specifier']);
    const context = project.read(`.harness/state/${id}/specifier/context.md`);
    expect(context).toContain('Add password reset');
    expect(context).toContain('## Finishing');
  });

  it('keeps a transcript of the adapter run', () => {
    const project = makeProject();
    const id = addTask(project, 'Add password reset');
    project.runtime('pipeline/stage.sh', ['--task', id, '--agent', 'specifier']);
    expect(project.exists(`.harness/state/${id}/specifier/transcript.log`)).toBe(true);
  });

  it('leaves the task where it was when the adapter fails', () => {
    const project = makeProject();
    const id = addTask(project, 'Add password reset');
    const run = project.runtime('pipeline/stage.sh', ['--task', id, '--agent', 'specifier'], {
      HARNESS_FAKE_EXIT: '1',
    });
    expect(run.status).not.toBe(0);
    expect(owner(project, id)).toBe('specifier');
  });

  it('sends the task back to the coder when the agent leaves a rejection', () => {
    const project = makeProject();
    const id = addTask(project, 'Add password reset');
    project.cli(['task', 'set', id, '--owner', 'hardener', '--status', 'hardening']);

    project.runtime('pipeline/stage.sh', ['--task', id, '--agent', 'hardener'], {
      HARNESS_FAKE_REJECT: 'hardener',
    });
    expect(owner(project, id)).toBe('coder');
  });

  it('honours an explicit adapter override', () => {
    const project = makeProject();
    const id = addTask(project, 'Add password reset');
    project.runtime('pipeline/stage.sh', ['--task', id, '--agent', 'specifier', '--adapter', 'codex']);
    expect(project.invocations()[0]).toContain('|codex|');
  });
});

describe('run.sh', () => {
  it('walks a task through all six stages to done', () => {
    const project = makeProject();
    const id = addTask(project, 'Add password reset');

    const run = project.runtime('pipeline/run.sh', ['--task', id]);
    expect(run.status).toBe(0);
    expect(status(project, id)).toBe('done');

    const agents = project.invocations().map((line) => line.split('|')[0]);
    expect(agents).toEqual(['specifier', 'coder', 'cleaner', 'architect', 'hardener', 'qa']);
  });

  it('stops where it broke rather than running on', () => {
    const project = makeProject();
    const id = addTask(project, 'Add password reset');

    const run = project.runtime('pipeline/run.sh', ['--task', id], { HARNESS_FAKE_EXIT: '1' });
    expect(run.status).not.toBe(0);
    expect(project.invocations()).toHaveLength(1);
    expect(owner(project, id)).toBe('specifier');
  });

  it('records the whole journey in the task event log', () => {
    const project = makeProject();
    const id = addTask(project, 'Add password reset');
    project.runtime('pipeline/run.sh', ['--task', id]);

    const events = project.read(`.harness/events/${id}.jsonl`);
    expect(events).toContain('"type":"task.created"');
    expect(events.match(/"type":"handoff"/g)).toHaveLength(6);
  });

  it('blocks instead of advancing when a gate fails', () => {
    const project = makeProject({
      config: `version: 1
adapter: claude
gates:
  writeScope: true
  rules: false
  tdd: false
`,
    });
    const id = addTask(project, 'Add password reset');

    // The specifier may write specs and QA docs; infra/ is not its business.
    const run = project.runtime('pipeline/run.sh', ['--task', id], {
      HARNESS_FAKE_TOUCH: 'infra/deploy.tf',
    });
    expect(run.status).not.toBe(0);
    expect(status(project, id)).toBe('blocked');
  });
});

describe('open.sh', () => {
  it('runs the adapter in interactive mode with the context loaded', () => {
    const project = makeProject();
    const id = addTask(project, 'Add password reset');

    const run = project.runtime('pipeline/open.sh', ['--agent', 'coder', '--task', id]);
    expect(run.status).toBe(0);
    expect(project.invocations()[0]).not.toMatch(/(^|\s)-p(\s|$)/);
    expect(project.invocations()[0]).toContain('--append-system-prompt');
  });

  it('does not hand the task off -- the human decides that', () => {
    const project = makeProject();
    const id = addTask(project, 'Add password reset');
    project.runtime('pipeline/open.sh', ['--agent', 'specifier', '--task', id]);
    expect(owner(project, id)).toBe('specifier');
  });
});
