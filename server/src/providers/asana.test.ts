import test from 'node:test';
import assert from 'node:assert/strict';

// Same reason as crypto.test.ts: env.ts validates process.env at import
// time, so these need setting before the (dynamic) import below.
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db';
process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.SESSION_JWT_SECRET ??= 'test-secret';
process.env.PUBLIC_APP_URL ??= 'http://localhost:3000';
process.env.ASANA_CLIENT_ID ??= 'test-client-id';
process.env.ASANA_CLIENT_SECRET ??= 'test-client-secret';

const { listIncompleteAssignedTasks, listWorkspaces, refreshTasksByGid, refreshAsanaToken } = await import('./asana.js');

/// What Node's fetch actually throws when AbortSignal.timeout fires — used
/// below to simulate the exact transient failure fetchWithRetry (asana.ts)
/// is meant to recover from, rather than a generic Error a real timeout
/// would never actually produce.
function timeoutError(): DOMException {
  return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
}

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
/// Breadcrumb resolution (always on, see inFlightTaskFetches' own comment)
/// resolves the project through the parent chain: one hop for free
/// (parent.projects.* requested in the same list call), and a live lookup
/// for a deeper hop (grandparent).
void test('listIncompleteAssignedTasks resolves subtask project via the parent chain', async () => {
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
    const tasks = await listIncompleteAssignedTasks('fake-token-breadcrumbs');
    const byGid = new Map(tasks.map((t) => [t.gid, t]));
    assert.equal(byGid.get('sub1')?.project, 'Project One › Parent task');
    assert.equal(byGid.get('sub2')?.project, 'Project Two › Grandparent two › Parent two');
  } finally {
    global.fetch = originalFetch;
  }
});

/// A regression test for a real production bug: boot fires the tasks
/// stream and workload's own hours computation concurrently, and both used
/// to independently run a full pagination sweep for the same access token
/// at once — doubling Asana's own request volume right at boot, which was
/// confirmed live to trip a real Asana-side timeout (see
/// inFlightTaskFetches' own comment). Two truly concurrent calls for the
/// same token must now share one underlying fetch instead.
void test('listIncompleteAssignedTasks shares one fetch between two concurrent calls for the same access token', async () => {
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = (async (url: string) => {
    calls++;
    if (String(url).includes('/users/me')) {
      return jsonResponse({ data: { workspaces: [{ gid: 'ws1', name: 'Workspace 1' }] } });
    }
    return jsonResponse({
      data: [{ gid: 't1', name: 'Task one', due_on: null, due_at: null, permalink_url: 'https://x/1', projects: [] }],
      next_page: null,
    });
  }) as typeof fetch;

  try {
    const [a, b] = await Promise.all([
      listIncompleteAssignedTasks('fake-token-dedup'),
      listIncompleteAssignedTasks('fake-token-dedup'),
    ]);
    assert.deepEqual(a.map((t) => t.gid), ['t1']);
    assert.deepEqual(b.map((t) => t.gid), ['t1']);
    // A solo call makes exactly 3 requests (workspaces, near-term search,
    // the one list page — same shape as the "no extra parent lookups" case
    // above). Two *concurrent* calls sharing one fetch stay at 3; without
    // the dedup this would be 6.
    assert.equal(calls, 3);
    // A call made only *after* both of the above have settled must still
    // hit the network fresh — proving the in-flight entry was actually
    // cleared once done, not left permanently short-circuiting this token.
    await listIncompleteAssignedTasks('fake-token-dedup');
    // +2, not +3: workspaces now comes from listWorkspaces' own cache
    // (see its own test below), leaving just the search + list page.
    assert.equal(calls, 5);
  } finally {
    global.fetch = originalFetch;
  }
});

/// A regression test for a real production bug in the dedup itself: a
/// joining call used to get nothing but the final result, silently missing
/// every onPhase/onBatch update the *leader* was seeing — which on a real
/// device meant a boot's tasks-stream request that lost the race to become
/// the leader sat frozen on its very first phase label for the fetch's
/// entire ~17s duration despite the fetch genuinely succeeding the whole
/// time. A joiner must see the same progress the leader does, live, not
/// just an eventual result.
void test('a joining call receives live onPhase progress from the fetch it joined, not just the final result', async () => {
  const originalFetch = global.fetch;
  let releaseGate: (() => void) | undefined;
  // Blocks the very first request (workspace lookup) so the joiner below
  // is guaranteed to have registered *before* anything else fires — proving
  // it sees every phase from the start, not just whatever's left once it
  // happens to attach.
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  global.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/users/me')) {
      await gate;
      return jsonResponse({ data: { workspaces: [{ gid: 'ws1', name: 'Workspace 1' }] } });
    }
    if (u.includes('/tasks/search')) {
      return jsonResponse({ data: [] });
    }
    return jsonResponse({
      data: [{ gid: 't1', name: 'Task one', due_on: null, due_at: null, permalink_url: 'https://x/1', projects: [] }],
      next_page: null,
    });
  }) as typeof fetch;

  const leaderPhases: string[] = [];
  const joinerPhases: string[] = [];

  try {
    const leaderPromise = listIncompleteAssignedTasks('fake-token-broadcast', { onPhase: (label) => leaderPhases.push(label) });
    const joinerPromise = listIncompleteAssignedTasks('fake-token-broadcast', { onPhase: (label) => joinerPhases.push(label) });
    releaseGate!();
    const [leaderResult, joinerResult] = await Promise.all([leaderPromise, joinerPromise]);
    assert.deepEqual(leaderResult.map((t) => t.gid), ['t1']);
    assert.deepEqual(joinerResult.map((t) => t.gid), ['t1']);
    assert.ok(leaderPhases.length > 0);
    // Joined before the gate ever released, so it must have caught
    // everything the leader did — an identical sequence, not a subset.
    assert.deepEqual(joinerPhases, leaderPhases);
  } finally {
    global.fetch = originalFetch;
  }
});

