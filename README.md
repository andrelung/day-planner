# Day Planner

A mobile-web app that helps people at a creative agency pre-plan their upcoming days: triage overdue/unplanned Asana tasks one at a time, decide when to realistically do them, see how full each day already is, and reconcile unlinked Outlook calendar events with Asana tasks. It sits alongside Asana and Outlook — it doesn't replace either, and all planning writes back to Asana as the source of truth.

## Layout

- **`app/`** — the frontend: Svelte 5 + TypeScript + Vite, no backend framework knowledge required to read.
- **`server/`** — the backend: Express + TypeScript + Prisma/Postgres. Handles Asana and Microsoft (Outlook/Graph) OAuth, encrypted token storage, and proxies the Asana/Graph APIs so the browser never sees a raw access token.
- **`Dockerfile`** / **`docker-compose.yml`** — builds both into one image (the server serves the built frontend's static files) plus a Postgres container.

## Running locally without Docker

```
# once
createdb dayplanner   # or point DATABASE_URL at any Postgres you have
cp server/.env.example server/.env
# fill in TOKEN_ENCRYPTION_KEY and SESSION_JWT_SECRET (openssl rand -base64 32 for each)

cd server && npm install && npx prisma migrate deploy && npm run dev   # :3000
cd app && npm install && npm run dev                                   # :5173, proxies /api and /auth to :3000
```

Open http://localhost:5173. Without Asana/Microsoft OAuth credentials set (see below), you'll see the Login screen but signing in will fail with a clear "not configured" message — that's expected until you register the OAuth apps.

## Running with Docker Compose

```
cp .env.example .env
# fill in POSTGRES_PASSWORD, TOKEN_ENCRYPTION_KEY, SESSION_JWT_SECRET (openssl rand -base64 32 for the latter two)
docker compose up --build
```

Open http://localhost:3000.

## Registering the OAuth apps

Real sign-in requires two OAuth apps you register yourself — these are credentials tied to your organization's Asana/Microsoft tenant, so they can't be created for you.

### Asana

1. Go to https://app.asana.com/0/developer-console → **+ New App**.
2. Redirect URL: `{PUBLIC_APP_URL}/auth/asana/callback` (e.g. `http://localhost:3000/auth/asana/callback`, or your real domain in production).
3. Copy the **Client ID** and **Client secret** into `.env` as `ASANA_CLIENT_ID` / `ASANA_CLIENT_SECRET`.

No custom field setup needed for the time estimate — see "Hours estimate" below.

### Microsoft (Outlook / Microsoft Graph)

1. Go to https://entra.microsoft.com → **App registrations** → **New registration**.
2. Redirect URI (platform: Web): `{PUBLIC_APP_URL}/auth/outlook/callback`.
3. Under **Certificates & secrets**, create a client secret.
4. Under **API permissions**, add delegated Microsoft Graph permissions: `User.Read`, `Calendars.Read`, `offline_access` (grant admin consent if your tenant requires it).
5. Copy the **Application (client) ID**, the client secret, and the **Directory (tenant) ID** into `.env` as `MS_CLIENT_ID` / `MS_CLIENT_SECRET` / `MS_TENANT_ID` (use `common` instead of a specific tenant ID if you want any Microsoft account, not just your org's, to be able to sign in).

Restart the app after editing `.env`. The server intentionally still starts up without these set — it fails only the specific `/auth/:provider/start` request, with a message pointing back here — so the rest of the stack (Postgres, static assets, health check) is easy to verify independently.

## Known simplifications

- **Timezone**: the app assumes the browser's local time and the server's local time agree — there's no per-user timezone preference yet. Fine for a single-office team in one timezone; worth adding a `Settings.timezone` field before rolling out across regions.
- **Capacity**: a day's capacity is derived from the employee's preferred start/end time (Settings), not from historical throughput — the original briefing calls the latter out as the more realistic long-term source.
- **Hours estimate**: since Asana has no native duration field, the estimate is read from and written to a `[4]`-style bracket at the end of the task title (e.g. "Draft outline [4]"), the same convention used by the team's `asana-to-mongo-replicator` — so titles stay readable by both tools. Supports a decimal comma (`[1,5]`), a trailing `/`-divided value (`[1/6]` → 6), and the `∑` summary-total prefix on read; only ever writes the plain `[N]` form. The task name shown in the UI has the bracket stripped.
