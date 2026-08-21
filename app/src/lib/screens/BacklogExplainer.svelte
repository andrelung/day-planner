<script lang="ts">
  import { planner } from '../store.svelte';
  import Icon from '../components/Icon.svelte';
  import IconButton from '../components/IconButton.svelte';
  import Button from '../components/Button.svelte';

  const taskName = $derived(planner.focusTaskRaw?.name ?? 'this task');
</script>

<div class="screen">
  <div class="close-wrap">
    <IconButton icon="close" title="Close" size={36} iconSize={18} onclick={() => planner.closeFlow()} />
  </div>
  <div class="content">
    <div class="content__top">
      <Icon name="info" size={32} color="var(--color-brand-primary)" />
      <div class="heading">Moving to the backlog</div>
      <div class="detail">
        This clears the due date on "{taskName}" entirely — it won't show up in Triage again until you give it a new date or
        time. You can find it anytime from Overview → Tasks without Due Date.
      </div>
    </div>
    <div class="actions">
      <Button variant="ghost" size="md" fullWidth onclick={() => planner.closeFlow()}>Cancel</Button>
      <Button variant="primary" size="md" fullWidth onclick={() => planner.confirmBacklogExplainer()}>Move to backlog</Button>
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
</style>
