<script lang="ts">
  import { planner } from '../store.svelte';
  import Icon from '../components/Icon.svelte';
  import Button from '../components/Button.svelte';

  function relativeTime(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.round(ms / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }
</script>

<div class="screen">
  <div class="back-wrap">
    <button class="back-btn" title="Back" aria-label="Back" onclick={() => planner.closePendingActions()}>
      <Icon name="chevron-left" size={20} />
    </button>
  </div>
  <div class="content">
    <div class="heading">Pending &amp; Failed Actions</div>
    <div class="subtitle">Due-time and estimate changes are applied in the background — this is what's still in flight or needs your attention.</div>

    {#if planner.pendingActions.length === 0}
      <div class="empty">Nothing pending — everything's synced to Asana.</div>
    {:else}
      {#each planner.pendingActions as a (a.id)}
        <div class="action-row">
          <div class="action-row__top">
            <div class="action-row__label">{a.label}</div>
            <div class="action-row__status" class:action-row__status--failed={a.status === 'failed'}>
              {a.status === 'failed' ? 'Failed' : 'Pending'}
            </div>
          </div>
          <div class="action-row__meta">
            Queued {relativeTime(a.createdAt)}{#if a.attempts > 0} · {a.attempts} attempt{a.attempts === 1 ? '' : 's'}{/if}
          </div>
          {#if a.status === 'failed'}
            {#if a.lastError}
              <div class="action-row__error">{a.lastError}</div>
            {/if}
            <div class="action-row__actions">
              <Button variant="secondary" size="sm" onclick={() => planner.retryPendingAction(a.id)}>Retry</Button>
              <Button variant="ghost" size="sm" onclick={() => planner.dismissPendingAction(a.id)}>Dismiss</Button>
            </div>
          {/if}
        </div>
      {/each}
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
  .back-wrap {
    padding: 18px 20px 0;
    flex-shrink: 0;
  }
  .back-btn {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    color: var(--color-text-primary);
  }
  .content {
    padding: 16px 20px 24px;
    flex: 1;
    overflow-y: auto;
  }
  .heading {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-extrabold);
    font-size: 20px;
    color: var(--color-text-primary);
    margin-bottom: 6px;
  }
  .subtitle {
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--color-text-muted);
    margin-bottom: 20px;
  }
  .empty {
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--color-text-muted);
    padding: 20px 0;
    text-align: center;
  }
  .action-row {
    padding: 12px 0;
    border-top: 1px solid var(--color-border);
  }
  .action-row__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .action-row__label {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 14px;
    color: var(--color-text-primary);
  }
  .action-row__status {
    flex-shrink: 0;
    font-family: var(--font-family-base);
    font-size: 12px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-muted);
  }
  .action-row__status--failed {
    color: var(--color-feedback-wrong);
  }
  .action-row__meta {
    font-family: var(--font-family-base);
    font-size: 12px;
    color: var(--color-text-muted);
    margin-top: 2px;
  }
  .action-row__error {
    font-family: var(--font-family-base);
    font-size: 12px;
    color: var(--color-feedback-wrong);
    margin-top: 6px;
  }
  .action-row__actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
</style>
