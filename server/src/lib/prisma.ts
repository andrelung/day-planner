import { PrismaClient } from '../generated/prisma/client.js';

export const prisma = new PrismaClient({
  log: [{ level: 'query', emit: 'event' }],
});

/// A short rolling window of the Prisma engine's own reported query
/// durations, each timestamped — not just the single latest one, since
/// under real concurrent load another request's query can land between a
/// caller starting its own timer and that query completing, clobbering a
/// single shared "last" value. queryEventsSince(startedAt) instead
/// returns every query the engine reported *during* a specific window,
/// letting a caller separate "the query itself was slow" from "this
/// call spent time queueing before the query even started" — the gap
/// between a caller's own wall-clock time and what shows up here.
const recentQueryEvents: { at: number; durationMs: number }[] = [];
const MAX_RECENT_EVENTS = 100;
prisma.$on('query', (e) => {
  recentQueryEvents.push({ at: Date.now(), durationMs: e.duration });
  if (recentQueryEvents.length > MAX_RECENT_EVENTS) recentQueryEvents.shift();
});

export function queryEventsSince(startedAt: number): number[] {
  return recentQueryEvents.filter((e) => e.at >= startedAt).map((e) => e.durationMs);
}

export interface PgActivityRow {
  pid: number;
  state: string | null;
  waitEventType: string | null;
  waitEvent: string | null;
  queryStart: Date | null;
  query: string;
}

/// A live snapshot of every *other* backend connected to this database
/// right now, straight from Postgres itself (pg_stat_activity) — not
/// inferred from Prisma's own client-side behavior, and not dependent on
/// Prisma's $metrics API (a preview feature Prisma has already flagged
/// for removal). Distinguishes, authoritatively: queued behind another
/// connection (another row 'active' with an old query_start) from
/// genuinely blocked on a lock (waitEventType: 'Lock') from "nothing
/// else is even happening" (rules out the DB entirely, pointing back at
/// the network/app layer instead). See dbTiming.ts's timedRead, which
/// captures this alongside a slow query.
export async function snapshotPgActivity(): Promise<PgActivityRow[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<
      { pid: number; state: string | null; wait_event_type: string | null; wait_event: string | null; query_start: Date | null; query: string }[]
    >(
      `SELECT pid, state, wait_event_type, wait_event, query_start, left(query, 200) as query
       FROM pg_stat_activity
       WHERE datname = current_database() AND pid != pg_backend_pid()
       ORDER BY query_start ASC NULLS LAST`,
    );
    return rows.map((r) => ({
      pid: r.pid,
      state: r.state,
      waitEventType: r.wait_event_type,
      waitEvent: r.wait_event,
      queryStart: r.query_start,
      query: r.query,
    }));
  } catch {
    // Diagnostic-only — a failure here must never mask the real query's
    // own result or error.
    return [];
  }
}
