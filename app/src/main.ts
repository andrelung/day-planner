import { mount } from 'svelte';
import './lib/tokens.css';
import App from './App.svelte';
import { captureInstallPromptEvent } from './lib/installPrompt';

// Registered before mount() since beforeinstallprompt can fire as soon as
// the page loads if install criteria are already met — attaching the
// listener any later risks missing it. Handed to <pwa-install> (App.svelte)
// once it exists; `appinstalled` needs no listener of our own, the library
// handles that internally.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  captureInstallPromptEvent(e);
});

const app = mount(App, {
  target: document.getElementById('app')!,
});

// The static pre-boot splash in index.html has served its purpose now that
// Svelte's own (visually identical) loading screen has taken over.
document.getElementById('splash-viewport')?.remove();

export default app;
