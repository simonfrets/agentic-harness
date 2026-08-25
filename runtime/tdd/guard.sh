#!/bin/sh
# TDD pair gate: production code never moves without its tests moving too.
#
# Two call sites, one rule:
#   guard.sh --message .git/COMMIT_EDITMSG   commit-msg hook (staged changes)
#   guard.sh --range main..HEAD              handoff gate (a task's whole diff)
#
# The commit-msg hook is deliberately the hook we use rather than pre-commit:
# only there is the commit message readable, and the message is where the
# escape hatch lives.
#
# Escape hatch: `[skip-tdd: <reason>]` in the commit message. The reason is
# mandatory -- a bare [skip-tdd] is rejected -- and it is echoed so that a skip
# is always visible in the terminal and in the task event log.
#
# Exit: 0 pass, 1 violation, 2 usage error.
set -eu

_here=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=../lib/log.sh
. "$_here/lib/log.sh"

# Path prefixes. Overridable so host projects with other layouts still work.
SRC_PREFIXES=${HARNESS_TDD_SRC:-"src runtime"}
TEST_PREFIXES=${HARNESS_TDD_TEST:-"tests test __tests__"}

mode=''
arg=''
while [ "$#" -gt 0 ]; do
  case $1 in
    --message) mode=message; arg=${2:?--message needs a file}; shift 2 ;;
    --range)   mode=range;   arg=${2:?--range needs a rev-range}; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) log_die 2 "unknown argument: $1" ;;
  esac
done

[ -n "$mode" ] || log_die 2 "usage: guard.sh --message <file> | --range <rev-range>"

# --- collect changed paths -------------------------------------------------
if [ "$mode" = message ]; then
  changed=$(git diff --cached --name-only --diff-filter=ACMRD)
else
  changed=$(git diff --name-only --diff-filter=ACMRD "$arg")
fi

[ -n "$changed" ] || { log_debug "tdd-guard: no changes"; exit 0; }

# --- classify --------------------------------------------------------------
# A path is a test if it sits under a test prefix OR its basename looks like a
# test file; anything under a src prefix that is not a test is production code.
matches_prefix() {
  _path=$1
  _prefixes=$2
  for _p in $_prefixes; do
    case $_path in "$_p"/*) return 0 ;; esac
  done
  return 1
}

is_test() {
  case $1 in
    *.test.ts|*.test.js|*.spec.ts|*.spec.js|*_test.sh|*.test.sh) return 0 ;;
  esac
  matches_prefix "$1" "$TEST_PREFIXES"
}

src_touched=''
test_touched=''
for f in $changed; do
  if is_test "$f"; then
    test_touched="$test_touched$f
"
  elif matches_prefix "$f" "$SRC_PREFIXES"; then
    src_touched="$src_touched$f
"
  fi
done

# Nothing production-y changed: docs/config commits pass untouched.
[ -n "$src_touched" ] || { log_debug "tdd-guard: no production changes"; exit 0; }
[ -z "$test_touched" ] || { log_debug "tdd-guard: paired"; exit 0; }

# --- escape hatch ----------------------------------------------------------
if [ "$mode" = message ] && [ -f "$arg" ]; then
  # Grab the reason inside [skip-tdd: ...]; empty reason -> rejected below.
  reason=$(sed -n 's/.*\[skip-tdd:[[:space:]]*\([^]]*\)\].*/\1/p' "$arg" | head -n1)
  if [ -n "$reason" ]; then
    log_warn "tdd-guard bypassed: $reason"
    exit 0
  fi
  if grep -q '\[skip-tdd\]' "$arg"; then
    log_die 1 "[skip-tdd] needs a reason -- write [skip-tdd: why this cannot be tested]"
  fi
fi

# --- fail ------------------------------------------------------------------
log_err "TDD pair gate: production code changed with no test changes."
printf '%s' "$src_touched" | while IFS= read -r f; do [ -n "$f" ] && log_info "  $f"; done
log_info ""
log_info "Write or update a test under: $TEST_PREFIXES"
log_info "Genuinely untestable? Add [skip-tdd: <reason>] to the commit message."
exit 1
