import type {
  CalendarEvent,
  ConflictItem,
  OutlookBlock,
  PendingActionDto,
  PendingEventLink,
  PendingPlan,
  PendingSlotPlan,
  Project,
  Provider,
  Screen,
  Task,
  ToastAction,
  WorkloadDay,
} from './types';
import { api, ApiError } from './api';
import { fmtHours, slotStartTime } from './format';
import { BUILD_ID } from './version';
import { stringSimilarity } from 'string-similarity-js';

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastRetryInterval: ReturnType<typeof setInterval> | undefined;

/// Lowercased, diacritic- and punctuation-stripped, whitespace-collapsed —
/// normalizes e.g. "Kick-off: Q3-Planung" and "kickoff q3 planung" to
/// directly comparable forms before scoring similarity or picking a search
/// seed word (see nameSimilarity and searchSeedFor below).
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
/// A 0..1 name-similarity score for ranking suggestedTaskMatches —
/// Dice's coefficient over character bigrams (string-similarity-js),
/// not a whole-word match. Word-overlap matching would score a calendar
/// event titled "Kundengespräch Telekom" against a task named "Kunde
/// Termin Telekom" as barely related ("Kundengespräch" and "Kunde"/
/// "Termin" don't literally match as tokens) — German's compounding
/// especially breaks that assumption often enough that character-level
/// comparison is the more reliable default, and it degrades gracefully
/// for typos/abbreviations instead of just returning zero once there's no
/// exact word in common.
function nameSimilarity(a: string, b: string): number {
  return stringSimilarity(normalizeForMatch(a), normalizeForMatch(b));
}
/// Picks the single most distinctive word from a title to seed the add
/// panel's search box with (see openAddPanel) — a calendar event's first
/// word is very often a generic meeting-type prefix ("Abstimmung", "Sync",
/// "Kickoff"...), not anything that'd actually narrow down Asana's own
/// typeahead, so picking blindly by position doesn't work well. The
/// longest word left after dropping short connectors is a much better bet
/// for "distinctive" without needing a maintained stopword list — filler
/// words rarely end up being the single longest word in a real title.
function searchSeedFor(title: string): string {
  const words = title.trim().split(/\s+/).filter((w) => normalizeForMatch(w).length > 2);
  return words.length === 0 ? '' : words.reduce((best, w) => (w.length > best.length ? w : best));
}

/// Non-linear duration steps for every hours stepper in the app (estimate
/// editing, split-into-a-part duration) — fine-grained near zero where the
/// difference between e.g. 0.3h and 0.5h actually matters, coarsening as
/// the value grows and that precision stops being useful.
const HOUR_STEPS = [
  0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 1, 1.2, 1.5, 1.8, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40,
];

function stepHours(current: number, dir: 1 | -1, max = 40): number {
  const steps = HOUR_STEPS.filter((v) => v <= max);
  if (dir > 0) {
    const next = steps.find((v) => v > current + 1e-9);
    return next ?? steps[steps.length - 1];
  }
  const prev = [...steps].reverse().find((v) => v < current - 1e-9);
  return prev ?? steps[0];
}

/// Mirrors the server's buildWorkloadDays (workload.ts) exactly — the day
/// structure (which keys, which labels, which dates) is a pure function of
/// "now", no server round-trip actually needed for it, only the real
/// planned/capacity numbers are. Used to seed `workloadDays` immediately
/// so day rows (Overview, "When later?") and date-dependent actions
/// (loading free slots) work right away instead of waiting on
/// /api/workload — each entry's `loaded` stays false, and its
/// planned/capacity are just zeroed, until refreshWorkload() replaces them
/// with the real thing.
function buildSkeletonWorkloadDays(now: Date): WorkloadDay[] {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
  const addDays = (d: Date, n: number) => {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  };
  const toDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const today = startOfDay(now);
  const named: Date[] = [today];
  let cursor = today;
  while (named.length < 6) {
    cursor = addDays(cursor, 1);
    if (!isWeekend(cursor)) named.push(cursor);
  }
  const [d0, d1, d2, d3, d4, d5] = named;
  const base = { planned: 0, capacity: 0, loaded: false, rangeStart: null, rangeEnd: null };
  const days: WorkloadDay[] = [
    { ...base, key: 'today', label: 'Today', date: toDateStr(d0) },
    { ...base, key: 'tomorrow', label: 'Tomorrow', date: toDateStr(d1) },
    { ...base, key: 'day2', label: d2.toLocaleDateString('en-US', { weekday: 'long' }), date: toDateStr(d2) },
    { ...base, key: 'day3', label: d3.toLocaleDateString('en-US', { weekday: 'long' }), date: toDateStr(d3) },
    { ...base, key: 'day4', label: d4.toLocaleDateString('en-US', { weekday: 'long' }), date: toDateStr(d4) },
    { ...base, key: 'day5', label: d5.toLocaleDateString('en-US', { weekday: 'long' }), date: toDateStr(d5) },
  ];
  const nextWeekStart = addDays(d5, 1);
  const nextWeekEnd = addDays(nextWeekStart, 7);
  days.push({ ...base, key: 'nextweek', label: 'Next week', date: null, rangeStart: nextWeekStart.toISOString(), rangeEnd: nextWeekEnd.toISOString() });
  return days;
}

interface MeResponse {
  primaryProvider: 'ASANA' | 'OUTLOOK';
  asanaConnected: boolean;
  outlookConnected: boolean;
  asanaAccountLabel: string | null;
  outlookAccountLabel: string | null;
  settings: {
    prefStartTime: string;
    prefEndTime: string;
    bufferMinutes: number;
    timezone: string;
    skipDayFullWarning: boolean;
    confirmDoubleBooking: boolean;
  };
}

class PlannerStore {
  screen: Screen = $state('loading');
  bootError: string | null = $state(null);

  primaryProvider: 'ASANA' | 'OUTLOOK' | null = $state(null);
  asanaConnected = $state(false);
  outlookConnected = $state(false);
  asanaAccountLabel: string | null = $state(null);
  outlookAccountLabel: string | null = $state(null);

  tasks: Task[] = $state([]);
  /// Tasks with no due date at all — excluded from `tasks` (the swipeable
  /// triage loop) entirely, surfaced instead via "Tasks without Due Date"
  /// on the Overview screen.
  tasksWithoutDueDate: Task[] = $state([]);
  projects: Project[] = $state([]);
  private _focusIndex = $state(0);
  /// Whichever date the Triage screen is currently showing — the queue-nav
  /// arrows and Overview's day rows drive this directly (see jumpToDate),
  /// and the focusIndex setter below keeps it in sync automatically the
  /// rest of the time (swiping through the queue, a plan committing and
  /// advancing to the next task, etc.), so most code never has to think
  /// about which one is authoritative. Not clamped to today when a task is
  /// overdue — an overdue-from-yesterday task genuinely shows "Yesterday".
  activeDate: string = $state(this.toDateStr(new Date()));
  /// Set by openEventInTriage when a calendar entry is clicked directly in
  /// Overview — shows that event's card in Triage even if it's already
  /// linked (normal day-gating only ever shows unlinked ones — see
  /// activeDayUnlinkedEvents), so re-visiting a linked entry offers a way
  /// to change which task it's linked to instead of just landing on
  /// whatever else that day happens to hold. Cleared by jumpToDate (any
  /// other navigation) and closeSearchPanel (done editing this one).
  pinnedEventId: string | null = $state(null);
  get focusIndex(): number {
    return this._focusIndex;
  }
  set focusIndex(v: number) {
    this._focusIndex = v;
    this.activeDate = this.queueTasks[v]?.dueOn ?? this.toDateStr(new Date());
  }

  /// Tasks just committed (planned/moved/split) during this Triage visit —
  /// hidden from the swipeable queue (queueTasks) so the loop moves on to
  /// the next thing instead of possibly showing the same task right back,
  /// but still fully present in `tasks` itself (still counted in workload,
  /// still shown on the day calendar, etc.). Cleared when the user leaves
  /// Triage for Settings/Overview and comes back — see closeSettings/
  /// closeOverview — not on every commit, so a whole planning session
  /// doesn't creep back in piecemeal.
  private justPlannedIds: string[] = $state([]);
  /// "Tasks without Due Date" in Overview opens this same swipeable Triage
  /// loop, just fed from tasksWithoutDueDate instead — "I don't know what
  /// to do, let's scroll through my backlog." See reviewBacklog().
  reviewingBacklog = $state(false);
  get queueTasks(): Task[] {
    const source = this.reviewingBacklog ? this.tasksWithoutDueDate : this.tasks;
    return this.justPlannedIds.length === 0 ? source : source.filter((t) => !this.justPlannedIds.includes(t.id));
  }

  dragX = $state(0);
  dragging = $state(false);

  editingHours = $state(false);
  hoursDraft = $state(0);

  editingRestId: string | null = $state(null);
  restHoursDraft = $state(0);

  workloadDays: WorkloadDay[] = $state(buildSkeletonWorkloadDays(new Date()));

  laterDayKey: string | null = $state(null);
  customDateValue = $state('');
  customDayLabel = $state('');
  planTodaySlots: string[] = $state([]);
  laterSlots: string[] = $state([]);
  todaySlotsLoading = $state(false);
  laterSlotsLoading = $state(false);
  todayOutlookEvents: OutlookBlock[] = $state([]);
  laterOutlookEvents: OutlookBlock[] = $state([]);

  breakNameDraft = $state('');
  breakTimeSlot: string | null = $state(null);
  breakDuration = $state(1);
  breakTimeSlots: string[] = $state([]);

  prefStartTime = $state('09:00');
  prefEndTime = $state('18:00');
  bufferMinutes = $state(10);
  timezone = $state('UTC');
  skipDayFullWarning = $state(false);
  confirmDoubleBooking = $state(true);

  activePanelEventId: string | null = $state(null);
  activePanelMode: 'add' | 'link' | null = $state(null);
  searchQuery = $state('');
  events: CalendarEvent[] = $state([]);

  pendingPlan: PendingPlan | null = $state(null);
  pendingSlotPlan: PendingSlotPlan | null = $state(null);
  conflictItems: ConflictItem[] = $state([]);
  pendingEventLink: PendingEventLink | null = $state(null);

  toastMsg: string | null = $state(null);

  /// Bumped (never reset) each time a day gets fully planned, so the UI can
  /// key a confetti burst off it — incrementing rather than a boolean means
  /// two celebrations back-to-back both restart the animation instead of the
  /// second one being a no-op because "celebrating" was already true.
  celebrationKey = $state(0);
  /// What the burst is celebrating (e.g. "Today is fully planned!") — set
  /// alongside celebrationKey, see bumpWorkloadLocally.
  celebrationLabel = $state('');

