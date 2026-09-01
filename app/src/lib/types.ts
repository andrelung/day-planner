export type Screen =
  | 'loading'
  | 'welcome'
  | 'login'
  | 'loginSecondary'
  | 'workday'
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
  | 'eventHoursConflict'
  | 'ignoreTitlePrompt'
  | 'breakName'
  | 'breakTime'
  | 'breakDuration'
  | 'breakConfirm'
  | 'backlogExplainer';

export interface Task {
  /// Asana task gid.
  id: string;
  name: string;
  project: string;
  hours: number;
  /// Whether `hours` came from a real duration bracket in the task's title
  /// or is just the no-bracket-at-all default (both display as a plain
  /// number — a bracket-less task defaults to 1h) — see the server's
  /// RemoteTask for the full reasoning. Used by the calendar-link flow to
  /// tell "never estimated" apart from "genuinely estimated at 1h".
  hasExplicitHours: boolean;
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

/// The extra detail shown on Triage's focus card once "Up next" is
/// collapsed (see Triage.svelte) — fetched on demand per task, not part of
/// Task above (see server/src/providers/asana.ts's getTaskDetails for why).
export interface TaskDetails {
  description: string;
  collaborators: { gid: string; name: string }[];
  createdAt: string;
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

/// taskId is captured at the moment the conflict is detected (see
/// tryPlanTodaySlot/tryPlanLaterSlot) rather than trusting focusTaskRaw to
/// still be the same task by the time the user actually resolves the
/// conflict — the queue can legitimately re-sort itself (a background
/// task-list refresh, e.g. on app resume) while the SlotConflict screen is
/// sitting there waiting for a tap, which used to mean "Double-book
/// anyway" could silently commit a completely different task than the one
/// that actually triggered the conflict. 'break' has no task of its own
/// (see commitBreak), so it doesn't need one.
export type PendingSlotPlan =
  | { kind: 'today'; slot: string; taskId: string }
  | { kind: 'later'; dayKey: string; slot: string; taskId: string }
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

/// Stashed while eventHoursConflict asks how to reconcile a task's own
/// (real, bracket-set) estimate against the calendar entry it's about to be
/// linked to — see PlannerStore.linkEventToTaskAfterConflictCheck. Only
/// raised when the two genuinely disagree; a task with no real estimate at
/// all silently adopts the calendar entry's duration instead of asking.
export interface PendingHoursConflict {
  eventId: string;
  /// Purely for the confirmation screen's copy.
  eventTitle: string;
  taskId: string;
  taskName: string;
  permalinkUrl: string;
  /// The clean (bracket-stripped) title — needed to rebuild the estimate
  /// bracket if the user picks "update" (see PATCH /api/tasks/:gid).
  cleanName: string;
  /// The calendar entry's own end time — every resolution links the task
  /// AND sets this as its due instant, independent of which hours option
  /// gets picked.
  dueAtIso: string;
  taskHours: number;
  eventHours: number;
  returnScreen: 'triage' | 'overview' | 'calendarView';
}

/// Stashed while ignoreTitlePrompt asks whether to start auto-ignoring a
/// title, once ignoring a single instance shows the server-reported count
/// of separately-ignored instances of it has reached 2+ (see
/// PlannerStore.ignoreEvent) — this instance is already ignored either way,
/// this is purely about whether *future* instances should be too.
export interface PendingIgnoreTitlePrompt {
  eventId: string;
  title: string;
  /// How many separate instances of this title have now been individually
  /// ignored, including this one — shown directly in the prompt's copy.
  count: number;
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
