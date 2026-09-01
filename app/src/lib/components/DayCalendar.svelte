<script lang="ts">
  import { untrack } from 'svelte';
  import { planner } from '../store.svelte';
  import Icon from './Icon.svelte';
  import Input from './Input.svelte';
  import type { OutlookBlock, Task } from '../types';
  import { dateStrInTz, hmInTz } from '../tz';

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
    /// Already-completed tasks due this day, drawn read-only (no drag, no
    /// clear/plan-later actions — there's nothing left to plan) so a day
    /// already looked at doesn't have its done work simply vanish once it's
    /// checked off. Empty for every caller except CalendarView, the only
    /// place completed tasks are fetched for at all (see its own comment on
    /// why the client's regular `tasks` list is deliberately incomplete-only).
    completedTasks?: Task[];
    /// Fires whenever a block drag starts/ends — lets CalendarView suppress
    /// its own swipe-to-change-day gesture for the whole life of a drag, not
    /// just while the touch started on a block (see its own comment on why
    /// that alone wasn't enough).
    ondragstatechange?: (dragging: boolean) => void;
  }
  let {
    date,
    excludeTaskId,
    outlookEvents,
    onPickTime,
    suggestedStartTime = null,
    allowPlacement = true,
    fullDay = false,
    completedTasks = [],
    ondragstatechange,
  }: Props = $props();

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
  /// A task linked to one of this day's Outlook events is deliberately left
  /// out of the task blocks below — the Outlook block already shows it's
  /// linked (see the outlook-block__icon link glyph and its "Linked to X"
  /// detail-sheet status), so drawing both was the same appointment showing
  /// up twice, side by side, at the exact same time (they share dueAt —
  /// linking adopts the event's own time/duration — so assignColumns'
  /// overlap detection genuinely can't tell them apart from two unrelated
  /// things that happen to clash). This is what the "still showed up twice
  /// after linking" report was seeing.
  const linkedTaskIds = $derived(new Set(outlookEvents.filter((e) => e.linked && e.linkedTaskGid).map((e) => e.linkedTaskGid!)));
  const otherTasks = $derived(
    planner.tasks.filter((t) => t.dueOn === date && t.dueAt && t.id !== excludeTaskId && !linkedTaskIds.has(t.id)),
  );
  /// Same dueAt requirement and same linked-task exclusion as otherTasks
  /// above — a completed task with no due time has no natural position on a
  /// time-based grid, so it's simply not drawn (same as an incomplete one
  /// in that state already isn't), and one linked to an Outlook event is
  /// already represented by that event's own block.
  const completedWithTime = $derived(completedTasks.filter((t) => t.dueAt && !linkedTaskIds.has(t.id)));

  /// Minutes-of-day for an Outlook event's start, or a task's dueAt, in the
  /// user's own configured timezone — not the device's ambient one, which
  /// can silently differ from it (most obviously while traveling). See
  /// app/src/lib/tz.ts and store.svelte.ts's toLocalTimeStr, same reasoning.
  function isoStartMinutes(iso: string): number {
    const { h, m } = hmInTz(new Date(iso), planner.timezone);
    return h * 60 + m;
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
    const earliestCompleted = completedWithTime.reduce((min, t) => Math.min(min, isoStartMinutes(t.dueAt!)), earliestTask);
    const earliest = outlookEvents.reduce((min, e) => Math.min(min, isoStartMinutes(e.start)), earliestCompleted);
    return Math.max(0, Math.floor(earliest / 60) * 60);
  });
  const endMin = $derived.by(() => {
    const base = fullDay ? 24 * 60 : toMinutes(planner.prefEndTime) + 120;
    const latestTask = otherTasks.reduce((max, t) => Math.max(max, isoStartMinutes(t.dueAt!) + t.hours * 60), base);
    const latestCompleted = completedWithTime.reduce((max, t) => Math.max(max, isoStartMinutes(t.dueAt!) + t.hours * 60), latestTask);
    const latest = outlookEvents.reduce((max, e) => Math.max(max, isoStartMinutes(e.start) + isoDurationMinutes(e.start, e.end)), latestCompleted);
    const rounded = Math.ceil(latest / 60) * 60;
    // fullDay deliberately doesn't cap at 24:00 the way the bounded
    // planning window below does — a task starting late enough to run past
    // midnight (isoStartMinutes + duration naturally lands past 1440 with
    // no date-rollover awareness needed, same as the working-hours case
    // above) needs the extra rows to actually render instead of being cut
    // off at the day boundary with no visual sign there was more. See
    // hourMarks for how those extra hours get labeled.
    return fullDay ? rounded : Math.min(24 * 60, rounded);
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
    | ({ kind: 'outlook'; event: OutlookBlock } & Positioned)
    | ({ kind: 'completed'; task: Task } & Positioned);

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
  const rawCompletedBlocks = $derived<CalItem[]>(
    completedWithTime.map((t) => ({
      kind: 'completed' as const,
      task: t,
      top: Math.max(0, (isoStartMinutes(t.dueAt!) - startMin) * PX_PER_MIN),
      height: Math.max(MIN_BLOCK_HEIGHT, t.hours * 60 * PX_PER_MIN),
      overlapHeight: Math.max(1, t.hours * 60 * PX_PER_MIN),
    })),
  );
  const columned = $derived(assignColumns([...rawBlocks, ...rawOutlookBlocks, ...rawCompletedBlocks]));
  const blocks = $derived(columned.filter((b) => b.kind === 'task') as ((CalItem & { kind: 'task' }) & Columned)[]);
  const outlookBlocks = $derived(columned.filter((b) => b.kind === 'outlook') as ((CalItem & { kind: 'outlook' }) & Columned)[]);
  const completedBlocks = $derived(
    columned.filter((b) => b.kind === 'completed') as ((CalItem & { kind: 'completed' }) & Columned)[],
  );
  /// The wrap-up/context-switch buffer findConflicts/computeFreeSlots
  /// already treat as unavailable after anything on the calendar (see
  /// freeSlots.ts) — drawn here too so it's visible *why* the next slot
  /// isn't offered right at a block's own end time, not just enforced
  /// invisibly server-side. Same buffer after both a task and an Outlook
  /// event, matching how the busy-time computation itself treats them.
  const bufferPx = $derived(planner.bufferMinutes * PX_PER_MIN);

  const hourMarks = $derived.by(() => {
    const marks: { hour: number; label: string; top: number }[] = [];
    for (let h = Math.ceil(startMin / 60); h <= Math.floor(endMin / 60); h++) {
      // h can run past 24 here (see endMin's fullDay overflow buffer) — a
      // literal "25:00" isn't a real clock time, so wrap it back to the
      // next day's own "01:00" the way a clock actually would. Keyed by the
      // unwrapped hour, not the wrapped label: hour 0 and hour 24 both
      // display "00:00", so keying by label collided and crashed the
      // each-block (Svelte's each_key_duplicate).
      marks.push({ hour: h, label: `${String(h % 24).padStart(2, '0')}:00`, top: (h * 60 - startMin) * PX_PER_MIN });
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
  // In the user's own configured timezone, not the device's ambient one —
  // see app/src/lib/tz.ts. This is what decides which day's track actually
  // gets the "current time" line, and where on it.
  function localDateStr(d: Date): string {
    return dateStrInTz(d, planner.timezone);
  }
  const nowMin = $derived.by(() => {
    const { h, m } = hmInTz(now, planner.timezone);
    return h * 60 + m;
  });
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
  const focusHours = $derived(planner.planFlowTask?.hours ?? 1);
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
  $effect(() => {
    ondragstatechange?.(dragTarget !== null);
  });
  let dragTop = $state(0);
  let dragStartY = 0;
  let dragOrigTop = 0;
  let dragHeight = 0;

  /// A task block squeezed into a narrow side-by-side column (see
  /// assignColumns) truncates its own name to an unreadable "Teilnah…" —
  /// tapping it (a genuine tap, not a drag — see endDrag's "didn't really
  /// move" branch below) expands it to the track's full width and lets its
  /// name wrap instead of clipping, so reading it doesn't require dragging
  /// it out of its column first. Only one at a time; tapping the same
  /// block again, tapping a different one, or tapping open track space all
  /// collapse/replace it (see onTrackClick).
  let expandedBlockId: string | null = $state(null);

  function beginDrag(e: PointerEvent, target: DragTarget, origTop: number, height: number) {
    // A button inside a draggable block is never a drag handle. Without
    // this, setPointerCapture below redirects every later pointer event —
    // and, with a mouse, the synthesized `click` along with them — to the
    // capturing block instead of the button that was actually pressed, so
    // the button's own onclick never runs at all. That's why the pending
    // block's Confirm/Remove did nothing on desktop Chrome: the click
    // landed on .pending-block, whose handler only stops propagation.
    // (Touch didn't show it, which is why it survived on-device testing.)
    // The task blocks' own icon buttons each stop pointerdown themselves;
    // this guard covers every button in here, including future ones.
    if ((e.target as HTMLElement).closest('button')) return;
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
    // A tap that never really moved shouldn't count as a "move" attempt —
    // toggle its expanded/readable state instead.
    if (Math.abs(finalTop - draggedFrom) < SNAP_MIN * PX_PER_MIN * 0.5) {
      expandedBlockId = expandedBlockId === target.taskId ? null : target.taskId;
      return;
    }
    const hhmm = toHHMM(clampMin(snap(startMin + finalTop / PX_PER_MIN)));
    await planner.moveOtherTask(target.taskId, date, hhmm);
  }

  function onTrackClick(e: MouseEvent, trackEl: HTMLElement) {
    expandedBlockId = null;
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
    {#each hourMarks as m (m.hour)}
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
      {@const expanded = b.task.id === expandedBlockId}
      {@const dragging = dragTarget?.kind === 'other' && dragTarget.taskId === b.task.id}
      <div
        class="task-block"
        class:task-block--stacked={b.stackDepth > 0}
        class:task-block--dragging={dragging}
        class:task-block--expanded={expanded}
        style="{expanded ? 'left:6px; right:6px;' : colStyle(b.col, b.cols, b.stackDepth)} top:{dragging
          ? dragTop
          : b.top}px; height:{expanded ? 'auto' : `${b.height}px`}; min-height:{b.height}px; z-index:{expanded ? 15 : dragging ? 5 : 1 + b.stackDepth};"
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
              <Icon name="arrow-right" size={13} color="var(--color-text-primary)" />
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
        class:outlook-block--linked={o.event.linked}
        class:outlook-block--ignored={o.event.ignored}
        class:outlook-block--clickable={!allowPlacement}
        style="{colStyle(o.col, o.cols, o.stackDepth)} top:{o.top}px; height:{o.height}px; z-index:{1 + o.stackDepth};"
        onclick={(e) => {
          e.stopPropagation();
          expandedBlockId = null;
          if (!allowPlacement) planner.openEventDetail(o.event.id);
        }}
      >
        <span class="outlook-block__icon">
          {#if o.event.linked}
            <Icon name="link" size={11} color="var(--color-feedback-correct)" />
          {:else if o.event.ignored}
            <Icon name="link-off" size={11} color="var(--color-text-muted)" />
          {:else}
            <Icon name="calendar" size={11} color="var(--color-text-muted)" />
          {/if}
        </span>
        <div class="outlook-block__text">
          <div class="outlook-block__name">{o.event.title}</div>
          <div class="outlook-block__time">{toHHMM(isoStartMinutes(o.event.start))}–{toHHMM(isoStartMinutes(o.event.end))}</div>
        </div>
      </div>
      {#if bufferPx > 0}
        <div class="buffer-segment" style="{colStyle(o.col, o.cols, o.stackDepth)} top:{o.top + o.overlapHeight}px; height:{bufferPx}px;"></div>
      {/if}
    {/each}
    {#each completedBlocks as c (c.task.id)}
      <!-- Read-only — no drag/clear/plan-later, there's nothing left to do
           with a task that's already done. stopPropagation just keeps a tap
           here from conjuring a pending block on the track underneath it. -->
      <div
        class="completed-block"
        class:completed-block--stacked={c.stackDepth > 0}
        style="{colStyle(c.col, c.cols, c.stackDepth)} top:{c.top}px; height:{c.height}px; z-index:{1 + c.stackDepth};"
        onclick={(e) => e.stopPropagation()}
      >
        <span class="completed-block__icon">
          <Icon name="check-circle" size={11} color="var(--color-feedback-correct)" />
        </span>
        <div class="completed-block__text">
          <div class="completed-block__name">{c.task.name}</div>
          <div class="completed-block__time">{toHHMM(isoStartMinutes(c.task.dueAt!))}</div>
        </div>
      </div>
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
          <div class="pending-block__name">{planner.planFlowTask?.name ?? ''}</div>
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

{#if !allowPlacement && planner.detailPanelEvent}
  {@const de = planner.detailPanelEvent}
  {@const mode = planner.activePanelEventId === de.id ? planner.activePanelMode : null}
  <div class="detail-backdrop" onclick={() => planner.closeEventDetail()}>
    <div class="detail-sheet" onclick={(e) => e.stopPropagation()}>
      <div class="detail-sheet__title">{de.title}</div>
      <div class="detail-sheet__subtitle">{toHHMM(isoStartMinutes(de.start))}–{toHHMM(isoStartMinutes(de.end))}</div>

      {#if de.linked}
        <div class="detail-sheet__status detail-sheet__status--linked">
          <Icon name="link" size={14} color="var(--color-feedback-correct)" />
          Linked to "{de.linkedName}"
        </div>
      {:else if de.ignored}
        <div class="detail-sheet__status">
          <Icon name="link-off" size={14} color="var(--color-text-muted)" />
          Ignored for task-linking
        </div>
      {:else}
        <div class="detail-sheet__status">Not linked to a task yet</div>
      {/if}

      {#if mode}
        <div class="search-panel">
          <div class="search-panel__top">
            <div class="search-panel__title">{mode === 'add' ? 'Add to project or subtask' : 'Link to a task or project'}</div>
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
              {#each planner.searchResultsFor(de.id, mode) as r}
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
          {#if mode === 'add'}
            <button class="search-panel__bare-task" onclick={() => planner.addEventAsBareTask(de.id)}>Create "{de.title}" without a project or task-parent</button>
          {/if}
        </div>
      {:else}
        {#if de.linked}
          {#if de.linkedTaskPermalinkUrl}
            <a class="detail-sheet__action" href={de.linkedTaskPermalinkUrl} target="_blank" rel="noopener noreferrer">See linked task</a>
          {/if}
          <button class="detail-sheet__action detail-sheet__action--danger" onclick={() => planner.unlinkEvent(de.id)}>Remove linked task</button>
        {:else if de.ignored}
          <button class="detail-sheet__action" onclick={() => planner.unignoreEvent(de.id)}>Un-ignore</button>
        {:else}
          <button class="detail-sheet__action" onclick={() => planner.openAddPanel(de.id)}>Create task</button>
          <button class="detail-sheet__action" onclick={() => planner.openLinkPanel(de.id)}>Link existing task</button>
          <button class="detail-sheet__action detail-sheet__action--danger" onclick={() => planner.ignoreEvent(de.id)}>Ignore this event</button>
        {/if}
        <a class="detail-sheet__action" href={de.webLink} target="_blank" rel="noopener noreferrer">Open externally</a>
        <button class="detail-sheet__cancel" onclick={() => planner.closeEventDetail()}>Close</button>
      {/if}
    </div>
  </div>
{/if}

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
  /* A tap (not a drag — see endDrag) on a block squeezed into a narrow
     column expands it to the track's full width so its truncated name can
     wrap and actually be read, instead of requiring a drag out of the
     column first. Above every other block's z-index (including a
     stacked/dragging one) but under the pending block's, which stays the
     one thing actively being placed. */
  .task-block--expanded {
    box-shadow: var(--shadow-overlay-sm);
    border-color: var(--color-brand-primary);
  }
  .task-block--expanded .task-block__name {
    white-space: normal;
    overflow: visible;
    text-overflow: unset;
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
    gap: 6px;
  }
  .task-block__icon-btn {
    /* Wider than tall on purpose — a bigger circular target would eat into
       the block's fixed row height (and the time label next to it), but
       there's slack to spend horizontally instead, so the touch target
       grows without disturbing the layout. */
    flex-shrink: 0;
    width: 34px;
    height: 20px;
    border-radius: 10px;
    border: none;
    background: var(--color-border);
    color: var(--color-text-primary);
    font-size: 14px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    touch-action: none;
  }
  /* Not draggable/clearable — this app doesn't own Outlook events, it's
     just showing why a time might not really be free — but clickable (see
     outlook-block--clickable) to inspect/resolve its task-linking state.
     Striped background instead of a solid fill is this block's *default*,
     unresolved look — neither linked nor ignored yet, i.e. still needs a
     decision — distinct from a plain .task-block and from the resolved
     states below. */
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
  /* Resolved: linked to a task — solid fill instead of the "needs a
     decision" stripe, with a feedback-correct border so it reads as done
     at a glance against the still-striped unresolved blocks around it. */
  .outlook-block--linked {
    background: var(--color-bg-page);
    border-color: var(--color-feedback-correct);
  }
  /* Also resolved, just the other direction — deliberately not going to
     link this one. Muted rather than the striped "still needs a decision"
     look, dashed border to distinguish it from --linked's solid one. */
  .outlook-block--ignored {
    background: var(--color-bg-page);
    border-style: dashed;
    opacity: 0.55;
  }
  .outlook-block--clickable {
    cursor: pointer;
  }
  /* Same circular-badge treatment as .task-block__icon-btn just below —
     the bare link/link-off/calendar glyph is a thin diagonal stroke with
     a lot of empty space in its 24x24 box, so at this size it read as
     noticeably smaller/fainter than a filled shape like the arrow-right
     icon-buttons even at the identical size prop. A solid backdrop gives
     it the same visual footprint regardless of how much ink the glyph
     itself has. */
  .outlook-block__icon {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--color-border);
    display: flex;
    align-items: center;
    justify-content: center;
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
  /* Muted/strikethrough rather than the striped "needs a decision" look of
     an unresolved Outlook block — a completed task isn't awaiting any
     action, it's just there so the day doesn't look like the work never
     happened. Read-only: no drag handlers, no icon-buttons. */
  .completed-block {
    position: absolute;
    background: var(--color-bg-page);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 4px 8px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    opacity: 0.6;
  }
  .completed-block--stacked {
    box-shadow: -2px 0 4px rgba(22, 32, 60, 0.12);
  }
  .completed-block__icon {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--color-border);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .completed-block__text {
    min-width: 0;
  }
  .completed-block__name {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 12px;
    color: var(--color-text-muted);
    text-decoration: line-through;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .completed-block__time {
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
  /* Fixed rather than absolute (unlike Overview's equivalent popup) since
     DayCalendar can be nested anywhere — a fixed backdrop always covers the
     full viewport regardless of which screen embeds it. */
  .detail-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(22, 32, 60, 0.4);
    display: flex;
    align-items: flex-end;
    z-index: 70;
  }
  .detail-sheet {
    width: 100%;
    max-height: 80vh;
    overflow-y: auto;
    background: var(--color-bg-surface);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding: 20px 20px calc(20px + env(safe-area-inset-bottom, 0px));
    box-sizing: border-box;
  }
  .detail-sheet__title {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-extrabold);
    font-size: 17px;
    color: var(--color-text-primary);
  }
  .detail-sheet__subtitle {
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--color-text-muted);
    margin-top: 4px;
  }
  .detail-sheet__status {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 12px;
    margin-bottom: 16px;
    font-family: var(--font-family-base);
    font-size: 13px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-muted);
  }
  .detail-sheet__status--linked {
    color: var(--color-feedback-correct);
  }
  .detail-sheet__action {
    display: block;
    width: 100%;
    text-align: left;
    background: var(--color-bg-page);
    border: none;
    border-radius: var(--radius-md);
    padding: 14px 16px;
    margin-bottom: 8px;
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 15px;
    color: var(--color-text-primary);
    cursor: pointer;
    box-sizing: border-box;
  }
  .detail-sheet__action--danger {
    color: var(--color-feedback-wrong);
  }
  .detail-sheet__cancel {
    display: block;
    width: 100%;
    text-align: center;
    background: none;
    border: none;
    padding: 12px;
    margin-top: 4px;
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 14px;
    color: var(--color-text-muted);
    cursor: pointer;
  }
  /* Same shape/classes as Overview's inline add/link panel — kept visually
     identical on purpose (see Overview.svelte's own note on this). */
  .search-panel {
    margin-top: 10px;
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
  /* The edge-case "create without a project" option — deliberately quieter
     than the search results above it, so it reads as the fallback it is. */
  .search-panel__bare-task {
    display: block;
    width: 100%;
    text-align: center;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--color-border);
    background: none;
    border-left: none;
    border-right: none;
    border-bottom: none;
    cursor: pointer;
    font-family: var(--font-family-base);
    font-size: 13px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-muted);
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
    background: var(--color-bg-page);
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
</style>
