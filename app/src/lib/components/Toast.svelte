<script lang="ts">
  import { planner } from '../store.svelte';
</script>

{#if planner.toastMsg}
  <div class="toast">
    <div class="toast__msg">{planner.toastMsg}</div>
    {#if planner.toastAction?.href}
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
</style>
