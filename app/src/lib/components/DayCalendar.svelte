<script lang="ts">
  import { untrack } from 'svelte';
  import { planner } from '../store.svelte';
  import Icon from './Icon.svelte';
  import type { OutlookBlock, Task } from '../types';

  interface Props {
    /// "YYYY-MM-DD" — the day being planned.
    date: string;
    /// The task currently being planned — excluded from the calendar's own
    /// blocks (it's not "placed" yet, that's what this view is for).
    excludeTaskId: string;
    /// Outlook events for this day — drawn read-only, same reason a slot
    /// isn't free as an Asana task, but not draggable/clearable since this
    /// app doesn't own them.
    outlookEvents: OutlookBlock[];
    /// Fires once the user confirms a tentative placement (see the pending
    /// block below) — not on the first tap. Unused when allowPlacement is
    /// false.
    onPickTime?: (hhmm: string) => void;
    /// "HH:MM" to seed the pending block's initial placement with, instead
    /// of requiring a first tap on the track — PlanToday passes the
    /// earliest free slot so opening it lands the task on a sensible time
    /// immediately; omitted callers (FreeSlotsLater) keep the old
    /// tap-to-place behavior.
    suggestedStartTime?: string | null;
    /// False for the standalone calendar view (CalendarView.svelte) — there's
    /// no task being placed there, just existing tasks to look at and drag
    /// around, so tapping the track shouldn't conjure a pending block with
    /// no task behind it. Every other caller is mid-placing a real task and
    /// wants the normal tap-to-place/pending-block behavior.
    allowPlacement?: boolean;
    /// True for the standalone calendar view — shows the whole 0:00-24:00
    /// day instead of the working-hours-plus-slack window every other
    /// caller wants (see startMin/endMin). A pure browsing view has no
    /// reason to hide the early-morning/late-night hours the way a
    /// planning flow does.
    fullDay?: boolean;
  }
  let { date, excludeTaskId, outlookEvents, onPickTime, suggestedStartTime = null, allowPlacement = true, fullDay = false }: Props = $props();

  const PX_PER_MIN = 1.4;
  const SNAP_MIN = 15;
  /// Tall enough for the name's own line plus the time/action-buttons line
  /// below it (see .task-block's column layout) without either getting
  /// clipped on a short task.
  const MIN_BLOCK_HEIGHT = 44;
  /// Taller than a real task block would otherwise get from its own
  /// duration — the pending block needs room for a full-size, easy-to-tap
  /// Confirm/Remove button row regardless of how short the task is.
  const PENDING_MIN_HEIGHT = 108;

  function toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }
  function toHHMM(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /// dueAt, not dueHour: dueHour is null whenever there's no due_at at all
  /// (a date-only due date) — gating this view on it too used to make a
  /// task with a real but server-untrusted time (see taskQueue.ts's old
  /// "doubled" flag, since removed) silently disappear from the calendar
  /// while it kept right on conflicting at confirm time.
  const otherTasks = $derived(planner.tasks.filter((t) => t.dueOn === date && t.dueAt && t.id !== excludeTaskId));

  /// Local minutes-of-day for an Outlook event's start, or a task's dueAt —
  /// has to go through Date's local getters, not string-slicing the ISO
  /// instant, for the same reason toLocalTimeStr (store.svelte.ts) does.
  function isoStartMinutes(iso: string): number {
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
  }
  function isoDurationMinutes(startIso: string, endIso: string): number {
    return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000;
  }

  /// The visible range is the preferred working hours plus 2h of slack on
  /// each side, expanded further still if an already-placed task or
  /// Outlook event falls outside even that — otherwise its block renders
  /// past the track's own height instead of inside it (e.g. a 19:00 task
  /// against an 09:00-18:00 window used to render below the calendar card
  /// entirely). Rounded to the hour so the hour-mark ruler stays clean.
  const startMin = $derived.by(() => {
    if (fullDay) return 0;
    const base = toMinutes(planner.prefStartTime) - 120;
    const earliestTask = otherTasks.reduce((min, t) => Math.min(min, isoStartMinutes(t.dueAt!)), base);
    const earliest = outlookEvents.reduce((min, e) => Math.min(min, isoStartMinutes(e.start)), earliestTask);
    return Math.max(0, Math.floor(earliest / 60) * 60);
  });
  const endMin = $derived.by(() => {
    if (fullDay) return 24 * 60;
    const base = toMinutes(planner.prefEndTime) + 120;
    const latestTask = otherTasks.reduce((max, t) => Math.max(max, isoStartMinutes(t.dueAt!) + t.hours * 60), base);
    const latest = outlookEvents.reduce((max, e) => Math.max(max, isoStartMinutes(e.start) + isoDurationMinutes(e.start, e.end)), latestTask);
    return Math.min(24 * 60, Math.ceil(latest / 60) * 60);
  });
  const totalHeight = $derived(Math.max(1, endMin - startMin) * PX_PER_MIN);

  /// A short task rendered at MIN_BLOCK_HEIGHT visually spans more time
  /// than it actually occupies (a 5-minute task still draws as ~21
  /// minutes tall, so its Confirm/name text has room) — using that
  /// inflated height for overlap *detection* was pulling unrelated short
  /// tasks into the same column cluster as each other even when their real
  /// times didn't conflict, which is a big part of why a merely-busy day
  /// could still end up needing far more side-by-side columns than the day
  /// actually warranted. Column math uses the real, uninflated duration
  /// (overlapHeight); only the rendered box (height) stays inflated.
  interface Positioned {
    top: number;
    height: number;
    overlapHeight: number;
  }
  interface Columned {
    col: number;
    cols: number;
    /// >0 for the rare item that still doesn't fit within MAX_COLS even
    /// after the overlapHeight fix — cascaded with a small peeking offset
    /// on top of whichever column it re-uses, instead of shrinking every
    /// column in the cluster down to something unreadable.
    stackDepth: number;
  }
  const MAX_COLS = 3;
  /// Calendar-app-style side-by-side layout for overlapping blocks: items
  /// are processed in start-time order and grouped into clusters of
  /// mutually-overlapping time ranges, each getting its own column count —
  /// a block with nothing overlapping it doesn't get squeezed just because
  /// some unrelated pair overlaps elsewhere in the day. Runs over tasks and
  /// Outlook events together, so a task overlapping a meeting splits side
  /// by side the same as two tasks overlapping each other, instead of one
  /// simply stacking on top of the other. Column count is capped at
  /// MAX_COLS — text stays legible no matter how many things genuinely
  /// overlap; anything beyond that cascades (see stackDepth) rather than
  /// shrinking further.
  function assignColumns<T extends Positioned>(items: T[]): (T & Columned)[] {
    const sorted = [...items].sort((a, b) => a.top - b.top || b.overlapHeight - a.overlapHeight);
    const placed: (T & Columned)[] = [];
    let clusterStart = 0;
    let clusterEnd = -Infinity;
    const closeCluster = () => {
      if (clusterStart >= placed.length) return;
      const naturalCols = placed.slice(clusterStart).reduce((m, p) => Math.max(m, p.col + 1), 1);
      const cols = Math.min(naturalCols, MAX_COLS);
      for (let i = clusterStart; i < placed.length; i++) placed[i].cols = cols;
      clusterStart = placed.length;
    };
    for (const item of sorted) {
      if (item.top >= clusterEnd) {
        closeCluster();
        clusterEnd = -Infinity;
      }
      const overlapping = (c: number) =>
        placed
          .slice(clusterStart)
          .filter((p) => p.col === c && item.top < p.top + p.overlapHeight && p.top < item.top + item.overlapHeight);
      let col = 0;
      while (col < MAX_COLS - 1 && overlapping(col).length > 0) col++;
      const stackDepth = overlapping(col).length;
      placed.push({ ...item, col, cols: 1, stackDepth });
      clusterEnd = Math.max(clusterEnd, item.top + item.overlapHeight);
    }
    closeCluster();
    return placed;
  }
  /// left/width for a block's column slot, within the track's existing 6px
  /// side margins — col 0 of 1 (the non-overlapping case) reduces to
  /// exactly the old fixed `left:6px; right:6px` sizing. A cascaded item
  /// (stackDepth > 0) nudges right by a few px per level so it still peeks
  /// out from under whatever it's sharing a column with, instead of being
  /// completely hidden.
  function colStyle(col: number, cols: number, stackDepth: number): string {
    const gap = cols > 1 ? 4 : 0;
    const nudge = stackDepth * 10;
    return `left: calc(6px + (100% - 12px) * ${col / cols} + ${nudge}px); width: calc((100% - 12px) * ${1 / cols} - ${gap}px - ${nudge}px);`;
  }

  type CalItem =
    | ({ kind: 'task'; task: Task } & Positioned)
    | ({ kind: 'outlook'; event: OutlookBlock } & Positioned);

  const rawBlocks = $derived<CalItem[]>(
    otherTasks.map((t) => ({
      kind: 'task' as const,
      task: t,
      top: Math.max(0, (isoStartMinutes(t.dueAt!) - startMin) * PX_PER_MIN),
      height: Math.max(MIN_BLOCK_HEIGHT, t.hours * 60 * PX_PER_MIN),
      overlapHeight: Math.max(1, t.hours * 60 * PX_PER_MIN),
    })),
  );
  const rawOutlookBlocks = $derived<CalItem[]>(
    outlookEvents.map((e) => ({
      kind: 'outlook' as const,
      event: e,
      top: Math.max(0, (isoStartMinutes(e.start) - startMin) * PX_PER_MIN),
      height: Math.max(MIN_BLOCK_HEIGHT, isoDurationMinutes(e.start, e.end) * PX_PER_MIN),
      overlapHeight: Math.max(1, isoDurationMinutes(e.start, e.end) * PX_PER_MIN),
    })),
  );
  const columned = $derived(assignColumns([...rawBlocks, ...rawOutlookBlocks]));
  const blocks = $derived(columned.filter((b) => b.kind === 'task') as ((CalItem & { kind: 'task' }) & Columned)[]);
  const outlookBlocks = $derived(columned.filter((b) => b.kind === 'outlook') as ((CalItem & { kind: 'outlook' }) & Columned)[]);
  /// The wrap-up/context-switch buffer findConflicts/computeFreeSlots
  /// already treat as unavailable after anything on the calendar (see
  /// freeSlots.ts) — drawn here too so it's visible *why* the next slot
  /// isn't offered right at a block's own end time, not just enforced
  /// invisibly server-side. Same buffer after both a task and an Outlook
  /// event, matching how the busy-time computation itself treats them.
  const bufferPx = $derived(planner.bufferMinutes * PX_PER_MIN);

  const hourMarks = $derived.by(() => {
    const marks: { label: string; top: number }[] = [];
    for (let h = Math.ceil(startMin / 60); h <= Math.floor(endMin / 60); h++) {
      marks.push({ label: `${String(h).padStart(2, '0')}:00`, top: (h * 60 - startMin) * PX_PER_MIN });
    }
    return marks;
  });

  function clampMin(mins: number): number {
    return Math.max(startMin, Math.min(mins, endMin));
  }
  function snap(mins: number): number {
    return Math.round(mins / SNAP_MIN) * SNAP_MIN;
  }

  /// Current-time indicator — only meaningful when `date` is today, and
  /// only worth re-deriving once a minute (any faster is wasted renders for
  /// a line that moves ~1.4px/min).
  let now: Date = $state(new Date());
  $effect(() => {
    const id = setInterval(() => {
      now = new Date();
    }, 60_000);
    return () => clearInterval(id);
  });
  function localDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const nowMin = $derived(now.getHours() * 60 + now.getMinutes());
  const showNowLine = $derived(localDateStr(now) === date && nowMin >= startMin && nowMin <= endMin);
  const nowLineTop = $derived((nowMin - startMin) * PX_PER_MIN);

  // --- tentative placement for the task being planned: seeded from
  // suggestedStartTime if given (see PlanToday — lands the task on the
  // earliest free slot immediately instead of requiring a first tap),
  // otherwise a tap on the track sets it. Either way nothing commits until
  // the user taps Confirm/Remove, and dragging still adjusts it first. ---
  let pendingMin: number | null = $state(
    untrack(() => (suggestedStartTime ? clampMin(snap(toMinutes(suggestedStartTime))) : null)),
  );
  const focusHours = $derived(planner.focusTaskRaw?.hours ?? 1);
  /// The task's own duration, in px — can be shorter than PENDING_MIN_HEIGHT
  /// (the box's actual rendered height, below), which exists purely so a
  /// short task's Confirm/Remove row has room. Tracked separately so the
  /// block can show *where the real task actually ends* instead of just
  /// its start time — otherwise a short task's padded-out box can look
  /// like it overlaps whatever's right after it even when the real
  /// schedule doesn't, which is confusing on its own even before
  /// considering that the pending block always renders on top regardless
  /// of genuine conflicts (see the "no side-by-side layout for the
  /// pending block" note above assignColumns).
  const pendingRealHeight = $derived(focusHours * 60 * PX_PER_MIN);
  const pendingHeight = $derived(Math.max(PENDING_MIN_HEIGHT, pendingRealHeight));
  const pendingTop = $derived(pendingMin === null ? 0 : Math.max(0, (pendingMin - startMin) * PX_PER_MIN));
  const pendingHHMM = $derived(pendingMin === null ? '' : toHHMM(pendingMin));
  const pendingEndHHMM = $derived(pendingMin === null ? '' : toHHMM(pendingMin + focusHours * 60));

  /// Scrolls the pending block into view as soon as it exists — mainly for
  /// the auto-seeded case (see suggestedStartTime): the suggested slot is
  /// often well past the top of a scrollable calendar (the visible range
  /// starts 2h before preferred hours), so without this the task would
  /// land on a screen the user has to go hunting for.
  let pendingEl: HTMLElement | undefined = $state();
  $effect(() => {
    pendingEl?.scrollIntoView({ block: 'center' });
  });

  /// fullDay's 0:00-24:00 range would otherwise always open scrolled to
  /// midnight — scrolls to roughly "now" (today) or the preferred start
  /// time (any other day) once per date shown, same idea as the pending
  /// block's own auto-scroll above.
  let scrollAnchorEl: HTMLElement | undefined = $state();
  const scrollAnchorMin = $derived(clampMin(localDateStr(now) === date ? nowMin - 60 : toMinutes(planner.prefStartTime) - 30));
  $effect(() => {
    if (!fullDay) return;
    void date; // re-fires when cycling to a different day
    scrollAnchorEl?.scrollIntoView({ block: 'start' });
  });

  // --- drag-to-move, shared by already-placed tasks and the pending block ---
  type DragTarget = { kind: 'other'; taskId: string } | { kind: 'pending' };
  let dragTarget: DragTarget | null = $state(null);
  let dragTop = $state(0);
  let dragStartY = 0;
  let dragOrigTop = 0;
  let dragHeight = 0;

  function beginDrag(e: PointerEvent, target: DragTarget, origTop: number, height: number) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragTarget = target;
    dragStartY = e.clientY;
    dragOrigTop = origTop;
    dragTop = origTop;
    dragHeight = height;
  }
  function onDragMove(e: PointerEvent) {
    if (!dragTarget) return;
    const next = dragOrigTop + (e.clientY - dragStartY);
    dragTop = Math.max(0, Math.min(next, totalHeight - dragHeight));
  }
  async function endDrag() {
    if (!dragTarget) return;
    const target = dragTarget;
    const draggedFrom = dragOrigTop;
    const finalTop = dragTop;
    dragTarget = null;
    if (target.kind === 'pending') {
      pendingMin = clampMin(snap(startMin + finalTop / PX_PER_MIN));
      return;
    }
    // A tap that never really moved shouldn't count as a "move" attempt.
    if (Math.abs(finalTop - draggedFrom) < SNAP_MIN * PX_PER_MIN * 0.5) return;
    const hhmm = toHHMM(clampMin(snap(startMin + finalTop / PX_PER_MIN)));
    await planner.moveOtherTask(target.taskId, date, hhmm);
  }

  function onTrackClick(e: MouseEvent, trackEl: HTMLElement) {
    if (!allowPlacement || dragTarget) return;
    const y = e.clientY - trackEl.getBoundingClientRect().top;
    pendingMin = clampMin(snap(startMin + y / PX_PER_MIN));
  }
  function confirmPending() {
    if (pendingMin === null) return;
    onPickTime?.(toHHMM(pendingMin));
  }
  function removePending() {
    pendingMin = null;
  }
