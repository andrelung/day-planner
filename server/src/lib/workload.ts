export interface WorkloadDay {
  key: string; // 'today' | 'tomorrow' | 'day2' | 'day3' | 'day4' | 'day5' | 'nextweek'
  label: string;
  /// Concrete date for 'today'..'day3' (used to query due tasks/events for
  /// that exact day); null for the aggregate 'nextweek' bucket.
  date: Date | null;
  /// Inclusive range for the 'nextweek' aggregate bucket; null otherwise.
  rangeStart: Date | null;
  rangeEnd: Date | null;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
/// Formats a Date's *local* calendar date as "YYYY-MM-DD" — every date in
/// this file is built from local getters (startOfDay/addDays) specifically
/// to represent a calendar day, not an instant, so it has to be read back
/// the same way. toISOString().slice(0, 10) converts to UTC first, which
/// silently shifts the string back a day for any timezone ahead of UTC
/// (local midnight becomes the previous day's evening in UTC) — exactly
/// the kind of "today's Outlook event shows up under tomorrow" bug this
/// exists to avoid.
export function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/// Builds the 7 workload buckets shown in Overview / Plan Later: Today,
/// Tomorrow, the next four weekdays by name, and an aggregate "Next week"
/// bucket for the week after. Weekends are skipped for the named days.
export function buildWorkloadDays(now: Date): WorkloadDay[] {
  const today = startOfDay(now);
  const namedDates: Date[] = [today];
  let cursor = today;
  while (namedDates.length < 6) {
    cursor = addDays(cursor, 1);
    if (!isWeekend(cursor)) namedDates.push(cursor);
  }

  const [d0, d1, d2, d3, d4, d5] = namedDates;
  const named = (key: string, label: string, date: Date): WorkloadDay => ({ key, label, date, rangeStart: null, rangeEnd: null });
  const days: WorkloadDay[] = [
    named('today', 'Today', d0),
    named('tomorrow', 'Tomorrow', d1),
    named('day2', d2.toLocaleDateString('en-US', { weekday: 'long' }), d2),
    named('day3', d3.toLocaleDateString('en-US', { weekday: 'long' }), d3),
    named('day4', d4.toLocaleDateString('en-US', { weekday: 'long' }), d4),
    named('day5', d5.toLocaleDateString('en-US', { weekday: 'long' }), d5),
  ];

  const nextWeekStart = addDays(d5, 1);
  const nextWeekEnd = addDays(nextWeekStart, 7);
  days.push({ key: 'nextweek', label: 'Next week', date: null, rangeStart: nextWeekStart, rangeEnd: nextWeekEnd });

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