  // --- derived ---
  get focusTaskRaw(): Task | null {
    return this.queueTasks.length > 0 ? this.queueTasks[this.focusIndex] : null;
  }
  get hasFocusTask() {
    return this.queueTasks.length > 0;
  }
  get todayWorkload(): WorkloadDay | null {
    return this.workloadDays.find((d) => d.key === 'today') ?? null;
  }
  get todayRatio() {
    const t = this.todayWorkload;
    return t ? t.planned / t.capacity : 0;
  }
  /// Grey while the workload behind this badge is being (re)fetched, or
  /// before it's ever loaded at all — showing green by default in that gap
  /// would misleadingly read as "you're under capacity" when the truth is
  /// just "unknown yet".
  get todayBadgeBg() {
    if (this.workloadLoading || !this.todayWorkload?.loaded) return 'var(--color-text-muted)';
    return this.todayRatio >= 1 ? 'var(--color-feedback-wrong)' : 'var(--color-feedback-correct)';
  }
  get todayBadgeLabel() {
    const t = this.todayWorkload;
    return t?.loaded ? `${t.planned}/${t.capacity}h` : '';
  }
  private get todayDateStr(): string {
    return this.toDateStr(new Date());
  }
  private get yesterdayDateStr(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return this.toDateStr(d);
  }
  /// Tasks due today, by Asana's due date (dueOn — set whether or not a
  /// specific time is attached), independent of the "unplanned if no time"
  /// triage-queue rule elsewhere in the app.
  private get tasksDueToday(): Task[] {
    const todayStr = this.todayDateStr;
    return this.tasks.filter((t) => t.dueOn === todayStr);
  }
  /// Every task whose due date has already passed — the same definition
  /// navigableDates uses, exposed directly for Overview's "Past days" row
  /// (see focusPastDays).
  get overdueTasks(): Task[] {
    const todayStr = this.todayDateStr;
    return this.tasks.filter((t): t is Task & { dueOn: string } => !!t.dueOn && t.dueOn < todayStr);
  }
  /// Every date the queue-nav arrows and Overview's day rows can land on:
  /// each concrete named workload day (today..day5) whether or not it has
  /// any task or event yet (see focusQueueForDay), plus any earlier date
  /// that still has an overdue task pending — so "Yesterday" and further
  /// back stay reachable instead of being folded into today. The aggregate
  /// "Next week" bucket isn't included: it's a 7-day range, not one date.
  private get navigableDates(): string[] {
    const named = this.workloadDays.filter((d): d is WorkloadDay & { date: string } => !!d.date).map((d) => d.date);
    const overdue = this.overdueTasks.map((t) => t.dueOn);
    return [...new Set([...overdue, ...named])].sort();
  }
  /// Points the Triage screen at a specific date — focusIndex follows along
  /// if that date has a task (so the existing plan/split/remove-due-date
  /// actions keep operating on the right one), but activeDate is set
  /// either way, so a date with no task at all (just events, or nothing)
  /// is still reachable and displayed.
  private jumpToDate(date: string) {
    this.pinnedEventId = null;
    const idx = this.queueTasks.findIndex((t) => t.dueOn === date);
    if (idx >= 0) this.focusIndex = idx;
    this.activeDate = date;
  }
  /// The active day's calendar events that haven't been linked to a task
  /// (or added as one) yet — these gate the Triage focus card ahead of any
  /// task on that same day (see Triage.svelte), since an event's time is
  /// already fixed on the calendar, unlike a task that still needs a slot
  /// picked for it. Follows activeDate rather than being pinned to literal
  /// today, so jumping to another day (Overview's day rows) or crossing a
  /// day boundary (goPrev/goNext) surfaces that day's events too, not just
  /// today's. Ignored events never reach here — the server excludes them
  /// from /api/calendar/events entirely.
  get activeDayUnlinkedEvents(): CalendarEvent[] {
    const active = this.activeDate;
    return this.events.filter((e) => !e.linked && this.toLocalDateStr(e.start) === active);
  }
  private get tasksForActiveDay(): Task[] {
    return this.tasks.filter((t) => t.dueOn === this.activeDate);
  }
  /// Shared by queueLabel, Triage's date-nav header and its Up Next
  /// day-section headers — same "which named bucket (or Yesterday, or a
  /// formatted date) does this date fall under" logic everywhere, no
  /// clamping: an overdue task keeps its own real due date rather than
  /// being folded into "Today".
  dayLabelFor(dueOn: string | null): string {
    if (!dueOn) return '';
    const namedDay = this.workloadDays.find((d) => d.date === dueOn);
    if (namedDay) return namedDay.label;
    if (dueOn === this.yesterdayDateStr) return 'Yesterday';
    return new Date(`${dueOn}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  }
  get queueLabel() {
    if (this.reviewingBacklog) {
      const n = this.queueTasks.length;
      return `Backlog - ${n} task${n === 1 ? '' : 's'} without a due date`;
    }
    const dateLabel = this.dayLabelFor(this.activeDate);
    const dueThatDay = this.tasksForActiveDay;
    const withTime = dueThatDay.filter((t) => t.dueAt).length;
    return `${dateLabel} - ${withTime}/${dueThatDay.length} timeslots assigned`;
  }
  get chosenDayLabel() {
    if (this.laterDayKey === 'custom') return this.customDayLabel;
    return this.workloadDays.find((d) => d.key === this.laterDayKey)?.label ?? '';
  }
  get planTargetLabel() {
    const t = this.focusTaskRaw;
    return t ? `${t.name} · needs ${fmtHours(t.hours)}` : '';
  }

  // --- toast ---
  toastAction: ToastAction | null = $state(null);
  toastRetry: { secondsLeft: number; onRetry: () => void } | null = $state(null);
  /// `action` gets its own longer window (5s vs 2.6s) since it takes a
  /// moment to notice there's something to tap, on top of reading the
  /// message itself.
  showToast(msg: string, action?: ToastAction) {
    clearTimeout(toastTimer);
    clearInterval(toastRetryInterval);
    this.toastMsg = msg;
    this.toastAction = action ?? null;
    this.toastRetry = null;
    toastTimer = setTimeout(() => {
      this.toastMsg = null;
      this.toastAction = null;
    }, action ? 5000 : 2600);
  }
  /// An error toast that counts down and retries on its own unless the user
  /// steps in — "Abort" cancels for good, "Retry now" skips the wait. Used
  /// for failures worth self-healing from without requiring the user to
  /// notice and tap a plain "Retry" button, most importantly the boot-time
  /// task load: staying broken there means an empty Triage screen until
  /// someone happens to tap Retry.
  showRetryToast(msg: string, onRetry: () => void, seconds = 3) {
    clearTimeout(toastTimer);
    clearInterval(toastRetryInterval);
    this.toastMsg = msg;
    this.toastAction = null;
    this.toastRetry = { secondsLeft: seconds, onRetry };
    toastRetryInterval = setInterval(() => {
      if (!this.toastRetry) return;
      if (this.toastRetry.secondsLeft <= 1) this.retryNow();
      else this.toastRetry = { ...this.toastRetry, secondsLeft: this.toastRetry.secondsLeft - 1 };
    }, 1000);
  }
  retryNow() {
    const retry = this.toastRetry;
    this.dismissToast();
    retry?.onRetry();
  }
  abortRetry() {
    this.dismissToast();
  }
  dismissToast() {
    clearTimeout(toastTimer);
    clearInterval(toastRetryInterval);
    this.toastMsg = null;
    this.toastAction = null;
    this.toastRetry = null;
  }

  private reportError(err: unknown, fallback: string, action?: ToastAction) {
    const msg = err instanceof ApiError ? err.message : fallback;
    this.showToast(msg, action);
  }
  /// Same idea as reportError, but for failures that should self-heal via
  /// showRetryToast above instead of a plain single "Retry" action.
  private reportRetryableError(err: unknown, fallback: string, onRetry: () => void) {
    const msg = err instanceof ApiError ? err.message : fallback;
    this.showRetryToast(msg, onRetry);
  }
  /// Best-effort report to the server's task-load diagnostic log (see
  /// server/src/lib/taskLoadLog.ts) for "Could not load tasks from Asana"
  /// failures specifically — a plain `catch` + toast leaves no trace once
  /// the toast disappears, which makes an intermittent, hard-to-reproduce
  /// failure (e.g. right after reopening the app) effectively unfalsifiable
  /// without the user noticing and describing it in the moment. An
  /// ApiError means the request reached the server and got a real error
  /// response back (already logged server-side too, from that same
  /// request — this call is still useful for correlating the two); any
  /// other error (a bare fetch() rejection) means it never reached the
  /// server at all, which the server-side log alone could never capture.
  private logTaskLoadFailure(phase: 'boot' | 'refresh', err: unknown) {
    api
      .post('/api/tasks/client-log', {
        phase,
        message: err instanceof Error ? err.message : String(err),
        errorType: err instanceof ApiError ? 'server' : 'network',
        online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
      })
      .catch(() => {});
  }
  /// Best-effort report to the server's general anomaly log (see
  /// server/src/lib/anomalyLog.ts) — for defensive guards elsewhere in this
  /// file that fire on a branch that's only ever meant to run if some
  /// assumption didn't hold (a stale pendingSlotPlan on a fast double-tap
  /// was the bug this was built to have caught early — see
  /// resolveConflictAnyway). `area` should be specific enough to grep for
  /// this exact call site alone, e.g. "resolveConflictAnyway.noPendingPlan".
  private logAnomaly(area: string, message: string, context?: Record<string, unknown>) {
    api.post('/api/diagnostics/anomaly', { area, message, context }).catch(() => {});
    // A repeated stale/duplicate invocation like this is exactly the
    // signature a stuck-WKWebView-frame bug leaves behind (see App.svelte's
    // forceRepaint): the tap's own handler runs fine and finds state that
    // already moved on, while the screen the user can actually see never
    // caught up — confirmed live via this exact log (resolveConflictAnyway/
    // resolveConflictChooseAnother firing on every stale tap of a SlotConflict
    // screen that had already resolved to Triage underneath). Nudging a
    // repaint here costs nothing on a genuine one-off double-tap, and gives
    // a real shot at unsticking the rarer case where it's the whole screen.
    window.dispatchEvent(new Event('day-planner:force-repaint'));
  }

  // --- boot ---
  // Surfaced on the loading screen (see App.svelte) so the wait between
  // "app opened" and "first task visible" always shows *something*
  // happening. Every value this ever takes names a real step the server is
  // actually doing right now (see streamTasks' `phase` event and
  // listIncompleteAssignedTasks' onPhase in asana.ts) — this used to cycle
  // through a fixed set of generic phrases on a blind timer regardless of
  // what was actually happening server-side, which just meant the screen
  // kept changing without any of it being true.
  bootStatus = $state('Connecting to Asana…');

  // --- update notice ---
  // A PWA can sit open for days (see schedulePeriodicTaskRefresh's comment
  // on iOS not reliably firing resume events) — long enough to be running
  // noticeably older code than what's actually deployed. /api/version
  // reports the server's own build; a mismatch against this client's own
  // baked-in BUILD_ID means a newer build exists and a reload would pick
  // it up. Compares BUILD_ID, not GIT_COMMIT — GIT_COMMIT only changes on
  // a real `git commit`, so a whole stretch of uncommitted rebuilds (the
  // normal case while iterating on a feature, which is most of the time)
  // all share one commit hash and would never register as "different" to
  // a commit-only check, even though the running JS had genuinely changed
  // on every one of those rebuilds. BUILD_ID is unique on every single
  // rebuild.sh invocation regardless of git state (see its own comment).
  // `updateAvailableBuildId` is null until a mismatch is detected. Runs
  // independent of auth (called from boot(), not enterTriage()) so it
  // still surfaces on the Login screen.
  updateAvailableBuildId: string | null = $state(null);
  private dismissedUpdateBuildId: string | null = null;
  /// Not private — App.svelte's resume() also calls this directly, on the
  /// same background/foreground transition that triggers refreshTasks().
  async checkForUpdate() {
    if (BUILD_ID === 'dev') return; // no build step to be stale against
    try {
      // Belt-and-suspenders against the same iOS standalone-PWA caching
      // quirk reloadForUpdate works around: `cache: 'no-store'` is the
      // standards-compliant way to bypass HTTP caching for this fetch, and
      // the timestamp query param is a fallback that works even if that
      // option itself gets ignored (any cache lookup keyed on the full URL
      // simply can't have this exact URL from a previous call).
      const res = await fetch(`/api/version?_=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { buildId: string };
      if (data.buildId && data.buildId !== BUILD_ID && data.buildId !== this.dismissedUpdateBuildId) {
        this.updateAvailableBuildId = data.buildId;
      }
    } catch {
      // transient network hiccup — the next periodic check retries
    }
  }
  private scheduleUpdateCheck() {
    void this.checkForUpdate();
    setInterval(() => void this.checkForUpdate(), 5 * 60_000);
  }
  dismissUpdateNotice() {
    this.dismissedUpdateBuildId = this.updateAvailableBuildId;
    this.updateAvailableBuildId = null;
  }
  /// Not a plain reload() — a standalone iOS home-screen PWA is known to
  /// serve reload() from WebKit's in-memory cache (showing the same stale
  /// build right back) even though the on-disk cache *does* get refreshed
  /// in the background, which is exactly why manually closing and
  /// reopening the app afterward picks up the update: by then the disk
  /// cache has already caught up, reload() itself just never showed it.
  /// That memory-cache short-circuit only kicks in for reloading the
  /// *identical* URL — navigating to a cache-busted one instead (a
  /// harmless extra query param) makes this a normal fresh navigation
  /// Safari has no reason to serve from memory, without needing the user
  /// to leave the app at all.
  reloadForUpdate() {
    const url = new URL(window.location.href);
    url.searchParams.set('_v', Date.now().toString());
    window.location.href = url.toString();
  }

  async boot() {
    this.bootStatus = 'Starting app…';
    this.scheduleUpdateCheck();
    // Purely a device-capability check (iOS + not already standalone + not
    // previously dismissed) — independent of auth, so it needs to run
    // before the /api/me call below, not after login succeeds. Installing
    // before signing in avoids a double sign-in: Safari-in-browser and the
    // installed standalone app are separate storage contexts on iOS, so
    // signing in only in the browser and installing afterward meant
    // logging in again once inside the installed app.
    this.maybeShowIosInstallBanner();
    const params = new URLSearchParams(window.location.search);
    const onboarding = params.get('onboarding') === 'secondary';
    // Strips onboarding=secondary once consumed below, and reloadForUpdate's
    // cache-busting _v param — neither means anything past this point, and
    // leaving them in the URL bar would persist across a plain refresh.
    if (window.location.search) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    let me: MeResponse;
    try {
      me = await api.get<MeResponse>('/api/me');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        this.screen = 'login';
        return;
      }
      this.bootError = err instanceof Error ? err.message : 'Failed to load';
      return;
    }

    this.primaryProvider = me.primaryProvider;
    this.asanaConnected = me.asanaConnected;
    this.outlookConnected = me.outlookConnected;
    this.asanaAccountLabel = me.asanaAccountLabel;
    this.outlookAccountLabel = me.outlookAccountLabel;
    this.prefStartTime = me.settings.prefStartTime;
    this.prefEndTime = me.settings.prefEndTime;
    this.bufferMinutes = me.settings.bufferMinutes;
    this.timezone = me.settings.timezone;
    this.skipDayFullWarning = me.settings.skipDayFullWarning;
    this.confirmDoubleBooking = me.settings.confirmDoubleBooking;

    if (onboarding && (!me.asanaConnected || !me.outlookConnected)) {
      this.screen = 'loginSecondary';
      return;
    }

