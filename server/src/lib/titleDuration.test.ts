import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle, parseDurationFromTitle, titleWithDuration } from './titleDuration.js';

// These cases mirror the doc comment in asana-to-mongo-replicator's
// postprocessor.ts (getSingleTaskDurationFromName) verbatim, plus a few
// extra edge cases — the two tools must agree on every one of these or
// task titles stop meaning the same thing across both.
void test('parseDurationFromTitle', async (t) => {
  const cases: [string, number | null][] = [
    ['Task []', null],
    ['Task [1]', 1],
    ['Task [1,3]', 1.3],
    ['Task [1.3]', 1.3],
    ['Task [1/6]', 6],
    ['Task [∑5,5]', 5.5],
    ['Task [SUM]', null],
    ['Task with no bracket', null],
    ['erstes Research [0.5]', 0.5],
    ['[Client] Task [4]', 4],
    ['Task [Duplicate] [2]', 2],
  ];
  for (const [name, expected] of cases) {
    await t.test(JSON.stringify(name), () => {
      assert.equal(parseDurationFromTitle(name), expected);
    });
  }
});

void test('cleanTitle strips only the last bracket group', () => {
  assert.equal(cleanTitle('Draft outline [4]'), 'Draft outline');
  assert.equal(cleanTitle('[Client] Task [4]'), '[Client] Task');
  assert.equal(cleanTitle('No bracket here'), 'No bracket here');
  assert.equal(cleanTitle('Trailing space [4]  '), 'Trailing space');
});

void test('titleWithDuration round-trips through parseDurationFromTitle', () => {
  for (const hours of [4, 1.5, 0.5, 10]) {
    const built = titleWithDuration('Draft outline', hours);
    assert.equal(parseDurationFromTitle(built), hours);
  }
});

void test('titleWithDuration replaces an existing bracket rather than appending a second one', () => {
  const result = titleWithDuration('Draft outline [4]', 2.5);
  assert.equal(result, 'Draft outline [2.5]');
});

void test('titleWithDuration never writes the ∑ or / read-only forms', () => {
  const result = titleWithDuration('Rollup task [∑5,5]', 3);
  assert.equal(result, 'Rollup task [3]');
});
