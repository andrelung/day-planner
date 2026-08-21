import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { env } from './lib/env.js';
import { attachSession } from './lib/auth.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { settingsRouter } from './routes/settings.js';
import { tasksRouter } from './routes/tasks.js';
import { calendarRouter } from './routes/calendar.js';
import { workloadRouter } from './routes/workload.js';
import { pendingActionsRouter } from './routes/pendingActions.js';
import { diagnosticsRouter } from './routes/diagnostics.js';
import { ProviderNotConfiguredError } from './providers/asana.js';
import { ProviderNotConnectedError } from './lib/tokens.js';
import { startPendingActionWorker } from './lib/pendingActionQueue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(cookieParser());
app.use(attachSession);

app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// Every /api/* response is a live read (tasks, calendar, workload, ...) that
// must reflect what actually changed server-side since the last call — none
// of it is meant to be cached at any layer. Without this, an iOS standalone
// PWA in particular is known to serve a GET response straight from
// WKWebView's in-memory cache with no real network round-trip when nothing
// tells it not to, which previously meant e.g. a task deleted in Asana
// while the app was backgrounded (to open the task there) could still show
// its stale Triage card after coming back — refreshTasks()'s GET /api/tasks
// would silently return the same pre-deletion snapshot. Set once here for
// every API route rather than per-route, matching the client's blanket
// `cache: 'no-store'` in api.ts.
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Unauthenticated and cheap on purpose — the client polls this (see
// store.svelte's checkForUpdate) to notice a long-open session is running
// against an older build than what's actually deployed now, and prompt for
// a reload. No auth gate needed since a git commit hash isn't sensitive.
app.get('/api/version', (_req, res) => {
  res.json({ commit: env.GIT_COMMIT, dirty: env.GIT_DIRTY, buildId: env.BUILD_ID });
});

app.use('/auth', authRouter);
app.use('/api/me', meRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/workload', workloadRouter);
app.use('/api/pending-actions', pendingActionsRouter);
app.use('/api/diagnostics', diagnosticsRouter);

// Serve the built Svelte app and fall back to index.html for any
// non-API route (single-page app, no server-side routing needed).
const clientDist = path.join(__dirname, '../public');
app.use(express.static(clientDist));
app.get(/^(?!\/api|\/auth|\/healthz).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ProviderNotConnectedError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof ProviderNotConfiguredError) {
    res.status(503).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

startPendingActionWorker();

app.listen(env.PORT, () => {
  console.log(`day-planner server listening on :${env.PORT}`);
});
