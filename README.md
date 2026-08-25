# Agentic Harness

Agentic Harness is a TypeScript-based, project-local workflow engine for
coordinating coding agents through CLI adapters such as Codex and Claude.

The framework is being built around one hard boundary: installing it into a
project places its configuration, agents, rules, task state, contexts, hooks,
and runtime under that project's `.harness/` directory.

## Current status

This branch contains the package foundation only. Agent orchestration, CLI
adapters, task handoffs, and the `.harness/` installer have not been implemented
yet.

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

## Testing shell scripts

Shell behavior is tested from Jest rather than asserted by ad hoc manual steps.
Tests spawn scripts using Bash and isolate filesystem behavior in temporary
fixture directories.

## Planned modules

- Self-contained `.harness/` installer and diagnostics
- Typed Codex and Claude CLI adapter contract
- Isolated agent definitions and model/tool policies
- Atomic `tasks.yaml` state and resumable handoffs
- Declarative coding, Git workflow, and maintainability rules
- Specifier, coder, cleaner, architect, hardender, and QA agents
