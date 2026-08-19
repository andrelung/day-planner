import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { getValidAccessToken } from '../lib/tokens.js';
import { computeFreeSlots } from '../lib/freeSlots.js';
import { getOrCreateSettings } from '../lib/settings.js';
import { listEvents } from '../providers/outlook.js';
import { createSubtask, createTaskInProject, listIncompleteAssignedTasks } from '../providers/asana.js';

export const calendarRouter = Router();
calendarRouter.use(requireAuth);

function relativeDayLabel(date: Date, now: Date): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

function timeLabel(date: Date, now: Date): string {
  const hhmm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${relativeDayLabel(date, now)} · ${hhmm}`;
}

// GET /api/calendar/events — unlinked (and linked, for display) Outlook
// events over the next 7 days, for the Overview screen.
calendarRouter.get('/events', async (req, res) => {
  const accessToken = await getValidAccessToken(req.userId!, 'OUTLOOK');
  const now = new Date();
  const to = new Date(now.getTime() + 7 * 86_400_000);
  const events = await listEvents(accessToken, now, to);

  const links = await prisma.calendarEventLink.findMany({ where: { userId: req.userId! } });
  const linkByExternalId = new Map(links.map((l) => [l.externalEventId, l]));

  res.json({
    events: events.map((e) => {
      const link = linkByExternalId.get(e.id);
      return {
        id: e.id,
        title: e.subject,
        timeLabel: timeLabel(e.start, now),
        linked: !!link,
        linkedName: link?.linkedTaskName ?? null,
      };
    }),
  });
});

// GET /api/calendar/free-slots?date=YYYY-MM-DD&excludeTaskGid=...
// Busy time = Outlook events that day (if connected) + this user's other
// Asana tasks already due that day (if connected), each padded by the
// buffer-between-tasks setting.
calendarRouter.get('/free-slots', async (req, res) => {
  const dateStr = typeof req.query.date === 'string' ? req.query.date : null;
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    res.status(400).json({ error: 'date query param (YYYY-MM-DD) is required' });
    return;
  }
  const excludeTaskGid = typeof req.query.excludeTaskGid === 'string' ? req.query.excludeTaskGid : null;
  const day = new Date(`${dateStr}T00:00:00`);
  const dayEnd = new Date(day.getTime() + 86_400_000);

  const settings = await getOrCreateSettings(req.userId!);

  const busy: { start: Date; end: Date }[] = [];

  const [asanaAccount, outlookAccount] = await Promise.all([
    prisma.oAuthAccount.findUnique({ where: { userId_provider: { userId: req.userId!, provider: 'ASANA' } } }),
    prisma.oAuthAccount.findUnique({ where: { userId_provider: { userId: req.userId!, provider: 'OUTLOOK' } } }),
  ]);

  if (outlookAccount) {
    const accessToken = await getValidAccessToken(req.userId!, 'OUTLOOK');
    const events = await listEvents(accessToken, day, dayEnd);
    busy.push(...events.map((e) => ({ start: e.start, end: e.end })));
  }
  if (asanaAccount) {
    const accessToken = await getValidAccessToken(req.userId!, 'ASANA');
    const tasks = await listIncompleteAssignedTasks(accessToken);
    for (const t of tasks) {
      if (!t.dueAt || t.gid === excludeTaskGid) continue;
      const due = new Date(t.dueAt);
      if (due >= day && due < dayEnd) {
        busy.push({ start: due, end: new Date(due.getTime() + t.hours * 3_600_000) });
      }
    }
  }

  const slots = computeFreeSlots(day, settings.prefStartTime, settings.prefEndTime, settings.bufferMinutes, busy);
  res.json({ slots });
});

const linkSchema = z.object({ taskGid: z.string().min(1), taskName: z.string().min(1) });

calendarRouter.post('/events/:eventId/link', async (req, res) => {
  const parsed = linkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await prisma.calendarEventLink.upsert({
    where: { userId_externalEventId: { userId: req.userId!, externalEventId: req.params.eventId } },
    create: {
      userId: req.userId!,
      externalEventId: req.params.eventId,
      linkedAsanaTaskGid: parsed.data.taskGid,
      linkedTaskName: parsed.data.taskName,
    },
    update: { linkedAsanaTaskGid: parsed.data.taskGid, linkedTaskName: parsed.data.taskName },
  });
  res.status(204).end();
});

const addTaskSchema = z.object({
  title: z.string().min(1),
  target: z.union([z.object({ projectGid: z.string().min(1) }), z.object({ parentGid: z.string().min(1) })]),
});

calendarRouter.post('/events/:eventId/add-task', async (req, res) => {
  const parsed = addTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const accessToken = await getValidAccessToken(req.userId!, 'ASANA');
  const settings = await getOrCreateSettings(req.userId!);
  const { title, target } = parsed.data;
  const created =
    'projectGid' in target
      ? await createTaskInProject(accessToken, target.projectGid, title, settings.timezone)
      : await createSubtask(accessToken, target.parentGid, title, settings.timezone);

  await prisma.calendarEventLink.upsert({
    where: { userId_externalEventId: { userId: req.userId!, externalEventId: req.params.eventId } },
    create: { userId: req.userId!, externalEventId: req.params.eventId, linkedAsanaTaskGid: created.gid, linkedTaskName: created.name },
    update: { linkedAsanaTaskGid: created.gid, linkedTaskName: created.name },
  });
  res.status(201).json({ gid: created.gid, name: created.name });
});
