import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';

export const meRouter = Router();

meRouter.get('/', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    include: { accounts: true, settings: true },
  });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const asana = user.accounts.find((a) => a.provider === 'ASANA');
  const outlook = user.accounts.find((a) => a.provider === 'OUTLOOK');
  res.json({
    primaryProvider: user.primaryProvider,
    asanaConnected: !!asana,
    outlookConnected: !!outlook,
    settings: {
      prefStartTime: user.settings?.prefStartTime ?? '09:00',
      prefEndTime: user.settings?.prefEndTime ?? '18:00',
      bufferMinutes: user.settings?.bufferMinutes ?? 10,
    },
  });
});
