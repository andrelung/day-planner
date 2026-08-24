import { queryEventsSince, snapshotPgActivity } from './prisma.js';
import { logAnomaly } from './anomalyLog.js';

/// Anything past this is worth a closer look — a single indexed lookup by
/// primary key should be single-digit milliseconds on any remotely
/// healthy Postgres.
const SLOW_READ_THRESHOLD_MS = 300;

/// Wraps a single DB read, logging a detailed anomaly if it takes longer
/// than a plain indexed lookup ever should. `area` names the call site
/// (e.g. "getOrCreateSettings.read") so a specific slow spot is grep-able
/// directly. Three independent signals go into the log entry, together
/// meant to make the actual cause unambiguous rather than another round
/// of guessing:
/// - wallMs: what the caller actually experienced.
/// - engineMs: every query Prisma's own engine reported executing during
///   this exact window (including other concurrent requests' queries) —
///   small values here despite a large wallMs mean the delay was queueing
///   for a pool connection, before the query ever started.
/// - pgActivity: a live snapshot of every other Postgres backend at the
///   moment this was flagged slow (see prisma.ts's snapshotPgActivity) —
///   reveals a genuine lock wait or real contention straight from the
///   database, or rules the database out entirely if nothing else shows
///   up there at all.
export async function timedRead<T>(area: string, userId: string | undefined, run: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const result = await run();
  const wallMs = Date.now() - start;
  if (wallMs > SLOW_READ_THRESHOLD_MS) {
    const engineMs = queryEventsSince(start);
    const pgActivity = await snapshotPgActivity();
    logAnomaly({
      area,
      message: `Took ${wallMs}ms wall-clock for what should be a fast, single-row query`,
      userId,
      context: { wallMs, engineMs, pgActivity },
    });
  }
  return result;
}
