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
import { ProviderNotConfiguredError } from './providers/asana.js';
import { ProviderNotConnectedError } from './lib/tokens.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(cookieParser());
app.use(attachSession);

app.get('/healthz', (_req, res) => res.status(200).send('ok'));

app.use('/auth', authRouter);
app.use('/api/me', meRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/workload', workloadRouter);

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

app.listen(env.PORT, () => {
  console.log(`day-planner server listening on :${env.PORT}`);
});
