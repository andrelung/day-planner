<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { planner } from '../store.svelte';
  import Icon from './Icon.svelte';
  import Button from './Button.svelte';

  let { error, reset }: { error: unknown; reset: () => void } = $props();

  // Whether this particular failure gets a silent second chance — see
  // noteRenderError. Read once, via untrack, deliberately: this decision
  // belongs to the failure that mounted this component, and a re-render
  // must not be able to turn a "show the user a button" verdict back into
  // another automatic retry.
  const autoRecover = untrack(() => planner.noteRenderError(error));

  // A single isolated render failure is almost always recoverable once the
  // state behind it has been straightened out (recoverFromRenderError), so
  // take that shot before showing the user anything — a blink beats a
  // dead end. Deferred past mount so the boundary has finished setting up
  // before it's asked to re-render its content.
  onMount(() => {
    if (!autoRecover) return;
    const id = setTimeout(() => {
      planner.recoverFromRenderError();
      reset();
    }, 0);
    return () => clearTimeout(id);
  });
</script>

{#if !autoRecover}
  <div class="fallback">
    <Icon name="warning-triangle" size={32} color="var(--color-feedback-wrong)" />
    <div class="fallback__title">Something went wrong on this screen</div>
    <p class="fallback__detail">
      It's been reported. Reloading picks up where you left off — anything already synced to Asana is safe.
    </p>
    {#if planner.renderErrorMessage}
      <p class="fallback__error">{planner.renderErrorMessage}</p>
    {/if}
    <div class="fallback__actions">
      <Button
        variant="primary"
        size="md"
        fullWidth
        onclick={() => {
          planner.recoverFromRenderError();
          reset();
        }}
      >
        Back to my tasks
      </Button>
      <Button variant="ghost" size="md" fullWidth onclick={() => planner.reloadForUpdate()}>Reload the app</Button>
    </div>
  </div>
{/if}

<style>
  .fallback {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 28px;
    box-sizing: border-box;
    background: var(--color-bg-page);
    text-align: center;
    font-family: var(--font-family-base);
  }
  .fallback__title {
    font-weight: var(--font-weight-extrabold);
    font-size: 20px;
    color: var(--color-text-primary);
  }
  .fallback__detail {
    margin: 0;
    font-size: 14px;
    color: var(--color-text-muted);
  }
  .fallback__error {
    margin: 0;
    font-size: 11px;
    color: var(--color-text-muted);
    opacity: 0.7;
    word-break: break-word;
  }
  .fallback__actions {
    margin-top: 12px;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
</style>
