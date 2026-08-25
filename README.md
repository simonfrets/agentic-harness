# agentic-harness

A project-local, six-agent software pipeline driven through vendor CLI adapters.

Install it into any repo and you get a `.harness/` directory — exclusive to that
project, the way `.claude/` is — holding six agents with their own contexts,
models, tool budgets and write scopes; a `tasks.yaml` that tracks every unit of
work and hands it between agents; and quality rules that can actually *block* a
handoff instead of politely suggesting things.

```
specifier ──▶ coder ──▶ cleaner ──▶ architect ──▶ hardener ──▶ qa ──▶ done
     ▲                                  │             │          │
     └──────────── rejection ───────────┴─────────────┴──────────┘
                   (back to the coder, with a reason)
```

## Install

```sh
npm i -D agentic-harness
npx harness init
```

`init` scaffolds `.harness/`, and wires the enforcement a project needs to keep
this honest: a type-aware ESLint config, strict TypeScript settings, `pre-commit`
and `commit-msg` hooks, and a CI workflow. It **creates what is missing and never
overwrites what exists** — if you already have an ESLint config it tells you what
to add rather than replacing it. `harness init --no-tooling` scaffolds `.harness/`
alone.

```sh
harness doctor    # adapters on PATH, hooks installed, rule checks executable
```

## Use

```sh
harness task add "Add password reset"       # -> T-001
harness run --task T-001                    # unattended: walks all six stages
harness open coder --task T-001             # or take one stage yourself
harness task show T-001                     # status, gates, the handoff trail
```

`run` drives the pipeline headlessly through the configured adapter (`claude` or
`codex`). `open` renders the same context and drops you into a live session with
it loaded, and deliberately does **not** hand off — you do that when you are
satisfied:

```sh
harness handoff --task T-001 --agent coder --checklist tests_first=true
```

## The six agents

| Agent | Model / effort | Writes | Does |
|---|---|---|---|
| **specifier** | opus · xhigh | `.harness/specs/**`, `.harness/qa/**` | Turns intent into accepted Gherkin plus an end-to-end QA procedure |
| **coder** | sonnet · high | `src/**`, `tests/**` | Implements one approved slice, test-first, with generated acceptance tests |
| **cleaner** | sonnet · medium | `src/**`, `tests/**` | Behaviour-preserving cleanup, coverage lift, CRAP and DRY review, mutation-site scan |
| **architect** | opus · xhigh | `docs/adr/**` | Reviews boundaries, dependency direction, interface depth, property-test coverage |
| **hardener** | opus · xhigh | `tests/**` only | Mutation hardening, language and soft-Gherkin mutation, CRAP/DRY verification |
| **qa** | sonnet · medium | `.harness/qa/**` | Makes QA procedures executable, verifies the build, checks handoff consistency, notifies |

Opus at high effort where the work is judgement under ambiguity; sonnet where it
is high-volume editing under a verifier. Every field is yours to change in
`.harness/agents/<name>.yaml`.

Two of those write scopes are load-bearing. The **architect** cannot edit `src/`,
so a structural finding becomes a rejection with a concrete change rather than a
quiet fix the coder never learns from. The **hardener** cannot edit `src/` either,
so the only way it can close a hole is a better test.

## Enforcement is mechanical

Prompts ask; gates decide. Every handoff runs:

- **write-scope** — the worktree is diffed against the agent's declared globs. An
  agent that wrote outside its scope does not hand off. Tool allowlists are
  advisory across vendors; this is not.
- **tdd-pair** — production code may not move without test changes.
- **red-receipt** — every *new* test must have been recorded failing, by
  `harness tdd red`, **before** the production code changed. The receipt stores a
  hash of the source at red time, so one written after the implementation is
  rejected. This is what makes "test-first" checkable rather than claimed.
- **rules** — every blocking rule's check script must exit zero.

A failed gate sets the task to `blocked`, records which gate failed, and stops
the pipeline where it broke.

## Rules are yours

A rule is one markdown file:

```markdown
---
id: git-workflow
applies_to: [coder, cleaner, hardener]
enforcement: blocking          # advisory | blocking
check: checks/branch-naming.sh # optional; exit 0 = pass
---
Work on `feat/<task-id>-<slug>`. Never commit to the default branch.
```

Advisory rules are injected into the context of every agent in `applies_to`.
Blocking rules additionally run their check at handoff time and can fail it.

```sh
harness rules add my-rule     # scaffold one
harness rules list            # what applies where
```

Ten ship by default: `tdd`, `git-workflow`, `code-style`, `no-orphan-code`,
`coverage-floor`, `crap-threshold`, `spec-quality`, `ubiquitous-language`,
`architecture`, `qa-verification`.

## Context isolation

Each agent sees exactly one document: its own prompt, its own rules, the task
row, the accepted spec, and the **summary** of the handoff addressed to it. Never
another agent's transcript. Full transcripts stay in that agent's own state
directory, so context does not compound as a task moves down the pipeline.

## Layout

```
.harness/
├── harness.config.yaml   # pipeline, adapters, gates, notify
├── agents/<name>.yaml    # model, effort, tools, write_scope, rules, checklist
├── prompts/<name>.md     # the prompt body
├── rules/*.md            # + rules/checks/*.sh for blocking rules
├── specs/T-###.feature   # accepted Gherkin
├── qa/T-###.sh           # executable QA procedures
├── tasks.yaml            # the shared work record  (committed)
├── state/<task>/<agent>/ # context.md, agent.env, output.md, transcript.log
├── events/<task>.jsonl   # append-only history     (ignored)
└── bin/harness           # shim
```

`tasks.yaml` is committed — it is how a task survives a session. `state/`,
`locks/`, `logs/` and `metrics/` are machine-local and git-ignored.

## Commands

| | |
|---|---|
| `harness init [--force] [--no-tooling]` | scaffold `.harness/` and wire tooling |
| `harness doctor` | check adapters, hooks, rule wiring |
| `harness sync` | compile agents into `.claude/agents/` |
| `harness task add\|list\|show\|set` | manage tasks |
| `harness next` | who is up |
| `harness run [--task] [--agent]` | drive the pipeline headlessly |
| `harness open <agent> [--task]` | interactive session with context loaded |
| `harness ctx --task --agent` | render context + env without running anything |
| `harness gate --task --agent` | run the gates only (exit 10 on failure) |
| `harness handoff --task --agent` | gate, then advance (or `--reject "<why>"`) |
| `harness rules list\|add` | inspect and scaffold rules |
| `harness spec lint [file]` | structurally lint Gherkin |
| `harness metrics crap [--max]` | rank functions by CRAP score |
| `harness tdd red\|guard\|ratchet` | the test-first gates |

## How it is built

Three layers, so each is testable on its own:

- **TypeScript** (`src/`) owns YAML, schemas, atomic `tasks.yaml` writes, context
  rendering and metrics. It never spawns an agent CLI.
- **Shell** (`runtime/`) owns process orchestration: adapters, the pipeline loop,
  locking. It never parses YAML — the CLI hands it a sourceable env file, so its
  only hard dependencies are POSIX and `node`.
- **`.harness/`** holds all config and state, project-local.

Adding a vendor means one shell script implementing the adapter contract
(`runtime/adapters/*.sh`) — see [AGENTS.md](AGENTS.md).

## Requirements

Node ≥ 20.11, git, and at least one of `claude` / `codex` on `PATH`.
`shellcheck` is optional; shell linting skips with a warning when it is absent.

## License

MIT
