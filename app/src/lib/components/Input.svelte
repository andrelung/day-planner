<script lang="ts">
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
  <input
    {type}
    {value}
    {placeholder}
    {disabled}
    class:center
    oninput={handleInput}
  />
</label>

<style>
  .ds-input {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: var(--font-family-base);
    width: 100%;
  }
  .ds-input__label {
    font-size: 14px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-primary);
  }
  input {
    height: 44px;
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
    box-sizing: border-box;
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
</style>
