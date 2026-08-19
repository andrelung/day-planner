import { env } from '../lib/env.js';
import { cleanTitle, parseDurationFromTitle, titleWithDuration } from '../lib/titleDuration.js';
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
const SCOPES = 'openid email profile tasks:read tasks:write projects:read users:read workspaces:read';

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

interface AsanaTaskDto {
  gid: string;
  name: string;
  due_on: string | null;
  due_at: string | null;
  permalink_url: string;
  projects: { gid: string; name: string }[];
}

const TASK_OPT_FIELDS = 'name,due_on,due_at,permalink_url,projects.gid,projects.name';

function toRemoteTask(dto: AsanaTaskDto): RemoteTask & { projectGid: string | null } {
  const dueHour = dto.due_at ? dto.due_at.slice(11, 16) : null;
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
    permalinkUrl: dto.permalink_url,
  };
}

export async function listWorkspaces(accessToken: string): Promise<{ gid: string; name: string }[]> {
  const me = await asanaFetch(accessToken, '/users/me?opt_fields=workspaces.gid,workspaces.name');
  return me.workspaces ?? [];
}

/// Fetches every incomplete task assigned to the caller, across all of their
/// workspaces. Asana's API requires querying one workspace at a time.
export async function listIncompleteAssignedTasks(accessToken: string): Promise<(RemoteTask & { projectGid: string | null })[]> {
  const workspaces = await listWorkspaces(accessToken);
  const all: (RemoteTask & { projectGid: string | null })[] = [];
  for (const ws of workspaces) {
    const path = `/tasks?assignee=me&workspace=${ws.gid}&completed_since=now&opt_fields=${TASK_OPT_FIELDS}`;
    const tasks = (await asanaFetch(accessToken, path)) as AsanaTaskDto[];
    all.push(...tasks.map(toRemoteTask));
  }
  return all;
}

export async function setTaskDueAt(accessToken: string, taskGid: string, dueAtIso: string | null): Promise<void> {
  await asanaFetch(accessToken, `/tasks/${taskGid}`, {
    method: 'PUT',
    body: JSON.stringify({ data: dueAtIso ? { due_at: dueAtIso } : { due_at: null, due_on: null } }),
  });
}

/// Sets the duration by rewriting the task's title bracket (e.g. "Draft
/// outline [4]"), matching the convention read by parseDurationFromTitle —
/// and by other internal tools (asana-to-mongo-replicator) that read the
/// same Asana workspace. `cleanName` is the title with any existing bracket
/// already stripped (what the frontend displays and holds as `task.name`).
export async function setTaskHours(accessToken: string, taskGid: string, cleanName: string, hours: number): Promise<void> {
  await asanaFetch(accessToken, `/tasks/${taskGid}`, {
    method: 'PUT',
    body: JSON.stringify({ data: { name: titleWithDuration(cleanName, hours) } }),
  });
}

export async function createTaskInProject(accessToken: string, projectGid: string, name: string): Promise<AsanaTaskDto> {
  return asanaFetch(accessToken, '/tasks', {
    method: 'POST',
    body: JSON.stringify({ data: { name, projects: [projectGid] } }),
  });
}

export async function createSubtask(accessToken: string, parentTaskGid: string, name: string): Promise<AsanaTaskDto> {
  return asanaFetch(accessToken, `/tasks/${parentTaskGid}/subtasks`, {
    method: 'POST',
    body: JSON.stringify({ data: { name } }),
  });
}
