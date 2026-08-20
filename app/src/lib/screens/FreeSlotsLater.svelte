<script lang="ts">
  import { planner } from '../store.svelte';
  import Icon from '../components/Icon.svelte';
  import Button from '../components/Button.svelte';
  import DayCalendar from '../components/DayCalendar.svelte';

  const slots = $derived(planner.laterSlots);

  // Same reasoning as PlanToday.svelte's fingerprint effect — re-fetch
  // whenever the chosen day's other tasks actually change, so an
  // already-offered slot can't go stale.
  function otherTasksFingerprint(): string {
    if (!planner.chosenDate || !planner.focusTaskRaw) return '';
    const excludeId = planner.focusTaskRaw.id;
    return planner.tasks
      .filter((t) => t.id !== excludeId && t.dueOn === planner.chosenDate && t.dueAt)
      .map((t) => `${t.id}:${t.dueAt}:${t.hours}`)
      .sort()
      .join('|');
  }
  let lastFingerprint = otherTasksFingerprint();
  $effect(() => {
    // See PlanToday.svelte's identical guard — re-fetching while the
    // calendar is open unmounts and remounts it (the loading branch below
    // replaces this whole area), which reset scroll position and looked
    // like the view reloaded whenever another task's time was cleared or
    // moved right there. DayCalendar reads planner.tasks directly, so it
    // doesn't need this fetch to stay correct while it's showing.
    if (planner.showCustomTimeLater) return;
    const fp = otherTasksFingerprint();
    if (fp !== lastFingerprint) {
      lastFingerprint = fp;
      if (planner.laterDayKey) void planner.loadLaterSlots(planner.laterDayKey);
    }
  });
</script>

<div class="screen">
  <div class="close-wrap">
    <button class="close-btn" title="Close" aria-label="Close" onclick={() => planner.closeFlow()}>
      <Icon name="close" size={18} color="var(--color-text-inverse)" />
    </button>
  </div>
  <div class="heading-wrap">
    <div class="heading">Free slots</div>
    <div class="subtitle">{planner.chosenDayLabel}</div>
  </div>
  <div class="content">
    {#if planner.laterSlotsLoading}
      <div class="slots-loading">
        <div class="slots-loading__spinner"></div>
        <p>Loading free slots…</p>
      </div>
    {:else}
      {#each slots as slot}
        <button class="slot" onclick={() => planner.tryPlanLaterSlot(slot)}>{slot}</button>
      {/each}

      {#if !planner.showCustomTimeLater}
        <button class="slot" onclick={() => planner.toggleCustomTimeLater()}>Pick a time</button>
      {:else if planner.chosenDate && planner.focusTaskRaw}
        <DayCalendar
          date={planner.chosenDate}
          excludeTaskId={planner.focusTaskRaw.id}
          outlookEvents={planner.laterOutlookEvents}
          onPickTime={(hhmm) => planner.tryPlanLaterSlot(hhmm)}
        />
      {/if}
    {/if}
  </div>
  <div class="footer">
    <Button variant="secondary" size="md" invertedBorder onclick={() => planner.backToPlanLater()}>back</Button>
  </div>
</div>

<style>
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--color-bg-inverse);
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
    border: 1px solid rgba(255, 255, 255, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
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
    color: var(--color-text-inverse);
  }
  .subtitle {
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--color-text-inverse);
    opacity: 0.85;
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
    color: var(--color-text-inverse);
    opacity: 0.75;
  }
  .slots-loading__spinner {
    width: 28px;
    height: 28px;
    border: 3px solid rgba(255, 255, 255, 0.25);
    border-top-color: var(--color-text-inverse);
    border-radius: 50%;
    animation: slots-loading-spin 0.8s linear infinite;
  }
  @keyframes slots-loading-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
