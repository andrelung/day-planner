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

void test('the buffer-between-tasks setting pads each busy block on both sides', () => {
  const slots = computeFreeSlots(
    DAY,
    '09:00',
    '11:00',
    15, // minutes
    [{ start: new Date('2026-08-19T09:30:00'), end: new Date('2026-08-19T10:00:00') }],
  );
  // Padded busy window becomes 09:15–10:15: the 15-min gap before it
  // (09:00–09:15) is too short for a 30-min slot, and only one clean slot
  // fits after it (10:15–10:45); the trailing 10:45–11:00 is too short too.
  assert.deepEqual(slots, ['10:15–10:45']);
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
