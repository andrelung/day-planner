import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { processQueue } from '../lib/pendingActionQueue.js';

export const pendingActionsRouter = Router();
pendingActionsRouter.use(requireAuth);

/// Settings' "Pending & failed actions" lookup — everything still being
/// retried (PENDING, possibly after one or more failed attempts already)
/// or that's given up after MAX_ATTEMPTS (FAILED). Completed actions aren't
/// worth surfacing once they've succeeded.
pendingActionsRouter.get('/', async (req, res) => {
  const rows = await prisma.pendingAction.findMany({
    where: { userId: req.userId!, status: { in: ['PENDING', 'FAILED'] } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    actions: rows.map((r) => ({
      id: r.id,
      label: r.label,
      status: r.status === 'PENDING' ? 'pending' : 'failed',
      attempts: r.attempts,
      lastError: r.lastError,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

/// Requeues a FAILED action — resets it back to PENDING, eligible
/// immediately, with a clean attempt counter (a manual retry shouldn't
/// count against the automatic-retry budget that already ran out).
pendingActionsRouter.post('/:id/retry', async (req, res) => {
  const row = await prisma.pendingAction.findUnique({ where: { id: req.params.id } });
  if (!row || row.userId !== req.userId || row.status !== 'FAILED') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await prisma.pendingAction.update({ where: { id: row.id }, data: { status: 'PENDING', attempts: 0, lastError: null, nextAttemptAt: new Date() } });
  void processQueue();
  res.status(204).end();
});

/// Dismisses a FAILED action permanently — the user has decided it's not
/// worth retrying (e.g. they made the same change directly in Asana).
pendingActionsRouter.delete('/:id', async (req, res) => {
  const row = await prisma.pendingAction.findUnique({ where: { id: req.params.id } });
  if (!row || row.userId !== req.userId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await prisma.pendingAction.delete({ where: { id: row.id } });
  res.status(204).end();
});
