<script lang="ts">
  import { planner } from '../store.svelte';
  import { fmtHours } from '../format';
  import Icon from '../components/Icon.svelte';
  import IconButton from '../components/IconButton.svelte';
  import Stepper from '../components/Stepper.svelte';
  import Button from '../components/Button.svelte';
  import Badge from '../components/Badge.svelte';

  const focusRaw = $derived(planner.focusTaskRaw);
  const hasFocusTask = $derived(planner.hasFocusTask);
  const restTasks = $derived(hasFocusTask ? planner.tasks.filter((t) => t.id !== focusRaw!.id) : []);

  const badgeTone = $derived(focusRaw?.dueHour ? 'wrong' : 'neutral');
  const badgeLabel = $derived(focusRaw?.dueHour ? `Overdue · ${focusRaw.dueHour}` : 'Unplanned');

  const cardTransform = $derived(`translateX(${planner.dragX}px) rotate(${planner.dragX / 20}deg)`);
  const cardTransition = $derived(planner.dragging ? 'none' : 'transform 220ms cubic-bezier(0.4,0,0.2,1)');
  const planTodayRevealOpacity = $derived(Math.max(0, Math.min(1, planner.dragX / 90)));
  const planLaterRevealOpacity = $derived(Math.max(0, Math.min(1, -planner.dragX / 90)));

  const navDisabled = $derived(planner.tasks.length <= 1);
</script>

