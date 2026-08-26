# Milestone C handoff: tasks, contexts, and handoffs

## How to start

Open a new session in this worktree and paste the prompt at the end of this
document. Read `AGENTS.md`, `README.md` and `docs/handoff/rule-enforcement.md`
(the original A–D design) before writing code. `docs/handoff/milestone-b.md`
and `docs/handoff/milestone-b3.md` are archived: their B1–B4 scope is now
complete and this document supersedes them.

## Where things stand

- Worktree: `/Users/sinancoskun/Projects/agentic-harness-codex-basic-structure`
- Branch: `codex/basic-structure`
- HEAD: `343f64c Enforce the gates in CI, for this repo and for installed projects`
- Working tree clean. Pushed to `origin`; open as pull request #2 against
  `main`, which was an empty root commit until this branch was rebased onto it.

`npm run check`, `npm run build`, `npm run test:coverage` and
`npm pack --dry-run` all pass: 520 tests across 51 suites at 99.18% statements
against thresholds of 90/90/90/80. `src/install` and `src/project` are at 100%
on every metric. The same gate runs in GitHub Actions on Linux and macOS, which
is the enforcement; `.husky/pre-commit` is the convenience.

### Committed since the last handoff

| Commit    | Subject                                              |
| --------- | ---------------------------------------------------- |
| `ebe67c9` | Record the Milestone B3 handoff                      |
| `1c0b179` | Install the harness into a project idempotently (B3) |
| `3fcbb3e` | Dispatch Git hooks without discarding existing ones  |

Milestone B is complete. `README.md` documents the installer, the doctor and
hook dispatch, and documents only behaviour that exists.

### What B3 and B4 added

