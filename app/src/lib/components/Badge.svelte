<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    tone?: 'neutral' | 'correct' | 'wrong' | 'accent';
    children: Snippet;
  }
  let { tone = 'neutral', children }: Props = $props();
</script>

<span class="ds-badge ds-badge--{tone}">
  {@render children()}
</span>

<style>
  .ds-badge {
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 10px;
    border-radius: var(--radius-pill);
    font-family: var(--font-family-base);
    font-size: 13px;
    font-weight: var(--font-weight-bold);
    white-space: nowrap;
  }
  .ds-badge--neutral {
    background: var(--color-border);
    color: var(--color-text-primary);
  }
  .ds-badge--correct {
    background: var(--color-feedback-correct);
    color: var(--true-white);
  }
  .ds-badge--wrong {
    background: var(--color-feedback-wrong);
    color: var(--true-white);
  }
  .ds-badge--accent {
    background: var(--grips-highlight-yellow);
    color: var(--grips-dark-blue);
  }
</style>
