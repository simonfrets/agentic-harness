#!/bin/sh
# Blocking check for the `tdd` rule.
#
# Delegates to the shipped guard so the pre-commit hook and the handoff gate
# apply exactly one implementation of the rule.
#
# Env provided by the harness: HARNESS_ROOT, HARNESS_DIR, HARNESS_TASK, HARNESS_AGENT.
set -eu

guard=$(node -e 'process.stdout.write(require.resolve("agentic-harness/package.json"))' 2>/dev/null || true)
if [ -n "$guard" ]; then
  guard="$(dirname "$guard")/runtime/tdd/guard.sh"
else
  guard="${HARNESS_ROOT:-.}/node_modules/agentic-harness/runtime/tdd/guard.sh"
fi

if [ ! -f "$guard" ]; then
  echo "tdd-pair: cannot find the harness runtime guard ($guard)" >&2
  exit 1
fi

# The whole task diff, not just what is staged: an agent's work may be uncommitted.
base=${HARNESS_BASE_REF:-HEAD}
sh "$guard" --range "$base"
