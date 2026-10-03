#!/usr/bin/env bash
# Rebuilds scripts/contract/openapi.yaml from the otopoly-go repo (3-way merge of two unmerged backend branches).
# Usage: scripts/contract/refresh-spec.sh [path-to-otopoly-go]   (default ~/Documents/Projects/otopoly-go)
# The merge is structural (merge-spec.mjs, on the parsed YAML): a line-based merge-file spliced a block into
# the wrong mapping without reporting a conflict.
set -euo pipefail
GO=${1:-$HOME/Documents/Projects/otopoly-go}
OURS=${OURS:-origin/feat/openapi-gaps}           # main + auth + QR + identities + spec fixes (response schemas, statuses)
THEIRS=${THEIRS:-origin/feat/expo-push-limits}   # push-devices, billing usage, LIMIT_REACHED
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/openapi.yaml"
TMP=$(mktemp -d)
git -C "$GO" fetch -q origin
ours_sha=$(git -C "$GO" rev-parse "$OURS")
theirs_sha=$(git -C "$GO" rev-parse "$THEIRS")
base_sha=$(git -C "$GO" merge-base "$ours_sha" "$theirs_sha")
git -C "$GO" show "$ours_sha:backend/docs/openapi.yaml" >"$TMP/ours.yaml"
git -C "$GO" show "$base_sha:backend/docs/openapi.yaml" >"$TMP/base.yaml"
git -C "$GO" show "$theirs_sha:backend/docs/openapi.yaml" >"$TMP/theirs.yaml"
STRICT_MERGE=1 node "$HERE/merge-spec.mjs" "$TMP/ours.yaml" "$TMP/base.yaml" "$TMP/theirs.yaml" >"$TMP/combined.yaml"
{
  echo "# Combined OpenAPI fixture for the mobile contract test (npm run test:contract). DO NOT EDIT BY HAND."
  echo "# Source repo: otopoly-go backend/docs/openapi.yaml, structural 3-way merge (scripts/contract/refresh-spec.sh):"
  echo "#   ours   $OURS $ours_sha"
  echo "#   base   merge-base $base_sha"
  echo "#   theirs $THEIRS $theirs_sha"
  cat "$TMP/combined.yaml"
} >"$OUT"
rm -rf "$TMP"
echo "wrote $OUT"
