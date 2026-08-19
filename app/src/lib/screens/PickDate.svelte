<script lang="ts">
  import { planner } from '../store.svelte';
  import Icon from '../components/Icon.svelte';
  import Button from '../components/Button.svelte';
  import Input from '../components/Input.svelte';
</script>

<div class="screen">
  <div class="close-wrap">
    <button class="close-btn" title="Close" aria-label="Close" onclick={() => planner.closeFlow()}>
      <Icon name="close" size={18} color="var(--color-text-inverse)" />
    </button>
  </div>
  <div class="heading-wrap">
    <div class="heading">Pick a date</div>
  </div>
  <div class="content">
    <div class="date-card">
      <Input type="date" value={planner.customDateValue} onchange={(v) => planner.onCustomDateChange(v)} />
    </div>
    <Button
      variant="primary"
      size="md"
      fullWidth
      disabled={!planner.customDateValue}
      onclick={() => planner.continuePickDate()}
    >
      Continue
    </Button>
  </div>
  <div class="footer">
    <Button variant="secondary" size="md" invertedBorder onclick={() => planner.backToPlanLater()}>back</Button>
  </div>
</div>

<style>
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--color-bg-inverse);
    overflow: hidden;
  }
  .close-wrap {
    display: flex;
    justify-content: flex-end;
    padding: 18px 20px 0;
    flex-shrink: 0;
  }
  .close-btn {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-md);
    border: 1px solid rgba(255, 255, 255, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    background: none;
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
    color: var(--color-text-inverse);
  }
  .content {
    padding: 28px 24px 0;
    flex: 1;
    min-height: 0;
  }
  .date-card {
    background: var(--color-bg-surface);
    border-radius: var(--radius-md);
    padding: 16px;
    margin-bottom: 14px;
  }
  .footer {
    padding: 14px 20px;
    display: flex;
    justify-content: flex-start;
    flex-shrink: 0;
  }
</style>
