import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { getValidAccessToken } from '../lib/tokens.js';
import { deriveQueue } from '../lib/taskQueue.js';
import { getOrCreateSettings, resolveTimezone } from '../lib/settings.js';
import { enqueueAction } from '../lib/pendingActionQueue.js';
import { prisma } from '../lib/prisma.js';
import {
  addTaskToProject,
  createBugReportTask,
  createSubtask,
  createTaskInProject,
  getTaskDetails,
  listIncompleteAssignedTasks,
  refreshTasksByGid,
  setTaskParent,
  typeahead,
} from '../providers/asana.js';
import type { DueUpdate } from '../providers/asana.js';
import type { RemoteTask } from '../providers/types.js';
import { logTaskLoadFailure, logTaskLoadTiming } from '../lib/taskLoadLog.js';

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

function toTaskDto(t: RemoteTask) {
  return {
    id: t.gid,
    name: t.name,
    project: t.project,
    hours: t.hours,
    hasExplicitHours: t.hasExplicitHours,
    dueHour: t.dueHour,
    dueAt: t.dueAt,
    dueOn: t.dueOn,
    permalinkUrl: t.permalinkUrl,
  };
}

function buildTasksPayload(raw: (RemoteTask & { projectGid: string | null })[]) {
  // Tasks with no due date at all don't belong in the swipeable triage
  // queue (see taskQueue.ts) — surfaced separately instead, e.g. under
  // "Tasks without Due Date" on the Overview screen.
  const withoutDueDate = raw.filter((t) => t.dueOn === null);
  const queued = deriveQueue(raw);
  const projects = new Map<string, string>();
  for (const t of raw) {
    if (t.projectGid) projects.set(t.projectGid, t.project);
  }
  return {
    tasks: queued.map(toTaskDto),
    tasksWithoutDueDate: withoutDueDate.map(toTaskDto),
    projects: [...projects.entries()].map(([gid, name]) => ({ gid, name })),
  };
}

tasksRouter.get('/', async (req, res) => {
  try {
    const accessToken = await getValidAccessToken(req.userId!, 'ASANA');
    const settings = await getOrCreateSettings(req.userId!);
    const raw = await listIncompleteAssignedTasks(accessToken, { timezone: settings.timezone, userId: req.userId! });
    res.json(buildTasksPayload(raw));
  } catch (err) {
    logTaskLoadFailure({
      source: 'server',
      phase: 'refresh',
      message: err instanceof Error ? err.message : String(err),
      userId: req.userId,
    });
    throw err; // still handled by the app-level error middleware in index.ts
  }
});

const refreshByGidSchema = z.object({ gids: z.array(z.string()).min(1).max(20) });

/// Fast, targeted top-up for exactly what's on screen — the Triage card
/// currently focused plus its next few "Up Next" entries — called on
/// resume instead of waiting on the fuller GET / above to notice an edit or
/// deletion. See refreshTasksByGid: goes straight to Asana's single-task
/// endpoint per gid rather than the near-term search pass or the plain
/// list's pagination, so it isn't subject to Asana's search-index lag at
/// all. A gid missing from the response body's `tasks` map (rather than
/// present with a value) is gone — deleted, or completed elsewhere.
tasksRouter.post('/refresh-by-gid', async (req, res) => {
  const parsed = refreshByGidSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const accessToken = await getValidAccessToken(req.userId!, 'ASANA');
  const settings = await getOrCreateSettings(req.userId!);
  const byGid = await refreshTasksByGid(accessToken, parsed.data.gids, settings.timezone);
  const tasks: Record<string, ReturnType<typeof toTaskDto> | null> = {};
  for (const [gid, task] of Object.entries(byGid)) tasks[gid] = task ? toTaskDto(task) : null;
  res.json({ tasks });
});

/// The extra detail shown on Triage's focus card once "Up next" is
/// collapsed — description, collaborators, creation date. Fetched on
/// demand for one task at a time (see getTaskDetails) rather than bundled
/// into the main task list.
tasksRouter.get('/:gid/details', async (req, res) => {
  const accessToken = await getValidAccessToken(req.userId!, 'ASANA');
  const details = await getTaskDetails(accessToken, req.params.gid);
  if (!details) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json(details);
});

