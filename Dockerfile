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
