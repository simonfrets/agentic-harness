#!/bin/sh
# Drive a task through the pipeline headlessly, one stage at a time.
#
# Usage: run.sh [--task <id>] [--adapter <name>] [--agent <name>]
#
# With --agent it runs exactly one stage. Without, it keeps asking the CLI who
# is up next until the task is done, blocked or fails -- the CLI owns the
# ordering, so this loop never needs to know the pipeline.
set -eu

_here=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=../lib/log.sh
. "$_here/lib/log.sh"
# shellcheck source=../lib/exec.sh
. "$_here/lib/exec.sh"

TASK=''; AGENT=''; ADAPTER=''
parse_common_flags "$@"

# A cycle between two agents would otherwise spin forever. Rejections are
# legitimate, so the bound is generous -- it is a backstop, not a policy.
MAX_STAGES=${HARNESS_MAX_STAGES:-40}

run_stage() {
  set -- --task "$1" --agent "$2"
  [ -n "$ADAPTER" ] && set -- "$@" --adapter "$ADAPTER"
  sh "$_here/pipeline/stage.sh" "$@"
}

if [ -n "$AGENT" ]; then
  [ -n "$TASK" ] || log_die 2 "run.sh --agent also needs --task"
  run_stage "$TASK" "$AGENT"
  exit 0
fi

stages=0
while [ "$stages" -lt "$MAX_STAGES" ]; do
  if [ -n "$TASK" ]; then
    up=$(harness_run next --task "$TASK")
  else
    up=$(harness_run next)
  fi

  # Empty, or anything that is not "<id> <agent>", means there is nothing to run.
  case $up in
    'nothing to do'|'') log_ok "nothing left to run"; exit 0 ;;
  esac

  task=${up%% *}
  agent=${up##* }
  [ -n "$task" ] && [ -n "$agent" ] && [ "$task" != "$agent" ] || {
    log_ok "nothing left to run"
    exit 0
  }

  run_stage "$task" "$agent"
  stages=$((stages + 1))
done

log_die 1 "stopped after $MAX_STAGES stages -- the pipeline is looping"
