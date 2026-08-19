<script lang="ts">
  import { planner } from '../store.svelte';
  import Icon from '../components/Icon.svelte';
  import IconButton from '../components/IconButton.svelte';
  import Button from '../components/Button.svelte';

  const dayFullKey = $derived(planner.pendingPlan ? (planner.pendingPlan.type === 'today' ? 'today' : planner.pendingPlan.key) : null);
  const dayFullDay = $derived(dayFullKey ? planner.workloadDays.find((d) => d.key === dayFullKey) : null);
  const dayFullLabel = $derived(dayFullDay?.label ?? '');
  const dayFullDetail = $derived(dayFullDay ? `${dayFullDay.planned}/${dayFullDay.capacity}h already planned` : '');
</script>

<div class="screen">
  <div class="close-wrap">
    <IconButton icon="close" title="Close" size={36} iconSize={18} onclick={() => planner.closeFlow()} />
  </div>
  <div class="content">
    <Icon name="warning-triangle" size={32} color="var(--color-feedback-wrong)" />
    <div class="heading">{dayFullLabel} already looks full</div>
    <div class="detail">{dayFullDetail}</div>
    <div class="actions">
      <Button variant="primary" size="md" fullWidth onclick={() => planner.onPlanAnyway()}>Plan for this day anyway</Button>
      <Button variant="ghost" size="md" fullWidth onclick={() => planner.onReviewOtherTasks()}>Review other tasks on this day</Button>
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
    padding: 20px 28px 0;
    flex: 1;
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
    margin-top: 26px;
  }
</style>
