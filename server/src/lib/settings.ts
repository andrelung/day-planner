import { prisma } from './prisma.js';
import { env } from './env.js';

/// Gets a user's Settings row, creating it with defaults on first access.
/// The only non-schema default here is timezone: the Prisma-level default
/// is a fixed "UTC", but a deployment can set TZ (see env.ts) so a brand
/// new user starts on the operator's actual timezone instead of UTC until
/// they change it themselves in Settings.
export async function getOrCreateSettings(userId: string) {
  if (env.TZ) {
    // Backfill: a Settings row created before TZ was configured (or before
    // this feature existed) is stuck on the Prisma-level "UTC" default
    // forever, since `create` below only runs once. Adopt the operator's TZ
    // for anyone still on that untouched placeholder; a user who picked a
    // zone themselves — including explicitly picking UTC — is never touched.
    await prisma.settings.updateMany({ where: { userId, timezone: 'UTC' }, data: { timezone: env.TZ } });
  }
  return prisma.settings.upsert({
    where: { userId },
    create: { userId, timezone: env.TZ ?? undefined },
    update: {},
  });
}
