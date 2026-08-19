<script lang="ts">
  import { planner } from '../store.svelte';
</script>

{#if planner.toastMsg}
  <div class="toast">{planner.toastMsg}</div>
{/if}

<style>
  .toast {
    position: absolute;
    left: 16px;
    right: 16px;
    top: 16px;
    background: var(--grips-dark-blue);
    color: var(--color-text-inverse);
    border-radius: var(--radius-md);
    padding: 12px 16px;
    font-family: var(--font-family-base);
    font-size: 13px;
    font-weight: var(--font-weight-bold);
    text-align: center;
    box-shadow: var(--shadow-overlay);
    z-index: 50;
  }
</style>
