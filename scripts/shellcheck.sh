#!/bin/sh
# Lint every shell script in the repo.
#
# shellcheck is not an npm package and may not be installed. A missing linter
# must not fail a developer's build, but it must be loud -- CI installs it, so
# the skip only ever happens locally.
set -eu

if ! command -v shellcheck >/dev/null 2>&1; then
  echo "warn: shellcheck not found -- skipping shell lint (brew install shellcheck)" >&2
  exit 0
fi

# -x follows `. lib/foo.sh` sources so shared helpers are checked in context.
find runtime templates scripts tests -name '*.sh' -type f -print0 2>/dev/null |
  xargs -0 shellcheck --shell=sh --external-sources --severity=style

echo "shellcheck: clean"
