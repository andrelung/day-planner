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
/// between a caller's own wall-clock time and what shows up here. Added
/// after getOrCreateSettings was confirmed live to occasionally take
/// several seconds for what should be a single indexed lookup, on a
/// production host too capable for that to plausibly be genuine query
/// execution time — see its own comment.
const recentQueryEvents: { at: number; durationMs: number }[] = [];
const MAX_RECENT_EVENTS = 100;
prisma.$on('query', (e) => {
  recentQueryEvents.push({ at: Date.now(), durationMs: e.duration });
  if (recentQueryEvents.length > MAX_RECENT_EVENTS) recentQueryEvents.shift();
});

export function queryEventsSince(startedAt: number): number[] {
  return recentQueryEvents.filter((e) => e.at >= startedAt).map((e) => e.durationMs);
}
