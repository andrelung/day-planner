import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { getValidAccessToken } from '../lib/tokens.js';
import { buildWorkloadDays, dailyCapacityHours } from '../lib/workload.js';
import { getOrCreateSettings } from '../lib/settings.js';
import { listIncompleteAssignedTasks } from '../providers/asana.js';
import { listEvents } from '../providers/outlook.js';

export const workloadRouter = Router();
workloadRouter.use(requireAuth);

workloadRouter.get('/', async (req, res) => {
  const now = new Date();
  const days = buildWorkloadDays(now);
  const settings = await getOrCreateSettings(req.userId!);
  const capacityPerDay = dailyCapacityHours(settings.prefStartTime, settings.prefEndTime);

  const [asanaAccount, outlookAccount] = await Promise.all([
    prisma.oAuthAccount.findUnique({ where: { userId_provider: { userId: req.userId!, provider: 'ASANA' } } }),
    prisma.oAuthAccount.findUnique({ where: { userId_provider: { userId: req.userId!, provider: 'OUTLOOK' } } }),
  ]);

  const items: { start: Date; hours: number }[] = [];

  if (asanaAccount) {
    const accessToken = await getValidAccessToken(req.userId!, 'ASANA');
    const tasks = await listIncompleteAssignedTasks(accessToken);
    for (const t of tasks) {
      if (t.dueAt) items.push({ start: new Date(t.dueAt), hours: t.hours });
    }
  }
  if (outlookAccount) {
    const accessToken = await getValidAccessToken(req.userId!, 'OUTLOOK');
    const horizonEnd = new Date(now.getTime() + 21 * 86_400_000);
    const events = await listEvents(accessToken, now, horizonEnd);
    for (const e of events) {
      items.push({ start: e.start, hours: (e.end.getTime() - e.start.getTime()) / 3_600_000 });
    }
  }

  const result = days.map((d) => {
    const capacity = d.key === 'nextweek' ? capacityPerDay * 5 : capacityPerDay;
    let planned = 0;
    if (d.date) {
      const dayEnd = new Date(d.date.getTime() + 86_400_000);
      planned = items.filter((i) => i.start >= d.date! && i.start < dayEnd).reduce((sum, i) => sum + i.hours, 0);
    } else if (d.rangeStart && d.rangeEnd) {
      planned = items.filter((i) => i.start >= d.rangeStart! && i.start < d.rangeEnd!).reduce((sum, i) => sum + i.hours, 0);
    }
    return {
      key: d.key,
      label: d.label,
      date: d.date ? d.date.toISOString().slice(0, 10) : null,
      rangeStart: d.rangeStart ? d.rangeStart.toISOString() : null,
      rangeEnd: d.rangeEnd ? d.rangeEnd.toISOString() : null,
      planned: Math.round(planned * 10) / 10,
      capacity: Math.round(capacity * 10) / 10,
    };
  });

  res.json({ days: result });
});