/// A regression test for a real production failure: a boot's ~20-request
/// pagination sweep failed outright because exactly one HTTP call inside it
/// hit ASANA_FETCH_TIMEOUT_MS, discarding every page already fetched. GETs
/// (listWorkspaces here) now get bounded retries for exactly this failure
/// (see asana.ts's fetchWithRetry).
void test('listWorkspaces retries a transient timeout instead of failing on the first attempt', async () => {
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = (async () => {
    calls++;
    if (calls < 3) throw timeoutError();
    return jsonResponse({ data: { workspaces: [{ gid: 'ws1', name: 'Workspace 1' }] } });
  }) as typeof fetch;

  try {
    const workspaces = await listWorkspaces('fake-token-retry-succeeds');
    assert.deepEqual(workspaces, [{ gid: 'ws1', name: 'Workspace 1' }]);
    assert.equal(calls, 3); // 2 failed attempts, then a third that succeeds
  } finally {
    global.fetch = originalFetch;
  }
});

void test('listWorkspaces gives up after exhausting retries on a persistent timeout', async () => {
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = (async () => {
    calls++;
    throw timeoutError();
  }) as typeof fetch;

  try {
    await assert.rejects(() => listWorkspaces('fake-token-retry-exhausted'));
    assert.equal(calls, 3); // the initial attempt plus 2 retries, then give up
  } finally {
    global.fetch = originalFetch;
  }
});

