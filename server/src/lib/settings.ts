import { prisma, queryEventsSince } from './prisma.js';
import { env } from './env.js';
import { logAnomaly } from './anomalyLog.js';

/// Anything past this is worth a closer look — a single indexed lookup by
/// primary key should be single-digit milliseconds on any remotely
/// healthy Postgres.
const SLOW_READ_THRESHOLD_MS = 300;

/// Gets a user's Settings row, creating it with defaults on first access.
/// The only non-schema default here is timezone: the Prisma-level default
/// is a fixed "UTC", but a deployment can set TZ (see env.ts) so a brand
/// new user starts on the operator's actual timezone instead of UTC until
/// they change it themselves in Settings.
///
/// Reads first and only ever writes when something actually needs to
/// change — not an upsert-every-time. This function is called from
/// upwards of a dozen routes, several of which boot() fires concurrently
/// (refreshWorkload/refreshEvents/the tasks stream all start together on
/// entering Triage) — with every call doing a write, those races into a
/// single row serialize on Postgres' row lock, and one was confirmed live
/// via the timing log to cost several *seconds* even though the row
/// itself never actually changes on a returning user. A plain read has no
/// lock to contend with.
export async function getOrCreateSettings(userId: string) {
  const readStart = Date.now();
  const existing = await prisma.settings.findUnique({ where: { userId } });
  const wallMs = Date.now() - readStart;
  if (wallMs > SLOW_READ_THRESHOLD_MS) {
    // engineMs is every query the Prisma engine itself reported executing
    // during this exact window (including ones from other concurrent
    // requests) — if those durations are themselves small, the time went
    // to queueing for a pool connection before this query ever started,
    // not to Postgres actually running it.
    const engineMs = queryEventsSince(readStart);
    logAnomaly({
      area: 'getOrCreateSettings.slowRead',
      message: `findUnique took ${wallMs}ms wall-clock for a single indexed lookup`,
      userId,
      context: { wallMs, engineMs },
    });
  }
  if (existing) {
    // Backfill: a row created before TZ was configured (or before this
    // feature existed) is stuck on the Prisma-level "UTC" default forever
    // otherwise, since `create` below only ever runs once. Adopts the
    // operator's TZ for anyone still on that untouched placeholder; a user
    // who picked a zone themselves — including explicitly picking UTC —
    // is never touched again after this.
    if (env.TZ && existing.timezone === 'UTC') {
      return prisma.settings.update({ where: { userId }, data: { timezone: env.TZ } });
    }
    return existing;
  }
  try {
    return await prisma.settings.create({ data: { userId, timezone: env.TZ ?? undefined } });
  } catch (err) {
    // Lost a race with a concurrent first-ever call for this same user
    // (e.g. two tabs/devices signing in at the same moment) — the other
    // one already created the row, so read what it made instead of
    // failing on the unique constraint.
    const settledByRace = await prisma.settings.findUnique({ where: { userId } });
    if (settledByRace) return settledByRace;
    throw err;
  }
}
