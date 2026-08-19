<script lang="ts">
  import { planner } from '../store.svelte';
  import IconButton from '../components/IconButton.svelte';
  import Input from '../components/Input.svelte';

  interface DayRow {
    label: string;
    hoursLabel: string;
    barWidth: string;
    barColor: string;
    textColor: string;
    active: boolean;
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
        active: d.date === planner.activeDayDateStr,
      };
    }),
  );

  interface SearchResult {
    label: string;
    typeLabel: string;
    onSelect: () => void;
  }

  const query = $derived(planner.searchQuery.trim().toLowerCase());

  // Autocomplete: an empty query browses a short default list (most
  // recently-touched first, since project/task order is otherwise
  // arbitrary) rather than the entire — possibly huge — project/task list;
  // typing narrows it, and the matched substring is highlighted below.
  const RESULT_LIMIT = 8;

  function matchSplit(label: string): { pre: string; match: string; post: string } | null {
    if (!query) return null;
    const idx = label.toLowerCase().indexOf(query);
    if (idx === -1) return null;
    return { pre: label.slice(0, idx), match: label.slice(idx, idx + query.length), post: label.slice(idx + query.length) };
  }

  /// Asana's typeahead is the primary source (see planner.runTypeahead) —
  /// this only falls back to filtering the client's already-loaded
  /// projects/tasks if that failed (e.g. the connected account predates
  /// the workspaces.typeahead:read scope and hasn't been reconnected yet),
  /// so search still works either way.
  function resultsFor(eventId: string, mode: 'add' | 'link' | null): SearchResult[] {
    if (!mode) return [];
    if (planner.typeaheadOk) {
      if (mode === 'add') {
        return planner.typeaheadResults
          .map((r) =>
            r.resourceType === 'project'
              ? { label: r.name, typeLabel: 'Project', onSelect: () => planner.addEventAsTaskWithProject(eventId, r.gid, r.name) }
              : { label: r.name, typeLabel: 'Subtask of', onSelect: () => planner.addEventAsSubtask(eventId, r.gid) },
          )
          .slice(0, RESULT_LIMIT);
      }
      return planner.typeaheadResults
        .filter((r) => r.resourceType === 'task')
        .slice(0, RESULT_LIMIT)
        .map((r) => ({ label: r.name, typeLabel: 'Task', onSelect: () => planner.linkEventToTask(eventId, r.gid) }));
    }
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
      ].slice(0, RESULT_LIMIT);
    }
    return planner.tasks
      .filter((t) => !query || t.name.toLowerCase().includes(query))
      .slice(0, RESULT_LIMIT)
      .map((t) => ({ label: t.name, typeLabel: 'Task', onSelect: () => planner.linkEventToTask(eventId, t.id) }));
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
      <button class="day-row" class:day-row--active={d.active} onclick={() => planner.focusQueueForDay(planner.workloadDays[i])}>
        <div class="day-row__top">
          <div class="day-row__label">{d.label}</div>
          <div class="day-row__hours" style="color:{d.textColor};">{d.hoursLabel}</div>
        </div>
        <div class="day-row__track">
          <div class="day-row__fill" style="width:{d.barWidth}; background:{d.barColor};"></div>
        </div>
      </button>
    {/each}

    {#if planner.tasksWithoutDueDate.length > 0}
      <button class="day-row" onclick={() => planner.reviewBacklog()}>
        <div class="day-row__top">
          <div class="day-row__label">Tasks without Due Date</div>
          <div class="day-row__hours" style="color:var(--color-text-muted);">{planner.tasksWithoutDueDate.length}</div>
        </div>
      </button>
    {/if}

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
              <IconButton icon="plus" title="Add as task" size={32} iconSize={16} onclick={() => planner.openAddPanel(e.id)} />
              <IconButton icon="chevron-right" title="More actions" size={32} iconSize={16} onclick={() => planner.openEventPopup(e.id)} />
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
                {@const m = matchSplit(r.label)}
                <button class="search-result" onclick={r.onSelect}>
                  <div class="search-result__label">
                    {#if m}{m.pre}<mark>{m.match}</mark>{m.post}{:else}{r.label}{/if}
                  </div>
                  <div class="search-result__type">{r.typeLabel}</div>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  {#if planner.activeEventPopupId}
    {@const popupEvent = planner.events.find((e) => e.id === planner.activeEventPopupId)}
    {#if popupEvent}
      <div class="popup-backdrop" onclick={() => planner.closeEventPopup()}>
        <div class="popup" onclick={(e) => e.stopPropagation()}>
          <div class="popup__title">{popupEvent.title}</div>
          <div class="popup__subtitle">{popupEvent.timeLabel}</div>
          <button
            class="popup__action"
            onclick={() => {
              const id = popupEvent.id;
              planner.closeEventPopup();
              planner.openLinkPanel(id);
            }}
          >
            Link to task
          </button>
          <button class="popup__action popup__action--danger" onclick={() => planner.ignoreEvent(popupEvent.id)}> Ignore this event </button>
          <button class="popup__cancel" onclick={() => planner.closeEventPopup()}>Cancel</button>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .screen {
    position: relative;
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
  .day-row--active .day-row__label {
    color: var(--color-brand-primary);
  }
  .day-row--active .day-row__label::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-brand-primary);
    margin-right: 7px;
    vertical-align: middle;
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
  .search-result__label mark {
    background: none;
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-bold);
  }
  .popup-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(22, 32, 60, 0.4);
    display: flex;
    align-items: flex-end;
    z-index: 70;
  }
  .popup {
    width: 100%;
    background: var(--color-bg-surface);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding: 20px 20px calc(20px + env(safe-area-inset-bottom, 0px));
  }
  .popup__title {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-extrabold);
    font-size: 17px;
    color: var(--color-text-primary);
  }
  .popup__subtitle {
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--color-text-muted);
    margin-top: 4px;
    margin-bottom: 16px;
  }
  .popup__action {
    display: block;
    width: 100%;
    text-align: left;
    background: var(--color-bg-page);
    border: none;
    border-radius: var(--radius-md);
    padding: 14px 16px;
    margin-bottom: 8px;
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 15px;
    color: var(--color-text-primary);
    cursor: pointer;
  }
  .popup__action--danger {
    color: var(--color-feedback-wrong);
  }
  .popup__cancel {
    display: block;
    width: 100%;
    text-align: center;
    background: none;
    border: none;
    padding: 12px;
    margin-top: 4px;
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 14px;
    color: var(--color-text-muted);
    cursor: pointer;
  }
</style>
