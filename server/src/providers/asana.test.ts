import test from 'node:test';
import assert from 'node:assert/strict';

// Same reason as crypto.test.ts: env.ts validates process.env at import
// time, so these need setting before the (dynamic) import below.
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db';
process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.SESSION_JWT_SECRET ??= 'test-secret';
process.env.PUBLIC_APP_URL ??= 'http://localhost:3000';

const { listIncompleteAssignedTasks } = await import('./asana.js');

interface Call {
  url: string;
}

/// A regression test for a real production bug: a workspace with enough
/// incomplete tasks assigned to the user made Asana reject the single-page
/// /tasks request with "The result is too large. You should use
/// pagination" (HTTP 400) — listIncompleteAssignedTasks wasn't following
/// Asana's cursor-based pagination (`next_page.uri`) at all.
void test('listIncompleteAssignedTasks follows next_page.uri across multiple pages', async () => {
  const calls: Call[] = [];
  const originalFetch = global.fetch;

  global.fetch = (async (url: string) => {
    calls.push({ url: String(url) });

    if (String(url).includes('/users/me')) {
      return jsonResponse({ data: { workspaces: [{ gid: 'ws1', name: 'Workspace 1' }] } });
    }

    if (String(url).includes('/tasks') && !String(url).includes('offset=')) {
      // First page: exactly `limit=100` worth, with a next_page pointing at
      // the second page — this is the shape that previously got dropped.
      return jsonResponse({
        data: [{ gid: 't1', name: 'Task one', due_on: null, due_at: null, permalink_url: 'https://x/1', projects: [] }],
        next_page: { offset: 'abc', path: '/tasks?offset=abc', uri: 'https://app.asana.com/api/1.0/tasks?offset=abc' },
      });
    }

    if (String(url).includes('offset=abc')) {
      return jsonResponse({
        data: [{ gid: 't2', name: 'Task two', due_on: null, due_at: null, permalink_url: 'https://x/2', projects: [] }],
        next_page: null,
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const tasks = await listIncompleteAssignedTasks('fake-token');
    assert.deepEqual(
      tasks.map((t) => t.gid),
      ['t1', 't2'],
    );
    // Confirms it actually followed the second page rather than just
    // guessing/duplicating — exactly 3 requests: workspaces, page 1, page 2.
    assert.equal(calls.length, 3);
    assert.equal(calls[1].url.includes('limit=100'), true);
  } finally {
    global.fetch = originalFetch;
  }
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
