import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { getValidAccessToken } from '../lib/tokens.js';
import { computeFreeSlots } from '../lib/freeSlots.js';
import { getOrCreateSettings } from '../lib/settings.js';
import { listEvents } from '../providers/outlook.js';
import { createSubtask, createTaskInProject } from '../providers/asana.js';
import { recordMatch } from '../lib/matchLog.js';
import { addDaysToDateStr, dateStrInTz, hmInTz, weekdayNameOfDateStr, zonedMidnightUtc } from '../lib/tz.js';

export const calendarRouter = Router();
calendarRouter.use(requireAuth);

/// `timeZone` is the acting user's own configured Settings.timezone — not
/// the server process's ambient clock (see workload.ts's identical
/// reasoning), so "Today"/"Tomorrow" here agrees with the day-bucketing
/// shown everywhere else in the app instead of drifting for a user whose
/// physical location (or just their chosen zone) differs from the
/// server's.
function relativeDayLabel(date: Date, now: Date, timeZone: string): string {
  const dateStr = dateStrInTz(date, timeZone);
  const todayStr = dateStrInTz(now, timeZone);
  if (dateStr === todayStr) return 'Today';
  if (dateStr === addDaysToDateStr(todayStr, 1)) return 'Tomorrow';
  return weekdayNameOfDateStr(dateStr);
}

function timeLabel(date: Date, now: Date, timeZone: string): string {
  const { h, m } = hmInTz(date, timeZone);
  const hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return `${relativeDayLabel(date, now, timeZone)} · ${hhmm}`;
}

/// A recurring meeting's Outlook occurrences each carry their own
/// externalEventId, so a plain CalendarEventLink ignore only ever covers
/// one day's instance — see IgnoredEventTitle. Exact-title match, checked
/// wherever events are listed.
async function ignoredTitleSet(userId: string): Promise<Set<string>> {
  const rows = await prisma.ignoredEventTitle.findMany({ where: { userId } });
  return new Set(rows.map((r) => r.title));
}

// GET /api/calendar/events — unlinked (and linked, for display) Outlook
// events over the next 7 days, for the Overview screen.
calendarRouter.get('/events', async (req, res) => {
  const accessToken = await getValidAccessToken(req.userId!, 'OUTLOOK');
  const settings = await getOrCreateSettings(req.userId!);
  const now = new Date();
  const to = new Date(now.getTime() + 7 * 86_400_000);
  const events = await listEvents(accessToken, now, to);

  const links = await prisma.calendarEventLink.findMany({ where: { userId: req.userId! } });
  const linkByExternalId = new Map(links.map((l) => [l.externalEventId, l]));
  const ignoredTitles = await ignoredTitleSet(req.userId!);

  res.json({
    events: events
      .filter((e) => !ignoredTitles.has(e.subject) && !linkByExternalId.get(e.id)?.ignored)
      .map((e) => {
        const link = linkByExternalId.get(e.id);
        return {
          id: e.id,
          title: e.subject,
          timeLabel: timeLabel(e.start, now, settings.timezone),
          start: e.start.toISOString(),
          end: e.end.toISOString(),
          linked: !!link?.linkedAsanaTaskGid,
          linkedName: link?.linkedTaskName ?? null,
          linkedTaskGid: link?.linkedAsanaTaskGid ?? null,
          linkedTaskPermalinkUrl: link?.linkedTaskPermalinkUrl ?? null,
          webLink: e.webLink,
        };
      }),
  });
});

const freeSlotsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  // Duration of the task being planned — slots are chunked to exactly this
  // size (not a fixed 30 minutes), so every returned slot is actually big
  // enough to hold the task.
  hours: z.coerce.number().positive().max(200),
  // The caller's OTHER tasks already due this day (excluding the one being
  // planned), as `[{dueAt, hours}]` JSON — the frontend already has its
  // full task list loaded (fetched once at boot), so it can filter this
  // down to same-day tasks itself. This avoids re-fetching and
  // re-paginating the user's *entire* Asana backlog on every free-slots
  // lookup, which used to be the dominant cost of this endpoint on a large
  // workspace (real numbers: ~4-10s+ for a ~2000-task backlog, every time
  // "Plan for this day" was opened). This is a suggestion list, not the
  // final commit — PATCH /api/tasks/:gid still does its own authoritative
  // conflict check against live Asana data before actually writing a due
  // date, so trusting client-supplied data here is safe.
  busyTasks: z.string().optional(),
});

