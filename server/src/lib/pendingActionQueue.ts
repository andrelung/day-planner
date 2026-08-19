import { prisma } from './prisma.js';
import { getValidAccessToken } from './tokens.js';
import { setTaskDueAt, setTaskHours } from '../providers/asana.js';

export type ActionPayload =
  | { kind: 'setTaskDueAt'; taskGid: string; dueAtIso: string | null; timezone: string }
  | { kind: 'setTaskHours'; taskGid: string; name: string; hours: number; timezone: string };

const MAX_ATTEMPTS = 5;

/// Backoff after a failed attempt: 5s, 10s, 20s, 40s, capped at 5min —
/// generous enough to ride out a transient Asana blip or rate limit
/// without hammering it, short enough that a real retry still lands well
/// within the session the user is actively working in.
function backoffMs(attempts: number): number {
  return Math.min(5_000 * 2 ** (attempts - 1), 5 * 60_000);
}

async function execute(userId: string, action: ActionPayload): Promise<void> {
  const accessToken = await getValidAccessToken(userId, 'ASANA');
  switch (action.kind) {
    case 'setTaskDueAt':
      await setTaskDueAt(accessToken, action.taskGid, action.dueAtIso, action.timezone);
      return;
    case 'setTaskHours':
      await setTaskHours(accessToken, action.taskGid, action.name, action.hours, action.timezone);
      return;
  }
}

/// Queues an Asana write to be performed by the background worker instead
/// of the caller having to await it directly. `label` is a plain-English
/// summary for the Settings "pending & failed actions" lookup.
export async function enqueueAction(userId: string, label: string, payload: ActionPayload): Promise<string> {
  const row = await prisma.pendingAction.create({
    data: { userId, kind: payload.kind, payload, label },
  });
  void processQueue();
  return row.id;
}

// A single in-process worker is all this needs — the app runs as one
// container (see docker-compose.yml), so there's no risk of two workers
// racing to claim the same row. `processing` just guards against this
// function's own periodic timer and its "kick after enqueue" call
// overlapping with themselves.
let processing = false;

export async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    for (;;) {
      const next = await prisma.pendingAction.findFirst({
        where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
        orderBy: { createdAt: 'asc' },
      });
      if (!next) return;
      try {
        await execute(next.userId, next.payload as ActionPayload);
        await prisma.pendingAction.update({ where: { id: next.id }, data: { status: 'DONE' } });
      } catch (err) {
        const attempts = next.attempts + 1;
        const message = err instanceof Error ? err.message : String(err);
        if (attempts >= MAX_ATTEMPTS) {
          await prisma.pendingAction.update({ where: { id: next.id }, data: { status: 'FAILED', attempts, lastError: message } });
        } else {
          await prisma.pendingAction.update({
            where: { id: next.id },
            data: { attempts, lastError: message, nextAttemptAt: new Date(Date.now() + backoffMs(attempts)) },
          });
        }
      }
    }
  } finally {
    processing = false;
  }
}

/// Catches delayed retries becoming eligible, and anything left PENDING
/// from before a server restart — enqueueAction's "kick" handles the
/// common case, this is the fallback.
export function startPendingActionWorker(): void {
  setInterval(() => void processQueue(), 10_000);
}
