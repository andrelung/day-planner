<script lang="ts">
  import { flip } from 'svelte/animate';
  import { planner } from '../store.svelte';
  import { fmtElapsed, fmtHours } from '../format';
  import Icon from '../components/Icon.svelte';
  import IconButton from '../components/IconButton.svelte';
  import Stepper from '../components/Stepper.svelte';
  import Button from '../components/Button.svelte';
  import Badge from '../components/Badge.svelte';
  import InstallBanner from '../components/InstallBanner.svelte';
  import Input from '../components/Input.svelte';

  // The active day's unlinked calendar events gate that day's tasks below —
  // a meeting's time is already fixed on the calendar, unlike a task that
  // still needs a slot picked for it, so these get triaged (linked to a
  // task, added as a new task, or ignored) before any task on the same day
  // is shown. Follows the active day (not just today), so jumping to
  // another day via Overview or the date-nav arrows surfaces that day's
  // events too. Meaningless while reviewing the backlog (those tasks have
  // no due date at all), so suppressed there.
  const pendingEvents = $derived(planner.reviewingBacklog ? [] : planner.activeDayUnlinkedEvents);
  // Set by Overview's "reopen its card" click (openEventInTriage) — shows
  // even if already linked, taking priority over the day's normal pending
  // (unlinked-only) gate, so revisiting a linked entry offers a way to
  // change what it's linked to instead of showing whatever else that day
  // holds.
  const pinnedEvent = $derived(
    !planner.reviewingBacklog && planner.pinnedEventId ? (planner.events.find((e) => e.id === planner.pinnedEventId) ?? null) : null,
  );
  const currentEvent = $derived(pinnedEvent ?? pendingEvents[0] ?? null);
  const activeDayLabel = $derived(planner.dayLabelFor(planner.activeDate));
  const eventPanelOpen = $derived(currentEvent ? planner.activePanelEventId === currentEvent.id : false);
  const eventPanelMode = $derived(eventPanelOpen ? planner.activePanelMode : null);

  const focusRaw = $derived(planner.focusTaskRaw);
  const hasFocusTask = $derived(planner.hasFocusTask);
  const focusDueLabel = $derived.by(() => {
    if (!focusRaw?.dueOn) return null;
    const day = planner.dayLabelFor(focusRaw.dueOn);
    return focusRaw.dueHour ? `${day} at ${focusRaw.dueHour}` : day;
  });
  const focusCreatedLabel = $derived.by(() => {
    const iso = planner.taskDetails?.createdAt;
    if (!iso) return null;
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  });
  const focusDescriptionPreview = $derived.by(() => {
    const text = planner.taskDetails?.description;
    if (!text) return null;
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) return null;
    return lines.slice(0, 5);
  });
  const focusCollaboratorsLabel = $derived.by(() => {
    const names = planner.taskDetails?.collaborators.map((c) => c.name);
    return names && names.length > 0 ? names.join(', ') : null;
  });
  // focusIndex can point at a task from a different date than the one
  // currently on screen (e.g. the active date was just changed by the
  // date-nav arrows to a day with no task at all) — only treat it as
  // "the" task for this screen when its due date actually matches.
  // Backlog tasks have no due date to match, so they're always shown.
  const taskMatchesActiveDate = $derived(planner.reviewingBacklog || (!!focusRaw && focusRaw.dueOn === planner.activeDate));
  // The queue is an ordered list with focusIndex as the current pointer —
  // "Up next" is everything still ahead of it, not "everything but the
  // focused task" (that included already-passed tasks above the focus,
  // which made clicking one further down look like a swap instead of a
  // jump-to). Tapping a row earlier deliberately skips whatever was before
  // it (see selectFocus).
  const restTasks = $derived(hasFocusTask ? planner.queueTasks.slice(planner.focusIndex + 1) : []);

  // Up next is chronological, so a day boundary only ever needs one header
  // when the label actually changes from the row before it — not a full
  // group-by, just a "does this differ from the last one" scan.
  type UpNextItem = { kind: 'header'; label: string } | { kind: 'task'; task: (typeof restTasks)[number] };
  const restItems = $derived.by(() => {
    const items: UpNextItem[] = [];
    let lastLabel: string | null = null;
    for (const t of restTasks) {
      const label = planner.dayLabelFor(t.dueOn);
      if (label !== lastLabel) {
        items.push({ kind: 'header', label });
        lastLabel = label;
      }
      items.push({ kind: 'task', task: t });
    }
    return items;
  });

  // --- pull to refresh, on the Up Next list ---
  // Only engages when the list is already scrolled to its very top (so it
  // never fights normal scrolling once you're mid-list) — dragging down
  // from there re-syncs tasks/workload from Asana, the same thing the
  // periodic background refresh and resume-from-background already do,
  // just on demand.
  const PULL_THRESHOLD = 100;
  const PULL_MAX = 160;
  let pullY = $state(0);
  let pulling = $state(false);
  let refreshing = $state(false);
  let pullStartY = 0;

  function onPullPointerDown(e: PointerEvent, el: HTMLElement) {
    pulling = el.scrollTop === 0;
    pullStartY = e.clientY;
  }
  function onPullPointerMove(e: PointerEvent) {
    if (!pulling) return;
    pullY = Math.max(0, Math.min(PULL_MAX, e.clientY - pullStartY));
  }
  async function onPullPointerUp() {
    if (!pulling) return;
    pulling = false;
    if (pullY > PULL_THRESHOLD && !refreshing) {
      refreshing = true;
      pullY = 50;
      planner.showToast('Refreshing…');
      await Promise.all([planner.refreshTasks(), planner.refreshWorkload()]);
      refreshing = false;
      planner.showToast('Up to date');
    }
    pullY = 0;
  }
  function onPullPointerCancel() {
    pulling = false;
    pullY = 0;
  }
  /// iOS directionally-locks into its own native pan/scroll after just a
  /// few px of movement and cancels the pointer sequence handed to
  /// onPullPointerCancel above, unless told otherwise — touch-action/
  /// overscroll-behavior CSS alone don't stop that, and pointermove's own
  /// preventDefault() isn't reliably honored by Safari for this purpose.
  /// A non-passive touchmove listener calling preventDefault() *is* the
  /// mechanism Safari respects for "no, I'm handling this gesture myself"
  /// — this fires alongside the pointer handlers above (same underlying
  /// touch), so pullY/pulling logic stays exactly as it was; this only
  /// stops iOS from taking the gesture away mid-pull.
  ///
  /// Gated on the finger actually moving *downward* (dy > 0), not just on
  /// `pulling` — `pulling` only means "this touch started at scrollTop 0",
  /// true for both a downward pull *and* an upward swipe-to-scroll-down
  /// starting from the very top of the list. Gating on `pulling` alone
  /// (an earlier version of this fix) blocked that upward swipe's default
  /// action too, since preventDefault() doesn't care which way the finger
  /// actually went — which broke scrolling down through the list entirely
  /// whenever it started scrolled to the top.
  ///
  /// Attached by hand with an explicit {passive:false} rather than via a
  /// plain ontouchmove attribute — Svelte/the browser can default touch
  /// listeners to passive for scroll-perf reasons, which would make
  /// preventDefault() here a silent no-op, exactly undoing this fix
  /// without any error to show for it. Confirmed fixed against a real
  /// device — a plain pointermove-only version reliably got canceled by
  /// iOS around 10-30px of movement, aggressive drag or not.
  let wrapEl: HTMLElement | undefined = $state();
  $effect(() => {
    if (!wrapEl) return;
    const handler = (e: TouchEvent) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - pullStartY;
      if (dy > 0) e.preventDefault();
    };
    wrapEl.addEventListener('touchmove', handler, { passive: false });
    return () => wrapEl?.removeEventListener('touchmove', handler);
  });

  // Ticks once a minute so "Overdue since Xh" stays roughly accurate without
  // needing some other reactive dependency to happen to re-render this card.
  let now: Date = $state(new Date());
  $effect(() => {
    const id = setInterval(() => {
      now = new Date();
    }, 60_000);
    return () => clearInterval(id);
  });

  // Only fetches while the expanded details are actually visible — no
  // reason to spend the request otherwise. Re-runs whenever the focus
  // task's id changes (loadTaskDetails itself no-ops on a repeat id), so
  // stepping through the queue with Up Next collapsed keeps the detail
  // section in sync with whichever task is actually focused now.
  $effect(() => {
    if (planner.upNextCollapsed && focusRaw) void planner.loadTaskDetails(focusRaw.id);
  });

  // dueAt (a real instant), not dueHour — dueHour is null for a genuinely
  // date-only task (no due_at at all), which is exactly the case the
  // end-of-day fallback below exists for. A task with no time at all is
  // treated as due at the end of that day — it isn't overdue while today
  // is still today, only once today has actually ended.
  const focusEffectiveDueAt = $derived.by(() => {
    if (!focusRaw) return null;
    if (focusRaw.dueAt) return new Date(focusRaw.dueAt);
    if (!focusRaw.dueOn) return null;
    const endOfDay = new Date(`${focusRaw.dueOn}T00:00:00`);
    endOfDay.setDate(endOfDay.getDate() + 1);
    return endOfDay;
  });
  const focusOverdueMs = $derived(focusEffectiveDueAt ? now.getTime() - focusEffectiveDueAt.getTime() : 0);
  const focusIsOverdue = $derived(focusOverdueMs > 0);

  const badgeTone = $derived(focusIsOverdue ? 'wrong' : 'neutral');
  const badgeLabel = $derived(
    focusIsOverdue ? `Overdue since ${fmtElapsed(focusOverdueMs)}` : focusRaw?.dueHour ? `Due · ${focusRaw.dueHour}` : 'Unplanned',
  );

  const cardTransform = $derived(`translateX(${planner.dragX}px) rotate(${planner.dragX / 20}deg)`);
  const cardTransition = $derived(planner.dragging ? 'none' : 'transform 220ms cubic-bezier(0.4,0,0.2,1)');
  // Left = plan today, right = plan later (matches onCardPointerUp).
  const planTodayRevealOpacity = $derived(Math.max(0, Math.min(1, -planner.dragX / 90)));
  const planLaterRevealOpacity = $derived(Math.max(0, Math.min(1, planner.dragX / 90)));

  // Date-nav arrows clamp at the ends rather than disabling (see
  // stepActiveDate), so there's nothing to disable outside backlog review,
  // where the arrows cycle a plain task list instead.
  const navDisabled = $derived(planner.reviewingBacklog && planner.queueTasks.length <= 1);
  const showCapacityBadge = $derived(hasFocusTask || !!currentEvent);
