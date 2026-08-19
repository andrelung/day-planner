import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { getOrCreateSettings } from '../lib/settings.js';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const patchSchema = z.object({
  prefStartTime: z.string().regex(timeRe).optional(),
  prefEndTime: z.string().regex(timeRe).optional(),
  bufferMinutes: z.number().int().min(0).max(240).optional(),
  timezone: z.string().min(1).refine(isValidTimezone, { message: 'not a valid IANA timezone name' }).optional(),
});

settingsRouter.get('/', async (req, res) => {
  const settings = await getOrCreateSettings(req.userId!);
  res.json(settings);
});

settingsRouter.put('/', async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const settings = await prisma.settings.upsert({
    where: { userId: req.userId! },
    create: { userId: req.userId!, ...parsed.data },
    update: parsed.data,
  });
  res.json(settings);
});
