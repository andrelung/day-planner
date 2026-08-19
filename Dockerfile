# Day Planner — single image serving the API and the built Svelte app.
# Debian-based (not alpine) throughout so Prisma's prebuilt query-engine
# binary matches the runtime's glibc.

FROM node:22-bookworm-slim AS frontend-build
WORKDIR /src/app
COPY app/package*.json ./
RUN npm ci
COPY app/ ./
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
CMD ["sh", "-c", "npx prisma migrate deploy && node --env-file-if-exists=.env dist/index.js"]