<div class="screen">
  <div class="header">
    <IconButton icon="menu" title="Overview" onclick={() => planner.openOverview()} />
    <div class="title">Plan your day</div>
    <IconButton icon="settings" title="Settings" onclick={() => planner.openSettings()} />
  </div>

  {#if planner.showInstallBanner}
    <div class="install-banner">
      <div class="install-banner__text">
        {#if planner.installBannerKind === 'ios'}
          <div class="install-banner__title">Add to Home Screen</div>
          <div class="install-banner__sub">Tap the Share icon, then "Add to Home Screen"</div>
        {:else}
          <div class="install-banner__title">Install Day Planner</div>
          <div class="install-banner__sub">Add it to your home screen for quick access</div>
        {/if}
      </div>
      {#if planner.installBannerKind === 'android'}
        <Button variant="primary" size="sm" onclick={() => planner.promptInstall()}>Install</Button>
      {/if}
      <IconButton
        icon="close"
        title="Dismiss"
        size={28}
        iconSize={14}
        color="var(--color-text-inverse)"
        borderColor="transparent"
        onclick={() => planner.dismissInstallBanner()}
      />
    </div>
  {/if}

  <div class="up-next-wrap">
    {#if restTasks.length > 0}
      <div class="section-label">Up next</div>
      {#each restTasks as t (t.id)}
        <div class="up-next-row">
          <div
            class="up-next-row__main"
            role="button"
            tabindex="0"
            onclick={() => planner.selectFocus(t.id)}
            onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && planner.selectFocus(t.id)}
          >
            <div class="dot" style="background:{t.dueHour ? 'var(--color-feedback-wrong)' : 'var(--color-border-strong)'};"></div>
            <div class="up-next-row__text">
              <div class="up-next-row__name">{t.name}</div>
              <div class="up-next-row__project">{t.project}</div>
            </div>
            {#if planner.editingRestId !== t.id}
              <button
                class="hour-edit"
                onclick={(e) => {
                  e.stopPropagation();
                  planner.onEditRestHours(t.id, t.hours);
                }}
              >
                <div class="hour-edit__label">{fmtHours(t.hours)}</div>
                <Icon name="pencil" size={11} color="var(--color-text-muted)" />
              </button>
            {/if}
          </div>
          {#if planner.editingRestId === t.id}
            <div class="inline-editor">
              <Stepper
                valueText={String(planner.restHoursDraft)}
                ondec={() => planner.decRestHour()}
                oninc={() => planner.incRestHour()}
                oninput={(v) => planner.onRestHoursInput(v)}
              />
              <Button variant="primary" size="sm" onclick={() => planner.confirmRestHours(t.id)}>Save</Button>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  {#if hasFocusTask && focusRaw}
    <div class="queue-row">
      <div class="queue-label">{planner.queueLabel}</div>
      <div class="queue-nav" style="opacity:{navDisabled ? 0.4 : 1}; pointer-events:{navDisabled ? 'none' : 'auto'};">
        <IconButton icon="chevron-left" title="Previous task" size={32} iconSize={16} onclick={() => planner.goPrev()} />
        <IconButton icon="chevron-right" title="Next task" size={32} iconSize={16} onclick={() => planner.goNext()} />
      </div>
    </div>

    <div class="focus-wrap">
      <div class="reveal reveal--later" style="opacity:{planLaterRevealOpacity};">
        <div class="reveal__label">Plan later</div>
      </div>
      <div class="reveal reveal--today" style="opacity:{planTodayRevealOpacity};">
        <div class="reveal__label">Plan today</div>
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="focus-card-drag"
        style="transform:{cardTransform}; transition:{cardTransition};"
        onpointerdown={(e) => planner.onCardPointerDown(e)}
        onpointermove={(e) => planner.onCardPointerMove(e)}
        onpointerup={() => planner.onCardPointerUp()}
        onpointercancel={() => planner.onCardPointerUp()}
      >
        <div class="focus-card">
          <div class="focus-card__top">
            <Badge tone={badgeTone}>{badgeLabel}</Badge>
            <IconButton
              icon="external-link"
              title="Open in Asana"
              size={32}
              iconSize={16}
              color="var(--color-text-muted)"
              onclick={() => planner.openAsana(focusRaw!)}
            />
          </div>

          <div class="focus-card__name">{focusRaw.name}</div>
          <div class="focus-card__project">{focusRaw.project}</div>

          {#if planner.editingHours}
            <div class="inline-editor inline-editor--card">
              <Stepper
                valueText={String(planner.hoursDraft)}
                ondec={() => planner.decHour()}
                oninc={() => planner.incHour()}
                oninput={(v) => planner.onHoursDraftInput(v)}
              />
              <Button variant="primary" size="sm" onclick={() => planner.confirmHours()}>Save</Button>
            </div>
          {:else}
            <button class="estimate-row" onclick={() => planner.onEditHours()}>
              <div class="estimate-row__label">Estimate</div>
              <div class="estimate-row__value">{fmtHours(focusRaw.hours)}</div>
              <Icon name="pencil" size={13} color="var(--color-text-muted)" />
            </button>
          {/if}

          <div class="focus-card__actions">
            <Button variant="secondary" size="md" fullWidth onclick={() => planner.openPlanLater()}>Plan later</Button>
            <Button variant="primary" size="md" fullWidth onclick={() => planner.openPlanToday()}>Plan today</Button>
          </div>
          <div class="focus-card__actions focus-card__actions--ghost">
            <Button variant="ghost" size="sm" fullWidth onclick={() => planner.startBreak()}>Split into a part</Button>
            <Button variant="ghost" size="sm" fullWidth onclick={() => planner.removeDueDate()}>Remove due date</Button>
          </div>
        </div>
      </div>
    </div>
  {:else}
    <div class="empty-state">
      <Icon name="check-circle" size={32} color="var(--color-feedback-correct)" />
      <div class="empty-state__title">All caught up</div>
      <div class="empty-state__sub">Nothing left to plan right now.</div>
    </div>
  {/if}

  {#if hasFocusTask}
    <button class="capacity-badge" style="background:{planner.todayBadgeBg};" onclick={() => planner.openOverview()}>
      {planner.todayBadgeLabel}
    </button>
  {/if}
</div>

<style>
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--color-bg-page);
    overflow: hidden;
    position: relative;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px 4px;
    flex-shrink: 0;
  }
  .title {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 16px;
    color: var(--color-text-primary);
  }
  .install-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 8px 20px 0;
    padding: 10px 12px;
    background: var(--color-bg-inverse);
    border-radius: var(--radius-md);
    flex-shrink: 0;
  }
  .install-banner__text {
    flex: 1;
    min-width: 0;
  }
  .install-banner__title {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 13px;
    color: var(--color-text-inverse);
  }
  .install-banner__sub {
    font-family: var(--font-family-base);
    font-size: 11px;
    color: var(--color-text-inverse);
    opacity: 0.75;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .up-next-wrap {
    padding: 16px 20px 8px;
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .section-label {
    font-family: var(--font-family-base);
    font-size: 11px;
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
    margin-bottom: 8px;
  }
  .up-next-row {
    padding: 12px 4px;
    border-bottom: 1px solid var(--color-border);
  }
  .up-next-row__main {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    width: 100%;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    flex-shrink: 0;
  }
  .up-next-row__text {
    flex: 1;
    min-width: 0;
  }
  .up-next-row__name {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 13px;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .up-next-row__project {
    font-family: var(--font-family-base);
    font-size: 11px;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hour-edit {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }
  .hour-edit__label {
    font-family: var(--font-family-base);
    font-size: 11px;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-muted);
  }
  .inline-editor {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    padding: 8px 10px;
    background: var(--color-bg-page);
    border-radius: var(--radius-md);
  }
  .inline-editor--card {
    margin-top: 14px;
    padding: 10px 12px;
  }
  .queue-row {
    padding: 8px 20px 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .queue-label {
    font-family: var(--font-family-base);
    font-size: 13px;
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .queue-nav {
    display: flex;
    gap: 2px;
  }
  .focus-wrap {
    padding: 10px 20px 16px;
    position: relative;
    flex-shrink: 0;
  }
  .reveal {
    position: absolute;
    inset: 0;
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    padding: 0 24px;
  }
  .reveal--later {
    background: var(--color-brand-primary);
  }
  .reveal--today {
    background: var(--grips-highlight-yellow);
    justify-content: flex-end;
  }
  .reveal__label {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-extrabold);
    font-size: 18px;
  }
  .reveal--later .reveal__label {
    color: var(--color-text-inverse);
  }
  .reveal--today .reveal__label {
    color: var(--grips-dark-blue);
  }
  .focus-card-drag {
    position: relative;
    touch-action: pan-y;
  }
  .focus-card {
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    font-family: var(--font-family-base);
  }
  .focus-card__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .focus-card__name {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 18px;
    line-height: 1.2;
    color: var(--color-text-primary);
    margin-top: 2px;
  }
  .focus-card__project {
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .estimate-row {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    color: var(--color-text-muted);
    background: none;
    border: none;
    padding: 0;
    width: fit-content;
  }
  .estimate-row__label {
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--color-text-muted);
  }
  .estimate-row__value {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 15px;
    color: var(--color-text-primary);
  }
  .focus-card__actions {
    display: flex;
    gap: 8px;
  }
  .focus-card__actions--ghost {
    margin-top: -2px;
  }
  .empty-state {
    padding: 20px 20px 24px;
    text-align: center;
    flex-shrink: 0;
  }
  .empty-state__title {
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 18px;
    color: var(--color-text-primary);
    margin-top: 10px;
  }
  .empty-state__sub {
    font-family: var(--font-family-base);
    font-size: 13px;
    color: var(--color-text-muted);
    margin-top: 4px;
  }
  .capacity-badge {
    position: absolute;
    right: 20px;
    bottom: 20px;
    width: 56px;
    height: 56px;
    border-radius: 999px;
    color: var(--color-text-inverse);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-overlay-sm);
    cursor: pointer;
    font-family: var(--font-family-base);
    font-weight: var(--font-weight-bold);
    font-size: 13px;
    text-align: center;
    line-height: 1.1;
    border: none;
  }
</style>
