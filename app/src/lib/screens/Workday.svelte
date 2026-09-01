<script lang="ts">
  import { planner } from '../store.svelte';
  import Icon from '../components/Icon.svelte';
  import IconButton from '../components/IconButton.svelte';
  import Button from '../components/Button.svelte';

  const frames = $derived(planner.workdayFrames);
</script>

<div class="screen">
  <div class="top-bar">
    <IconButton icon="chevron-left" title="Back" size={36} iconSize={18} onclick={() => planner.onBackFromWorkday()} />
  </div>

  <div class="content">
    <div class="title">Tell me about your days</div>
    <div class="body">To help in visualization, please&nbsp;input the amount of time you want the tool to handle.&nbsp;</div>

    <div class="section-label">How long are your days?</div>
    <div class="stepper-row">
      <button class="stepper-btn" title="Fewer hours" aria-label="Fewer hours" onclick={() => planner.decWorkdayHours()}>
        <Icon name="minus" size={18} color="var(--grips-dark-blue)" />
      </button>
      <div class="stepper-value">{planner.workdayHours} hrs</div>
      <button class="stepper-btn" title="More hours" aria-label="More hours" onclick={() => planner.incWorkdayHours()}>
        <Icon name="plus" size={18} color="var(--grips-dark-blue)" />
      </button>
    </div>

    <div class="section-label">When do you start your day?</div>
    <div class="frame-list">
      {#each frames as f, i}
        <button class="frame-row" class:frame-row--selected={i === planner.workdayFrameIndex} onclick={() => planner.selectWorkdayFrame(i)}>
          {f.label}
        </button>
      {/each}
    </div>
    <div class="summary">{planner.workdaySummary}</div>
  </div>

  <div class="footer">
    <Button variant="primary" size="md" fullWidth onclick={() => planner.onConfirmWorkday()}>Confirm</Button>
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
  .top-bar {
    padding: 18px 20px 0;
    flex-shrink: 0;
  }
  .content {
    padding: 20px 24px 0;
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .title {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-extrabold);
    font-size: 24px;
    line-height: 1.25;
    color: var(--color-text-primary);
  }
  .body {
    font-family: var(--font-family-base);
    font-size: 15px;
    line-height: 1.5;
    color: var(--color-text-muted);
    margin-top: 10px;
    text-wrap: pretty;
  }
  .section-label {
    font-family: var(--font-family-base);
    font-size: 11px;
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
    margin: 28px 0 8px;
  }
  .stepper-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: var(--color-bg-page);
    border-radius: var(--radius-md);
    padding: 8px 10px;
  }
  .stepper-btn {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-md);
    background: var(--grips-highlight-yellow);
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
  }
  .stepper-btn:hover {
    background: var(--button-state-hover);
  }
  .stepper-value {
    font-family: var(--font-family-base);
    font-size: 18px;
    font-weight: var(--font-weight-extrabold);
    color: var(--color-text-primary);
  }
  .frame-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .frame-row {
    width: 100%;
    text-align: center;
    padding: 13px;
    border-radius: var(--radius-md);
    cursor: pointer;
    font-family: var(--font-family-base);
    font-size: 14px;
    font-weight: var(--font-weight-bold);
    background: var(--color-bg-surface);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    opacity: 0.85;
  }
  .frame-row--selected {
    background: var(--grips-dark-blue);
    border-color: var(--grips-dark-blue);
    color: var(--color-text-inverse);
    opacity: 1;
  }
  .summary {
    font-family: var(--font-family-base);
    font-size: 12px;
    color: var(--color-text-muted);
    margin-top: 12px;
  }
  .footer {
    padding: 14px 20px 24px;
    border-top: 1px solid var(--color-border);
    flex-shrink: 0;
  }
</style>
