import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { env } from './env.js';

/// A durable diagnostic log for "Could not load tasks from Asana" and its
/// relatives — plain JSON-lines rather than changeLog/matchLog's xlsx
/// pattern, since this is meant to be grepped/tailed while debugging, not
/// opened in Excel. Same repo-root-fallback/mounted-volume-override
/// reasoning as those two: without TASK_LOAD_LOG_PATH pointing at the
/// mounted host-root volume (see docker-compose.yml), the container's own
/// filesystem — and everything written to it — is thrown away on every
/// `rebuild.sh` recreate, which would defeat the entire point of logging
/// something intermittent over time.
const DEFAULT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../task-load-log.jsonl');
const LOG_PATH = env.TASK_LOAD_LOG_PATH || DEFAULT_PATH;

export interface TaskLoadLogEntry {
  /// 'server' = the request reached this server and something failed
  /// while handling it (Asana API error, token refresh failure, etc.) —
  /// see the /stream and GET / route catches. 'client' = reported by the
  /// browser itself (see api.ts's client-log call in store.svelte.ts),
  /// covering failures that never reached the server at all — most
  /// notably a fetch() rejecting outright right after an iOS resume,
  /// before the network stack has actually reconnected. That distinction
  /// is the whole reason this accepts both sources instead of only ever
  /// logging server-side: a purely server-side log would stay silent for
  /// exactly the "instant failure on reopening the app" case this was
  /// built to catch.
  source: 'server' | 'client';
  /// Which code path failed — 'boot' (initial SSE stream), 'refresh'
  /// (plain GET /, used by both the resume handler and other in-app
  /// refreshes), or a route name for other server-side failures.
  phase: string;
  message: string;
  userId?: string;
  /// Client-reported only — navigator.onLine at the moment the failure
  /// was caught, a rough signal for "was this a network blip right at
  /// resume" vs. a genuine server/Asana-side failure.
  online?: boolean;
}

export function logTaskLoadFailure(entry: TaskLoadLogEntry): void {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
  try {
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch (err) {
    // Diagnostic logging is a side effect, never allowed to break the
    // actual request/response it's attached to.
    console.error('taskLoadLog: failed to append', err);
  }
}
