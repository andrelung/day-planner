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

# Every uncommitted thing being tested right now — shown as a "Currently in
# development:" list (see version.ts) instead of a bare "-dirty" suffix, so
# a tester can tell at a glance what a given build actually contains. A
# single DEV_NOTE env var isn't enough on its own: a testing session
# usually spans several rebuilds for several different fixes before
# anything gets committed, and each rebuild only knows about *its own*
# DEV_NOTE — without accumulating them, every new rebuild's note would
# silently overwrite the previous one on screen, even though the earlier
# uncommitted work is still sitting there right alongside it. Persisted to
# an untracked file (see .gitignore) rather than kept in-memory since each
# invocation of this script is a fresh process; reset back to empty the
# moment the working tree is clean, since a note describing now-committed
# work isn't "in development" anymore. Set the caller's own note with e.g.:
#   DEV_NOTE="Report-a-bug feature" bash scripts/rebuild.sh
NOTES_FILE="$(pwd)/.dev-notes.local.json"
if [ -z "$(git status --porcelain)" ]; then
  rm -f "$NOTES_FILE"
fi
if [ -n "${DEV_NOTE:-}" ]; then
  DEV_NOTE="$DEV_NOTE" NOTES_FILE="$NOTES_FILE" node -e '
    const fs = require("fs");
    const path = process.env.NOTES_FILE;
    const note = process.env.DEV_NOTE;
    let notes = [];
    try { notes = JSON.parse(fs.readFileSync(path, "utf8")); } catch {}
    if (notes[notes.length - 1] !== note) notes.push(note);
    fs.writeFileSync(path, JSON.stringify(notes));
  '
fi
export DEV_NOTES_JSON="$(cat "$NOTES_FILE" 2>/dev/null || echo '[]')"

docker compose up --build -d "$@"
