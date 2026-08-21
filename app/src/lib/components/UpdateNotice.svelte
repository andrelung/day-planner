<script lang="ts">
  import { planner } from '../store.svelte';
</script>

{#if planner.updateAvailableBuildId}
  <div class="update-notice" class:update-notice--stacked={planner.toastMsg}>
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
    top: 16px;
    /* Both this and Toast otherwise land at the exact same top:16px slot —
       with equal z-index, whichever renders later in the DOM (this one)
       would completely hide an active Toast rather than merely overlap
       it, since there'd be nothing else visibly wrong to notice. Dropping
       below Toast's own approximate height when one is showing keeps both
       readable instead of one silently eating the other; not pixel-exact
       since Toast's height varies with its content (a retry countdown's
       two lines + two buttons vs. a plain one-line message), but close
       enough to never overlap either. */
    transition: top 150ms ease-out;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    background: var(--grips-dark-blue);
    color: var(--color-text-inverse);
    border: 1.5px solid rgba(255, 255, 255, 0.7);
    border-radius: var(--radius-md);
    padding: 12px 16px;
    font-family: var(--font-family-base);
    box-shadow: var(--shadow-overlay);
    z-index: 50;
  }
  .update-notice--stacked {
    top: 88px;
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
