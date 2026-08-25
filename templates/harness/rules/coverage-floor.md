---
id: coverage-floor
applies_to: [cleaner, hardener]
enforcement: blocking
check: checks/coverage-floor.sh
description: Coverage may not regress.
---
Line coverage must stay at or above the baseline recorded in
`.harness/metrics/baseline.json` and above the project floor in
`harness.config.yaml`. The baseline only ever moves up.

Coverage is a floor, not a goal. A file at 100% whose tests assert nothing is
worse than an honest 80%, because it hides the gap. Cover the branches a reader
would worry about and let the number follow.
