import { env } from '../lib/env.js';
import { cleanTitle, parseDurationFromTitle, titleWithDuration } from '../lib/titleDuration.js';
import { recordChange } from '../lib/changeLog.js';
import { addDaysToDateStr, dateStrInTz, hmInTz } from '../lib/tz.js';
import { prisma } from '../lib/prisma.js';
import type { OAuthTokenSet, RemoteTask } from './types.js';

const AUTHORIZE_URL = 'https://app.asana.com/-/oauth_authorize';
const TOKEN_URL = 'https://app.asana.com/-/oauth_token';
const API_BASE = 'https://app.asana.com/api/1.0';

/// Every fetch to Asana below passes this — without it, a hung TCP
/// connection (a real network partition, or Asana's own server just not
/// responding) leaves the fetch promise pending forever, since neither
/// Node's fetch nor Asana's API impose a timeout of their own. That used
/// to surface eventually via the SSE stream's client-side stall watchdog
/// timing out — but the watchdog now also resets on the stream's own
/// heartbeat (see routes/tasks.ts), which keeps resetting for as long as
/// the Node process is merely alive, whether or not the fetch it's
/// waiting on is actually making progress. Confirmed live: a real device
/// stuck on "Connecting to Asana…" indefinitely, with no timeout, no
/// error, and nothing in the diagnostic log at all — exactly what an
/// unbounded hung fetch masked by a live heartbeat looks like.
const ASANA_FETCH_TIMEOUT_MS = 15_000;

/// A single slow/stalled Asana call shouldn't take down an entire
/// multi-request operation with it — confirmed live: a boot's ~20-request
/// pagination sweep failed outright because exactly one HTTP call inside it
/// exceeded ASANA_FETCH_TIMEOUT_MS, even though every other call in that
/// same sweep completed in well under a second, and the only recovery this
/// app had was retrying the *entire* sweep from page one, discarding the 19
/// pages that had already succeeded. Every raw fetch to Asana below goes
/// through this instead of calling fetch() directly, so a transient stall
/// gets one/two bounded retries right where it happened.
///
/// Deliberately narrow about what counts as retryable, on two axes:
/// - Only a GET is ever retried. asanaFetch (below) is shared by both reads
///   and writes (setTaskDueAt, createTaskInProject, ...); a timeout means
///   the *response* was lost, not necessarily that Asana never received or
///   processed the request — retrying a POST/PUT blind risks a duplicate
///   task or a double-submitted mutation. A GET has no such risk.
/// - Only a genuine transient failure: a timeout (AbortSignal firing — a
///   DOMException) or the connection itself failing (Node's fetch throws a
///   TypeError for a real network-level failure, e.g. connection
///   reset/DNS). A real HTTP error response (4xx/5xx) isn't transient and
///   retrying can't fix it — callers rely on seeing it immediately
///   (searchNearTermTasks' 402-on-free-plan handling, e.g.), so that path
///   is untouched, still a normal rejection on the first attempt.
const ASANA_FETCH_RETRIES = 2;
const ASANA_FETCH_RETRY_DELAY_MS = 300;

async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  // No explicit method means GET, same as the Fetch spec's own default.
  const retryable = (init?.method ?? 'GET').toUpperCase() === 'GET';
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(ASANA_FETCH_TIMEOUT_MS) });
    } catch (err) {
      const transient = err instanceof DOMException || err instanceof TypeError;
      if (!retryable || !transient || attempt >= ASANA_FETCH_RETRIES) throw err;
      await new Promise((resolve) => setTimeout(resolve, ASANA_FETCH_RETRY_DELAY_MS));
    }
  }
}

function requireCredentials() {
  if (!env.ASANA_CLIENT_ID || !env.ASANA_CLIENT_SECRET) {
    throw new ProviderNotConfiguredError('asana');
  }
  return { clientId: env.ASANA_CLIENT_ID, clientSecret: env.ASANA_CLIENT_SECRET };
}

export class ProviderNotConfiguredError extends Error {
  constructor(public provider: 'asana' | 'outlook') {
    super(`${provider} OAuth is not configured on this server (missing client id/secret env vars)`);
  }
}

function redirectUri(): string {
  return `${env.PUBLIC_APP_URL}/auth/asana/callback`;
}

// Asana's newer apps must request specific OAuth scopes instead of the old
// unscoped "default" (full-access) mode — omitting `scope` gets rejected
// with "forbidden_scopes: ... not allowed to request ... `default` identity
// scopes". `openid email profile` are the OpenID Connect scopes that put
// gid/name/email in the token response's `data` object (see
// exchangeAsanaCode below); the rest are the exact resource:action scopes
// this app actually uses. These must also be enabled for the app in the
// Asana developer console (My Apps → your app → OAuth → scopes) — granting
// them in the console but not requesting them here (or vice versa) still
// fails, both sides need to agree.
const SCOPES = 'openid email profile tasks:read tasks:write projects:read users:read workspaces:read workspaces.typeahead:read';

export function getAsanaAuthorizeUrl(state: string): string {
  const { clientId } = requireCredentials();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  // Appended by hand (not url.searchParams.set) because URLSearchParams
  // encodes spaces as "+", but Asana's docs specifically show scopes
  // space-separated as %20 — encodeURIComponent gives %20 directly.
  return `${url.toString()}&scope=${encodeURIComponent(SCOPES)}`;
}

interface AsanaTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  data?: { gid: string; name: string; email: string };
}

