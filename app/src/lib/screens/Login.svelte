<script lang="ts">
  import { planner } from '../store.svelte';
  import Icon from '../components/Icon.svelte';
</script>

<div class="screen">
  <div class="content">
    <div class="heading">Plan your day</div>
    <div class="subtitle">
      Sign in to pre-plan your Asana tasks against your real availability. Pick whichever account you use most — it
      becomes your primary login, and you'll connect the other one next.
    </div>

    <a class="provider-row" href={planner.asanaLoginUrl}>
      <div class="avatar">A</div>
      <div class="provider-name">Continue with Asana</div>
      <Icon name="chevron-right" size={16} color="var(--color-text-muted)" />
    </a>

    <a class="provider-row" style="margin-top:12px;" href={planner.outlookLoginUrl}>
      <div class="avatar">O</div>
      <div class="provider-name">Continue with Outlook</div>
      <Icon name="chevron-right" size={16} color="var(--color-text-muted)" />
    </a>
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
    width: 100%;
    display: flex;
    align-items: center;
    gap: 14px;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 16px;
    margin-top: 28px;
    cursor: pointer;
    text-align: left;
    text-decoration: none;
    box-sizing: border-box;
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
</style>
