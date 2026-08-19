<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    label?: string;
    placeholder?: string;
    value: string;
    onchange?: (value: string) => void;
    type?: 'text' | 'number' | 'time' | 'date';
    disabled?: boolean;
    center?: boolean;
  }
  let { label, placeholder, value, onchange, type = 'text', disabled = false, center = false }: Props = $props();

  function handleInput(e: Event) {
    onchange?.((e.target as HTMLInputElement).value);
  }
</script>

<label class="ds-input">
  {#if label}
    <span class="ds-input__label">{label}</span>
  {/if}
  <div class="ds-input__field">
    <input
      {type}
      {value}
      {placeholder}
      {disabled}
      class:center
      class:date-empty={type === 'date' && !value}
      oninput={handleInput}
    />
    {#if type === 'date' && !value}
      <!-- Native date inputs render blank when empty on several browsers
           (notably iOS Safari, no "mm/dd/yyyy" placeholder like desktop
           Chrome) — this non-interactive overlay makes the field read as
           "tap to choose a date" instead of looking broken/unfilled. Taps
           pass straight through to the real input underneath. -->
      <div class="ds-input__date-placeholder">
        <Icon name="calendar" size={18} color="var(--color-text-muted)" />
        <span>Choose a date</span>
      </div>
    {/if}
  </div>
</label>

<style>
  .ds-input {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: var(--font-family-base);
    width: 100%;
    min-width: 0;
  }
  .ds-input__label {
    font-size: 14px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-primary);
  }
  .ds-input__field {
    position: relative;
    height: 44px;
    width: 100%;
  }
  input {
    position: absolute;
    inset: 0;
    padding: 0 14px;
    font-family: var(--font-family-base);
    font-size: 16px;
    color: var(--color-text-primary);
    background: var(--true-white);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    outline: none;
    transition: border-color var(--duration-fast) var(--ease-standard);
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
  /* iOS Safari ties box-sizing:border-box to whether the control still has
     its native appearance: for input[type=time/date], the OS-drawn widget
     forced box-sizing to content-box no matter what this rule said, and it
     also kept its own pill-shaped chrome regardless of our border/radius —
     confirmed on-device (getComputedStyle reported content-box, 392px
     rendered in a 362px field). Stripping the appearance fixes both at
     once: the box now honors border-box like every other field here, so it
     needs no width compensation, same as text/number/select never did. */
  input[type='time'],
  input[type='date'] {
    -webkit-appearance: none;
    appearance: none;
  }
  input:focus {
    border-color: var(--color-brand-primary);
  }
  input:disabled {
    background: var(--color-bg-page);
  }
  input.center {
    text-align: center;
  }
  /* Hides the browser's own "mm/dd/yyyy" placeholder segments (Chrome/
     desktop draws these even with no value; iOS Safari draws nothing) so
     they don't collide with .ds-input__date-placeholder's overlay text —
     the picker-indicator icon is a separate element and stays visible. */
  input.date-empty {
    color: transparent;
  }
  .ds-input__date-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    pointer-events: none;
    font-family: var(--font-family-base);
    font-size: 16px;
    color: var(--color-text-muted);
  }
</style>
