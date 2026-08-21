<script lang="ts">
  import { planner } from '../store.svelte';
  import IconButton from '../components/IconButton.svelte';
  import DayCalendar from '../components/DayCalendar.svelte';
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
  <div class="content">
    {#if planner.calendarViewLoading}
      <div class="loading">
        <div class="loading__spinner"></div>
      </div>
    {:else}
      <!-- excludeTaskId="" matches nothing — every task on this day should
           show, since there's no task being placed here to exclude. -->
      <DayCalendar date={planner.calendarViewDate} excludeTaskId="" outlookEvents={planner.calendarViewOutlookEvents} allowPlacement={false} fullDay />
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
    padding: 16px 20px;
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
