<script lang="ts">
  import { planner } from '../store.svelte';
  import Icon from '../components/Icon.svelte';
  import Button from '../components/Button.svelte';

  const label = $derived(planner.secondaryProviderLabel);
  const initial = $derived(planner.secondaryProviderInitial);
  const detail = $derived(planner.secondaryProviderDetail);

  // "Name <email>" -> "Name (email)" — reads more like normal UI copy than
  // raw angle brackets.
  const primaryAccountDisplay = $derived(planner.primaryAccountLabel?.replace(/^(.*) <(.+)>$/, '$1 ($2)') ?? null);
</script>

<div class="screen">
  <div class="content">
    <div class="signed-in-hint">
      <Icon name="check-circle" size={16} color="var(--color-feedback-correct)" />
      <span>
        <!-- The separating space is its own expression, not a literal leading
             space inside the span: Svelte trims whitespace at an element's
             own start/end, which silently ate it and rendered "Asanaas André
             Lung". `{' '}` isn't whitespace to the compiler, so it survives. -->
        Signed in with {planner.primaryProviderLabel}{#if primaryAccountDisplay}{' '}<span class="signed-in-hint__account">as {primaryAccountDisplay}</span>{/if}
      </span>
    </div>
    <div class="heading">Connect {label}</div>
    <div class="subtitle">{detail}</div>

    <div class="provider-row">
      <div class="avatar">{initial}</div>
      <div class="provider-name">{label} Account</div>
      <Button variant="secondary" size="sm" href={planner.secondaryProviderLoginUrl}>Connect</Button>
    </div>

    <button class="skip" onclick={() => planner.skipSecondaryProvider()}>Skip for now</button>
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
  .content {
    padding: 48px 28px 0;
    flex: 1;
    overflow-y: auto;
  }
  .signed-in-hint {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-family-base);
    font-size: 13px;
    font-weight: var(--font-weight-bold);
    color: var(--color-feedback-correct);
    margin-bottom: 16px;
  }
  .signed-in-hint__account {
    color: var(--color-text-muted);
    font-weight: var(--font-weight-normal);
  }
  .heading {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-extrabold);
    font-size: 26px;
    line-height: 1.25;
    color: var(--color-text-primary);
  }
  .subtitle {
    font-family: var(--font-family-base);
    font-size: 15px;
    color: var(--color-text-muted);
    margin-top: 10px;
  }
  .provider-row {
    display: flex;
    align-items: center;
    gap: 14px;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 16px;
    margin-top: 28px;
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
  .provider-name {
    flex: 1;
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 15px;
    color: var(--color-text-primary);
  }
  .skip {
    display: block;
    width: 100%;
    background: none;
    border: none;
    text-align: center;
    margin-top: 20px;
    font-family: var(--font-family-base);
    font-size: 13px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-muted);
    cursor: pointer;
  }
</style>
