---
id: tdd
applies_to: [coder, cleaner, hardener]
enforcement: blocking
check: checks/tdd-pair.sh
description: Production code never moves without its tests.
---
Write the failing test first. Record it with
`harness tdd red <test> --task <id> --agent <you>` before writing the implementation.

The receipt captures a hash of the production code at the moment the test was red.
The handoff gate requires that some production file changed **after** the receipt,
so a receipt recorded once the code already existed proves nothing and does not pass.

Production code changing with no test change at all fails this rule outright. If
something is genuinely untestable, say so in the handoff summary and in the commit
message as `[skip-tdd: <reason>]` — the reason is mandatory and is recorded in the
task event log, so a skip is always visible.
