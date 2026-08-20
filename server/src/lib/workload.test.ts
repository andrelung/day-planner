import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkloadDays, buildWorkloadItems, dailyCapacityHours } from './workload.js';

// workload.ts builds all its dates from local getters (getFullYear/Month/Date),
// so read them back the same way — not via toISOString(), which converts to
// UTC and would shift the date whenever the machine's timezone isn't UTC.
function ymd(d: Date | null): string | null {
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

void test('buildWorkloadDays skips the weekend when picking the next 4 named weekdays', () => {
  // 2026-08-20 is a Thursday: the next 4 weekdays after Friday should skip
  // Sat/Sun and land on Monday, Tuesday, Wednesday, Thursday.
  const days = buildWorkloadDays(new Date('2026-08-20T08:00:00'));
  assert.deepEqual(
    days.map((d) => d.key),
    ['today', 'tomorrow', 'day2', 'day3', 'day4', 'day5', 'nextweek'],
  );
  assert.equal(ymd(days[0].date), '2026-08-20'); // today (Thu)
  assert.equal(ymd(days[1].date), '2026-08-21'); // tomorrow (Fri)
  assert.equal(ymd(days[2].date), '2026-08-24'); // day2 (Mon, skipping the weekend)
  assert.equal(ymd(days[3].date), '2026-08-25'); // day3 (Tue)
  assert.equal(ymd(days[4].date), '2026-08-26'); // day4 (Wed)
  assert.equal(ymd(days[5].date), '2026-08-27'); // day5 (Thu)
  assert.equal(days[2].label, 'Monday');
  assert.equal(days[3].label, 'Tuesday');
  assert.equal(days[4].label, 'Wednesday');
  assert.equal(days[5].label, 'Thursday');
});

void test('the nextweek bucket is a 7-day range starting the day after day5, not a concrete date', () => {
  const days = buildWorkloadDays(new Date('2026-08-20T08:00:00'));
  const nextWeek = days.find((d) => d.key === 'nextweek')!;
  assert.equal(nextWeek.date, null);
  assert.equal(ymd(nextWeek.rangeStart), '2026-08-28');
  assert.equal(ymd(nextWeek.rangeEnd), '2026-09-04');
});

void test('starting from a Friday, the "tomorrow" bucket skips the weekend too and means the next workday (Monday)', () => {
  // Friday 2026-08-21 -> the weekend-skip applies to every named day,
  // "tomorrow" included, so it lands on Monday 08-24, not Saturday.
  const days = buildWorkloadDays(new Date('2026-08-21T08:00:00'));
  assert.equal(ymd(days[1].date), '2026-08-24');
  assert.equal(ymd(days[2].date), '2026-08-25');
  assert.equal(ymd(days[3].date), '2026-08-26');
});

void test('dailyCapacityHours computes decimal hours between preferred start/end time', () => {
  assert.equal(dailyCapacityHours('09:00', '18:00'), 9);
  assert.equal(dailyCapacityHours('09:00', '17:30'), 8.5);
  assert.equal(dailyCapacityHours('09:15', '17:45'), 8.5);
});

void test('dailyCapacityHours floors at 0 for an inverted or equal range rather than going negative', () => {
  assert.equal(dailyCapacityHours('18:00', '09:00'), 0);
  assert.equal(dailyCapacityHours('09:00', '09:00'), 0);
});

void test('buildWorkloadItems excludes a task linked to a calendar event, counting the event once instead of twice', () => {
  const items = buildWorkloadItems(
    [{ gid: 'task-1', dueAt: '2026-08-20T14:00:00.000Z', hours: 1 }],
    [{ start: new Date('2026-08-20T14:00:00.000Z'), end: new Date('2026-08-20T15:00:00.000Z') }],
    new Set(['task-1']),
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].hours, 1);
});

void test('buildWorkloadItems counts an unlinked task alongside an unrelated event — no false exclusion', () => {
  const items = buildWorkloadItems(
    [{ gid: 'task-1', dueAt: '2026-08-20T09:00:00.000Z', hours: 1 }],
    [{ start: new Date('2026-08-20T14:00:00.000Z'), end: new Date('2026-08-20T15:00:00.000Z') }],
    new Set(), // nothing linked
  );
  assert.equal(items.length, 2);
  assert.equal(
    items.reduce((sum, i) => sum + i.hours, 0),
    2,
  );
});

void test('buildWorkloadItems skips tasks with no due date regardless of linking', () => {
  const items = buildWorkloadItems([{ gid: 'task-1', dueAt: null, hours: 3 }], [], new Set(['task-1']));
  assert.equal(items.length, 0);
});
