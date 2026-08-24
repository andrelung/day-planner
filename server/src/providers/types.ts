export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
}

/// A task normalized from Asana's shape into the frontend's Task shape.
export interface RemoteTask {
  gid: string;
  name: string;
  project: string;
  hours: number;
  /// Whether `hours` came from an actual bracket in the task's title
  /// (parseDurationFromTitle) or is just the "no bracket at all" default —
  /// both look identical as a plain number (a bracket-less task defaults to
  /// 1h), so anything that needs to tell "genuinely estimated at 1h" apart
  /// from "never estimated at all" (see routes/calendar.ts's link flow —
  /// linking a task with no real estimate silently adopts the calendar
  /// entry's own duration, one *with* a real, differing estimate asks
  /// first) needs this alongside `hours` itself.
  hasExplicitHours: boolean;
  /// "HH:MM" in the task's due_at, or null if only a due_on date (no time)
  /// or no due date at all was set.
  dueHour: string | null;
  /// ISO datetime this task is due, for queue sorting and conflict
  /// detection — null when there's no due_at.
  dueAt: string | null;
  /// "YYYY-MM-DD", set whenever there's any due date at all (with or
  /// without a time) — Asana always populates this alongside due_at, so
  /// it's the reliable "is this due on day X at all" check.
  dueOn: string | null;
  permalinkUrl: string;
}
