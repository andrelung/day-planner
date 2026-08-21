<script lang="ts">
  import { onMount } from 'svelte';
  import { planner } from '../store.svelte';
  import IconButton from '../components/IconButton.svelte';
  import Input from '../components/Input.svelte';
  import { DEV_NOTES, VERSION_LABEL } from '../version';

  // Intl.supportedValuesOf isn't in every older browser (Safari added it in
  // 15.4) — fall back to just the current value plus UTC so the picker still
  // works, it just won't offer the full list.
  const timezones: string[] =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [planner.timezone, 'UTC'];

  // So the "Pending & Failed Actions" row's badge count is current the
  // moment Settings opens, not just after the user has already drilled in.
  onMount(() => {
    void planner.refreshPendingActions();
  });
</script>

<div class="screen">
  <div class="header">
    <div class="title">Settings</div>
    <IconButton icon="close" title="Close" size={36} iconSize={18} onclick={() => planner.closeSettings()} />
  </div>
  <div class="content">
    <Input type="time" label="Preferred starting time" value={planner.prefStartTime} onchange={(v) => planner.onPrefStartChange(v)} />
    <Input type="time" label="Preferred end of workday" value={planner.prefEndTime} onchange={(v) => planner.onPrefEndChange(v)} />
    <Input
      type="number"
      label="Buffer between tasks (minutes)"
      value={String(planner.bufferMinutes)}
      onchange={(v) => planner.onBufferChange(v)}
    />
    <label class="row">
      <div class="row__label">Warn, when a day seems fully booked</div>
      <input
        type="checkbox"
        class="toggle"
        checked={!planner.skipDayFullWarning}
        onchange={(e) => planner.onSkipDayFullWarningChange(!(e.target as HTMLInputElement).checked)}
      />
    </label>
    <label class="row">
      <div class="row__label">Warn, when a timeslot is double booked</div>
      <input
        type="checkbox"
        class="toggle"
        checked={planner.confirmDoubleBooking}
        onchange={(e) => planner.onConfirmDoubleBookingChange((e.target as HTMLInputElement).checked)}
      />
    </label>
    <label class="ds-select">
      <span class="ds-select__label">Timezone</span>
      <div class="ds-select__field">
        <select value={planner.timezone} onchange={(e) => planner.onTimezoneChange((e.target as HTMLSelectElement).value)}>
          {#each timezones as tz (tz)}
            <option value={tz}>{tz}</option>
          {/each}
        </select>
      </div>
    </label>
    <button class="row" onclick={() => planner.openIntegrations()}>
      <div class="row__label">Connections (Tasks &amp; Calendar)</div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        ><polyline points="9 18 15 12 9 6"></polyline></svg
      >
    </button>
    <button class="row" onclick={() => planner.openPendingActions()}>
      <div class="row__label">Pending &amp; Failed Actions</div>
      <div class="row__right">
        {#if planner.pendingActions.length > 0}
          <span class="row__badge">{planner.pendingActions.length}</span>
        {/if}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          ><polyline points="9 18 15 12 9 6"></polyline></svg
        >
      </div>
    </button>
    <button
      class="row"
      onclick={() => {
        if (confirm("Remove today's due times from all of today's tasks? They'll go back to unplanned.")) planner.resetToday();
      }}
    >
      <div class="row__label row__label--danger">Reset today's plan</div>
    </button>
    <button class="row" onclick={() => planner.toggleBugReportOpen()}>
      <div class="row__label">Report a bug</div>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-text-muted)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        style="transform:rotate({planner.bugReportOpen ? 90 : 0}deg); transition:transform 150ms ease-out;"
        ><polyline points="9 18 15 12 9 6"></polyline></svg
      >
    </button>
    {#if planner.bugReportOpen}
      <div class="bug-report">
        <textarea
          class="bug-report__input"
          placeholder="What went wrong, what do you want changed?"
          bind:value={planner.bugReportDraft}
          disabled={planner.bugReportSubmitting}
        ></textarea>
        <div class="bug-report__hint">Files an Asana task assigned to you, so it doesn't get lost.</div>
        <button
          class="bug-report__submit"
          disabled={!planner.bugReportDraft.trim() || planner.bugReportSubmitting}
          onclick={() => planner.submitBugReport()}
        >
          {planner.bugReportSubmitting ? 'Filing…' : 'Submit'}
        </button>
      </div>
    {/if}
    <div class="version">{VERSION_LABEL} {#if DEV_NOTES.length > 0}· currently in development:{/if}</div>
    {#if DEV_NOTES.length > 0}
      <div class="dev-notes">
        {#each DEV_NOTES as note (note)}
          <div class="dev-notes__item">
            <span class="dev-notes__bullet">•</span>
            <span>{note}</span>
          </div>
        {/each}
      </div>
    {/if}
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
    /* Bottom padding matches the loading screen's own "add distance to the
       bottom, it looks cramped" fix — the version/dev-notes block is the
       last thing in this scrollable list too, and was sitting flush
       against the safe-area edge the same way. */
    padding: 12px 20px calc(20px + env(safe-area-inset-bottom, 0px));
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .ds-select {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: var(--font-family-base);
    width: 100%;
  }
  .ds-select__label {
    font-size: 14px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-primary);
  }
  .ds-select__field {
    position: relative;
    height: 44px;
    width: 100%;
  }
  .ds-select select {
    /* Anchored the same way as Input.svelte's input (see its comment). */
    position: absolute;
    inset: 0;
    padding: 0 14px;
    font-family: var(--font-family-base);
    font-size: 16px;
    color: var(--color-text-primary);
    background: var(--true-white);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }
  .ds-select select:focus {
    border-color: var(--color-brand-primary);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 4px;
    border-top: 1px solid var(--color-border);
    cursor: pointer;
    background: none;
    border-left: none;
    border-right: none;
    border-bottom: none;
    width: 100%;
    text-align: left;
  }
  .row__label {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 15px;
    color: var(--color-text-primary);
  }
  .row__label--danger {
    color: var(--color-feedback-wrong);
  }
  .row__right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row__badge {
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--color-feedback-wrong);
    color: var(--color-text-inverse);
    font-family: var(--font-family-base);
    font-size: 12px;
    font-weight: var(--font-weight-bold);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .toggle {
    width: 20px;
    height: 20px;
    accent-color: var(--color-brand-primary);
    flex-shrink: 0;
  }
  .bug-report {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 4px 14px;
  }
  .bug-report__input {
    width: 100%;
    min-height: 84px;
    padding: 10px 12px;
    font-family: var(--font-family-base);
    font-size: 14px;
    color: var(--color-text-primary);
    background: var(--true-white);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    outline: none;
    resize: vertical;
    box-sizing: border-box;
  }
  .bug-report__input:focus {
    border-color: var(--color-brand-primary);
  }
  .bug-report__hint {
    font-family: var(--font-family-base);
    font-size: 12px;
    color: var(--color-text-muted);
  }
  .bug-report__submit {
    align-self: flex-start;
    padding: 8px 18px;
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 14px;
    color: var(--color-text-inverse);
    background: var(--color-brand-primary);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
  }
  .bug-report__submit:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .version {
    font-family: var(--font-family-base);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-muted);
    opacity: 0.6;
    text-align: center;
  }
  .dev-notes {
    width: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-family: var(--font-family-base);
    font-size: 11px;
    color: var(--color-text-muted);
    opacity: 0.6;
    margin-top: -12px;
  }
  /* A real flex column for the bullet — see App.svelte's identical
     loading-screen version for why this replaced text-indent/::before:
     that measured the hanging indent against a bullet glyph of unknown
     rendered width, so a wrapped line never quite lined up under the
     first line's actual text. */
  .dev-notes__item {
    display: flex;
    gap: 4px;
    text-align: left;
    line-height: 1.3;
  }
  .dev-notes__bullet {
    flex-shrink: 0;
  }
</style>
