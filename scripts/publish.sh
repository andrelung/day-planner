#!/usr/bin/env bash
# Builds the production image and pushes it to GitHub Container Registry —
# the update mechanism for any deployment using deploy/docker-compose.prod.yml
# (which only ever pulls ghcr.io/andrelung/day-planner:latest, no source tree,
# no build step). Same approach as asana-sales-autostatus.
#
# Requires a one-time `docker login ghcr.io` with a GitHub PAT that has
# `write:packages` scope — not something this script does for you.
#
# --platform linux/amd64 matters here — a plain `docker build`/`docker
# compose build` targets whatever architecture it's running on, which
# silently produces an arm64-only image on Apple Silicon dev machines and
# fails to pull on a typical amd64 Linux server ("no matching manifest for
# linux/amd64"). Add ,linux/arm64 to the platform list below if the image
# should also run natively on Apple Silicon hosts.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

IMAGE="ghcr.io/andrelung/day-planner:latest"

GIT_COMMIT="$(git rev-parse --short HEAD)"
if [ -z "$(git status --porcelain)" ]; then
  GIT_DIRTY=""
else
  GIT_DIRTY="1"
  echo "Warning: working tree has uncommitted changes — this image will be built from them (commit label will show as dirty)." >&2
fi
BUILD_ID="$(date +%s)-$RANDOM"

docker buildx build \
  --platform linux/amd64 \
  --build-arg GIT_COMMIT="$GIT_COMMIT" \
  --build-arg GIT_DIRTY="$GIT_DIRTY" \
  --build-arg BUILD_ID="$BUILD_ID" \
  -t "$IMAGE" \
  --push \
  .

echo "Pushed $IMAGE (commit $GIT_COMMIT${GIT_DIRTY:+-dirty})"
