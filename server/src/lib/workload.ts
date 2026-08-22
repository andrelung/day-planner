import { addDaysToDateStr, dateStrInTz, weekdayNameOfDateStr, weekdayOfDateStr, zonedMidnightUtc } from './tz.js';

export interface WorkloadDay {
  key: string; // 'today' | 'tomorrow' | 'day2' | 'day3' | 'day4' | 'day5' | 'nextweek'
  label: string;
  /// Concrete date for 'today'..'day3' (used to query due tasks/events for
  /// that exact day); null for the aggregate 'nextweek' bucket. Always the
  /// UTC instant of local midnight *in the caller's timezone* (see
  /// zonedMidnightUtc) — read back with toLocalDateStr passing that same
  /// timezone, not local getters.
  date: Date | null;
  /// Inclusive range for the 'nextweek' aggregate bucket; null otherwise.
  rangeStart: Date | null;
  rangeEnd: Date | null;
}

/// Formats a Date previously built by this file (zonedMidnightUtc) back to
/// "YYYY-MM-DD" — `timeZone` must be the same zone it was built with, or
/// this silently reads back the wrong calendar day. Kept as a named export
/// (rather than callers reaching for dateStrInTz directly) so every caller
/// of this file's own dates is visibly paired with this file's own
/// contract.
export function toLocalDateStr(d: Date, timeZone: string): string {
  return dateStrInTz(d, timeZone);
}
function isWeekendStr(dateStr: string): boolean {
  const day = weekdayOfDateStr(dateStr);
  return day === 0 || day === 6;
}

/// Builds the 7 workload buckets shown in Overview / Plan Later: Today,
/// Tomorrow, the next four weekdays by name, and an aggregate "Next week"
/// bucket for the week after. Weekends are skipped for the named days.
/// Every date is anchored to `timeZone` (the acting user's own configured
/// Settings.timezone) — not the server process's ambient clock, which can
/// silently differ from the user's own zone (most obviously while
/// traveling), causing "today"/"tomorrow" here to disagree with what a
/// task's own (Asana-assigned, genuinely timezone-independent) due date
/// actually is.
export function buildWorkloadDays(now: Date, timeZone: string): WorkloadDay[] {
  const todayStr = dateStrInTz(now, timeZone);
  const namedDateStrs: string[] = [todayStr];
  let cursor = todayStr;
  while (namedDateStrs.length < 6) {
    cursor = addDaysToDateStr(cursor, 1);
    if (!isWeekendStr(cursor)) namedDateStrs.push(cursor);
  }

  const [s0, s1, s2, s3, s4, s5] = namedDateStrs;
  const toInstant = (s: string) => zonedMidnightUtc(s, timeZone);
  const named = (key: string, label: string, dateStr: string): WorkloadDay => ({
    key,
    label,
    date: toInstant(dateStr),
    rangeStart: null,
    rangeEnd: null,
  });
  // "Tomorrow" only actually means tomorrow when today isn't a Friday — the
  // weekend-skip above otherwise lands this bucket on Monday while still
  // calling it "Tomorrow", which reads as flatly wrong (Monday isn't
  // tomorrow from a Friday, whatever this bucket's own reasoning is).
  // Falls back to the real weekday name, same as day2..day5 below.
  const tomorrowLabel = s1 === addDaysToDateStr(s0, 1) ? 'Tomorrow' : weekdayNameOfDateStr(s1);
  const days: WorkloadDay[] = [
    named('today', 'Today', s0),
    named('tomorrow', tomorrowLabel, s1),
    named('day2', weekdayNameOfDateStr(s2), s2),
    named('day3', weekdayNameOfDateStr(s3), s3),
    named('day4', weekdayNameOfDateStr(s4), s4),
    named('day5', weekdayNameOfDateStr(s5), s5),
  ];

  const nextWeekStartStr = addDaysToDateStr(s5, 1);
  const nextWeekEndStr = addDaysToDateStr(nextWeekStartStr, 7);
  days.push({ key: 'nextweek', label: 'Next week', date: null, rangeStart: toInstant(nextWeekStartStr), rangeEnd: toInstant(nextWeekEndStr) });

  return days;
}

/// Daily capacity from preferred working hours (decimal hours).
export function dailyCapacityHours(prefStartTime: string, prefEndTime: string): number {
  const [sh, sm] = prefStartTime.split(':').map(Number);
  const [eh, em] = prefEndTime.split(':').map(Number);
  const minutes = eh * 60 + em - (sh * 60 + sm);
  return Math.max(0, minutes / 60);
}

/// Flattens timed tasks and calendar events into one pool of "planned hours"
/// items for buildWorkloadDays' buckets to sum. A task linked to a calendar
/// event (see CalendarEventLink) represents the same block of time as that
/// event — the event's own duration is already an item below, so counting
/// the linked task's hours too would double-count that slot. Excluded tasks
/// still show up everywhere else in the app (Triage, the day calendar) —
/// this only affects the "how full is this day" tally.
export function buildWorkloadItems(
  tasks: { dueAt: string | null; hours: number; gid: string }[],
  events: { start: Date; end: Date }[],
  linkedTaskGids: Set<string>,
): { start: Date; hours: number }[] {
  const items: { start: Date; hours: number }[] = [];
  for (const t of tasks) {
    if (t.dueAt && !linkedTaskGids.has(t.gid)) items.push({ start: new Date(t.dueAt), hours: t.hours });
  }
  for (const e of events) {
    items.push({ start: e.start, hours: (e.end.getTime() - e.start.getTime()) / 3_600_000 });
  }
  return items;
}
