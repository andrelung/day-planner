<script lang="ts">
  import { planner } from '../store.svelte';
  import Icon from '../components/Icon.svelte';
  import Button from '../components/Button.svelte';
  import Badge from '../components/Badge.svelte';

  const laterDays = $derived(planner.laterDays);
  const weekDeferOptions = $derived(planner.weekDeferOptions);
</script>

<div class="screen">
  <div class="close-wrap">
    <button class="close-btn" title="Close" aria-label="Close" onclick={() => planner.closeFlow()}>
      <Icon name="close" size={18} color="var(--color-text-inverse)" />
    </button>
  </div>
  <div class="heading-wrap">
    <div class="heading">When later?</div>
    <div class="subtitle">{planner.planTargetLabel}</div>
  </div>

  <div class="content">
    {#each laterDays as d}
      <button class="day-row" onclick={() => (d.key === 'nextweek' ? planner.openNextWeekDays() : planner.selectLaterDay(d.key))}>
        <div class="day-row__label">{d.label}</div>
        <Badge tone={d.tone}>{d.badgeLabel}</Badge>
      </button>
    {/each}
    {#each weekDeferOptions as w}
      <button class="day-row" onclick={() => planner.deferToWeek(w.key)}>
        <div class="day-row__label">{w.label}</div>
        <div class="day-row__trailing">
          <Badge tone={w.tone}>{w.badgeLabel}</Badge>
          <Icon name="arrow-right" size={16} color="var(--color-text-muted)" />
        </div>
      </button>
    {/each}
    <button class="day-row day-row--center" onclick={() => planner.openPickDate()}>Pick a date</button>
  </div>

  <div class="footer">
    <Button variant="secondary" size="md" invertedBorder onclick={() => planner.closeFlow()}>back</Button>
    <Button variant="secondary" size="md" invertedBorder onclick={() => planner.removeDueDateFromPlanFlow()}>Remove due date</Button>
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
    padding: 10px 20px 0;
    flex-shrink: 0;
  }
  .close-btn {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    border: 1px solid rgba(255, 255, 255, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    background: none;
  }
  .heading-wrap {
    padding: 0 24px 0;
    text-align: center;
    flex-shrink: 0;
  }
  .heading {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-extrabold);
    font-size: 19px;
    color: var(--color-text-inverse);
  }
  .subtitle {
    font-family: var(--font-family-base);
    font-size: 12px;
    color: var(--color-text-inverse);
    opacity: 0.85;
    margin-top: 3px;
  }
  .content {
    padding: 10px 20px 0;
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .day-row {
    width: 100%;
    background: var(--color-bg-surface);
    border: none;
    border-radius: var(--radius-md);
    padding: 11px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
    cursor: pointer;
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 14px;
    color: var(--color-text-primary);
  }
  .day-row--center {
    justify-content: center;
    text-align: center;
  }
  .day-row__trailing {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .footer {
    background: var(--color-bg-inverse);
    padding: 8px 20px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
</style>
