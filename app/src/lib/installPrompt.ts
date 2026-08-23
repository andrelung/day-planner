/// Captured as early as possible in main.ts, before Svelte even mounts —
/// `beforeinstallprompt` can fire immediately on load if install criteria
/// are already met, and <pwa-install> (see App.svelte) only catches an
/// event that fires *after* it connects to the DOM, unless handed one that
/// already fired. Passed to the component's `externalPromptEvent` property
/// once it exists — the library's own recommended pattern for framework
/// integration (see its README's "Async mode" section).
export let capturedInstallPromptEvent: Event | null = null;

export function captureInstallPromptEvent(e: Event) {
  capturedInstallPromptEvent = e;
}
