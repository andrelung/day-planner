<script lang="ts">
  import { onMount } from 'svelte';
  import { planner } from './lib/store.svelte';
  import { DEV_NOTES, VERSION_LABEL } from './lib/version';
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
  import CalendarView from './lib/screens/CalendarView.svelte';
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
  import BacklogExplainer from './lib/screens/BacklogExplainer.svelte';

  // WebKit needs *something* to trigger repainting a stuck frame — toggling
  // a style and forcing a synchronous layout flush before reverting it does
  // that without depending on any network round-trip. Shared by resume()
  // below (backgrounding/foregrounding) and the screen-transition effect
  // further down (leaving CalendarView — see its comment).
  //
  // The revert waits two animation frames rather than happening
  // synchronously right after the offsetHeight read: a layout flush forces
  // layout, not necessarily a compositor paint, so reverting the style in
  // the same synchronous burst can let WebKit coalesce the on/off pair away
  // entirely — nothing ever actually gets composited in between. A single
  // rAF wasn't enough either — confirmed live (SlotConflict's resolve
  // buttons kept firing on every stale tap, each one logging a "no
  // pendingSlotPlan" anomaly, while `screen` had already correctly moved to
  // 'triage' — the state changed, the buttons still worked, nothing visible
  // ever caught up). The standard fix for "did WebKit actually paint yet" is
  // two rAFs, not one: the first callback fires before the *next* paint,
  // the second fires only after that paint has actually happened — that's
  // the real frame boundary the single-rAF version was missing.
  function forceRepaint() {
    const el = document.documentElement;
    el.style.transform = 'translateZ(0)';
    void el.offsetHeight; // force a synchronous layout flush before reverting
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transform = '';
      });
    });
  }

  // On an iOS home-screen PWA specifically, a screen transition can leave
  // the new screen's buttons visually present but unresponsive to touch —
  // the same class of stuck-WKWebView-frame symptom forceRepaint() already
  // exists to fix for background/foreground resume. First noticed leaving
  // CalendarView specifically (the most visually heavy screen — many
  // absolutely-positioned/transformed blocks, a custom scroll-drag
  // gesture), so the fix originally only ran there — but it then recurred
  // on a plain Settings→close, confirming it isn't calendar-view-specific
  // at all, just more likely on heavier screens. forceRepaint() is a cheap,
  // side-effect-free style toggle, so this now runs on every screen
  // transition rather than trying to guess which ones are "heavy enough"
  // to need it. Not reproducible on desktop (WebKit-specific).
  $effect(() => {
    void planner.screen;
    forceRepaint();
  });

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
    function resume() {
      if (planner.screen === 'loading') return;
      // The three listeners below can all fire for the same real resume
      // (e.g. visibilitychange then focus within the same tick) — only act
      // on the first.
      const now = Date.now();
      if (now - lastResumeAt < 1500) return;
      lastResumeAt = now;
      forceRepaint();
      // Fast, targeted top-up for exactly what's on screen (see its own
      // comment) fired alongside the fuller refresh below rather than
      // instead of it — refreshTasks() is still what surfaces a task
      // that's newly due/assigned and wasn't already visible.
      void planner.refreshVisibleTasks();
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
    // Fired by store.svelte's logAnomaly — a stale/duplicate invocation of
    // a guard like resolveConflictAnyway's is exactly the signature a
    // stuck-frame bug leaves behind (the tap's handler runs fine against
    // state that already moved on; the screen just never caught up), so a
    // repaint attempt right there costs nothing and might unstick it.
    window.addEventListener('day-planner:force-repaint', forceRepaint);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', resume);
      window.removeEventListener('day-planner:force-repaint', forceRepaint);
    };
  });
</script>

<div class="viewport">
  <div class="phone">
    {#if planner.screen === 'loading'}
      <div class="loading">
        <div class="loading__body">
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
        </div>
        <div class="loading__footer">
          <p class="loading__version">{VERSION_LABEL} {#if DEV_NOTES.length > 0}· currently in development:{/if}</p>
          {#if DEV_NOTES.length > 0}
            <div class="loading__dev-notes">
              {#each DEV_NOTES as note (note)}
                <div class="loading__dev-notes-item">
                  <span class="loading__dev-notes-bullet">•</span>
                  <span>{note}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
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
    {:else if planner.screen === 'calendarView'}
      <CalendarView />
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
    {:else if planner.screen === 'backlogExplainer'}
      <BacklogExplainer />
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
  /* Plain column, no centering of its own — .loading__body (below) is what
     centers, within whatever space is actually left over after
     .loading__footer, so a tall footer pushes the centered content up
     instead of the two overlapping. Was previously the other way around
     (this element centered everything, footer was position:absolute and
     unaccounted for), which is exactly how the two ended up overlapping —
     the centering had no idea the footer existed at all. */
  .loading {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 24px;
    font-family: var(--font-family-base);
    font-size: 13px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-muted);
    text-align: center;
  }
  .loading__body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
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
  /* A normal flex item now, not position:absolute — the dev-notes list
     accumulates across every uncommitted rebuild (see version.ts) with no
     upper bound, and an absolutely-positioned footer has no way to tell
     the centered content above it to make room as it grows. As a real
     flex sibling of .loading__body, it claims its own space up front, so
     .loading__body's flex:1 (and its own centering within that) naturally
     shrinks and shifts up instead of the two overlapping. Still capped and
     internally scrollable on top of that, purely as a backstop against an
     extreme number of notes pushing .loading__body down to nothing. */
  .loading__footer {
    flex-shrink: 0;
    max-height: 40vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 16px 24px 0;
  }
  .loading__version {
    margin: 0;
    font-size: 11px;
    font-weight: var(--font-weight-normal);
    font-variant-numeric: tabular-nums;
    opacity: 0.5;
  }
  .loading__dev-notes {
    /* Explicit width rather than left to flexbox's own shrink-to-fit —
       .loading__footer centers its children by default, which left this
       block auto-sized to some content-derived width instead of the
       footer's actual available width, so wrapping happened at an
       unpredictable boundary and the hanging indent (see
       loading__dev-notes-item below) never lined up against where text
       actually wrapped. */
    width: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 11px;
    font-weight: var(--font-weight-normal);
    opacity: 0.5;
  }
  /* A real flex column for the bullet instead of text-indent/::before —
     that approach measured the hanging indent in px against a bullet
     glyph of unknown rendered width, so the wrapped line never quite
     lined up under the first line's actual text. A dedicated bullet
     column of its own width means the text span's left edge is exactly
     the same position on every line, wrapped or not. */
  .loading__dev-notes-item {
    display: flex;
    gap: 4px;
    text-align: left;
    line-height: 1.3;
  }
  .loading__dev-notes-bullet {
    flex-shrink: 0;
  }
  @keyframes loading-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
