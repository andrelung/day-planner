import { env } from '../lib/env.js';
import type { OAuthTokenSet } from './types.js';
import { ProviderNotConfiguredError } from './asana.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const SCOPES = 'offline_access openid profile User.Read Calendars.Read';

/// Same reasoning as ASANA_FETCH_TIMEOUT_MS in asana.ts — without this, a
/// hung connection to Microsoft Graph leaves the fetch pending forever.
const GRAPH_FETCH_TIMEOUT_MS = 15_000;

function requireCredentials() {
  if (!env.MS_CLIENT_ID || !env.MS_CLIENT_SECRET) {
    throw new ProviderNotConfiguredError('outlook');
  }
  return { clientId: env.MS_CLIENT_ID, clientSecret: env.MS_CLIENT_SECRET };
}

function authorizeUrlBase(): string {
  return `https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/authorize`;
}
function tokenUrl(): string {
  return `https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`;
}
function redirectUri(): string {
  return `${env.PUBLIC_APP_URL}/auth/outlook/callback`;
}

export function getOutlookAuthorizeUrl(state: string): string {
  const { clientId } = requireCredentials();
  const url = new URL(authorizeUrlBase());
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);
  return url.toString();
}

interface MsTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

async function tokenRequest(body: Record<string, string>): Promise<MsTokenResponse> {
  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(GRAPH_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Microsoft token request failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as MsTokenResponse;
}

export async function exchangeOutlookCode(
  code: string,
): Promise<{ tokens: OAuthTokenSet; accountLabel: string; externalAccountId: string }> {
  const { clientId, clientSecret } = requireCredentials();
  const json = await tokenRequest({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code,
  });
  const tokens: OAuthTokenSet = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
    scope: json.scope,
  };
  const me = (await graphFetch(json.access_token, '/me?$select=id,displayName,mail,userPrincipalName')) as {
    id: string;
    displayName?: string;
    mail?: string;
    userPrincipalName?: string;
  };
  const accountLabel = me.displayName ? `${me.displayName} <${me.mail ?? me.userPrincipalName}>` : 'Outlook account';
  return { tokens, accountLabel, externalAccountId: me.id };
}

export async function refreshOutlookToken(refreshToken: string): Promise<OAuthTokenSet> {
  const { clientId, clientSecret } = requireCredentials();
  const json = await tokenRequest({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    scope: SCOPES,
    refresh_token: refreshToken,
  });
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
    scope: json.scope,
  };
}

async function graphFetch(accessToken: string, path: string): Promise<any> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' },
    signal: AbortSignal.timeout(GRAPH_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Graph API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export interface GraphEvent {
  id: string;
  subject: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  /// Opens the event in Outlook on the web — surfaced so a calendar-entry
  /// detail panel can open it externally without this app owning any of
  /// the event's real content.
  webLink: string;
}

function parseGraphUtcDateTime(dateTime: string): Date {
  // Prefer: outlook.timezone="UTC" makes Graph return e.g. "2024-01-01T10:00:00.0000000"
  // with no trailing offset — it's already UTC, just needs a "Z" to parse correctly.
  return new Date(dateTime.endsWith('Z') ? dateTime : `${dateTime}Z`);
}

/// Fetches calendar events between two dates (UTC), for both free-slot
/// computation and the "From your calendar" unlinked-events list.
export async function listEvents(accessToken: string, from: Date, to: Date): Promise<GraphEvent[]> {
  const path =
    `/me/calendarview?startDateTime=${encodeURIComponent(from.toISOString())}` +
    `&endDateTime=${encodeURIComponent(to.toISOString())}` +
    `&$select=id,subject,start,end,isAllDay,webLink&$orderby=start/dateTime&$top=100`;
  const json = await graphFetch(accessToken, path);
  return (json.value ?? [])
    .filter((e: any) => !e.isAllDay)
    .map((e: any) => ({
      id: e.id,
      subject: e.subject || '(No subject)',
      start: parseGraphUtcDateTime(e.start.dateTime),
      end: parseGraphUtcDateTime(e.end.dateTime),
      isAllDay: false,
      webLink: e.webLink,
    }));
}
