export type Screen =
  | 'loading'
  | 'login'
  | 'loginSecondary'
  | 'triage'
  | 'settings'
  | 'integrations'
  | 'pendingActions'
  | 'overview'
  | 'planToday'
  | 'planLater'
  | 'nextWeekDays'
  | 'pickDate'
  | 'freeSlotsLater'
  | 'dayFull'
  | 'slotConflict'
  | 'breakName'
  | 'breakTime'
  | 'breakDuration'
  | 'breakConfirm';

export interface Task {
  /// Asana task gid.
  id: string;
  name: string;
  project: string;
  hours: number;
  /// "HH:MM" or null. Presence is what makes a task "Overdue" instead of
  /// "Unplanned" — a task flagged `doubled` by the server always has this
  /// cleared, per the briefing's "unplanned if no time, or if doubled" rule.
  dueHour: string | null;
  /// Full ISO instant (UTC), unlike dueHour's display-only "HH:MM" — used to
  /// figure out which calendar day/week a task actually falls on.
  dueAt: string | null;
  /// "YYYY-MM-DD", set whenever there's any due date at all (with or
  /// without a time) — used for "how many tasks are due today" counts,
  /// distinct from dueAt which is null unless a specific time is set too.
  dueOn: string | null;
  doubled: boolean;
  permalinkUrl: string;
}

export interface WorkloadDay {
  key: string;
  label: string;
  date: string | null;
  /// Inclusive-exclusive ISO range for the aggregate "Next week" bucket;
  /// null for the single-day buckets (which use `date` instead).
  rangeStart: string | null;
  rangeEnd: string | null;
  planned: number;
  capacity: number;
  /// False for the client-computed placeholder shown before the real
  /// workload has loaded from the server — `planned`/`capacity` are just
  /// zeroed in that case, not real numbers. See store.svelte.ts's
  /// buildSkeletonWorkloadDays.
  loaded: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  timeLabel: string;
  linked: boolean;
  linkedName: string | null;
}

/// An Outlook event for one specific day, as returned alongside free-slots
/// — drawn read-only on DayCalendar so a meeting is visibly a reason a
/// time isn't free, same as an Asana task block.
export interface OutlookBlock {
  id: string;
  title: string;
  start: string;
  end: string;
}

export interface Project {
  gid: string;
  name: string;
}

export type Provider = 'asana' | 'outlook';

export interface PendingPlan {
  type: 'today' | 'later';
  key?: string;
}

export type PendingSlotPlan =
  | { kind: 'today'; slot: string }
  | { kind: 'later'; dayKey: string; slot: string }
  | { kind: 'break'; slot: string };

export interface ConflictItem {
  name: string;
  hours: number;
}

/// An optional action shown alongside a toast — "Retry" on a load failure,
/// "Undo" on most task-mutating actions.
export interface ToastAction {
  label: string;
  onClick: () => void;
}

/// A queued Asana write — set due time, set estimate, etc. — being applied
/// by the background worker instead of blocking the action that queued it.
/// See Settings' "Pending & Failed Actions".
export interface PendingActionDto {
  id: string;
  label: string;
  status: 'pending' | 'failed';
  attempts: number;
  lastError: string | null;
  createdAt: string;
}
