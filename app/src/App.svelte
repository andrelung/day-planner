<script lang="ts">
  import { onMount } from 'svelte';
  import { planner } from './lib/store.svelte';
  import Toast from './lib/components/Toast.svelte';
  import Icon from './lib/components/Icon.svelte';
  import Login from './lib/screens/Login.svelte';
  import LoginSecondary from './lib/screens/LoginSecondary.svelte';
  import Triage from './lib/screens/Triage.svelte';
  import Settings from './lib/screens/Settings.svelte';
  import Integrations from './lib/screens/Integrations.svelte';
  import Overview from './lib/screens/Overview.svelte';
  import PlanToday from './lib/screens/PlanToday.svelte';
  import PlanLater from './lib/screens/PlanLater.svelte';
  import PickDate from './lib/screens/PickDate.svelte';
  import FreeSlotsLater from './lib/screens/FreeSlotsLater.svelte';
  import DayFull from './lib/screens/DayFull.svelte';
  import SlotConflict from './lib/screens/SlotConflict.svelte';
  import BreakName from './lib/screens/BreakName.svelte';
  import BreakTime from './lib/screens/BreakTime.svelte';
  import BreakDuration from './lib/screens/BreakDuration.svelte';
  import BreakConfirm from './lib/screens/BreakConfirm.svelte';

  onMount(() => {
    void planner.boot();

    // iOS suspends (and sometimes kills) a standalone home-screen web app's
    // WKWebView when it's backgrounded — e.g. tapping "Open in Asana" and
    // switching back — which can leave it stuck on a blank, un-repainted
    // screen. Re-running boot() forces a fresh render and re-syncs data;
    // gated by a short delay so a quick app-switcher flick doesn't reboot
    // the app and reset whatever screen the user was on.
    let hiddenAt: number | null = null;
    function onVisibilityChange() {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt > 3000 && planner.screen !== 'loading') {
        void planner.boot();
      }
      hiddenAt = null;
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  });
</script>

<div class="viewport">
  <div class="phone">
    {#if planner.screen === 'loading'}
      <div class="loading">
        {#if planner.bootError}
          <Icon name="warning-triangle" size={28} color="var(--color-feedback-wrong)" />
          <p>Couldn't reach the server: {planner.bootError}</p>
        {:else}
          <div class="loading__mark">
            <Icon name="grid" size={26} color="var(--color-brand-primary)" />
            <div class="loading__ring"></div>
          </div>
          <p>Loading your day…</p>
          {#if planner.loadingProgressLabel}
            <p class="loading__progress">{planner.loadingProgressLabel}</p>
          {/if}
        {/if}
      </div>
    {:else if planner.screen === 'login'}
      <Login />
    {:else if planner.screen === 'loginSecondary'}
      <LoginSecondary />
    {:else if planner.screen === 'triage'}
      <Triage />
    {:else if planner.screen === 'settings'}
      <Settings />
    {:else if planner.screen === 'integrations'}
      <Integrations />
    {:else if planner.screen === 'overview'}
      <Overview />
    {:else if planner.screen === 'planToday'}
      <PlanToday />
    {:else if planner.screen === 'planLater'}
      <PlanLater />
    {:else if planner.screen === 'pickDate'}
      <PickDate />
    {:else if planner.screen === 'freeSlotsLater'}
      <FreeSlotsLater />
    {:else if planner.screen === 'dayFull'}
      <DayFull />
    {:else if planner.screen === 'slotConflict'}
      <SlotConflict />
    {:else if planner.screen === 'breakName'}
      <BreakName />
    {:else if planner.screen === 'breakTime'}
      <BreakTime />
    {:else if planner.screen === 'breakDuration'}
      <BreakDuration />
    {:else if planner.screen === 'breakConfirm'}
      <BreakConfirm />
    {/if}
    <Toast />
  </div>
</div>

<style>
  .viewport {
    height: 100vh;
    height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-bg-page);
    box-sizing: border-box;
    font-family: var(--font-family-base);
    overflow: hidden;
  }
  .phone {
    width: 100%;
    max-width: 480px;
    height: 100%;
    margin: 0 auto;
    background: var(--color-bg-surface);
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .loading {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 24px;
    font-family: var(--font-family-base);
    font-size: 13px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-muted);
    text-align: center;
  }
  .loading__mark {
    position: relative;
    width: 56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .loading__ring {
    position: absolute;
    inset: 0;
    border: 3px solid var(--color-border);
    border-top-color: var(--color-brand-accent);
    border-radius: 50%;
    animation: loading-spin 0.9s linear infinite;
  }
  .loading__progress {
    margin-top: -12px;
    font-size: 12px;
    font-weight: var(--font-weight-normal);
    font-variant-numeric: tabular-nums;
    opacity: 0.75;
  }
  @keyframes loading-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
