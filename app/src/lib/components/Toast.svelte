<script lang="ts">
  import { planner } from '../store.svelte';
</script>

{#if planner.toastMsg}
  <div class="toast">
    <div class="toast__msg">
      {planner.toastMsg}
      {#if planner.toastRetry}
        <div class="toast__countdown">Retrying in {planner.toastRetry.secondsLeft}s…</div>
      {/if}
    </div>
    {#if planner.toastRetry}
      <div class="toast__actions">
        <button class="toast__action" onclick={() => planner.abortRetry()}>Abort</button>
        <button class="toast__action" onclick={() => planner.retryNow()}>Retry now</button>
      </div>
    {:else if planner.toastAction?.href}
      <a class="toast__action" href={planner.toastAction.href} target="_blank" rel="noopener noreferrer" onclick={() => planner.dismissToast()}>
        {planner.toastAction.label}
      </a>
    {:else if planner.toastAction}
      <button
        class="toast__action"
        onclick={() => {
          planner.toastAction?.onClick?.();
          planner.dismissToast();
        }}
      >
        {planner.toastAction.label}
      </button>
    {/if}
  </div>
{/if}

<style>
  .toast {
    position: absolute;
    left: 16px;
    right: 16px;
    top: 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    background: var(--grips-dark-blue);
    color: var(--color-text-inverse);
    /* Both this and UpdateNotice are dark-on-dark against the same
       top-of-screen slot — when one lands right as the other's still
       showing, the border is what actually reads as "two separate things"
       instead of one bleeding into the other at the edges (see
       UpdateNotice.svelte's own top-offset for how they avoid fully
       overlapping in the first place). */
    border: 1.5px solid rgba(255, 255, 255, 0.7);
    border-radius: var(--radius-md);
    padding: 12px 16px;
    font-family: var(--font-family-base);
    box-shadow: var(--shadow-overlay);
    z-index: 50;
  }
  .toast__msg {
    font-size: 13px;
    font-weight: var(--font-weight-bold);
    text-align: left;
  }
  .toast__action {
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 4px 0;
    font-family: var(--font-family-base);
    font-size: 13px;
    font-weight: var(--font-weight-extrabold);
    color: var(--grips-highlight-yellow);
    text-decoration: underline;
    cursor: pointer;
  }
  .toast__countdown {
    margin-top: 2px;
    font-size: 12px;
    font-weight: var(--font-weight-normal);
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
  }
  .toast__actions {
    display: flex;
    flex-shrink: 0;
    gap: 12px;
  }
</style>