    await this.enterTriage();
  }

  private async enterTriage() {
    // Workload doesn't gate entering triage — it fills in the header badges
    // once it resolves, same as any other in-app refresh.
    void this.refreshWorkload();
    // The active day's unlinked calendar events gate the task queue (see
    // activeDayUnlinkedEvents) — needs to be loaded before Triage renders,
    // not just when Overview happens to be opened.
    void this.refreshEvents();
    this.scheduleMidnightRefresh();
    this.schedulePeriodicTaskRefresh();
    await this.bootRefreshTasks();
  }

  /// Backstop against `tasks` silently going stale for good in a long-lived
  /// session — the app's *only* other resync triggers are a genuine reload
  /// (boot) and background/foreground transitions (App.svelte's resume()),
  /// and iOS is known to not reliably fire those for a standalone PWA (see
  /// resume()'s own comment). A tab/PWA left open continuously for days,
  /// with neither ever firing, would otherwise keep showing a task Asana
  /// itself has long since marked complete — this is what that looked
  /// like when it happened. 15 minutes: frequent enough that "stale for
  /// days" can't recur, cheap enough not to matter against Asana's rate
  /// limits for a single-user tool.
  private schedulePeriodicTaskRefresh() {
    setInterval(() => {
      if (this.asanaConnected) void this.refreshTasks();
    }, 15 * 60_000);
  }

  /// workloadDays' buckets (today/tomorrow/day2../nextweek) are computed
  /// once — at boot, or whenever something happens to call refreshWorkload
  /// — and don't shift on their own after that. Left open across midnight
  /// (e.g. starting the app at 23:40 and working past 00:00), the day that
  /// *was* "tomorrow" is now today, but nothing had re-fetched workloadDays
  /// to notice — so the header/Overview/"When later?" kept labeling actual
  /// today as "Tomorrow" (they look up a bucket by matching today's date
  /// string against workloadDays' stale date fields). Reschedules itself
  /// for the following midnight every time it fires.
  private scheduleMidnightRefresh() {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    setTimeout(() => {
      if (this.asanaConnected) void this.refreshWorkload();
      else this.workloadDays = buildSkeletonWorkloadDays(new Date());
      this.scheduleMidnightRefresh();
    }, nextMidnight.getTime() - now.getTime());
  }

  // --- boot-time task loading progress ---
  // A "crowded" Asana workspace can mean many paginated requests plus
  // per-subtask breadcrumb lookups server-side — genuinely multi-second
  // work the plain GET /api/tasks used by refreshTasks() gives no
  // visibility into. Only the boot path uses this SSE variant; every other
  // refresh (after committing a plan, etc.) is fast enough in practice and
  // isn't shown on a loading screen anyway, so it keeps using the simple GET.
  //
  // Rather than wait for the whole (possibly large, breadcrumb-resolving)
  // fetch to finish, each SSE `progress` event already carries a
  // best-effort queue built from whatever's been fetched so far — as soon
  // as the first one lands, boot jumps straight to Triage instead of
  // sitting on the loading screen, and later events keep refining `tasks`
  // in the background (see mergeIncomingTasks).
  loadingTasksCount = $state(0);
  loadingTasksEstimate: number | null = $state(null);

  get loadingProgressLabel(): string | null {
    if (this.loadingTasksCount <= 0) return null;
    if (this.loadingTasksEstimate && this.loadingTasksEstimate > 0) {
      const pct = Math.min(100, Math.round((this.loadingTasksCount / this.loadingTasksEstimate) * 100));
      return `${this.loadingTasksCount} / ~${this.loadingTasksEstimate} tasks · ${pct}%`;
    }
    return `${this.loadingTasksCount} tasks loaded`;
  }

  private async bootRefreshTasks() {
    if (!this.asanaConnected) {
      this.screen = 'triage';
      return;
    }
    this.bootStatus = 'Connecting to Asana…';
    this.loadingTasksCount = 0;
    const cached = localStorage.getItem('lastTaskCount');
    this.loadingTasksEstimate = cached ? parseInt(cached, 10) : null;
    try {
      await this.streamTasks();
      localStorage.setItem('lastTaskCount', String(this.tasks.length));
    } catch (err) {
      this.logTaskLoadFailure('boot', err);
      this.reportRetryableError(err, 'Could not load tasks from Asana', () => void this.bootRefreshTasks());
      // Land on Triage with whatever (possibly nothing) came in rather than
      // leaving the user stuck on the loading screen after a failure.
      if (this.screen === 'loading') this.screen = 'triage';
    }
  }

  /// Applies one batch — a `progress` event's best-effort queue, or the
  /// final `done` payload — from the boot-time task stream. The first call
  /// jumps straight to Triage instead of waiting for the whole (possibly
  /// large) fetch to finish. Every call after that preserves whatever's
  /// already been shown up to and including the focused task — the user
  /// may be mid-decision on it — and only re-sorts the tail the user
  /// hasn't reached yet, so the queue never visibly reshuffles a task out
  /// from under them; it just gets more complete/correct further ahead.
  private applyTaskBatch(data: { tasks: Task[]; tasksWithoutDueDate: Task[]; projects: Project[] }) {
    const focusId = this.focusTaskRaw?.id ?? null;
    const focusIdx = focusId ? this.tasks.findIndex((t) => t.id === focusId) : -1;
    if (focusIdx === -1) {
      this.tasks = data.tasks;
    } else {
      const alreadyShown = this.tasks.slice(0, focusIdx + 1);
      const shownIds = new Set(alreadyShown.map((t) => t.id));
      this.tasks = [...alreadyShown, ...data.tasks.filter((t) => !shownIds.has(t.id))];
    }
    this.tasksWithoutDueDate = data.tasksWithoutDueDate;
    this.projects = data.projects;
    if (this.focusIndex >= this.queueTasks.length) this.focusIndex = Math.max(0, this.queueTasks.length - 1);
    if (this.screen === 'loading') {
      this.focusIndex = 0;
      this.screen = 'triage';
    }
  }

  /// EventSource's own onerror only fires when the connection genuinely
  /// drops — a connection that stays technically open but simply stops
  /// receiving events (the server-side Asana call hanging, or a proxy in
  /// between silently buffering/stalling the stream — ngrok's free tier is
  /// known to do this to long-lived SSE responses) never triggers it, so
  /// without a watchdog this sat on whatever bootStatus phase it last saw
  /// forever, with no error and no way out short of force-closing the app.
  /// STALL_TIMEOUT_MS is measured from the last event actually received,
  /// not from connection start, so a slow-but-genuinely-progressing fetch
  /// (many pages, breadcrumb resolution) isn't cut off — only a real stall
  /// is.
  private streamTasks(): Promise<void> {
    const STALL_TIMEOUT_MS = 20_000;
    return new Promise((resolve, reject) => {
      const es = new EventSource('/api/tasks/stream');
      let settled = false;
      let lastActivity = Date.now();
      const watchdog = setInterval(() => {
        if (Date.now() - lastActivity > STALL_TIMEOUT_MS) settle(() => reject(new Error('Timed out loading tasks — check your connection and retry')));
      }, 5_000);
      const settle = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearInterval(watchdog);
        es.close();
        action();
      };
      es.addEventListener('phase', (e) => {
        lastActivity = Date.now();
        try {
          this.bootStatus = JSON.parse((e as MessageEvent).data).label;
        } catch {
          // malformed phase event — harmless, just keep the last label shown
        }
      });
      es.addEventListener('progress', (e) => {
        lastActivity = Date.now();
        try {
          const data = JSON.parse((e as MessageEvent).data);
          this.loadingTasksCount = data.count;
          this.applyTaskBatch(data);
        } catch {
          // malformed progress event — harmless, just skip this tick
        }
      });
      es.addEventListener('failed', (e) => {
        const msg = (() => {
          try {
            return JSON.parse((e as MessageEvent).data).error;
          } catch {
            return undefined;
          }
        })();
        settle(() => reject(new Error(msg || 'Failed to load tasks')));
      });
      es.addEventListener('done', (e) => {
        settle(() => {
          try {
            this.applyTaskBatch(JSON.parse((e as MessageEvent).data));
            resolve();
          } catch (err) {
            reject(err as Error);
          }
        });
      });
      es.onerror = () => {
        settle(() => reject(new Error('Lost connection to the server while loading tasks')));
      };
    });
  }

  // --- install banner ---
  // Chrome/Edge/Android fire beforeinstallprompt (captured as early as
  // possible in main.ts, before this store's UI even exists, in case it
  // fires immediately on load) and support a real programmatic install
  // prompt. iOS Safari never fires that event at all — "Add to Home
  // Screen" only exists as a manual Share-sheet action — so that path is
  // detected separately and just shows instructions instead of a button.
  // Either way the banner only renders once the user reaches Triage
  // (main.ts sets planner.screen via boot() before this can show), not on
  // first load, and a dismissal is remembered so it never nags again.
  private installPromptEvent: { prompt(): void; userChoice: Promise<{ outcome: string }> } | null = null;
  showInstallBanner = $state(false);
  installBannerKind: 'android' | 'ios' | null = $state(null);

  private isStandalone(): boolean {
    return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  }
  private installDismissed(): boolean {
    return localStorage.getItem('installBannerDismissed') === '1';
  }

  captureInstallPrompt(e: { prompt(): void; userChoice: Promise<{ outcome: string }> }) {
    this.installPromptEvent = e;
    if (this.isStandalone() || this.installDismissed()) return;
    this.installBannerKind = 'android';
    this.showInstallBanner = true;
  }
  onAppInstalled() {
    this.showInstallBanner = false;
    this.installPromptEvent = null;
  }
  private maybeShowIosInstallBanner() {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (!isIos || this.isStandalone() || this.installDismissed()) return;
    this.installBannerKind = 'ios';
    this.showInstallBanner = true;
  }
  async promptInstall() {
    if (!this.installPromptEvent) return;
    this.installPromptEvent.prompt();
    await this.installPromptEvent.userChoice;
    this.installPromptEvent = null;
    this.showInstallBanner = false;
    localStorage.setItem('installBannerDismissed', '1');
  }
  dismissInstallBanner() {
    this.showInstallBanner = false;
    localStorage.setItem('installBannerDismissed', '1');
  }

  /// Re-fetches tasks fresh from Asana — used after returning from
  /// backgrounding the app (e.g. tapping a task's Asana link and coming
  /// back; there's a good chance its name, time, or estimate changed over
  /// there) as well as anywhere else that wants an authoritative resync.
  /// Re-sorting can shift the focused task to a different array index, so
  /// this re-points focusIndex at the same task by id afterward rather
  /// than leaving it as a raw number that might now land on something else.
  async refreshTasks() {
    if (!this.asanaConnected) return;
    const focusId = this.focusTaskRaw?.id ?? null;
    try {
      const res = await api.get<{ tasks: Task[]; tasksWithoutDueDate: Task[]; projects: Project[] }>('/api/tasks');
      this.tasks = res.tasks;
      this.tasksWithoutDueDate = res.tasksWithoutDueDate;
      this.projects = res.projects;
      if (focusId) this.selectFocus(focusId);
      if (this.focusIndex >= this.queueTasks.length) this.focusIndex = Math.max(0, this.queueTasks.length - 1);
    } catch (err) {
      this.logTaskLoadFailure('refresh', err);
      this.reportRetryableError(err, 'Could not load tasks from Asana', () => void this.refreshTasks());
    }
  }

  /// Fast, targeted top-up for exactly what's rendered on the Triage screen
  /// right now — the focused card plus its next few "Up Next" entries —
  /// meant to run alongside refreshTasks() on resume, not instead of it.
  /// refreshTasks() still goes through Asana's near-term search pass as
  /// part of covering the caller's *entire* assignment (needed to ever
  /// surface a newly due/assigned task), which is eventually consistent
  /// and can lag; this instead asks the server for exactly these gids by
  /// direct lookup (see refreshTasksByGid on the server), so it's both
  /// quicker (a handful of direct calls instead of a full paginated fetch)
  /// and immune to that same lag for whatever's actually on screen.
  async refreshVisibleTasks() {
    if (!this.asanaConnected) return;
    const visible = [this.focusTaskRaw, ...this.queueTasks.slice(this.focusIndex + 1, this.focusIndex + 6)].filter(
      (t): t is Task => t !== null,
    );
    if (visible.length === 0) return;
    const gids = visible.map((t) => t.id);
    try {
      const res = await api.post<{ tasks: Record<string, Task | null> }>('/api/tasks/refresh-by-gid', { gids });
      const focusId = this.focusTaskRaw?.id ?? null;
      const apply = (list: Task[]) => list.map((t) => (gids.includes(t.id) ? (res.tasks[t.id] ?? null) : t)).filter((t): t is Task => t !== null);
      if (this.reviewingBacklog) this.tasksWithoutDueDate = apply(this.tasksWithoutDueDate);
      else this.tasks = apply(this.tasks);
      if (focusId) this.selectFocus(focusId);
      if (this.focusIndex >= this.queueTasks.length) this.focusIndex = Math.max(0, this.queueTasks.length - 1);
    } catch {
      // Best-effort top-up — refreshTasks() alongside this one already has
      // its own error toast + Retry, so a failure here is silently left to
      // that rather than doubling up on error UI.
    }
  }

  /// Drives the Triage capacity badge's loading state (see todayBadgeBg) —
  /// true for the duration of any workload refresh, whether that's the
  /// initial boot load or a resync after committing a plan.
  workloadLoading = $state(false);

  async refreshWorkload() {
    this.workloadLoading = true;
    try {
      const res = await api.get<{ days: Omit<WorkloadDay, 'loaded'>[] }>('/api/workload');
      this.workloadDays = res.days.map((d) => ({ ...d, loaded: true }));
    } catch (err) {
      this.reportError(err, 'Could not load workload');
    } finally {
      this.workloadLoading = false;
    }
  }

  async refreshEvents() {
    if (!this.outlookConnected) return;
    try {
      const res = await api.get<{ events: CalendarEvent[] }>('/api/calendar/events');
      this.events = res.events;
    } catch (err) {
      this.reportError(err, 'Could not load calendar events');
    }
  }

  // --- drag / swipe ---
  private dragStartX = 0;
  private isDragging = false;

  onCardPointerDown(e: PointerEvent) {
    // Mid-edit (the hours stepper is showing instead of the normal
    // actions), a drag starting on the card is almost always someone
    // interacting with the stepper, not trying to swipe away — and
    // swiping the card out from under an in-progress edit is jarring.
    if (this.editingHours) return;
    if ((e.target as HTMLElement).closest('button')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.dragStartX = e.clientX;
    this.isDragging = true;
    this.dragging = true;
  }
  onCardPointerMove(e: PointerEvent) {
    if (!this.isDragging) return;
    const dx = Math.max(-160, Math.min(160, e.clientX - this.dragStartX));
    this.dragX = dx;
  }
  onCardPointerUp() {
    if (!this.isDragging) return;
    this.isDragging = false;
    const dx = this.dragX;
    const threshold = 90;
    this.dragX = 0;
    this.dragging = false;
    // Left = plan today (or the day on screen), right = plan later (matches
    // the button order below).
    if (dx < -threshold) this.openPlanTodayOrDate();
    else if (dx > threshold) this.openPlanLater();
  }

  // --- queue nav ---
  /// Steps activeDate to the previous/next entry in navigableDates — dates,
  /// not tasks, so a click always moves a whole day even when the target
  /// day has no task of its own (see jumpToDate). Clamped at the ends
  /// rather than wrapping, like a calendar picker.
  private stepActiveDate(dir: -1 | 1) {
    const dates = this.navigableDates;
    if (dates.length === 0) return;
    const idx = dates.indexOf(this.activeDate);
    const from = idx === -1 ? (dir === 1 ? -1 : dates.length) : idx;
    const next = Math.max(0, Math.min(dates.length - 1, from + dir));
    this.jumpToDate(dates[next]);
  }
  /// Backlog tasks have no due date at all, so date-stepping doesn't apply
  /// while reviewing them — cycle through the backlog list itself instead
  /// (wrapping, since there's no natural start/end the way dates have).
  private stepFocusIndexInBacklog(dir: -1 | 1) {
    if (this.queueTasks.length <= 1) return;
    this.focusIndex = (this.focusIndex + dir + this.queueTasks.length) % this.queueTasks.length;
  }
  goPrev() {
    if (this.reviewingBacklog) this.stepFocusIndexInBacklog(-1);
    else this.stepActiveDate(-1);
  }
  goNext() {
    if (this.reviewingBacklog) this.stepFocusIndexInBacklog(1);
    else this.stepActiveDate(1);
  }
  selectFocus(id: string) {
    this.pinnedEventId = null;
    this.focusIndex = Math.max(0, this.queueTasks.findIndex((t) => t.id === id));
  }

  /// "Leave as is" — advances past this task without changing anything
  /// about it, unlike Remove due date (clears it) or Plan today/later
  /// (sets it). Doesn't touch justPlannedIds either: a skipped task stays
  /// fully live in the queue, reachable again via the date-nav arrows or
  /// Up Next, not filtered out the way an actually-handled task is.
  skipTask() {
    if (!this.hasFocusTask) return;
    this.focusIndex = Math.min(this.focusIndex + 1, this.queueTasks.length - 1);
  }

  // --- settings ---
  openSettings() {
    this.screen = 'settings';
  }
  closeSettings() {
    this.justPlannedIds = [];
    this.reviewingBacklog = false;
    this.screen = 'triage';
  }
  openIntegrations() {
    this.screen = 'integrations';
  }
  closeIntegrations() {
    this.screen = 'settings';
  }

  /// Disconnecting the only connected provider leaves nothing useful to do
  /// in the app, so the server treats that as a full sign-out (see the
  /// DELETE /auth/:provider handler) — this reloads to a clean boot rather
  /// than trying to patch a bunch of local state back into a coherent
  /// "signed out" shape. Disconnecting one of two providers is simpler:
  /// just flip the local flags, and adopt whatever primaryProvider the
  /// server settled on if it had to reassign it.
  async disconnectProvider(provider: 'ASANA' | 'OUTLOOK') {
    const path = provider === 'ASANA' ? 'asana' : 'outlook';
    try {
      const res = await api.delete<{ loggedOut: boolean; primaryProvider?: 'ASANA' | 'OUTLOOK' }>(`/auth/${path}`);
      if (res.loggedOut) {
        window.location.href = '/';
        return;
      }
      if (provider === 'ASANA') {
        this.asanaConnected = false;
        this.asanaAccountLabel = null;
      } else {
        this.outlookConnected = false;
        this.outlookAccountLabel = null;
      }
      if (res.primaryProvider) this.primaryProvider = res.primaryProvider;
      this.showToast(`Disconnected ${provider === 'ASANA' ? 'Asana' : 'Outlook'}`);
    } catch (err) {
      this.reportError(err, 'Could not disconnect');
    }
  }

  // --- pending actions lookup ---
  pendingActions: PendingActionDto[] = $state([]);

  async openPendingActions() {
    this.screen = 'pendingActions';
    await this.refreshPendingActions();
  }
  closePendingActions() {
    this.screen = 'settings';
  }
  async refreshPendingActions() {
    try {
      const res = await api.get<{ actions: PendingActionDto[] }>('/api/pending-actions');
      this.pendingActions = res.actions;
    } catch (err) {
      this.reportError(err, 'Could not load pending actions');
    }
  }
  async retryPendingAction(id: string) {
    try {
      await api.post(`/api/pending-actions/${encodeURIComponent(id)}/retry`, {});
      await this.refreshPendingActions();
    } catch (err) {
      this.reportError(err, 'Could not retry this action');
    }
  }
  async dismissPendingAction(id: string) {
    try {
      await api.delete(`/api/pending-actions/${encodeURIComponent(id)}`);
      this.pendingActions = this.pendingActions.filter((a) => a.id !== id);
    } catch (err) {
      this.reportError(err, 'Could not dismiss this action');
    }
  }

  private async patchSettings(
    patch: Partial<{
      prefStartTime: string;
      prefEndTime: string;
      bufferMinutes: number;
      timezone: string;
      skipDayFullWarning: boolean;
      confirmDoubleBooking: boolean;
    }>,
  ) {
    try {
      await api.put('/api/settings', patch);
    } catch (err) {
      this.reportError(err, 'Could not save settings');
    }
  }
  onPrefStartChange(v: string) {
    this.prefStartTime = v;
    void this.patchSettings({ prefStartTime: v });
  }
  onPrefEndChange(v: string) {
    this.prefEndTime = v;
    void this.patchSettings({ prefEndTime: v });
  }
  onBufferChange(v: string) {
    const n = parseInt(v, 10);
    this.bufferMinutes = v === '' ? 0 : isNaN(n) ? 0 : n;
    void this.patchSettings({ bufferMinutes: this.bufferMinutes });
  }
  onTimezoneChange(v: string) {
    this.timezone = v;
    void this.patchSettings({ timezone: v });
  }
  onSkipDayFullWarningChange(v: boolean) {
    this.skipDayFullWarning = v;
    void this.patchSettings({ skipDayFullWarning: v });
  }
  onConfirmDoubleBookingChange(v: boolean) {
    this.confirmDoubleBooking = v;
    void this.patchSettings({ confirmDoubleBooking: v });
  }

  // --- report a bug ---
  bugReportOpen = $state(false);
  bugReportDraft = $state('');
  bugReportSubmitting = $state(false);
  toggleBugReportOpen() {
    this.bugReportOpen = !this.bugReportOpen;
    if (!this.bugReportOpen) this.bugReportDraft = '';
  }
  async submitBugReport() {
    const description = this.bugReportDraft.trim();
    if (!description || this.bugReportSubmitting) return;
    this.bugReportSubmitting = true;
    try {
      await api.post('/api/tasks/bug-report', { description });
      this.bugReportOpen = false;
      this.bugReportDraft = '';
      this.showToast('Bug report filed in Asana');
    } catch (err) {
      this.reportError(err, 'Could not file the bug report');
    } finally {
      this.bugReportSubmitting = false;
    }
  }

  /// "Reset today's plan" in Settings — un-schedules every task due today
  /// that has a specific due *time* (tasks due today with only a date and
  /// no time have nothing to reset). Confirmed by the caller before this
  /// runs, since it's a bulk, hard-to-undo-by-hand action. The clears are
  /// queued (not awaited) — see pendingActionQueue.ts — so this doesn't
  /// block on N Asana writes; check Settings' pending-actions lookup (or
  /// just refresh) to see them actually land.
  async resetToday() {
    const targets = this.tasksDueToday.filter((t): t is Task & { dueAt: string } => !!t.dueAt).map((t) => ({ id: t.id, previousDueAt: t.dueAt }));
    if (targets.length === 0) {
      this.showToast('No tasks scheduled today');
      return;
    }
    try {
      const res = await api.post<{ queued: number }>('/api/tasks/reset-day', { taskGids: targets.map((t) => t.id) });
      for (const t of targets) this.setTaskDueDateLocally(t.id, null);
      this.focusIndex = Math.min(this.focusIndex, Math.max(0, this.queueTasks.length - 1));
      this.showToast(`Queued ${res.queued} task${res.queued === 1 ? '' : 's'} to reset`, {
        label: 'Undo',
        onClick: () => {
          for (const t of targets) {
            this.setTaskDueDateLocally(t.id, t.previousDueAt);
            this.enqueueDueWrite(t.id, t.previousDueAt);
          }
        },
      });
    } catch (err) {
      this.reportError(err, 'Could not reset today');
    }
  }

  // --- login / provider-connect links ---
  // These are real hrefs (not window.location.href set from a click
  // handler) so the login buttons render as genuine <a> tags: on iOS,
  // Asana's app registers Universal Links for app.asana.com and can
  // intercept the OAuth redirect, showing its own "couldn't load content"
  // error instead of the login page. A real anchor lets the user long-press
  // it and choose "Open in New Tab" to route around that, which isn't
  // possible on a JS-driven navigation from a plain <button>.
  get asanaLoginUrl() {
    return '/auth/asana/start';
  }
  get outlookLoginUrl() {
    return '/auth/outlook/start';
  }
  get secondaryProviderLoginUrl() {
    const other: Provider = this.primaryProvider === 'ASANA' ? 'outlook' : 'asana';
    return `/auth/${other}/start`;
  }

  async skipSecondaryProvider() {
    await this.enterTriage();
  }

  get secondaryProviderLabel() {
    return this.primaryProvider === 'ASANA' ? 'Outlook' : 'Asana';
  }
  get secondaryProviderInitial() {
    return this.primaryProvider === 'ASANA' ? 'O' : 'A';
  }
  get secondaryProviderDetail() {
    return this.primaryProvider === 'ASANA'
      ? 'See free slots from your calendar and turn unlinked meetings into tasks.'
      : 'Pull in your Asana tasks so you can pre-plan them here.';
  }
  get primaryProviderLabel() {
    return this.primaryProvider === 'ASANA' ? 'Asana' : 'Outlook';
  }
  /// "Name <email>" for whichever provider is primary — shown on the
  /// connect-secondary screen so it's clear the first sign-in worked and
  /// which account it landed on.
  get primaryAccountLabel() {
    return this.primaryProvider === 'ASANA' ? this.asanaAccountLabel : this.outlookAccountLabel;
  }

  // --- day-full check ---
  private dayFullDismissKey(date: string): string {
    return `dayFullDismissed:${date}`;
  }
  /// True only if the day is actually over capacity AND neither dismissal
  /// applies: the global Settings toggle ("don't ask again for any day")
  /// or a per-day localStorage flag ("...for this day", set the moment the
  /// user picks that option on the DayFull screen — see
  /// dontAskDayFullToday/Ever below).
  isDayFull(key: string): boolean {
    const d = this.workloadDays.find((w) => w.key === key);
    if (!d || !d.loaded || d.planned / d.capacity < 1) return false;
    if (this.skipDayFullWarning) return false;
    const date = this.dateFor(key);
    if (date && localStorage.getItem(this.dayFullDismissKey(date)) === '1') return false;
    return true;
  }
  /// Both dismiss the DayFull warning (for this day only, or for good) and
  /// then proceed exactly as "Plan for this day anyway" would — the
  /// warning was already blocking whatever the user was trying to do.
  dontAskDayFullToday() {
    const p = this.pendingPlan;
    const key = p ? (p.type === 'today' ? 'today' : p.key) : null;
    const date = key ? this.dateFor(key) : null;
    if (date) localStorage.setItem(this.dayFullDismissKey(date), '1');
    this.onPlanAnyway();
  }
  dontAskDayFullEver() {
    this.skipDayFullWarning = true;
    void this.patchSettings({ skipDayFullWarning: true });
    this.onPlanAnyway();
  }

  private dateFor(key: string): string | null {
    if (key === 'custom') return this.customDateValue || null;
    return this.workloadDays.find((d) => d.key === key)?.date ?? null;
  }
  /// The concrete "YYYY-MM-DD" behind whichever later day is currently
  /// chosen (laterDayKey) — for FreeSlotsLater's calendar view, which needs
  /// an actual date rather than a bucket key.
  get chosenDate(): string | null {
    return this.laterDayKey ? this.dateFor(this.laterDayKey) : null;
  }

  /// Switches to the free-slots screen immediately rather than waiting on
  /// the network fetch first — that used to leave the tap looking dead for
  /// however long /api/calendar/free-slots took (worse the slower or
  /// flakier the connection, or while boot's task load is still in
  /// flight). loadTodaySlots now runs in the background and the screen
  /// itself shows a loading state (see PlanToday.svelte) until it resolves.
  /// Triage's primary action button reads "Plan today" while browsing
  /// today's own queue, but the same button is reachable while browsing a
  /// future day too (date-nav arrows, Overview's day rows) — labeling it
  /// "Plan today" there was actively misleading (and see
  /// openPlanTodayOrDate: it used to *plan for literally today* regardless
  /// of which day was on screen). Mirrors openPlanTodayOrDate's own lookup
  /// exactly, rather than just comparing activeDate to today, so the label
  /// can never promise a day the button doesn't actually plan for — an
  /// overdue task's activeDate is in the past and matches no workloadDays
  /// entry, so both this and openPlanTodayOrDate fall through to today,
  /// the earliest day anything can actually be planned for. Comparing
  /// dates directly used to show "Plan at Yesterday" for one, since it
  /// never checked whether that date was one you could actually plan into.
  get planTodayButtonLabel(): string {
    const day = this.workloadDays.find((d) => d.date === this.activeDate);
    return day && day.key !== 'today' ? `Plan at ${day.label}` : 'Plan today';
  }
  /// The focus card's primary button — plans for whichever day is actually
  /// on screen, not always literally today. Today itself keeps its own
  /// dedicated screen/flow (openPlanToday); a future day reuses the named
  /// bucket flow (selectLaterDay) it already has a workloadDays entry for,
  /// including the same "day already looks full" gating. An overdue task's
  /// activeDate is in the past and matches no workloadDays entry, so this
  /// falls through to openPlanToday — today is the earliest day anything
  /// can actually be planned for, matching planTodayButtonLabel above.
  openPlanTodayOrDate() {
    const day = this.workloadDays.find((d) => d.date === this.activeDate);
    if (day && day.key !== 'today') this.selectLaterDay(day.key);
    else this.openPlanToday();
  }
  openPlanToday() {
    if (this.isDayFull('today')) {
      this.pendingPlan = { type: 'today' };
      this.screen = 'dayFull';
      return;
    }
    this.planTodaySlots = [];
    this.screen = 'planToday';
    void this.loadTodaySlots();
  }

  /// Builds the free-slots query string: the target date, the duration the
  /// slots should be sized to (not a fixed 30 minutes — see freeSlots.ts),
  /// and this user's OTHER tasks already due that day (excluding
  /// `excludeId`, typically the task being planned). `tasks` is already
  /// loaded client-side (fetched once at boot), so sending the relevant
  /// slice here means the server doesn't have to re-fetch and re-paginate
  /// the user's entire Asana backlog just to find same-day conflicts —
  /// that redundant fetch was the dominant cost of this endpoint on a
  /// large workspace.
  private freeSlotsQuery(date: string, hours: number, excludeId: string): string {
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const busyTasks = this.tasks
      .filter((t) => t.id !== excludeId && t.dueAt)
      .filter((t) => {
        const due = new Date(t.dueAt!);
        return due >= dayStart && due < dayEnd;
      })
      .map((t) => ({ dueAt: t.dueAt, hours: t.hours }));
    return `date=${date}&hours=${hours}&busyTasks=${encodeURIComponent(JSON.stringify(busyTasks))}`;
  }

  /// Not private: PlanToday.svelte re-calls this whenever the same-day
  /// task set changes while this screen is open (see its $effect) — the
  /// slots/blocks here are a snapshot from whenever this last ran, and
  /// tasks can keep arriving after that (e.g. the boot-time streaming
  /// fetch still filling in) without anything else invalidating it.
  async loadTodaySlots() {
    const date = this.dateFor('today');
    const focus = this.focusTaskRaw;
    if (!date || !focus) return;
    this.todaySlotsLoading = true;
    try {
      const res = await api.get<{ slots: string[]; outlookEvents: OutlookBlock[] }>(`/api/calendar/free-slots?${this.freeSlotsQuery(date, focus.hours, focus.id)}`);
      this.planTodaySlots = res.slots;
      this.todayOutlookEvents = res.outlookEvents;
    } catch (err) {
      this.reportError(err, 'Could not load free slots', { label: 'Retry', onClick: () => void this.loadTodaySlots() });
    } finally {
      this.todaySlotsLoading = false;
    }
  }
  /// Seeds DayCalendar's pending placement so opening "Plan today" lands the
  /// task on the earliest free slot immediately instead of requiring a tap
  /// on the track first — planTodaySlots is already chronological (see
  /// freeSlots.ts), so the first entry is exactly that. On a day so full
  /// there's no free slot at all, still propose *something* — the start of
  /// the working day — rather than leaving the calendar with nothing
  /// placed; the user will see it obviously conflicts and can drag it.
  get earliestTodaySlotStart(): string | null {
    const date = this.dateFor('today');
    const focus = this.focusTaskRaw;
    const clean = date && focus ? this.firstFreeSlotStart(this.planTodaySlots, date, focus.hours, focus.id) : null;
    if (clean) return clean;
    if (this.todaySlotsLoading) return null;
    // Every candidate in the server-fetched list now conflicts (it's a
    // snapshot — a task can arrive/get planned locally after that fetch,
    // see scanForFreeStart) — used to fall back to blindly trusting the
    // list's first entry here, unchecked, which is exactly how a task
    // ended up proposed on top of a real conflict instead of the day's
    // actual next free slot.
    if (date && focus) return this.scanForFreeStart(date, focus.hours, focus.id);
    return this.prefStartTime;
  }

  openPlanLater() {
    this.screen = 'planLater';
  }
  /// Clears pendingPlan up front, same reasoning as resolveConflictAnyway's
  /// identical guard for pendingSlotPlan (see its own comment) — this
  /// screen doesn't itself commit a task to a slot the way SlotConflict's
  /// "Double-book anyway" does (it only unblocks navigation to the actual
  /// picker, which is where tryPlanTodaySlot/tryPlanLaterSlot's own
  /// pinned-taskId fix takes over), so a stale double-invocation here can't
  /// silently corrupt a different task's due date the same way — but a
  /// never-cleared pendingPlan is still the same class of latent fragility,
  /// hardened the same way on general principle.
  onPlanAnyway() {
    const p = this.pendingPlan;
    this.pendingPlan = null;
    if (!p) {
      this.logAnomaly('onPlanAnyway.noPendingPlan', 'Called with no pendingPlan — likely a duplicate/stale invocation', { screen: this.screen });
      this.screen = 'triage';
      return;
    }
    if (p.type === 'today') {
      this.planTodaySlots = [];
      this.screen = 'planToday';
      void this.loadTodaySlots();
    } else if (p.key) {
      this.laterDayKey = p.key;
      this.laterSlots = [];
      this.screen = 'freeSlotsLater';
      void this.loadLaterSlots(p.key);
    }
  }
  onReviewOtherTasks() {
    this.pendingPlan = null;
    this.focusIndex = 0;
    this.screen = 'triage';
  }
  /// Set by openTaskInPlanLater when it's a detour from a "pick a time"
  /// screen (arrow icon on a DayCalendar task block) rather than Triage's
  /// own "Plan later" button — backing out via closeFlow should return to
  /// that screen, still focused on the *original* task being placed, not
  /// dump onto Triage's swipe card for whichever task the arrow pointed
  /// at. A successful commit clears this too (commitPlanLocally) — that's
  /// a real completion, not a cancel, and lands on Triage same as always;
  /// only backing out without finishing needs the restore.
  private returnFromPlanLater: { screen: Screen; focusTaskId: string | null } | null = null;
  closeFlow() {
    const ret = this.returnFromPlanLater;
    this.returnFromPlanLater = null;
    if (ret) {
      if (ret.focusTaskId) this.selectFocus(ret.focusTaskId);
      this.screen = ret.screen;
      return;
    }
    this.screen = 'triage';
  }
  /// Jump straight to "Plan later" for another same-day task — the button
  /// on each task block in DayCalendar (see PlanToday/FreeSlotsLater/
  /// CalendarView). Noticing an awkwardly-placed task while placing a
  /// *different* one leads straight to the reason you'd tap it: moving it
  /// to another day, without a stop at its Triage card in between — and
  /// see returnFromPlanLater above for finding your way back afterward.
  openTaskInPlanLater(taskId: string) {
    // Only set on the *first* detour — a second arrow-tap before the first
    // one's flow has finished (e.g. hitting a conflict, backing out partway,
    // then tapping another task's arrow) used to silently overwrite this
    // with the second detour's own screen, losing track of the actual
    // origin closeFlow should return to.
    if (!this.returnFromPlanLater) {
      this.returnFromPlanLater = { screen: this.screen, focusTaskId: this.focusTaskRaw?.id ?? null };
    }
    this.selectFocus(taskId);
    this.openPlanLater();
  }
  backToPlanLater() {
    this.screen = 'planLater';
  }
  async openOverview() {
    this.screen = 'overview';
    await Promise.all([this.refreshEvents(), this.refreshWorkload()]);
  }
  closeOverview() {
    this.justPlannedIds = [];
    this.reviewingBacklog = false;
    this.screen = 'triage';
  }

  // --- standalone calendar view ---
  // A plain day-at-a-time calendar for browsing/reordering — unlike
  // PlanToday/FreeSlotsLater, there's no task being placed here (see
  // DayCalendar's allowPlacement prop), just whatever's already on that
  // day, draggable to a new time same as everywhere else DayCalendar shows
  // up.
  calendarViewDate: string = $state(this.toDateStr(new Date()));
  calendarViewOutlookEvents: OutlookBlock[] = $state([]);
  calendarViewLoading = $state(false);
  /// Deliberately its own thing rather than reusing dayLabelFor — that one
  /// is shared by Triage/Overview, which want a bare weekday name ("Monday")
  /// for the whole near-term stretch (see buildWorkloadDays). The calendar
  /// view is a plain day-by-day browser with no such "named bucket" concept
  /// — for anything beyond tomorrow, a bare weekday name alone doesn't say
  /// *which* Monday, so it shows the short weekday plus the date instead
  /// ("Mon, 24.8.").
  get calendarViewDayLabel(): string {
    const date = this.calendarViewDate;
    if (date === this.toDateStr(new Date())) return 'Today';
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (date === this.toDateStr(tomorrow)) return 'Tomorrow';
    const d = new Date(`${date}T00:00:00`);
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
    return `${weekday}, ${d.getDate()}.${d.getMonth() + 1}.`;
  }
  openCalendarView() {
    this.calendarViewDate = this.activeDate || this.toDateStr(new Date());
    this.screen = 'calendarView';
    void this.loadCalendarViewEvents();
  }
  closeCalendarView() {
    this.screen = 'triage';
  }
  calendarViewStepDay(dir: -1 | 1) {
    const d = new Date(`${this.calendarViewDate}T00:00:00`);
    d.setDate(d.getDate() + dir);
    this.calendarViewDate = this.toDateStr(d);
    void this.loadCalendarViewEvents();
  }
  /// Reuses free-slots purely for its outlookEvents half (see calendar.ts) —
  /// hours/busyTasks don't matter here since this view never reads `slots`.
  async loadCalendarViewEvents() {
    this.calendarViewLoading = true;
    try {
      const res = await api.get<{ slots: string[]; outlookEvents: OutlookBlock[] }>(`/api/calendar/free-slots?date=${this.calendarViewDate}&hours=1`);
      this.calendarViewOutlookEvents = res.outlookEvents;
    } catch (err) {
      this.reportError(err, 'Could not load calendar');
    } finally {
      this.calendarViewLoading = false;
    }
  }
  /// "Tasks without Due Date" in Overview — opens the exact same Triage
  /// screen/flow, just working through tasksWithoutDueDate instead of the
  /// normal queue (see queueTasks). Leaving to Settings/Overview and back
  /// returns to the normal queue, same as justPlannedIds' "re-open the day".
  reviewBacklog() {
    if (this.tasksWithoutDueDate.length === 0) return;
    this.pinnedEventId = null;
    this.reviewingBacklog = true;
    this.focusIndex = 0;
    this.screen = 'triage';
  }

  /// Clicking a day in Overview jumps Triage straight to that date — every
  /// named day is reachable this way whether or not it has a task yet (a
  /// day with only calendar events, or nothing at all, still needs to be
  /// reachable — see jumpToDate/activeDate). The aggregate "Next week" row
  /// has no single date to land on, so it keeps the old behavior of
  /// jumping to its earliest task instead (or telling you there isn't one)
  /// — calendar events aren't even fetched that far ahead.
  focusQueueForDay(day: WorkloadDay) {
    if (day.date) {
      // Clears justPlannedIds before jumping, so the day's own task (if
      // any) is found against the same (now unfiltered) queue it'll
      // actually be read against once this returns to Triage.
      this.closeOverview();
      this.jumpToDate(day.date);
      return;
    }
    if (!day.rangeStart || !day.rangeEnd) return;
    const rangeStart = new Date(day.rangeStart);
    const rangeEnd = new Date(day.rangeEnd);
    const matches = this.tasks
      .filter((t): t is Task & { dueAt: string } => !!t.dueAt && new Date(t.dueAt) >= rangeStart && new Date(t.dueAt) < rangeEnd)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
    if (!matches.length) {
      this.showToast(`No tasks due ${day.label}`);
      return;
    }
    this.closeOverview();
    this.jumpToDate(matches[0].dueOn!);
  }

  /// Overview's synthetic "Past days" row (not a real workloadDays entry —
  /// there's no fixed capacity for a range of already-passed days) jumps to
  /// the single earliest overdue task instead, same as goPrev from today
  /// already does one task at a time.
  focusPastDays() {
    const earliest = [...this.overdueTasks].sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1))[0];
    if (!earliest) return;
    this.closeOverview();
    this.jumpToDate(earliest.dueOn);
  }

  /// Clicking a calendar entry itself (not just its +/› action buttons) in
  /// Overview's "From your calendar" list reopens its card in Triage —
  /// pinning it (see pinnedEventId) so it shows regardless of link status,
  /// not just when it's unlinked and gating that day's tasks. An already
  /// linked event doesn't get relinked automatically; its card shows what
  /// it's currently linked to and offers the same add/link actions to
  /// change that, same as picking the link the first time.
  openEventInTriage(event: CalendarEvent) {
    this.closeOverview();
    this.jumpToDate(this.toLocalDateStr(event.start));
    this.pinnedEventId = event.id;
  }

  /// workloadDays, minus the aggregate "Next week" bucket whenever it would
  /// be pure redundancy: "tomorrow" already skips weekends (see
  /// buildWorkloadDays), so whenever today is a Friday, "tomorrow" already
  /// *is* next week's Monday — meaning every day "Next week" would cover is
  /// already individually listed as tomorrow/day2../day5, and the
  /// aggregate entry adds nothing but a second, vaguer way to reach the
  /// same days. Shared by every place that lists the full workloadDays set
  /// (laterDays below, Overview's day list) rather than each re-deriving it.
  get workloadDaysForDisplay(): WorkloadDay[] {
    const tomorrow = this.workloadDays.find((d) => d.key === 'tomorrow');
    const tomorrowIsMonday = !!tomorrow?.date && new Date(`${tomorrow.date}T00:00:00`).getDay() === 1;
    return tomorrowIsMonday ? this.workloadDays.filter((d) => d.key !== 'nextweek') : this.workloadDays;
  }
  /// "Today" is normally excluded — this flow's whole purpose is choosing
  /// some *other* day. But it's also reached via a task block's "Plan
  /// later" arrow (openTaskInPlanLater — DayCalendar, reachable from any
  /// day's view, not just today's), which can land here for a task that
  /// isn't due today at all. For that task, "Today" is a genuine, useful
  /// target — pulling it in — not a redundant option, so it's only left
  /// out when the task actually is already due today.
  get laterDays() {
    const focusDueOn = this.focusTaskRaw?.dueOn ?? null;
    const alreadyToday = focusDueOn === this.todayDateStr;
    return this.workloadDaysForDisplay
      .filter((d) => d.key !== 'today' || !alreadyToday)
      .map((d) => ({
        key: d.key,
        label: d.label,
        badgeLabel: d.loaded ? `${d.planned}/${d.capacity}h` : '—',
        tone: !d.loaded ? ('neutral' as const) : d.planned / d.capacity >= 1 ? ('wrong' as const) : ('correct' as const),
      }));
  }

  /// Monday of the current calendar week (could be a past date this week) —
  /// shared basis for weekDeferOptions and nextWeekDays below, both of
  /// which reason in real Mon-Sun weeks rather than the rolling
  /// today/tomorrow/day2../day5 run.
  private get thisWeekMonday(): Date {
    const now = new Date();
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
  }
  private toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  /// A due-at ISO string (a real UTC instant — see toIsoDateTime) has to be
  /// read back through the *device's* local getters to recover the
  /// wall-clock date/time it was set to, not string-sliced: slicing an ISO
  /// string reads its UTC digits directly, which are only ever right for a
  /// UTC device — everywhere else it's off by the local UTC offset (e.g. a
  /// drag to 11:00 on a UTC+2 device round-tripped through dueAtIso.slice()
  /// used to redisplay as 09:00).
  private toLocalDateStr(iso: string): string {
    return this.toDateStr(new Date(iso));
  }
  private toLocalTimeStr(iso: string): string {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /// Booked/fullness cue shared by every "pick a day" surface — the later
  /// day buckets (laterDays, tracked against real server capacity data) as
  /// well as everything below this class doesn't have server-fetched
  /// capacity for (weekDeferOptions, nextWeekDays, the calendar grid): all
  /// of it's cheap to compute client-side since every task is already
  /// loaded. Seeing at a glance how booked a day already is before picking
  /// it is a core part of what this app is for, so every one of these
  /// surfaces shows it, not just the ones with a server round-trip behind
  /// them already.
  private fullnessFor(date: string): { planned: number; capacity: number; ratio: number } {
    const capacity = this.dailyCapacityHours;
    const planned = this.plannedHoursFor(date);
    return { planned, capacity, ratio: capacity > 0 ? planned / capacity : 0 };
  }

  /// "d.m." with no leading zeros (e.g. "31.8.") — matches how the range in
  /// weekDeferOptions' labels is meant to read.
  private fmtDayMonth(d: Date): string {
    return `${d.getDate()}.${d.getMonth() + 1}.`;
  }
  /// "Further in the future, I'll plan it later" quick actions — unlike
  /// laterDays, these don't lead to a time-slot picker; they just push the
  /// due date out to a future week's Monday with no due time (see
  /// deferToWeek). The badge is the *whole* work week's fullness (Mon-Fri),
  /// not just Monday's — a single day's 9h capacity read as "how full is
  /// the week" made every one of these look nearly empty regardless of
  /// what was actually already planned that week. The label spells out the
  /// week's actual date range since "in 2/3/4 weeks" alone doesn't say
  /// which days that is without doing the math yourself.
  get weekDeferOptions(): { key: string; label: string; date: string; badgeLabel: string; tone: 'correct' | 'wrong' }[] {
    return [2, 3, 4].map((n) => {
      const monday = new Date(this.thisWeekMonday);
      monday.setDate(monday.getDate() + n * 7);
      const date = this.toDateStr(monday);
      const weekDates = [0, 1, 2, 3, 4].map((i) => {
        const d = new Date(monday);
        d.setDate(d.getDate() + i);
        return this.toDateStr(d);
      });
      const planned = weekDates.reduce((sum, d) => sum + this.plannedHoursFor(d), 0);
      const capacity = this.dailyCapacityHours * weekDates.length;
      const ratio = capacity > 0 ? planned / capacity : 0;
      const friday = new Date(monday);
      friday.setDate(friday.getDate() + 4);
      const range = `${this.fmtDayMonth(monday)} - ${this.fmtDayMonth(friday)}`;
      return { key: `week+${n}`, label: `Plan in ${n} weeks (${range})`, date, badgeLabel: `${planned}/${capacity}h`, tone: ratio >= 1 ? 'wrong' : 'correct' };
    });
  }

  /// The 5 real weekdays of next calendar week — "Next week" opens this
  /// list to pick a specific day from, unlike the other later-day buckets
  /// (which stay untouched, still just today/tomorrow/day2../day5 plus the
  /// week+N no-time defers above).
  get nextWeekDays(): { key: string; label: string; date: string; badgeLabel: string; tone: 'correct' | 'wrong' }[] {
    const nextMonday = new Date(this.thisWeekMonday);
    nextMonday.setDate(nextMonday.getDate() + 7);
    return [0, 1, 2, 3, 4].map((n) => {
      const d = new Date(nextMonday);
      d.setDate(d.getDate() + n);
      const date = this.toDateStr(d);
      const { planned, capacity, ratio } = this.fullnessFor(date);
      return { key: `nextweekday+${n}`, label: d.toLocaleDateString('en-US', { weekday: 'long' }), date, badgeLabel: `${planned}/${capacity}h`, tone: ratio >= 1 ? 'wrong' : 'correct' };
    });
  }
  openNextWeekDays() {
    this.screen = 'nextWeekDays';
  }
  /// Picking a specific day of next week reuses the same "arbitrary date"
  /// plumbing as the manual "Pick a date" flow (laterDayKey: 'custom' /
  /// dateFor('custom') reading customDateValue) rather than adding a new
  /// bucket key to workloadDays — these days have no tracked capacity data
  /// of their own, same reasoning as weekDeferOptions above.
  selectSpecificDay(date: string, label: string) {
    this.customDateValue = date;
    this.customDayLabel = label;
    this.laterDayKey = 'custom';
    this.laterSlots = [];
    this.screen = 'freeSlotsLater';
    void this.loadLaterSlots('custom');
  }

  // --- "Pick a date" calendar grid ---
  // The month currently on screen — separate from the actual calendar date
  // so prev/next navigation doesn't touch "today". Reset to the real
  // current month each time the screen opens (see openPickDate).
  private calendarCursor = $state({ year: 2000, month: 0 });
  get calendarMonthLabel(): string {
    return new Date(this.calendarCursor.year, this.calendarCursor.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  openPickDate() {
    const now = new Date();
    this.calendarCursor = { year: now.getFullYear(), month: now.getMonth() };
    this.screen = 'pickDate';
  }
  calendarPrevMonth() {
    const { year, month } = this.calendarCursor;
    this.calendarCursor = month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 };
  }
  calendarNextMonth() {
    const { year, month } = this.calendarCursor;
    this.calendarCursor = month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 };
  }
  /// Same formula as the server's dailyCapacityHours (workload.ts) —
  /// there's no per-day capacity data to fetch for a whole visible month,
  /// but every task is already loaded client-side, so both halves of the
  /// fullness ratio are cheap to compute here directly.
  private get dailyCapacityHours(): number {
    const [sh, sm] = this.prefStartTime.split(':').map(Number);
    const [eh, em] = this.prefEndTime.split(':').map(Number);
    return Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60);
  }
  /// Planned hours for one date — timed tasks only (dueAt set), same
  /// definition workloadDays/the capacity badge already use elsewhere, so
  /// the calendar's fullness cue reads consistently with the rest of the app.
  private plannedHoursFor(date: string): number {
    return this.tasks.filter((t) => t.dueOn === date && t.dueAt).reduce((sum, t) => sum + t.hours, 0);
  }
  get calendarWeeks(): { date: string; day: number; inMonth: boolean; isToday: boolean; isPast: boolean; ratio: number }[][] {
    const { year, month } = this.calendarCursor;
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday-first
    const gridStart = new Date(year, month, 1 - startOffset);
    const todayStr = this.todayDateStr;
    const cells = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(d.getDate() + i);
      const dateStr = this.toDateStr(d);
      return {
        date: dateStr,
        day: d.getDate(),
        inMonth: d.getMonth() === month,
        isToday: dateStr === todayStr,
        isPast: dateStr < todayStr,
        ratio: this.fullnessFor(dateStr).ratio,
      };
    });
    const weeks: (typeof cells)[] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }

  /// Moves the task being planned out to a future week's Monday with no
  /// specific due time — a deliberate "I'll figure out the time later"
  /// deferral, not a placement. Reuses restoreTaskDueFieldsLocally (see its
  /// comment) purely for its "set these exact due fields and write through"
  /// mechanics — this isn't an undo, just the same field-setting shape.
  deferToWeek(key: string) {
    const task = this.focusTaskRaw;
    const opt = this.weekDeferOptions.find((w) => w.key === key);
    if (!task || !opt) return;
    const previousDueOn = task.dueOn;
    const previousDueAt = task.dueAt;
    this.restoreTaskDueFieldsLocally(task.id, opt.date, null);
    if (!this.justPlannedIds.includes(task.id)) this.justPlannedIds = [...this.justPlannedIds, task.id];
    this.focusIndex = Math.min(this.focusIndex, Math.max(0, this.queueTasks.length - 1));
    this.screen = 'triage';
    this.showToast(`Moved "${task.name}" to ${opt.label} · syncing to Asana`, {
      label: 'Undo',
      onClick: () => {
        this.justPlannedIds = this.justPlannedIds.filter((id) => id !== task.id);
        this.restoreTaskDueFieldsAndRefocus(task.id, previousDueOn, previousDueAt);
      },
    });
  }

  private toIsoDateTime(date: string, hhmm: string): string {
    return new Date(`${date}T${hhmm}:00`).toISOString();
  }
  private slotStart(slot: string): string {
    return slotStartTime(slot);
  }

  /// The double-book check against a live Asana re-fetch used to be the
  /// dominant cost of planning a task — this checks the same already-loaded
  /// `tasks` a free-slots list was built from instead, so it's instant, at
  /// the cost of trusting client-side data that could in principle be a few
  /// seconds stale (matches how free-slots itself already trusts it).
  ///
  /// A genuine [start, start+hours) range overlap, not just "is something
  /// else due at this exact instant" — that exact-match version was fine
  /// back when the only way to reach this was tapping one of the server's
  /// own pre-chunked, already-non-overlapping slot buttons (the only real
  /// conflict a same-instant check could ever catch was a race against
  /// something committed after that list was fetched). Now that a
  /// placement can land anywhere via drag or the auto-seeded suggestion,
  /// a task sitting in the *middle* of the requested range (not exactly at
  /// its start) needs to be caught too, or it silently gets talked over.
  private findConflicts(dueAtIso: string, hours: number, excludeTaskId: string): ConflictItem[] {
    const start = new Date(dueAtIso).getTime();
    const end = start + hours * 3_600_000;
    return this.tasks
      .filter((t) => t.id !== excludeTaskId && t.dueAt)
      .filter((t) => {
        const tStart = new Date(t.dueAt!).getTime();
        const tEnd = tStart + t.hours * 3_600_000;
        return start < tEnd && tStart < end;
      })
      .map((t) => ({ name: t.name, hours: t.hours }));
  }

  /// The one place local state changes to reflect a due-date write —
  /// setting one (the task moves into `tasks` if it wasn't there yet, e.g.
  /// planning a "Tasks without Due Date" backlog item) or clearing one
  /// entirely (the task moves into `tasksWithoutDueDate`, since no due date
  /// at all takes it out of the server's queue too — see taskQueue.ts and
  /// setTaskDueAt's "clears due_at *and* due_on" behavior). Symmetric by
  /// construction: calling it again with the previous value is exactly
  /// what undoing any of these actions needs.
  private setTaskDueDateLocally(taskId: string, dueAtIso: string | null) {
    const existing = this.tasks.find((t) => t.id === taskId) ?? this.tasksWithoutDueDate.find((t) => t.id === taskId);
    if (!existing) return;
    const updated: Task = {
      ...existing,
      dueAt: dueAtIso,
      dueOn: dueAtIso ? this.toLocalDateStr(dueAtIso) : null,
      dueHour: dueAtIso ? this.toLocalTimeStr(dueAtIso) : null,
    };
    this.tasks = this.tasks.filter((t) => t.id !== taskId);
    this.tasksWithoutDueDate = this.tasksWithoutDueDate.filter((t) => t.id !== taskId);
    if (dueAtIso) this.tasks = [...this.tasks, updated];
    else this.tasksWithoutDueDate = [...this.tasksWithoutDueDate, updated];
  }

  /// Undo needs to restore a task's exact previous state, not just its
  /// previous `dueAt` — a task due today with no specific *time* (common:
  /// most tasks enter the queue this way) has `dueAt: null` but `dueOn`
  /// set, which setTaskDueDateLocally alone can't tell apart from "no due
  /// date at all" (also dueAt: null). This restores both fields directly,
  /// and writes through as a genuine "date only" update when that's the
  /// state being restored — see enqueueDueWrite.
  private restoreTaskDueFieldsLocally(taskId: string, previousDueOn: string | null, previousDueAt: string | null) {
    const existing = this.tasks.find((t) => t.id === taskId) ?? this.tasksWithoutDueDate.find((t) => t.id === taskId);
    if (!existing) return;
    const updated: Task = { ...existing, dueOn: previousDueOn, dueAt: previousDueAt, dueHour: previousDueAt ? this.toLocalTimeStr(previousDueAt) : null };
    this.tasks = this.tasks.filter((t) => t.id !== taskId);
    this.tasksWithoutDueDate = this.tasksWithoutDueDate.filter((t) => t.id !== taskId);
    if (previousDueOn) this.tasks = [...this.tasks, updated];
    else this.tasksWithoutDueDate = [...this.tasksWithoutDueDate, updated];
    this.enqueueDueWrite(taskId, previousDueAt, previousDueOn);
  }

  /// Every "undo" that wants the user looking at the restored task again
  /// (plan/defer/remove-due-date's Undo) needs more than
  /// restoreTaskDueFieldsLocally + selectFocus: that plain combination put
  /// the restored task at the *end* of `tasks` (appended, same as any
  /// other restore) and then pointed focusIndex at that last slot — and
  /// since Triage's "Up next" is everything *after* focusIndex (see
  /// Triage.svelte), focusing the very last task makes Up next render
  /// empty. This is the actual bug report: undoing "remove due date"
  /// looked like it wiped the queue, but the queue was fine — the focused
  /// task had just silently become the last one in it. Re-inserting at the
  /// *front* instead keeps every other task visible in Up next, same as
  /// undo landing on any other task would.
  ///
  /// Callers must clear the task from justPlannedIds (if applicable)
  /// *before* calling this — this reads queueTasks to find the task's new
  /// index, which excludes anything still in justPlannedIds.
  private restoreTaskDueFieldsAndRefocus(taskId: string, previousDueOn: string | null, previousDueAt: string | null) {
    const existing = this.tasks.find((t) => t.id === taskId) ?? this.tasksWithoutDueDate.find((t) => t.id === taskId);
    if (!existing) return;
    const updated: Task = { ...existing, dueOn: previousDueOn, dueAt: previousDueAt, dueHour: previousDueAt ? this.toLocalTimeStr(previousDueAt) : null };
    this.tasks = this.tasks.filter((t) => t.id !== taskId);
    this.tasksWithoutDueDate = this.tasksWithoutDueDate.filter((t) => t.id !== taskId);
    if (previousDueOn) this.tasks = [updated, ...this.tasks];
    else this.tasksWithoutDueDate = [updated, ...this.tasksWithoutDueDate];
    this.enqueueDueWrite(taskId, previousDueAt, previousDueOn);
    this.focusIndex = Math.max(0, this.queueTasks.findIndex((t) => t.id === taskId));
  }

  /// Fires the actual Asana write without making the caller wait on it —
  /// the write itself already happens on the server's background queue
  /// (pendingActionQueue.ts) regardless, so there's nothing left worth
  /// blocking the UI on. Errors (e.g. a genuinely dropped connection, not
  /// the write's own retries — those are the queue's problem) still surface
  /// as a toast. `dueOn` only matters when `dueAt` is null: it distinguishes
  /// "due this date, no specific time" from "no due date at all" — see
  /// DueUpdate in the server's asana.ts. Every forward-planning call site
  /// only ever sets a real instant or clears entirely, so they can omit it;
  /// only restoreTaskDueFieldsLocally (undo) ever needs to pass it.
  private enqueueDueWrite(taskId: string, dueAtIso: string | null, dueOn?: string | null) {
    const body: { dueAt: string | null; dueOn?: string | null } = { dueAt: dueAtIso };
    if (!dueAtIso && dueOn) body.dueOn = dueOn;
    api.patch(`/api/tasks/${encodeURIComponent(taskId)}`, body).catch((err) => {
      this.reportError(err, 'Could not update the task in Asana');
    });
  }

  /// Bumps a day's planned hours optimistically (a real refreshWorkload()
  /// would show the same number eventually, but only after a round trip we
  /// don't want to wait on) so the capacity badge and a possible
  /// celebration both react immediately instead of on the next unrelated
  /// refresh. The celebration only fires on the exact booking that pushes
  /// the day from under capacity to full — checking `planned >= capacity`
  /// alone (the old bug) stays true for every booking after the first one
  /// that fills the day, e.g. clearing out a pile of overdue tasks onto an
  /// already-full today used to confetti on every single one of them.
  private bumpWorkloadLocally(dayKey: string, addedHours: number) {
    const idx = this.workloadDays.findIndex((d) => d.key === dayKey);
    if (idx === -1) return;
    const before = this.workloadDays[idx];
    const updated = { ...before, planned: Math.round((before.planned + addedHours) * 10) / 10 };
    this.workloadDays = [...this.workloadDays.slice(0, idx), updated, ...this.workloadDays.slice(idx + 1)];
    const justFilled = updated.capacity > 0 && before.planned < updated.capacity && updated.planned >= updated.capacity;
    if (justFilled) {
      this.celebrationLabel = `${updated.label} is fully planned!`;
      this.celebrationKey++;
    }
  }

  /// The shared tail of every "plan this task" action: update local state
  /// to already reflect the outcome, hide the task from the swipeable
  /// queue until the user leaves and returns to Triage (see
  /// justPlannedIds), and fire the actual write in the background — all of
  /// which makes the screen close the instant you tap, not once Asana
  /// confirms. The toast's Undo restores the task's previous due date
  /// (also fired in the background) and jumps focus back to it.
  private commitPlanLocally(task: Task, dueAtIso: string, toastMsg: string, dayKey: string) {
    const previousDueOn = task.dueOn;
    const previousDueAt = task.dueAt;
    this.setTaskDueDateLocally(task.id, dueAtIso);
    if (!this.justPlannedIds.includes(task.id)) this.justPlannedIds = [...this.justPlannedIds, task.id];
    this.focusIndex = Math.min(this.focusIndex, Math.max(0, this.queueTasks.length - 1));
    // A real completion, not a cancel — lands on Triage same as always
    // rather than returnFromPlanLater's "go back to where this detour
    // started" (see openTaskInPlanLater), and clears it so it can't apply
    // to some later, unrelated close.
    this.returnFromPlanLater = null;
    this.screen = 'triage';
    this.bumpWorkloadLocally(dayKey, task.hours);
    this.enqueueDueWrite(task.id, dueAtIso);
    this.showToast(toastMsg, {
      label: 'Undo',
      onClick: () => {
        this.justPlannedIds = this.justPlannedIds.filter((id) => id !== task.id);
        this.restoreTaskDueFieldsAndRefocus(task.id, previousDueOn, previousDueAt);
        this.bumpWorkloadLocally(dayKey, -task.hours);
      },
    });
  }

  /// Drag-to-move on the day calendar (see DayCalendar.svelte) — moves a
  /// *different* task than the one currently being planned, without
  /// disturbing the current planning flow (no screen change). Overlaps are
  /// allowed — the calendar renders them side-by-side rather than blocking
  /// the move, so this never needs to consult findConflicts.
  moveOtherTask(taskId: string, date: string, hhmm: string): boolean {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return false;
    const dueAtIso = this.toIsoDateTime(date, hhmm);
    const previousDueOn = task.dueOn;
    const previousDueAt = task.dueAt;
    this.setTaskDueDateLocally(taskId, dueAtIso);
    this.enqueueDueWrite(taskId, dueAtIso);
    this.showToast(`Moved to ${hhmm} · syncing to Asana`, {
      label: 'Undo',
      onClick: () => this.restoreTaskDueFieldsLocally(taskId, previousDueOn, previousDueAt),
    });
    return true;
  }
  /// Clearing a due date entirely takes a task out of deriveQueue's queue
  /// server-side (no due date at all), so — unlike a normal re-plan — the
  /// optimistic update here moves it out of `tasks` into
  /// `tasksWithoutDueDate` rather than just updating it in place.
  clearOtherTaskDueDate(taskId: string): void {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return;
    const previousDueOn = task.dueOn;
    const previousDueAt = task.dueAt;
    this.setTaskDueDateLocally(taskId, null);
    this.enqueueDueWrite(taskId, null);
    this.showToast('Due time cleared · syncing to Asana', {
      label: 'Undo',
      onClick: () => this.restoreTaskDueFieldsLocally(taskId, previousDueOn, previousDueAt),
    });
  }

  tryPlanTodaySlot(slot: string) {
    const task = this.focusTaskRaw;
    const date = this.dateFor('today');
    if (!task || !date) return;
    const dueAtIso = this.toIsoDateTime(date, this.slotStart(slot));
    const conflicts = this.findConflicts(dueAtIso, task.hours, task.id);
    if (conflicts.length && this.confirmDoubleBooking) {
      this.conflictItems = conflicts;
      this.pendingSlotPlan = { kind: 'today', slot, taskId: task.id };
      this.screen = 'slotConflict';
      return;
    }
    this.commitPlanLocally(task, dueAtIso, `Planned "${task.name}" today at ${slot} · syncing to Asana`, 'today');
  }

  /// Not private — see loadTodaySlots' comment, same reasoning applies to
  /// FreeSlotsLater.svelte's $effect.
  async loadLaterSlots(dayKey: string) {
    const date = this.dateFor(dayKey);
    const focus = this.focusTaskRaw;
    if (!date || !focus) return;
    this.laterSlotsLoading = true;
    try {
      const res = await api.get<{ slots: string[]; outlookEvents: OutlookBlock[] }>(`/api/calendar/free-slots?${this.freeSlotsQuery(date, focus.hours, focus.id)}`);
      this.laterSlots = res.slots;
      this.laterOutlookEvents = res.outlookEvents;
    } catch (err) {
      this.reportError(err, 'Could not load free slots', { label: 'Retry', onClick: () => void this.loadLaterSlots(dayKey) });
    } finally {
      this.laterSlotsLoading = false;
    }
  }
  /// Same reasoning as earliestTodaySlotStart, for FreeSlotsLater's
  /// DayCalendar.
  get earliestLaterSlotStart(): string | null {
    const date = this.chosenDate;
    const focus = this.focusTaskRaw;
    const clean = date && focus ? this.firstFreeSlotStart(this.laterSlots, date, focus.hours, focus.id) : null;
    if (clean) return clean;
    if (this.laterSlotsLoading) return null;
    // See earliestTodaySlotStart's comment — same reasoning.
    if (date && focus) return this.scanForFreeStart(date, focus.hours, focus.id);
    return this.prefStartTime;
  }
  /// Prefers a slot the client's own findConflicts also agrees is free —
  /// the slots list is a snapshot from whenever it was fetched, and
  /// another task's due time can change locally (e.g. a plan committed
  /// elsewhere in the same session) without anything re-fetching this;
  /// this catches that instead of confidently auto-placing on top of a
  /// real conflict. Returns null if every slot now conflicts — the caller
  /// falls back to scanForFreeStart rather than trusting the list blindly.
  private firstFreeSlotStart(slots: string[], date: string, hours: number, excludeTaskId: string): string | null {
    for (const slot of slots) {
      const start = slotStartTime(slot);
      if (this.findConflicts(this.toIsoDateTime(date, start), hours, excludeTaskId).length === 0) return start;
    }
    return null;
  }
  /// Live fallback for when every candidate in the (possibly stale,
  /// server-fetched) slots list now conflicts — scans the working day in
  /// SNAP_MIN steps against the *current* task list (not the snapshot the
  /// server computed slots from), so a task that arrived or got planned
  /// locally after that fetch can't cause this to land on a slot it would
  /// immediately flag as double-booked. Only reaches prefStartTime
  /// unchecked if truly nothing in the whole working day is free.
  private scanForFreeStart(date: string, hours: number, excludeTaskId: string): string {
    const SNAP_MIN = 15;
    const [sh, sm] = this.prefStartTime.split(':').map(Number);
    const [eh, em] = this.prefEndTime.split(':').map(Number);
    const dayEndMin = eh * 60 + em;
    for (let mins = sh * 60 + sm; mins + hours * 60 <= dayEndMin; mins += SNAP_MIN) {
      const hhmm = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      if (this.findConflicts(this.toIsoDateTime(date, hhmm), hours, excludeTaskId).length === 0) return hhmm;
    }
    return this.prefStartTime;
  }

  tryPlanLaterSlot(slot: string) {
    const task = this.focusTaskRaw;
    const dayKey = this.laterDayKey;
    const date = dayKey ? this.dateFor(dayKey) : null;
    if (!task || !dayKey || !date) return;
    const dueAtIso = this.toIsoDateTime(date, this.slotStart(slot));
    const conflicts = this.findConflicts(dueAtIso, task.hours, task.id);
    if (conflicts.length && this.confirmDoubleBooking) {
      this.conflictItems = conflicts;
      this.pendingSlotPlan = { kind: 'later', dayKey, slot, taskId: task.id };
      this.screen = 'slotConflict';
      return;
    }
    this.commitPlanLocally(task, dueAtIso, `Planned "${task.name}" for ${this.chosenDayLabel} at ${slot} · syncing to Asana`, dayKey);
  }

  /// Clears pendingSlotPlan as literally the first thing, before any lookup
  /// or await — makes this safe against firing twice for the same conflict
  /// (a fast double-tap on "Double-book anyway" was a real, reported bug:
  /// the first call's commitPlanLocally advances focusIndex to the next
  /// queued task via justPlannedIds, so a second call that re-read
  /// focusTaskRaw instead of a pinned id would double-book *that* task
  /// instead — reading as "confirming moves another task"). Once cleared,
  /// a second near-simultaneous call just sees `p` as null and no-ops.
  async resolveConflictAnyway() {
    const p = this.pendingSlotPlan;
    if (!p) {
      // The exact guard that fixed the double-tap bug — a second call this
      // close together used to double-book whatever task focus had already
      // drifted to. Logged so we know empirically how often a stale/
      // duplicate invocation like this actually happens in practice, not
      // just that this one instance got caught and fixed.
      this.logAnomaly('resolveConflictAnyway.noPendingPlan', 'Called with no pendingSlotPlan — likely a duplicate/stale invocation', {
        screen: this.screen,
      });
      return;
    }
    this.pendingSlotPlan = null;
    if (p.kind === 'break') {
      await this.commitBreak(p.slot, true);
      return;
    }
    // Pinned at conflict-detection time (see tryPlanTodaySlot/
    // tryPlanLaterSlot) rather than re-reading focusTaskRaw here — see the
    // method comment above for why that distinction is the actual fix.
    const task = this.tasks.find((t) => t.id === p.taskId);
    if (!task) {
      this.logAnomaly('resolveConflictAnyway.taskMissing', 'Pinned task no longer in this.tasks', { taskId: p.taskId, kind: p.kind });
      this.reportError(new Error('missing task'), 'Could not double-book — that task is no longer available');
      return;
    }
    const dayKey = p.kind === 'today' ? 'today' : p.dayKey;
    const date = this.dateFor(dayKey);
    if (!date) {
      this.logAnomaly('resolveConflictAnyway.noDate', 'dateFor(dayKey) returned null', { dayKey });
      return;
    }
    const dueAtIso = this.toIsoDateTime(date, this.slotStart(p.slot));
    const label = p.kind === 'today' ? 'today' : this.chosenDayLabel;
    this.commitPlanLocally(task, dueAtIso, `Planned "${task.name}" for ${label} at ${p.slot} · syncing to Asana (double-booked)`, dayKey);
  }
  /// SlotConflict's own "don't ask again" — see DayFull's dontAskDayFullEver
  /// for the equivalent pattern: flips the existing Settings toggle, then
  /// completes the pending plan exactly as "Double-book anyway" would,
  /// rather than leaving the user still stuck on the conflict screen after
  /// choosing to stop seeing it.
  dontAskDoubleBookingAgain() {
    this.onConfirmDoubleBookingChange(false);
    void this.resolveConflictAnyway();
  }
  resolveConflictChooseAnother() {
    const p = this.pendingSlotPlan;
    this.pendingSlotPlan = null;
    if (!p) {
      this.logAnomaly('resolveConflictChooseAnother.noPendingPlan', 'Called with no pendingSlotPlan — likely a duplicate/stale invocation', {
        screen: this.screen,
      });
      this.screen = 'triage';
      return;
    }
    if (p.kind === 'today') {
      // Re-pin focus to the task this conflict was actually about — it may
      // have silently drifted (see resolveConflictAnyway's comment) since
      // the conflict was first detected.
      this.selectFocus(p.taskId);
      this.screen = 'planToday';
      // The picker now auto-seeds a slot instead of waiting for a tap (see
      // earliestTodaySlotStart) — re-fetch so that re-seed reflects
      // whatever just caused this conflict, instead of confidently
      // re-suggesting the exact same slot from a stale list.
      void this.loadTodaySlots();
    } else if (p.kind === 'later') {
      this.selectFocus(p.taskId);
      this.screen = 'freeSlotsLater';
      void this.loadLaterSlots(p.dayKey);
    } else if (p.kind === 'break') {
      this.screen = 'breakTime';
    }
  }

  /// Same reasoning as clearOtherTaskDueDate — no due date at all takes a
  /// task out of the server's queue entirely, so it moves to
  /// tasksWithoutDueDate locally rather than staying in `tasks`.
  removeDueDate() {
    const task = this.focusTaskRaw;
    if (!task || !task.dueOn) return; // already has no due date (e.g. reviewing the backlog) — nothing to remove
    const previousDueOn = task.dueOn;
    const previousDueAt = task.dueAt;
    this.setTaskDueDateLocally(task.id, null);
    this.focusIndex = Math.min(this.focusIndex, Math.max(0, this.queueTasks.length - 1));
    this.enqueueDueWrite(task.id, null);
    this.showToast(`Removed due date on "${task.name}" · syncing to Asana`, {
      label: 'Undo',
      onClick: () => this.restoreTaskDueFieldsAndRefocus(task.id, previousDueOn, previousDueAt),
    });
  }

  selectLaterDay(key: string) {
    if (this.isDayFull(key)) {
      this.pendingPlan = { type: 'later', key };
      this.screen = 'dayFull';
      return;
    }
    this.laterDayKey = key;
    this.laterSlots = [];
    this.screen = 'freeSlotsLater';
    void this.loadLaterSlots(key);
  }

  // --- estimate editing (focus card) ---
  onEditHours() {
    const t = this.focusTaskRaw;
    if (!t) return;
    this.editingHours = true;
    this.hoursDraft = t.hours;
  }
  decHour() {
    this.hoursDraft = stepHours(this.hoursDraft, -1);
  }
  incHour() {
    this.hoursDraft = stepHours(this.hoursDraft, 1);
  }
  onHoursDraftInput(v: string) {
    const n = parseFloat(v);
    this.hoursDraft = v === '' ? 0 : isNaN(n) ? 0 : n;
  }
  async confirmHours() {
    const task = this.focusTaskRaw;
    if (!task) return;
    this.editingHours = false;
    await this.patchHours(task.id, task.name, this.hoursDraft);
  }

  private async patchHours(taskId: string, name: string, hours: number) {
    try {
      await api.patch(`/api/tasks/${encodeURIComponent(taskId)}`, { hours, name });
      this.showToast('Updated estimate · synced to Asana');
      await this.refreshTasks();
    } catch (err) {
      this.reportError(err, 'Could not update the estimate');
    }
  }

  // --- estimate editing (up-next rows) ---
  onEditRestHours(id: string, hours: number) {
    this.editingRestId = id;
    this.restHoursDraft = hours;
  }
  decRestHour() {
    this.restHoursDraft = stepHours(this.restHoursDraft, -1);
  }
  incRestHour() {
    this.restHoursDraft = stepHours(this.restHoursDraft, 1);
  }
  onRestHoursInput(v: string) {
    const n = parseFloat(v);
    this.restHoursDraft = v === '' ? 0 : isNaN(n) ? 0 : n;
  }
  async confirmRestHours(id: string) {
    const task = this.tasks.find((t) => t.id === id);
    this.editingRestId = null;
    if (!task) return;
    await this.patchHours(task.id, task.name, this.restHoursDraft);
  }

  // --- split into a part wizard ---
  startBreak() {
    this.breakNameDraft = '';
    this.breakTimeSlot = null;
    this.breakDuration = 1;
    this.screen = 'breakName';
  }
  onBreakNameChange(v: string) {
    this.breakNameDraft = v;
  }
  async continueBreakName() {
    if (!this.breakNameDraft.trim()) return;
    await this.loadBreakTimeSlots();
    this.screen = 'breakTime';
  }

  // Its own loader rather than reusing loadTodaySlots()/planTodaySlots:
  // duration for a split-off part isn't chosen until the *next* screen
  // (breakDuration), so slots here are sized to the current breakDuration
  // default (1h, set in startBreak()) rather than the parent task's own
  // (likely much larger) hours.
  private async loadBreakTimeSlots() {
    const date = this.dateFor('today');
    const parent = this.focusTaskRaw;
    if (!date || !parent) return;
    try {
      const res = await api.get<{ slots: string[] }>(`/api/calendar/free-slots?${this.freeSlotsQuery(date, this.breakDuration, parent.id)}`);
      this.breakTimeSlots = res.slots;
    } catch (err) {
      this.reportError(err, 'Could not load free slots');
    }
  }
  backToBreakName() {
    this.screen = 'breakName';
  }
  selectBreakTime(slot: string) {
    this.breakTimeSlot = slot;
    this.screen = 'breakDuration';
  }
  tryBreakTime(slot: string) {
    // Conflict (if any) surfaces when the part is actually created — see createBreak().
    this.selectBreakTime(slot);
  }
  backToBreakTime() {
    this.screen = 'breakTime';
  }
  decDuration() {
    this.breakDuration = stepHours(this.breakDuration, -1, 8);
  }
  incDuration() {
    this.breakDuration = stepHours(this.breakDuration, 1, 8);
  }
  onBreakDurationInput(v: string) {
    const n = parseFloat(v);
    this.breakDuration = v === '' ? 0 : isNaN(n) ? 0 : n;
  }
  continueBreakDuration() {
    this.screen = 'breakConfirm';
  }
  backToBreakDuration() {
    this.screen = 'breakDuration';
  }
  editBreak() {
    this.screen = 'breakName';
  }

  async createBreak() {
    await this.commitBreak(this.breakTimeSlot!, false);
  }

  private async commitBreak(slot: string, force: boolean) {
    const parent = this.focusTaskRaw;
    const date = this.dateFor('today');
    if (!parent || !date) return;
    const dur = this.breakDuration;
    const name = this.breakNameDraft;

    let created: { gid: string; name: string };
    try {
      created = await api.post<{ gid: string; name: string }>('/api/tasks', { name, parentGid: parent.id });
    } catch (err) {
      this.reportError(err, 'Could not create the part in Asana');
      return;
    }

    const dueAtIso = this.toIsoDateTime(date, this.slotStart(slot));
    if (!force) {
      const conflicts = this.findConflicts(dueAtIso, dur, created.gid);
      if (conflicts.length && this.confirmDoubleBooking) {
        this.conflictItems = conflicts;
        this.pendingSlotPlan = { kind: 'break', slot };
        this.screen = 'slotConflict';
        return;
      }
    }
    this.enqueueDueWrite(created.gid, dueAtIso);

    try {
      await api.patch(`/api/tasks/${encodeURIComponent(created.gid)}`, { hours: dur, name });
    } catch (err) {
      this.reportError(err, 'Created the part, but could not set its estimate in Asana');
    }

    // Reduce the parent's remaining estimate (never below 0.5h) and send the
    // user straight back into Plan Later for the rest — we never remove or
    // complete the parent task ourselves; that stays the user's call in Asana.
    const remaining = Math.max(0.5, parent.hours - dur);
    try {
      await api.patch(`/api/tasks/${encodeURIComponent(parent.id)}`, { hours: remaining, name: parent.name });
    } catch (err) {
      this.reportError(err, 'Could not update the remaining estimate on the original task');
    }

    this.showToast(`"${name}" scheduled today at ${slot} (${fmtHours(dur)}) · synced to Asana`);
    await this.refreshTasks();
    await this.refreshWorkload();
    this.focusIndex = Math.max(0, this.queueTasks.findIndex((t) => t.id === parent.id));
    this.screen = 'planLater';
  }

  // --- overview: calendar event linking ---
  openAddPanel(eventId: string) {
    this.activePanelEventId = eventId;
    this.activePanelMode = 'add';
    this.searchQuery = searchSeedFor(this.eventInfo(eventId)?.title ?? '');
    void this.runTypeahead();
  }
  /// Unlike openAddPanel, doesn't seed a typeahead search — suggestedTaskMatches
  /// (see searchResultsFor) already surfaces the best same-day, name-similar
  /// candidates the moment the panel opens, which is a stronger starting
  /// point than a single keyword handed to Asana's own typeahead. Typing
  /// anything still falls through to that regular search as normal.
  openLinkPanel(eventId: string) {
    this.activePanelEventId = eventId;
    this.activePanelMode = 'link';
    this.searchQuery = '';
  }
  closeSearchPanel() {
    clearTimeout(this.typeaheadTimer);
    this.activePanelEventId = null;
    this.activePanelMode = null;
    this.searchQuery = '';
    this.typeaheadResults = [];
    this.typeaheadLoading = false;
    this.pinnedEventId = null;
  }
  onSearchChange(v: string) {
    this.searchQuery = v;
    this.scheduleTypeahead();
  }

  /// Backs the project/subtask/task search in the add/link panels — Asana's
  /// own typeahead endpoint (see routes/tasks.ts) instead of filtering the
  /// tasks already loaded client-side, which is only ever "incomplete,
  /// assigned to me, has a due date" (excludes plenty of tasks someone
  /// might actually want to link/add under, including anything without a
  /// due date at all). Falls back to the old client-side filtering — see
  /// Overview.svelte's resultsFor — if this fails, e.g. the connected
  /// Asana account predates the workspaces.typeahead:read scope and hasn't
  /// been reconnected yet.
  typeaheadResults: { gid: string; name: string; permalinkUrl: string; resourceType: 'task' | 'project' }[] = $state([]);
  typeaheadOk = $state(true);
  /// Set the instant a search is scheduled (not just once the request
  /// actually goes out) so the panel can show a spinner through the 250ms
  /// debounce window too, not just the network round-trip after it — the
  /// whole reason this got added is that a bare, silent wait *felt* slow
  /// even before the debounce/fetch was accounted for.
  typeaheadLoading = $state(false);
  private typeaheadTimer: ReturnType<typeof setTimeout> | undefined;
  private typeaheadSeq = 0;

  private scheduleTypeahead() {
    this.typeaheadLoading = true;
    clearTimeout(this.typeaheadTimer);
    this.typeaheadTimer = setTimeout(() => void this.runTypeahead(), 250);
  }
  private async runTypeahead() {
    const mode = this.activePanelMode;
    if (!mode) return;
    const q = this.searchQuery.trim();
    const seq = ++this.typeaheadSeq;
    this.typeaheadLoading = true;
    const fetchOne = (resourceType: 'task' | 'project') =>
      api.get<{ results: { gid: string; name: string; permalinkUrl: string }[] }>(
        `/api/tasks/typeahead?resourceType=${resourceType}&query=${encodeURIComponent(q)}`,
      );
    try {
      // Both panels show projects and tasks now — "link" used to only ask
      // for tasks, which is why projects looked like they were missing
      // from that field specifically.
      const [tasks, projects] = await Promise.all([fetchOne('task'), fetchOne('project')]);
      if (seq !== this.typeaheadSeq) return; // superseded by a newer keystroke
      this.typeaheadResults = [
        ...projects.results.map((p) => ({ ...p, resourceType: 'project' as const })),
        ...tasks.results.map((t) => ({ ...t, resourceType: 'task' as const })),
      ];
      this.typeaheadOk = true;
    } catch {
      if (seq !== this.typeaheadSeq) return;
      this.typeaheadOk = false;
      this.typeaheadResults = [];
    } finally {
      if (seq === this.typeaheadSeq) this.typeaheadLoading = false;
    }
  }

  /// Highlights the matched substring of a search result label against the
  /// current query — shared by Overview's and Triage's search-result lists
  /// so the highlight logic (and its "no query yet" no-op) only lives once.
  matchSplit(label: string): { pre: string; match: string; post: string } | null {
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) return null;
    const idx = label.toLowerCase().indexOf(query);
    if (idx === -1) return null;
    return { pre: label.slice(0, idx), match: label.slice(idx, idx + query.length), post: label.slice(idx + query.length) };
  }
  /// Backs the search-result list in both the add/link panels' project or
  /// subtask/task search — shared by Overview.svelte, Triage.svelte's
  /// event-triage card, and DayCalendar's calendar-view detail panel.
  /// Asana's own typeahead endpoint (runTypeahead) is the primary source
  /// once the user's typed something; falls back to filtering the client's
  /// already-loaded projects/tasks if that failed (e.g. the connected
  /// account predates the workspaces.typeahead:read scope and hasn't been
  /// reconnected yet).
  ///
  /// In "link" mode specifically, an empty query (i.e. the panel's just
  /// been opened, see openLinkPanel) shows suggestedTaskMatches first
  /// instead of nothing — same-day tasks ranked by name similarity to the
  /// event, which is a much stronger starting point than an unseeded
  /// typeahead search. Deduped against whatever else is about to be listed
  /// so a genuinely good match doesn't show up twice.
  ///
  /// Both panels show the same project results — selecting one always
  /// creates a new task for this event under it, "link" mode included,
  /// since linking only ever made sense against an existing *task*. Only
  /// the task-result action differs: "add" nests it as a subtask, "link"
  /// attaches the event directly to it.
  searchResultsFor(eventId: string, mode: 'add' | 'link' | null): { label: string; typeLabel: string; onSelect: () => void }[] {
    if (!mode) return [];
    const RESULT_LIMIT = 8;
    const query = this.searchQuery.trim().toLowerCase();
    const taskTypeLabel = mode === 'add' ? 'Subtask of' : 'Task';
    const taskAction =
      mode === 'add'
        ? (gid: string, name: string, permalinkUrl: string) => this.addEventAsSubtask(eventId, gid, name, permalinkUrl)
        : (gid: string, name: string, permalinkUrl: string) => this.linkEventToTask(eventId, gid, name, permalinkUrl);

    const suggested = mode === 'link' && !query ? this.suggestedTaskMatches(eventId) : [];
    const suggestedGids = new Set(suggested.map((m) => m.gid));
    const suggestedResults = suggested.map((m) => ({
      label: m.name,
      typeLabel: 'Suggested · same day',
      onSelect: () => taskAction(m.gid, m.name, m.permalinkUrl),
    }));

    if (this.typeaheadOk) {
      const rest = this.typeaheadResults
        .filter((r) => r.resourceType === 'project' || !suggestedGids.has(r.gid))
        .map((r) =>
          r.resourceType === 'project'
            ? { label: r.name, typeLabel: 'Project', onSelect: () => this.addEventAsTaskWithProject(eventId, r.gid, r.name) }
            : { label: r.name, typeLabel: taskTypeLabel, onSelect: () => taskAction(r.gid, r.name, r.permalinkUrl) },
        );
      return [...suggestedResults, ...rest].slice(0, RESULT_LIMIT);
    }
    const rest = [
      ...this.projects
        .filter((p) => !query || p.name.toLowerCase().includes(query))
        .map((p) => ({ label: p.name, typeLabel: 'Project', onSelect: () => this.addEventAsTaskWithProject(eventId, p.gid, p.name) })),
      ...this.tasks
        .filter((t) => (!query || t.name.toLowerCase().includes(query)) && !suggestedGids.has(t.id))
        .map((t) => ({ label: t.name, typeLabel: taskTypeLabel, onSelect: () => taskAction(t.id, t.name, t.permalinkUrl) })),
    ];
    return [...suggestedResults, ...rest].slice(0, RESULT_LIMIT);
  }

  // --- overview: per-event popup ("›") — Link to task / Ignore. "Add as
  // task" ("+") skips this and opens the add panel directly.
  activeEventPopupId: string | null = $state(null);
  openEventPopup(eventId: string) {
    this.activeEventPopupId = eventId;
  }
  closeEventPopup() {
    this.activeEventPopupId = null;
  }

  // --- calendar view: click-to-open entry detail panel (see DayCalendar's
  // outlook-block onclick) — a second, independent entry point into the
  // same link/add/ignore actions as Overview's popup above, driven by
  // calendarViewOutlookEvents instead of `events` (the two lists overlap
  // but neither is a subset of the other — see eventTitle/
  // patchCalendarViewEvent below for how the shared actions stay correct
  // regardless of which list actually has the event loaded).
  detailPanelEventId: string | null = $state(null);
  openEventDetail(eventId: string) {
    this.detailPanelEventId = eventId;
  }
  closeEventDetail() {
    this.detailPanelEventId = null;
    this.closeSearchPanel();
  }
  get detailPanelEvent(): OutlookBlock | null {
    return this.calendarViewOutlookEvents.find((e) => e.id === this.detailPanelEventId) ?? null;
  }
  /// The link/add/ignore actions below all need a title (for their toast
  /// copy) and a date (for suggestedTaskMatches) — `events` (Overview's
  /// 7-day list) has both if loaded, but the calendar-view detail panel
  /// can act on an event that's only ever been fetched via
  /// calendarViewOutlookEvents (a specific day's free-slots call), never
  /// through `events` at all. Checked in both places rather than requiring
  /// one to be a superset of the other.
  private eventInfo(eventId: string): { title: string; dateStr: string } | undefined {
    const e = this.events.find((e) => e.id === eventId) ?? this.calendarViewOutlookEvents.find((e) => e.id === eventId);
    return e ? { title: e.title, dateStr: this.toLocalDateStr(e.start) } : undefined;
  }
  private eventTitle(eventId: string): string | undefined {
    return this.eventInfo(eventId)?.title;
  }
  /// The best guesses for which existing task a calendar event should link
  /// to — a task due the same calendar day as the event is very often
  /// already the right one (with no due *time* set yet, since it hasn't
  /// been placed on the calendar), so same-day tasks are the entire
  /// candidate pool, ranked purely by nameSimilarity against the event's
  /// title. Shown in the "Link existing task" panel (see searchResultsFor)
  /// whenever the search box is still empty — the moment the panel opens,
  /// before the user's typed anything of their own to search for instead.
  private suggestedTaskMatches(eventId: string): { gid: string; name: string; permalinkUrl: string; score: number }[] {
    const info = this.eventInfo(eventId);
    if (!info) return [];
    return this.tasks
      .filter((t) => t.dueOn === info.dateStr)
      .map((t) => ({ gid: t.id, name: t.name, permalinkUrl: t.permalinkUrl, score: nameSimilarity(info.title, t.name) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }
  /// Keeps the currently-shown calendar-view day in sync with a link/add/
  /// ignore/unlink action immediately, the same way the equivalent action
  /// already updates `events` — without this, an action taken from the
  /// detail panel would only show up after the next full free-slots
  /// refetch (changing day and back, or reopening the screen).
  private patchCalendarViewEvent(eventId: string, patch: Partial<OutlookBlock>) {
    this.calendarViewOutlookEvents = this.calendarViewOutlookEvents.map((e) => (e.id === eventId ? { ...e, ...patch } : e));
  }
  /// Dismisses an event from the Overview list — persisted server-side
  /// (see routes/calendar.ts), not just hidden client-side, so it stays
  /// gone across reloads.
  async ignoreEvent(eventId: string) {
    const title = this.eventTitle(eventId);
    if (!title) return;
    const removedFromEvents = this.events.find((e) => e.id === eventId);
    try {
      await api.post(`/api/calendar/events/${encodeURIComponent(eventId)}/ignore`, {});
      this.events = this.events.filter((e) => e.id !== eventId);
      this.patchCalendarViewEvent(eventId, { ignored: true, linked: false, linkedName: null, linkedTaskGid: null, linkedTaskPermalinkUrl: null });
      this.closeEventPopup();
      this.closeEventDetail();
      this.showToast(`Ignored "${title}"`, {
        label: 'Undo',
        onClick: () => {
          if (removedFromEvents) this.events = [...this.events, removedFromEvents];
          this.patchCalendarViewEvent(eventId, { ignored: false });
          api.post(`/api/calendar/events/${encodeURIComponent(eventId)}/unignore`, {}).catch((err) => {
            this.reportError(err, 'Could not restore this event');
          });
        },
      });
    } catch (err) {
      this.reportError(err, 'Could not ignore this event');
    }
  }
  /// "Remove linked task" in the detail panel — distinct from ignoreEvent
  /// above: clears the link but leaves the event undecided (not ignored),
  /// still eligible for gating/relinking, rather than dismissing it.
  async unlinkEvent(eventId: string) {
    const title = this.eventTitle(eventId);
    try {
      await api.post(`/api/calendar/events/${encodeURIComponent(eventId)}/unlink`, {});
      this.events = this.events.map((e) => (e.id === eventId ? { ...e, linked: false, linkedName: null, linkedTaskGid: null, linkedTaskPermalinkUrl: null } : e));
      this.patchCalendarViewEvent(eventId, { linked: false, linkedName: null, linkedTaskGid: null, linkedTaskPermalinkUrl: null });
      if (title) this.showToast(`Removed the linked task from "${title}"`);
    } catch (err) {
      this.reportError(err, 'Could not remove the linked task');
    }
  }
  /// The detail panel's own "Un-ignore" — brings an ignored event back to
  /// undecided. Doesn't touch `events`: ignored events are filtered out of
  /// that list server-side (see GET /events), so there's nothing there to
  /// restore; it'll pick this event back up next time it refetches.
  async unignoreEvent(eventId: string) {
    try {
      await api.post(`/api/calendar/events/${encodeURIComponent(eventId)}/unignore`, {});
      this.patchCalendarViewEvent(eventId, { ignored: false });
    } catch (err) {
      this.reportError(err, 'Could not restore this event');
    }
  }

  async addEventAsTaskWithProject(eventId: string, projectGid: string, projectName: string) {
    const title = this.eventTitle(eventId);
    if (!title) return;
    try {
      const created = await api.post<{ gid: string; name: string; permalinkUrl: string }>(`/api/calendar/events/${encodeURIComponent(eventId)}/add-task`, {
        title,
        target: { projectGid },
      });
      this.showToast(`Added "${title}" to ${projectName} · synced to Asana`);
      this.closeSearchPanel();
      this.patchCalendarViewEvent(eventId, {
        linked: true,
        linkedName: created.name,
        linkedTaskGid: created.gid,
        linkedTaskPermalinkUrl: created.permalinkUrl,
        ignored: false,
      });
      await Promise.all([this.refreshEvents(), this.refreshTasks()]);
    } catch (err) {
      this.reportError(err, 'Could not add the task in Asana');
    }
  }
  /// Takes the parent task's name directly rather than looking it up in
  /// `this.tasks` — that list is only ever "incomplete, assigned to me,
  /// has a due date" (see buildTasksPayload server-side), but typeahead
  /// results (the primary source for this panel — see runTypeahead) can
  /// name *any* task in the workspace. Looking the selection up in that
  /// narrower local list silently found nothing for anything outside it,
  /// so picking a real typeahead result just... did nothing, with no error
  /// surfaced anywhere — exactly the reported "selecting it doesn't do
  /// anything, the menu stays open" bug.
  async addEventAsSubtask(eventId: string, parentTaskId: string, parentTaskName: string, parentPermalinkUrl: string) {
    const title = this.eventTitle(eventId);
    if (!title) return;
    try {
      const created = await api.post<{ gid: string; name: string; permalinkUrl: string }>(`/api/calendar/events/${encodeURIComponent(eventId)}/add-task`, {
        title,
        target: { parentGid: parentTaskId },
      });
      // The subtask itself is new, so there's nothing ambiguous about it —
      // it's the *parent*, picked from typeahead's name-only results, that's
      // worth a second look (see linkEventToTask's identical reasoning).
      this.showToast(`Added "${title}" as a subtask of "${parentTaskName}" · synced to Asana`, {
        label: 'Open parent',
        href: parentPermalinkUrl,
      });
      this.closeSearchPanel();
      this.patchCalendarViewEvent(eventId, {
        linked: true,
        linkedName: created.name,
        linkedTaskGid: created.gid,
        linkedTaskPermalinkUrl: created.permalinkUrl,
        ignored: false,
      });
      await Promise.all([this.refreshEvents(), this.refreshTasks()]);
    } catch (err) {
      this.reportError(err, 'Could not add the subtask in Asana');
    }
  }
  /// Same reasoning as addEventAsSubtask above — takes the task's name
  /// directly instead of requiring it to already be in the locally-loaded
  /// `this.tasks`. Guards against linking a task that's already linked to a
  /// *different* event — that's normally a sign of picking the wrong
  /// search result rather than something intentional (one task standing in
  /// for two separate meetings), so it's confirmed via eventLinkConflict
  /// (see resolveEventLinkAnyway/resolveEventLinkChooseDifferent) rather
  /// than applied silently.
  async linkEventToTask(eventId: string, taskId: string, taskName: string, permalinkUrl: string) {
    // Conflict detection only checks `events` (Overview's 7-day list) — an
    // event only ever loaded via the calendar-view detail panel (see
    // eventTitle) and already linked to this same task wouldn't be caught
    // here. A rare miss, not a correctness issue: the server doesn't
    // enforce exclusivity either (see CalendarEventLink's own comment),
    // this check is a UX nicety on top.
    const conflict = this.events.find((e) => e.id !== eventId && e.linkedTaskGid === taskId);
    if (conflict) {
      this.pendingEventLink = {
        eventId,
        taskId,
        taskName,
        permalinkUrl,
        conflictingEventTitle: conflict.title,
        returnScreen: this.screen === 'overview' ? 'overview' : this.screen === 'calendarView' ? 'calendarView' : 'triage',
      };
      this.screen = 'eventLinkConflict';
      return;
    }
    await this.commitEventLink(eventId, taskId, taskName, permalinkUrl);
  }
  private async commitEventLink(eventId: string, taskId: string, taskName: string, permalinkUrl: string) {
    const title = this.eventTitle(eventId);
    if (!title) return;
    try {
      // Logged server-side (see matchLog.ts) regardless of how this task
      // was actually picked — from the suggested list, or a manual search
      // that happened to land on it anyway — as raw material for improving
      // suggestedTaskMatches' own scoring later. matchRank null means this
      // task wasn't in the suggested list at all, despite same-day
      // candidates existing to rank.
      const suggestions = this.suggestedTaskMatches(eventId);
      const matchRank = suggestions.findIndex((s) => s.gid === taskId);
      const matchScore = matchRank >= 0 ? suggestions[matchRank].score : nameSimilarity(title, taskName);
      await api.post(`/api/calendar/events/${encodeURIComponent(eventId)}/link`, {
        taskGid: taskId,
        taskName,
        permalinkUrl,
        matchLog: { eventTitle: title, matchScore, matchRank: matchRank >= 0 ? matchRank : null, candidateCount: suggestions.length },
      });
      // Typeahead only shows a name, which isn't always enough to be sure
      // it's the right task among several similarly-named ones — "Open
      // task" lets the user confirm the actual Asana task before trusting
      // the link.
      this.showToast(`Linked "${title}" to "${taskName}"`, { label: 'Open task', href: permalinkUrl });
      this.closeSearchPanel();
      this.patchCalendarViewEvent(eventId, { linked: true, linkedName: taskName, linkedTaskGid: taskId, linkedTaskPermalinkUrl: permalinkUrl, ignored: false });
      await this.refreshEvents();
    } catch (err) {
      this.reportError(err, 'Could not link the event');
    }
  }
  /// "Choose a different task" (or closing the conflict screen) — the
  /// search panel underneath was never touched, so going back to
  /// returnScreen lands right back on the same results.
  resolveEventLinkChooseDifferent() {
    const p = this.pendingEventLink;
    this.pendingEventLink = null;
    if (!p) this.logAnomaly('resolveEventLinkChooseDifferent.noPendingLink', 'Called with no pendingEventLink', { screen: this.screen });
    this.screen = p?.returnScreen ?? 'triage';
  }
  /// "Link anyway" — proceeds with the link the user actually picked,
  /// leaving the other event's link to the same task in place too. Already
  /// safe against the same double-invocation class of bug resolveConflict
  /// Anyway had (see its own comment): p's fields are captured values, not
  /// a live re-read, and pendingEventLink is cleared before the only
  /// `await` in this function, so a second near-simultaneous call always
  /// sees it as null by the time it runs.
  async resolveEventLinkAnyway() {
    const p = this.pendingEventLink;
    if (!p) {
      this.logAnomaly('resolveEventLinkAnyway.noPendingLink', 'Called with no pendingEventLink — likely a duplicate/stale invocation', {
        screen: this.screen,
      });
      return;
    }
    this.screen = p.returnScreen;
    this.pendingEventLink = null;
    await this.commitEventLink(p.eventId, p.taskId, p.taskName, p.permalinkUrl);
  }
}

export const planner = new PlannerStore();
