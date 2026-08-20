<script lang="ts">
  import { planner } from '../store.svelte';
</script>

{#if planner.updateAvailableCommit}
  <div class="update-notice">
    <div class="update-notice__msg">A new version is available.</div>
    <div class="update-notice__actions">
      <button class="update-notice__later" onclick={() => planner.dismissUpdateNotice()}>Later</button>
      <button class="update-notice__reload" onclick={() => planner.reloadForUpdate()}>Reload</button>
    </div>
  </div>
{/if}

<style>
  .update-notice {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: 16px;
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
  .update-notice__msg {
    font-size: 13px;
    font-weight: var(--font-weight-bold);
    text-align: left;
  }
  .update-notice__actions {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .update-notice__later {
    background: none;
    border: none;
    padding: 4px 0;
    font-family: var(--font-family-base);
    font-size: 13px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-inverse);
    opacity: 0.75;
    cursor: pointer;
  }
  .update-notice__reload {
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
