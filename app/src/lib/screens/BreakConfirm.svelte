<script lang="ts">
  import { planner } from '../store.svelte';
  import { fmtHours } from '../format';
  import IconButton from '../components/IconButton.svelte';
  import Button from '../components/Button.svelte';
</script>

<div class="screen">
  <div class="close-wrap">
    <IconButton icon="close" title="Close" size={36} iconSize={18} onclick={() => planner.closeFlow()} />
  </div>
  <div class="heading-wrap">
    <div class="heading">Do a part today</div>
  </div>
  <div class="content">
    <div class="label">confirm?</div>
    <div class="name">{planner.breakNameDraft}</div>
    <div class="detail">{planner.breakTimeSlot}</div>
    <div class="detail">{fmtHours(planner.breakDuration)}</div>
    <div class="actions">
      <Button variant="secondary" size="md" invertedBorder fullWidth onclick={() => planner.editBreak()}>edit</Button>
      <Button variant="primary" size="md" fullWidth onclick={() => planner.createBreak()}>create</Button>
    </div>
  </div>
  <div class="footer">
    <Button variant="secondary" size="md" invertedBorder onclick={() => planner.backToBreakDuration()}>back</Button>
  </div>
</div>

<style>
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--color-bg-surface);
    overflow: hidden;
  }
  .close-wrap {
    display: flex;
    justify-content: flex-end;
    padding: 18px 20px 0;
    flex-shrink: 0;
  }
  .heading-wrap {
    padding: 4px 24px 0;
    text-align: center;
    flex-shrink: 0;
  }
  .heading {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-extrabold);
    font-size: 22px;
    color: var(--color-text-primary);
  }
  .content {
    padding: 30px 28px 0;
    flex: 1;
    text-align: center;
    min-height: 0;
  }
  .label {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 15px;
    color: var(--color-text-primary);
    margin-bottom: 22px;
  }
  .name {
    font-family: var(--font-family-base);
    font-size: 18px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-primary);
  }
  .detail {
    font-family: var(--font-family-base);
    font-size: 15px;
    color: var(--color-text-muted);
    margin-top: 8px;
  }
  .actions {
    display: flex;
    gap: 10px;
    margin-top: 30px;
  }
  .footer {
    background: var(--color-bg-inverse);
    padding: 14px 20px;
    flex-shrink: 0;
  }
</style>
