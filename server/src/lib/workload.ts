export interface WorkloadDay {
  key: string; // 'today' | 'tomorrow' | 'day2' | 'day3' | 'nextweek'
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
function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/// Builds the 5 workload buckets shown in Overview / Plan Later: Today,
/// Tomorrow, the next two weekdays by name, and an aggregate "Next week"
/// bucket for the week after. Weekends are skipped for the named days.
export function buildWorkloadDays(now: Date): WorkloadDay[] {
  const today = startOfDay(now);
  const namedDates: Date[] = [today];
  let cursor = today;
  while (namedDates.length < 4) {
    cursor = addDays(cursor, 1);
    if (!isWeekend(cursor)) namedDates.push(cursor);
  }

  const [d0, d1, d2, d3] = namedDates;
  const days: WorkloadDay[] = [
    { key: 'today', label: 'Today', date: d0, rangeStart: null, rangeEnd: null },
    { key: 'tomorrow', label: 'Tomorrow', date: d1, rangeStart: null, rangeEnd: null },
    { key: 'day2', label: d2.toLocaleDateString('en-US', { weekday: 'long' }), date: d2, rangeStart: null, rangeEnd: null },
    { key: 'day3', label: d3.toLocaleDateString('en-US', { weekday: 'long' }), date: d3, rangeStart: null, rangeEnd: null },
  ];

  const nextWeekStart = addDays(d3, 1);
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
