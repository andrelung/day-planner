import { mount } from 'svelte';
import './lib/tokens.css';
import App from './App.svelte';
import { planner } from './lib/store.svelte';

// Registered before mount() since beforeinstallprompt can fire as soon as
// the page loads if install criteria are already met — attaching the
// listener any later risks missing it.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  planner.captureInstallPrompt(e as unknown as { prompt(): void; userChoice: Promise<{ outcome: string }> });
});
window.addEventListener('appinstalled', () => {
  planner.onAppInstalled();
});

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
