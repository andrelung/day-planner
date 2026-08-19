<script lang="ts">
  import { planner } from '../store.svelte';
  import IconButton from '../components/IconButton.svelte';
  import Input from '../components/Input.svelte';

  // Intl.supportedValuesOf isn't in every older browser (Safari added it in
  // 15.4) — fall back to just the current value plus UTC so the picker still
  // works, it just won't offer the full list.
  const timezones: string[] =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [planner.timezone, 'UTC'];
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
      <div class="row__label">Asana &amp; Outlook</div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        ><polyline points="9 18 15 12 9 6"></polyline></svg
      >
    </button>
    <button
      class="row"
      onclick={() => {
        if (confirm("Remove today's due times from all of today's tasks? They'll go back to unplanned.")) planner.resetToday();
      }}
    >
      <div class="row__label row__label--danger">Reset today's plan</div>
    </button>
    <div class="more-to-come">More to come</div>
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
    padding: 12px 20px;
    flex: 1;
    min-width: 0;
    overflow-y: auto;
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
  .more-to-come {
    font-family: var(--font-family-base);
    font-size: 13px;
    font-style: italic;
    color: var(--color-text-muted);
    padding-top: 8px;
    border-top: 1px solid var(--color-border);
  }
</style>
