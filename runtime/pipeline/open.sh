#!/bin/sh
# Open an interactive session for one agent, with its context already loaded.
#
# Usage: open.sh --agent <name> [--task <id>] [--adapter <name>]
#
# Deliberately does not hand off. The pipeline advances when a person says so,
# by running `harness handoff` themselves.
set -eu

_here=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=../lib/log.sh
. "$_here/lib/log.sh"
# shellcheck source=../lib/exec.sh
. "$_here/lib/exec.sh"

TASK=''; AGENT=''; ADAPTER=''
parse_common_flags "$@"
[ -n "$AGENT" ] || log_die 2 "open.sh needs --agent"

# Default to whatever this agent is already holding.
if [ -z "$TASK" ]; then
  up=$(harness_run next) || true
  TASK=${up%% *}
  [ -n "$TASK" ] && [ "$TASK" != 'nothing' ] || log_die 2 "no open task -- pass --task"
fi

set -- ctx --task "$TASK" --agent "$AGENT" --mode interactive
[ -n "$ADAPTER" ] && set -- "$@" --adapter "$ADAPTER"
state=$(harness_run "$@") || log_die 1 "could not render context for $AGENT"

# shellcheck disable=SC1091
. "$state/agent.env"

adapter_script="$_here/adapters/$HARNESS_ADAPTER.sh"
[ -f "$adapter_script" ] || log_die 1 "no adapter script for '$HARNESS_ADAPTER'"

log_info "$AGENT on $TASK -- context in $state/context.md"
log_info "when you are done:  harness handoff --task $TASK --agent $AGENT"

exec sh "$adapter_script"
