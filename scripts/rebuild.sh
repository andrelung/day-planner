#!/usr/bin/env bash
# Rebuilds and restarts the Docker stack with the current git commit/dirty
# state baked into the app's version label (Settings + the loading screen —
# see app/src/lib/version.ts). Plain `docker compose up --build` still
# works without this, it just falls back to "dev" with no dirty flag.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

export GIT_COMMIT="$(git rev-parse --short HEAD)"
if [ -z "$(git status --porcelain)" ]; then
  export GIT_DIRTY=""
else
  export GIT_DIRTY="1"
fi

docker compose up --build -d "$@"