const refileSchema = z.object({
  target: z.union([z.object({ projectGid: z.string().min(1) }), z.object({ parentGid: z.string().min(1) })]),
});

/// Re-files an existing task into a different project, or as a subtask of a
/// different parent — Triage's focus-card equivalent of the calendar's
/// add-task target picker (see routes/calendar.ts), just against a task
/// that already exists instead of creating a new one.
tasksRouter.post('/:gid/refile', async (req, res) => {
  const parsed = refileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const accessToken = await getValidAccessToken(req.userId!, 'ASANA');
  const settings = await getOrCreateSettings(req.userId!);
  const { target } = parsed.data;
  if ('projectGid' in target) {
    await addTaskToProject(accessToken, req.params.gid, target.projectGid, settings.timezone);
  } else {
    await setTaskParent(accessToken, req.params.gid, target.parentGid, settings.timezone);
  }
  res.status(204).end();
});

const clientLogSchema = z.object({
  phase: z.enum(['boot', 'refresh']),
  message: z.string().min(1),
  errorType: z.enum(['network', 'server']),
  online: z.boolean().optional(),
});

/// Fire-and-forget: the client posts here whenever it catches a
/// "Could not load tasks from Asana" failure (see store.svelte.ts's
/// reportRetryableError call sites), so failures that never reach any
/// other route at all — most notably a fetch() rejecting outright right
/// after an iOS resume, before the network stack has actually
/// reconnected — still land somewhere durable (see taskLoadLog.ts) instead
/// of only ever being visible as a toast the user has to notice and
/// describe after the fact. Always 204s, even on a malformed body — a
/// broken diagnostic call is never worth surfacing to the user.
tasksRouter.post('/client-log', (req, res) => {
  const parsed = clientLogSchema.safeParse(req.body);
  if (parsed.success) {
    logTaskLoadFailure({
      source: 'client',
      phase: parsed.data.phase,
      message: `[${parsed.data.errorType}] ${parsed.data.message}`,
      userId: req.userId,
      online: parsed.data.online,
    });
  }
  res.status(204).end();
});

