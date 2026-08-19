import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { getOrCreateSettings } from '../lib/settings.js';

export const meRouter = Router();

meRouter.get('/', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    include: { accounts: true },
  });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const settings = await getOrCreateSettings(req.userId!);
  const asana = user.accounts.find((a) => a.provider === 'ASANA');
  const outlook = user.accounts.find((a) => a.provider === 'OUTLOOK');
  res.json({
    primaryProvider: user.primaryProvider,
    asanaConnected: !!asana,
    outlookConnected: !!outlook,
    // "Name <email>", as captured at connect time — lets the UI confirm
    // *which* account is signed in (e.g. on the "connect the other
    // provider" screen, so it's clear the first sign-in actually worked).
    asanaAccountLabel: asana?.accountLabel ?? null,
    outlookAccountLabel: outlook?.accountLabel ?? null,
    settings: {
      prefStartTime: settings.prefStartTime,
      prefEndTime: settings.prefEndTime,
      bufferMinutes: settings.bufferMinutes,
      timezone: settings.timezone,
    },
  });
});
