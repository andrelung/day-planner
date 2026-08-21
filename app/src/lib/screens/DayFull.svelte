<script lang="ts">
  import { planner } from '../store.svelte';
  import Icon from '../components/Icon.svelte';
  import IconButton from '../components/IconButton.svelte';
  import Button from '../components/Button.svelte';

  const dayFullKey = $derived(planner.pendingPlan ? (planner.pendingPlan.type === 'today' ? 'today' : planner.pendingPlan.key) : null);
  const dayFullDay = $derived(dayFullKey ? planner.workloadDays.find((d) => d.key === dayFullKey) : null);
  const dayFullLabel = $derived(dayFullDay?.label ?? 'This day');
  const dayFullDetail = $derived(
    dayFullDay
      ? `You already allocated ${dayFullDay.planned}h of tasks. Your target is ${dayFullDay.capacity}h. What do you want to do?`
      : '',
  );
</script>

<div class="screen">
  <div class="close-wrap">
    <IconButton icon="close" title="Close" size={36} iconSize={18} onclick={() => planner.closeFlow()} />
  </div>
  <div class="content">
    <div class="content__top">
      <Icon name="warning-triangle" size={32} color="var(--color-feedback-wrong)" />
      <div class="heading">{dayFullLabel} already looks full</div>
      <div class="detail">{dayFullDetail}</div>
    </div>
    <!-- Anchored to the bottom of the screen (see .actions' margin-top:auto)
         rather than wherever the content above happens to end — same
         reasoning as SlotConflict.svelte's identical layout, which this
         screen was itself the model for; short detail text would otherwise
         strand these buttons high up, out of comfortable one-handed thumb
         reach. -->
    <div class="actions">
      <Button variant="ghost" size="md" fullWidth onclick={() => planner.onReviewOtherTasks()}>Review other tasks on this day</Button>
      <Button variant="primary" size="md" fullWidth onclick={() => planner.onPlanAnyway()}>Plan for this day anyway</Button>
    </div>
    <div class="dismiss-actions">
      <button class="dismiss-link" onclick={() => planner.dontAskDayFullToday()}>Don't warn me about {dayFullLabel} again</button>
      <button class="dismiss-link" onclick={() => planner.dontAskDayFullEver()}>Never warn me about a full day</button>
    </div>
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
  .close-wrap {
    display: flex;
    justify-content: flex-end;
    padding: 18px 20px 0;
    flex-shrink: 0;
  }
  .content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 20px 28px calc(20px + env(safe-area-inset-bottom, 0px));
    box-sizing: border-box;
  }
  .heading {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-extrabold);
    font-size: 22px;
    color: var(--color-text-primary);
    margin-top: 14px;
  }
  .detail {
    font-family: var(--font-family-base);
    font-size: 15px;
    color: var(--color-text-muted);
    margin-top: 8px;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex-shrink: 0;
    margin-top: auto;
    padding-top: 26px;
  }
  .dismiss-actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex-shrink: 0;
    margin-top: 22px;
    align-items: center;
  }
  .dismiss-link {
    background: none;
    border: none;
    padding: 4px;
    font-family: var(--font-family-base);
    font-size: 13px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-muted);
    text-decoration: underline;
    cursor: pointer;
  }
</style>
