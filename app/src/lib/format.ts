export function fmtHours(h: number): string {
  const r = Math.round(h * 10) / 10;
  return (r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)) + 'h';
}

/// Pulls the start time out of a free-slot label ("13:00–13:30" or "Mon
/// 09:00–10:00") — shared by the store (committing a picked slot) and
/// DayCalendar (seeding the initial pending placement from the earliest
/// suggested slot).
export function slotStartTime(slot: string): string {
  const timePart = slot.includes(' ') ? slot.split(' ')[1] : slot;
  return timePart.split('–')[0];
}
