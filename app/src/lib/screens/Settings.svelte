<script lang="ts">
  import { planner } from '../store.svelte';
  import IconButton from '../components/IconButton.svelte';
  import Input from '../components/Input.svelte';
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
    <button class="row" onclick={() => planner.openIntegrations()}>
      <div class="row__label">Asana &amp; Outlook</div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        ><polyline points="9 18 15 12 9 6"></polyline></svg
      >
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
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
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
  .more-to-come {
    font-family: var(--font-family-base);
    font-size: 13px;
    font-style: italic;
    color: var(--color-text-muted);
    padding-top: 8px;
    border-top: 1px solid var(--color-border);
  }
</style>
