import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { logAnomaly } from '../lib/anomalyLog.js';

export const diagnosticsRouter = Router();
diagnosticsRouter.use(requireAuth);

const anomalySchema = z.object({
  area: z.string().min(1),
  message: z.string().min(1),
  context: z.record(z.string(), z.unknown()).optional(),
});

/// Fire-and-forget: the client posts here whenever one of its own
/// defensive guards fires — a branch that's only ever meant to run if some
/// assumption elsewhere didn't hold (see store.svelte.ts's logAnomaly and
/// anomalyLog.ts's own comment for the bug this was built to have caught
/// early). Always 204s, even on a malformed body — a broken diagnostic
/// call is never worth surfacing to the user.
diagnosticsRouter.post('/anomaly', (req, res) => {
  const parsed = anomalySchema.safeParse(req.body);
  if (parsed.success) {
    logAnomaly({ area: parsed.data.area, message: parsed.data.message, context: parsed.data.context, userId: req.userId });
  }
  res.status(204).end();
});