async function tokenRequest(body: Record<string, string>): Promise<AsanaTokenResponse> {
  const res = await fetchWithRetry(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    throw new Error(`Asana token request failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as AsanaTokenResponse;
}

export async function exchangeAsanaCode(
  code: string,
): Promise<{ tokens: OAuthTokenSet; accountLabel: string; externalAccountId: string }> {
  const { clientId, clientSecret } = requireCredentials();
  const json = await tokenRequest({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(),
    code,
  });
  if (!json.data?.gid) {
    throw new Error('Asana token response was missing the account identity (data.gid)');
  }
  return {
    tokens: {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? null,
      expiresAt: new Date(Date.now() + json.expires_in * 1000),
      scope: null,
    },
    accountLabel: `${json.data.name} <${json.data.email}>`,
    externalAccountId: json.data.gid,
  };
}

export async function refreshAsanaToken(refreshToken: string): Promise<OAuthTokenSet> {
  const { clientId, clientSecret } = requireCredentials();
  const json = await tokenRequest({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
    scope: null,
  };
}

async function asanaFetch(accessToken: string, path: string, init?: RequestInit): Promise<any> {
  const res = await fetchWithRetry(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Asana API ${path} failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as any;
  return json.data;
}

/// Follows Asana's cursor-based pagination (`next_page.offset`) to collect
/// every result across a list endpoint. Needed for `/tasks` in particular —
/// a real workspace's incomplete-assigned-to-me count can easily exceed a
/// single page (Asana caps a page at 100 and errors with "result is too
/// large" rather than silently truncating).
///
/// `onPage` fires with each freshly-fetched page's own items (not a
/// cumulative count) — the caller decides how to accumulate/report on them.
/// `onPageMs` fires alongside it with how long that one page's request
/// took — a diagnostic hook, not something normal callers need: roughly
/// constant latency per page points at fixed per-request overhead (a new
/// connection/TLS handshake for each one, since these can't be
/// parallelized — Asana's cursor for page N+1 only exists in page N's own
/// response); latency that climbs with page count points at something
/// else (larger responses, server-side load on Asana's end).
async function asanaFetchAllPages(
  accessToken: string,
  path: string,
  onPage?: (page: any[]) => void,
  onPageMs?: (ms: number) => void,
): Promise<any[]> {
  const all: any[] = [];
  // Asana hands back a ready-to-use `next_page.uri` for the following page —
  // simpler and less error-prone than reconstructing offset/limit by hand.
  let url: string | null = `${API_BASE}${path}${path.includes('?') ? '&' : '?'}limit=100`;
  while (url) {
    const pageStart = Date.now();
    const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      throw new Error(`Asana API ${url} failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as any;
    onPageMs?.(Date.now() - pageStart);
    all.push(...json.data);
    onPage?.(json.data);
    url = json.next_page?.uri ?? null;
  }
  return all;
}

interface AsanaTaskDto {
  gid: string;
  name: string;
  due_on: string | null;
  due_at: string | null;
  permalink_url: string;
  completed: boolean;
  projects: { gid: string; name: string }[];
  parent: { gid: string; name: string; projects?: { gid: string; name: string }[] } | null;
}

// parent.projects.* is a best-effort one-level-deep lookahead — a subtask's
// immediate parent is usually the one that actually sits in a project, so
// this resolves the common case for free in the same request. Deeper
// nesting (subtask of a subtask) falls back to live lookups in
// resolveBreadcrumbs below. `completed` is requested so callers can filter
// defensively themselves (see listIncompleteAssignedTasks) rather than
// trusting each endpoint's own completed-tasks filter to be exact —
// Asana's Search API in particular runs off an index that can lag behind
// a task's live completion state, so `completed=false` there isn't a hard
// guarantee the way the plain /tasks list's completed_since trick is.
const TASK_OPT_FIELDS = 'name,due_on,due_at,permalink_url,completed,projects.gid,projects.name,parent.gid,parent.name,parent.projects.gid,parent.projects.name';

/// due_at is a real UTC instant (see setTaskDueAt) — reading its wall-clock
/// hour back has to go through the *acting user's own configured
/// Settings.timezone* (not this process's ambient clock — see workload.ts's
/// identical reasoning; a mismatch here is what made a task dragged to,
/// say, 11:00 redisplay a couple hours off for anyone whose zone differs
/// from the server's), not string-slicing: slicing reads the UTC digits
/// directly, which are only ever right when the target zone happens to be
/// UTC itself.
function localHHMM(iso: string, timezone: string): string {
  const { h, m } = hmInTz(new Date(iso), timezone);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function toRemoteTask(dto: AsanaTaskDto, timezone: string): RemoteTask & { projectGid: string | null } {
  const dueHour = dto.due_at ? localHHMM(dto.due_at, timezone) : null;
  return {
    gid: dto.gid,
    // Display name is the "[4]"-stripped title — the duration lives in the
    // Estimate control, not cluttering the task name shown in the UI.
    name: cleanTitle(dto.name),
    project: dto.projects?.[0]?.name ?? 'No project',
    projectGid: dto.projects?.[0]?.gid ?? null,
    hours: parseDurationFromTitle(dto.name) ?? 1,
    hasExplicitHours: parseDurationFromTitle(dto.name) !== null,
    dueHour,
    dueAt: dto.due_at,
    dueOn: dto.due_on,
    permalinkUrl: dto.permalink_url,
  };
}

/// Asana subtasks don't belong to a project directly — only their top-level
/// ancestor does — so a subtask's `projects` field comes back empty and
/// otherwise shows as "No project" even though it clearly belongs
/// somewhere. This walks up the parent chain (deduped/cached across tasks,
/// since siblings usually share a parent) until it finds an ancestor that's
/// actually in a project, and rewrites `task.project` to a breadcrumb trail
/// like "Marketing Site › Q3 Campaign › Design Review".
///
/// Bounded concurrency, not a bare Promise.all over every entry. On a real
/// backlog `entries` runs to a couple of thousand, and each subtask without
/// a project can walk up to five ancestors — a plain Promise.all launches
/// the whole fan-out at once. Node's fetch pool then queues almost all of
/// it, while each queued request's AbortSignal.timeout is already counting
/// down from the moment fetch() was *called* rather than from when it got
/// a connection. So the queue times out from the back, every timeout is
/// retried (see fetchWithRetry), and the retries re-enter the same queue:
/// a self-sustaining storm that gets dramatically worse whenever Asana is
/// having a slow spell. That is the "boot never finishes, only the reload
/// button gets me out" report. A small window keeps every in-flight
/// request genuinely in flight, so its timeout measures Asana's latency
/// and nothing else.
///
/// `onProgress` reports resolved/total so this phase — easily the longest
/// on a large account, and previously a single silent step after the task
/// counter had already reached its final value — can say it's still moving.
const BREADCRUMB_CONCURRENCY = 6;

async function resolveBreadcrumbs(
  accessToken: string,
  entries: { dto: AsanaTaskDto; task: RemoteTask & { projectGid: string | null } }[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const known = new Map<string, AsanaTaskDto>(entries.map((e) => [e.dto.gid, e.dto]));
  const fetching = new Map<string, Promise<AsanaTaskDto | null>>();
  const fetchNode = (gid: string): Promise<AsanaTaskDto | null> => {
    const cached = known.get(gid);
    if (cached) return Promise.resolve(cached);
    let p = fetching.get(gid);
    if (!p) {
      p = asanaFetch(accessToken, `/tasks/${gid}?opt_fields=name,projects.gid,projects.name,parent.gid,parent.name`)
        .then((node: AsanaTaskDto) => {
          known.set(gid, node);
          return node;
        })
        .catch(() => null);
      fetching.set(gid, p);
    }
    return p;
  };

  // Filtered up front so the progress denominator means something: the
  // vast majority of entries already have a project and need no work at
  // all, and counting them would report near-instant completion of a phase
  // that has barely started.
  const needsWalk = entries.filter(({ dto }) => !dto.projects?.length && dto.parent);
  let done = 0;
  onProgress?.(0, needsWalk.length);

  await mapWithConcurrency(needsWalk, BREADCRUMB_CONCURRENCY, async ({ dto, task }) => {
    try {
      if (dto.parent!.projects?.length) {
        task.project = `${dto.parent!.projects[0].name} › ${dto.parent!.name}`;
        return;
      }
      const chain = [dto.parent!.name];
      let currentGid: string | null = dto.parent!.gid;
      let projectName: string | null = null;
      // Capped depth: a real ancestry this deep would be unusual, and this
      // guards against ever looping indefinitely on bad/cyclic data.
      for (let depth = 0; depth < 5 && currentGid; depth++) {
        const node = await fetchNode(currentGid);
        if (!node) break;
        if (node.projects?.length) {
          projectName = node.projects[0].name;
          break;
        }
        if (!node.parent) break;
        chain.push(node.parent.name);
        currentGid = node.parent.gid;
      }
      // chain was built closest-ancestor-first while walking up; a
      // breadcrumb reads root-to-leaf, so flip it before joining.
      if (projectName) task.project = [projectName, ...chain.reverse()].join(' › ');
    } finally {
      // A breadcrumb is a nicety; one that can't be resolved leaves the
      // task showing "No project" and must never take the whole boot with
      // it. Reporting from `finally` also keeps the progress count honest
      // when a walk gives up partway.
      onProgress?.(++done, needsWalk.length);
    }
  });
}

/// Runs `fn` over `items` with at most `limit` in flight at once. Deliberately
/// hand-rolled rather than pulling in a dependency: N workers pulling from a
/// shared cursor, which is the whole of it.
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/// A single task by gid, or null if it's gone — deleted, or a 404 for any
/// other reason. Deliberately narrower than asanaFetch's generic
/// throw-on-!ok: a 404 here is a meaningful, expected result (the task is
/// gone), not a failure, and needs to be told apart from a transient
/// network/auth error, which should still throw rather than be silently
/// read as "deleted" too.
async function fetchTaskOrNull(accessToken: string, gid: string): Promise<AsanaTaskDto | null> {
  const res = await fetchWithRetry(`${API_BASE}/tasks/${gid}?opt_fields=${TASK_OPT_FIELDS}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Asana API /tasks/${gid} failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: AsanaTaskDto };
  return json.data;
}

/// Direct per-task lookups for exactly the gids a caller already knows
/// about and cares about right now — the Triage screen's focused card plus
/// its next few "Up Next" entries, on resume. Unlike
/// listIncompleteAssignedTasks, this never touches the near-term search
/// pass (Asana's eventually-consistent Search API) or even the plain list
/// endpoint's pagination — it goes straight to Asana's single-task
/// endpoint per gid, in parallel, which reads the task directly rather
/// than through any index. Meant as a fast, targeted top-up alongside (not
/// instead of) a fuller refresh, which still matters for tasks not
/// currently on screen — a newly assigned or newly-due task this endpoint
/// was never told to look for.
export async function refreshTasksByGid(
  accessToken: string,
  gids: string[],
  timezone: string,
): Promise<Record<string, (RemoteTask & { projectGid: string | null }) | null>> {
  const fetched = await Promise.all(gids.map(async (gid) => ({ gid, dto: await fetchTaskOrNull(accessToken, gid) })));
  const alive = fetched.filter((f): f is { gid: string; dto: AsanaTaskDto } => !!f.dto && !f.dto.completed);
  const entries = alive.map((f) => ({ dto: f.dto, task: toRemoteTask(f.dto, timezone) }));
  await resolveBreadcrumbs(accessToken, entries);
  const result: Record<string, (RemoteTask & { projectGid: string | null }) | null> = {};
  for (const gid of gids) result[gid] = null;
  for (const e of entries) result[e.dto.gid] = e.task;
  return result;
}

/// The extra fields shown on Triage's focus card once "Up next" is
/// collapsed (see Triage.svelte) — description, collaborators, creation
/// date. Deliberately not part of TASK_OPT_FIELDS/the bulk task list: those
/// fields are irrelevant to every other view this app has, and asking for
/// them on every task in a large backlog (recorded elsewhere as ~2000
/// tasks) would bloat a fetch that's already the dominant cost in this app
/// for no benefit — fetched here, on demand, for one task at a time.
export interface TaskDetails {
  description: string;
  collaborators: { gid: string; name: string }[];
  createdAt: string;
}
export async function getTaskDetails(accessToken: string, gid: string): Promise<TaskDetails | null> {
  const res = await fetchWithRetry(`${API_BASE}/tasks/${gid}?opt_fields=notes,followers.name,created_at`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Asana API /tasks/${gid} failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: { notes: string; followers: { gid: string; name: string }[]; created_at: string } };
  return {
    description: json.data.notes ?? '',
    collaborators: json.data.followers ?? [],
    createdAt: json.data.created_at,
  };
}

// Workspace membership essentially never changes mid-session, but
// typeahead() (below) used to re-fetch it on every single call — an entire
// extra sequential Asana round-trip in front of the actual search on every
// keystroke, roughly doubling typeahead's latency. Caching by access token
// removes that round-trip for every call after the first; a token refresh
// naturally busts the cache (a new token is a new key), and the TTL is
// just a backstop against a workspace genuinely changing mid-session.
const workspaceCache = new Map<string, { workspaces: { gid: string; name: string }[]; expiresAt: number }>();
const WORKSPACE_CACHE_TTL_MS = 10 * 60_000;

/// A generous TTL for the *durable* copy (see `db` below) — deliberately
/// much longer than WORKSPACE_CACHE_TTL_MS above, since real workspace
/// membership essentially never changes; this is a backstop against it
/// genuinely changing (a new workspace added, e.g.), not a freshness
/// requirement the boot path actually needs day to day.
const WORKSPACE_DB_CACHE_TTL_MS = 7 * 24 * 60 * 60_000;

/// `db`, when passed, backs this with a persisted copy (OAuthAccount's
/// workspacesJson) in addition to the in-memory cache above — confirmed
/// live, twice, that the underlying /users/me call this exists to avoid can
/// take 15-25+ seconds on Asana's own side, which no client-side retry
/// budget can paper over without a very long worst case. The in-memory
/// cache alone only helps within one still-running process; this is what
/// actually keeps a *normal* boot (a server that's been up for hours, well
/// past any 10-minute in-memory TTL) off that call's critical path at all.
/// Omitted entirely by this file's own tests, which have no real database
/// to read — those exercise the in-memory path exactly as before.
export async function listWorkspaces(accessToken: string, db?: { userId: string }): Promise<{ gid: string; name: string }[]> {
  const cached = workspaceCache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) return cached.workspaces;

  if (db) {
    const account = await prisma.oAuthAccount.findUnique({
      where: { userId_provider: { userId: db.userId, provider: 'ASANA' } },
      select: { workspacesJson: true, workspacesCachedAt: true },
    });
    const freshEnough = account?.workspacesCachedAt && Date.now() - account.workspacesCachedAt.getTime() < WORKSPACE_DB_CACHE_TTL_MS;
    if (account?.workspacesJson && freshEnough) {
      const workspaces = account.workspacesJson as { gid: string; name: string }[];
      workspaceCache.set(accessToken, { workspaces, expiresAt: Date.now() + WORKSPACE_CACHE_TTL_MS });
      return workspaces;
    }
  }

  const me = await asanaFetch(accessToken, '/users/me?opt_fields=workspaces.gid,workspaces.name');
  const workspaces = me.workspaces ?? [];
  workspaceCache.set(accessToken, { workspaces, expiresAt: Date.now() + WORKSPACE_CACHE_TTL_MS });
  if (db) {
    // Best-effort — a failure to persist shouldn't fail the caller, who
    // already has a perfectly good live result; it just means the next
    // cold call pays for another live fetch instead of reading this one.
    prisma.oAuthAccount
      .updateMany({ where: { userId: db.userId, provider: 'ASANA' }, data: { workspacesJson: workspaces, workspacesCachedAt: new Date() } })
      .catch(() => {});
  }
  return workspaces;
}

/// Asana's typeahead search — the same fast, relevance-ranked endpoint the
/// real Asana app's own search box uses, and unlike the loaded-tasks list
/// this app already has client-side, it isn't limited to "incomplete
/// assigned to me" — it can find any task or project you're allowed to
/// see. Needs the `workspaces.typeahead:read` scope specifically (distinct
/// from `tasks:read`/`projects:read`); if a connected account's token
/// predates this scope being added, calls here 403 until they reconnect.
/// Searches every workspace the user belongs to and merges results, same
/// as listIncompleteAssignedTasks does for the task list.
export async function typeahead(
  accessToken: string,
  resourceType: 'task' | 'project',
  query: string,
  userId: string,
): Promise<{ gid: string; name: string; permalinkUrl: string }[]> {
  const workspaces = await listWorkspaces(accessToken, { userId });
  const results = await Promise.all(
    workspaces.map((ws) =>
      asanaFetch(
        accessToken,
        `/workspaces/${ws.gid}/typeahead?resource_type=${resourceType}&query=${encodeURIComponent(query)}&count=20&opt_fields=name,permalink_url`,
      ) as Promise<{ gid: string; name: string; permalink_url: string }[]>,
    ),
  );
  const seen = new Set<string>();
  return results
    .flat()
    .filter((r) => (seen.has(r.gid) ? false : (seen.add(r.gid), true)))
    .map((r) => ({ gid: r.gid, name: r.name, permalinkUrl: r.permalink_url }));
}

/// Best-effort speed-up for the progressive boot fetch below: the plain
/// /tasks list endpoint (used for the full, source-of-truth fetch) returns
/// pages in whatever internal order Asana happens to store them in, not
/// sorted by due date — a task due today can just as easily land on page 6
/// as page 1. Since the triage queue only ever shows tasks *with* a due
/// date (see buildTasksPayload), a boot that's chewing through pages
/// dominated by no-due-date/far-future tasks looks stalled even while
/// genuinely making progress.
///
/// The Search API has a real due_on.before filter and returns already-
/// relevant results in one shot — but it's gated behind a paid Asana plan
/// (402 Payment Required on a free workspace). Treated as a pure
/// optimization: any failure here (402 or otherwise) just means the caller
/// gets nothing back and falls through to the unaffected full fetch. Capped
/// at one page (the search endpoint's own pagination is a manual, cursor-
/// less scheme not worth the complexity for what's only ever a head start —
/// anything beyond the first 100 still arrives via the full fetch, just
/// without the fast-track).
async function searchNearTermTasks(accessToken: string, workspaceGid: string, dueOnBefore: string): Promise<AsanaTaskDto[]> {
  try {
    const data = await asanaFetch(
      accessToken,
      `/workspaces/${workspaceGid}/tasks/search?assignee.any=me&completed=false&due_on.before=${dueOnBefore}&sort_by=due_date&sort_ascending=true&limit=100&opt_fields=${TASK_OPT_FIELDS}`,
    );
    return data as AsanaTaskDto[];
  } catch {
    return [];
  }
}

/// Every task (done or not) assigned to the caller, due on exactly one
/// date — used only by the standalone calendar view (routes/calendar.ts's
/// GET /day) so a day already looked at keeps showing its completed work
/// instead of it vanishing the moment it's checked off. Deliberately
/// separate from listIncompleteAssignedTasks/searchNearTermTasks, both of
/// which exist specifically to filter completed tasks *out* for the
/// swipeable triage queue — this is the one place that filter would be
/// wrong. No completed=false in the query, and no breadcrumb resolution
/// (resolveBreadcrumbs) either: this is a read-only day view, not
/// something the queue logic depends on, so a subtask briefly showing
/// "No project" instead of its full breadcrumb isn't worth the extra
/// per-task lookups here.
export async function listTasksForDate(accessToken: string, dateStr: string, timezone: string, userId: string): Promise<(RemoteTask & { completed: boolean })[]> {
  const workspaces = await listWorkspaces(accessToken, { userId });
  const results = await Promise.all(
    workspaces.map(async (ws) => {
      try {
        const data = (await asanaFetch(
          accessToken,
          `/workspaces/${ws.gid}/tasks/search?assignee.any=me&due_on=${dateStr}&opt_fields=${TASK_OPT_FIELDS}`,
        )) as AsanaTaskDto[];
        return data.map((dto) => ({ ...toRemoteTask(dto, timezone), completed: dto.completed }));
      } catch {
        return [];
      }
    }),
  );
  return results.flat();
}

/// Boot fires several concurrent requests that each need the caller's
/// *entire* task list — the tasks stream itself, and workload's own hours/
/// capacity computation (routes/workload.ts) — and each used to run its own
/// independent full multi-page Asana pagination sweep (asanaFetchAllPages)
/// to get it. Confirmed live as a real, load-bearing bug rather than a
/// latency nuisance: doubling Asana's own per-account request volume at the
/// exact moment of boot caused a genuine Asana-side timeout on one of the
/// two concurrent sweeps (a 15s AbortSignal.timeout tripping on
/// listWorkspaces, deep inside the *other* concurrent call), and Node's
/// single thread parsing/reconciling two ~2000-task JSON payloads at once
/// stalled unrelated in-flight work for multiple seconds (an otherwise
/// inexplicable multi-second gap in a route that touches neither Asana nor
/// the DB during that window). Keyed by access token so a refreshed token
/// (a new key) naturally starts a fresh entry rather than serving something
/// fetched under a token that's since rotated; cleared once the fetch
/// settles either way, so the next independent call (the 15-minute
/// periodic refresh, e.g.) always gets a fresh one.
type TaskListResult = (RemoteTask & { projectGid: string | null })[];
type OnBatch = (tasksSoFar: TaskListResult, totalSoFar: number) => void;
type OnPhase = (label: string) => void;
type OnPageMs = (ms: number) => void;

interface InFlightFetch {
  promise: Promise<TaskListResult>;
  onBatchListeners: Set<OnBatch>;
  onPhaseListeners: Set<OnPhase>;
  onPageMsListeners: Set<OnPageMs>;
}
const inFlightTaskFetches = new Map<string, InFlightFetch>();

/// Fetches every incomplete task assigned to the caller, across all of their
/// workspaces, de-duplicating against another concurrent call for the same
/// access token instead of running a second redundant sweep (see
/// inFlightTaskFetches's own comment). `onBatch` fires after each page with
/// everything fetched *so far* (cumulative, across workspaces) plus a
/// running total — lets a caller like the boot-time stream hand the client
/// a usable queue well before the whole fetch finishes. `onPhase` fires
/// with a short human-readable label at each real transition (workspace
/// lookup done, near-term search, full fetch, breadcrumb resolution).
///
/// A caller that joins a fetch already in flight (rather than starting it)
/// still gets its own onBatch/onPhase/onPageMs firing live, from the moment
/// it joins — every current caller for a token is registered as a listener
/// on the one real fetch, not just whichever caller happened to start it.
/// Confirmed live why this matters: without it, a boot's tasks-stream
/// request that lost the race to become the "leader" (workload's own call
/// getting there first, e.g.) saw literally none of its own progress
/// events — the fetch was genuinely succeeding server-side the whole time,
/// but the loading screen had no way to know and sat on its very first
/// phase label for the entire ~17s duration, indistinguishable from
/// actually being stuck.
export async function listIncompleteAssignedTasks(
  accessToken: string,
  options?: {
    onBatch?: OnBatch;
    onPhase?: OnPhase;
    /// Diagnostic-only — see asanaFetchAllPages' onPageMs.
    onPageMs?: OnPageMs;
    // The acting user's own configured Settings.timezone — not the server
    // process's ambient clock (see workload.ts's identical reasoning).
    // Defaults to UTC purely so the many existing tests below that don't
    // exercise timezone-sensitive behavior (pagination, dedup, staleness)
    // don't all need updating for an unrelated concern; every real caller
    // passes the acting user's actual zone explicitly.
    timezone?: string;
    /// Enables the durable (DB-backed) workspace cache — see listWorkspaces'
    /// own `db` param. Optional so this file's own tests (no real database)
    /// can keep calling this without it, same as today.
    userId?: string;
  },
): Promise<TaskListResult> {
  const existing = inFlightTaskFetches.get(accessToken);
  if (existing) {
    if (options?.onBatch) existing.onBatchListeners.add(options.onBatch);
    if (options?.onPhase) existing.onPhaseListeners.add(options.onPhase);
    if (options?.onPageMs) existing.onPageMsListeners.add(options.onPageMs);
    try {
      return await existing.promise;
    } finally {
      // A joiner's listener is only ever meaningful for the one fetch it
      // joined — removed once that settles rather than left registered,
      // since the *next* fetch for this token (this same caller included)
      // goes through this same function again and re-registers fresh.
      if (options?.onBatch) existing.onBatchListeners.delete(options.onBatch);
      if (options?.onPhase) existing.onPhaseListeners.delete(options.onPhase);
      if (options?.onPageMs) existing.onPageMsListeners.delete(options.onPageMs);
    }
  }

  const onBatchListeners = new Set<OnBatch>(options?.onBatch ? [options.onBatch] : []);
  const onPhaseListeners = new Set<OnPhase>(options?.onPhase ? [options.onPhase] : []);
  const onPageMsListeners = new Set<OnPageMs>(options?.onPageMs ? [options.onPageMs] : []);
  const promise = fetchAllIncompleteTasks(accessToken, {
    ...options,
    onBatch: (tasksSoFar, totalSoFar) => {
      for (const listener of onBatchListeners) listener(tasksSoFar, totalSoFar);
    },
    onPhase: (label) => {
      for (const listener of onPhaseListeners) listener(label);
    },
    onPageMs: (ms) => {
      for (const listener of onPageMsListeners) listener(ms);
    },
  });
  inFlightTaskFetches.set(accessToken, { promise, onBatchListeners, onPhaseListeners, onPageMsListeners });
  try {
    return await promise;
  } finally {
    inFlightTaskFetches.delete(accessToken);
  }
}

async function fetchAllIncompleteTasks(
  accessToken: string,
  options?: {
    onBatch?: OnBatch;
    onPhase?: OnPhase;
    onPageMs?: OnPageMs;
    timezone?: string;
    userId?: string;
  },
): Promise<TaskListResult> {
  const timezone = options?.timezone ?? 'UTC';
  const workspaces = await listWorkspaces(accessToken, options?.userId ? { userId: options.userId } : undefined);
  // Keyed by gid rather than a plain array so the full-fetch pass below can
  // *overwrite* a search-sourced entry, not just skip re-adding it — Asana's
  // Search API is only eventually consistent (see searchNearTermTasks), so
  // an entry seeded from it can carry a stale name/due date/completion
  // state even for a task that still legitimately exists. Whichever dto for
  // a given gid arrives from the full-fetch pass — the actual source of
  // truth, no date filter, covers the caller's entire assignment — always
  // wins over whatever the search pass guessed first.
  const byGid = new Map<string, { dto: AsanaTaskDto; task: RemoteTask & { projectGid: string | null } }>();
  // Gids added only from the near-term search pass below, not yet confirmed
  // by the full-fetch pass — a task deleted moments ago can still surface
  // in search for a while after the task itself is gone. Every gid gets
  // removed from this set the instant the full-fetch pass sees it (whether
  // it keeps or drops the entry); whatever's still marked pending after
  // both passes finish never got confirmed at all and is dropped rather
  // than trusted. Without this, a stale search hit would resurface on every
  // subsequent refresh too, since each call reruns the search fresh and
  // nothing else was ever pruning it.
  const pendingSearchOnly = new Set<string>();

  options?.onPhase?.('Looking for upcoming tasks…');
  const dueOnBefore = addDaysToDateStr(dateStrInTz(new Date(), timezone), 35);
  for (const ws of workspaces) {
    const nearTerm = await searchNearTermTasks(accessToken, ws.gid, dueOnBefore);
    for (const dto of nearTerm) {
      // Belt-and-suspenders: the search call already asked for
      // completed=false, but its index can lag behind a task's real
      // completion state (see TASK_OPT_FIELDS) — checked again here rather
      // than trusting that filter alone.
      if (dto.completed || byGid.has(dto.gid)) continue;
      byGid.set(dto.gid, { dto, task: toRemoteTask(dto, timezone) });
      pendingSearchOnly.add(dto.gid);
    }
    if (nearTerm.length) {
      options?.onBatch?.(
        [...byGid.values()].map((e) => e.task),
        byGid.size,
      );
    }
  }

  options?.onPhase?.('Fetching the rest of your tasks…');
  for (const ws of workspaces) {
    const path = `/tasks?assignee=me&workspace=${ws.gid}&completed_since=now&opt_fields=${TASK_OPT_FIELDS}`;
    await asanaFetchAllPages(accessToken, path, (page: AsanaTaskDto[]) => {
      for (const dto of page) {
        pendingSearchOnly.delete(dto.gid);
        // Authoritative either way: drops a stale not-completed search hit
        // that's actually done now, and otherwise always takes this dto —
        // fresher than whatever the search pass may have seeded — over any
        // existing entry for the same gid.
        if (dto.completed) byGid.delete(dto.gid);
        else byGid.set(dto.gid, { dto, task: toRemoteTask(dto, timezone) });
      }
      options?.onBatch?.(
        [...byGid.values()].filter((e) => !pendingSearchOnly.has(e.dto.gid)).map((e) => e.task),
        byGid.size,
      );
    }, options?.onPageMs);
  }
  // Anything the search pass added but the full, source-of-truth fetch
  // never confirmed (across every workspace, now that both passes are
  // done) is a stale search hit — drop it.
  for (const gid of pendingSearchOnly) byGid.delete(gid);
  const reconciled = [...byGid.values()];
  // Always resolved, not opt-in — since a call here can now be shared with
  // a concurrent caller that *does* need it (see inFlightTaskFetches/
  // listIncompleteAssignedTasks above), there's no single "this caller
  // doesn't need breadcrumbs" to opt out on behalf of. In practice this
  // costs nothing extra for the common case anyway: resolveBreadcrumbs
  // itself skips straight past any task that already has a project.
  options?.onPhase?.('Organizing your tasks…');
  // Re-emitted every 25 resolutions rather than every one: this drives an
  // SSE event per call, and on a large account that would be thousands of
  // writes for a label nobody can read that fast. Frequent enough to look
  // alive, and — because each one resets the client's stall watchdog — to
  // prove the boot is still moving during what is otherwise the longest
  // silent stretch of the whole fetch.
  await resolveBreadcrumbs(accessToken, reconciled, (done, total) => {
    if (total > 0 && (done % 25 === 0 || done === total)) options?.onPhase?.(`Organizing your tasks… ${done}/${total}`);
  });
  return reconciled.map((e) => e.task);
}

/// Asana's due_at (a full instant) and due_on (a bare date) are independent
/// task fields — 'dateOnly' sets due_on while explicitly clearing due_at,
/// which is exactly the "due today, no specific time" state most tasks
/// start in. Asana's update endpoint merges only the fields present in the
/// request body (confirmed by setTaskHours below, which sends `name` alone
/// without ever touching due_at/due_on), so each variant only needs to
/// name the fields it actually wants to change.
export type DueUpdate = { kind: 'instant'; dueAt: string } | { kind: 'dateOnly'; dueOn: string } | { kind: 'clear' };

export async function setTaskDueAt(accessToken: string, taskGid: string, due: DueUpdate, timezone: string): Promise<void> {
  const before = await asanaFetch(accessToken, `/tasks/${taskGid}?opt_fields=due_at,due_on,permalink_url`);
  const data =
    due.kind === 'instant' ? { due_at: due.dueAt } : due.kind === 'dateOnly' ? { due_on: due.dueOn, due_at: null } : { due_at: null, due_on: null };
  await asanaFetch(accessToken, `/tasks/${taskGid}`, { method: 'PUT', body: JSON.stringify({ data }) });
  recordChange({
    action: due.kind === 'clear' ? 'Remove due date' : before.due_at === null && before.due_on === null ? 'Set due date' : 'Reschedule',
    taskLink: before.permalink_url,
    dueBefore: before.due_at ?? before.due_on,
    dueAfter: due.kind === 'instant' ? due.dueAt : due.kind === 'dateOnly' ? due.dueOn : null,
    timezone,
  });
}

/// Sets the duration by rewriting the task's title bracket (e.g. "Draft
/// outline [4]"), matching the convention read by parseDurationFromTitle —
/// and by other internal tools (asana-to-mongo-replicator) that read the
/// same Asana workspace. `cleanName` is the title with any existing bracket
/// already stripped (what the frontend displays and holds as `task.name`).
export async function setTaskHours(accessToken: string, taskGid: string, cleanName: string, hours: number, timezone: string): Promise<void> {
  const before = await asanaFetch(accessToken, `/tasks/${taskGid}?opt_fields=name,permalink_url`);
  const newName = titleWithDuration(cleanName, hours);
  await asanaFetch(accessToken, `/tasks/${taskGid}`, {
    method: 'PUT',
    body: JSON.stringify({ data: { name: newName } }),
  });
  recordChange({
    action: 'Update estimate',
    taskLink: before.permalink_url,
    nameBefore: before.name,
    nameAfter: newName,
    timezone,
  });
}

/// `dueAt`/`hours` are optional — the plain refile/create panel (see
/// routes/tasks.ts's own createSchema-backed route) has neither a due
/// instant nor an estimate to offer, only a name, and omitting both here
/// leaves a task exactly as bare as `createTaskInProject`/`createSubtask`
/// always used to create it. A calendar-derived creation (routes/
/// calendar.ts's add-task) passes both, taking the entry's own end time and
/// duration — see store.svelte.ts's eventDurationHours. `assignee: 'me'`
/// is unconditional: this app only ever deals with tasks assigned to the
/// acting user, so a task it creates should already be one of them rather
/// than landing unassigned until the user notices and fixes it themselves.
export async function createTaskInProject(
  accessToken: string,
  projectGid: string,
  name: string,
  timezone: string,
  options?: { dueAt?: string; hours?: number },
): Promise<AsanaTaskDto> {
  const finalName = options?.hours !== undefined ? titleWithDuration(name, options.hours) : name;
  const data: Record<string, unknown> = { name: finalName, projects: [projectGid], assignee: 'me' };
  if (options?.dueAt) data.due_at = options.dueAt;
  const created = await asanaFetch(accessToken, '/tasks?opt_fields=name,permalink_url', {
    method: 'POST',
    body: JSON.stringify({ data }),
  });
  recordChange({ action: 'Create task', taskLink: created.permalink_url, nameAfter: created.name, timezone });
  return created;
}

export async function createSubtask(
  accessToken: string,
  parentTaskGid: string,
  name: string,
  timezone: string,
  options?: { dueAt?: string; hours?: number },
): Promise<AsanaTaskDto> {
  const finalName = options?.hours !== undefined ? titleWithDuration(name, options.hours) : name;
  const data: Record<string, unknown> = { name: finalName, assignee: 'me' };
  if (options?.dueAt) data.due_at = options.dueAt;
  const created = await asanaFetch(accessToken, `/tasks/${parentTaskGid}/subtasks?opt_fields=name,permalink_url`, {
    method: 'POST',
    body: JSON.stringify({ data }),
  });
  recordChange({ action: 'Create subtask', taskLink: created.permalink_url, nameAfter: created.name, timezone });
  return created;
}

/// A task filed nowhere — no project, no parent — landing straight in the
/// assignee's own My Tasks, same as createBugReportTask already does.
/// Deliberately the edge-case option alongside createTaskInProject/
/// createSubtask: routes/calendar.ts's add-task offers it as a third,
/// lesser choice below the project/subtask search, for a quick note from a
/// meeting that doesn't obviously belong anywhere yet. Needs a workspace to
/// create *into* even so — Asana has no bare, workspace-less task — so
/// this picks the first one the same way createBugReportTask does, on the
/// assumption (true for every account this app has actually seen) that
/// there's only one that matters.
export async function createBareTask(
  accessToken: string,
  name: string,
  timezone: string,
  userId: string,
  options?: { dueAt?: string; hours?: number },
): Promise<AsanaTaskDto> {
  const workspaces = await listWorkspaces(accessToken, { userId });
  const workspace = workspaces[0];
  if (!workspace) throw new Error('No Asana workspace found to create the task in');
  const finalName = options?.hours !== undefined ? titleWithDuration(name, options.hours) : name;
  const data: Record<string, unknown> = { name: finalName, workspace: workspace.gid, assignee: 'me' };
  if (options?.dueAt) data.due_at = options.dueAt;
  const created = await asanaFetch(accessToken, '/tasks?opt_fields=name,permalink_url', {
    method: 'POST',
    body: JSON.stringify({ data }),
  });
  recordChange({ action: 'Create task', taskLink: created.permalink_url, nameAfter: created.name, timezone });
  return created;
}

/// Re-files an *existing* task into a different project — additive, same
/// as Asana's own "Add to project": a task can belong to several projects
/// at once, so this doesn't touch whatever it was already in. See
/// setTaskParent below for the subtask equivalent. Triage's focus card
/// offers both, analogous to how an unlinked calendar entry gets filed
/// (see routes/calendar.ts's add-task), just against a task that already
/// exists instead of creating a new one.
export async function addTaskToProject(accessToken: string, taskGid: string, projectGid: string, timezone: string): Promise<void> {
  const task = await asanaFetch(accessToken, `/tasks/${taskGid}?opt_fields=name,permalink_url`);
  await asanaFetch(accessToken, `/tasks/${taskGid}/addProject`, {
    method: 'POST',
    body: JSON.stringify({ data: { project: projectGid } }),
  });
  recordChange({ action: 'Add to project', taskLink: task.permalink_url, nameBefore: task.name, nameAfter: task.name, timezone });
}

/// Re-parents an *existing* task as a subtask of another — same reasoning
/// as addTaskToProject above, just Asana's setParent endpoint instead.
export async function setTaskParent(accessToken: string, taskGid: string, parentGid: string, timezone: string): Promise<void> {
  const task = await asanaFetch(accessToken, `/tasks/${taskGid}?opt_fields=name,permalink_url`);
  await asanaFetch(accessToken, `/tasks/${taskGid}/setParent`, {
    method: 'POST',
    body: JSON.stringify({ data: { parent: parentGid } }),
  });
  recordChange({ action: 'Move to subtask', taskLink: task.permalink_url, nameBefore: task.name, nameAfter: task.name, timezone });
}

/// The Claude test/diagnostic Asana account (see the project's own memory
/// notes) — added as a follower on every bug report, best-effort, so a
/// future debugging session has a direct line to whatever got filed
/// in-app. Almost certainly a different workspace than whichever real
/// Asana account is connected, which is exactly why this is attempted
/// separately from task creation and never allowed to fail the report
/// itself (see the loop below).
const CLAUDE_TEST_ACCOUNT_GID = '1217636214552610';

/// The app owner's own Asana gid — bug reports always go to this person
/// specifically, regardless of which connected account actually files them
/// (see `submitterGid`, added as a follower instead). Hardcoded rather than
/// derived from the request because there's only ever one intended owner,
/// unlike the assignee, which used to be a bare 'me' shorthand resolving to
/// whoever's access token created the task.
const OWNER_GID = '1114484163652874';

/// Renders "today + 7 days" as an Asana due_on date string (YYYY-MM-DD) in
/// the given IANA timezone — mirrors changeLog.ts's formatInZone approach
/// rather than using the server's own local Date getters, which would drift
/// against the acting user's actual calendar day near a timezone boundary.
function dueInSevenDays(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(),
  );
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const due = new Date(get('year'), get('month') - 1, get('day'));
  due.setDate(due.getDate() + 7);
  return `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
}

/// In-app "Report a bug" — creates a plain task (no project; it's meant to
/// land straight in the owner's own My Tasks) always assigned to the owner
/// (see OWNER_GID), due in a week. `submitterGid` and the Claude test
/// account above are added as followers afterward, in their own
/// best-effort calls each — assignee alone is enough for the report to
/// exist and be seen, so a follower add failing (e.g. the test account's
/// workspace not matching the real one) never loses the report itself.
export async function createBugReportTask(
  accessToken: string,
  description: string,
  submitterGid: string | null,
  timezone: string,
  userId: string,
): Promise<AsanaTaskDto> {
  const workspaces = await listWorkspaces(accessToken, { userId });
  const workspace = workspaces[0];
  if (!workspace) throw new Error('No Asana workspace found to file the report in');
  const firstLine = description.split('\n')[0].trim().slice(0, 100) || 'Bug report';
  const created = await asanaFetch(accessToken, '/tasks?opt_fields=name,permalink_url', {
    method: 'POST',
    body: JSON.stringify({
      data: { name: `Bug report: ${firstLine}`, notes: description, workspace: workspace.gid, assignee: OWNER_GID, due_on: dueInSevenDays(timezone) },
    }),
  });
  recordChange({ action: 'Report a bug', taskLink: created.permalink_url, nameAfter: created.name, timezone });

  const followerGids = [submitterGid, CLAUDE_TEST_ACCOUNT_GID].filter((gid): gid is string => !!gid);
  for (const gid of followerGids) {
    try {
      await asanaFetch(accessToken, `/tasks/${created.gid}/addFollowers`, {
        method: 'POST',
        body: JSON.stringify({ data: { followers: [gid] } }),
      });
    } catch {
      // Cross-workspace or otherwise invalid follower — the report itself
      // is already filed and assigned regardless.
    }
  }
  return created;
}
