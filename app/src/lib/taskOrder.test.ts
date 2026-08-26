import { describe, expect, it } from 'vitest';
import { sortedQueueOrder } from './taskOrder';

/// Matches the server's own deriveQueue tests (server/src/lib/taskQueue.test.ts)
/// on purpose — the two orderings have to agree, or a locally-mutated list
/// and a freshly-fetched one disagree about where a task belongs.
const t = (id: string, dueOn: string | null, dueAt: string | null = null) => ({ id, dueOn, dueAt });
const ids = (list: { id: string }[]) => list.map((x) => x.id);

describe('sortedQueueOrder', () => {
  it('orders by day, earliest (including overdue) first', () => {
    const out = sortedQueueOrder([t('c', '2026-08-28'), t('a', '2026-08-24'), t('b', '2026-08-26')]);
    expect(ids(out)).toEqual(['a', 'b', 'c']);
  });

  it('puts a day’s date-only tasks before its timed ones', () => {
    const out = sortedQueueOrder([
      t('timed', '2026-08-26', '2026-08-26T09:00:00.000Z'),
      t('dateOnly', '2026-08-26'),
    ]);
    expect(ids(out)).toEqual(['dateOnly', 'timed']);
  });

  it('orders a day’s timed tasks by time', () => {
    const out = sortedQueueOrder([
      t('late', '2026-08-26', '2026-08-26T15:00:00.000Z'),
      t('early', '2026-08-26', '2026-08-26T09:00:00.000Z'),
    ]);
    expect(ids(out)).toEqual(['early', 'late']);
  });

  it('is stable for tasks that tie completely', () => {
    const out = sortedQueueOrder([
      t('first', '2026-08-26', '2026-08-26T09:00:00.000Z'),
      t('second', '2026-08-26', '2026-08-26T09:00:00.000Z'),
    ]);
    expect(ids(out)).toEqual(['first', 'second']);
  });

  it('sinks tasks with no due date to the end rather than dropping them', () => {
    // deriveQueue filters these out server-side; here they can legitimately
    // appear mid-list (a due date cleared in Asana and picked up by
    // refreshVisibleTasks) and must end up contiguous, not interleaved —
    // they all share the same empty day label.
    const out = sortedQueueOrder([t('none1', null), t('due', '2026-08-26'), t('none2', null)]);
    expect(ids(out)).toEqual(['due', 'none1', 'none2']);
  });

  it('regroups a list a local mutation left out of order', () => {
    // The exact shape that used to produce two "Tomorrow" day headers in
    // Triage's Up next — and with them a duplicate key, a thrown render and
    // a permanently frozen screen. See sortedQueueOrder's own comment.
    const out = sortedQueueOrder([
      t('tomorrowA', '2026-08-27'),
      t('friday', '2026-08-28'),
      t('tomorrowB', '2026-08-27'), // re-appended by an optimistic local update
    ]);
    expect(ids(out)).toEqual(['tomorrowA', 'tomorrowB', 'friday']);

    // What Up next actually depends on: each day forms exactly one
    // contiguous run, so its "new day?" header dedup can't emit a label twice.
    const days = out.map((x) => x.dueOn);
    expect(new Set(days).size).toBe(days.filter((d, i) => d !== days[i - 1]).length);
  });
});
