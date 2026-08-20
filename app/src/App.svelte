<script lang="ts">
  import { onMount } from 'svelte';
  import { planner } from './lib/store.svelte';
  import { VERSION_LABEL } from './lib/version';
  import Toast from './lib/components/Toast.svelte';
  import UpdateNotice from './lib/components/UpdateNotice.svelte';
  import Celebration from './lib/components/Celebration.svelte';
  import Icon from './lib/components/Icon.svelte';
  import Login from './lib/screens/Login.svelte';
  import LoginSecondary from './lib/screens/LoginSecondary.svelte';
  import Triage from './lib/screens/Triage.svelte';
  import Settings from './lib/screens/Settings.svelte';
  import Integrations from './lib/screens/Integrations.svelte';
  import PendingActions from './lib/screens/PendingActions.svelte';
  import Overview from './lib/screens/Overview.svelte';
  import PlanToday from './lib/screens/PlanToday.svelte';
  import PlanLater from './lib/screens/PlanLater.svelte';
  import NextWeekDays from './lib/screens/NextWeekDays.svelte';
  import PickDate from './lib/screens/PickDate.svelte';
  import FreeSlotsLater from './lib/screens/FreeSlotsLater.svelte';
  import DayFull from './lib/screens/DayFull.svelte';
  import SlotConflict from './lib/screens/SlotConflict.svelte';
  import EventLinkConflict from './lib/screens/EventLinkConflict.svelte';
  import BreakName from './lib/screens/BreakName.svelte';
  import BreakTime from './lib/screens/BreakTime.svelte';
  import BreakDuration from './lib/screens/BreakDuration.svelte';
  import BreakConfirm from './lib/screens/BreakConfirm.svelte';

  onMount(() => {
    void planner.boot();

    // iOS suspends (and sometimes kills) a standalone home-screen web app's
    // WKWebView when it's backgrounded — e.g. tapping "Open in Asana" and
    // switching back, or switching to another app entirely (Asana itself)
    // and back — which can leave it stuck on a blank, un-repainted screen
    // and/or showing stale data from before the switch.
    //
    // visibilitychange alone isn't reliable for this: standalone iOS PWAs
    // frequently don't fire it on the way back (sometimes not on the way
    // out either), which is exactly why "task doesn't reload after coming
    // back from Asana" kept happening even with a visibilitychange
    // listener in place. pageshow (fired when the page is restored, e.g.
    // from the bfcache-like state iOS uses for a resumed standalone app)
    // and window focus are the other two events known to catch this same
    // moment on iOS — wiring up all three, deduped by resume(), maximizes
    // the chance at least one actually fires for a given iOS version.
    //
    // Two things happen on resume, addressing two different causes:
    // 1. A forced synchronous repaint (toggle a style, force layout, revert)
    //    — WebKit needs *something* to trigger repainting the stuck frame,
    //    and this doesn't depend on any network round-trip completing.
    // 2. A plain refetch of tasks/workload to resync data that may have
    //    changed while away (e.g. in Asana). This deliberately calls
    //    refreshTasks()/refreshWorkload() — the same plain GET every other
    //    in-app refresh uses — rather than boot()'s SSE-streamed path:
    //    re-establishing a long-lived EventSource connection right as iOS's
    //    background network suspension is still lifting is markedly less
    //    reliable than one plain fetch, which made the *data* half of this
    //    fix flaky again once boot() started streaming.
    let lastResumeAt = 0;
    function forceRepaint() {
      const el = document.documentElement;
      el.style.transform = 'translateZ(0)';
      void el.offsetHeight; // force a synchronous layout flush before reverting
      el.style.transform = '';
    }
    function resume() {
      if (planner.screen === 'loading') return;
      // The three listeners below can all fire for the same real resume
      // (e.g. visibilitychange then focus within the same tick) — only act
      // on the first.
      const now = Date.now();
      if (now - lastResumeAt < 1500) return;
      lastResumeAt = now;
      forceRepaint();
      void planner.refreshTasks();
      void planner.refreshWorkload();
      void planner.checkForUpdate();
    }
    function onVisibilityChange() {
      if (!document.hidden) resume();
    }
    function onPageShow(e: PageTransitionEvent) {
      // A genuinely fresh load already gets current data from boot() —
      // only treat this as a "resume" when the page was restored rather
      // than newly loaded.
      if (e.persisted) resume();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', resume);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', resume);
    };
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
          <p>{planner.bootStatus}</p>
          {#if planner.loadingProgressLabel}
            <p class="loading__progress">{planner.loadingProgressLabel}</p>
          {/if}
        {/if}
        <p class="loading__version">{VERSION_LABEL}</p>
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
    {:else if planner.screen === 'pendingActions'}
      <PendingActions />
    {:else if planner.screen === 'overview'}
      <Overview />
    {:else if planner.screen === 'planToday'}
      <PlanToday />
    {:else if planner.screen === 'planLater'}
      <PlanLater />
    {:else if planner.screen === 'nextWeekDays'}
      <NextWeekDays />
    {:else if planner.screen === 'pickDate'}
      <PickDate />
    {:else if planner.screen === 'freeSlotsLater'}
      <FreeSlotsLater />
    {:else if planner.screen === 'dayFull'}
      <DayFull />
    {:else if planner.screen === 'slotConflict'}
      <SlotConflict />
    {:else if planner.screen === 'eventLinkConflict'}
      <EventLinkConflict />
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
    <UpdateNotice />
    {#if planner.celebrationKey > 0}
      {#key planner.celebrationKey}
        <Celebration label={planner.celebrationLabel} />
      {/key}
    {/if}
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
    position: relative;
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
  .loading__version {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 16px;
    font-size: 11px;
    font-weight: var(--font-weight-normal);
    font-variant-numeric: tabular-nums;
    opacity: 0.5;
  }
  @keyframes loading-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
