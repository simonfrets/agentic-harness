# Agentic Harness

Agentic Harness is a TypeScript-based, project-local workflow engine for
coordinating coding agents through CLI adapters such as Codex and Claude.

The framework is being built around one hard boundary: installing it into a
project places its configuration, agents, rules, task state, contexts, hooks,
and runtime under that project's `.harness/` directory.

## Current status

This branch implements the rule and gate kernel and the command line entry
point: rule bundles are validated, layered, hashed, compiled into agent
policies, executed as phase gates, and reachable from a `harness` executable.

The `.harness/` installer, Git hook dispatch, task state, and the Codex and
Claude adapters are **not** implemented yet. `harness init` and
`harness doctor` report themselves as unavailable, and nothing here installs
into another project: the CLI reads a `.harness/` directory that has to be
created by hand for now.

## Requirements

- Node.js 22.22.1 or newer
- npm 10 or newer
- Git
- Bash on macOS, Linux, or WSL

## Setup

```sh
npm install
npm run check
npm run build
```

`npm install` activates the repository's Husky hooks through the `prepare`
script.

## Quality commands

| Command                 | Purpose                                            |
| ----------------------- | -------------------------------------------------- |
| `npm run format:check`  | Verify formatting without modifying files          |
| `npm run lint`          | Run type-aware ESLint with zero warnings allowed   |
| `npm run typecheck`     | Run strict TypeScript checking                     |
| `npm run lint:shell`    | Parse every tracked project shell script with Bash |
| `npm test`              | Run Jest unit and shell-script tests               |
| `npm run test:coverage` | Run Jest with enforced coverage thresholds         |
| `npm run check`         | Run the complete local quality gate                |
| `npm run build`         | Produce ESM JavaScript and declarations in `dist/` |

The pre-commit hook runs staged formatting and ESLint fixes, followed by the
full lint, type-check, shell syntax, and Jest gates.

## Command line

```sh
harness <command> [options]
```

| Command                               | Behaviour                                     |
| ------------------------------------- | --------------------------------------------- |
| `harness rules validate`              | Load and resolve every bundle; print the hash |
| `harness rules explain`               | List the resolved rules with their origins    |
| `harness rules explain --agent coder` | Print that agent's compiled policy            |
| `harness gate <phase>`                | Run the checks that apply to a workflow phase |
| `harness init` / `doctor`             | Not available in this build                   |

Rules are read from the project the command is run in. The working tree root
is resolved with `git rev-parse --show-toplevel`, so a command works from any
subdirectory. `.harness/rules/*.yaml` is the `builtin` precedence layer and
`.harness/rules/custom/*.yaml` is the `project` layer, so a project replaces a
shipped rule by declaring the same rule id with `overrides: true`.

Exit codes are part of the contract, because a hook or a CI step branches on
them:

| Code | Meaning                                       |
| ---- | --------------------------------------------- |
| 0    | Success                                       |
| 1    | Unexpected failure                            |
| 2    | The command line could not be understood      |
| 3    | Invalid or missing harness configuration      |
| 4    | A required check failed and blocked the phase |
| 5    | The action was unsafe and was not taken       |

## Testing shell scripts

Shell behavior is tested from Jest rather than asserted by ad hoc manual steps.
Tests spawn scripts using Bash and isolate filesystem behavior in temporary
fixture directories.

## Rules

A rule bundle is YAML. Rules carry an instruction for agents and, optionally,
executable checks that run at workflow phases.

```yaml
version: 1
id: typescript-quality
description: TypeScript correctness rules

rules:
  - id: typescript.no-explicit-any
    description: Reject new explicit any types
    severity: error
    appliesTo: [coder, cleaner, hardener]
    scopes: ["**/*.ts", "**/*.tsx"]
    instruction: >
      Do not introduce explicit any. Use a concrete type, generic,
      discriminated union, or unknown with narrowing.
    checks:
      - id: native-lint
        runner: project-script
        script: lint
        phases: [pre-handoff, pre-commit]
        required: true
        whenMissing: fail
        timeoutMs: 120000
```

- Severity is `error` or `warning`.
- Phases are `pre-agent`, `pre-handoff`, `pre-commit`, `pre-push`, and `qa`.
- A `project-script` check names one of `build`, `format`, `lint`, `test`, or
  `typecheck`. An arbitrary package script is never assumed safe to run.
- A `command` check carries an explicit argument vector. Commands are never
  stored as shell strings.
- Validation errors report the source file, the YAML path, and a line and
  column.

Bundles are layered in `builtin`, `project`, `agent`, `task` order. A duplicate
rule id is an error unless the higher-precedence rule sets `overrides: true`.

The resolved rule set has a SHA-256 over its effective content alone: bundle
ids, file paths, key order, comments, quoting style, and line endings do not
affect it, so the same logical rules hash identically on any machine.

## Phase gates

`runPhaseGates` runs the checks that apply to a phase and returns a serialisable
report.

- A failing **required** check on an **error** rule blocks the phase.
- A failing **warning** check is recorded in full but never blocks.
- A missing project script either fails or is skipped, per the rule, and is
  never attempted.
- Timeouts, signals, and spawn failures are reported distinctly from a non-zero
  exit. Nothing is hidden behind a generic failure.

Commands run through an injectable `CommandRunner`. The production runner uses
`node:child_process` with `shell: false` and an argument vector, so shell
metacharacters in a rule stay inert as literal argument values. It forwards only
an allowlisted environment, points stdin at `/dev/null`, caps captured output,
and terminates a timed-out process.

Command construction is supported for npm, pnpm, Yarn, and Bun. Only npm is
exercised against a real binary in the test suite; the other three are covered
by argument-vector unit tests, because Yarn and Bun are not assumed to be
installed.

## Planned modules

- Self-contained `.harness/` installer and diagnostics
- Typed Codex and Claude CLI adapter contract
- Isolated agent definitions and model/tool policies
- Atomic `tasks.yaml` state and resumable handoffs
- Specifier, coder, cleaner, architect, hardener, and QA agents
