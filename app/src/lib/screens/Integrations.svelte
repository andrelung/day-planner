<script lang="ts">
  import { planner } from '../store.svelte';
  import Icon from '../components/Icon.svelte';
  import Button from '../components/Button.svelte';
</script>

<div class="screen">
  <div class="back-wrap">
    <button class="back-btn" title="Back" aria-label="Back" onclick={() => planner.closeIntegrations()}>
      <Icon name="chevron-left" size={20} />
    </button>
  </div>
  <div class="content">
    <div class="heading">Connect Asana &amp; Outlook</div>
    <div class="subtitle">Manage tasks, meet deadlines, and access real-time updates to boost productivity.</div>

    <div class="account-row">
      <div class="avatar">A</div>
      <div class="account-info">
        <div class="account-name">Asana Account</div>
        <div class="account-desc">Connect your Asana account to sync tasks</div>
      </div>
      {#if planner.asanaConnected}
        <div class="connected">
          <div class="connected__label">Connected</div>
          {#if planner.primaryProvider === 'ASANA'}
            <div class="connected__primary">Primary</div>
          {/if}
        </div>
      {:else}
        <Button variant="secondary" size="sm" onclick={() => planner.connectAsana()}>Connect</Button>
      {/if}
    </div>

    <div class="account-row">
      <div class="avatar">O</div>
      <div class="account-info">
        <div class="account-name">Outlook Account</div>
        <div class="account-desc">Connect your Outlook calendar to sync free slots</div>
      </div>
      {#if planner.outlookConnected}
        <div class="connected">
          <div class="connected__label">Connected</div>
          {#if planner.primaryProvider === 'OUTLOOK'}
            <div class="connected__primary">Primary</div>
          {/if}
        </div>
      {:else}
        <Button variant="secondary" size="sm" onclick={() => planner.connectOutlook()}>Connect</Button>
      {/if}
    </div>
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
  .back-wrap {
    padding: 18px 20px 0;
    flex-shrink: 0;
  }
  .back-btn {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--color-text-primary);
    background: none;
    border: none;
  }
  .content {
    padding: 12px 20px;
    flex: 1;
    overflow-y: auto;
  }
  .heading {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-extrabold);
    font-size: 24px;
    line-height: 1.25;
    color: var(--color-text-primary);
    margin-bottom: 12px;
  }
  .subtitle {
    font-family: var(--font-family-base);
    font-size: 15px;
    color: var(--color-text-muted);
    margin-bottom: 24px;
  }
  .account-row {
    display: flex;
    align-items: center;
    gap: 14px;
    background: var(--color-bg-page);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 14px;
    margin-bottom: 12px;
  }
  .avatar {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-md);
    background: var(--color-border);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-extrabold);
    font-size: 16px;
    color: var(--color-text-primary);
  }
  .account-info {
    flex: 1;
    min-width: 0;
  }
  .account-name {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 15px;
    color: var(--color-text-primary);
  }
  .account-desc {
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--color-text-muted);
  }
  .connected {
    text-align: right;
    flex-shrink: 0;
  }
  .connected__label {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 13px;
    color: var(--color-text-muted);
  }
  .connected__primary {
    font-family: var(--font-family-base);
    font-size: 11px;
    font-weight: var(--font-weight-bold);
    color: var(--color-feedback-correct);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
</style>
