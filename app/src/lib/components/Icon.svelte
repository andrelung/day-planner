<script lang="ts">
  interface Props {
    name:
      | 'menu'
      | 'grid'
      | 'chevron-right'
      | 'chevron-left'
      | 'pencil'
      | 'external-link'
      | 'minus'
      | 'plus'
      | 'close'
      | 'check-circle'
      | 'warning-triangle'
      | 'arrow-right'
      | 'settings'
      | 'calendar'
      | 'link'
      | 'link-off'
      | 'info';
    size?: number;
    color?: string;
  }
  let { name, size = 20, color = 'currentColor' }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke={color}
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  {#if name === 'menu'}
    <line x1="4" y1="7" x2="20" y2="7"></line>
    <line x1="4" y1="12" x2="20" y2="12"></line>
    <line x1="4" y1="17" x2="20" y2="17"></line>
  {:else if name === 'grid'}
    <rect x="3" y="3" width="8" height="8" rx="1.5"></rect>
    <rect x="13" y="3" width="8" height="8" rx="1.5"></rect>
    <rect x="3" y="13" width="8" height="8" rx="1.5"></rect>
    <rect x="13" y="13" width="8" height="8" rx="1.5"></rect>
  {:else if name === 'chevron-right'}
    <polyline points="9 18 15 12 9 6"></polyline>
  {:else if name === 'chevron-left'}
    <polyline points="15 18 9 12 15 6"></polyline>
  {:else if name === 'pencil'}
    <path d="M12 20h9"></path>
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
  {:else if name === 'external-link'}
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
    <polyline points="15 3 21 3 21 9"></polyline>
    <line x1="10" y1="14" x2="21" y2="3"></line>
  {:else if name === 'minus'}
    <line x1="5" y1="12" x2="19" y2="12"></line>
  {:else if name === 'plus'}
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  {:else if name === 'close'}
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  {:else if name === 'check-circle'}
    <circle cx="12" cy="12" r="9"></circle>
    <polyline points="8.5 12.5 11 15 16 9"></polyline>
  {:else if name === 'warning-triangle'}
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"></path>
    <line x1="12" y1="9" x2="12" y2="13"></line>
    <line x1="12" y1="17" x2="12.01" y2="17"></line>
  {:else if name === 'arrow-right'}
    <line x1="5" y1="12" x2="19" y2="12"></line>
    <polyline points="12 5 19 12 12 19"></polyline>
  {:else if name === 'settings'}
    <circle cx="12" cy="12" r="3"></circle>
    <path
      d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
    ></path>
  {:else if name === 'calendar'}
    <rect x="3" y="4" width="18" height="18" rx="2"></rect>
    <line x1="16" y1="2" x2="16" y2="6"></line>
    <line x1="8" y1="2" x2="8" y2="6"></line>
    <line x1="3" y1="10" x2="21" y2="10"></line>
  {:else if name === 'link'}
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
  {:else if name === 'link-off'}
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
    <line x1="3" y1="21" x2="21" y2="3"></line>
  {:else if name === 'info'}
    <circle cx="12" cy="12" r="9"></circle>
    <line x1="12" y1="16" x2="12" y2="11"></line>
    <line x1="12" y1="8" x2="12.01" y2="8"></line>
  {/if}
</svg>
