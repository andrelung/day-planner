import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { getValidAccessToken } from '../lib/tokens.js';
import { deriveQueue } from '../lib/taskQueue.js';
import { getOrCreateSettings } from '../lib/settings.js';
import { createSubtask, createTaskInProject, listIncompleteAssignedTasks, setTaskDueAt, setTaskHours } from '../providers/asana.js';
import type { RemoteTask } from '../providers/types.js';

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

function buildTasksPayload(raw: (RemoteTask & { projectGid: string | null })[]) {
  const queued = deriveQueue(raw);
  const projects = new Map<string, string>();
  for (const t of raw) {
    if (t.projectGid) projects.set(t.projectGid, t.project);
  }
  return {
    tasks: queued.map((t) => ({
      id: t.gid,
      name: t.name,
      project: t.project,
      hours: t.hours,
      dueHour: t.dueHour,
      dueAt: t.dueAt,
      doubled: t.doubled,
      permalinkUrl: t.permalinkUrl,
    })),
    projects: [...projects.entries()].map(([gid, name]) => ({ gid, name })),
  };
}

tasksRouter.get('/', async (req, res) => {
  const accessToken = await getValidAccessToken(req.userId!, 'ASANA');
  const raw = await listIncompleteAssignedTasks(accessToken, { withBreadcrumbs: true });
  res.json(buildTasksPayload(raw));
});

/// Same result as GET / (used for the initial boot fetch specifically),
/// but as an SSE stream emitting `progress` events with a running count as
/// Asana's cursor-paginated /tasks pages come in, then one final `done`
/// event with the full payload. A "crowded" workspace can mean dozens of
/// pages plus per-subtask breadcrumb lookups, multi-second real work — this
/// gives the loading screen something honest to show instead of a bare
/// spinner. Other refreshes (after committing a plan, etc.) still use the
/// plain GET / above; streaming is only worth the complexity for the
/// long boot-time fetch.
tasksRouter.get('/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const accessToken = await getValidAccessToken(req.userId!, 'ASANA');
    const raw = await listIncompleteAssignedTasks(accessToken, {
      withBreadcrumbs: true,
      onProgress: (count) => res.write(`event: progress\ndata: ${JSON.stringify({ count })}\n\n`),
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
    force: z.boolean().optional(),
  })
  .refine((v) => v.hours === undefined || v.name !== undefined, { message: 'name is required when setting hours' });

tasksRouter.patch('/:gid', async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { gid } = req.params;
  const { dueAt, hours, name, force } = parsed.data;
  const accessToken = await getValidAccessToken(req.userId!, 'ASANA');
  const settings = await getOrCreateSettings(req.userId!);

  if (dueAt !== undefined) {
    if (dueAt && !force) {
      const others = await listIncompleteAssignedTasks(accessToken);
      const conflicts = others.filter((t) => t.gid !== gid && t.dueAt === dueAt);
      if (conflicts.length) {
        res.status(409).json({
          error: 'slot_conflict',
          conflicts: conflicts.map((c) => ({ name: c.name, hours: c.hours })),
        });
        return;
      }
    }
    await setTaskDueAt(accessToken, gid, dueAt, settings.timezone);
  }

  if (hours !== undefined) {
    await setTaskHours(accessToken, gid, name!, hours, settings.timezone);
  }

  res.status(204).end();
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
