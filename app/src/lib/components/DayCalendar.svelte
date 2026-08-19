<script lang="ts">
  import { planner } from '../store.svelte';
  import type { Task } from '../types';

  interface Props {
    /// "YYYY-MM-DD" — the day being planned.
    date: string;
    /// The task currently being planned — excluded from the calendar's own
    /// blocks (it's not "placed" yet, that's what this view is for).
    excludeTaskId: string;
    /// Tap an open spot on the timeline to plan the current task there.
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

  // --- drag-to-move an already-placed task ---
  let dragTaskId: string | null = $state(null);
  let dragTop = $state(0);
  let dragStartY = 0;
  let dragOrigTop = 0;

  function beginDrag(e: PointerEvent, block: Block) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragTaskId = block.task.id;
    dragStartY = e.clientY;
    dragOrigTop = block.top;
    dragTop = block.top;
  }
  function onDragMove(e: PointerEvent) {
    if (!dragTaskId) return;
    const next = dragOrigTop + (e.clientY - dragStartY);
    dragTop = Math.max(0, Math.min(next, totalHeight - MIN_BLOCK_HEIGHT));
  }
  async function endDrag() {
    if (!dragTaskId) return;
    const taskId = dragTaskId;
    const draggedFrom = dragOrigTop;
    dragTaskId = null;
    // A tap that never really moved shouldn't count as a "move" attempt.
    if (Math.abs(dragTop - draggedFrom) < SNAP_MIN * PX_PER_MIN * 0.5) return;
    const hhmm = toHHMM(clampMin(snap(startMin + dragTop / PX_PER_MIN)));
    await planner.moveOtherTask(taskId, date, hhmm);
  }

  function onTrackClick(e: MouseEvent, trackEl: HTMLElement) {
    if (dragTaskId) return;
    const y = e.clientY - trackEl.getBoundingClientRect().top;
    onPickTime(toHHMM(clampMin(snap(startMin + y / PX_PER_MIN))));
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
        class:task-block--dragging={dragTaskId === b.task.id}
        style="top:{dragTaskId === b.task.id ? dragTop : b.top}px; height:{b.height}px;"
        onpointerdown={(e) => beginDrag(e, b)}
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
  </div>
  <div class="hint">Tap an open time to plan here · drag a task to move it</div>
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
</style>
