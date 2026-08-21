import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { env } from './env.js';

/// A durable, general-purpose log for "this branch shouldn't normally run"
/// client-side defensive guards — the slot-conflict double-commit bug (a
/// stale pendingSlotPlan silently double-booking the wrong task on a fast
/// double-tap) is exactly the kind of thing this exists to catch early:
/// the guard that now prevents it firing at all in production would
/// otherwise leave no trace once it's done its job. Same JSON-lines/
/// mounted-volume reasoning as taskLoadLog.ts — grepped/tailed while
/// debugging, and survives `rebuild.sh` recreating the container, which a
/// plain console.log wouldn't.
///
/// Deliberately separate from taskLoadLog.ts rather than folded into it:
/// that one is specifically about "Could not load tasks from Asana" and
/// its network/Asana-side causes, with fields (phase, online) that only
/// make sense for that. This one is for arbitrary "a defensive guard
/// fired, which means some assumption elsewhere didn't hold" reports from
/// anywhere in the app, so its shape stays intentionally generic instead.
const DEFAULT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../anomaly-log.jsonl');
const LOG_PATH = env.ANOMALY_LOG_PATH || DEFAULT_PATH;

export interface AnomalyEntry {
  /// Which guard fired — e.g. "resolveConflictAnyway.noPendingPlan" —
  /// specific enough to grep for a single call site directly.
  area: string;
  message: string;
  userId?: string;
  /// Small bag of whatever's useful for that specific area (current
  /// screen, a relevant id, ...) — kept as free-form JSON rather than a
  /// fixed schema since different guards care about different things.
  context?: Record<string, unknown>;
}

export function logAnomaly(entry: AnomalyEntry): void {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
  try {
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch (err) {
    // Diagnostic logging is a side effect, never allowed to break whatever
    // it's attached to.
    console.error('anomalyLog: failed to append', err);
  }
}
