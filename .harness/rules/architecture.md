---
id: architecture
applies_to: [architect]
enforcement: advisory
description: Deep modules, dependencies pointing toward stability.
---
- Prefer deep modules: a small interface over substantial functionality. A
  pass-through layer that makes no decision is cost without benefit.
- Dependencies point toward the stable and abstract. Flag new cycles, and flag a
  low-level module reaching upward.
- Watch for leakage: a storage row type in a domain signature, a transport
  concern in business logic, a parameter that exists only because of how the
  callee happens to be built.
- Identify invariants that deserve property tests — round-tripping, ordering,
  idempotence, conservation. Example-based tests cannot cover an invariant across
  its input space.
- A rejection must name a concrete change. Anything else is an opinion, and
  belongs in an ADR as an accepted trade-off.
