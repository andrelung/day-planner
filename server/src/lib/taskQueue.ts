export interface QueueableTask {
  dueAt: string | null;
  dueOn: string | null;
}

/// Applies the briefing's definition literally: "A task is unplanned if it
/// has no time assigned OR if it is doubled" (two tasks sharing the exact
/// same due timestamp). A doubled task's displayed due-hour is cleared —
/// its real Asana due_at is left untouched, this only affects how it's
/// triaged here.
///
/// A task with no due date at all doesn't belong in this queue (the
/// swipeable triage loop) — the caller is expected to have filtered those
/// out already; see "Tasks without Due Date" on the Overview screen
/// instead. Everything passed in here is assumed to have a `dueOn`.
///
/// Sorted ascending by day (`dueOn`), earliest — including overdue, which
/// naturally sorts first — leading. Within a day, undated-time tasks (no
/// due_at, or doubled — its due_at is real but untrustworthy for triage)
/// come first, followed by the day's timed tasks in time order.
export function deriveQueue<T extends QueueableTask>(tasks: T[]): (T & { doubled: boolean; dueHour: string | null })[] {
  const countByDueAt = new Map<string, number>();
  for (const t of tasks) {
    if (t.dueAt) countByDueAt.set(t.dueAt, (countByDueAt.get(t.dueAt) ?? 0) + 1);
  }

  const withDoubled = tasks
    .filter((t) => t.dueOn !== null)
    .map((t) => {
      const doubled = !!t.dueAt && (countByDueAt.get(t.dueAt) ?? 0) > 1;
      return {
        ...t,
        doubled,
        dueHour: !doubled && t.dueAt ? t.dueAt.slice(11, 16) : null,
      };
    });

  return withDoubled
    .map((t, index) => ({ t, index, hasTime: !t.doubled && !!t.dueAt }))
    .sort((a, b) => {
      if (a.t.dueOn !== b.t.dueOn) return a.t.dueOn! < b.t.dueOn! ? -1 : 1;
      if (a.hasTime !== b.hasTime) return a.hasTime ? 1 : -1;
      if (a.hasTime) return new Date(a.t.dueAt!).getTime() - new Date(b.t.dueAt!).getTime() || a.index - b.index;
      return a.index - b.index;
    })
    .map(({ t }) => t);
}
