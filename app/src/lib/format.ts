export function fmtHours(h: number): string {
  const r = Math.round(h * 10) / 10;
  return (r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)) + 'h';
}

/// Coarse "how long ago" for the Triage overdue badge — minutes under an
/// hour, whole hours under a day, whole days beyond that. Deliberately not
/// more granular than that: past a certain point the exact minute doesn't
/// help anyone decide what to do about an overdue task.
export function fmtElapsed(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 60) return `${Math.max(1, totalMin)}m`;
  const totalHours = Math.floor(totalMin / 60);
  if (totalHours < 24) return `${totalHours}h`;
  return `${Math.floor(totalHours / 24)}d`;
}

/// Pulls the start time out of a free-slot label ("13:00–13:30" or "Mon
/// 09:00–10:00") — shared by the store (committing a picked slot) and
/// DayCalendar (seeding the initial pending placement from the earliest
/// suggested slot).
export function slotStartTime(slot: string): string {
  const timePart = slot.includes(' ') ? slot.split(' ')[1] : slot;
  return timePart.split('–')[0];
}
