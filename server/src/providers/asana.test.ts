import test from 'node:test';
import assert from 'node:assert/strict';

// Same reason as crypto.test.ts: env.ts validates process.env at import
// time, so these need setting before the (dynamic) import below.
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db';
process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.SESSION_JWT_SECRET ??= 'test-secret';
process.env.PUBLIC_APP_URL ??= 'http://localhost:3000';

const { listIncompleteAssignedTasks, listWorkspaces } = await import('./asana.js');

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
    const tasks = await listIncompleteAssignedTasks('fake-token-pagination');
    assert.deepEqual(
      tasks.map((t) => t.gid),
      ['t1', 't2'],
    );
    // Confirms it actually followed the second page rather than just
    // guessing/duplicating — exactly 4 requests: workspaces, the near-term
    // search pass (this mock happens to answer it with the same page-1
    // fixture — deduped against below, hence still just ['t1', 't2']),
    // page 1, page 2.
    assert.equal(calls.length, 4);
    assert.equal(calls[1].url.includes('limit=100'), true);
  } finally {
    global.fetch = originalFetch;
  }
});

/// Subtasks don't carry `projects` themselves — only an ancestor task does.
/// `withBreadcrumbs` should resolve the project through the parent chain:
/// one hop for free (parent.projects.* requested in the same list call),
/// and a live lookup for a deeper hop (grandparent).
void test('listIncompleteAssignedTasks resolves subtask project via the parent chain when withBreadcrumbs is set', async () => {
  const originalFetch = global.fetch;

  global.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/users/me')) {
      return jsonResponse({ data: { workspaces: [{ gid: 'ws1', name: 'Workspace 1' }] } });
    }
    if (u.includes('/tasks?assignee=me')) {
      return jsonResponse({
        data: [
          // one-hop case: parent.projects.* comes back on the list call itself.
          {
            gid: 'sub1',
            name: 'Subtask one',
            due_on: null,
            due_at: null,
            permalink_url: 'https://x/sub1',
            projects: [],
            parent: { gid: 'parent1', name: 'Parent task', projects: [{ gid: 'p1', name: 'Project One' }] },
          },
          // two-hop case: parent has no project of its own, needs a live
          // lookup of the grandparent.
          {
            gid: 'sub2',
            name: 'Subtask two',
            due_on: null,
            due_at: null,
            permalink_url: 'https://x/sub2',
            projects: [],
            parent: { gid: 'parent2', name: 'Parent two', projects: [] },
          },
        ],
        next_page: null,
      });
    }
    if (u.includes('/tasks/parent2')) {
      return jsonResponse({ data: { gid: 'parent2', name: 'Parent two', projects: [], parent: { gid: 'grandparent2', name: 'Grandparent two' } } });
    }
    if (u.includes('/tasks/grandparent2')) {
      return jsonResponse({ data: { gid: 'grandparent2', name: 'Grandparent two', projects: [{ gid: 'p2', name: 'Project Two' }], parent: null } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const tasks = await listIncompleteAssignedTasks('fake-token-breadcrumbs', { withBreadcrumbs: true });
    const byGid = new Map(tasks.map((t) => [t.gid, t]));
    assert.equal(byGid.get('sub1')?.project, 'Project One › Parent task');
    assert.equal(byGid.get('sub2')?.project, 'Project Two › Grandparent two › Parent two');
  } finally {
    global.fetch = originalFetch;
  }
});

/// The default (no options) must not pay for breadcrumb resolution at all —
/// latency-sensitive callers like the slot-conflict check rely on this.
void test('listIncompleteAssignedTasks leaves subtasks as "No project" when withBreadcrumbs is not set', async () => {
  const originalFetch = global.fetch;
  const calls: string[] = [];

  global.fetch = (async (url: string) => {
    calls.push(String(url));
    if (String(url).includes('/users/me')) {
      return jsonResponse({ data: { workspaces: [{ gid: 'ws1', name: 'Workspace 1' }] } });
    }
    return jsonResponse({
      data: [{ gid: 'sub1', name: 'Subtask one', due_on: null, due_at: null, permalink_url: 'https://x/sub1', projects: [], parent: { gid: 'parent1', name: 'Parent task', projects: [] } }],
      next_page: null,
    });
  }) as typeof fetch;

  try {
    const tasks = await listIncompleteAssignedTasks('fake-token-no-breadcrumbs');
    assert.equal(tasks[0].project, 'No project');
    // workspaces + the near-term search pass (this mock answers it with the
    // same fixture, deduped below) + the one list page — no extra parent
    // lookups, since withBreadcrumbs isn't set.
    assert.equal(calls.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

/// onBatch should report a running total across pages AND across
/// workspaces (not reset back to a per-page or per-workspace count), since
/// the loading screen shows it as one cumulative "N tasks loaded" figure —
/// and each call's task list should be everything seen so far, not just
/// the page that just arrived.
void test('listIncompleteAssignedTasks reports a cumulative running count and task list via onBatch', async () => {
  const originalFetch = global.fetch;

  global.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/users/me')) {
      return jsonResponse({ data: { workspaces: [{ gid: 'ws1', name: 'Workspace 1' }, { gid: 'ws2', name: 'Workspace 2' }] } });
    }
    if (u.includes('workspace=ws1') && !u.includes('offset=')) {
      return jsonResponse({
        data: [{ gid: 't1', name: 'One', due_on: null, due_at: null, permalink_url: 'https://x/1', projects: [], parent: null }],
        next_page: { uri: 'https://app.asana.com/api/1.0/tasks?offset=ws1b' },
      });
    }
    if (u.includes('offset=ws1b')) {
      return jsonResponse({
        data: [{ gid: 't2', name: 'Two', due_on: null, due_at: null, permalink_url: 'https://x/2', projects: [], parent: null }],
        next_page: null,
      });
    }
    if (u.includes('workspace=ws2')) {
      return jsonResponse({
        data: [{ gid: 't3', name: 'Three', due_on: null, due_at: null, permalink_url: 'https://x/3', projects: [], parent: null }],
        next_page: null,
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const progressCounts: number[] = [];
    const progressGids: string[][] = [];
    await listIncompleteAssignedTasks('fake-token-onbatch', {
      onBatch: (tasksSoFar, totalSoFar) => {
        progressCounts.push(totalSoFar);
        progressGids.push(tasksSoFar.map((t) => t.gid));
      },
    });
    // ws1 page1 -> 1, ws1 page2 -> 2, ws2 page1 -> 3: always cumulative, never resets.
    assert.deepEqual(progressCounts, [1, 2, 3]);
    assert.deepEqual(progressGids, [['t1'], ['t1', 't2'], ['t1', 't2', 't3']]);
  } finally {
    global.fetch = originalFetch;
  }
});

/// The near-term search pass is a pure optimization gated behind a paid
/// Asana plan — a free workspace 402s on it. That must never surface as a
/// failure; it should just fall straight through to the full fetch below,
/// unaffected.
void test('listIncompleteAssignedTasks falls back to the full fetch when the near-term search 402s (free-plan workspace)', async () => {
  const originalFetch = global.fetch;

  global.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/users/me')) {
      return jsonResponse({ data: { workspaces: [{ gid: 'ws1', name: 'Workspace 1' }] } });
    }
    if (u.includes('/tasks/search')) {
      return new Response('Payment Required', { status: 402 });
    }
    if (u.includes('/tasks?assignee=me')) {
      return jsonResponse({
        data: [{ gid: 't1', name: 'Task one', due_on: '2026-08-25', due_at: null, permalink_url: 'https://x/1', projects: [], parent: null }],
        next_page: null,
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const tasks = await listIncompleteAssignedTasks('fake-token-402');
    assert.deepEqual(
      tasks.map((t) => t.gid),
      ['t1'],
    );
  } finally {
    global.fetch = originalFetch;
  }
});

/// The whole point of the near-term search pass: a task due soon should
/// reach onBatch before tasks that happen to sit on an earlier page of the
/// plain (unsorted) list fetch, so the boot screen's queue fills with
/// actually-relevant tasks first instead of stalling on undated ones.
void test('listIncompleteAssignedTasks fast-tracks a near-term-due task ahead of the plain list fetch', async () => {
  const originalFetch = global.fetch;

  global.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/users/me')) {
      return jsonResponse({ data: { workspaces: [{ gid: 'ws1', name: 'Workspace 1' }] } });
    }
    if (u.includes('/tasks/search')) {
      return jsonResponse({
        data: [{ gid: 'soon', name: 'Due soon', due_on: '2026-08-22', due_at: null, permalink_url: 'https://x/soon', projects: [], parent: null }],
      });
    }
    if (u.includes('/tasks?assignee=me')) {
      // The plain list's own page order puts the undated task first, as if
      // Asana just happened to store it that way — the near-term search
      // pass above should still have gotten 'soon' to onBatch first.
      return jsonResponse({
        data: [
          { gid: 'undated', name: 'No due date', due_on: null, due_at: null, permalink_url: 'https://x/undated', projects: [], parent: null },
          { gid: 'soon', name: 'Due soon', due_on: '2026-08-22', due_at: null, permalink_url: 'https://x/soon', projects: [], parent: null },
        ],
        next_page: null,
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const batches: string[][] = [];
    const tasks = await listIncompleteAssignedTasks('fake-token-prioritized', {
      onBatch: (tasksSoFar) => batches.push(tasksSoFar.map((t) => t.gid)),
    });
    assert.deepEqual(batches[0], ['soon']);
    assert.deepEqual(
      tasks.map((t) => t.gid).sort(),
      ['soon', 'undated'],
    );
  } finally {
    global.fetch = originalFetch;
  }
});

/// Regression test for a real production bug: Asana's Search API runs off
/// an index that can lag behind a task's live completion state, so a
/// just-completed task can still come back from /tasks/search with
/// completed=false honored server-side yet the dto itself still marked
/// completed:true. A completed task slipping through the near-term
/// fast-track and into the triage queue is exactly what that looked like.
void test('listIncompleteAssignedTasks drops a near-term search result that is actually completed (stale search index)', async () => {
  const originalFetch = global.fetch;

  global.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/users/me')) {
      return jsonResponse({ data: { workspaces: [{ gid: 'ws1', name: 'Workspace 1' }] } });
    }
    if (u.includes('/tasks/search')) {
      return jsonResponse({
        data: [
          { gid: 'stale-done', name: 'Actually done', due_on: '2026-08-07', due_at: null, completed: true, permalink_url: 'https://x/done', projects: [], parent: null },
        ],
      });
    }
    if (u.includes('/tasks?assignee=me')) {
      return jsonResponse({ data: [], next_page: null });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const tasks = await listIncompleteAssignedTasks('fake-token-stale-completed');
    assert.deepEqual(tasks, []);
  } finally {
    global.fetch = originalFetch;
  }
});

/// Regression test for the typeahead speedup: listWorkspaces used to hit
/// /users/me on every call, adding a whole extra sequential Asana round-trip
/// in front of every keystroke's search. It should now serve repeat calls
/// (same access token) from cache instead of refetching.
void test('listWorkspaces caches by access token instead of refetching /users/me every call', async () => {
  const originalFetch = global.fetch;
  let callCount = 0;

  global.fetch = (async (url: string) => {
    if (String(url).includes('/users/me')) {
      callCount++;
      return jsonResponse({ data: { workspaces: [{ gid: 'ws1', name: 'Workspace 1' }] } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const first = await listWorkspaces('fake-token-cache-test');
    const second = await listWorkspaces('fake-token-cache-test');
    assert.deepEqual(first, [{ gid: 'ws1', name: 'Workspace 1' }]);
    assert.deepEqual(second, first);
    assert.equal(callCount, 1);

    // A different token is a genuinely different cache entry, not a hit.
    await listWorkspaces('fake-token-cache-test-2');
    assert.equal(callCount, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
