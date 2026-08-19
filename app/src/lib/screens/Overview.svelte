<script lang="ts">
  import { planner } from '../store.svelte';
  import IconButton from '../components/IconButton.svelte';
  import Button from '../components/Button.svelte';
  import Input from '../components/Input.svelte';

  interface DayRow {
    label: string;
    hoursLabel: string;
    barWidth: string;
    barColor: string;
    textColor: string;
  }

  const overviewDays = $derived<DayRow[]>(
    planner.workloadDays.map((d) => {
      const ratio = d.capacity > 0 ? d.planned / d.capacity : 0;
      const over = ratio >= 1;
      return {
        label: d.label,
        hoursLabel: `${d.planned}/${d.capacity}h`,
        barWidth: Math.min(100, ratio * 100) + '%',
        barColor: over ? 'var(--color-feedback-wrong)' : 'var(--color-feedback-correct)',
        textColor: over ? 'var(--color-feedback-wrong)' : 'var(--color-text-muted)',
      };
    }),
  );

  interface SearchResult {
    label: string;
    typeLabel: string;
    onSelect: () => void;
  }

  const query = $derived(planner.searchQuery.trim().toLowerCase());

  function resultsFor(eventId: string, mode: 'add' | 'link' | null): SearchResult[] {
    if (mode === 'add') {
      return [
        ...planner.projects
          .filter((p) => !query || p.name.toLowerCase().includes(query))
          .map((p) => ({
            label: p.name,
            typeLabel: 'Project',
            onSelect: () => planner.addEventAsTaskWithProject(eventId, p.gid, p.name),
          })),
        ...planner.tasks
          .filter((t) => !query || t.name.toLowerCase().includes(query))
          .map((t) => ({ label: t.name, typeLabel: 'Subtask of', onSelect: () => planner.addEventAsSubtask(eventId, t.id) })),
      ];
    } else if (mode === 'link') {
      return planner.tasks
        .filter((t) => !query || t.name.toLowerCase().includes(query))
        .map((t) => ({ label: t.name, typeLabel: 'Task', onSelect: () => planner.linkEventToTask(eventId, t.id) }));
    }
    return [];
  }
</script>

<div class="screen">
  <div class="header">
    <div class="title">Overview</div>
    <IconButton icon="close" title="Close" size={36} iconSize={18} onclick={() => planner.closeOverview()} />
  </div>

  <div class="content">
    <div class="section-label">Workload by day</div>
    {#each overviewDays as d, i}
      <button class="day-row" onclick={() => planner.focusQueueForDay(planner.workloadDays[i])}>
        <div class="day-row__top">
          <div class="day-row__label">{d.label}</div>
          <div class="day-row__hours" style="color:{d.textColor};">{d.hoursLabel}</div>
        </div>
        <div class="day-row__track">
          <div class="day-row__fill" style="width:{d.barWidth}; background:{d.barColor};"></div>
        </div>
      </button>
    {/each}

    <div class="section-label" style="margin-top:22px;">From your calendar</div>
    {#each planner.events as e (e.id)}
      {@const panelOpen = planner.activePanelEventId === e.id}
      {@const mode = panelOpen ? planner.activePanelMode : null}
      {@const statusLabel = e.linked ? `${e.timeLabel} · linked to "${e.linkedName}"` : e.timeLabel}
      <div class="event-row">
        <div class="event-row__top">
          <div class="event-row__text">
            <div class="event-row__title">{e.title}</div>
            <div class="event-row__status">{statusLabel}</div>
          </div>
          {#if !e.linked}
            <div class="event-row__actions">
              <Button variant="ghost" size="sm" onclick={() => planner.openLinkPanel(e.id)}>Link to task</Button>
              <Button variant="secondary" size="sm" onclick={() => planner.openAddPanel(e.id)}>Add as task</Button>
            </div>
          {/if}
        </div>
        {#if panelOpen}
          <div class="search-panel">
            <div class="search-panel__top">
              <div class="search-panel__title">{mode === 'add' ? 'Add to project or subtask' : 'Link to a task'}</div>
              <button class="search-panel__cancel" onclick={() => planner.closeSearchPanel()}>Cancel</button>
            </div>
            <Input placeholder="Search projects or tasks…" value={planner.searchQuery} onchange={(v) => planner.onSearchChange(v)} />
            <div class="search-results">
              {#each resultsFor(e.id, mode) as r}
                <button class="search-result" onclick={r.onSelect}>
                  <div class="search-result__label">{r.label}</div>
                  <div class="search-result__type">{r.typeLabel}</div>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/each}
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
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px 8px;
    flex-shrink: 0;
  }
  .title {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-extrabold);
    font-size: 22px;
    color: var(--color-text-primary);
  }
  .content {
    padding: 8px 20px;
    flex: 1;
    overflow-y: auto;
  }
  .section-label {
    font-family: var(--font-family-base);
    font-size: 13px;
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
    margin: 10px 0 8px;
  }
  .day-row {
    display: block;
    width: 100%;
    padding: 10px 0;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: inherit;
    -webkit-tap-highlight-color: transparent;
  }
  .day-row:active {
    opacity: 0.6;
  }
  .day-row__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .day-row__label {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 15px;
    color: var(--color-text-primary);
  }
  .day-row__hours {
    font-family: var(--font-family-base);
    font-size: 13px;
    font-weight: var(--font-weight-bold);
  }
  .day-row__track {
    height: 8px;
    border-radius: 999px;
    background: var(--color-border);
    overflow: hidden;
  }
  .day-row__fill {
    height: 100%;
    border-radius: 999px;
  }
  .event-row {
    padding: 10px 0;
    border-bottom: 1px solid var(--color-border);
  }
  .event-row__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .event-row__text {
    min-width: 0;
  }
  .event-row__title {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 15px;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .event-row__status {
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--color-text-muted);
  }
  .event-row__actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
  .search-panel {
    margin-top: 10px;
    background: var(--color-bg-page);
    border-radius: var(--radius-md);
    padding: 10px;
  }
  .search-panel__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .search-panel__title {
    font-family: var(--font-family-base);
    font-size: 11px;
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }
  .search-panel__cancel {
    font-family: var(--font-family-base);
    font-size: 11px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-muted);
    cursor: pointer;
    background: none;
    border: none;
    padding: 0;
  }
  .search-results {
    max-height: 160px;
    overflow-y: auto;
    margin-top: 8px;
  }
  .search-result {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 6px;
    cursor: pointer;
    border-radius: var(--radius-sm);
    width: 100%;
    background: none;
    border: none;
    text-align: left;
  }
  .search-result:hover {
    background: var(--color-bg-page);
  }
  .search-result__label {
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .search-result__type {
    font-family: var(--font-family-base);
    font-size: 11px;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }
</style>
