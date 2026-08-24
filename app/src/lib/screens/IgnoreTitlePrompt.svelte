<script lang="ts">
  import { planner } from '../store.svelte';
  import Icon from '../components/Icon.svelte';
  import IconButton from '../components/IconButton.svelte';
  import Button from '../components/Button.svelte';

  const pending = $derived(planner.pendingIgnoreTitlePrompt);
</script>

<div class="screen">
  <div class="close-wrap">
    <IconButton icon="close" title="Close" size={36} iconSize={18} onclick={() => planner.resolveIgnoreTitlePromptDecideLater()} />
  </div>
  {#if pending}
    <div class="content">
      <Icon name="info" size={32} color="var(--color-brand-primary)" />
      <div class="heading">Ignore this every time?</div>
      <div class="detail">
        Events with the title "{pending.title}" have been marked ignored by you {pending.count} times. Do you want to automatically ignore events with
        that title?
      </div>
      <div class="actions">
        <Button variant="ghost" size="md" fullWidth onclick={() => planner.resolveIgnoreTitlePromptDecline()}>Do not automatically ignore</Button>
        <Button variant="secondary" size="md" fullWidth onclick={() => planner.resolveIgnoreTitlePromptDecideLater()}>Decide later</Button>
        <Button variant="primary" size="md" fullWidth onclick={() => planner.resolveIgnoreTitlePromptAlways()}>Ignore always</Button>
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