/// A timeout doesn't prove Asana never received/processed the request —
/// only that the response was lost. Retrying a write blind risks a
/// duplicate (a second POST /tasks creating two tasks, e.g.), so only GETs
/// are retried (see fetchWithRetry's own comment). refreshAsanaToken's POST
/// is a convenient exported write path to prove that restriction actually
/// holds, without needing a real access token or hitting recordChange.
void test('refreshAsanaToken does not retry a transient failure on its POST', async () => {
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = (async () => {
    calls++;
    throw timeoutError();
  }) as typeof fetch;

  try {
    await assert.rejects(() => refreshAsanaToken('some-refresh-token'));
    assert.equal(calls, 1); // no retry attempted
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

/// Regression test for a real bug: a task deleted (or completed) in Asana
/// right before a refresh could still show up in the triage queue, and keep
/// showing up on every later refresh too, not just once. Root cause: the
/// near-term search pass is Asana's eventually-consistent Search API — its
/// index can still list a task as open for a while after the task itself is
/// gone — and the merge logic used to be purely additive, so a stale search
/// hit was never reconciled against the authoritative full-fetch pass that
/// follows (no date filter, covers the whole assignment) even when that
/// pass came back without it entirely (as a real deletion looks, vs. a
/// completed:true flag flip, which the other stale-search test above
/// already covered).
void test('listIncompleteAssignedTasks drops a near-term search result the full fetch never confirms (deleted mid-refresh)', async () => {
  const originalFetch = global.fetch;

  global.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/users/me')) {
      return jsonResponse({ data: { workspaces: [{ gid: 'ws1', name: 'Workspace 1' }] } });
    }
    if (u.includes('/tasks/search')) {
      return jsonResponse({
        data: [
          {
            gid: 'stale-deleted',
            name: 'Deleted moments ago',
            due_on: '2026-08-07',
            due_at: null,
            completed: false,
            permalink_url: 'https://x/deleted',
            projects: [],
            parent: null,
          },
          {
            gid: 'still-here',
            name: 'Genuinely still open',
            due_on: '2026-08-08',
            due_at: null,
            completed: false,
            permalink_url: 'https://x/still-here',
            projects: [],
            parent: null,
          },
        ],
      });
    }
    if (u.includes('/tasks?assignee=me')) {
      // The authoritative full fetch never mentions 'stale-deleted' at
      // all — exactly how a real deletion looks, as opposed to a
      // completed:true flag on an otherwise-present task.
      return jsonResponse({
        data: [
          {
            gid: 'still-here',
            name: 'Genuinely still open',
            due_on: '2026-08-08',
            due_at: null,
            completed: false,
            permalink_url: 'https://x/still-here',
            projects: [],
            parent: null,
          },
        ],
        next_page: null,
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const tasks = await listIncompleteAssignedTasks('fake-token-stale-deleted');
    assert.deepEqual(
      tasks.map((t) => t.gid),
      ['still-here'],
    );
  } finally {
    global.fetch = originalFetch;
  }
});

/// Companion to the deletion test above: a task that still legitimately
/// exists, but whose due date and name were edited in Asana right before a
/// refresh, must show the edit — not the stale snapshot the (eventually
/// consistent) search pass happened to seed first. Before this fix, the
/// merge kept whichever dto for a gid it saw *first* and just skipped
/// re-adding it on the full-fetch pass, so a search-sourced entry's fields
/// could never be refreshed by the pass that's supposed to be the source of
/// truth.
void test('listIncompleteAssignedTasks prefers the full fetch\'s due date/name over a stale search hit for the same task', async () => {
  const originalFetch = global.fetch;

  global.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/users/me')) {
      return jsonResponse({ data: { workspaces: [{ gid: 'ws1', name: 'Workspace 1' }] } });
    }
    if (u.includes('/tasks/search')) {
      return jsonResponse({
        data: [
          {
            gid: 'edited',
            name: 'Old name [2]',
            due_on: '2026-08-07',
            due_at: null,
            completed: false,
            permalink_url: 'https://x/edited',
            projects: [],
            parent: null,
          },
        ],
      });
    }
    if (u.includes('/tasks?assignee=me')) {
      return jsonResponse({
        data: [
          {
            gid: 'edited',
            name: 'New name [4]',
            due_on: '2026-08-09',
            due_at: null,
            completed: false,
            permalink_url: 'https://x/edited',
            projects: [],
            parent: null,
          },
        ],
        next_page: null,
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const tasks = await listIncompleteAssignedTasks('fake-token-edited');
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].name, 'New name');
    assert.equal(tasks[0].hours, 4);
    assert.equal(tasks[0].dueOn, '2026-08-09');
  } finally {
    global.fetch = originalFetch;
  }
});

/// Companion to the "actually completed" stale-search test above: that one
/// covers the search pass itself returning completed:true. This covers the
/// case where search still says completed:false (stale) but the task was
/// completed by the time the authoritative full fetch ran — the full fetch
/// must be able to retract an entry the search pass already added, not just
/// skip re-adding it.
void test('listIncompleteAssignedTasks retracts a search-added task the full fetch now reports completed', async () => {
  const originalFetch = global.fetch;

  global.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/users/me')) {
      return jsonResponse({ data: { workspaces: [{ gid: 'ws1', name: 'Workspace 1' }] } });
    }
    if (u.includes('/tasks/search')) {
      return jsonResponse({
        data: [
          {
            gid: 'just-completed',
            name: 'Finished right after search indexed it',
            due_on: '2026-08-07',
            due_at: null,
            completed: false,
            permalink_url: 'https://x/just-completed',
            projects: [],
            parent: null,
          },
        ],
      });
    }
    if (u.includes('/tasks?assignee=me')) {
      // completed_since=now means Asana itself won't even return a task
      // completed before this call — simulated here by simply omitting it,
      // same as the deletion test, since a completed task and a deleted one
      // look identical from this endpoint's point of view.
      return jsonResponse({ data: [], next_page: null });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const tasks = await listIncompleteAssignedTasks('fake-token-just-completed');
    assert.deepEqual(tasks, []);
  } finally {
    global.fetch = originalFetch;
  }
});

/// refreshTasksByGid is the fast, direct-lookup counterpart to
/// listIncompleteAssignedTasks used for the Triage screen's "on resume,
/// top up exactly what's visible" path — no search pass, no pagination,
/// just one GET per gid. Covers its three outcomes: a live edit shows
/// through, a 404 (deleted) comes back as null rather than throwing, and a
/// task that's now completed also comes back as null even though the
/// fetch itself succeeded.
void test('refreshTasksByGid fetches each gid directly: edits show through, deleted and completed both come back null', async () => {
  const originalFetch = global.fetch;

  global.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/tasks/edited')) {
      return jsonResponse({
        data: { gid: 'edited', name: 'Fresh name [2]', due_on: '2026-08-09', due_at: null, completed: false, permalink_url: 'https://x/edited', projects: [], parent: null },
      });
    }
    if (u.includes('/tasks/deleted')) {
      return new Response('{}', { status: 404 });
    }
    if (u.includes('/tasks/completed')) {
      return jsonResponse({
        data: { gid: 'completed', name: 'Done now', due_on: '2026-08-09', due_at: null, completed: true, permalink_url: 'https://x/completed', projects: [], parent: null },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const result = await refreshTasksByGid('fake-token', ['edited', 'deleted', 'completed'], 'UTC');
    assert.equal(result.edited?.name, 'Fresh name');
    assert.equal(result.deleted, null);
    assert.equal(result.completed, null);
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
