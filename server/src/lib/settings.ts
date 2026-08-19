import { prisma } from './prisma.js';
import { env } from './env.js';

/// Gets a user's Settings row, creating it with defaults on first access.
/// The only non-schema default here is timezone: the Prisma-level default
/// is a fixed "UTC", but a deployment can set TZ (see env.ts) so a brand
/// new user starts on the operator's actual timezone instead of UTC until
/// they change it themselves in Settings.
export function getOrCreateSettings(userId: string) {
  return prisma.settings.upsert({
    where: { userId },
    create: { userId, timezone: env.TZ ?? undefined },
    update: {},
  });
}
