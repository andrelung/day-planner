<script lang="ts">
  import { planner } from '../store.svelte';
  import Icon from '../components/Icon.svelte';
  import Button from '../components/Button.svelte';
  import IconButton from '../components/IconButton.svelte';

  const weeks = $derived(planner.calendarWeeks);
  const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function fullnessClass(ratio: number): string {
    if (ratio >= 1) return 'cell__dot--full';
    if (ratio > 0) return 'cell__dot--partial';
    return '';
  }
  // `dateStr` is already a resolved "YYYY-MM-DD" (see planner.calendarWeeks)
  // — pure calendar-date formatting, so this anchors to UTC rather than
  // re-parsing through the device's local timezone (which a bare
  // `T00:00` local-time string would do), matching app/src/lib/tz.ts's own
  // reasoning for keeping calendar-date arithmetic timezone-independent.
  function formatCellLabel(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
</script>

<div class="screen">
  <div class="close-wrap">
    <button class="close-btn" title="Close" aria-label="Close" onclick={() => planner.closeFlow()}>
      <Icon name="close" size={18} color="var(--color-text-inverse)" />
    </button>
  </div>
  <div class="heading-wrap">
    <div class="heading">Pick a date</div>
    <div class="subtitle">{planner.planTargetLabel}</div>
  </div>

  <div class="content">
    <div class="month-nav">
      <IconButton
        icon="chevron-left"
        title="Previous month"
        size={32}
        iconSize={16}
        color="var(--color-text-inverse)"
        borderColor="rgba(255,255,255,0.3)"
        onclick={() => planner.calendarPrevMonth()}
      />
      <div class="month-label">{planner.calendarMonthLabel}</div>
      <IconButton
        icon="chevron-right"
        title="Next month"
        size={32}
        iconSize={16}
        color="var(--color-text-inverse)"
        borderColor="rgba(255,255,255,0.3)"
        onclick={() => planner.calendarNextMonth()}
      />
    </div>

    <div class="weekday-row">
      {#each weekdayLabels as w}
        <div class="weekday-label">{w}</div>
      {/each}
    </div>

    {#each weeks as week}
      <div class="week-row">
        {#each week as cell}
          <button
            class="cell"
            class:cell--out={!cell.inMonth}
            class:cell--today={cell.isToday}
            class:cell--past={cell.isPast && !cell.isToday}
            onclick={() => planner.selectSpecificDay(cell.date, formatCellLabel(cell.date))}
          >
            <span class="cell__day">{cell.day}</span>
            <span class="cell__dot {fullnessClass(cell.ratio)}"></span>
          </button>
        {/each}
      </div>
    {/each}

    <div class="legend">
      <span class="legend__item"><span class="cell__dot"></span> Open</span>
      <span class="legend__item"><span class="cell__dot cell__dot--partial"></span> Partly planned</span>
      <span class="legend__item"><span class="cell__dot cell__dot--full"></span> Full</span>
    </div>
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
    padding: 12px 20px 0;
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
    padding: 12px 16px 0;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .month-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .month-label {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 15px;
    color: var(--color-text-inverse);
  }
  .weekday-row {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    margin-bottom: 4px;
  }
  .weekday-label {
    text-align: center;
    font-family: var(--font-family-base);
    font-size: 11px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-inverse);
    opacity: 0.6;
  }
  .week-row {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
  }
  .cell {
    aspect-ratio: 1;
    max-height: 44px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    background: none;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    padding: 0;
  }
  .cell__day {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 14px;
    color: var(--color-text-inverse);
  }
  .cell--out .cell__day {
    opacity: 0.3;
  }
  .cell--past .cell__day {
    opacity: 0.5;
  }
  .cell--today {
    background: rgba(255, 216, 10, 0.16);
  }
  .cell--today .cell__day {
    color: var(--grips-highlight-yellow);
  }
  .cell__dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: transparent;
  }
  .cell__dot--partial {
    background: var(--grips-highlight-yellow);
  }
  .cell__dot--full {
    background: var(--color-feedback-wrong);
  }
  .legend {
    display: flex;
    justify-content: center;
    gap: 16px;
    margin-top: 14px;
    font-family: var(--font-family-base);
    font-size: 11px;
    color: var(--color-text-inverse);
    opacity: 0.75;
  }
  .legend__item {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .footer {
    padding: 8px 20px 12px;
    display: flex;
    justify-content: flex-start;
    flex-shrink: 0;
  }
</style>
