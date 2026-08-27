#!/usr/bin/env bash

set -euo pipefail

for file in "$@"; do
  bash -n "$file"
done
