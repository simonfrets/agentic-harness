---
id: spec-quality
applies_to: [specifier]
enforcement: advisory
description: A specification describes observable behavior, completely.
---
- Scenarios describe what a user or caller can observe. No function names, no
  module structure, no "the service should call…".
- One behavior per scenario. Three `When` steps mean three scenarios.
- Cover the unhappy paths; failure behavior is behavior.
- `Scenario Outline` is one behavior across a set of inputs, not a way to pack
  unrelated cases into a table.
- No `TODO`, `TBD` or `???`. An unresolved question becomes a written assumption
  or gets asked — never a silent guess.
- Run `harness spec lint` and fix every error before handing off.
