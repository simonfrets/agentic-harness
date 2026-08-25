#!/bin/sh
# Shared logging. Sourced, never executed -- so it must not set shell options.
#
# Everything goes to stderr. Adapter and command stdout is reserved for machine
# readable payloads; mixing log lines into it would corrupt the pipeline.

if [ -t 2 ] && [ -z "${HARNESS_NO_COLOR:-}" ]; then
  _h_dim='\033[2m'; _h_red='\033[31m'; _h_yel='\033[33m'
  _h_grn='\033[32m'; _h_rst='\033[0m'
else
  _h_dim=''; _h_red=''; _h_yel=''; _h_grn=''; _h_rst=''
fi

log_debug() { [ -n "${HARNESS_DEBUG:-}" ] || return 0; printf "${_h_dim}  %s${_h_rst}\n" "$*" >&2; }
log_info()  { printf "  %s\n" "$*" >&2; }
log_ok()    { printf "${_h_grn}  ok${_h_rst} %s\n" "$*" >&2; }
log_warn()  { printf "${_h_yel}warn${_h_rst} %s\n" "$*" >&2; }
log_err()   { printf "${_h_red} err${_h_rst} %s\n" "$*" >&2; }

# log_die <exit-code> <message...>
log_die() {
  _code=$1
  shift
  log_err "$*"
  exit "$_code"
}
