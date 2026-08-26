<script lang="ts">
  import { planner } from '../store.svelte';
  import IconButton from '../components/IconButton.svelte';
  import DayCalendar from '../components/DayCalendar.svelte';

  // A swipe left/right steps the day, same as the chevron buttons — touch
  // events rather than pointer events specifically, since DayCalendar's own
  // task-block dragging uses pointer capture (see beginDrag there); touch
  // listeners fire independently alongside that without fighting over the
  // same event stream, and since this never calls preventDefault it can't
  // interfere with the block drag or the page's own vertical scroll either.
  const SWIPE_THRESHOLD_PX = 90;
  // A swipe is rarely perfectly horizontal — allow some vertical drift, but
  // require horizontal to still clearly dominate, so an intentional vertical
  // scroll (or a block drag) doesn't get misread as a day change.
  const SWIPE_MAX_OFF_AXIS_RATIO = 0.5;
  let touchStartX = 0;
  let touchStartY = 0;
  // A swipe starting on an existing block should move/expand that block,
  // not change the day — skip day-swipe tracking entirely for those.
  let touchStartOnBlock = false;
  // Whether DayCalendar currently has a block drag in progress — reported
  // live via ondragstatechange, not just inferred from where the touch
  // started (touchStartOnBlock alone let a drag that was still active by
  // touchend slip through and change the day out from under it, which is
  // what made this feel "too sensitive" mid-drag).
  let dragInProgress = false;
  function onDragStateChange(dragging: boolean) {
    dragInProgress = dragging;
  }
  function onContentTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    const target = e.target as HTMLElement;
    touchStartOnBlock = !!target.closest('.task-block, .outlook-block, .pending-block');
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }
  function onContentTouchEnd(e: TouchEvent) {
    if (touchStartOnBlock || dragInProgress) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
    if (Math.abs(dy) > Math.abs(dx) * SWIPE_MAX_OFF_AXIS_RATIO) return;
    planner.calendarViewStepDay(dx < 0 ? 1 : -1);
  }
</script>

<div class="screen">
  <div class="header">
    <IconButton icon="close" title="Close" size={36} iconSize={18} onclick={() => planner.closeCalendarView()} />
    <div class="nav">
      <IconButton icon="chevron-left" title="Previous day" size={32} iconSize={16} onclick={() => planner.calendarViewStepDay(-1)} />
      <div class="day-label">{planner.calendarViewDayLabel}</div>
      <IconButton icon="chevron-right" title="Next day" size={32} iconSize={16} onclick={() => planner.calendarViewStepDay(1)} />
    </div>
    <div class="header-spacer"></div>
  </div>
  <div class="content" ontouchstart={onContentTouchStart} ontouchend={onContentTouchEnd}>
    {#if planner.calendarViewLoading}
      <div class="loading">
        <div class="loading__spinner"></div>
      </div>
    {:else}
      <!-- excludeTaskId="" matches nothing — every task on this day should
           show, since there's no task being placed here to exclude. -->
      <DayCalendar
        date={planner.calendarViewDate}
        excludeTaskId=""
        outlookEvents={planner.calendarViewOutlookEvents}
        completedTasks={planner.calendarViewCompletedTasks}
        allowPlacement={false}
        fullDay
        ondragstatechange={onDragStateChange}
      />
    {/if}
  </div>
</div>

<style>
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--color-bg-page);
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px 4px;
    flex-shrink: 0;
  }
  .header-spacer {
    width: 36px;
    flex-shrink: 0;
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .day-label {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 16px;
    color: var(--color-text-primary);
    min-width: 92px;
    text-align: center;
  }
  .content {
    /* Kept modest — DayCalendar's own card already adds its own 10px
       padding (see .calendar in DayCalendar.svelte), so anything more here
       just stacks a second layer of padding on top of that, eating into
       space the actual day-grid could use for its columns. */
    padding: 16px 8px;
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 60px 0;
  }
  .loading__spinner {
    width: 28px;
    height: 28px;
    border: 3px solid var(--color-border);
    border-top-color: var(--color-brand-primary);
    border-radius: 50%;
    animation: loading-spin 0.8s linear infinite;
  }
  @keyframes loading-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
