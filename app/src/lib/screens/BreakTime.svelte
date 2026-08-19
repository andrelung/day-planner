<script lang="ts">
  import { planner } from '../store.svelte';
  import IconButton from '../components/IconButton.svelte';
  import Button from '../components/Button.svelte';
</script>

<div class="screen">
  <div class="close-wrap">
    <IconButton icon="close" title="Close" size={36} iconSize={18} onclick={() => planner.closeFlow()} />
  </div>
  <div class="heading-wrap">
    <div class="heading">Do a part today</div>
  </div>
  <div class="content">
    <div class="label">When are you planning to do it?</div>
    {#each planner.breakTimeSlots as slot}
      <button class="slot" onclick={() => planner.tryBreakTime(slot)}>{slot}</button>
    {/each}
  </div>
  <div class="footer">
    <Button variant="secondary" size="md" invertedBorder onclick={() => planner.backToBreakName()}>back</Button>
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
    padding: 24px 20px 0;
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .label {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 15px;
    color: var(--color-text-primary);
    text-align: center;
    margin-bottom: 16px;
  }
  .slot {
    display: block;
    width: 100%;
    border: 1px solid var(--color-brand-primary);
    background: none;
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
    background: var(--color-bg-inverse);
    padding: 14px 20px;
    flex-shrink: 0;
  }
</style>
