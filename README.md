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

## Testing

Unit tests cover the pure business logic — the pieces most likely to silently regress: the `[4]`-in-title duration convention, doubled-task/queue-ordering, free-slot computation, workload day-bucketing, and token encryption. They don't need a database, Docker, or real OAuth credentials.

```
cd server && npm install && npm test   # node's built-in test runner, via tsx
cd app && npm install && npm test      # vitest
```

Both are also wired into `npm run check` territory — run that too (`npm run check` in each of `app/` and `server/`) for type-checking, since these are TypeScript projects with no separate lint step.

There's no end-to-end/integration test suite (one would need a mocked or sandbox Asana/Microsoft Graph account) — see "Manually testing the full app" below for that.

## Manually testing the full app

Since real sign-in needs live Asana + Microsoft accounts, the meaningful end-to-end test is manual. Rough order:

1. **Get the stack running** — either `docker compose up --build` (see above) or the two `npm run dev` processes. Confirm `curl http://localhost:3000/healthz` (or `:5173` in dev) returns `ok`.
2. **Register the OAuth apps** (see below) against a *test* Asana workspace and a *test* Microsoft/Outlook account if you have one — not your production tenant, since the app will write real due dates and rename real tasks.
3. **Sign in.** Land on Login → pick a provider → you should get redirected to that provider's real consent screen → back to either "Connect the other provider" (fresh account) or straight to Triage (returning account, matched by `OAuthAccount.externalAccountId`).
4. **Triage loop.** Confirm your Asana tasks assigned-to-you show up, sorted with overdue first and unplanned/doubled last. Edit an hour estimate on a task and check in Asana that its title now ends in `[N]`. Swipe (or tap the buttons) to send a task to "Plan today" / "Plan later" and confirm its Asana due date actually changed.
5. **Conflict paths.** Plan two different tasks into the exact same slot on the same day — the second one should hit the Slot Conflict screen; try both "Choose another time" and "Double-book anyway".
6. **Day full.** Set a day's Settings hours very low (or plan enough tasks into it) so `planned >= capacity`, then try planning into it — should hit the Day Full interrupt.
7. **Split into a part.** Split a task, confirm a real Asana subtask gets created with its own `[N]` bracket and a due time, and that the parent's remaining estimate drops accordingly.
8. **Overview.** Confirm the workload bars roughly match what's actually on your Asana due dates + Outlook calendar for the next few days, and that an unlinked Outlook event can be turned into a task or linked to an existing one.
9. **Settings.** Change preferred start/end time or the buffer, and confirm free-slot suggestions elsewhere shift accordingly.

If you don't want to risk a real Asana workspace at all, `docker compose up` plus `/healthz` plus the unit tests above are the safe subset to check after any change — they'll catch most regressions in the logic without touching live data.

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
