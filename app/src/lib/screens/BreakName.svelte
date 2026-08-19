<script lang="ts">
  import { planner } from '../store.svelte';
  import Icon from '../components/Icon.svelte';
  import IconButton from '../components/IconButton.svelte';
  import Button from '../components/Button.svelte';
  import Input from '../components/Input.svelte';

  const continueOpacity = $derived(planner.breakNameDraft.trim() ? 1 : 0.4);
</script>

<div class="screen">
  <div class="close-wrap">
    <IconButton icon="close" title="Close" size={36} iconSize={18} onclick={() => planner.closeFlow()} />
  </div>
  <div class="heading-wrap">
    <div class="heading">Do a part today</div>
  </div>
  <div class="content">
    <div class="label">Name the part</div>
    <Input placeholder="e.g. Draft outline" value={planner.breakNameDraft} onchange={(v) => planner.onBreakNameChange(v)} />
    <div class="continue-wrap">
      <button class="continue-btn" style="opacity:{continueOpacity};" title="Continue" onclick={() => planner.continueBreakName()}>
        <Icon name="arrow-right" size={22} color="var(--grips-dark-blue)" />
      </button>
    </div>
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
    background: var(--color-bg-surface);
    overflow: hidden;
  }
  .close-wrap {
    display: flex;
    justify-content: flex-end;
    padding: 18px 20px 0;
    flex-shrink: 0;
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
    color: var(--color-text-primary);
  }
  .content {
    padding: 32px 28px 0;
    flex: 1;
    min-height: 0;
  }
  .label {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 15px;
    color: var(--color-text-primary);
    text-align: center;
    margin-bottom: 18px;
  }
  .continue-wrap {
    display: flex;
    justify-content: center;
    margin-top: 22px;
  }
  .continue-btn {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-md);
    background: var(--grips-highlight-yellow);
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .footer {
    background: var(--color-bg-inverse);
    padding: 14px 20px;
    flex-shrink: 0;
  }
</style>
