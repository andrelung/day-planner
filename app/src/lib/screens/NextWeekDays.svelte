<script lang="ts">
  import { planner } from '../store.svelte';
  import Icon from '../components/Icon.svelte';
  import Button from '../components/Button.svelte';
  import Badge from '../components/Badge.svelte';

  const nextWeekDays = $derived(planner.nextWeekDays);
</script>

<div class="screen">
  <div class="close-wrap">
    <button class="close-btn" title="Close" aria-label="Close" onclick={() => planner.closeFlow()}>
      <Icon name="close" size={18} color="var(--color-text-inverse)" />
    </button>
  </div>
  <div class="heading-wrap">
    <div class="heading">Next week</div>
    <div class="subtitle">{planner.planTargetLabel}</div>
  </div>

  <div class="content">
    {#each nextWeekDays as d}
      <button class="day-row" onclick={() => planner.selectSpecificDay(d.date, d.label)}>
        <div class="day-row__label">{d.label}</div>
        <div class="day-row__trailing">
          <Badge tone={d.tone}>{d.badgeLabel}</Badge>
          <Icon name="arrow-right" size={16} color="var(--color-text-muted)" />
        </div>
      </button>
    {/each}
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
  .subtitle {
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--color-text-inverse);
    opacity: 0.85;
    margin-top: 6px;
  }
  .content {
    padding: 20px 20px 0;
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .day-row {
    width: 100%;
    background: var(--color-bg-surface);
    border: none;
    border-radius: var(--radius-md);
    padding: 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    cursor: pointer;
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 15px;
    color: var(--color-text-primary);
  }
  .day-row__trailing {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .footer {
    background: var(--color-bg-inverse);
    padding: 14px 20px 24px;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    flex-shrink: 0;
  }
</style>
