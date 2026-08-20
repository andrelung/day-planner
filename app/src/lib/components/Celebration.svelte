<script lang="ts">
  import { planner } from '../store.svelte';

  interface Props {
    label: string;
  }
  let { label }: Props = $props();

  const colors = ['var(--color-brand-accent)', 'var(--color-feedback-correct)', 'var(--color-brand-primary)', 'var(--grips-dark-blue)'];
  const pieceCount = 28;

  interface Piece {
    left: string;
    delay: string;
    duration: string;
    color: string;
    rotate: string;
    drift: string;
  }

  function makePieces(): Piece[] {
    return Array.from({ length: pieceCount }, () => ({
      left: `${Math.random() * 100}%`,
      delay: `${Math.random() * 150}ms`,
      duration: `${900 + Math.random() * 500}ms`,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotate: `${Math.floor(Math.random() * 360)}deg`,
      drift: `${(Math.random() - 0.5) * 60}px`,
    }));
  }

  // Re-generated on every mount (the parent re-keys this component on each
  // trigger) so back-to-back celebrations don't look identical.
  const pieces = makePieces();
</script>

<div class="celebration">
  {#each pieces as p, i (i)}
    <span
      class="piece"
      style="left:{p.left}; --delay:{p.delay}; --duration:{p.duration}; --rotate:{p.rotate}; --drift:{p.drift}; background:{p.color};"
    ></span>
  {/each}
  <div class="celebration__banner">
    <span class="celebration__emoji">🎉</span>
    <span class="celebration__text">{label}</span>
  </div>
</div>

<style>
  .celebration {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 60;
  }
  .piece {
    position: absolute;
    top: -12px;
    width: 8px;
    height: 8px;
    border-radius: 2px;
    opacity: 0;
    animation: fall var(--duration) ease-in var(--delay) forwards;
  }
  @keyframes fall {
    0% {
      opacity: 1;
      transform: translate(0, 0) rotate(0deg);
    }
    100% {
      opacity: 0;
      transform: translate(var(--drift), 340px) rotate(var(--rotate));
    }
  }
  /* The celebration's container never unmounts once celebrationKey first
     goes truthy (see App.svelte) — this has to fade itself out and stay
     invisible (animation-fill-mode: forwards), same trick as .piece above,
     or the "Today is fully planned!" text would just sit there forever. */
  .celebration__banner {
    position: absolute;
    top: 40%;
    left: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 16px 24px;
    background: var(--color-bg-surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-overlay);
    opacity: 0;
    animation: banner-pop 2600ms ease-out forwards;
  }
  .celebration__emoji {
    font-size: 28px;
    line-height: 1;
  }
  .celebration__text {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-extrabold);
    font-size: 15px;
    color: var(--color-text-primary);
    text-align: center;
    white-space: nowrap;
  }
  @keyframes banner-pop {
    0% {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.85);
    }
    12% {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
    75% {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.96);
    }
  }
</style>
