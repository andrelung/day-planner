<script lang="ts">
  import { planner } from '../store.svelte';
  import Icon from '../components/Icon.svelte';
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
    <div class="label">How long do you need?</div>
    <div class="stepper-row">
      <button class="stepper-btn" title="Decrease" onclick={() => planner.decDuration()}>
        <Icon name="minus" size={18} color="var(--grips-dark-blue)" />
      </button>
      <input
        class="duration-input"
        type="number"
        value={String(planner.breakDuration)}
        oninput={(e) => planner.onBreakDurationInput((e.target as HTMLInputElement).value)}
      />
      <div class="unit">h</div>
      <button class="stepper-btn" title="Increase" onclick={() => planner.incDuration()}>
        <Icon name="plus" size={18} color="var(--grips-dark-blue)" />
      </button>
    </div>
    <div class="continue-wrap">
      <button class="continue-btn" title="Continue" onclick={() => planner.continueBreakDuration()}>
        <Icon name="arrow-right" size={22} color="var(--grips-dark-blue)" />
      </button>
    </div>
  </div>
  <div class="footer">
    <Button variant="secondary" size="md" invertedBorder onclick={() => planner.backToBreakTime()}>back</Button>
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
    margin-bottom: 20px;
  }
  .stepper-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
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
  }
  .duration-input {
    width: 72px;
    height: 44px;
    text-align: center;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    font-family: var(--font-family-base);
    font-size: 16px;
    color: var(--color-text-primary);
    outline: none;
  }
  .unit {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 18px;
    color: var(--color-text-primary);
  }
  .continue-wrap {
    display: flex;
    justify-content: center;
    margin-top: 26px;
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
