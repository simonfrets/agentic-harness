#!/bin/sh
# Blocking check for the `git-workflow` rule: one task, one correctly named branch.
set -eu

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')
[ -n "$branch" ] || { echo "branch-naming: not a git repository" >&2; exit 1; }

# A detached HEAD is a legitimate state for a CI checkout; nothing to enforce.
[ "$branch" = HEAD ] && exit 0

default=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
[ -n "$default" ] || default=main

if [ "$branch" = "$default" ] || [ "$branch" = master ]; then
  echo "branch-naming: refusing to work directly on $branch" >&2
  echo "  create feat/${HARNESS_TASK:-T-000}-<slug> first" >&2
  exit 1
fi

case $branch in
  feat/*|fix/*|chore/*|refactor/*|docs/*) ;;
  *)
    echo "branch-naming: '$branch' does not start with feat/ fix/ chore/ refactor/ docs/" >&2
    exit 1
    ;;
esac

# When the harness knows the task, the branch has to say so.
if [ -n "${HARNESS_TASK:-}" ]; then
  case $branch in
    *"$HARNESS_TASK"*) ;;
    *)
      echo "branch-naming: '$branch' does not mention $HARNESS_TASK" >&2
      echo "  expected something like feat/$HARNESS_TASK-<slug>" >&2
      exit 1
      ;;
  esac
fi

exit 0
