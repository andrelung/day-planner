# Day Planner — single image serving the API and the built Svelte app.
# Debian-based (not alpine) throughout so Prisma's prebuilt query-engine
# binary matches the runtime's glibc.

FROM node:22-bookworm-slim AS frontend-build
WORKDIR /src/app
COPY app/package*.json ./
RUN npm ci
COPY app/ ./
# .git is excluded from the build context (see .dockerignore) — the commit
# hash/dirty flag has to come in from the host as build args instead (see
# docker-compose.yml's build.args, sourced from the host's actual git
# state). Vite auto-exposes any VITE_-prefixed env var as import.meta.env.*
# (see app/src/lib/version.ts), no extra config needed.
ARG GIT_COMMIT=dev
ARG GIT_DIRTY=""
# Unique per build regardless of git state (see rebuild.sh) — the actual
# key the update-notice compares, since GIT_COMMIT alone can't tell two
# uncommitted rebuilds apart.
ARG BUILD_ID=dev
# Accumulated "what's uncommitted right now" notes, as a JSON array string —
# see rebuild.sh and version.ts. Purely a display concern, so this is
# frontend-only; no runtime/server equivalent needed.
ARG DEV_NOTES_JSON="[]"
ENV VITE_GIT_COMMIT=$GIT_COMMIT
ENV VITE_GIT_DIRTY=$GIT_DIRTY
ENV VITE_BUILD_ID=$BUILD_ID
ENV VITE_DEV_NOTES_JSON=$DEV_NOTES_JSON
RUN npm run build

FROM node:22-bookworm-slim AS server-build
WORKDIR /src/server
# bookworm-slim strips the openssl package; without it Prisma can't detect
# the installed libssl version and silently falls back to a guess that may
# not match, which can select the wrong query-engine binary at `generate`.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npx prisma generate
RUN npm run build
# tsc only compiles the generated client's .ts sources — the native query
# engine binary needs to be copied alongside them by hand.
RUN cp src/generated/prisma/*.so.node dist/generated/prisma/

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Same host-provided build args as the frontend stage (see its comment) —
# served back out via GET /api/version so a long-lived open client can
# notice it's running against a stale build. Re-declared here since a Docker
# ARG only stays in scope for the stage that declares it.
ARG GIT_COMMIT=dev
ARG GIT_DIRTY=""
ARG BUILD_ID=dev
ENV GIT_COMMIT=$GIT_COMMIT
ENV GIT_DIRTY=$GIT_DIRTY
ENV BUILD_ID=$BUILD_ID
# Same reason as the server-build stage — needed here too since this is
# where `prisma migrate deploy` and the running server actually load the
# query engine.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./
# Keeps devDependencies (prisma CLI is one) — `prisma migrate deploy` runs
# from this same image at startup; simplicity over image size for a small
# internal tool.
RUN npm ci

COPY --from=server-build /src/server/dist ./dist
COPY server/prisma ./prisma
COPY --from=frontend-build /src/app/dist ./public

EXPOSE 3000
# No --env-file-if-exists here (unlike the local `npm start`/`npm run dev`
# scripts) — docker-compose's `environment:` block already injects every
# var directly into the container's process.env, so there's no .env file to
# load at /app/.env; Node prints a harmless-but-confusing "not found" notice
# if the flag is passed anyway.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
