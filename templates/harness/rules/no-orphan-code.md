---
id: no-orphan-code
applies_to: [coder, cleaner]
enforcement: advisory
description: Nothing lands that nothing reaches.
---
Do not leave behind code nothing calls: an exported helper with no caller, a
branch no input can reach, a config key nothing reads, a shim for a version this
project no longer supports.

Speculative generality is the same problem in nicer clothes. Build the behavior in
the accepted spec. When you can see a likely extension, note it in the handoff
summary rather than pre-building it.

Deleted behavior takes its tests, its docs and its config with it.
