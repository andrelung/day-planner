import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { getValidAccessToken } from '../lib/tokens.js';
import { deriveQueue } from '../lib/taskQueue.js';
import { getOrCreateSettings } from '../lib/settings.js';
import { enqueueAction } from '../lib/pendingActionQueue.js';
import { createSubtask, createTaskInProject, listIncompleteAssignedTasks } from '../providers/asana.js';
import type { RemoteTask } from '../providers/types.js';

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

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
  const toTaskDto = (t: RemoteTask & { doubled?: boolean }) => ({
    id: t.gid,
    name: t.name,
    project: t.project,
    hours: t.hours,
    dueHour: t.dueHour,
    dueAt: t.dueAt,
    dueOn: t.dueOn,
    doubled: t.doubled ?? false,
    permalinkUrl: t.permalinkUrl,
  });
  return {
    tasks: queued.map(toTaskDto),
    tasksWithoutDueDate: withoutDueDate.map(toTaskDto),
    projects: [...projects.entries()].map(([gid, name]) => ({ gid, name })),
  };
}

tasksRouter.get('/', async (req, res) => {
  const accessToken = await getValidAccessToken(req.userId!, 'ASANA');
  const raw = await listIncompleteAssignedTasks(accessToken, { withBreadcrumbs: true });
  res.json(buildTasksPayload(raw));
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
  res.flushHeaders();

  try {
    const accessToken = await getValidAccessToken(req.userId!, 'ASANA');
    const raw = await listIncompleteAssignedTasks(accessToken, {
      withBreadcrumbs: true,
      onBatch: (tasksSoFar, totalSoFar) => {
        res.write(`event: progress\ndata: ${JSON.stringify({ count: totalSoFar, ...buildTasksPayload(tasksSoFar) })}\n\n`);
      },
    });
    res.write(`event: done\ndata: ${JSON.stringify(buildTasksPayload(raw))}\n\n`);
  } catch (err) {
    // Named "failed", not "error" — SSE's native connection-error event is
    // itself dispatched as an "error" event on the client's EventSource, so
    // reusing that name would be ambiguous with a real connection drop.
    res.write(`event: failed\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to load tasks' })}\n\n`);
  }
  res.end();
});

const patchSchema = z
  .object({
    dueAt: z.string().datetime().nullable().optional(),
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
  const { dueAt, hours, name } = parsed.data;
  const settings = await getOrCreateSettings(req.userId!);

  if (dueAt !== undefined) {
    await enqueueAction(req.userId!, dueAt ? "Set a task's due time" : "Clear a task's due time", {
      kind: 'setTaskDueAt',
      taskGid: gid,
      dueAtIso: dueAt ?? null,
      timezone: settings.timezone,
    });
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
/// tasks are due today (same data queueLabel's x/y count is built from), so
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
      enqueueAction(req.userId!, "Clear a task's due time", { kind: 'setTaskDueAt', taskGid: gid, dueAtIso: null, timezone: settings.timezone }),
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
