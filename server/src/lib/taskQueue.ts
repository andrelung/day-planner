export interface QueueableTask {
  dueAt: string | null;
}

/// Applies the briefing's definition literally: "A task is unplanned if it
/// has no time assigned OR if it is doubled" (two tasks sharing the exact
/// same due timestamp). A doubled task's displayed due-hour is cleared —
/// its real Asana due_at is left untouched, this only affects how it's
/// triaged here — and the queue is sorted ascending by effective due
/// date/time, earliest (including overdue, which naturally sorts first)
/// leading, unplanned/doubled tasks last.
export function deriveQueue<T extends QueueableTask>(tasks: T[]): (T & { doubled: boolean; dueHour: string | null })[] {
  const countByDueAt = new Map<string, number>();
  for (const t of tasks) {
    if (t.dueAt) countByDueAt.set(t.dueAt, (countByDueAt.get(t.dueAt) ?? 0) + 1);
  }

  const withDoubled = tasks.map((t) => {
    const doubled = !!t.dueAt && (countByDueAt.get(t.dueAt) ?? 0) > 1;
    return {
      ...t,
      doubled,
      dueHour: !doubled && t.dueAt ? t.dueAt.slice(11, 16) : null,
    };
  });

  return withDoubled
    .map((t, index) => ({ t, index, sortKey: !t.doubled && t.dueAt ? new Date(t.dueAt).getTime() : Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.sortKey - b.sortKey || a.index - b.index)
    .map(({ t }) => t);
}
