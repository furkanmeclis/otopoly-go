#!/usr/bin/env bash
# Refreshes scripts/contract/openapi.yaml (the contract test's spec fixture) from the monorepo backend.
# Usage: scripts/contract/refresh-spec.sh [path-to-repo-root]   (default: the repo root above mobile/)
#
# Normally a plain copy of backend/docs/openapi.yaml. While a backend branch is not merged yet, its spec can be
# folded in with a structural 3-way merge (merge-spec.mjs):
#   THEIRS=/path/to/branch/backend/docs/openapi.yaml BASE_REF=<commit the branch forked from> scripts/contract/refresh-spec.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
GO=${1:-$ROOT/..}
SPEC="$GO/backend/docs/openapi.yaml"
OUT="$HERE/openapi.yaml"
[ -f "$SPEC" ] || { echo "no spec at $SPEC" >&2; exit 1; }
sha=$(git -C "$GO" rev-parse --short HEAD 2>/dev/null || echo unknown)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
{
  echo "# OpenAPI fixture for the mobile contract test (npm run test:contract). DO NOT EDIT BY HAND."
  echo "# Source: otopoly-go backend/docs/openapi.yaml @ $sha (scripts/contract/refresh-spec.sh)."
} >"$TMP/header"
if [ -n "${THEIRS:-}" ]; then
  : "${BASE_REF:?BASE_REF (commit the merged branch forked from) is required with THEIRS}"
  git -C "$GO" show "$BASE_REF:backend/docs/openapi.yaml" >"$TMP/base.yaml"
  STRICT_MERGE=1 node "$HERE/merge-spec.mjs" "$SPEC" "$TMP/base.yaml" "$THEIRS" >"$TMP/spec.yaml"
  echo "# Merged with $THEIRS (base $BASE_REF) until that branch lands." >>"$TMP/header"
else
  cp "$SPEC" "$TMP/spec.yaml"
fi
cat "$TMP/header" "$TMP/spec.yaml" >"$OUT"
echo "wrote $OUT"
