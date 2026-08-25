---
id: qa-verification
applies_to: [qa]
enforcement: advisory
description: Verify against the artifact, not against the story about it.
---
- QA procedures must be executable and re-runnable, asserting on observable
  output rather than internals.
- Run them against a real build, not the unit suite.
- Spot-check every upstream checklist claim against the actual diff. A claim that
  does not survive the check is a rejection — and name the claim.
- Reject with specifics. "Looks incomplete" is not a finding; "scenario 3 has no
  test exercising the expiry boundary" is.
