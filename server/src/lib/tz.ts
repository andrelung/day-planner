/// Every "what day is it" / "what day does this instant fall on" decision
/// in this app is supposed to run in the *acting user's* configured
/// Settings.timezone — never the server process's own ambient clock, which
/// can silently differ from any given user's zone (most obviously while
/// they're traveling). This is the one place that talks to `Intl` directly
/// for that; every other call site building/reading a calendar date should
/// go through these functions instead of `new Date()` + local getters.
///
/// Calendar-date *arithmetic* (add N days, weekday-of, weekday name) is
/// deliberately kept timezone-independent below — "2026-08-22 plus one day"
/// is an unambiguous fact regardless of zone, so those helpers anchor to
/// UTC purely as a neutral arithmetic space, never a real instant. Only
/// converting between a real instant (an Asana due_at, "now") and a
/// calendar-date string genuinely needs the target zone.

function partsInTz(instant: Date, timeZone: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) out[p.type] = p.value;
  return out;
}

/// "YYYY-MM-DD" for `instant`, as read on a wall clock in `timeZone`.
export function dateStrInTz(instant: Date, timeZone: string): string {
  const p = partsInTz(instant, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/// { h, m } for `instant`, as read on a wall clock in `timeZone`.
export function hmInTz(instant: Date, timeZone: string): { h: number; m: number } {
  const p = partsInTz(instant, timeZone);
  return { h: Number(p.hour), m: Number(p.minute) };
}

/// The UTC instant of local midnight (00:00:00) on `dateStr` ("YYYY-MM-DD")
/// in `timeZone` — for building day-boundary windows to compare other
/// instants against (e.g. "does this task's due_at fall within today").
/// Standard round-trip-through-Intl technique: guess the instant assuming
/// UTC, check what wall-clock time that guess actually reads as in the
/// target zone, then correct by however far off the guess was.
export function zonedMidnightUtc(dateStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const p = partsInTz(new Date(guess), timeZone);
  const asZoned = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return new Date(guess - (asZoned - guess));
}

/// Adds `n` days to a "YYYY-MM-DD" string — timezone-independent, see the
/// module comment above.
export function addDaysToDateStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/// 0 (Sunday) .. 6 (Saturday) for a "YYYY-MM-DD" string.
export function weekdayOfDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/// Full weekday name ("Monday") for a "YYYY-MM-DD" string.
export function weekdayNameOfDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}
