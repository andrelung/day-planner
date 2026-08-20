<script lang="ts">
  import { planner } from '../store.svelte';
  import Icon from '../components/Icon.svelte';
  import Button from '../components/Button.svelte';
  import DayCalendar from '../components/DayCalendar.svelte';

  const todayDate = $derived(planner.workloadDays.find((d) => d.key === 'today')?.date ?? null);

  // The slots fetched via loadTodaySlots() are a snapshot — nothing else
  // invalidates it if the same-day task list changes afterward (e.g. more
  // tasks still arriving from the boot-time streaming fetch after this
  // screen was opened), so an already-offered slot could go stale and keep
  // being suggested even though it now overlaps a newly-known task. Re-fetch
  // whenever that same-day set actually changes; skip the very first run
  // since openPlanToday() already triggered the initial fetch.
  function otherTasksFingerprint(): string {
    if (!todayDate || !planner.focusTaskRaw) return '';
    const excludeId = planner.focusTaskRaw.id;
    return planner.tasks
      .filter((t) => t.id !== excludeId && t.dueOn === todayDate && t.dueAt)
      .map((t) => `${t.id}:${t.dueAt}:${t.hours}`)
      .sort()
      .join('|');
  }
  let lastFingerprint = otherTasksFingerprint();
  $effect(() => {
    // The re-fetch this drives replaces the whole slots/calendar area with
    // a loading spinner while it's in flight (see the template below),
    // which unmounts and remounts DayCalendar — fine when it's not on
    // screen, but while the user is actively on it (dragging, or clearing
    // another task's time right there) that reset the scroll position and
    // looked like the view had reloaded out from under them. The
    // DayCalendar itself needs no re-fetch to stay correct — it reads
    // planner.tasks directly — so there's nothing to catch up on until the
    // user goes back to the plain slot-button list.
    if (planner.showCustomTimeToday) return;
    const fp = otherTasksFingerprint();
    if (fp !== lastFingerprint) {
      lastFingerprint = fp;
      void planner.loadTodaySlots();
    }
  });
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
    {:else}
      {#each planner.planTodaySlots as slot}
        <button class="slot" onclick={() => planner.tryPlanTodaySlot(slot)}>{slot}</button>
      {/each}

      {#if !planner.showCustomTimeToday}
        <button class="slot" onclick={() => planner.toggleCustomTimeToday()}>Pick a time</button>
      {:else if todayDate && planner.focusTaskRaw}
        <DayCalendar
          date={todayDate}
          excludeTaskId={planner.focusTaskRaw.id}
          outlookEvents={planner.todayOutlookEvents}
          onPickTime={(hhmm) => planner.tryPlanTodaySlot(hhmm)}
        />
      {/if}
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
  .slot {
    display: block;
    width: 100%;
    background: var(--color-bg-surface);
    border: none;
    border-radius: var(--radius-md);
    padding: 16px;
    text-align: center;
    margin-bottom: 10px;
    cursor: pointer;
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 15px;
    color: var(--color-text-primary);
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
