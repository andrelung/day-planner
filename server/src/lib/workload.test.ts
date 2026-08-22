import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkloadDays, buildWorkloadItems, dailyCapacityHours, toLocalDateStr } from './workload.js';

// Every test below fixes the timezone explicitly (rather than relying on
// process.env.TZ) — the whole point of buildWorkloadDays taking a timezone
// parameter is that its output no longer depends on which zone the server
// process happens to be running in, so the tests should prove that by not
// depending on it either. 'now' is given as a bare UTC instant (via 'Z')
// for the same reason — a local-time string like '2026-08-20T08:00:00'
// would itself be interpreted in the test runner's own local zone.
const TZ = 'Europe/Berlin';
function ymd(d: Date | null): string | null {
  return d ? toLocalDateStr(d, TZ) : null;
}

void test('buildWorkloadDays skips the weekend when picking the next 4 named weekdays', () => {
  // 2026-08-20 is a Thursday: the next 4 weekdays after Friday should skip
  // Sat/Sun and land on Monday, Tuesday, Wednesday, Thursday.
  const days = buildWorkloadDays(new Date('2026-08-20T08:00:00Z'), TZ);
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
  const days = buildWorkloadDays(new Date('2026-08-20T08:00:00Z'), TZ);
  const nextWeek = days.find((d) => d.key === 'nextweek')!;
  assert.equal(nextWeek.date, null);
  assert.equal(ymd(nextWeek.rangeStart), '2026-08-28');
  assert.equal(ymd(nextWeek.rangeEnd), '2026-09-04');
});

void test('starting from a Friday, the "tomorrow" bucket skips the weekend too and means the next workday (Monday)', () => {
  // Friday 2026-08-21 -> the weekend-skip applies to every named day,
  // "tomorrow" included, so it lands on Monday 08-24, not Saturday.
  const days = buildWorkloadDays(new Date('2026-08-21T08:00:00Z'), TZ);
  assert.equal(ymd(days[1].date), '2026-08-24');
  assert.equal(ymd(days[2].date), '2026-08-25');
  assert.equal(ymd(days[3].date), '2026-08-26');
});

void test('the "tomorrow" bucket is labeled "Tomorrow" only when it\'s literally the next calendar day', () => {
  // Thursday: tomorrow (Friday) is a real weekday, no skip involved.
  const thursday = buildWorkloadDays(new Date('2026-08-20T08:00:00Z'), TZ);
  assert.equal(thursday[1].label, 'Tomorrow');

  // Friday: the weekend-skip lands "tomorrow" on Monday — labeling that
  // "Tomorrow" reads as flatly wrong (Monday isn't tomorrow from a
  // Friday), so it should read "Monday" instead, same as day2..day5 use
  // real weekday names.
  const friday = buildWorkloadDays(new Date('2026-08-21T08:00:00Z'), TZ);
  assert.equal(friday[1].label, 'Monday');
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

void test('toLocalDateStr reads back a zoned-midnight Date without shifting it through UTC', () => {
  // Regression test for the "tomorrow's free-slots/Outlook events actually
  // show today's" bug: /api/workload used to serialize each bucket's date
  // via toISOString().slice(0, 10), which converts to UTC first — for any
  // timezone ahead of UTC, local midnight is still the previous day in
  // UTC, so the string silently came out one day early. buildWorkloadDays'
  // own dates are all zoned-midnight instants (see zonedMidnightUtc), so
  // reading them back with the same timezone has to round-trip exactly.
  const days = buildWorkloadDays(new Date('2026-08-20T08:00:00Z'), TZ);
  assert.equal(toLocalDateStr(days[0].date!, TZ), '2026-08-20'); // today
  assert.equal(toLocalDateStr(days[1].date!, TZ), '2026-08-21'); // tomorrow
});

void test("buildWorkloadDays follows the passed timezone, not the server process's own clock — regression for the traveling-user bug", () => {
  // 2026-08-20T23:30:00Z is already 2026-08-21 in Europe/Berlin (UTC+2 in
  // August) but still 2026-08-20 in America/Los_Angeles (UTC-7) — the exact
  // shape of the real bug report: a user's configured Settings.timezone
  // disagreeing with whatever zone the server process's own ambient clock
  // happens to be in produced a genuinely different "today", not just a
  // display glitch. Same instant, both zones, different calendar day out.
  const instant = new Date('2026-08-20T23:30:00Z');
  const berlin = buildWorkloadDays(instant, 'Europe/Berlin');
  const losAngeles = buildWorkloadDays(instant, 'America/Los_Angeles');
  assert.equal(toLocalDateStr(berlin[0].date!, 'Europe/Berlin'), '2026-08-21');
  assert.equal(toLocalDateStr(losAngeles[0].date!, 'America/Los_Angeles'), '2026-08-20');
});
