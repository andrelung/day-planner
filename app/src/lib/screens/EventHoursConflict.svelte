<script lang="ts">
  import { planner } from '../store.svelte';
  import { fmtHours } from '../format';
  import Icon from '../components/Icon.svelte';
  import IconButton from '../components/IconButton.svelte';
  import Button from '../components/Button.svelte';

  const pending = $derived(planner.pendingHoursConflict);
</script>

<div class="screen">
  <div class="close-wrap">
    <IconButton icon="close" title="Close" size={36} iconSize={18} onclick={() => planner.resolveHoursConflictSkip()} />
  </div>
  {#if pending}
    <div class="content">
      <Icon name="warning-triangle" size={32} color="var(--color-feedback-wrong)" />
      <div class="heading">Estimates don't match</div>
      <div class="detail">
        "{pending.taskName}" is estimated at {fmtHours(pending.taskHours)}, but "{pending.eventTitle}" runs {fmtHours(pending.eventHours)}. What should
        the task's estimate be?
      </div>
      <div class="actions">
        <Button variant="ghost" size="md" fullWidth onclick={() => planner.resolveHoursConflictSkip()}>Skip</Button>
        <Button variant="secondary" size="md" fullWidth onclick={() => planner.resolveHoursConflictKeep()}>
          Keep {fmtHours(pending.taskHours)} from the task
        </Button>
        <Button variant="primary" size="md" fullWidth onclick={() => planner.resolveHoursConflictUpdate()}>
          Update to {fmtHours(pending.eventHours)} from the calendar
        </Button>
      </div>
    </div>
  {/if}
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
    margin-top: 22px;
  }
</style>
