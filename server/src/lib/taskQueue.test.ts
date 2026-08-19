import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveQueue } from './taskQueue.js';

interface Fixture {
  id: string;
  dueAt: string | null;
}

void test('a task with no due date is not doubled and sorts last', () => {
  const [result] = deriveQueue<{ dueAt: string | null }>([{ dueAt: null }]);
  assert.equal(result.doubled, false);
  assert.equal(result.dueHour, null);
});

void test('two tasks sharing the exact same due timestamp are both flagged doubled', () => {
  const dueAt = '2026-08-20T09:00:00.000Z';
  const results = deriveQueue<Fixture>([
    { id: 'a', dueAt },
    { id: 'b', dueAt },
  ]);
  assert.equal(results.every((r) => r.doubled), true);
  // Per the briefing's "unplanned if doubled" rule, a doubled task's
  // displayed due-hour is cleared even though the real due_at is untouched.
  assert.equal(results.every((r) => r.dueHour === null), true);
});

void test('two tasks with different due timestamps are not doubled', () => {
  const results = deriveQueue<Fixture>([
    { id: 'a', dueAt: '2026-08-20T09:00:00.000Z' },
    { id: 'b', dueAt: '2026-08-20T10:00:00.000Z' },
  ]);
  assert.equal(results.every((r) => r.doubled === false), true);
  assert.equal(results[0].dueHour, '09:00');
  assert.equal(results[1].dueHour, '10:00');
});

void test('queue sorts ascending by due date/time, overdue (earliest) first', () => {
  const results = deriveQueue<Fixture>([
    { id: 'later', dueAt: '2026-08-21T09:00:00.000Z' },
    { id: 'overdue', dueAt: '2026-08-01T09:00:00.000Z' },
    { id: 'soon', dueAt: '2026-08-19T09:00:00.000Z' },
  ]);
  assert.deepEqual(
    results.map((r) => r.id),
    ['overdue', 'soon', 'later'],
  );
});

void test('unplanned (no due date) and doubled tasks sort after every dated task', () => {
  const dueAt = '2026-08-20T09:00:00.000Z';
  const results = deriveQueue<Fixture>([
    { id: 'unplanned', dueAt: null },
    { id: 'dated', dueAt: '2026-08-19T09:00:00.000Z' },
    { id: 'doubled-1', dueAt },
    { id: 'doubled-2', dueAt },
  ]);
  assert.deepEqual(results[0].id, 'dated');
  assert.deepEqual(
    new Set(results.slice(1).map((r) => r.id)),
    new Set(['unplanned', 'doubled-1', 'doubled-2']),
  );
});

void test('ties (e.g. multiple unplanned tasks) preserve original order (stable sort)', () => {
  const results = deriveQueue<Fixture>([
    { id: 'first', dueAt: null },
    { id: 'second', dueAt: null },
    { id: 'third', dueAt: null },
  ]);
  assert.deepEqual(
    results.map((r) => r.id),
    ['first', 'second', 'third'],
  );
});
