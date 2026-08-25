#!/bin/sh
# Blocking check for the `crap-threshold` rule.
set -eu

cd "${HARNESS_ROOT:-.}"

if [ ! -f coverage/coverage-final.json ]; then
  echo "crap-threshold: no coverage/coverage-final.json" >&2
  echo "  run your suite with coverage first (npm run test:cov)" >&2
  exit 1
fi

# `harness metrics crap --max` exits 10 when anything is over the ceiling.
exec harness metrics crap --max "${HARNESS_CRAP_CEILING:-30}" --top 10
