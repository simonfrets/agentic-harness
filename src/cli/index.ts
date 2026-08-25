#!/usr/bin/env node
import { Command } from 'commander';

import { exitCodeFor, HarnessError } from '../core/errors';
import { ctx } from './commands/ctx';
import { gate } from './commands/gate';
import { handoff, next } from './commands/handoff';
import { init } from './commands/init';
import {
  doctor,
  metricsCrap,
  open,
  rulesAdd,
  rulesList,
  run,
  specLint,
  sync,
  tddGuard,
  tddRatchet,
  tddRed,
} from './commands/misc';
import { taskAdd, taskList, taskSet, taskShow } from './commands/task';
import { note } from './util';

const program = new Command();

program
  .name('harness')
  .description('Project-local six-agent pipeline: specify, code, clean, review, harden, verify.')
  .version('0.1.0')
  .showHelpAfterError();

program
  .command('init')
  .description('scaffold .harness/ into the current project')
  .option('--force', 'overwrite files that already exist')
  .option('--no-tooling', 'scaffold .harness/ only; do not touch eslint, hooks or CI')
  .action((options: { force?: boolean; tooling?: boolean }) => { init(options); });

program.command('doctor').description('check adapters, hooks and rule wiring').action(doctor);
program.command('sync').description('compile agents into .claude/agents/').action(sync);

const task = program.command('task').description('create and inspect tasks');
task
  .command('add <title>')
  .description('create a task in tasks.yaml')
  .option('--intent <text>', 'the user intent, verbatim')
  .action(taskAdd);
task
  .command('list')
  .description('list open tasks')
  .option('--all', 'include finished tasks')
  .action(taskList);
task.command('show <id>').description('show one task with its handoffs').action(taskShow);
task
  .command('set <id>')
  .description('update a task')
  .option('--status <status>')
  .option('--owner <agent>')
  .option('--branch <branch>')
  .option('--spec <path>')
  .option('--artifact <path...>')
  .action(taskSet);

program
  .command('ctx')
  .description("render an agent's context and env for a task")
  .requiredOption('--task <id>')
  .requiredOption('--agent <name>')
  .option('--adapter <name>')
  .option('--model <model>')
  .option('--mode <mode>', 'headless | interactive', 'headless')
  .action((options: Parameters<typeof ctx>[0]) => { ctx(options); });

program
  .command('gate')
  .description('run the handoff gates without handing off (exits 10 on failure)')
  .requiredOption('--task <id>')
  .requiredOption('--agent <name>')
  .option('--base <ref>', 'diff against this ref instead of the working tree')
  .option('--json')
  .action(gate);

program
  .command('handoff')
  .description('run the gates and pass the task to the next agent')
  .requiredOption('--task <id>')
  .requiredOption('--agent <name>')
  .option('--summary <text>', "defaults to the agent's output.md")
  .option('--checklist <entry...>', 'id=true / id=false')
  .option('--reject <reason>', 'send the task back for rework instead')
  .option('--base <ref>')
  .option('--skip-gates', 'record the handoff without running gates')
  .action(handoff);

program
  .command('next')
  .description('who is up next')
  .option('--task <id>')
  .action(next);

program
  .command('run')
  .description('drive the pipeline headlessly')
  .option('--task <id>')
  .option('--agent <name>', 'run a single stage instead of the whole pipeline')
  .option('--adapter <name>')
  .action(run);

program
  .command('open <agent>')
  .description('open an interactive session for one agent with its context loaded')
  .option('--task <id>')
  .option('--adapter <name>')
  .action(open);

const rules = program.command('rules').description('inspect and scaffold rules');
rules.command('list').description('list rules and their enforcement').action(rulesList);
rules.command('add <id>').description('scaffold a new rule').action(rulesAdd);

const spec = program.command('spec').description('work with Gherkin specs');
spec.command('lint [file]').description('structurally lint feature files').action(specLint);

const metrics = program.command('metrics').description('code quality metrics');
metrics
  .command('crap')
  .description('rank functions by CRAP score')
  .option('--coverage <file>')
  .option('--max <score>', 'exit 10 if any function is above this')
  .option('--top <n>', 'how many rows to print', '20')
  .action(metricsCrap);

const tdd = program.command('tdd').description('test-first enforcement');
tdd
  .command('red <test>')
  .description('run a test, require it to fail, and record the receipt')
  .requiredOption('--task <id>')
  .requiredOption('--agent <name>')
  .option('--command <cmd>', 'how to run the single test')
  .action(tddRed);
tdd
  .command('guard')
  .description('pair gate: production code may not move without tests')
  .allowUnknownOption()
  .argument('[args...]')
  .action((args: string[]) => { tddGuard(args); });
tdd
  .command('ratchet')
  .description('coverage may not fall below the recorded baseline')
  .option('--coverage <file>')
  .option('--floor <pct>')
  .action(tddRatchet);

try {
  program.parse(process.argv);
} catch (err) {
  if (err instanceof HarnessError) {
    note(`error: ${err.message}`);
    if (err.detail !== undefined) note(`       ${err.detail}`);
    process.exit(exitCodeFor(err));
  }
  throw err;
}
