# Agentic Harness

Agentic Harness is a TypeScript-based, project-local workflow engine for
coordinating coding agents through CLI adapters such as Codex and Claude.

The framework is being built around one hard boundary: installing it into a
project places its configuration, agents, rules, task state, contexts, hooks,
and runtime under that project's `.harness/` directory.

## Current status

This branch implements the rule and gate kernel, the command line entry point,
and the `.harness/` installer: rule bundles are validated, layered, hashed,
compiled into agent policies, executed as phase gates, and installed into a
host project by `harness init`, which `harness doctor` then checks.

`harness init` also takes over the repository's Git hooks without discarding
the ones the project already had, so a gate runs on an ordinary local commit
rather than only when someone remembers to invoke it.

Task state and the Codex and Claude adapters are **not** implemented yet.

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
| `harness init [--update]`             | Install or update `.harness/` in this project |
| `harness doctor`                      | Check that the installed harness can run      |

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

## Installation

`harness init` resolves the working tree with `git rev-parse --show-toplevel`
and refuses to install outside a Git repository. Everything it writes lands
under `.harness/`; the host project's `package.json`, ESLint configuration and
lockfile are never read for writing and never modified.

Each managed file is written through a temporary sibling and an atomic rename,
so an interrupted install leaves the previous version intact rather than a
truncated one. What happens to a file that is already there is decided before
anything is written, from `.harness/version.json` — the manifest recording what
the harness installed and the SHA-256 it wrote:

| On disk | In the manifest | Content               | `--update` | Outcome                   |
| ------- | --------------- | --------------------- | ---------- | ------------------------- |
| absent  | –               | –                     | –          | created                   |
| present | –               | equals shipped        | –          | kept                      |
| present | no entry        | differs               | –          | refused: unmanaged file   |
| present | entry           | local ≠ manifest hash | –          | refused: locally modified |
| present | entry           | differs               | no         | refused: needs `--update` |
| present | entry           | differs               | yes        | replaced                  |

Every conflict in a project is collected and reported once, so a half-adopted
installation is untangled in one pass instead of one file per re-run. Nothing
is written until the plan is conflict-free.

A managed file that a newer harness no longer ships is **reported and left in
place**. Deleting a file from someone's project is the irreversible act the
installer will not perform on its own.

Runtime dependencies are resolved into `.harness/node_modules/` by npm running
with `.harness/` as its working directory — npm regardless of what the host
project uses, because resolving this tree with the project's package manager
would apply that manager's workspace rules and, in a monorepo, hoist the
harness's dependencies into the workspace root. Files and the manifest are
written before dependencies, so an install interrupted by a failing
`npm install` leaves a project the harness still recognises as its own and a
re-run repairs it.

`harness doctor` checks Node, npm, Git, Bash, the installation manifest, the
configuration files, the rule set, the private dependency tree, and Git hook
reachability. It writes nothing, runs every check even after one fails, and
exits `3` if any check is a problem. Warnings — an installation made by a
different harness version, or hooks that are not dispatched through the harness
— are reported without failing.

## Git hooks

`harness init` points the repository's local `core.hooksPath` at
`.harness/hooks` and writes one dispatcher per hook. That setting is the single
thing the harness changes outside `.harness/`, because Git cannot be told to
look inside a directory from within that directory.

Redirecting `core.hooksPath` stops **every** hook in the previous directory
from running, not only the ones the harness has a gate for. So the installer
first records what was active — `core.hooksPath` if it was set, otherwise the
hooks directory of the common Git directory, which is where a linked worktree's
hooks actually live — and generates a dispatcher for each of them:

- a managed hook (`pre-commit` and `pre-push` by default) runs the preserved
  hook first, unchanged, with the same arguments and the same standard input,
  and then `harness gate <phase>`;
- any other executable hook that was there gets a pass-through that runs the
  original and nothing else.

`set -e` means a failing preserved hook stops the dispatcher there. The gate
never masks a hook the project relies on, and the exit code a developer sees is
that hook's own.

`config/hooks.yaml` sets the policy. `onExistingHook: chain` is the default and
`abort` refuses the installation instead. There is no `replace`.

A preserved hook inside the repository is recorded relative to the project root
and re-joined at run time, so a dispatcher is the same file on every machine
that checks the project out. Once Git dispatches through the harness,
`.harness/version.json` is the only surviving record of what was there before,
and a re-install reads it rather than inspecting its own dispatchers and
chaining the harness to itself.

`.harness/bin/harness` is the executable the dispatchers call. It runs the CLI
from `.harness/node_modules/`, so a hook runs the version this project
installed rather than whichever global one is first on `PATH`, and exits `3`
with a clear message when the runtime has not been installed.

### Worktrees

`core.hooksPath` is repository-local configuration, which Git shares across
every linked worktree. The harness therefore writes a **relative** value, so
each worktree resolves its own `.harness/hooks`. The consequence is worth
stating plainly: installing from one worktree redirects hooks for the whole
repository, and a worktree with no `.harness/hooks` of its own then runs no
hooks at all. Install from the main checkout, or install in every worktree.

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

## Agent definitions and configuration

`templates/.harness/agents/` ships one definition per built-in agent, and
`templates/.harness/config/` ships the two settings files the installer will
place alongside them. Both are validated by the test suite, so a shipped
template that stops matching its schema fails the build.

```yaml
version: 1
id: hardener
displayName: Hardener
summary: >
  Attacks the test suite: finds the cases the tests do not cover and adds them,
  without repairing the production code they expose.
modelProfile: coding-high

tools:
  read: true
  search: true
  edit: true
  execute: true

writeScopes:
  - "tests/**"

projectScripts:
  - test
  - typecheck
```

`modelProfile` is a logical name — `coding-high`, `reasoning-high`, or
`verification`. Provider-specific model identifiers are deliberately absent, so
a definition is portable across adapters.

`tools` and `writeScopes` have to agree: an agent that declares `edit: true`
must name a write scope, and one that declares `edit: false` must not.
Otherwise the runtime has two answers about what an agent may change, and
whichever it happens to read becomes the real policy by accident. The same
applies to `execute` and `projectScripts`.

`config/project.yaml` carries only the two decisions discovery cannot make: the
validation mode, and a pinned package manager for a repository that carries two
lockfiles. `config/hooks.yaml` says which Git hooks are managed and what to do
when the project already has one — `chain` runs the existing hook and then the
harness gate, `abort` stops. There is no `replace`.

`harness init` installs these files and `harness doctor` validates the
installed copies. Hook dispatch is the next milestone, and enforcing the tool
policy at run time belongs to the provider adapters.

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

- Typed Codex and Claude CLI adapter contract
- Runtime enforcement of the shipped agent tool policies
- Atomic `tasks.yaml` state and resumable handoffs
- Specifier, coder, cleaner, architect, hardener, and QA agents
