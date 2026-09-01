<script lang="ts">
  import { planner } from '../store.svelte';
  import Button from '../components/Button.svelte';
  import onbCalendar from '../assets/onb-calendar.png';
  import onbCapacity from '../assets/onb-capacity.png';
  import onbAsana from '../assets/onb-asana.png';
  import onbOutlook from '../assets/onb-outlook.png';

  const SLIDES = [
    {
      title: 'Get a grip on your day-plan',
      body: 'Easily walk through your tasks one at a time, against the hours you actually have.',
    },
    {
      title: 'See how much time you got',
      body: 'You get a visual indication about your workload. Re-plan your days on the go.',
    },
    {
      title: 'Integrate with Asana and Outlook',
      body: 'Tasks are synced from Asana, appointments from your Outlook calendar. Every change is synced.',
    },
  ];

  const slide = $derived(SLIDES[planner.onbSlide]);

  // Same threshold/off-axis convention as the triage focus card's own
  // swipe (see store.svelte.ts's onCardPointerUp) — dots are the primary
  // affordance, this is just for someone who reaches for the gesture
  // instead.
  const SWIPE_THRESHOLD_PX = 90;
  const SWIPE_MAX_OFF_AXIS_RATIO = 0.5;
  let touchStartX = 0;
  let touchStartY = 0;
  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }
  function onTouchEnd(e: TouchEvent) {
    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
    if (Math.abs(dy) > Math.abs(dx) * SWIPE_MAX_OFF_AXIS_RATIO) return;
    if (dx < 0) planner.nextOnboardingSlide();
    else planner.prevOnboardingSlide();
  }
</script>

<div class="screen">
  <div class="top-bar">
    <button class="skip-link" onclick={() => planner.skipOnboarding()}>Skip onboarding</button>
  </div>

  <div class="center" ontouchstart={onTouchStart} ontouchend={onTouchEnd}>
    <div class="illustration">
      {#if planner.onbSlide === 0}
        <img src={onbCalendar} alt="" style="height: 200px; width: auto; object-fit: contain;" />
      {:else if planner.onbSlide === 1}
        <img src={onbCapacity} alt="" style="height: 200px; width: auto; object-fit: contain;" />
      {:else}
        <div class="illustration__overlap">
          <img src={onbAsana} alt="" style="height: 170px; width: auto; object-fit: contain; margin-right: -18px;" />
          <img src={onbOutlook} alt="" style="height: 190px; width: auto; object-fit: contain; margin-top: 26px;" />
        </div>
      {/if}
    </div>

    <div class="text">
      <div class="text__title">{slide.title}</div>
      <div class="text__body">{slide.body}</div>
    </div>

    <div class="dots">
      {#each SLIDES as _, i}
        <div class="dot" class:dot--active={i === planner.onbSlide}></div>
      {/each}
    </div>
  </div>

  <div class="footer">
    <Button variant="primary" size="md" fullWidth onclick={() => planner.nextOnboardingSlide()}>{planner.onbCtaLabel}</Button>
  </div>
</div>

<style>
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--color-bg-surface);
    overflow: hidden;
  }
  .top-bar {
    display: flex;
    justify-content: flex-end;
    padding: 18px 20px 0;
    flex-shrink: 0;
  }
  .skip-link {
    background: none;
    border: none;
    padding: 0;
    font-family: var(--font-family-base);
    font-size: 13px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-muted);
    cursor: pointer;
  }
  .center {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 40px;
    padding: 0 32px;
  }
  .illustration {
    width: 100%;
    height: 200px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .illustration__overlap {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
  }
  .text {
    text-align: center;
  }
  .text__title {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-extrabold);
    font-size: 24px;
    line-height: 1.25;
    color: var(--color-text-primary);
    text-wrap: pretty;
  }
  .text__body {
    font-family: var(--font-family-base);
    font-size: 15px;
    line-height: 1.5;
    color: var(--color-text-muted);
    margin-top: 12px;
    text-wrap: pretty;
  }
  .dots {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dot {
    height: 6px;
    width: 6px;
    border-radius: 999px;
    background: var(--color-border);
    transition: width var(--duration-fast) var(--ease-standard);
  }
  .dot--active {
    width: 22px;
    background: var(--grips-dark-blue);
  }
  .footer {
    padding: 16px 20px 24px;
    flex-shrink: 0;
  }
</style>