| Module                                | Public surface                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/install/atomic-write.ts`         | `writeFileAtomic`                                                                        |
| `src/install/install-manifest.ts`     | `readInstallManifest`, `writeInstallManifest`, `hashManagedFile`, `hookRecordSchema`     |
| `src/install/plan-installation.ts`    | `planInstallation`, `toPlannedFileSource`, `INSTALL_ACTIONS`                             |
| `src/install/runtime-dependencies.ts` | `installRuntimeDependencies`, `buildRuntimePackageManifest`, `RUNTIME_INSTALL_ARGV`      |
| `src/install/discover-hooks.ts`       | `discoverHookEnvironment`, `toProjectPath`                                               |
| `src/install/plan-hooks.ts`           | `planHooks`                                                                              |
| `src/install/hook-scripts.ts`         | `buildHarnessLauncher`, `buildHookDispatcher`, `escapeForDoubleQuotes`, `hookScriptPath` |
| `src/install/install-harness.ts`      | `installHarness`                                                                         |
| `src/install/diagnose-harness.ts`     | `diagnoseHarness`, `REQUIRED_NODE_VERSION`, `REQUIRED_TOOLS`, `versionOrder`             |
| `src/cli/commands/init.ts`            | registered as `init`                                                                     |
| `src/cli/commands/doctor.ts`          | registered as `doctor`                                                                   |
| `src/cli/format-install-result.ts`    | `formatInstallResult`                                                                    |
| `src/cli/format-diagnosis.ts`         | `formatDiagnosis`                                                                        |

`CliContext` gained `nodeVersion`, supplied by the bin entry as
`process.versions.node`, so `doctor` can compare against
`REQUIRED_NODE_VERSION` without any module but `src/cli/index.ts` touching
`process`. `HARNESS_ERROR_KINDS` gained `git-config-failed`, mapped to exit 5.

## Verified against a throwaway repository

Acceptance criteria 1–6 from the A–D handoff were demonstrated by hand against
a temporary Git project, not only by tests:

1. `harness init` left the host `package.json` and `eslint.config.js`
   byte-identical.
2. The footprint was `.harness/` plus one local Git setting,
   `core.hooksPath=.harness/hooks`.
3. A real `git commit` printed the project's own `pre-commit` hook first, then
   the harness gate, then the project's `commit-msg` hook — which the harness
   has no gate for and preserved with a pass-through.
4. A `rules/custom/team.yaml` bundle appeared in `rules explain --agent coder`
   and ran as a fifth check at `gate pre-commit`, with no TypeScript change.
5. Making that rule's required check fail blocked a real commit (exit 4).
6. The same failure as a `warning`, `required: false` rule was reported in full
   and the commit landed.

Criterion 7 (hash stability across independent directories) is covered by
`tests/integration/rules/hash-stability.test.ts`. Criteria 8–10 belong to
Milestones C and D.

## Deviations and known defects

Read these before planning Milestone C. None is hidden by a passing test.

1. **`agentic-harness` is still unpublished, so a real `harness init` cannot
   finish.** `npm install` inside `.harness/` fails with `ETARGET` and the CLI
   exits 5. This is by design safe — files, manifest, hook dispatchers and the
   Git setting are all written first, so re-running repairs the install — but
   it means no end-to-end install works until the package resolves. The
   demonstration above unpacked `npm pack`'s tarball into
   `.harness/node_modules/` by hand to get past it.

2. ~~A project cannot edit `config/project.yaml` or `config/hooks.yaml` and
   then re-run `harness init`.~~ **Fixed in C0.** Installed files now carry a
   kind. A `seeded` file is written once and never reconciled; ownership is a
   property of the shipped file rather than of the manifest entry, so an
   installation made by an earlier version is reclassified rather than
   migrated. `installHarness` reads the _installed_ `config/hooks.yaml` rather
   than the template, because accepting an edit and then ignoring it would be
   worse than refusing it.

3. **Installing from one linked worktree redirects hooks for the whole
   repository.** `core.hooksPath` is repository-local configuration that Git
   shares across worktrees. The written value is relative so each worktree
   resolves its own `.harness/hooks`, but a worktree without one then runs no
   hooks at all. Documented in `README.md`; the alternative,
   `extensions.worktreeConfig`, changes repository configuration semantics
   globally and was judged too invasive to enable on a project's behalf.

4. ~~`discoverProjectProfile` still hardcodes `validationMode`.~~ **Fixed in
   C0**, together with defect 2, since both are about reading a file the
   project owns. The profile now reports the installed `validationMode`, and a
   `packageManager` pin there wins over the host manifest's field. **Still
   open: nothing acts on `validationMode`.** It is carried on the profile and
   reported, but no gate filters on it, so `native-only` and `harness-only`
   currently describe an intent the runtime does not honour. Deciding what they
   filter — rule origin is the obvious axis — is open work, and is a change to
   gate behaviour rather than to discovery.

5. **`config/models.yaml` and `config/providers.yaml` remain deferred to
   Milestone D**, which validates provider flags against a real CLI `--help`.

6. ~~There is no CI, so every gate is skippable with `--no-verify`.~~ **Fixed**,
   in two separate places, because they are two separate problems.

   For this repository, `.github/workflows/ci.yml` runs the full completion
   gate on Linux and macOS, taking its Node version from `engines.node` so the
   two cannot drift. `tests/integration/ci/workflow.test.ts` asserts its exact
   command list and that no step can pass while failing.

   For an installed project the harness cannot place the workflow itself: a
   GitHub Actions file has to live in `.github/workflows/`, outside the
   `.harness/` boundary that design decision 1 forbids crossing. It therefore
   ships one at `.harness/ci/github-actions.yml`, `harness init` says once that
   it needs copying, and `harness doctor` reports its absence as a warning. If
   a future session wants installation to place it directly, that is a second
   documented exception to decision 1 and should be argued for as one, not
   slipped in.

7. ~~`package.json` declares MIT with no `LICENSE` file.~~ **Fixed.** MIT
   `LICENSE`, `author`, and `LICENSE` in the published `files`.

## Traps this repository will spring on you

The first five are carried forward and still bite. The sixth cost this session
a corrupted branch.

1. **`import.meta.url` does not work under Jest.** `tsconfig.test.json`
   transpiles to CommonJS for ts-jest while the build emits NodeNext ESM. The
   package root is injected as `packageRootDirectory: string` and resolved in
   exactly one place — `src/cli/index.ts`, which no test imports. `nodeVersion`
   now travels the same way.
2. **A type-only module reports 0% coverage.** Declare types beside the values
   they describe.
3. **`src/index.ts` barrel re-exports count as functions.**
   `tests/unit/index.test.ts` holds an explicit `PUBLIC_API` list — now 140
   entries — that must be updated whenever an export is added.
4. **Never weaken a gate.** `AGENTS.md` forbids it. No lowered threshold, no
   ignore comment, no `--no-verify`.
5. **`exactOptionalPropertyTypes` is on.** `{ timeoutMs }` where `timeoutMs` is
   `number | undefined` will not satisfy `timeoutMs?: number`. Spread
   conditionally: `...(x === undefined ? {} : { x })`.
6. **A test that spawns `git` must scrub `GIT_*` from the environment first.**
   Git exports `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` to the hooks it
   runs, and `.husky/pre-commit` runs the whole suite. The first attempt at
   `3fcbb3e` therefore ran its fixtures against _this_ repository: it rewrote
   the branch HEAD to a one-file commit, created a stray `feature` branch and
   registered a worktree pointing into `/tmp`. Recovery was
   `git reset --mixed`, `git worktree prune`, `git branch -D`. Use
   `tests/helpers/git.ts` — `runGit`, `initRepository` and `cleanEnvironment` —
   which strips those variables and asserts that Git resolves a fixture to the
   fixture. `nodeCommandRunner` was never at risk; its environment allowlist
   already drops every `GIT_*` variable.
7. **`tests/unit/install/harness-templates.test.ts` asserts the exact list of
   shipped template paths**, currently 13, _and_ the exact list of seeded ones.
   Adding a template fails both on purpose: the second is what forces a
   decision about who owns the new file. `bin/harness` and `hooks/*` are
   generated, not templates, and are in neither list.
8. **Seeding is only safe because every key in both config schemas has a
   default.** A seeded file written by an older harness must still parse when a
   later one adds a key. `shipped-templates.test.ts` asserts that
   `version: 1` alone validates; do not add a required key to either schema.
9. **`buildHarnessProject()` does not create `.harness/`.** Pass
   `files: { ".harness/…": … }`.
10. **`prettier --check .` covers the whole repository**, templates included.
11. **Yarn and Bun are not installed on this machine**; pnpm is. Prove their
    behaviour through argument-vector unit tests.
12. **`.husky/pre-commit` runs the full gate against the working tree**, not
    the index. To verify a commit on its own, move unrelated files aside first.
    It is also skippable with `--no-verify`; `.github/workflows/ci.yml` is what
    actually enforces the gate, and
    `tests/integration/ci/workflow.test.ts` asserts its exact command list so a
    step cannot be dropped from it quietly.
13. **A test that spawns git must never write an identity with `git config`.**
    `tests/helpers/git.ts` passes `-c user.name` / `-c user.email` per
    invocation instead. A fixture that wrote them with `git config` put them in
    _this_ repository's `.git/config`, where they went on to author four real
    commits as "Harness Test" before anyone noticed.
14. **This is a Git worktree and the stash stack is shared.** Never use bare
    `git stash` / `git stash pop`. Prefer a temporary WIP commit.

## Milestone C scope

Verbatim from `docs/handoff/rule-enforcement.md`, plus defect 2 above.

Use `yaml` for `.harness/tasks.yaml`. Add robust atomic writing and locking;
prefer reviewed libraries such as `proper-lockfile` and `write-file-atomic`
rather than inventing an incomplete lock protocol. `writeFileAtomic` already
handles the atomic rename for single managed files, but it takes no lock.

Implement these states:

```text
draft -> specified -> awaiting_approval -> implementing -> cleaning
      -> architecture_review -> hardening -> qa -> completed
```

Every active state may transition to `blocked` or `failed`, and only valid
recovery transitions may leave them. The coder cannot start before explicit
specification approval.

Each transition stores the task revision and the expected prior revision, the
source and target agent, the resolved rule-set SHA-256, gate report IDs and
artifact paths, timestamps, attempt number, failure details, and the
next-agent context path. Reject stale-revision writes.

Contexts live at `.harness/state/runs/<run-id>/agents/<agent-id>/` and must
never be shared by reference as one mutable global context.

`tasks.yaml` is deliberately **not** ignored by the shipped `.gitignore`, so
task state is reviewable in a pull request. `state/` is ignored.

C0 already answered the question C1 has to answer again: `tasks.yaml` is
neither managed nor seeded — the harness writes it continuously and the project
never hand-edits it. It should not go through `planInstallation` at all.

## Commit boundaries

| Step | Subject                                               | State |
| ---- | ----------------------------------------------------- | ----- |
| B3   | `Install the harness into a project idempotently`     | done  |
| B4   | `Dispatch Git hooks without discarding existing ones` | done  |
| C0   | `Separate seeded configuration from managed files`    | open  |
| C1   | `Store task state atomically`                         | open  |
| C2   | `Enforce workflow transitions`                        | open  |
| C3   | `Isolate agent contexts across handoffs`              | open  |

## Completion gate

```sh
npm run check
npm run build
npm run test:coverage
npm pack --dry-run
```

Then demonstrate acceptance criterion 9 — a stopped workflow resumes from
`tasks.yaml` without rerunning completed stages — against a throwaway Git
repository, and re-check criteria 1–6, which the installer must not regress.

Report any deviation directly. Do not describe partial work as complete.

## Starting prompt

> Continue Agentic Harness on branch `codex/basic-structure` in the worktree
> `/Users/sinancoskun/Projects/agentic-harness-codex-basic-structure`. Read
> `AGENTS.md`, `README.md`, `docs/handoff/rule-enforcement.md` and
> `docs/handoff/milestone-c.md` completely before writing code. Milestones A
> and B are committed and verified. Implement C0 through C3 only, test-first,
> with the listed commit boundaries. Do not build provider adapters. Run the
> completion gate and report any deviation directly.
