export type Screen =
  | 'loading'
  | 'login'
  | 'loginSecondary'
  | 'triage'
  | 'settings'
  | 'integrations'
  | 'pendingActions'
  | 'overview'
  | 'calendarView'
  | 'planToday'
  | 'planLater'
  | 'nextWeekDays'
  | 'pickDate'
  | 'freeSlotsLater'
  | 'dayFull'
  | 'slotConflict'
  | 'eventLinkConflict'
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
  /// "HH:MM" or null — null whenever there's no due_at at all (a date-only
  /// due date, or no due date). Display-only; anything computing whether a
  /// task is overdue should use dueAt instead (see Triage.svelte).
  dueHour: string | null;
  /// Full ISO instant (UTC), unlike dueHour's display-only "HH:MM" — used to
  /// figure out which calendar day/week a task actually falls on.
  dueAt: string | null;
  /// "YYYY-MM-DD", set whenever there's any due date at all (with or
  /// without a time) — used for "how many tasks are due today" counts,
  /// distinct from dueAt which is null unless a specific time is set too.
  dueOn: string | null;
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
  /// Full ISO instants (UTC) — used to bucket an event onto a calendar day
  /// (e.g. "is this today's event") the same way tasks use dueAt/dueOn,
  /// distinct from timeLabel which is display-only.
  start: string;
  end: string;
  linked: boolean;
  linkedName: string | null;
  /// The Asana task gid this event is linked to, or null — lets the
  /// Overview list jump straight to that task's own card (see
  /// openEventInTriage) instead of just landing on the event's date.
  linkedTaskGid: string | null;
  /// The linked task's own Asana permalink, or null — lets a detail panel
  /// open the linked task directly instead of only naming it.
  linkedTaskPermalinkUrl: string | null;
  /// Opens the event in Outlook on the web.
  webLink: string;
}

/// An Outlook event for one specific day, as returned alongside free-slots
/// — drawn read-only on DayCalendar so a meeting is visibly a reason a
/// time isn't free, same as an Asana task block. Carries the same
/// link/ignore state as CalendarEvent (unlike CalendarEvent, ignored events
/// aren't filtered out here — see calendar.ts's /free-slots route — since
/// an ignored event is still real busy time on the day, just one the user
/// has already decided not to link) so DayCalendar's blocks can be opened
/// into a detail panel instead of being purely decorative.
export interface OutlookBlock {
  id: string;
  title: string;
  start: string;
  end: string;
  linked: boolean;
  linkedName: string | null;
  linkedTaskGid: string | null;
  linkedTaskPermalinkUrl: string | null;
  ignored: boolean;
  webLink: string;
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

/// A link the user chose that would attach a task to a second calendar
/// event — stashed here while eventLinkConflict asks whether that's really
/// what they meant (see PlannerStore.linkEventToTask), same shape as
/// pendingSlotPlan for the equivalent double-booking guard.
export interface PendingEventLink {
  eventId: string;
  taskId: string;
  taskName: string;
  /// Carried through to the eventual success toast's "Open task" action.
  permalinkUrl: string;
  /// Title of the *other* event this task is already linked to, purely for
  /// the confirmation screen's copy.
  conflictingEventTitle: string;
  /// Screen the link attempt started from — Overview's inline panel,
  /// Triage's event card, and the calendar view's detail panel all reach
  /// linkEventToTask, so "choose a different task" needs to know which one
  /// to go back to.
  returnScreen: 'triage' | 'overview' | 'calendarView';
}

/// An optional action shown alongside a toast — "Retry" on a load failure,
/// "Undo" on most task-mutating actions, or "Open task" (via `href`) to
/// confirm a typeahead pick landed on the right Asana task. `href` renders
/// as a real `<a target="_blank">` rather than a button calling
/// window.open() — same reasoning as IconButton's href prop: on an iOS
/// home-screen PWA, window.open() from a click handler isn't reliably
/// treated as a direct user gesture and gets silently blocked.
export type ToastAction = { label: string } & ({ onClick: () => void; href?: undefined } | { href: string; onClick?: undefined });

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
