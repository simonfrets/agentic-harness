#!/bin/sh
# Claude Code adapter.
#
# Contract (shared by every adapter):
#   in   -- HARNESS_* env, already exported by the stage; the rendered context
#           document at $HARNESS_CONTEXT_FILE
#   out  -- the agent writes output.md, optionally checklist.env and reject.txt,
#           into $HARNESS_STATE_DIR
#   exit -- 0 ok, 20 reject, 30 needs a human, anything else is an error
set -eu

bin=${HARNESS_ADAPTER_BIN:-claude}
: "${HARNESS_CONTEXT_FILE:?adapter needs HARNESS_CONTEXT_FILE}"

[ -n "${HARNESS_MODEL:-}" ] && set -- --model "$HARNESS_MODEL"

if [ "${HARNESS_MODE:-headless}" = interactive ]; then
  # Interactive: hand the human a live session with the agent's context already
  # loaded. No -p, and no handoff -- the person decides when the stage is done.
  exec "$bin" "$@" --append-system-prompt "$(cat "$HARNESS_CONTEXT_FILE")"
fi

set -- "$@" -p --output-format text
[ -n "${HARNESS_TOOLS:-}" ] && set -- "$@" --allowedTools "$HARNESS_TOOLS"

exec "$bin" "$@" <"$HARNESS_CONTEXT_FILE"
