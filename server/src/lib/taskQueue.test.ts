import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveQueue } from './taskQueue.js';

interface Fixture {
  id: string;
  dueAt: string | null;
  dueOn: string | null;
}

void test('a task with no due date at all is excluded from the queue', () => {
  const results = deriveQueue<Fixture>([{ id: 'undated', dueAt: null, dueOn: null }]);
  assert.deepEqual(results, []);
});

void test('a task with a due date but no due time is not doubled and keeps a null dueHour', () => {
  const [result] = deriveQueue<Fixture>([{ id: 'date-only', dueAt: null, dueOn: '2026-08-20' }]);
  assert.equal(result.doubled, false);
  assert.equal(result.dueHour, null);
});

void test('two tasks sharing the exact same due timestamp are both flagged doubled', () => {
  const dueAt = '2026-08-20T09:00:00.000Z';
  const results = deriveQueue<Fixture>([
    { id: 'a', dueAt, dueOn: '2026-08-20' },
    { id: 'b', dueAt, dueOn: '2026-08-20' },
  ]);
  assert.equal(results.every((r) => r.doubled), true);
  // Per the briefing's "unplanned if doubled" rule, a doubled task's
  // displayed due-hour is cleared even though the real due_at is untouched.
  assert.equal(results.every((r) => r.dueHour === null), true);
});

void test('two tasks with different due timestamps are not doubled', () => {
  const results = deriveQueue<Fixture>([
    { id: 'a', dueAt: '2026-08-20T09:00:00.000Z', dueOn: '2026-08-20' },
    { id: 'b', dueAt: '2026-08-20T10:00:00.000Z', dueOn: '2026-08-20' },
  ]);
  assert.equal(results.every((r) => r.doubled === false), true);
  assert.equal(results[0].dueHour, '09:00');
  assert.equal(results[1].dueHour, '10:00');
});

void test('queue sorts ascending by day, overdue (earliest) first', () => {
  const results = deriveQueue<Fixture>([
    { id: 'later', dueAt: '2026-08-21T09:00:00.000Z', dueOn: '2026-08-21' },
    { id: 'overdue', dueAt: '2026-08-01T09:00:00.000Z', dueOn: '2026-08-01' },
    { id: 'soon', dueAt: '2026-08-19T09:00:00.000Z', dueOn: '2026-08-19' },
  ]);
  assert.deepEqual(
    results.map((r) => r.id),
    ['overdue', 'soon', 'later'],
  );
});

void test('within a day, the due-date-but-no-time task leads, then timed tasks in time order', () => {
  const results = deriveQueue<Fixture>([
    { id: 'timed-late', dueAt: '2026-08-20T14:00:00.000Z', dueOn: '2026-08-20' },
    { id: 'timed-early', dueAt: '2026-08-20T09:00:00.000Z', dueOn: '2026-08-20' },
    { id: 'date-only', dueAt: null, dueOn: '2026-08-20' },
  ]);
  assert.deepEqual(
    results.map((r) => r.id),
    ['date-only', 'timed-early', 'timed-late'],
  );
});

void test('a doubled task is treated like a date-only task for sorting — leads its day, not pushed to the very end', () => {
  const dueAt = '2026-08-20T09:00:00.000Z';
  const results = deriveQueue<Fixture>([
    { id: 'timed', dueAt: '2026-08-20T15:00:00.000Z', dueOn: '2026-08-20' },
    { id: 'doubled-1', dueAt, dueOn: '2026-08-20' },
    { id: 'doubled-2', dueAt, dueOn: '2026-08-20' },
  ]);
  assert.deepEqual(results[2].id, 'timed');
  assert.deepEqual(
    new Set(results.slice(0, 2).map((r) => r.id)),
    new Set(['doubled-1', 'doubled-2']),
  );
});

void test('ties (e.g. multiple date-only tasks on the same day) preserve original order (stable sort)', () => {
  const results = deriveQueue<Fixture>([
    { id: 'first', dueAt: null, dueOn: '2026-08-20' },
    { id: 'second', dueAt: null, dueOn: '2026-08-20' },
    { id: 'third', dueAt: null, dueOn: '2026-08-20' },
  ]);
  assert.deepEqual(
    results.map((r) => r.id),
    ['first', 'second', 'third'],
  );
});
