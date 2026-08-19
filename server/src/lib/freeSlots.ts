export interface BusyBlock {
  start: Date;
  end: Date;
}

function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/// Computes open slots for one day within the employee's preferred working
/// hours, treating each calendar event (padded by `bufferMinutes` on both
/// sides for setup/context-switch time) as unavailable. Returned as
/// "HH:MM–HH:MM" labels chunked to `slotMinutes`, matching the UI's slot list.
export function computeFreeSlots(
  day: Date,
  prefStartTime: string,
  prefEndTime: string,
  bufferMinutes: number,
  busy: BusyBlock[],
  slotMinutes = 30,
): string[] {
  const [sh, sm] = prefStartTime.split(':').map(Number);
  const [eh, em] = prefEndTime.split(':').map(Number);
  const windowStart = new Date(day);
  windowStart.setHours(sh, sm, 0, 0);
  const windowEnd = new Date(day);
  windowEnd.setHours(eh, em, 0, 0);
  if (windowEnd <= windowStart) return [];

  const bufMs = bufferMinutes * 60_000;
  const padded = busy
    .map((b) => ({ start: new Date(b.start.getTime() - bufMs), end: new Date(b.end.getTime() + bufMs) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: BusyBlock[] = [];
  for (const b of padded) {
    const last = merged[merged.length - 1];
    if (last && b.start.getTime() <= last.end.getTime()) {
      last.end = b.end.getTime() > last.end.getTime() ? b.end : last.end;
    } else {
      merged.push({ start: b.start, end: b.end });
    }
  }

  const slots: string[] = [];
  const pushChunked = (from: Date, to: Date) => {
    let cursor = from.getTime();
    while (cursor + slotMinutes * 60_000 <= to.getTime()) {
      const chunkStart = new Date(cursor);
      const chunkEnd = new Date(cursor + slotMinutes * 60_000);
      slots.push(`${fmtTime(chunkStart)}–${fmtTime(chunkEnd)}`);
      cursor = chunkEnd.getTime();
    }
  };

  let cursor = windowStart;
  for (const b of merged) {
    if (b.start > cursor) pushChunked(cursor, b.start < windowEnd ? b.start : windowEnd);
    if (b.end > cursor) cursor = b.end;
    if (cursor >= windowEnd) break;
  }
  if (cursor < windowEnd) pushChunked(cursor, windowEnd);
  return slots;
}
