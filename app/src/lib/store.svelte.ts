import type {
  CalendarEvent,
  ConflictItem,
  PendingActionDto,
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
import { fmtHours } from './format';

let toastTimer: ReturnType<typeof setTimeout> | undefined;

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

interface MeResponse {
  primaryProvider: 'ASANA' | 'OUTLOOK';
  asanaConnected: boolean;
  outlookConnected: boolean;
  asanaAccountLabel: string | null;
  outlookAccountLabel: string | null;
  settings: { prefStartTime: string; prefEndTime: string; bufferMinutes: number; timezone: string; skipDayFullWarning: boolean };
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
  focusIndex = $state(0);

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

  workloadDays: WorkloadDay[] = $state([]);

  laterDayKey: string | null = $state(null);
  customDateValue = $state('');
  customDayLabel = $state('');
  showCustomTimeToday = $state(false);
  showCustomTimeLater = $state(false);
  planTodaySlots: string[] = $state([]);
  laterSlots: string[] = $state([]);

  breakNameDraft = $state('');
  breakTimeSlot: string | null = $state(null);
  breakDuration = $state(1);
  breakTimeSlots: string[] = $state([]);

  prefStartTime = $state('09:00');
  prefEndTime = $state('18:00');
  bufferMinutes = $state(10);
  timezone = $state('UTC');
  skipDayFullWarning = $state(false);

  activePanelEventId: string | null = $state(null);
  activePanelMode: 'add' | 'link' | null = $state(null);
  searchQuery = $state('');
  events: CalendarEvent[] = $state([]);

  pendingPlan: PendingPlan | null = $state(null);
  pendingSlotPlan: PendingSlotPlan | null = $state(null);
  conflictItems: ConflictItem[] = $state([]);

  toastMsg: string | null = $state(null);

  /// Bumped (never reset) each time a day gets fully planned, so the UI can
  /// key a confetti burst off it — incrementing rather than a boolean means
  /// two celebrations back-to-back both restart the animation instead of the
  /// second one being a no-op because "celebrating" was already true.
  celebrationKey = $state(0);

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
    if (this.workloadLoading || !this.todayWorkload) return 'var(--color-text-muted)';
    return this.todayRatio >= 1 ? 'var(--color-feedback-wrong)' : 'var(--color-feedback-correct)';
  }
  get todayBadgeLabel() {
    const t = this.todayWorkload;
    return t ? `${t.planned}/${t.capacity}h` : '';
  }
  private get todayDateStr(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  /// Tasks due today, by Asana's due date (dueOn — set whether or not a
  /// specific time is attached), independent of the "unplanned if no time"
  /// triage-queue rule elsewhere in the app.
  private get tasksDueToday(): Task[] {
    const todayStr = this.todayDateStr;
    return this.tasks.filter((t) => t.dueOn === todayStr);
  }
  /// The "day" the queue is currently working through, driven by whichever
  /// task is focused rather than hardcoded to literal today — so the header
  /// and Overview's highlight follow you as you swipe into tomorrow's tasks
  /// or jump around. An overdue task's own due date is clamped up to today:
  /// there's nothing to plan in the past, so it's treated as today's problem
  /// (see resetToday's inverse case: only *today's* tasks get reset).
  get activeDayDateStr(): string {
    const todayStr = this.todayDateStr;
    const focusDueOn = this.focusTaskRaw?.dueOn;
    if (!focusDueOn || focusDueOn < todayStr) return todayStr;
    return focusDueOn;
  }
  private get tasksForActiveDay(): Task[] {
    const active = this.activeDayDateStr;
    const todayStr = this.todayDateStr;
    return this.tasks.filter((t) => (t.dueOn && t.dueOn < todayStr ? todayStr : t.dueOn) === active);
  }
  get queueLabel() {
    if (!this.hasFocusTask) return '';
    if (this.reviewingBacklog) {
      const n = this.queueTasks.length;
      return `Backlog - ${n} task${n === 1 ? '' : 's'} without a due date`;
    }
    const active = this.activeDayDateStr;
    const namedDay = this.workloadDays.find((d) => d.date === active);
    const dateLabel = namedDay ? namedDay.label : new Date(`${active}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    const dueThatDay = this.tasksForActiveDay;
    const withTime = dueThatDay.filter((t) => t.dueAt).length;
    return `${dateLabel} - ${withTime}/${dueThatDay.length} Tasks planned`;
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
  /// `action` gets its own longer window (5s vs 2.6s) since it takes a
  /// moment to notice there's something to tap, on top of reading the
  /// message itself.
  showToast(msg: string, action?: ToastAction) {
    clearTimeout(toastTimer);
    this.toastMsg = msg;
    this.toastAction = action ?? null;
    toastTimer = setTimeout(() => {
      this.toastMsg = null;
      this.toastAction = null;
    }, action ? 5000 : 2600);
  }
  dismissToast() {
    clearTimeout(toastTimer);
    this.toastMsg = null;
    this.toastAction = null;
  }

  private reportError(err: unknown, fallback: string, action?: ToastAction) {
    const msg = err instanceof ApiError ? err.message : fallback;
    this.showToast(msg, action);
  }

  // --- boot ---
  // Surfaced on the loading screen (see App.svelte) so the wait between
  // "app opened" and "first task visible" always shows *something*
  // happening, not just a static "Loading your day…" for the whole
  // several-second stretch — especially the phases before any task-fetch
  // progress event has arrived to drive loadingProgressLabel.
  bootStatus = $state('Connecting…');

  async boot() {
    this.bootStatus = 'Connecting…';
    const params = new URLSearchParams(window.location.search);
    const onboarding = params.get('onboarding') === 'secondary';
    if (onboarding) {
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
    await this.bootRefreshTasks();
    this.maybeShowIosInstallBanner();
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
    this.bootStatus = 'Loading your tasks…';
    this.loadingTasksCount = 0;
    const cached = localStorage.getItem('lastTaskCount');
    this.loadingTasksEstimate = cached ? parseInt(cached, 10) : null;
    try {
      await this.streamTasks();
      localStorage.setItem('lastTaskCount', String(this.tasks.length));
    } catch (err) {
      this.reportError(err, 'Could not load tasks from Asana', { label: 'Retry', onClick: () => void this.bootRefreshTasks() });
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

  private streamTasks(): Promise<void> {
    return new Promise((resolve, reject) => {
      const es = new EventSource('/api/tasks/stream');
      es.addEventListener('progress', (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data);
          this.loadingTasksCount = data.count;
          this.applyTaskBatch(data);
        } catch {
          // malformed progress event — harmless, just skip this tick
        }
      });
      es.addEventListener('failed', (e) => {
        es.close();
        const msg = (() => {
          try {
            return JSON.parse((e as MessageEvent).data).error;
          } catch {
            return undefined;
          }
        })();
        reject(new Error(msg || 'Failed to load tasks'));
      });
      es.addEventListener('done', (e) => {
        es.close();
        try {
          this.applyTaskBatch(JSON.parse((e as MessageEvent).data));
          resolve();
        } catch (err) {
          reject(err as Error);
        }
      });
      es.onerror = () => {
        es.close();
        reject(new Error('Lost connection to the server while loading tasks'));
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
      this.reportError(err, 'Could not load tasks from Asana', { label: 'Retry', onClick: () => void this.refreshTasks() });
    }
  }

  /// Drives the Triage capacity badge's loading state (see todayBadgeBg) —
  /// true for the duration of any workload refresh, whether that's the
  /// initial boot load or a resync after committing a plan.
  workloadLoading = $state(false);

  async refreshWorkload() {
    this.workloadLoading = true;
    try {
      const res = await api.get<{ days: WorkloadDay[] }>('/api/workload');
      this.workloadDays = res.days;
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
    // Left = plan today, right = plan later (matches the button order below).
    if (dx < -threshold) this.openPlanToday();
    else if (dx > threshold) this.openPlanLater();
  }

  // --- queue nav ---
  goPrev() {
    if (this.queueTasks.length <= 1) return;
    this.focusIndex = (this.focusIndex - 1 + this.queueTasks.length) % this.queueTasks.length;
  }
  goNext() {
    if (this.queueTasks.length <= 1) return;
    this.focusIndex = (this.focusIndex + 1) % this.queueTasks.length;
  }
  selectFocus(id: string) {
    this.focusIndex = Math.max(0, this.queueTasks.findIndex((t) => t.id === id));
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
    patch: Partial<{ prefStartTime: string; prefEndTime: string; bufferMinutes: number; timezone: string; skipDayFullWarning: boolean }>,
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
            this.enqueueDueAtFireAndForget(t.id, t.previousDueAt);
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
    if (!d || d.planned / d.capacity < 1) return false;
    if (this.skipDayFullWarning) return false;
    const date = this.dateFor(key);
    if (date && localStorage.getItem(this.dayFullDismissKey(date)) === '1') return false;
    return true;
  }
  /// Both dismiss the DayFull warning (for this day only, or for good) and
  /// then proceed exactly as "Plan for this day anyway" would — the
  /// warning was already blocking whatever the user was trying to do.
  async dontAskDayFullToday() {
    const p = this.pendingPlan;
    const key = p ? (p.type === 'today' ? 'today' : p.key) : null;
    const date = key ? this.dateFor(key) : null;
    if (date) localStorage.setItem(this.dayFullDismissKey(date), '1');
    await this.onPlanAnyway();
  }
  async dontAskDayFullEver() {
    this.skipDayFullWarning = true;
    void this.patchSettings({ skipDayFullWarning: true });
    await this.onPlanAnyway();
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

  async openPlanToday() {
    if (this.isDayFull('today')) {
      this.pendingPlan = { type: 'today' };
      this.screen = 'dayFull';
      return;
    }
    await this.loadTodaySlots();
    this.showCustomTimeToday = false;
    this.screen = 'planToday';
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

  private async loadTodaySlots() {
    const date = this.dateFor('today');
    const focus = this.focusTaskRaw;
    if (!date || !focus) return;
    try {
      const res = await api.get<{ slots: string[] }>(`/api/calendar/free-slots?${this.freeSlotsQuery(date, focus.hours, focus.id)}`);
      this.planTodaySlots = res.slots;
    } catch (err) {
      this.reportError(err, 'Could not load free slots');
    }
  }

  openPlanLater() {
    this.screen = 'planLater';
  }
  openPickDate() {
    this.screen = 'pickDate';
  }
  async onPlanAnyway() {
    const p = this.pendingPlan;
    if (!p) {
      this.screen = 'triage';
      return;
    }
    if (p.type === 'today') {
      await this.loadTodaySlots();
      this.showCustomTimeToday = false;
      this.screen = 'planToday';
    } else if (p.key) {
      await this.loadLaterSlots(p.key);
      this.laterDayKey = p.key;
      this.showCustomTimeLater = false;
      this.screen = 'freeSlotsLater';
    }
  }
  onReviewOtherTasks() {
    this.focusIndex = 0;
    this.screen = 'triage';
  }
  closeFlow() {
    this.showCustomTimeToday = false;
    this.screen = 'triage';
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
  /// "Tasks without Due Date" in Overview — opens the exact same Triage
  /// screen/flow, just working through tasksWithoutDueDate instead of the
  /// normal queue (see queueTasks). Leaving to Settings/Overview and back
  /// returns to the normal queue, same as justPlannedIds' "re-open the day".
  reviewBacklog() {
    if (this.tasksWithoutDueDate.length === 0) return;
    this.reviewingBacklog = true;
    this.focusIndex = 0;
    this.screen = 'triage';
  }

  /// Clicking a day (or the aggregate "Next week" row) in Overview jumps the
  /// triage queue to the earliest task due that day/week — goNext() from
  /// there naturally continues on to later due dates since `tasks` is
  /// already sorted ascending by due date.
  focusQueueForDay(day: WorkloadDay) {
    const rangeStart = day.date ? new Date(day.date) : day.rangeStart ? new Date(day.rangeStart) : null;
    const rangeEnd = day.date ? new Date(new Date(day.date).getTime() + 86_400_000) : day.rangeEnd ? new Date(day.rangeEnd) : null;
    if (!rangeStart || !rangeEnd) return;

    const matches = this.tasks
      .filter((t): t is Task & { dueAt: string } => !!t.dueAt && new Date(t.dueAt) >= rangeStart && new Date(t.dueAt) < rangeEnd)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

    if (!matches.length) {
      this.showToast(`No tasks due ${day.label}`);
      return;
    }
    // Clears justPlannedIds before searching, so the index below is
    // computed against the same (now unfiltered) array it'll actually be
    // read against once this returns to Triage.
    this.closeOverview();
    const idx = this.queueTasks.findIndex((t) => t.id === matches[0].id);
    if (idx >= 0) this.focusIndex = idx;
  }

  get laterDays() {
    return this.workloadDays
      .filter((d) => d.key !== 'today')
      .map((d) => ({
        key: d.key,
        label: d.label,
        badgeLabel: `${d.planned}/${d.capacity}h`,
        tone: d.planned / d.capacity >= 1 ? ('wrong' as const) : ('correct' as const),
      }));
  }

  private toIsoDateTime(date: string, hhmm: string): string {
    return new Date(`${date}T${hhmm}:00`).toISOString();
  }
  private slotStart(slot: string): string {
    // "13:00–13:30" or "Mon 09:00–10:00" -> "13:00"
    const timePart = slot.includes(' ') ? slot.split(' ')[1] : slot;
    return timePart.split('–')[0];
  }

  /// The double-book check against a live Asana re-fetch used to be the
  /// dominant cost of planning a task — this checks the same already-loaded
  /// `tasks` a free-slots list was built from instead, so it's instant, at
  /// the cost of trusting client-side data that could in principle be a few
  /// seconds stale (matches how free-slots itself already trusts it).
  private findConflicts(dueAtIso: string, excludeTaskId: string): ConflictItem[] {
    return this.tasks.filter((t) => t.id !== excludeTaskId && t.dueAt === dueAtIso).map((t) => ({ name: t.name, hours: t.hours }));
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
      dueOn: dueAtIso ? dueAtIso.slice(0, 10) : null,
      dueHour: dueAtIso ? dueAtIso.slice(11, 16) : null,
      doubled: false,
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
  /// date at all" (also dueAt: null). This restores both fields directly.
  /// The one thing it can't do is push a date-only restore to Asana itself
  /// — setTaskDueAt only ever writes a full instant or clears both fields
  /// entirely, it has no "due_on without due_at" mode — so that specific
  /// case (undoing a plan made on a date-only task) only fixes the local
  /// view; the actual Asana due_at stays whatever the undone action set.
  /// Every other case (restoring a real previous time, or restoring "no
  /// due date at all") writes through normally.
  private restoreTaskDueFieldsLocally(taskId: string, previousDueOn: string | null, previousDueAt: string | null) {
    const existing = this.tasks.find((t) => t.id === taskId) ?? this.tasksWithoutDueDate.find((t) => t.id === taskId);
    if (!existing) return;
    const updated: Task = { ...existing, dueOn: previousDueOn, dueAt: previousDueAt, dueHour: previousDueAt ? previousDueAt.slice(11, 16) : null, doubled: false };
    this.tasks = this.tasks.filter((t) => t.id !== taskId);
    this.tasksWithoutDueDate = this.tasksWithoutDueDate.filter((t) => t.id !== taskId);
    if (previousDueOn) this.tasks = [...this.tasks, updated];
    else this.tasksWithoutDueDate = [...this.tasksWithoutDueDate, updated];
    if (previousDueAt || !previousDueOn) this.enqueueDueAtFireAndForget(taskId, previousDueAt);
  }

  /// Fires the actual Asana write without making the caller wait on it —
  /// the write itself already happens on the server's background queue
  /// (pendingActionQueue.ts) regardless, so there's nothing left worth
  /// blocking the UI on. Errors (e.g. a genuinely dropped connection, not
  /// the write's own retries — those are the queue's problem) still surface
  /// as a toast.
  private enqueueDueAtFireAndForget(taskId: string, dueAtIso: string | null) {
    api.patch(`/api/tasks/${encodeURIComponent(taskId)}`, { dueAt: dueAtIso }).catch((err) => {
      this.reportError(err, 'Could not update the task in Asana');
    });
  }

  /// Bumps a day's planned hours optimistically (a real refreshWorkload()
  /// would show the same number eventually, but only after a round trip we
  /// don't want to wait on) so the capacity badge and a possible
  /// celebration both react immediately instead of on the next unrelated
  /// refresh.
  private bumpWorkloadLocally(dayKey: string, addedHours: number) {
    const idx = this.workloadDays.findIndex((d) => d.key === dayKey);
    if (idx === -1) return;
    const updated = { ...this.workloadDays[idx], planned: Math.round((this.workloadDays[idx].planned + addedHours) * 10) / 10 };
    this.workloadDays = [...this.workloadDays.slice(0, idx), updated, ...this.workloadDays.slice(idx + 1)];
    if (updated.capacity > 0 && updated.planned >= updated.capacity) this.celebrationKey++;
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
    this.screen = 'triage';
    this.bumpWorkloadLocally(dayKey, task.hours);
    this.enqueueDueAtFireAndForget(task.id, dueAtIso);
    this.showToast(toastMsg, {
      label: 'Undo',
      onClick: () => {
        this.restoreTaskDueFieldsLocally(task.id, previousDueOn, previousDueAt);
        this.justPlannedIds = this.justPlannedIds.filter((id) => id !== task.id);
        this.bumpWorkloadLocally(dayKey, -task.hours);
        this.selectFocus(task.id);
      },
    });
  }

  /// Drag-to-move on the day calendar (see DayCalendar.svelte) — moves a
  /// *different* task than the one currently being planned, without
  /// disturbing the current planning flow (no screen change). A conflict
  /// just reverts the drag with a toast rather than routing to the full
  /// slotConflict screen, since that screen's "plan anyway" flow is built
  /// around the task actually being planned, not an incidental drag
  /// elsewhere on the day.
  moveOtherTask(taskId: string, date: string, hhmm: string): boolean {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return false;
    const dueAtIso = this.toIsoDateTime(date, hhmm);
    if (this.findConflicts(dueAtIso, taskId).length) {
      this.showToast('That time is already taken');
      return false;
    }
    const previousDueOn = task.dueOn;
    const previousDueAt = task.dueAt;
    this.setTaskDueDateLocally(taskId, dueAtIso);
    this.enqueueDueAtFireAndForget(taskId, dueAtIso);
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
    this.enqueueDueAtFireAndForget(taskId, null);
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
    const conflicts = this.findConflicts(dueAtIso, task.id);
    if (conflicts.length) {
      this.conflictItems = conflicts;
      this.pendingSlotPlan = { kind: 'today', slot };
      this.screen = 'slotConflict';
      return;
    }
    this.commitPlanLocally(task, dueAtIso, `Planned "${task.name}" today at ${slot} · syncing to Asana`, 'today');
  }

  toggleCustomTimeToday() {
    this.showCustomTimeToday = !this.showCustomTimeToday;
  }

  private async loadLaterSlots(dayKey: string) {
    const date = this.dateFor(dayKey);
    const focus = this.focusTaskRaw;
    if (!date || !focus) return;
    try {
      const res = await api.get<{ slots: string[] }>(`/api/calendar/free-slots?${this.freeSlotsQuery(date, focus.hours, focus.id)}`);
      this.laterSlots = res.slots;
    } catch (err) {
      this.reportError(err, 'Could not load free slots');
    }
  }

  tryPlanLaterSlot(slot: string) {
    const task = this.focusTaskRaw;
    const dayKey = this.laterDayKey;
    const date = dayKey ? this.dateFor(dayKey) : null;
    if (!task || !dayKey || !date) return;
    const dueAtIso = this.toIsoDateTime(date, this.slotStart(slot));
    const conflicts = this.findConflicts(dueAtIso, task.id);
    if (conflicts.length) {
      this.conflictItems = conflicts;
      this.pendingSlotPlan = { kind: 'later', dayKey, slot };
      this.screen = 'slotConflict';
      return;
    }
    this.commitPlanLocally(task, dueAtIso, `Planned "${task.name}" for ${this.chosenDayLabel} at ${slot} · syncing to Asana`, dayKey);
  }

  async resolveConflictAnyway() {
    const p = this.pendingSlotPlan;
    const task = this.focusTaskRaw;
    if (!p || !task) return;
    if (p.kind === 'today' || p.kind === 'later') {
      const dayKey = p.kind === 'today' ? 'today' : p.dayKey;
      const date = this.dateFor(dayKey);
      if (!date) return;
      const dueAtIso = this.toIsoDateTime(date, this.slotStart(p.slot));
      const label = p.kind === 'today' ? 'today' : this.chosenDayLabel;
      this.commitPlanLocally(task, dueAtIso, `Planned "${task.name}" for ${label} at ${p.slot} · syncing to Asana (double-booked)`, dayKey);
    } else if (p.kind === 'break') {
      await this.commitBreak(p.slot, true);
    }
  }
  resolveConflictChooseAnother() {
    const p = this.pendingSlotPlan;
    if (!p) {
      this.screen = 'triage';
      return;
    }
    if (p.kind === 'today') this.screen = 'planToday';
    else if (p.kind === 'later') this.screen = 'freeSlotsLater';
    else if (p.kind === 'break') this.screen = 'breakTime';
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
    this.enqueueDueAtFireAndForget(task.id, null);
    this.showToast(`Removed due date on "${task.name}" · syncing to Asana`, {
      label: 'Undo',
      onClick: () => {
        this.restoreTaskDueFieldsLocally(task.id, previousDueOn, previousDueAt);
        this.selectFocus(task.id);
      },
    });
  }

  async selectLaterDay(key: string) {
    if (this.isDayFull(key)) {
      this.pendingPlan = { type: 'later', key };
      this.screen = 'dayFull';
      return;
    }
    await this.loadLaterSlots(key);
    this.laterDayKey = key;
    this.showCustomTimeLater = false;
    this.screen = 'freeSlotsLater';
  }
  onCustomDateChange(v: string) {
    this.customDateValue = v;
  }
  async continuePickDate() {
    const v = this.customDateValue;
    if (!v) return;
    const label = new Date(`${v}T00:00`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
    this.customDayLabel = label;
    this.laterDayKey = 'custom';
    await this.loadLaterSlots('custom');
    this.showCustomTimeLater = false;
    this.screen = 'freeSlotsLater';
  }
  toggleCustomTimeLater() {
    this.showCustomTimeLater = !this.showCustomTimeLater;
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
      const conflicts = this.findConflicts(dueAtIso, created.gid);
      if (conflicts.length) {
        this.conflictItems = conflicts;
        this.pendingSlotPlan = { kind: 'break', slot };
        this.screen = 'slotConflict';
        return;
      }
    }
    this.enqueueDueAtFireAndForget(created.gid, dueAtIso);

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
    this.searchQuery = '';
  }
  openLinkPanel(eventId: string) {
    this.activePanelEventId = eventId;
    this.activePanelMode = 'link';
    this.searchQuery = '';
  }
  closeSearchPanel() {
    this.activePanelEventId = null;
    this.activePanelMode = null;
    this.searchQuery = '';
  }
  onSearchChange(v: string) {
    this.searchQuery = v;
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
  /// Dismisses an event from the Overview list — persisted server-side
  /// (see routes/calendar.ts), not just hidden client-side, so it stays
  /// gone across reloads.
  async ignoreEvent(eventId: string) {
    const ev = this.events.find((e) => e.id === eventId);
    if (!ev) return;
    try {
      await api.post(`/api/calendar/events/${encodeURIComponent(eventId)}/ignore`, {});
      this.events = this.events.filter((e) => e.id !== eventId);
      this.closeEventPopup();
      this.showToast(`Ignored "${ev.title}"`, {
        label: 'Undo',
        onClick: () => {
          this.events = [...this.events, ev];
          api.post(`/api/calendar/events/${encodeURIComponent(eventId)}/unignore`, {}).catch((err) => {
            this.reportError(err, 'Could not restore this event');
          });
        },
      });
    } catch (err) {
      this.reportError(err, 'Could not ignore this event');
    }
  }

  async addEventAsTaskWithProject(eventId: string, projectGid: string, projectName: string) {
    const ev = this.events.find((e) => e.id === eventId);
    if (!ev) return;
    try {
      await api.post(`/api/calendar/events/${encodeURIComponent(eventId)}/add-task`, {
        title: ev.title,
        target: { projectGid },
      });
      this.showToast(`Added "${ev.title}" to ${projectName} · synced to Asana`);
      this.closeSearchPanel();
      await Promise.all([this.refreshEvents(), this.refreshTasks()]);
    } catch (err) {
      this.reportError(err, 'Could not add the task in Asana');
    }
  }
  async addEventAsSubtask(eventId: string, parentTaskId: string) {
    const ev = this.events.find((e) => e.id === eventId);
    const parent = this.tasks.find((t) => t.id === parentTaskId);
    if (!ev || !parent) return;
    try {
      await api.post(`/api/calendar/events/${encodeURIComponent(eventId)}/add-task`, {
        title: ev.title,
        target: { parentGid: parent.id },
      });
      this.showToast(`Added "${ev.title}" as a subtask of "${parent.name}" · synced to Asana`);
      this.closeSearchPanel();
      await Promise.all([this.refreshEvents(), this.refreshTasks()]);
    } catch (err) {
      this.reportError(err, 'Could not add the subtask in Asana');
    }
  }
  async linkEventToTask(eventId: string, taskId: string) {
    const task = this.tasks.find((t) => t.id === taskId);
    const ev = this.events.find((e) => e.id === eventId);
    if (!task || !ev) return;
    try {
      await api.post(`/api/calendar/events/${encodeURIComponent(eventId)}/link`, { taskGid: task.id, taskName: task.name });
      this.showToast(`Linked "${ev.title}" to "${task.name}"`);
      this.closeSearchPanel();
      await this.refreshEvents();
    } catch (err) {
      this.reportError(err, 'Could not link the event');
    }
  }

  openAsana(task: Task) {
    window.open(task.permalinkUrl, '_blank', 'noopener');
  }
}

export const planner = new PlannerStore();
