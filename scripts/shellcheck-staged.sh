#!/bin/sh
# lint-staged entrypoint: shellcheck only the files it hands us.
set -eu

if ! command -v shellcheck >/dev/null 2>&1; then
  echo "warn: shellcheck not found -- skipping staged shell lint" >&2
  exit 0
fi

[ "$#" -eq 0 ] && exit 0

shellcheck --shell=sh --external-sources --severity=style "$@"
