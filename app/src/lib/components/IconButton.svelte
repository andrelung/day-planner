<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    icon: 'menu' | 'grid' | 'chevron-right' | 'chevron-left' | 'external-link' | 'close' | 'settings' | 'plus' | 'calendar';
    title: string;
    size?: number;
    iconSize?: number;
    color?: string;
    borderColor?: string;
    disabled?: boolean;
    onclick?: () => void;
    /// Renders as a real `<a target="_blank">` instead of a button that
    /// calls window.open() in JS — on an iOS home-screen PWA, window.open()
    /// isn't reliably treated as a direct user gesture (Svelte's event
    /// delegation adds enough indirection that WebKit's popup heuristic can
    /// reject it), which left "Open in Asana" opening a blank Safari tab
    /// instead of the task. A real anchor tap is always a trusted gesture.
    href?: string;
  }
  let {
    icon,
    title,
    size = 40,
    iconSize = 20,
    color = 'var(--color-text-primary)',
    borderColor = 'var(--color-border-strong)',
    disabled = false,
    onclick,
    href,
  }: Props = $props();
</script>

{#if href && !disabled}
  <a
    class="icon-button"
    style="width:{size}px; height:{size}px; color:{color}; border-color:{borderColor};"
    {title}
    aria-label={title}
    {href}
    target="_blank"
    rel="noopener noreferrer"
  >
    <Icon name={icon} size={iconSize} />
  </a>
{:else}
  <button
    class="icon-button"
    style="width:{size}px; height:{size}px; color:{color}; border-color:{borderColor}; opacity:{disabled ? 0.4 : 1}; pointer-events:{disabled ? 'none' : 'auto'};"
    {title}
    aria-label={title}
    onclick={disabled ? undefined : onclick}
  >
    <Icon name={icon} size={iconSize} />
  </button>
{/if}

<style>
  .icon-button {
    border-radius: var(--radius-md);
    border-width: 1px;
    border-style: solid;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    text-decoration: none;
  }
</style>