// GET /api/calendar/free-slots?date=YYYY-MM-DD&hours=1.5&busyTasks=...
// Busy time = Outlook events that day (if connected) + the caller-supplied
// same-day Asana tasks, each padded by the buffer-between-tasks setting.
calendarRouter.get('/free-slots', async (req, res) => {
  const parsed = freeSlotsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { date: dateStr, hours, busyTasks } = parsed.data;
  const settings = await getOrCreateSettings(req.userId!);
  // The acting user's own configured zone, not the server's ambient one —
  // see workload.ts's identical reasoning. `dateStr` is a bare calendar
  // date with no timezone of its own (the client sends whichever day it's
  // showing), so "midnight" only means something once anchored to a zone.
  const day = zonedMidnightUtc(dateStr, settings.timezone);
  const dayEnd = new Date(day.getTime() + 86_400_000);

  const busy: { start: Date; end: Date }[] = [];
  // Returned alongside `slots` so the client's day-calendar view can draw
  // these as blocks too — it previously only ever showed Asana tasks, even
  // though an Outlook meeting is exactly as much a reason a slot isn't
  // really free. Carries the same link/ignore/webLink state as GET /events
  // (not just title/time) so the day-calendar's blocks can be clicked open
  // into a detail panel instead of being purely decorative.
  let outlookEvents: {
    id: string;
    title: string;
    start: string;
    end: string;
    linked: boolean;
    linkedName: string | null;
    linkedTaskGid: string | null;
    linkedTaskPermalinkUrl: string | null;
    ignored: boolean;
    webLink: string;
  }[] = [];

  const outlookAccount = await prisma.oAuthAccount.findUnique({ where: { userId_provider: { userId: req.userId!, provider: 'OUTLOOK' } } });
  if (outlookAccount) {
    const accessToken = await getValidAccessToken(req.userId!, 'OUTLOOK');
    const events = await listEvents(accessToken, day, dayEnd);
    busy.push(...events.map((e) => ({ start: e.start, end: e.end })));
    const links = await prisma.calendarEventLink.findMany({ where: { userId: req.userId!, externalEventId: { in: events.map((e) => e.id) } } });
    const linkByExternalId = new Map(links.map((l) => [l.externalEventId, l]));
    const ignoredTitles = await ignoredTitleSet(req.userId!);
    outlookEvents = events.map((e) => {
      const link = linkByExternalId.get(e.id);
      return {
        id: e.id,
        title: e.subject,
        start: e.start.toISOString(),
        end: e.end.toISOString(),
        linked: !!link?.linkedAsanaTaskGid,
        linkedName: link?.linkedTaskName ?? null,
        linkedTaskGid: link?.linkedAsanaTaskGid ?? null,
        linkedTaskPermalinkUrl: link?.linkedTaskPermalinkUrl ?? null,
        ignored: ignoredTitles.has(e.subject) || (link?.ignored ?? false),
        webLink: e.webLink,
      };
    });
  }

  if (busyTasks) {
    try {
      const others = JSON.parse(busyTasks) as { dueAt: string; hours: number }[];
      for (const t of others) {
        const due = new Date(t.dueAt);
        if (due >= day && due < dayEnd) {
          busy.push({ start: due, end: new Date(due.getTime() + t.hours * 3_600_000) });
        }
      }
    } catch {
      // malformed — treat as no other same-day tasks rather than failing
      // the whole request over a display-only suggestion list.
    }
  }

  const slots = computeFreeSlots(dateStr, settings.timezone, settings.prefStartTime, settings.prefEndTime, settings.bufferMinutes, busy, Math.round(hours * 60));
  res.json({ slots, outlookEvents });
});

const linkSchema = z.object({
  taskGid: z.string().min(1),
  taskName: z.string().min(1),
  permalinkUrl: z.string().min(1).optional(),
  // Purely for matchLog.ts — the client already computed its own matcher's
  // score/rank for this pick (see store.svelte.ts's commitEventLink) while
  // building the link/add search panel, and re-deriving that server-side
  // would mean re-fetching the same same-day task list a second time for
  // no functional reason. Optional since the schema shouldn't reject a
  // link over a logging-only field failing to arrive.
  matchLog: z
    .object({ eventTitle: z.string().min(1), matchScore: z.number(), matchRank: z.number().nullable(), candidateCount: z.number() })
    .optional(),
});

