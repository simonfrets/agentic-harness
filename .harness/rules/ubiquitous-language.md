---
id: ubiquitous-language
applies_to: [specifier, architect]
enforcement: advisory
description: One name per concept, everywhere.
---
Use the vocabulary the domain and the codebase already use. If the code says
`account`, do not write `profile` in the spec; if the spec says `reset token`, do
not let the implementation call it `nonce`.

When a genuinely new concept appears, name it once, deliberately, and use that
name in the spec, the code and the tests. When two names exist for one concept,
pick one and record the decision — an ADR under `docs/adr/` is the place for it.
