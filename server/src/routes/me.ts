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
  // accountLabel is always "Name <email>" (see providers/asana.ts) — pulled
  // back apart here so the client has the bare address on its own, e.g. to
  // identify the user to analytics without shipping a label-parsing regex
  // to the frontend.
  const asanaEmail = asana?.accountLabel?.match(/<(.+)>/)?.[1] ?? null;
  res.json({
    primaryProvider: user.primaryProvider,
    asanaConnected: !!asana,
    outlookConnected: !!outlook,
    // "Name <email>", as captured at connect time — lets the UI confirm
    // *which* account is signed in (e.g. on the "connect the other
    // provider" screen, so it's clear the first sign-in actually worked).
    asanaAccountLabel: asana?.accountLabel ?? null,
    outlookAccountLabel: outlook?.accountLabel ?? null,
    asanaEmail,
    settings: {
      prefStartTime: settings.prefStartTime,
      prefEndTime: settings.prefEndTime,
      bufferMinutes: settings.bufferMinutes,
      timezone: settings.timezone,
      skipDayFullWarning: settings.skipDayFullWarning,
      confirmDoubleBooking: settings.confirmDoubleBooking,
      hasOnboarded: settings.hasOnboarded,
      upNextCollapsed: settings.upNextCollapsed,
    },
  });
});
