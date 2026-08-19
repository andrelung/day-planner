import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFreeSlots } from './freeSlots.js';

const DAY = new Date('2026-08-19T00:00:00');

void test('an empty day (no busy blocks) yields back-to-back 30-min slots across the whole window', () => {
  const slots = computeFreeSlots(DAY, '09:00', '10:00', 0, []);
  assert.deepEqual(slots, ['09:00–09:30', '09:30–10:00']);
});

void test('a busy block removes exactly the slots it overlaps', () => {
  const slots = computeFreeSlots(DAY, '09:00', '11:00', 0, [
    { start: new Date('2026-08-19T09:30:00'), end: new Date('2026-08-19T10:00:00') },
  ]);
  assert.deepEqual(slots, ['09:00–09:30', '10:00–10:30', '10:30–11:00']);
});

void test('the buffer-between-tasks setting pads each busy block only on the trailing side (wrap-up time), not before it starts', () => {
  const slots = computeFreeSlots(
    DAY,
    '09:00',
    '11:00',
    15, // minutes
    [{ start: new Date('2026-08-19T09:30:00'), end: new Date('2026-08-19T10:00:00') }],
  );
  // Padded busy window becomes 09:30–10:15 (buffer only after the end) —
  // the leading gap (09:00–09:30) is exactly one clean 30-min slot, and one
  // more fits after the padded end (10:15–10:45); the trailing 10:45–11:00
  // is too short.
  assert.deepEqual(slots, ['09:00–09:30', '10:15–10:45']);
});

void test('two back-to-back busy blocks only get one buffer gap between them, not a doubled one', () => {
  const slots = computeFreeSlots(
    DAY,
    '09:00',
    '12:00',
    15,
    [
      { start: new Date('2026-08-19T09:00:00'), end: new Date('2026-08-19T09:30:00') },
      { start: new Date('2026-08-19T10:15:00'), end: new Date('2026-08-19T10:45:00') },
    ],
  );
  // Only the first block's trailing buffer (09:30–09:45) applies between
  // them — the second block doesn't also get a leading buffer stacked on
  // top, so the 09:45–10:15 gap is fully free (one 30-min slot).
  assert.deepEqual(slots, ['09:45–10:15', '11:00–11:30', '11:30–12:00']);
});

void test('overlapping and back-to-back busy blocks are merged before computing gaps', () => {
  const slots = computeFreeSlots(DAY, '09:00', '11:00', 0, [
    { start: new Date('2026-08-19T09:00:00'), end: new Date('2026-08-19T09:45:00') },
    { start: new Date('2026-08-19T09:30:00'), end: new Date('2026-08-19T10:00:00') }, // overlaps the first
  ]);
  assert.deepEqual(slots, ['10:00–10:30', '10:30–11:00']);
});

void test('a busy block entirely outside the working-hours window has no effect', () => {
  const slots = computeFreeSlots(DAY, '09:00', '10:00', 0, [
    { start: new Date('2026-08-19T18:00:00'), end: new Date('2026-08-19T19:00:00') },
  ]);
  assert.deepEqual(slots, ['09:00–09:30', '09:30–10:00']);
});

void test('a fully booked window yields no slots', () => {
  const slots = computeFreeSlots(DAY, '09:00', '10:00', 0, [
    { start: new Date('2026-08-19T09:00:00'), end: new Date('2026-08-19T10:00:00') },
  ]);
  assert.deepEqual(slots, []);
});

void test('an inverted or zero-length window yields no slots', () => {
  assert.deepEqual(computeFreeSlots(DAY, '10:00', '09:00', 0, []), []);
  assert.deepEqual(computeFreeSlots(DAY, '09:00', '09:00', 0, []), []);
});

void test('a trailing gap shorter than one slot is dropped, not returned as a short slot', () => {
  const slots = computeFreeSlots(DAY, '09:00', '09:45', 0, []);
  assert.deepEqual(slots, ['09:00–09:30']);
});

/// Regression test: slots must be sized to the task's actual duration, not
/// a fixed 30 minutes — a 90-minute task offered "10:10–10:40" (a 30-min
/// window) would overrun into whatever comes next.
void test('slotMinutes sizes each returned slot to the task duration being planned, not a fixed 30 minutes', () => {
  const slots = computeFreeSlots(DAY, '09:00', '13:00', 10, [], 90);
  for (const s of slots) {
    const [start, end] = s.split('–');
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    assert.equal(eh * 60 + em - (sh * 60 + sm), 90);
  }
  assert.deepEqual(slots, ['09:00–10:30', '10:30–12:00']);
});

void test('a gap shorter than the requested task duration is not offered, even though it would fit a 30-min slot', () => {
  // Free window after the buffer-padded busy block: 10:15–11:00 (45 min) —
  // too short for a 90-min task, even though a naive 30-min chunker would
  // have offered "10:15–10:45" here.
  const slots = computeFreeSlots(
    DAY,
    '09:00',
    '11:00',
    15,
    [{ start: new Date('2026-08-19T09:30:00'), end: new Date('2026-08-19T10:00:00') }],
    90,
  );
  assert.deepEqual(slots, []);
});
