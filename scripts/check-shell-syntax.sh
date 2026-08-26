#!/usr/bin/env bash

set -uo pipefail

root="${1:-.}"

if [[ ! -d "$root" ]]; then
  printf 'Shell syntax root is not a directory: %s\n' "$root" >&2
  exit 2
fi

# The file list is written to a temporary file rather than piped through a
# process substitution. `find`'s exit status is invisible to the reading loop,
# so an unreadable subdirectory used to leave this gate reporting success
# having silently checked fewer files - or none at all.
list="$(mktemp)"
trap 'rm -f "$list"' EXIT

if ! find "$root" \
  -type f \
  -name '*.sh' \
  -not -path '*/.git/*' \
  -not -path '*/node_modules/*' \
  -print0 >"$list"; then
  printf 'Shell syntax scan failed under: %s\n' "$root" >&2
  exit 1
fi

status=0
checked=0

while IFS= read -r -d '' file; do
  checked=$((checked + 1))

  if ! bash -n "$file"; then
    status=1
  fi
done <"$list"

# Printed so a scan that found nothing is visible rather than indistinguishable
# from a scan that found everything and approved of it.
printf 'Checked %d shell script(s) under %s\n' "$checked" "$root"

exit "$status"
