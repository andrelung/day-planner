<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    icon: 'menu' | 'grid' | 'chevron-right' | 'chevron-left' | 'external-link' | 'close' | 'settings' | 'plus';
    title: string;
    size?: number;
    iconSize?: number;
    color?: string;
    borderColor?: string;
    disabled?: boolean;
    onclick?: () => void;
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
  }: Props = $props();
</script>

<button
  class="icon-button"
  style="width:{size}px; height:{size}px; color:{color}; border-color:{borderColor}; opacity:{disabled ? 0.4 : 1}; pointer-events:{disabled ? 'none' : 'auto'};"
  {title}
  aria-label={title}
  onclick={disabled ? undefined : onclick}
>
  <Icon name={icon} size={iconSize} />
</button>

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
  }
</style>