calendarRouter.post('/events/:eventId/link', async (req, res) => {
  const parsed = linkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { taskGid, taskName, permalinkUrl, matchLog } = parsed.data;
  await prisma.calendarEventLink.upsert({
    where: { userId_externalEventId: { userId: req.userId!, externalEventId: req.params.eventId } },
    create: {
      userId: req.userId!,
      externalEventId: req.params.eventId,
      linkedAsanaTaskGid: taskGid,
      linkedTaskName: taskName,
      linkedTaskPermalinkUrl: permalinkUrl ?? null,
    },
    update: { linkedAsanaTaskGid: taskGid, linkedTaskName: taskName, linkedTaskPermalinkUrl: permalinkUrl ?? null, ignored: false },
  });
  if (matchLog) {
    recordMatch({
      eventTitle: matchLog.eventTitle,
      taskName,
      matchScore: matchLog.matchScore,
      matchRank: matchLog.matchRank,
      candidateCount: matchLog.candidateCount,
    });
  }
  res.status(204).end();
});

/// Distinct from /ignore: clears the link and returns the event to a plain
/// undecided state (still eligible for gating/relinking), rather than also
/// marking it ignored. See the calendar-entry detail panel's "Remove
/// linked task" action.
calendarRouter.post('/events/:eventId/unlink', async (req, res) => {
  await prisma.calendarEventLink.updateMany({
    where: { userId: req.userId!, externalEventId: req.params.eventId },
    data: { linkedAsanaTaskGid: null, linkedTaskName: null, linkedTaskPermalinkUrl: null },
  });
  res.status(204).end();
});

/// Dismisses an event from the Overview list without linking it to
/// anything — persisted (unlike a purely client-side hide) so it stays
/// dismissed across reloads, same as a real link would.
calendarRouter.post('/events/:eventId/ignore', async (req, res) => {
  await prisma.calendarEventLink.upsert({
    where: { userId_externalEventId: { userId: req.userId!, externalEventId: req.params.eventId } },
    create: { userId: req.userId!, externalEventId: req.params.eventId, ignored: true },
    update: { ignored: true, linkedAsanaTaskGid: null, linkedTaskName: null, linkedTaskPermalinkUrl: null },
  });
  res.status(204).end();
});

/// Reverses the above — the Undo action on the "Ignored" toast. A no-op if
/// nothing was ever ignored (nothing to reverse), rather than an error.
calendarRouter.post('/events/:eventId/unignore', async (req, res) => {
  await prisma.calendarEventLink.updateMany({
    where: { userId: req.userId!, externalEventId: req.params.eventId },
    data: { ignored: false },
  });
  res.status(204).end();
});

const ignoreTitleSchema = z.object({ title: z.string().min(1) });

/// The "ignore every event with this title" option offered alongside a
/// plain single-instance ignore (see ignoreEvent in store.svelte.ts) — for
/// a daily recurring meeting whose Outlook occurrences each carry their
/// own externalEventId, this is what actually keeps it dismissed on every
/// future day instead of just the one instance tapped. Also ignores this
/// specific instance via the normal path, purely so the current view
/// updates immediately rather than waiting on the title filter to apply on
/// next fetch.
calendarRouter.post('/events/:eventId/ignore-title', async (req, res) => {
  const parsed = ignoreTitleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await prisma.ignoredEventTitle.upsert({
    where: { userId_title: { userId: req.userId!, title: parsed.data.title } },
    create: { userId: req.userId!, title: parsed.data.title },
    update: {},
  });
  await prisma.calendarEventLink.upsert({
    where: { userId_externalEventId: { userId: req.userId!, externalEventId: req.params.eventId } },
    create: { userId: req.userId!, externalEventId: req.params.eventId, ignored: true },
    update: { ignored: true, linkedAsanaTaskGid: null, linkedTaskName: null, linkedTaskPermalinkUrl: null },
  });
  res.status(204).end();
});

/// Reverses ignore-title — the Undo action on its own toast.
calendarRouter.post('/events/:eventId/unignore-title', async (req, res) => {
  const parsed = ignoreTitleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await prisma.ignoredEventTitle.deleteMany({ where: { userId: req.userId!, title: parsed.data.title } });
  await prisma.calendarEventLink.updateMany({
    where: { userId: req.userId!, externalEventId: req.params.eventId },
    data: { ignored: false },
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
    create: {
      userId: req.userId!,
      externalEventId: req.params.eventId,
      linkedAsanaTaskGid: created.gid,
      linkedTaskName: created.name,
      linkedTaskPermalinkUrl: created.permalink_url,
    },
    update: { linkedAsanaTaskGid: created.gid, linkedTaskName: created.name, linkedTaskPermalinkUrl: created.permalink_url, ignored: false },
  });
  res.status(201).json({ gid: created.gid, name: created.name, permalinkUrl: created.permalink_url });
});
