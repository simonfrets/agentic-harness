#!/bin/sh
# Codex CLI adapter. Same contract as claude.sh -- see that file.
#
# Codex is not installed on every machine, so this is verified against the
# contract double in tests/fixtures/bin/codex rather than the real binary.
set -eu

bin=${HARNESS_ADAPTER_BIN:-codex}
: "${HARNESS_CONTEXT_FILE:?adapter needs HARNESS_CONTEXT_FILE}"

[ -n "${HARNESS_MODEL:-}" ] && set -- --model "$HARNESS_MODEL"

if [ "${HARNESS_MODE:-headless}" = interactive ]; then
  exec "$bin" "$@" <"$HARNESS_CONTEXT_FILE"
fi

# `exec` is codex's non-interactive subcommand; workspace-write matches what the
# write-scope gate expects to police afterwards.
exec "$bin" exec --sandbox workspace-write "$@" <"$HARNESS_CONTEXT_FILE"