</script>

<div class="calendar">
  <div class="track" style="height:{totalHeight}px;" onclick={(e) => onTrackClick(e, e.currentTarget as HTMLElement)}>
    {#each hourMarks as m (m.label)}
      <div class="hour-line" style="top:{m.top}px;">
        <span class="hour-label">{m.label}</span>
      </div>
    {/each}
    {#if showNowLine}
      <div class="now-line" style="top:{nowLineTop}px;"></div>
    {/if}
    {#if fullDay}
      <div bind:this={scrollAnchorEl} class="scroll-anchor" style="top:{(scrollAnchorMin - startMin) * PX_PER_MIN}px;"></div>
    {/if}
    {#each blocks as b (b.task.id)}
      <div
        class="task-block"
        class:task-block--stacked={b.stackDepth > 0}
        class:task-block--dragging={dragTarget?.kind === 'other' && dragTarget.taskId === b.task.id}
        style="{colStyle(b.col, b.cols, b.stackDepth)} top:{dragTarget?.kind === 'other' && dragTarget.taskId === b.task.id
          ? dragTop
          : b.top}px; height:{b.height}px; z-index:{dragTarget?.kind === 'other' && dragTarget.taskId === b.task.id ? 5 : 1 + b.stackDepth};"
        onpointerdown={(e) => beginDrag(e, { kind: 'other', taskId: b.task.id }, b.top, b.height)}
        onpointermove={onDragMove}
        onpointerup={endDrag}
        onpointercancel={endDrag}
        onclick={(e) => e.stopPropagation()}
      >
        <div class="task-block__name">{b.task.name}</div>
        <div class="task-block__bottom">
          <div class="task-block__time">{toHHMM(isoStartMinutes(b.task.dueAt!))}</div>
          <div class="task-block__actions">
            <button
              class="task-block__icon-btn"
              title="Plan later"
              aria-label="Plan later"
              onpointerdown={(e) => e.stopPropagation()}
              onclick={(e) => {
                e.stopPropagation();
                planner.openTaskInPlanLater(b.task.id);
              }}
            >
              <Icon name="arrow-right" size={12} color="var(--color-text-primary)" />
            </button>
            <button
              class="task-block__icon-btn"
              title="Clear due time"
              aria-label="Clear due time"
              onpointerdown={(e) => e.stopPropagation()}
              onclick={(e) => {
                e.stopPropagation();
                planner.clearOtherTaskDueDate(b.task.id);
              }}
            >
              ×
            </button>
          </div>
        </div>
      </div>
      {#if bufferPx > 0}
        <div class="buffer-segment" style="{colStyle(b.col, b.cols, b.stackDepth)} top:{b.top + b.overlapHeight}px; height:{bufferPx}px;"></div>
      {/if}
    {/each}
    {#each outlookBlocks as o (o.event.id)}
      <div
        class="outlook-block"
        class:outlook-block--stacked={o.stackDepth > 0}
        style="{colStyle(o.col, o.cols, o.stackDepth)} top:{o.top}px; height:{o.height}px; z-index:{1 + o.stackDepth};"
        onclick={(e) => e.stopPropagation()}
      >
        <Icon name="calendar" size={12} color="var(--color-text-muted)" />
        <div class="outlook-block__text">
          <div class="outlook-block__name">{o.event.title}</div>
          <div class="outlook-block__time">{toHHMM(isoStartMinutes(o.event.start))}–{toHHMM(isoStartMinutes(o.event.end))}</div>
        </div>
      </div>
      {#if bufferPx > 0}
        <div class="buffer-segment" style="{colStyle(o.col, o.cols, o.stackDepth)} top:{o.top + o.overlapHeight}px; height:{bufferPx}px;"></div>
      {/if}
    {/each}
    {#if allowPlacement && pendingMin !== null}
      <div
        class="pending-block"
        class:pending-block--dragging={dragTarget?.kind === 'pending'}
        style="top:{dragTarget?.kind === 'pending' ? dragTop : pendingTop}px; height:{pendingHeight}px;"
        bind:this={pendingEl}
        onpointerdown={(e) => beginDrag(e, { kind: 'pending' }, pendingTop, pendingHeight)}
        onpointermove={onDragMove}
        onpointerup={endDrag}
        onpointercancel={endDrag}
        onclick={(e) => e.stopPropagation()}
      >
        {#if pendingHeight > pendingRealHeight}
          <div class="pending-block__pad" style="top:{pendingRealHeight}px;"></div>
        {/if}
        <div class="pending-block__text">
          <div class="pending-block__name">{planner.focusTaskRaw?.name ?? ''}</div>
          <div class="pending-block__time">{pendingHHMM}–{pendingEndHHMM}</div>
        </div>
        <div class="pending-block__actions">
          <button
            class="pending-block__btn pending-block__btn--remove"
            onclick={(e) => {
              e.stopPropagation();
              removePending();
            }}
          >
            ✕ Remove
          </button>
          <button
            class="pending-block__btn pending-block__btn--confirm"
            onclick={(e) => {
              e.stopPropagation();
              confirmPending();
            }}
          >
            ✓ Confirm
          </button>
        </div>
      </div>
    {/if}
  </div>
  <div class="hint">
    {#if !allowPlacement}
      Drag a task to move it
    {:else if pendingMin !== null}
      Drag to adjust the time, then confirm
    {:else}
      Tap an open time to plan here · drag a task to move it
    {/if}
  </div>
</div>

<style>
  .calendar {
    background: var(--color-bg-surface);
    border-radius: var(--radius-md);
    padding: 10px;
    margin-bottom: 10px;
  }
  .track {
    position: relative;
    cursor: pointer;
    /* Hour ruler lives on the right, in this margin — task/outlook/pending
       blocks are positioned within .track's own box (see colStyle), so
       they never reach into it. That leaves this strip permanently free of
       drag/touch-action:none handlers, giving a thumb-friendly (right edge,
       where a mobile thumb naturally rests) place to scroll the page past
       a packed day without a block hijacking the gesture. */
    margin-right: 44px;
    border-right: 1px solid var(--color-border);
  }
  .hour-line {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px solid var(--color-border);
  }
  .hour-label {
    position: absolute;
    right: -44px;
    top: -7px;
    width: 38px;
    text-align: left;
    font-family: var(--font-family-base);
    font-size: 11px;
    color: var(--color-text-muted);
  }
  .scroll-anchor {
    position: absolute;
    left: 0;
    right: 0;
    height: 1px;
    pointer-events: none;
  }
  .now-line {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 2px solid var(--color-feedback-wrong);
    pointer-events: none;
    z-index: 2;
  }
  .now-line::before {
    content: '';
    position: absolute;
    left: -4px;
    top: -4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-feedback-wrong);
  }
  .task-block {
    position: absolute;
    background: var(--color-bg-page);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    padding: 4px 8px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    cursor: grab;
    touch-action: none;
    overflow: hidden;
  }
  /* The wrap-up buffer after a block — same diagonal-hatch language as the
     pending block's own padding-vs-real-time marker, so "hatched = not
     actually free, but not a real event either" reads consistently across
     the calendar. Sits behind real blocks (z-index 0) and never captures
     input — purely informational. */
  .buffer-segment {
    position: absolute;
    box-sizing: border-box;
    background: repeating-linear-gradient(45deg, var(--color-border) 0, var(--color-border) 5px, transparent 5px, transparent 10px);
    border-radius: var(--radius-sm);
    pointer-events: none;
    z-index: 0;
  }
  /* Name gets the block's full width on its own line — the action buttons
     share the line below with the time instead of squeezing the name's
     available width on the same row. */
  .task-block__bottom {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  /* z-index is inline (see colStyle usage) — needs to weigh drag state and
     stack cascade depth together, so it's computed per-item in the
     template rather than fixed here. */
  .task-block--dragging {
    cursor: grabbing;
    box-shadow: var(--shadow-overlay-sm);
    border-color: var(--color-brand-primary);
  }
  .task-block--stacked {
    box-shadow: -2px 0 4px rgba(22, 32, 60, 0.12);
  }
  .task-block__name {
    min-width: 0;
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 12px;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .task-block__time {
    min-width: 0;
    flex-shrink: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-family-base);
    font-size: 11px;
    color: var(--color-text-muted);
  }
  .task-block__actions {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .task-block__icon-btn {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: none;
    background: var(--color-border);
    color: var(--color-text-primary);
    font-size: 13px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    touch-action: none;
  }
  /* Read-only — no drag, no reset button — this app doesn't own Outlook
     events, it's just showing why a time might not really be free. Striped
     background instead of a solid fill to read as "not a task" at a
     glance, distinct from .task-block. */
  .outlook-block {
    position: absolute;
    background: repeating-linear-gradient(135deg, var(--color-bg-page), var(--color-bg-page) 6px, var(--color-border) 6px, var(--color-border) 12px);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    padding: 4px 8px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
  }
  .outlook-block--stacked {
    box-shadow: -2px 0 4px rgba(22, 32, 60, 0.12);
  }
  .outlook-block__text {
    min-width: 0;
  }
  .outlook-block__name {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 12px;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .outlook-block__time {
    font-family: var(--font-family-base);
    font-size: 11px;
    color: var(--color-text-muted);
  }
  .hint {
    font-family: var(--font-family-base);
    font-size: 11px;
    color: var(--color-text-muted);
    text-align: center;
    margin-top: 8px;
  }
  .pending-block {
    position: absolute;
    left: 6px;
    right: 6px;
    background: var(--color-bg-page);
    border: 2px dashed var(--color-brand-primary);
    border-radius: var(--radius-sm);
    padding: 8px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 8px;
    cursor: grab;
    touch-action: none;
    overflow: hidden;
    /* Comfortably above any stacked task/outlook block's z-index (1 +
       stackDepth, see colStyle usage) or a task mid-drag (5), regardless
       of how deep a cascade gets. */
    z-index: 20;
  }
  .pending-block--dragging {
    cursor: grabbing;
    box-shadow: var(--shadow-overlay-sm);
    z-index: 21;
  }
  /* Shades the part of the box that's just padding for the Confirm/Remove
     row on a short task, not real task time — without this a short task's
     box can look like it spans well past where the task actually ends,
     as if overlapping whatever's scheduled right after it. */
  .pending-block__pad {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: repeating-linear-gradient(
      45deg,
      rgba(0, 0, 0, 0.04),
      rgba(0, 0, 0, 0.04) 5px,
      transparent 5px,
      transparent 10px
    );
    border-top: 1px dashed var(--color-border);
    pointer-events: none;
  }
  .pending-block__text {
    min-width: 0;
  }
  .pending-block__name {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 12px;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pending-block__time {
    font-family: var(--font-family-base);
    font-size: 11px;
    color: var(--color-text-muted);
  }
  .pending-block__actions {
    flex-shrink: 0;
    display: flex;
    gap: 8px;
    margin-top: auto;
  }
  .pending-block__btn {
    flex: 1;
    height: 40px;
    border-radius: var(--radius-sm);
    border: none;
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .pending-block__btn--confirm {
    background: var(--color-feedback-correct);
    color: var(--color-text-inverse);
  }
  .pending-block__btn--remove {
    background: var(--color-feedback-wrong);
    color: var(--color-text-inverse);
  }
</style>
