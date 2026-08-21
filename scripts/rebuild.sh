#!/usr/bin/env bash
# Rebuilds and restarts the Docker stack with the current git commit/dirty
# state baked into the app's version label (Settings + the loading screen —
# see app/src/lib/version.ts), plus a fresh BUILD_ID every single run. Plain
# `docker compose up --build` still works without this, it just falls back
# to "dev" with no dirty flag and no update-notice capability at all.
#
# BUILD_ID (not GIT_COMMIT) is what the update-notice actually compares —
# GIT_COMMIT only changes on a real `git commit`, so a long stretch of
# uncommitted rebuilds (the normal case while iterating on a feature) all
# share the exact same commit hash and the update-check had nothing to
# ever notice changed, even though the running JS was rebuilt many times
# over. BUILD_ID is unique on every invocation of this script regardless of
# git state, so reopening the app always offers a reload if it's running
# anything other than literally the most recent build.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

export GIT_COMMIT="$(git rev-parse --short HEAD)"
if [ -z "$(git status --porcelain)" ]; then
  export GIT_DIRTY=""
else
  export GIT_DIRTY="1"
fi
export BUILD_ID="$(date +%s)-$RANDOM"

docker compose up --build -d "$@"
