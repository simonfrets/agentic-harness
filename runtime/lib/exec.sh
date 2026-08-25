#!/bin/sh
# Locating and calling the harness CLI. Sourced, never executed.
#
# The shell layer owns process orchestration and nothing else: every question
# about YAML, schemas or task state is answered by calling back into the CLI.

# Resolve once, cache in HARNESS_CLI. Order matters: an explicit override wins,
# then the project's own shim, then whatever is on PATH.
harness_cli() {
  if [ -n "${HARNESS_CLI:-}" ]; then
    printf '%s' "$HARNESS_CLI"
    return 0
  fi

  _root=${HARNESS_ROOT:-$(pwd)}
  if [ -x "$_root/.harness/bin/harness" ]; then
    HARNESS_CLI="$_root/.harness/bin/harness"
  elif command -v harness >/dev/null 2>&1; then
    HARNESS_CLI=harness
  elif [ -f "$_root/node_modules/agentic-harness/dist/cli/index.js" ]; then
    HARNESS_CLI="node $_root/node_modules/agentic-harness/dist/cli/index.js"
  else
    return 1
  fi

  export HARNESS_CLI
  printf '%s' "$HARNESS_CLI"
}

# harness_run <args...> -- call the CLI with arguments kept intact.
# HARNESS_CLI may hold a multi-word command, so it is re-parsed by sh while the
# arguments are passed positionally and never re-split.
harness_run() {
  _cli=$(harness_cli) || {
    printf 'err  cannot find the harness CLI (set HARNESS_CLI)\n' >&2
    return 1
  }
  sh -c "$_cli \"\$@\"" harness "$@"
}

# Parse the shared --task/--agent/--adapter flags into TASK/AGENT/ADAPTER.
parse_common_flags() {
  TASK=${TASK:-}
  AGENT=${AGENT:-}
  ADAPTER=${ADAPTER:-}
  while [ "$#" -gt 0 ]; do
    case $1 in
      --task)    TASK=${2:?--task needs a value}; shift 2 ;;
      --agent)   AGENT=${2:?--agent needs a value}; shift 2 ;;
      --adapter) ADAPTER=${2:?--adapter needs a value}; shift 2 ;;
      --) shift; break ;;
      *) printf 'err  unknown argument: %s\n' "$1" >&2; return 2 ;;
    esac
  done
}
