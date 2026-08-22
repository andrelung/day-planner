<script lang="ts">
  import { planner } from '../store.svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';
</script>

{#if planner.showInstallBanner}
  <div class="install-banner">
    <div class="install-banner__text">
      {#if planner.installBannerKind === 'ios-safari'}
        <div class="install-banner__title">Add to Home Screen</div>
        <!-- The Share button sits in the bottom toolbar on iPhone and the
             top-right on iPad, so this names the icon rather than a
             position that would be wrong on half the devices. -->
        <div class="install-banner__sub">
          Tap <Icon name="share-ios" size={12} color="var(--color-text-inverse)" /> in the toolbar, then <strong>Add to Home Screen</strong>
        </div>
      {:else if planner.installBannerKind === 'ios-other-browser'}
        <div class="install-banner__title">Add to Home Screen</div>
        <!-- Non-Safari iOS browsers can do this too (they reach the same
             WebKit capability), but through their own menu rather than
             Safari's Share button. -->
        <div class="install-banner__sub">Open this page's menu, then <strong>Add to Home Screen</strong></div>
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
    /* Deliberately wraps rather than ellipsing — the iOS variants name a
       specific two-step gesture, and truncating that mid-sentence would
       lose the actual instruction. */
    line-height: 1.35;
  }
  /* Keeps the inline Share glyph optically on the text baseline instead of
     sitting on it. */
  .install-banner__sub :global(svg) {
    vertical-align: -2px;
  }
</style>
