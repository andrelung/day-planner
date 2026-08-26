/// Mirrors the server's deriveQueue (server/src/lib/taskQueue.ts) exactly —
/// ascending by day, date-only tasks before that day's timed ones, timed
/// ones in time order. Every payload from the server already arrives in
/// this order, so nothing used to re-establish it client-side; but the
/// optimistic local updates in store.svelte.ts (setTaskDueDateLocally and
/// the two restore variants) rewrite a task's due date and then splice it onto
/// the *end* (or front) of the array, which silently leaves `tasks` in an order
/// no longer matching its own due dates.
///
/// That isn't cosmetic. Triage's "Up next" emits a day header whenever a
/// row's day label differs from the row above it — a correct dedup only
/// while the list is genuinely grouped by day. Out of order, the same day
/// can start a second run further down, producing two headers with the
/// same key in a keyed {#each} — which Svelte treats as a hard error
/// (each_key_duplicate) thrown mid-render, aborting the whole update batch.
/// The store keeps advancing, the DOM never does: the screen freezes with
/// its old content while its buttons keep firing handlers against state
/// that has already moved on, permanently, until a reload. That is the
/// "stuck screen" symptom, and re-sorting here is its actual fix — the
/// unique-key change in Triage.svelte and the error boundary in App.svelte
/// are the two backstops behind it, not substitutes for it.
export function sortedQueueOrder<T extends { dueOn: string | null; dueAt: string | null }>(tasks: T[]): T[] {
  return tasks
    .map((t, index) => ({ t, index, hasTime: !!t.dueAt }))
    .sort((a, b) => {
      if (a.t.dueOn !== b.t.dueOn) {
        if (!a.t.dueOn) return 1;
        if (!b.t.dueOn) return -1;
        return a.t.dueOn < b.t.dueOn ? -1 : 1;
      }
      if (a.hasTime !== b.hasTime) return a.hasTime ? 1 : -1;
      if (a.hasTime) return new Date(a.t.dueAt!).getTime() - new Date(b.t.dueAt!).getTime() || a.index - b.index;
      return a.index - b.index;
    })
    .map(({ t }) => t);
}
