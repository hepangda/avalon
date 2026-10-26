#!/usr/bin/env bash
# Run in a full checkout with origin/main fetched. Output only the pinned SHA.
set -euo pipefail
target=${1:?commit SHA or main}
if [[ $target == main ]]; then
  ref=refs/remotes/origin/main
elif [[ $target =~ ^[0-9a-fA-F]{7,40}$ ]]; then
  ref=$target
else
  echo 'Expected main or a 7-40 character commit SHA' >&2
  exit 1
fi
commit=$(git rev-parse --verify "$ref^{commit}")
if ! git merge-base --is-ancestor "$commit" refs/remotes/origin/main; then
  echo "$commit does not belong to main" >&2
  exit 1
fi
printf '%s\n' "$commit"
