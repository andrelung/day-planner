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
    const tasks = await listIncompleteAssignedTasks('fake-token', { withBreadcrumbs: true });
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
    const tasks = await listIncompleteAssignedTasks('fake-token');
    assert.equal(tasks[0].project, 'No project');
    assert.equal(calls.length, 2); // just workspaces + the one list page, no extra parent lookups
  } finally {
    global.fetch = originalFetch;
  }
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
