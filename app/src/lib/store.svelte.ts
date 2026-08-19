import type {
  CalendarEvent,
  ConflictItem,
  PendingPlan,
  PendingSlotPlan,
  Project,
  Provider,
  Screen,
  Task,
  WorkloadDay,
} from './types';
import { api, ApiError } from './api';
import { fmtHours } from './format';

let toastTimer: ReturnType<typeof setTimeout> | undefined;

interface MeResponse {
  primaryProvider: 'ASANA' | 'OUTLOOK';
  asanaConnected: boolean;
  outlookConnected: boolean;
  asanaAccountLabel: string | null;
  outlookAccountLabel: string | null;
  settings: { prefStartTime: string; prefEndTime: string; bufferMinutes: number; timezone: string };
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
  customTimeToday = $state('');
  showCustomTimeToday = $state(false);
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
    return this.tasks.length > 0 ? this.tasks[this.focusIndex] : null;
  }
  get hasFocusTask() {
    return this.tasks.length > 0;
  }
  get todayWorkload(): WorkloadDay | null {
    return this.workloadDays.find((d) => d.key === 'today') ?? null;
  }
  get todayRatio() {
    const t = this.todayWorkload;
    return t ? t.planned / t.capacity : 0;
  }
  get todayBadgeBg() {
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
  showToast(msg: string) {
    clearTimeout(toastTimer);
    this.toastMsg = msg;
    toastTimer = setTimeout(() => {
      this.toastMsg = null;
    }, 2600);
  }

  private reportError(err: unknown, fallback: string) {
    const msg = err instanceof ApiError ? err.message : fallback;
    this.showToast(msg);
  }

  // --- boot ---
  async boot() {
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

    if (onboarding && (!me.asanaConnected || !me.outlookConnected)) {
      this.screen = 'loginSecondary';
      return;
    }

    await this.enterTriage();
  }

  private async enterTriage() {
    await Promise.all([this.bootRefreshTasks(), this.refreshWorkload()]);
    this.focusIndex = 0;
    this.screen = 'triage';
    this.maybeShowIosInstallBanner();
  }

  // --- boot-time task loading progress ---
  // A "crowded" Asana workspace can mean many paginated requests plus
  // per-subtask breadcrumb lookups server-side — genuinely multi-second
  // work the plain GET /api/tasks used by refreshTasks() gives no
  // visibility into. Only the boot path uses this SSE variant; every other
  // refresh (after committing a plan, etc.) is fast enough in practice and
  // isn't shown on a loading screen anyway, so it keeps using the simple GET.
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
    if (!this.asanaConnected) return;
    this.loadingTasksCount = 0;
    const cached = localStorage.getItem('lastTaskCount');
    this.loadingTasksEstimate = cached ? parseInt(cached, 10) : null;
    try {
      const res = await this.streamTasks();
      this.tasks = res.tasks;
      this.tasksWithoutDueDate = res.tasksWithoutDueDate;
      this.projects = res.projects;
      if (this.focusIndex >= this.tasks.length) this.focusIndex = Math.max(0, this.tasks.length - 1);
      localStorage.setItem('lastTaskCount', String(this.tasks.length));
    } catch (err) {
      this.reportError(err, 'Could not load tasks from Asana');
    }
  }

  private streamTasks(): Promise<{ tasks: Task[]; tasksWithoutDueDate: Task[]; projects: Project[] }> {
    return new Promise((resolve, reject) => {
      const es = new EventSource('/api/tasks/stream');
      es.addEventListener('progress', (e) => {
        try {
          this.loadingTasksCount = JSON.parse((e as MessageEvent).data).count;
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
          resolve(JSON.parse((e as MessageEvent).data));
        } catch (err) {
          reject(err);
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

  async refreshTasks() {
    if (!this.asanaConnected) return;
    try {
      const res = await api.get<{ tasks: Task[]; tasksWithoutDueDate: Task[]; projects: Project[] }>('/api/tasks');
      this.tasks = res.tasks;
      this.tasksWithoutDueDate = res.tasksWithoutDueDate;
      this.projects = res.projects;
      if (this.focusIndex >= this.tasks.length) this.focusIndex = Math.max(0, this.tasks.length - 1);
    } catch (err) {
      this.reportError(err, 'Could not load tasks from Asana');
    }
  }

  async refreshWorkload() {
    try {
      const res = await api.get<{ days: WorkloadDay[] }>('/api/workload');
      this.workloadDays = res.days;
    } catch (err) {
      this.reportError(err, 'Could not load workload');
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
    if (dx > threshold) this.openPlanToday();
    else if (dx < -threshold) this.openPlanLater();
  }

  // --- queue nav ---
  goPrev() {
    if (this.tasks.length <= 1) return;
    this.focusIndex = (this.focusIndex - 1 + this.tasks.length) % this.tasks.length;
  }
  goNext() {
    if (this.tasks.length <= 1) return;
    this.focusIndex = (this.focusIndex + 1) % this.tasks.length;
  }
  selectFocus(id: string) {
    this.focusIndex = Math.max(0, this.tasks.findIndex((t) => t.id === id));
  }

  // --- settings ---
  openSettings() {
    this.screen = 'settings';
  }
  closeSettings() {
    this.screen = 'triage';
  }
  openIntegrations() {
    this.screen = 'integrations';
  }
  closeIntegrations() {
    this.screen = 'settings';
  }

  private async patchSettings(patch: Partial<{ prefStartTime: string; prefEndTime: string; bufferMinutes: number; timezone: string }>) {
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

  /// "Reset today's plan" in Settings — un-schedules every task due today
  /// that has a specific due *time* (tasks due today with only a date and
  /// no time have nothing to reset). Confirmed by the caller before this
  /// runs, since it's a bulk, hard-to-undo-by-hand action.
  async resetToday() {
    const gids = this.tasksDueToday.filter((t) => t.dueAt).map((t) => t.id);
    if (gids.length === 0) {
      this.showToast('No tasks scheduled today');
      return;
    }
    try {
      const res = await api.post<{ cleared: number; failed: number }>('/api/tasks/reset-day', { taskGids: gids });
      await Promise.all([this.refreshTasks(), this.refreshWorkload()]);
      this.showToast(res.failed > 0 ? `Cleared ${res.cleared}, ${res.failed} failed` : `Cleared ${res.cleared} task${res.cleared === 1 ? '' : 's'}`);
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
  isDayFull(key: string): boolean {
    const d = this.workloadDays.find((w) => w.key === key);
    return d ? d.planned / d.capacity >= 1 : false;
  }

  private dateFor(key: string): string | null {
    if (key === 'custom') return this.customDateValue || null;
    return this.workloadDays.find((d) => d.key === key)?.date ?? null;
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
    const idx = this.tasks.findIndex((t) => t.id === matches[0].id);
    if (idx >= 0) this.focusIndex = idx;
    this.closeOverview();
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

  private async commitDueAt(taskId: string, dueAtIso: string | null, force = false): Promise<boolean> {
    try {
      await api.patch(`/api/tasks/${encodeURIComponent(taskId)}`, { dueAt: dueAtIso, force });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.body?.error === 'slot_conflict') {
        this.conflictItems = err.body.conflicts;
        return false;
      }
      this.reportError(err, 'Could not update the task in Asana');
      return false;
    }
  }

  async tryPlanTodaySlot(slot: string) {
    const task = this.focusTaskRaw;
    const date = this.dateFor('today');
    if (!task || !date) return;
    const dueAtIso = this.toIsoDateTime(date, this.slotStart(slot));
    const ok = await this.commitDueAt(task.id, dueAtIso);
    if (!ok) {
      this.pendingSlotPlan = { kind: 'today', slot };
      this.screen = 'slotConflict';
      return;
    }
    await this.afterCommit(`Planned "${task.name}" today at ${slot} · synced to Asana`);
  }

  toggleCustomTimeToday() {
    this.showCustomTimeToday = !this.showCustomTimeToday;
  }
  onCustomTimeTodayChange(v: string) {
    this.customTimeToday = v;
  }
  async confirmCustomTimeToday() {
    if (!this.customTimeToday) return;
    await this.tryPlanTodaySlot(this.customTimeToday);
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

  async tryPlanLaterSlot(slot: string) {
    const task = this.focusTaskRaw;
    const dayKey = this.laterDayKey;
    const date = dayKey ? this.dateFor(dayKey) : null;
    if (!task || !dayKey || !date) return;
    const dueAtIso = this.toIsoDateTime(date, this.slotStart(slot));
    const ok = await this.commitDueAt(task.id, dueAtIso);
    if (!ok) {
      this.pendingSlotPlan = { kind: 'later', dayKey, slot };
      this.screen = 'slotConflict';
      return;
    }
    await this.afterCommit(`Planned "${task.name}" for ${this.chosenDayLabel} at ${slot} · due date synced to Asana`, dayKey);
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
      const ok = await this.commitDueAt(task.id, dueAtIso, true);
      if (ok) {
        const label = p.kind === 'today' ? 'today' : this.chosenDayLabel;
        await this.afterCommit(`Planned "${task.name}" for ${label} at ${p.slot} · synced to Asana (double-booked)`, dayKey);
      }
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

  /// `dayKey` is whichever WorkloadDay bucket the just-committed task landed
  /// in — 'today' for the common case, but tryPlanLaterSlot/resolveConflict
  /// pass the actual target so planning into tomorrow (etc.) can trigger the
  /// celebration too, not just today.
  private async afterCommit(toastMsg: string, dayKey: string = 'today') {
    this.showToast(toastMsg);
    await Promise.all([this.refreshTasks(), this.refreshWorkload()]);
    this.focusIndex = 0;
    this.screen = 'triage';
    const day = this.workloadDays.find((d) => d.key === dayKey);
    if (day && day.capacity > 0 && day.planned >= day.capacity) this.celebrationKey++;
  }

  async removeDueDate() {
    const task = this.focusTaskRaw;
    if (!task) return;
    const ok = await this.commitDueAt(task.id, null);
    if (ok) await this.afterCommit(`Removed due date on "${task.name}" · synced to Asana`);
  }

  async selectLaterDay(key: string) {
    if (this.isDayFull(key)) {
      this.pendingPlan = { type: 'later', key };
      this.screen = 'dayFull';
      return;
    }
    await this.loadLaterSlots(key);
    this.laterDayKey = key;
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
    this.screen = 'freeSlotsLater';
  }

  // --- estimate editing (focus card) ---
  onEditHours() {
    const t = this.focusTaskRaw;
    if (!t) return;
    this.editingHours = true;
    this.hoursDraft = t.hours;
  }
  decHour() {
    this.hoursDraft = Math.max(0.5, this.hoursDraft - 0.5);
  }
  incHour() {
    this.hoursDraft = Math.min(40, this.hoursDraft + 0.5);
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
    this.restHoursDraft = Math.max(0.5, this.restHoursDraft - 0.5);
  }
  incRestHour() {
    this.restHoursDraft = Math.min(40, this.restHoursDraft + 0.5);
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
    this.breakDuration = Math.max(0.5, this.breakDuration - 0.5);
  }
  incDuration() {
    this.breakDuration = Math.min(8, this.breakDuration + 0.5);
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
    const ok = await this.commitDueAt(created.gid, dueAtIso, force);
    if (!ok) {
      this.pendingSlotPlan = { kind: 'break', slot };
      this.screen = 'slotConflict';
      return;
    }

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
    this.focusIndex = Math.max(0, this.tasks.findIndex((t) => t.id === parent.id));
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
