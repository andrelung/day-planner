import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { getValidAccessToken } from '../lib/tokens.js';
import { deriveQueue } from '../lib/taskQueue.js';
import { createSubtask, createTaskInProject, listIncompleteAssignedTasks, setTaskDueAt, setTaskHours } from '../providers/asana.js';

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

tasksRouter.get('/', async (req, res) => {
  const accessToken = await getValidAccessToken(req.userId!, 'ASANA');
  const raw = await listIncompleteAssignedTasks(accessToken);
  const queued = deriveQueue(raw);

  const projects = new Map<string, string>();
  for (const t of raw) {
    if (t.projectGid) projects.set(t.projectGid, t.project);
  }

  res.json({
    tasks: queued.map((t) => ({
      id: t.gid,
      name: t.name,
      project: t.project,
      hours: t.hours,
      dueHour: t.dueHour,
      doubled: t.doubled,
      permalinkUrl: t.permalinkUrl,
    })),
    projects: [...projects.entries()].map(([gid, name]) => ({ gid, name })),
  });
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
    await setTaskDueAt(accessToken, gid, dueAt);
  }

  if (hours !== undefined) {
    await setTaskHours(accessToken, gid, name!, hours);
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
  const created =
    'projectGid' in parsed.data
      ? await createTaskInProject(accessToken, parsed.data.projectGid, parsed.data.name)
      : await createSubtask(accessToken, parsed.data.parentGid, parsed.data.name);
  res.status(201).json({ gid: created.gid, name: created.name });
});