</script>

<div class="screen">
  <div class="header">
    <IconButton icon="settings" title="Settings" onclick={() => planner.openSettings()} />
    <div class="title">Plan your day</div>
    <div class="header-actions">
      <IconButton icon="calendar" title="Calendar view" onclick={() => planner.openCalendarView()} />
      <IconButton icon="menu" title="Overview" onclick={() => planner.openOverview()} />
    </div>
  </div>

  <InstallBanner />

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="up-next-wrap"
    bind:this={wrapEl}
    onpointerdown={(e) => onPullPointerDown(e, e.currentTarget as HTMLElement)}
    onpointermove={onPullPointerMove}
    onpointerup={onPullPointerUp}
    onpointercancel={onPullPointerCancel}
  >
    <div class="pull-indicator" style="opacity:{refreshing ? 1 : Math.min(1, pullY / 24)};">
      <div class="pull-indicator__pill">
        {#if refreshing}
          <div class="pull-indicator__spinner"></div>
          <span>Refreshing…</span>
        {:else}
          <div class="pull-indicator__arrow" style="transform:rotate({90 + Math.min(1, pullY / PULL_THRESHOLD) * 180}deg);">
            <Icon name="arrow-right" size={14} color="var(--color-brand-primary)" />
          </div>
          <span>{pullY > PULL_THRESHOLD ? 'Release to refresh' : 'Pull to refresh'}</span>
        {/if}
      </div>
    </div>
    <div class="up-next-inner" style="transform:translateY({pullY}px); transition:{pulling ? 'none' : 'transform 200ms ease-out'};">
      {#if restTasks.length > 0}
        <button class="section-label section-label--toggle" onclick={() => planner.toggleUpNextCollapsed()}>
          <span>Up next{planner.upNextCollapsed ? ` (${restTasks.length})` : ''}</span>
          <span class="section-label__chevron" style="transform:rotate({planner.upNextCollapsed ? 0 : 90}deg);">
            <Icon name="chevron-right" size={14} color="var(--color-text-muted)" />
          </span>
        </button>
      {/if}
      {#if restTasks.length > 0 && !planner.upNextCollapsed}
        {#each restItems as item (item.kind === 'header' ? `day:${item.label}` : item.task.id)}
        <div animate:flip={{ duration: 220 }}>
          {#if item.kind === 'header'}
            <div class="day-divider">{item.label}</div>
          {:else}
            {@const t = item.task}
            <div class="up-next-row">
              <div
                class="up-next-row__main"
                role="button"
                tabindex="0"
                onclick={() => planner.selectFocus(t.id)}
                onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && planner.selectFocus(t.id)}
              >
                <div class="up-next-row__text">
                  <div class="up-next-row__name">{t.name}</div>
                  <div class="up-next-row__project">{t.project}</div>
                </div>
                <div class="time-dot" style="--pct:{Math.min(100, (t.hours / 8) * 100)}%;" title="{fmtHours(t.hours)}"></div>
                {#if planner.editingRestId !== t.id}
                  <button
                    class="hour-edit"
                    onclick={(e) => {
                      e.stopPropagation();
                      planner.onEditRestHours(t.id, t.hours);
                    }}
                  >
                    <div class="hour-edit__label">{fmtHours(t.hours)}</div>
                    <Icon name="pencil" size={11} color="var(--color-text-muted)" />
                  </button>
                {/if}
              </div>
              {#if planner.editingRestId === t.id}
                <div class="inline-editor">
                  <Stepper
                    valueText={String(planner.restHoursDraft)}
                    ondec={() => planner.decRestHour()}
                    oninc={() => planner.incRestHour()}
                    oninput={(v) => planner.onRestHoursInput(v)}
                  />
                  <Button variant="primary" size="sm" onclick={() => planner.confirmRestHours(t.id)}>Save</Button>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
      {/if}
    </div>
  </div>

  <div class="queue-row">
    <div class="queue-label">
      {#if currentEvent}
        {activeDayLabel}'s calendar{pendingEvents.length > 1 ? ` · ${pendingEvents.length} to triage` : ''}
      {:else}
        {planner.queueLabel}
      {/if}
    </div>
    <div class="queue-nav" style="opacity:{navDisabled ? 0.4 : 1}; pointer-events:{navDisabled ? 'none' : 'auto'};">
      <IconButton icon="chevron-left" title="Previous date" size={32} iconSize={16} onclick={() => planner.goPrev()} />
      <IconButton icon="chevron-right" title="Next date" size={32} iconSize={16} onclick={() => planner.goNext()} />
    </div>
  </div>

  {#if currentEvent}
    <div class="focus-wrap">
      <div class="focus-card">
        <div class="focus-card__top">
          <Badge tone="neutral">Calendar event</Badge>
        </div>

        <div class="focus-card__name">{currentEvent.title}</div>
        <div class="focus-card__project">
          {currentEvent.linked ? `${currentEvent.timeLabel} · linked to "${currentEvent.linkedName}"` : `${currentEvent.timeLabel} · time already set`}
        </div>

        {#if eventPanelOpen}
          <div class="search-panel">
            <div class="search-panel__top">
              <div class="search-panel__title">{eventPanelMode === 'add' ? 'Add to project or subtask' : 'Link to a task or project'}</div>
              <button class="search-panel__cancel" onclick={() => planner.closeSearchPanel()}>Cancel</button>
            </div>
            <Input placeholder="Search projects or tasks…" value={planner.searchQuery} onchange={(v) => planner.onSearchChange(v)} />
            {#if planner.typeaheadLoading}
              <div class="search-loading">
                <div class="search-loading__spinner"></div>
                <span>Searching…</span>
              </div>
            {:else}
              <div class="search-results">
                {#each planner.searchResultsFor(currentEvent.id, eventPanelMode) as r}
                  {@const m = planner.matchSplit(r.label)}
                  <button class="search-result" onclick={r.onSelect}>
                    <div class="search-result__label">
                      {#if m}{m.pre}<mark>{m.match}</mark>{m.post}{:else}{r.label}{/if}
                    </div>
                    <div class="search-result__type">{r.typeLabel}</div>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <div class="focus-card__actions">
            <Button variant="primary" size="md" fullWidth onclick={() => planner.openAddPanel(currentEvent.id)}>Add as new subtask</Button>
            <Button variant="secondary" size="md" fullWidth onclick={() => planner.openLinkPanel(currentEvent.id)}>
              {currentEvent.linked ? 'Change linked task' : 'Link existing task'}
            </Button>
          </div>
          <div class="focus-card__actions focus-card__actions--ghost">
            <Button variant="ghost" size="sm" fullWidth onclick={() => planner.ignoreEvent(currentEvent.id)}>
              {currentEvent.linked ? 'Unlink and ignore this event' : 'Ignore this event'}
            </Button>
          </div>
        {/if}
      </div>
    </div>
  {:else if hasFocusTask && focusRaw && taskMatchesActiveDate}
    <div class="focus-wrap" class:focus-wrap--lifted={planner.upNextCollapsed}>
      <div class="reveal reveal--later" style="opacity:{planLaterRevealOpacity};">
        <div class="reveal__label">Plan later</div>
      </div>
      <div class="reveal reveal--today" style="opacity:{planTodayRevealOpacity};">
        <div class="reveal__label">{planner.planTodayButtonLabel}</div>
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="focus-card-drag"
        style="transform:{cardTransform}; transition:{cardTransition};"
        onpointerdown={(e) => planner.onCardPointerDown(e)}
        onpointermove={(e) => planner.onCardPointerMove(e)}
        onpointerup={() => planner.onCardPointerUp()}
        onpointercancel={() => planner.onCardPointerUp()}
      >
        <div class="focus-card">
          <div class="focus-card__top">
            <Badge tone={badgeTone}>{badgeLabel}</Badge>
            <IconButton
              icon="external-link"
              title="Open in Asana"
              size={32}
              iconSize={16}
              color="var(--color-text-muted)"
              href={focusRaw.permalinkUrl}
            />
          </div>

          <div class="focus-card__name">{focusRaw.name}</div>

          {#if planner.editingHours}
            <div class="inline-editor inline-editor--card">
              <Stepper
                valueText={String(planner.hoursDraft)}
                ondec={() => planner.decHour()}
                oninc={() => planner.incHour()}
                oninput={(v) => planner.onHoursDraftInput(v)}
              />
              <Button variant="primary" size="sm" onclick={() => planner.confirmHours()}>Save</Button>
            </div>
          {:else}
            <button class="estimate-row" onclick={() => planner.onEditHours()}>
              <div class="estimate-row__label">Time estimate</div>
              <div class="estimate-row__value">{fmtHours(focusRaw.hours)}</div>
              <Icon name="pencil" size={13} color="var(--color-text-muted)" />
            </button>
          {/if}

          <div class="focus-card__project" class:focus-card__project--full={planner.upNextCollapsed}>{focusRaw.project}</div>

          {#if planner.upNextCollapsed}
            <div class="focus-details">
              {#if focusDueLabel}
                <div class="focus-details__row">
                  <span class="focus-details__label">Due</span>
                  <span class="focus-details__value">{focusDueLabel}</span>
                </div>
              {/if}
              {#if planner.taskDetailsLoading}
                <div class="focus-details__loading">Loading more details…</div>
              {:else}
                {#if focusCreatedLabel}
                  <div class="focus-details__row">
                    <span class="focus-details__label">Created</span>
                    <span class="focus-details__value">{focusCreatedLabel}</span>
                  </div>
                {/if}
                {#if focusCollaboratorsLabel}
                  <div class="focus-details__row">
                    <span class="focus-details__label">Collaborators</span>
                    <span class="focus-details__value">{focusCollaboratorsLabel}</span>
                  </div>
                {/if}
                {#if focusDescriptionPreview}
                  <div class="focus-details__description">
                    {#each focusDescriptionPreview as line}
                      <div class="focus-details__description-line">{line}</div>
                    {/each}
                  </div>
                {/if}
              {/if}
              {#if planner.taskRefileId === focusRaw.id}
                <div class="search-panel">
                  <div class="search-panel__top">
                    <div class="search-panel__title">Move to project or subtask</div>
                    <button class="search-panel__cancel" onclick={() => planner.closeSearchPanel()}>Cancel</button>
                  </div>
                  <Input placeholder="Search projects or tasks…" value={planner.searchQuery} onchange={(v) => planner.onSearchChange(v)} />
                  {#if planner.typeaheadLoading}
                    <div class="search-loading">
                      <div class="search-loading__spinner"></div>
                      <span>Searching…</span>
                    </div>
                  {:else}
                    <div class="search-results">
                      {#each planner.searchResultsForRefile() as r}
                        {@const m = planner.matchSplit(r.label)}
                        <button class="search-result" onclick={r.onSelect}>
                          <div class="search-result__label">
                            {#if m}{m.pre}<mark>{m.match}</mark>{m.post}{:else}{r.label}{/if}
                          </div>
                          <div class="search-result__type">{r.typeLabel}</div>
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {:else}
                <button class="focus-details__refile" onclick={() => planner.openTaskRefilePanel()}>
                  <Icon name="pencil" size={13} color="var(--color-text-muted)" />
                  <span>Move to a different project or subtask</span>
                </button>
              {/if}
            </div>
          {/if}

          <div class="focus-card__actions">
            <Button variant="primary" size="md" fullWidth onclick={() => planner.openPlanTodayOrDate()}>{planner.planTodayButtonLabel}</Button>
            <Button variant="secondary" size="md" fullWidth onclick={() => planner.openPlanLater()}>Plan later</Button>
          </div>
          <div class="focus-card__actions focus-card__actions--ghost">
            <Button variant="ghost" size="sm" fullWidth onclick={() => planner.startBreak()}>Split</Button>
            <Button variant="ghost" size="sm" fullWidth onclick={() => planner.skipTask()}>Skip</Button>
            <Button variant="ghost" size="sm" fullWidth onclick={() => planner.onBacklogButtonClick()}>Backlog</Button>
          </div>
        </div>
      </div>
    </div>
  {:else if hasFocusTask}
    <div class="empty-state">
      <Icon name="check-circle" size={32} color="var(--color-feedback-correct)" />
      <div class="empty-state__title">Nothing due {activeDayLabel}</div>
      <div class="empty-state__sub">Browse other days with the arrows above.</div>
    </div>
  {:else}
    <div class="empty-state">
      <Icon name="check-circle" size={32} color="var(--color-feedback-correct)" />
      <div class="empty-state__title">All caught up</div>
      <div class="empty-state__sub">Nothing left to plan right now.</div>
    </div>
  {/if}

  {#if showCapacityBadge}
    <button class="capacity-badge" style="background:{planner.todayBadgeBg};" onclick={() => planner.openOverview()}>
      {#if planner.workloadLoading}
        <div class="capacity-badge__spinner"></div>
      {:else}
        {planner.todayBadgeLabel}
      {/if}
    </button>
  {/if}
</div>

<style>
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--color-bg-page);
    overflow: hidden;
    position: relative;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px 4px;
    flex-shrink: 0;
  }
  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .title {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 16px;
    color: var(--color-text-primary);
  }
  .up-next-wrap {
    position: relative;
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    touch-action: pan-y;
    /* Without this, iOS Safari's own native rubber-band bounce takes over
       the instant you drag past scrollTop 0 — it both visually fights the
       custom translateY() pull animation and can swallow the touchmove
       events our pointermove handler needs, which is why the indicator
       never appeared on a real device despite working in every synthetic
       (desktop, dispatched-PointerEvent) test. This keeps the overscroll
       gesture contained to our own handler instead of also chaining to the
       browser's native bounce/scroll-parent behavior. */
    overscroll-behavior-y: contain;
  }
  .up-next-inner {
    padding: 16px 20px 8px;
  }
  .pull-indicator {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .pull-indicator__pill {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    box-shadow: var(--shadow-overlay-sm);
    font-family: var(--font-family-base);
    font-size: 12px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-primary);
  }
  .pull-indicator__arrow {
    display: flex;
    transition: transform 80ms linear;
  }
  .pull-indicator__spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--color-border);
    border-top-color: var(--color-brand-primary);
    border-radius: 50%;
    animation: pull-indicator-spin 0.7s linear infinite;
  }
  @keyframes pull-indicator-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .section-label {
    font-family: var(--font-family-base);
    font-size: 11px;
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
    margin-bottom: 8px;
  }
  .section-label--toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .section-label__chevron {
    display: inline-flex;
    transition: transform 150ms ease-out;
  }
  .day-divider {
    font-family: var(--font-family-base);
    font-size: 11px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-muted);
    padding-top: 6px;
    margin-top: 4px;
    border-top: 1px solid var(--color-border);
  }
  .day-divider:first-child {
    padding-top: 0;
    margin-top: 0;
    border-top: none;
  }
  /* Each item (header or task) gets its own animate:flip wrapper div, so
     the divider's actual next sibling is that wrapper, not .up-next-row
     itself — :has() reaches through it. Cuts the gap between a day header
     and its first row so together they read as one compact unit instead
     of two separately-spaced rows. */
  div:has(> .day-divider) + div > .up-next-row {
    padding-top: 6px;
  }
  .up-next-row {
    padding: 12px 4px;
    border-bottom: 1px solid var(--color-border);
  }
  .up-next-row__main {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    width: 100%;
  }
  /* A pie-fill circle showing how much of an 8h day this task's estimate
     takes — full at 8h, half at 4h, and so on (capped at 100% past 8h).
     Replaced a plain overdue/not-overdue dot that wasn't pulling its
     weight once the badge above already covers overdue status. */
  .time-dot {
    width: 16px;
    height: 16px;
    border-radius: 999px;
    flex-shrink: 0;
    background: conic-gradient(var(--color-brand-primary) var(--pct), var(--color-border) 0);
  }
  .up-next-row__text {
    flex: 1;
    min-width: 0;
  }
  .up-next-row__name {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 13px;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .up-next-row__project {
    font-family: var(--font-family-base);
    font-size: 11px;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hour-edit {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }
  .hour-edit__label {
    font-family: var(--font-family-base);
    font-size: 11px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-muted);
  }
  .inline-editor {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    padding: 8px 10px;
    background: var(--color-bg-page);
    border-radius: var(--radius-md);
  }
  .inline-editor--card {
    margin-top: 14px;
    padding: 10px 12px;
  }
  .queue-row {
    padding: 8px 20px 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .queue-label {
    font-family: var(--font-family-base);
    font-size: 13px;
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .queue-nav {
    display: flex;
    gap: 2px;
  }
  .focus-wrap {
    padding: 10px 20px 16px;
    position: relative;
    flex-shrink: 0;
  }
  /* Up Next collapsed leaves .up-next-wrap's flex:1 space almost entirely
     empty above the card (just the toggle row) — without this the card
     stays anchored to the bottom edge same as always, so all that freed-up
     room reads as dead space above it instead of the card actually moving
     to use it. Pushing the card up with its own bottom margin (rather than
     centering it some other way) keeps it anchored to the actions below it,
     which is what your thumb actually reaches for. */
  .focus-wrap--lifted {
    margin-bottom: 15vh;
    margin-bottom: 15dvh;
  }
  .reveal {
    position: absolute;
    inset: 0;
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    padding: 0 24px;
  }
  .reveal--later {
    background: var(--color-brand-primary);
  }
  .reveal--today {
    background: var(--grips-highlight-yellow);
    justify-content: flex-end;
  }
  .reveal__label {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-extrabold);
    font-size: 18px;
  }
  .reveal--later .reveal__label {
    color: var(--color-text-inverse);
  }
  .reveal--today .reveal__label {
    color: var(--grips-dark-blue);
  }
  .focus-card-drag {
    position: relative;
    touch-action: pan-y;
  }
  .focus-card {
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    font-family: var(--font-family-base);
  }
  .focus-card__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .focus-card__name {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 18px;
    line-height: 1.2;
    color: var(--color-text-primary);
    margin-top: 2px;
  }
  .focus-card__project {
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* With Up Next collapsed there's room to spare, and the whole point of
     collapsing it was to see more about this one task — truncating its
     breadcrumb down to a few characters would work against that. */
  .focus-card__project--full {
    white-space: normal;
    overflow: visible;
    text-overflow: unset;
  }
  .focus-details {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: var(--color-bg-page);
    border-radius: var(--radius-md);
  }
  .focus-details__row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-family: var(--font-family-base);
    font-size: 13px;
  }
  .focus-details__label {
    flex-shrink: 0;
    width: 84px;
    color: var(--color-text-muted);
  }
  .focus-details__value {
    color: var(--color-text-primary);
    font-weight: var(--font-weight-bold);
  }
  .focus-details__loading {
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--color-text-muted);
  }
  .focus-details__description {
    padding-top: 4px;
    border-top: 1px solid var(--color-border);
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--color-text-primary);
  }
  .focus-details__description-line {
    line-height: 1.4;
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }
  .focus-details__refile {
    display: flex;
    align-items: center;
    gap: 6px;
    align-self: flex-start;
    margin-top: 2px;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-family: var(--font-family-base);
    font-size: 13px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-muted);
  }
  /* Right-aligned within the card's own column layout — mirrors Asana's
     convention of putting a task's duration at the end of its name/
     breadcrumb line, and puts the estimate within easy thumb reach instead
     of needing a second tap target further down. */
  .estimate-row {
    align-self: flex-end;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    color: var(--color-text-muted);
    background: none;
    border: none;
    padding: 0;
    width: fit-content;
  }
  .estimate-row__label {
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--color-text-muted);
  }
  .estimate-row__value {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 15px;
    color: var(--color-text-primary);
  }
  .search-panel {
    background: var(--color-bg-page);
    border-radius: var(--radius-md);
    padding: 10px;
  }
  .search-panel__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .search-panel__title {
    font-family: var(--font-family-base);
    font-size: 11px;
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }
  .search-panel__cancel {
    font-family: var(--font-family-base);
    font-size: 11px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-muted);
    cursor: pointer;
    background: none;
    border: none;
    padding: 0;
  }
  .search-results {
    max-height: 160px;
    overflow-y: auto;
    margin-top: 8px;
  }
  .search-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px 0;
    font-family: var(--font-family-base);
    font-size: 12px;
    color: var(--color-text-muted);
  }
  .search-loading__spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--color-border);
    border-top-color: var(--color-brand-primary);
    border-radius: 50%;
    animation: search-loading-spin 0.7s linear infinite;
  }
  @keyframes search-loading-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .search-result {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 6px;
    cursor: pointer;
    border-radius: var(--radius-sm);
    width: 100%;
    background: none;
    border: none;
    text-align: left;
  }
  .search-result:hover {
    background: var(--color-bg-surface);
  }
  .search-result__label {
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .search-result__type {
    font-family: var(--font-family-base);
    font-size: 11px;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }
  .search-result__label mark {
    background: none;
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-bold);
  }
  .focus-card__actions {
    display: flex;
    gap: 8px;
  }
  .focus-card__actions--ghost {
    margin-top: -2px;
  }
  .empty-state {
    padding: 20px 20px 24px;
    text-align: center;
    flex-shrink: 0;
  }
  .empty-state__title {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 18px;
    color: var(--color-text-primary);
    margin-top: 10px;
  }
  .empty-state__sub {
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--color-text-muted);
    margin-top: 4px;
  }
  .capacity-badge {
    position: absolute;
    right: 20px;
    /* High enough to clear the focus card's ghost action row (Split/Skip/
       Backlog) — it used to sit right on top of "Backlog" whenever the Up
       Next list was short enough for the card to land near the bottom of
       the screen. */
    bottom: 90px;
    width: 56px;
    height: 56px;
    border-radius: 999px;
    color: var(--color-text-inverse);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-overlay-sm);
    cursor: pointer;
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 13px;
    text-align: center;
    line-height: 1.1;
    border: none;
    transition: background-color var(--duration-base) var(--ease-standard);
  }
  .capacity-badge__spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: var(--color-text-inverse);
    border-radius: 50%;
    animation: capacity-badge-spin 0.7s linear infinite;
  }
  @keyframes capacity-badge-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
