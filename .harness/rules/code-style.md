---
id: code-style
applies_to: ["*"]
enforcement: advisory
description: Write code that reads like the code around it.
---
- Match the surrounding file: its naming, its idiom, its comment density. A
  correct change in a foreign style still costs the next reader.
- Comment the reason, not the mechanism. A comment restating the line below it is
  noise; one explaining why the obvious approach was rejected is worth keeping.
- Name things after what they mean in the domain, not after their type or shape.
- Prefer a small interface over substantial functionality. An interface nearly as
  complicated as the implementation behind it is not carrying its weight.
- Handle errors where you can do something about them; otherwise let them travel
  with enough context to be diagnosed.
