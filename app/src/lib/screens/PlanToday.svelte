<script lang="ts">
  import { planner } from '../store.svelte';
  import Icon from '../components/Icon.svelte';
  import Button from '../components/Button.svelte';
  import DayCalendar from '../components/DayCalendar.svelte';

  const todayDate = $derived(planner.workloadDays.find((d) => d.key === 'today')?.date ?? null);
</script>

<div class="screen">
  <div class="close-wrap">
    <button class="close-btn" title="Close" aria-label="Close" onclick={() => planner.closeFlow()}>
      <Icon name="close" size={18} color="var(--grips-dark-blue)" />
    </button>
  </div>
  <div class="heading-wrap">
    <div class="heading">Free slots today</div>
    <div class="subtitle">{planner.planTargetLabel}</div>
  </div>

  <div class="content">
    {#if planner.todaySlotsLoading}
      <div class="slots-loading">
        <div class="slots-loading__spinner"></div>
        <p>Loading free slots…</p>
      </div>
    {:else if todayDate && planner.focusTaskRaw}
      <DayCalendar
        date={todayDate}
        excludeTaskId={planner.focusTaskRaw.id}
        outlookEvents={planner.todayOutlookEvents}
        suggestedStartTime={planner.earliestTodaySlotStart}
        onPickTime={(hhmm) => planner.tryPlanTodaySlot(hhmm)}
      />
    {/if}
  </div>

  <div class="footer">
    <Button variant="secondary" size="md" invertedBorder onclick={() => planner.closeFlow()}>back</Button>
  </div>
</div>

<style>
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--grips-highlight-yellow);
    overflow: hidden;
  }
  .close-wrap {
    display: flex;
    justify-content: flex-end;
    padding: 18px 20px 0;
    flex-shrink: 0;
  }
  .close-btn {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-md);
    border: 1px solid rgba(22, 32, 60, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--grips-dark-blue);
    background: none;
  }
  .heading-wrap {
    padding: 4px 24px 0;
    text-align: center;
    flex-shrink: 0;
  }
  .heading {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-extrabold);
    font-size: 22px;
    color: var(--grips-dark-blue);
  }
  .subtitle {
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--grips-dark-blue);
    opacity: 0.7;
    margin-top: 6px;
  }
  .content {
    padding: 20px 20px 0;
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .footer {
    padding: 14px 20px 34px;
    display: flex;
    justify-content: flex-start;
    flex-shrink: 0;
  }
  .slots-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 40px 0;
    font-family: var(--font-family-base);
    font-size: 13px;
    font-weight: var(--font-weight-bold);
    color: var(--grips-dark-blue);
    opacity: 0.7;
  }
  .slots-loading__spinner {
    width: 28px;
    height: 28px;
    border: 3px solid rgba(22, 32, 60, 0.15);
    border-top-color: var(--grips-dark-blue);
    border-radius: 50%;
    animation: slots-loading-spin 0.8s linear infinite;
  }
  @keyframes slots-loading-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
