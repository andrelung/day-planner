export interface QueueableTask {
  dueAt: string | null;
  dueOn: string | null;
}

/// A task with no due date at all doesn't belong in this queue (the
/// swipeable triage loop) — the caller is expected to have filtered those
/// out already; see "Tasks without Due Date" on the Overview screen
/// instead. Everything passed in here is assumed to have a `dueOn`.
///
/// Sorted ascending by day (`dueOn`), earliest — including overdue, which
/// naturally sorts first — leading. Within a day, date-only tasks (no
/// due_at at all) come first, followed by the day's timed tasks in time
/// order.
///
/// Two tasks can genuinely share the exact same due_at — no special
/// handling for that here: each keeps its own real time and sorts by it
/// like any other timed task (a stable tie on index order). This used to
/// flag such a pair "doubled" and hide both their times behind an
/// "Unplanned" label, on the theory that an identical instant was probably
/// a data artifact rather than a real intentional double-booking — but the
/// calendar already renders genuinely overlapping tasks side by side
/// rather than hiding either one, and hiding a real, correct due time here
/// caused more confusion than the thing it was meant to prevent (a
/// same-time task reading as "Unplanned" instead of overdue).
export function deriveQueue<T extends QueueableTask>(tasks: T[]): T[] {
  return tasks
    .filter((t) => t.dueOn !== null)
    .map((t, index) => ({ t, index, hasTime: !!t.dueAt }))
    .sort((a, b) => {
      if (a.t.dueOn !== b.t.dueOn) return a.t.dueOn! < b.t.dueOn! ? -1 : 1;
      if (a.hasTime !== b.hasTime) return a.hasTime ? 1 : -1;
      if (a.hasTime) return new Date(a.t.dueAt!).getTime() - new Date(b.t.dueAt!).getTime() || a.index - b.index;
      return a.index - b.index;
    })
    .map(({ t }) => t);
}
