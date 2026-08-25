#!/usr/bin/env bash

set -uo pipefail

root="${1:-.}"

if [[ ! -d "$root" ]]; then
  printf 'Shell syntax root is not a directory: %s\n' "$root" >&2
  exit 2
fi

status=0

while IFS= read -r -d '' file; do
  if ! bash -n "$file"; then
    status=1
  fi
done < <(
  find "$root" \
    -type f \
    -name '*.sh' \
    -not -path '*/.git/*' \
    -not -path '*/node_modules/*' \
    -print0
)

exit "$status"
