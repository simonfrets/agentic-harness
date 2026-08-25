# AGENTS.md

Contract for any agent — human or otherwise — working **in this repository**.
For what the harness *does*, read [README.md](README.md).

## Commands

```sh
npm ci
npm run build        # tsc -> dist/
npm run typecheck    # tsc --noEmit
npm run lint         # eslint, type-aware, --max-warnings 0
npm run lint:sh      # shellcheck (skips with a warning if not installed)
npm test             # unit + shell
npm run test:unit    # TypeScript core only
npm run test:shell   # spawns the runtime against fake adapter binaries
npm run test:cov     # with coverage thresholds
npm run verify       # everything above, in order
```

`npm run test:shell` builds `dist/` first (jest `globalSetup`), because the shell
layer drives the compiled CLI exactly as a real project would.

## Architecture

Three layers. The boundaries are the design, not an accident:

| Layer | Owns | Must never |
|---|---|---|
| `src/` TypeScript | YAML, schemas, atomic `tasks.yaml` writes, context rendering, gates, metrics | spawn an agent CLI |
| `runtime/` POSIX sh | adapter invocation, pipeline loop, locking, hooks | parse YAML |
| `templates/` | what `harness init` scaffolds into a host project | contain machine-specific paths |

The seam between the first two is `harness ctx`, which writes `context.md` (for
the agent) and `agent.env` (for the shell). Because every value arrives already
resolved and shell-quoted, the runtime needs no `yq` and no `jq` — only POSIX and
`node`.

`macOS has no flock(1)`, so locking is atomic `mkdir` plus a pid file with stale
detection (`src/core/tasks/lock.ts`). Both layers can take the same lock.

### Files worth knowing

- `src/core/tasks/store.ts` — atomic read-modify-write of `tasks.yaml`. The
  correctness centre of the system; every mutation goes through `updateTasksFile`.
- `src/core/gates/index.ts` — write-scope, tdd-pair, red-receipt and rule checks.
- `src/core/handoff.ts` — the only place task ownership changes.
- `src/core/context/render.ts` — enforces context isolation.
- `runtime/pipeline/stage.sh` — one agent's turn: render, run, hand off.
- `tests/fixtures/bin/{claude,codex}` — fake adapters. They make the whole
  pipeline testable at zero API cost; keep them in step with the real adapters.

## Working rules

**Test-first, and it is enforced.** A `commit-msg` hook runs
`runtime/tdd/guard.sh`: production code (`src/**`, `runtime/**`) may not change
without a matching change under `tests/**`. The escape hatch is
`[skip-tdd: <reason>]` in the commit message — the reason is mandatory.

Write the failing test, watch it fail, then implement. When you are working a
harness task, record it: `harness tdd red <test> --task <id> --agent <you>`.

**Never edit a test to make an implementation pass.** If a test has to change,
the behaviour changed, and that is a separate, deliberate commit.

**Match the surrounding code.** Comment the reason, not the mechanism.

**Shell is POSIX `sh`,** not bash. No arrays, no `[[ ]]`, no `local`. Run
`npm run lint:sh` — CI has shellcheck even when your machine does not.

Libraries under `runtime/lib/` are sourced, so they must not set shell options;
entrypoints set `set -eu` themselves.

**Errors carry codes.** Throw `HarnessError` with a `HarnessErrorCode`, never a
bare `Error` — the CLI maps codes to exit codes and the shell branches on them.
Exit codes: `0` ok, `2` usage, `10` gate failed, `20` reject, `30` needs a human.

## Extending it

**A new agent** — add `templates/harness/agents/<name>.yaml` and
`templates/harness/prompts/<name>.md`, then put it in the `pipeline` list in
`harness.config.yaml`. Give it a `write_scope`: an agent with no declared scope
skips the gate that would otherwise hold it to anything. Set `handoff_to`, or
leave it off to mark the final stage.

**A new rule** — one markdown file under `templates/harness/rules/`. Add a
`check:` script under `rules/checks/` to make it blocking; it must exit 0 to
pass, and it receives `HARNESS_ROOT`, `HARNESS_DIR`, `HARNESS_TASK` and
`HARNESS_AGENT` in the environment.

**A new adapter** — one script at `runtime/adapters/<name>.sh` implementing the
contract:

- **in**: `HARNESS_*` env (already exported), the context document at
  `$HARNESS_CONTEXT_FILE`
- **out**: the agent writes `output.md`, optionally `checklist.env`
  (`id=true` per line) and `reject.txt`, into `$HARNESS_STATE_DIR`
- **exit**: `0` ok, `20` reject, `30` needs a human, anything else an error
- honour `HARNESS_MODE=interactive` by exec'ing a live session instead of a
  headless run

Add it to `adapters` in `harness.config.yaml`, and add a fake binary under
`tests/fixtures/bin/` so it is covered without network access.

**A new gate** — add it in `src/core/gates/index.ts` and return a `GateOutcome`.
A gate that cannot run should return `skip` with a reason, never `pass`; a gate
that silently passes when it is broken is worse than no gate.

## Conventions

- Branches: `feat/<task-id>-<slug>`. Never commit to `main`.
- Conventional Commits. Subject ≤ ~72 characters; the body explains why when the
  diff does not.
- `tasks.yaml` is committed. `.harness/state/`, `locks/`, `logs/` and `metrics/`
  are not.
- Coverage has a floor of 80% and a ratchet — it may not regress.
