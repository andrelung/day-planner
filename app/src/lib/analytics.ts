declare global {
  interface Window {
    _paq: unknown[][];
  }
}

const MATOMO_URL = 'https://matomo.withgrips.com/';
const MATOMO_SITE_ID = '22';

function paq(): unknown[][] {
  window._paq = window._paq || [];
  return window._paq;
}

let initialized = false;

/// Loads the Matomo tracker and records one page view for this app launch —
/// call once, as early as possible (see main.ts). Everything else (which
/// user, which actions) rides on top of this same visit via setAnalyticsUserId
/// and trackEvent below; Matomo's own visit/session logic turns repeated
/// launches into "how often does the app get used" without any extra code
/// here.
export function initAnalytics() {
  if (initialized) return;
  initialized = true;
  paq().push(['trackPageView']);
  paq().push(['enableLinkTracking']);
  paq().push(['setTrackerUrl', MATOMO_URL + 'matomo.php']);
  paq().push(['setSiteId', MATOMO_SITE_ID]);
  const script = document.createElement('script');
  script.async = true;
  script.src = MATOMO_URL + 'matomo.js';
  const first = document.getElementsByTagName('script')[0];
  first.parentNode?.insertBefore(script, first);
}

/// Ties the rest of this visit (and every future one from the same
/// browser) to a stable per-human id — Matomo's own visitor id is
/// per-device/browser, so this is what answers "which people actually use
/// the app" rather than "how many browsers". Call as soon as the signed-in
/// Asana address is known (see store.svelte.ts's boot()); pass null to clear
/// it (e.g. on disconnect).
export function setAnalyticsUserId(email: string | null) {
  if (email) paq().push(['setUserId', email]);
  else paq().push(['resetUserId']);
}

/// Records a Matomo custom event for a user interaction/action — category
/// is a broad grouping (e.g. "Task", "Account"), action is what happened
/// (e.g. "Planned", "Disconnected"), name/value are optional extra detail.
export function trackEvent(category: string, action: string, name?: string, value?: number) {
  const entry: unknown[] = ['trackEvent', category, action];
  if (name !== undefined) entry.push(name);
  if (value !== undefined) entry.push(value);
  paq().push(entry);
}
