<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    valueText: string;
    unit?: string;
    inputWidth?: string;
    stepSize?: number;
    ondec: () => void;
    oninc: () => void;
    oninput: (v: string) => void;
  }
  let { valueText, unit = 'h', inputWidth = '64px', stepSize = 28, ondec, oninc, oninput }: Props = $props();
</script>

<div class="stepper">
  <button class="stepper__btn" style="width:{stepSize}px; height:{stepSize}px;" onclick={ondec} aria-label="Decrease">
    <Icon name="minus" size={stepSize * 0.5} color="var(--grips-dark-blue)" />
  </button>
  <input
    class="stepper__input"
    style="width:{inputWidth};"
    type="number"
    value={valueText}
    oninput={(e) => oninput((e.target as HTMLInputElement).value)}
  />
  <div class="stepper__unit">{unit}</div>
  <button class="stepper__btn" style="width:{stepSize}px; height:{stepSize}px;" onclick={oninc} aria-label="Increase">
    <Icon name="plus" size={stepSize * 0.5} color="var(--grips-dark-blue)" />
  </button>
</div>

<style>
  .stepper {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .stepper__btn {
    border-radius: var(--radius-md);
    background: var(--grips-highlight-yellow);
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
  }
  .stepper__btn:hover {
    background: var(--button-state-hover);
  }
  .stepper__input {
    height: 44px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    text-align: center;
    font-family: var(--font-family-base);
    font-size: 16px;
    color: var(--color-text-primary);
    background: var(--true-white);
    outline: none;
  }
  .stepper__input:focus {
    border-color: var(--color-brand-primary);
  }
  .stepper__unit {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 15px;
    color: var(--color-text-primary);
  }
</style>
