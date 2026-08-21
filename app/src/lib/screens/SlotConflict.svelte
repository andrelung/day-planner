<script lang="ts">
  import { planner } from '../store.svelte';
  import { fmtHours } from '../format';
  import Icon from '../components/Icon.svelte';
  import IconButton from '../components/IconButton.svelte';
  import Button from '../components/Button.svelte';

  const conflictSlotLabel = $derived(planner.pendingSlotPlan ? planner.pendingSlotPlan.slot : '');
</script>

<div class="screen">
  <div class="close-wrap">
    <IconButton icon="close" title="Close" size={36} iconSize={18} onclick={() => planner.closeFlow()} />
  </div>
  <div class="content">
    <Icon name="warning-triangle" size={32} color="var(--color-feedback-wrong)" />
    <div class="heading">{conflictSlotLabel} is already booked</div>
    <div class="detail">This time slot conflicts with:</div>
    <div class="conflict-list">
      {#each planner.conflictItems as c}
        <div class="conflict-item">
          <div class="conflict-item__name">{c.name}</div>
          <div class="conflict-item__hours">{fmtHours(c.hours)}</div>
        </div>
      {/each}
    </div>
    <div class="actions">
      <Button variant="ghost" size="md" fullWidth onclick={() => planner.resolveConflictChooseAnother()}>Choose another time</Button>
      <Button variant="primary" size="md" fullWidth onclick={() => planner.resolveConflictAnyway()}>Double-book anyway</Button>
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
  .conflict-list {
    margin-top: 14px;
  }
  .conflict-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0;
    border-bottom: 1px solid var(--color-border);
  }
  .conflict-item__name {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 13px;
    color: var(--color-text-primary);
  }
  .conflict-item__hours {
    font-family: var(--font-family-base);
    font-size: 11px;
    color: var(--color-text-muted);
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 22px;
  }
</style>
