<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'primary' | 'secondary' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    fullWidth?: boolean;
    invertedBorder?: boolean;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  }
  let { variant = 'primary', size = 'md', disabled = false, fullWidth = false, invertedBorder = false, onclick, children }: Props = $props();

  const dims = $derived(
    {
      sm: { height: '36px', padding: '0 14px', fontSize: '14px' },
      md: { height: '44px', padding: '0 20px', fontSize: '16px' },
      lg: { height: '52px', padding: '0 28px', fontSize: '18px' },
    }[size],
  );
</script>

<button
  class="ds-button ds-button--{variant}"
  class:full-width={fullWidth}
  class:inverted-border={invertedBorder}
  style="height:{dims.height}; padding:{dims.padding}; font-size:{dims.fontSize};"
  {disabled}
  onclick={disabled ? undefined : onclick}
>
  {@render children()}
</button>

<style>
  .ds-button {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    border-radius: var(--radius-md);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease-standard),
      filter var(--duration-fast) var(--ease-standard);
    border: none;
  }
  .ds-button.full-width {
    width: 100%;
  }
  .ds-button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .ds-button--primary {
    background: var(--grips-highlight-yellow);
    color: var(--grips-dark-blue);
  }
  .ds-button--primary:hover:not(:disabled) {
    background: var(--button-state-hover);
  }
  .ds-button--primary:active:not(:disabled) {
    background: var(--button-state-active-bg);
    color: var(--button-state-active-highlight);
  }
  .ds-button--secondary {
    background: var(--color-brand-primary);
    color: var(--true-white);
  }
  .ds-button--secondary.inverted-border {
    border: 1px solid rgba(255, 255, 255, 0.4);
  }
  .ds-button--secondary:hover:not(:disabled) {
    filter: brightness(1.15);
  }
  .ds-button--secondary:active:not(:disabled) {
    filter: brightness(0.85);
  }
  .ds-button--ghost {
    background: transparent;
    color: var(--color-text-primary);
    border: 1px solid var(--color-border-strong);
  }
  .ds-button--ghost:hover:not(:disabled) {
    background: var(--color-bg-page);
  }
  .ds-button--ghost:active:not(:disabled) {
    background: var(--color-border);
  }
</style>