/// Same result as GET / (used for the initial boot fetch specifically), but
/// as an SSE stream: each `progress` event carries a running count *and* a
/// full, ready-to-render queue built from whatever's been fetched so far
/// (via deriveQueue — cheap, no I/O), so the client can show tasks well
/// before the whole (possibly many-paged, breadcrumb-resolving) fetch
/// finishes, then one final `done` event with the fully-resolved payload.
/// Early batches won't have subtasks' breadcrumb project names yet — those
/// only get resolved once, over the complete set, right before `done`.
/// Other refreshes (after committing a plan, etc.) still use the plain
/// GET / above; streaming is only worth the complexity for the long
/// boot-time fetch.
tasksRouter.get('/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Tells nginx (and anything else that respects the convention) not to
  // buffer this response — without it, a reverse proxy sitting in front of
  // this route can hold every 'phase'/'progress' event in its own buffer
  // until the connection closes, so the client never sees anything (not
  // even the very first phase update) until the whole fetch finishes or a
  // buffer/timeout limit forces a flush. Harmless if nothing in the path
  // actually looks at it.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // The client's own stall watchdog only resets on a named event it
  // actually listens for (see streamTasks() in store.svelte.ts) — without
  // this, a real account's breadcrumb-resolution pass (resolveBreadcrumbs,
  // below) runs as a single long step with no progress event of its own,
  // and on a large/deeply-nested project structure that step alone can
  // genuinely take longer than the watchdog's timeout. That's not a stall,
  // just quiet, real work — this heartbeat keeps the client from treating
  // the two as the same thing. Cleared in `finally` below either way.
  const heartbeat = setInterval(() => res.write(`event: heartbeat\ndata: {}\n\n`), 8_000);

  // Buckets wall-clock time by the same phase labels already shown to the
  // user, so a "why is this slow" report can point at a specific stage
  // instead of just the total — see logTaskLoadTiming's own comment.
  const streamStart = Date.now();
  const stages: Record<string, number> = {};
  let stageStart = streamStart;
  let stageLabel = 'getValidAccessToken';
  const markStage = (nextLabel: string) => {
    const now = Date.now();
    stages[stageLabel] = now - stageStart;
    stageStart = now;
    stageLabel = nextLabel;
  };
  // Per-page timings for the full-fetch pagination pass, alongside its
  // total in `stages` — roughly constant per-page latency points at fixed
  // per-request overhead (a new connection/TLS handshake for each one);
  // latency that climbs with page count points at something else (larger
  // responses, server-side load).
  const pageMs: number[] = [];
  let tokenRefreshMs: number | null = null;

  try {
    const accessToken = await getValidAccessToken(req.userId!, 'ASANA', (ms) => {
      tokenRefreshMs = ms;
    });
    // The client already knows its own timezone — it read it from /api/me
    // moments earlier in the same boot sequence — so it's passed straight
    // through here instead of this route re-querying Settings for the same
    // value a second time. That redundant read was a real, confirmed
    // contributor to boot slowness (see settings.ts's own comment); this
    // removes it from this route's path entirely rather than trying to
    // make it faster. Still falls back to a real lookup if the param is
    // missing/invalid — a defensive path for any other caller of this
    // route, not the one boot() actually takes.
    markStage('resolveTimezone');
    const timezone = await resolveTimezone(req.userId!, req.query.timezone);
    const raw = await listIncompleteAssignedTasks(accessToken, {
      timezone,
      userId: req.userId!,
      onBatch: (tasksSoFar, totalSoFar) => {
        res.write(`event: progress\ndata: ${JSON.stringify({ count: totalSoFar, ...buildTasksPayload(tasksSoFar) })}\n\n`);
      },
      onPhase: (label) => {
        markStage(label);
        res.write(`event: phase\ndata: ${JSON.stringify({ label })}\n\n`);
      },
      onPageMs: (ms) => pageMs.push(ms),
    });
    markStage('done');
    logTaskLoadTiming({ phase: 'boot', userId: req.userId, stages, pageMs, tokenRefreshMs, totalMs: Date.now() - streamStart, taskCount: raw.length });
    res.write(`event: done\ndata: ${JSON.stringify(buildTasksPayload(raw))}\n\n`);
  } catch (err) {
    logTaskLoadFailure({
      source: 'server',
      phase: 'boot',
      message: err instanceof Error ? err.message : String(err),
      userId: req.userId,
    });
    // Named "failed", not "error" — SSE's native connection-error event is
    // itself dispatched as an "error" event on the client's EventSource, so
    // reusing that name would be ambiguous with a real connection drop.
    res.write(`event: failed\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to load tasks' })}\n\n`);
  } finally {
    clearInterval(heartbeat);
  }
  res.end();
});

const typeaheadQuerySchema = z.object({
  query: z.string().default(''),
  resourceType: z.enum(['task', 'project']).default('task'),
});

/// Backs the project/subtask/task search in Overview's "add as task"/"link
/// to task" panels — Asana's own typeahead endpoint instead of filtering
/// the client's already-loaded task list (which is only ever "incomplete
/// tasks assigned to me with a due date", missing plenty of tasks someone
/// might actually want to link/add under). Requires the
/// workspaces.typeahead:read scope; an account connected before that scope
/// was added will 403 here until reconnected — the frontend falls back to
/// the old client-side filtering if this fails, so search still works
/// either way.
tasksRouter.get('/typeahead', async (req, res) => {
  const parsed = typeaheadQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const accessToken = await getValidAccessToken(req.userId!, 'ASANA');
  const results = await typeahead(accessToken, parsed.data.resourceType, parsed.data.query, req.userId!);
  res.json({ results: results.map((r) => ({ gid: r.gid, name: r.name, permalinkUrl: r.permalinkUrl })) });
});

const patchSchema = z
  .object({
    dueAt: z.string().datetime().nullable().optional(),
    // Only meaningful when dueAt is explicitly null — "due this date, no
    // specific time" (the common state a fresh Asana task starts in)
    // rather than "no due date at all". See DueUpdate in providers/asana.ts.
    dueOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    hours: z.number().min(0).max(200).optional(),
    // The task's current clean (bracket-stripped) title, as already held by
    // the frontend — needed to rebuild "<name> [<hours>]" without a round trip.
    name: z.string().min(1).optional(),
  })
  .refine((v) => v.hours === undefined || v.name !== undefined, { message: 'name is required when setting hours' });

