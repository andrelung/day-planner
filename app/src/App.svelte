<script lang="ts">
  import { onMount } from 'svelte';
  import { planner } from './lib/store.svelte';
  import Toast from './lib/components/Toast.svelte';
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
  });
</script>

<div class="viewport">
  <div class="phone">
    {#if planner.screen === 'loading'}
      <div class="loading">
        {#if planner.bootError}
          <p>Couldn't reach the server: {planner.bootError}</p>
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
    align-items: center;
    justify-content: center;
    padding: 24px;
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--color-text-muted);
    text-align: center;
  }
</style>
