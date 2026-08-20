import { env } from '../lib/env.js';
import { cleanTitle, parseDurationFromTitle, titleWithDuration } from '../lib/titleDuration.js';
import { recordChange } from '../lib/changeLog.js';
import type { OAuthTokenSet, RemoteTask } from './types.js';

const AUTHORIZE_URL = 'https://app.asana.com/-/oauth_authorize';
const TOKEN_URL = 'https://app.asana.com/-/oauth_token';
const API_BASE = 'https://app.asana.com/api/1.0';

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
  const res = await fetch(TOKEN_URL, {
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
  const res = await fetch(`${API_BASE}${path}`, {
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
async function asanaFetchAllPages(accessToken: string, path: string, onPage?: (page: any[]) => void): Promise<any[]> {
  const all: any[] = [];
  // Asana hands back a ready-to-use `next_page.uri` for the following page —
  // simpler and less error-prone than reconstructing offset/limit by hand.
  let url: string | null = `${API_BASE}${path}${path.includes('?') ? '&' : '?'}limit=100`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      throw new Error(`Asana API ${url} failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as any;
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
  projects: { gid: string; name: string }[];
  parent: { gid: string; name: string; projects?: { gid: string; name: string }[] } | null;
}

// parent.projects.* is a best-effort one-level-deep lookahead — a subtask's
// immediate parent is usually the one that actually sits in a project, so
// this resolves the common case for free in the same request. Deeper
// nesting (subtask of a subtask) falls back to live lookups in
// resolveBreadcrumbs below.
const TASK_OPT_FIELDS = 'name,due_on,due_at,permalink_url,projects.gid,projects.name,parent.gid,parent.name,parent.projects.gid,parent.projects.name';

/// due_at is a real UTC instant (see setTaskDueAt) — reading its wall-clock
/// hour back has to go through Date's local getters (which respect this
/// process's TZ env var, i.e. the operator's timezone — see settings.ts),
/// not string-slicing: slicing reads the UTC digits directly, which are
/// only ever right on a UTC server. That mismatch is what made a task
/// dragged to, say, 11:00 redisplay a couple hours off.
function localHHMM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function toRemoteTask(dto: AsanaTaskDto): RemoteTask & { projectGid: string | null } {
  const dueHour = dto.due_at ? localHHMM(dto.due_at) : null;
  return {
    gid: dto.gid,
    // Display name is the "[4]"-stripped title — the duration lives in the
    // Estimate control, not cluttering the task name shown in the UI.
    name: cleanTitle(dto.name),
    project: dto.projects?.[0]?.name ?? 'No project',
    projectGid: dto.projects?.[0]?.gid ?? null,
    hours: parseDurationFromTitle(dto.name) ?? 1,
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
async function resolveBreadcrumbs(
  accessToken: string,
  entries: { dto: AsanaTaskDto; task: RemoteTask & { projectGid: string | null } }[],
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

  await Promise.all(
    entries.map(async ({ dto, task }) => {
      if (dto.projects?.length || !dto.parent) return;
      if (dto.parent.projects?.length) {
        task.project = `${dto.parent.projects[0].name} › ${dto.parent.name}`;
        return;
      }
      const chain = [dto.parent.name];
      let currentGid: string | null = dto.parent.gid;
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
    }),
  );
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

export async function listWorkspaces(accessToken: string): Promise<{ gid: string; name: string }[]> {
  const cached = workspaceCache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) return cached.workspaces;
  const me = await asanaFetch(accessToken, '/users/me?opt_fields=workspaces.gid,workspaces.name');
  const workspaces = me.workspaces ?? [];
  workspaceCache.set(accessToken, { workspaces, expiresAt: Date.now() + WORKSPACE_CACHE_TTL_MS });
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
): Promise<{ gid: string; name: string }[]> {
  const workspaces = await listWorkspaces(accessToken);
  const results = await Promise.all(
    workspaces.map((ws) =>
      asanaFetch(
        accessToken,
        `/workspaces/${ws.gid}/typeahead?resource_type=${resourceType}&query=${encodeURIComponent(query)}&count=20&opt_fields=name`,
      ) as Promise<{ gid: string; name: string }[]>,
    ),
  );
  const seen = new Set<string>();
  return results.flat().filter((r) => (seen.has(r.gid) ? false : (seen.add(r.gid), true)));
}

/// Fetches every incomplete task assigned to the caller, across all of their
/// workspaces. Asana's API requires querying one workspace at a time.
/// `withBreadcrumbs` resolves subtasks' project via their parent chain (see
/// resolveBreadcrumbs) — opt-in and off by default since it can mean extra
/// Asana API calls, so latency-sensitive callers that don't display the
/// project (slot-conflict checks, free-slot busy calculations) can skip it.
///
/// `onBatch` fires after each page with everything fetched *so far*
/// (cumulative, across workspaces) plus a running total — lets a caller
/// like the boot-time stream hand the client a usable (if not yet fully
/// breadcrumb-resolved) queue well before the whole fetch finishes, rather
/// than making them wait for the entire — possibly paginated many times
/// over — result.
export async function listIncompleteAssignedTasks(
  accessToken: string,
  options?: {
    withBreadcrumbs?: boolean;
    onBatch?: (tasksSoFar: (RemoteTask & { projectGid: string | null })[], totalSoFar: number) => void;
  },
): Promise<(RemoteTask & { projectGid: string | null })[]> {
  const workspaces = await listWorkspaces(accessToken);
  const entries: { dto: AsanaTaskDto; task: RemoteTask & { projectGid: string | null } }[] = [];
  for (const ws of workspaces) {
    const path = `/tasks?assignee=me&workspace=${ws.gid}&completed_since=now&opt_fields=${TASK_OPT_FIELDS}`;
    await asanaFetchAllPages(accessToken, path, (page: AsanaTaskDto[]) => {
      for (const dto of page) entries.push({ dto, task: toRemoteTask(dto) });
      options?.onBatch?.(
        entries.map((e) => e.task),
        entries.length,
      );
    });
  }
  if (options?.withBreadcrumbs) {
    await resolveBreadcrumbs(accessToken, entries);
  }
  return entries.map((e) => e.task);
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

export async function createTaskInProject(accessToken: string, projectGid: string, name: string, timezone: string): Promise<AsanaTaskDto> {
  const created = await asanaFetch(accessToken, '/tasks?opt_fields=name,permalink_url', {
    method: 'POST',
    body: JSON.stringify({ data: { name, projects: [projectGid] } }),
  });
  recordChange({ action: 'Create task', taskLink: created.permalink_url, nameAfter: created.name, timezone });
  return created;
}

export async function createSubtask(accessToken: string, parentTaskGid: string, name: string, timezone: string): Promise<AsanaTaskDto> {
  const created = await asanaFetch(accessToken, `/tasks/${parentTaskGid}/subtasks?opt_fields=name,permalink_url`, {
    method: 'POST',
    body: JSON.stringify({ data: { name } }),
  });
  recordChange({ action: 'Create subtask', taskLink: created.permalink_url, nameAfter: created.name, timezone });
  return created;
}
