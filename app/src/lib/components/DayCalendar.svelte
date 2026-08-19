<script lang="ts">
  import { planner } from '../store.svelte';
  import type { Task } from '../types';

  interface Props {
    /// "YYYY-MM-DD" — the day being planned.
    date: string;
    /// The task currently being planned — excluded from the calendar's own
    /// blocks (it's not "placed" yet, that's what this view is for).
    excludeTaskId: string;
    /// Fires once the user confirms a tentative placement (see the pending
    /// block below) — not on the first tap.
    onPickTime: (hhmm: string) => void;
  }
  let { date, excludeTaskId, onPickTime }: Props = $props();

  const PX_PER_MIN = 1.4;
  const SNAP_MIN = 15;
  const MIN_BLOCK_HEIGHT = 30;

  function toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }
  function toHHMM(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  const startMin = $derived(toMinutes(planner.prefStartTime));
  const endMin = $derived(toMinutes(planner.prefEndTime));
  const totalHeight = $derived(Math.max(1, endMin - startMin) * PX_PER_MIN);

  const otherTasks = $derived(planner.tasks.filter((t) => t.dueOn === date && t.dueAt && t.dueHour && t.id !== excludeTaskId));

  interface Block {
    task: Task;
    top: number;
    height: number;
  }
  const blocks = $derived<Block[]>(
    otherTasks.map((t) => ({
      task: t,
      top: Math.max(0, (toMinutes(t.dueHour!) - startMin) * PX_PER_MIN),
      height: Math.max(MIN_BLOCK_HEIGHT, t.hours * 60 * PX_PER_MIN),
    })),
  );

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

  // --- tentative placement for the task being planned: first tap sets this
  // (without committing anything), then the user can drag it to adjust or
  // tap Confirm/Remove. ---
  let pendingMin: number | null = $state(null);
  const focusHours = $derived(planner.focusTaskRaw?.hours ?? 1);
  const pendingHeight = $derived(Math.max(MIN_BLOCK_HEIGHT, focusHours * 60 * PX_PER_MIN));
  const pendingTop = $derived(pendingMin === null ? 0 : Math.max(0, (pendingMin - startMin) * PX_PER_MIN));
  const pendingHHMM = $derived(pendingMin === null ? '' : toHHMM(pendingMin));

  // --- drag-to-move, shared by already-placed tasks and the pending block ---
  type DragTarget = { kind: 'other'; taskId: string } | { kind: 'pending' };
  let dragTarget: DragTarget | null = $state(null);
  let dragTop = $state(0);
  let dragStartY = 0;
  let dragOrigTop = 0;

  function beginDrag(e: PointerEvent, target: DragTarget, origTop: number) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragTarget = target;
    dragStartY = e.clientY;
    dragOrigTop = origTop;
    dragTop = origTop;
  }
  function onDragMove(e: PointerEvent) {
    if (!dragTarget) return;
    const next = dragOrigTop + (e.clientY - dragStartY);
    dragTop = Math.max(0, Math.min(next, totalHeight - MIN_BLOCK_HEIGHT));
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
    if (dragTarget) return;
    const y = e.clientY - trackEl.getBoundingClientRect().top;
    pendingMin = clampMin(snap(startMin + y / PX_PER_MIN));
  }
  function confirmPending() {
    if (pendingMin === null) return;
    onPickTime(toHHMM(pendingMin));
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
    {#each blocks as b (b.task.id)}
      <div
        class="task-block"
        class:task-block--dragging={dragTarget?.kind === 'other' && dragTarget.taskId === b.task.id}
        style="top:{dragTarget?.kind === 'other' && dragTarget.taskId === b.task.id ? dragTop : b.top}px; height:{b.height}px;"
        onpointerdown={(e) => beginDrag(e, { kind: 'other', taskId: b.task.id }, b.top)}
        onpointermove={onDragMove}
        onpointerup={endDrag}
        onpointercancel={endDrag}
        onclick={(e) => e.stopPropagation()}
      >
        <div class="task-block__text">
          <div class="task-block__name">{b.task.name}</div>
          <div class="task-block__time">{b.task.dueHour}</div>
        </div>
        <button
          class="task-block__reset"
          title="Clear due time"
          aria-label="Clear due time"
          onclick={(e) => {
            e.stopPropagation();
            planner.clearOtherTaskDueDate(b.task.id);
          }}
        >
          ×
        </button>
      </div>
    {/each}
    {#if pendingMin !== null}
      <div
        class="pending-block"
        class:pending-block--dragging={dragTarget?.kind === 'pending'}
        style="top:{dragTarget?.kind === 'pending' ? dragTop : pendingTop}px; height:{pendingHeight}px;"
        onpointerdown={(e) => beginDrag(e, { kind: 'pending' }, pendingTop)}
        onpointermove={onDragMove}
        onpointerup={endDrag}
        onpointercancel={endDrag}
        onclick={(e) => e.stopPropagation()}
      >
        <div class="pending-block__text">
          <div class="pending-block__name">{planner.focusTaskRaw?.name ?? ''}</div>
          <div class="pending-block__time">{pendingHHMM}</div>
        </div>
        <div class="pending-block__actions">
          <button
            class="pending-block__btn pending-block__btn--confirm"
            title="Confirm"
            aria-label="Confirm"
            onclick={(e) => {
              e.stopPropagation();
              confirmPending();
            }}
          >
            ✓
          </button>
          <button
            class="pending-block__btn pending-block__btn--remove"
            title="Remove"
            aria-label="Remove"
            onclick={(e) => {
              e.stopPropagation();
              removePending();
            }}
          >
            ×
          </button>
        </div>
      </div>
    {/if}
  </div>
  <div class="hint">
    {#if pendingMin !== null}
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
    margin-left: 44px;
    border-left: 1px solid var(--color-border);
  }
  .hour-line {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px solid var(--color-border);
  }
  .hour-label {
    position: absolute;
    left: -44px;
    top: -7px;
    width: 38px;
    text-align: right;
    font-family: var(--font-family-base);
    font-size: 11px;
    color: var(--color-text-muted);
  }
  .task-block {
    position: absolute;
    left: 6px;
    right: 6px;
    background: var(--color-bg-page);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    padding: 4px 8px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    cursor: grab;
    touch-action: none;
    overflow: hidden;
  }
  .task-block--dragging {
    cursor: grabbing;
    box-shadow: var(--shadow-overlay-sm);
    z-index: 5;
    border-color: var(--color-brand-primary);
  }
  .task-block__text {
    min-width: 0;
  }
  .task-block__name {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 12px;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .task-block__time {
    font-family: var(--font-family-base);
    font-size: 11px;
    color: var(--color-text-muted);
  }
  .task-block__reset {
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
    padding: 4px 8px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    cursor: grab;
    touch-action: none;
    overflow: hidden;
    z-index: 4;
  }
  .pending-block--dragging {
    cursor: grabbing;
    box-shadow: var(--shadow-overlay-sm);
    z-index: 6;
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
    gap: 4px;
  }
  .pending-block__btn {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: none;
    font-size: 12px;
    line-height: 1;
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
