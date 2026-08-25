#!/bin/sh
# Blocking check for the `tdd` rule.
#
# Delegates to the shipped guard so the pre-commit hook and the handoff gate
# apply exactly one implementation of the rule.
#
# Env provided by the harness: HARNESS_ROOT, HARNESS_DIR, HARNESS_TASK, HARNESS_AGENT.
set -eu

# The harness tells every check where its own runtime lives, so this never has
# to guess at a node_modules layout. The fallbacks are for running the check by
# hand, outside a handoff.
if [ -n "${HARNESS_RUNTIME_DIR:-}" ]; then
  guard="$HARNESS_RUNTIME_DIR/tdd/guard.sh"
else
  pkg=$(node -e 'process.stdout.write(require.resolve("agentic-harness/package.json"))' 2>/dev/null || true)
  if [ -n "$pkg" ]; then
    guard="$(dirname "$pkg")/runtime/tdd/guard.sh"
  else
    guard="${HARNESS_ROOT:-.}/node_modules/agentic-harness/runtime/tdd/guard.sh"
  fi
fi

if [ ! -f "$guard" ]; then
  echo "tdd-pair: cannot find the harness runtime guard ($guard)" >&2
  exit 1
fi

# The whole task diff, not just what is staged: an agent's work may be uncommitted.
base=${HARNESS_BASE_REF:-HEAD}
sh "$guard" --range "$base"
