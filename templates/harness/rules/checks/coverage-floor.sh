#!/bin/sh
# Blocking check for the `coverage-floor` rule.
#
# Coverage is only meaningful if it was measured; a missing report is a failure,
# not a pass. Run the suite with coverage before handing off.
set -eu

cd "${HARNESS_ROOT:-.}"

if [ ! -f coverage/coverage-summary.json ]; then
  echo "coverage-floor: no coverage/coverage-summary.json" >&2
  echo "  run your suite with coverage first (npm run test:cov)" >&2
  exit 1
fi

exec harness tdd ratchet
