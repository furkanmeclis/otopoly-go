#!/usr/bin/env bash
# Build the production images on this machine and load them on the server.
#
# The server never builds (see compose.prod.yml). This script:
#   1. builds otopoly-backend and otopoly-frontend for linux/amd64,
#   2. tags the images currently on the server as :previous (rollback),
#   3. streams the new images over SSH (docker save | ssh docker load).
# It does not deploy: press Deploy in Dokploy afterwards.
#
# Usage: scripts/ship-images.sh [--build-only]
# Env:   OTOPOLY_SSH_HOST (default technowide-spaceship)
#        SITE_URL         (default https://otopoly.app, baked into the frontend)
#        BACKEND_IMAGE / FRONTEND_IMAGE (default otopoly-backend:prod / otopoly-frontend:prod)
#        ALLOW_DIRTY=1    ship uncommitted changes anyway
#
# Rollback on the server:
#   docker tag otopoly-backend:previous otopoly-backend:prod
#   docker tag otopoly-frontend:previous otopoly-frontend:prod
#   then Deploy in Dokploy.
set -euo pipefail

SSH_HOST="${OTOPOLY_SSH_HOST:-technowide-spaceship}"
SITE_URL="${SITE_URL:-https://otopoly.app}"
BACKEND_IMAGE="${BACKEND_IMAGE:-otopoly-backend:prod}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-otopoly-frontend:prod}"
PLATFORM="linux/amd64"
BUILD_ONLY=0
[[ "${1:-}" == "--build-only" ]] && BUILD_ONLY=1

cd "$(git rev-parse --show-toplevel)"

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

docker info >/dev/null 2>&1 || fail "Docker is not running. Start Docker Desktop first."

if [[ -n "$(git status --porcelain --untracked-files=no)" && "${ALLOW_DIRTY:-0}" != "1" ]]; then
  fail "Uncommitted changes. Commit them, or set ALLOW_DIRTY=1 to ship them anyway."
fi
SHA="$(git rev-parse --short HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" == "main" ]] || printf '\033[33mNote: shipping branch %s, not main.\033[0m\n' "$BRANCH"

if [[ "$BUILD_ONLY" == "0" ]]; then
  ssh -o ConnectTimeout=15 -o BatchMode=yes "$SSH_HOST" true || fail "Cannot reach $SSH_HOST over SSH."
fi

backend_repo="${BACKEND_IMAGE%%:*}"
frontend_repo="${FRONTEND_IMAGE%%:*}"

step "Building $BACKEND_IMAGE ($SHA, $PLATFORM)"
docker buildx build --platform "$PLATFORM" --load \
  -t "$BACKEND_IMAGE" -t "$backend_repo:$SHA" \
  ./backend

step "Building $FRONTEND_IMAGE ($SHA, $PLATFORM, SITE_URL=$SITE_URL)"
docker buildx build --platform "$PLATFORM" --load \
  --build-arg SITE_URL="$SITE_URL" \
  -t "$FRONTEND_IMAGE" -t "$frontend_repo:$SHA" \
  -f frontend/Dockerfile .

if [[ "$BUILD_ONLY" == "1" ]]; then
  step "Built (not shipped)"
  docker images --format '{{.Repository}}:{{.Tag}}  {{.Size}}' | grep -E "^($backend_repo|$frontend_repo):($SHA|${BACKEND_IMAGE#*:})" || true
  exit 0
fi

step "Keeping the server's current images as :previous"
ssh "$SSH_HOST" "for i in $BACKEND_IMAGE $FRONTEND_IMAGE; do
  docker image inspect \"\$i\" >/dev/null 2>&1 && docker tag \"\$i\" \"\${i%%:*}:previous\" && echo \"  \$i -> \${i%%:*}:previous\"; done; true"

step "Sending images to $SSH_HOST"
docker save "$BACKEND_IMAGE" "$backend_repo:$SHA" "$FRONTEND_IMAGE" "$frontend_repo:$SHA" \
  | gzip -1 \
  | ssh "$SSH_HOST" 'gunzip | docker load'

step "Server now has"
ssh "$SSH_HOST" "docker images --format '{{.Repository}}:{{.Tag}}  {{.ID}}  {{.CreatedSince}}' | grep -E '^($backend_repo|$frontend_repo):'"

cat <<EOF

Images for $SHA are on the server. Nothing was restarted.
Next: Dokploy -> otopoly -> Deploy (it only restarts containers, no build).
Rollback: on the server tag :previous back to :prod, then Deploy.
EOF
