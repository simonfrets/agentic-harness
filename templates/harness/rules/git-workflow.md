---
id: git-workflow
applies_to: [coder, cleaner, hardener, qa]
enforcement: blocking
check: checks/branch-naming.sh
description: One task, one branch, one reviewable history.
---
- Work on `feat/<task-id>-<slug>`, e.g. `feat/T-001-password-reset`. Never commit
  to the default branch.
- One commit per coherent slice. A commit touching three unrelated things is
  three commits.
- The subject says what changed and why in roughly 72 characters or fewer; the
  body explains the reason when the diff does not.
- Never amend or force-push a branch another agent may be holding.
