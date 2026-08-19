export type Screen =
  | 'loading'
  | 'login'
  | 'loginSecondary'
  | 'triage'
  | 'settings'
  | 'integrations'
  | 'overview'
  | 'planToday'
  | 'planLater'
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
  doubled: boolean;
  permalinkUrl: string;
}

export interface WorkloadDay {
  key: string;
  label: string;
  date: string | null;
  planned: number;
  capacity: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  timeLabel: string;
  linked: boolean;
  linkedName: string | null;
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