/// The double-book check used to happen here (a live re-fetch of every
/// incomplete task, just to compare one timestamp) and was the dominant
/// cost of planning a task. It's now done client-side against already-
/// loaded data before this endpoint is even called — see
/// findConflicts/commitPlanLocally in store.svelte.ts — so this endpoint
/// has nothing left to do but durably queue the write and return; a
/// background worker performs it (with retries) — see pendingActionQueue.ts.
tasksRouter.patch('/:gid', async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { gid } = req.params;
  const { dueAt, dueOn, hours, name } = parsed.data;
  const settings = await getOrCreateSettings(req.userId!);

  if (dueAt !== undefined) {
    const due: DueUpdate = dueAt ? { kind: 'instant', dueAt } : dueOn ? { kind: 'dateOnly', dueOn } : { kind: 'clear' };
    const label = due.kind === 'instant' ? "Set a task's due time" : due.kind === 'dateOnly' ? "Set a task's due date" : "Clear a task's due time";
    await enqueueAction(req.userId!, label, { kind: 'setTaskDueAt', taskGid: gid, due, timezone: settings.timezone });
  }

  if (hours !== undefined) {
    await enqueueAction(req.userId!, `Update "${name}"'s estimate`, {
      kind: 'setTaskHours',
      taskGid: gid,
      name: name!,
      hours,
      timezone: settings.timezone,
    });
  }

  res.status(204).end();
});

const resetDaySchema = z.object({ taskGids: z.array(z.string().min(1)).min(1) });

/// Clears due_at (and due_on, per setTaskDueAt's existing "remove due date"
/// behavior) for a caller-supplied set of tasks — used by Settings' "Reset
/// today's plan". The frontend already knows exactly which of its loaded
/// tasks are due today (same data queueLabel's own count is built from), so
/// it sends those gids directly rather than the server re-deriving "today's
/// tasks" via another full Asana fetch. Each clear is queued individually
/// (see pendingActionQueue.ts) rather than awaited, so resetting a large
/// day doesn't block on N sequential/parallel Asana writes.
tasksRouter.post('/reset-day', async (req, res) => {
  const parsed = resetDaySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const settings = await getOrCreateSettings(req.userId!);
  await Promise.all(
    parsed.data.taskGids.map((gid) =>
      enqueueAction(req.userId!, "Clear a task's due time", { kind: 'setTaskDueAt', taskGid: gid, due: { kind: 'clear' }, timezone: settings.timezone }),
    ),
  );
  res.json({ queued: parsed.data.taskGids.length });
});

const createSchema = z.union([
  z.object({ name: z.string().min(1), projectGid: z.string().min(1) }),
  z.object({ name: z.string().min(1), parentGid: z.string().min(1) }),
]);

tasksRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const accessToken = await getValidAccessToken(req.userId!, 'ASANA');
  const settings = await getOrCreateSettings(req.userId!);
  const created =
    'projectGid' in parsed.data
      ? await createTaskInProject(accessToken, parsed.data.projectGid, parsed.data.name, settings.timezone)
      : await createSubtask(accessToken, parsed.data.parentGid, parsed.data.name, settings.timezone);
  res.status(201).json({ gid: created.gid, name: created.name });
});

const bugReportSchema = z.object({ description: z.string().trim().min(1).max(5000) });

/// Settings' "Report a bug" — see createBugReportTask for what actually
/// gets created (a followers-added-best-effort My Tasks entry, no project).
tasksRouter.post('/bug-report', async (req, res) => {
  const parsed = bugReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const accessToken = await getValidAccessToken(req.userId!, 'ASANA');
  const settings = await getOrCreateSettings(req.userId!);
  const account = await prisma.oAuthAccount.findUnique({ where: { userId_provider: { userId: req.userId!, provider: 'ASANA' } } });
  const created = await createBugReportTask(accessToken, parsed.data.description, account?.externalAccountId ?? null, settings.timezone, req.userId!);
  res.status(201).json({ gid: created.gid, permalinkUrl: created.permalink_url });
});
