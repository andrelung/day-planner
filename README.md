# Day Planner

A mobile-web app that helps people at a creative agency pre-plan their upcoming days: triage overdue/unplanned Asana tasks one at a time, decide when to realistically do them, see how full each day already is, and reconcile unlinked Outlook calendar events with Asana tasks. It sits alongside Asana and Outlook — it doesn't replace either, and all planning writes back to Asana as the source of truth.

The original Claude Design handoff — product briefing, screen-by-screen spec, and the interactive prototype it was built from — lives in [`design_handoff_day_planner/`](./design_handoff_day_planner). This app implements that spec, plus real sign-in (Login / Connect-secondary-provider screens and a "Primary" account tag in Integrations) that the linked prototype snapshot predates but the briefing's OAuth requirements call for.

## Layout

- **`app/`** — the frontend: Svelte 5 + TypeScript + Vite, no backend framework knowledge required to read.
- **`server/`** — the backend: Express + TypeScript + Prisma/Postgres. Handles Asana and Microsoft (Outlook/Graph) OAuth, encrypted token storage, and proxies the Asana/Graph APIs so the browser never sees a raw access token.
- **`design_handoff_day_planner/`** — the original design bundle (spec + prototype) this was built from.
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

## Testing on an iPhone (or any phone)

This is a mobile-web app, so at some point you want it on an actual phone instead of a resized browser window. Two options depending on what you need to check:

### Quick UI check over your home WiFi (no extra tooling)

Both dev servers already bind every network interface, not just `localhost` — `npm run dev` in `app/` is enough. Find your Mac's LAN IP (**System Settings → Wi-Fi → Details**, or `ipconfig getifaddr en0` in a terminal) and open `http://<that-ip>:5173` in Safari on the iPhone, as long as it's on the same WiFi network.

This is enough for layout/interaction work, but **real Asana/Microsoft sign-in won't work over plain HTTP** — Asana's OAuth (and most Microsoft Entra configurations) reject non-HTTPS redirect URIs other than `localhost`. For that you need a real HTTPS URL — see below.

### Full test including real sign-in, via ngrok

[ngrok](https://ngrok.com) tunnels a local port to a public HTTPS URL, which also satisfies the OAuth redirect-URI requirement.

1. Install it if you don't have it: `brew install ngrok`.
2. Sign up (free) at https://dashboard.ngrok.com/signup, then authenticate the CLI once: `ngrok config add-authtoken <your-token>` (from https://dashboard.ngrok.com/get-started/your-authtoken).
3. With both dev servers running (`npm run dev` in `server/` and in `app/`), tunnel the **frontend** port only — Vite's dev proxy already forwards `/api` and `/auth` to the local backend, so the phone never needs to reach port 3000 directly:
   ```
   ngrok http 5173
   ```
4. ngrok prints a `https://<random>.ngrok-free.app` URL. Open that on the iPhone.
5. To also test real sign-in through the tunnel, point the backend at that URL and register it as the OAuth redirect URI:
   - Set `PUBLIC_APP_URL=https://<random>.ngrok-free.app` in `server/.env` and restart `npm run dev` in `server/`.
   - Add `https://<random>.ngrok-free.app/auth/asana/callback` and `https://<random>.ngrok-free.app/auth/outlook/callback` as redirect URIs in the Asana app and Azure app registration respectively (see "Registering the OAuth apps" below) — in addition to your `localhost` ones, not instead of.

ngrok's free tier gives you a new random subdomain every time you restart the tunnel, which means re-adding the redirect URIs each time. If you're doing this often, either use a paid ngrok static domain, or [claim ngrok's one free static domain](https://dashboard.ngrok.com/domains) and tunnel with `ngrok http --url=your-name.ngrok-free.app 5173` instead — then the redirect URIs only need registering once.

`vite.config.ts` sets `allowedHosts: true` so Vite accepts requests carrying an ngrok (or LAN-IP) `Host` header instead of 403ing them — that's dev-only (`vite build`/production is unaffected) and fine for a local dev server with no real data behind it directly.

### If "Continue with Asana" opens the Asana app instead of signing in (iOS)

If the Asana app is installed on the iPhone, tapping the sign-in link can hand off to the native app instead of showing Asana's login page in the browser, and the app shows a generic "couldn't load content" toast (it doesn't know what to do with an OAuth authorize URL). This is iOS [Universal Links](https://developer.apple.com/ios/universal-links/) — Asana's app registers `app.asana.com` as one of its own links, so iOS intercepts the navigation before it ever reaches Safari — and it's a [known, currently-unresolved issue on Asana's own side](https://forum.asana.com/t/oauth-authorization-problems-for-native-app-or-mobile-web/496427), not something this app's code can force iOS not to do.

The login/connect buttons are real `<a href>` links (not JavaScript-triggered navigation) specifically so you have a manual escape hatch: **long-press "Continue with Asana"** and choose **Open in New Tab** (or **Open in Safari**, wording varies by iOS version) from the menu that appears, instead of tapping it normally. That routes around the app handoff. The quickest way to avoid it entirely while testing is to just not have the Asana app installed on the test device.

## Install as an app (iOS / Android)

Day Planner ships a web app manifest and icons (`app/public/manifest.webmanifest`, `apple-touch-icon.png`, `pwa-192.png`/`pwa-512.png`), so once you have it open in a mobile browser — over `http://localhost:3000` in the simulator, a LAN IP, or an ngrok URL (see above) — you can add it to the home screen and it opens full-screen, without Safari/Chrome's address bar.

**iOS (Safari):**
1. Open the app's URL in **Safari** specifically — the "Add to Home Screen" option isn't in Chrome or Firefox on iOS.
2. Tap the **Share** icon (square with an arrow pointing up) in the toolbar.
3. Scroll down and tap **Add to Home Screen**.
4. Confirm the name ("Day Planner") and tap **Add**.

**Android (Chrome):**
1. Open the app's URL in **Chrome**.
2. Tap the **⋮** menu in the top-right.
3. Tap **Add to Home screen** (or **Install app**, if Chrome already recognized it as installable) → **Install** / **Add**.

Either way you get a real navy-and-yellow app icon and a standalone window — no browser chrome, just like a native app. Note this only affects how the page is *presented*; it's still the same web app hitting the same backend, not an offline-capable PWA (no service worker/caching is set up, so it still needs network access to `/api` each time, same as the browser tab).

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
3. Under the app's **OAuth** settings, enable these scopes — newer Asana apps must explicitly request scopes instead of getting blanket "default" access, and sign-in fails with a `forbidden_scopes` error if the app isn't granted a scope the server requests: `openid`, `email`, `profile`, `tasks:read`, `tasks:write`, `projects:read`, `users:read`, `workspaces:read`. (The exact same list is requested from `server/src/providers/asana.ts` — if you ever add a feature that needs another Asana resource, add the scope in both places.)
4. Copy the **Client ID** and **Client secret** into `.env` as `ASANA_CLIENT_ID` / `ASANA_CLIENT_SECRET`.

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
