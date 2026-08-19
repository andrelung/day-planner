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
  /// "HH:MM" in the task's due_at, or null if only a due_on date (no time)
  /// or no due date at all was set.
  dueHour: string | null;
  /// ISO datetime this task is due, for queue sorting and doubled-slot
  /// detection — null when there's no due_at.
  dueAt: string | null;
  permalinkUrl: string;
}
