<script lang="ts">
  import { planner } from '../store.svelte';
  import Icon from '../components/Icon.svelte';
  import IconButton from '../components/IconButton.svelte';
  import Button from '../components/Button.svelte';

  const pending = $derived(planner.pendingEventLink);
</script>

<div class="screen">
  <div class="close-wrap">
    <IconButton icon="close" title="Close" size={36} iconSize={18} onclick={() => planner.resolveEventLinkChooseDifferent()} />
  </div>
  {#if pending}
    <div class="content">
      <Icon name="warning-triangle" size={32} color="var(--color-feedback-wrong)" />
      <div class="heading">Already linked to another event</div>
      <div class="detail">
        "{pending.taskName}" is already linked to "{pending.conflictingEventTitle}". Linking it here too means one task stands in for both.
      </div>
      <div class="actions">
        <Button variant="primary" size="md" fullWidth onclick={() => planner.resolveEventLinkChooseDifferent()}>Choose a different task</Button>
        <Button variant="ghost" size="md" fullWidth onclick={() => planner.resolveEventLinkAnyway()}>Link anyway</Button>
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
