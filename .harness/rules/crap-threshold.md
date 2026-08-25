---
id: crap-threshold
applies_to: [cleaner, hardener]
enforcement: blocking
check: checks/crap-threshold.sh
description: No function may be both complicated and untested.
---
CRAP is complexity squared times (1 − coverage) cubed, plus complexity. It is
deliberately hard to satisfy by cheating: a hairy function can only score well by
being both simpler and better covered.

The ceiling is `tdd.crapCeiling` in `harness.config.yaml` (default 30). Run
`harness metrics crap --top 20` and work down from the top. Splitting a function
purely to duck the metric, without making it easier to understand, is not an
improvement — say so in the handoff instead.
