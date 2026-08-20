<script lang="ts">
  import { planner } from '../store.svelte';
  import Button from './Button.svelte';
  import IconButton from './IconButton.svelte';
</script>

{#if planner.showInstallBanner}
  <div class="install-banner">
    <div class="install-banner__text">
      {#if planner.installBannerKind === 'ios'}
        <div class="install-banner__title">Add to Home Screen</div>
        <div class="install-banner__sub">Tap the Share icon, then "Add to Home Screen"</div>
      {:else}
        <div class="install-banner__title">Install Day Planner</div>
        <div class="install-banner__sub">Add it to your home screen for quick access</div>
      {/if}
    </div>
    {#if planner.installBannerKind === 'android'}
      <Button variant="primary" size="sm" onclick={() => planner.promptInstall()}>Install</Button>
    {/if}
    <IconButton
      icon="close"
      title="Dismiss"
      size={28}
      iconSize={14}
      color="var(--color-text-inverse)"
      borderColor="transparent"
      onclick={() => planner.dismissInstallBanner()}
    />
  </div>
{/if}

<style>
  .install-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 8px 20px 0;
    padding: 10px 12px;
    background: var(--color-bg-inverse);
    border-radius: var(--radius-md);
    flex-shrink: 0;
  }
  .install-banner__text {
    flex: 1;
    min-width: 0;
  }
  .install-banner__title {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 13px;
    color: var(--color-text-inverse);
  }
  .install-banner__sub {
    font-family: var(--font-family-base);
    font-size: 11px;
    color: var(--color-text-inverse);
    opacity: 0.75;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
