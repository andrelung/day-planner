/// Platform detection for the "add this to your home screen" banner.
///
/// Kept as pure functions over an explicit signals object (rather than
/// reading `navigator`/`matchMedia` directly) so every branch is unit
/// testable — see platform.test.ts. The thin wrappers that actually read
/// the browser globals are at the bottom.
///
/// The pitfalls this exists to get right, none of which are obvious:
///
/// 1. `beforeinstallprompt` fires on DESKTOP Chromium too (macOS, Windows,
///    Linux), not just Android. Treating that event as "this is an
///    installable phone" is what put an "add it to your home screen"
///    banner in front of a Chrome-on-macOS user.
/// 2. iPadOS 13+ Safari requests desktop sites by default, so its user
///    agent says "Macintosh; Intel Mac OS X" with no iPad in it at all.
///    A naive /iphone|ipad|ipod/ test silently misses every modern iPad.
///    The giveaway is a Mac UA that also reports touch points.
/// 3. iOS never fires `beforeinstallprompt` at all — there is no
///    programmatic install on iOS, only the manual Share-sheet action, so
///    that path has to be detected and explained rather than triggered.
/// 4. Every browser engine on iOS is WebKit, and Chrome/Firefox/Edge there
///    identify themselves with their own tokens (CriOS/FxiOS/EdgiOS/OPiOS).
///    They reach the Home Screen action through their own menu rather than
///    Safari's Share button, so the instructions differ.

export type InstallPlatform =
  /// iOS/iPadOS Safari — manual Share → Add to Home Screen.
  | 'ios-safari'
  /// iOS/iPadOS in a non-Safari browser — same capability, different menu.
  | 'ios-other-browser'
  /// Android/Chromium mobile — a real programmatic install prompt exists.
  | 'android'
  /// Installable in principle (desktop Chromium), but this is a
  /// phone-shaped app and "add to your home screen" is the wrong pitch.
  | 'desktop'
  /// Anything else — desktop Safari/Firefox, in-app webviews, etc.
  | 'unsupported';

export interface PlatformSignals {
  userAgent: string;
  /// navigator.maxTouchPoints — the only reliable way to tell an iPadOS
  /// Safari (which claims to be a Mac) from an actual desktop Mac.
  maxTouchPoints: number;
  /// navigator.userAgentData?.mobile. Chromium-only, but that is exactly
  /// where beforeinstallprompt fires, so it's the highest-quality signal
  /// available on the path that matters. Undefined elsewhere.
  uaDataMobile?: boolean;
  /// matchMedia('(pointer: coarse)').matches — fallback mobile signal for
  /// engines without userAgentData.
  coarsePointer?: boolean;
}

export function isIosLike(s: PlatformSignals): boolean {
  if (/iphone|ipod/i.test(s.userAgent)) return true;
  // Any iPad: either an honest "iPad" UA (older iPadOS, or Request Mobile
  // Website) or the desktop-masquerading Mac UA plus touch (pitfall 2).
  // A real Mac reports maxTouchPoints 0 even with a trackpad; the >1 rather
  // than >0 threshold also sidesteps a couple of touchscreen-Windows edge
  // cases that report exactly 1.
  if (/ipad/i.test(s.userAgent)) return true;
  return /macintosh|mac os x/i.test(s.userAgent) && s.maxTouchPoints > 1;
}

/// True only for genuine Safari on iOS — every other iOS browser injects
/// its own token while otherwise still looking like Safari/WebKit.
export function isIosSafari(s: PlatformSignals): boolean {
  if (!isIosLike(s)) return false;
  return !/crios|fxios|edgios|opios|chrome|firefox/i.test(s.userAgent);
}

/// Whether this is a phone/tablet-shaped device at all. Prefers the
/// Client Hints signal, falls back to a coarse pointer, and only then to
/// sniffing the UA string.
export function isMobileLike(s: PlatformSignals): boolean {
  if (isIosLike(s)) return true;
  if (typeof s.uaDataMobile === 'boolean') return s.uaDataMobile;
  if (typeof s.coarsePointer === 'boolean') return s.coarsePointer;
  return /android|mobile|silk|kindle|blackberry|opera mini|iemobile/i.test(s.userAgent);
}

export function detectInstallPlatform(s: PlatformSignals): InstallPlatform {
  if (isIosLike(s)) return isIosSafari(s) ? 'ios-safari' : 'ios-other-browser';
  if (/android/i.test(s.userAgent)) return 'android';
  if (isMobileLike(s)) return 'android';
  return 'desktop';
}

// --- browser-global wrappers ---

export function readPlatformSignals(): PlatformSignals {
  const uaData = (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData;
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    uaDataMobile: typeof uaData?.mobile === 'boolean' ? uaData.mobile : undefined,
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches,
  };
}

/// Already running as an installed app — nothing left to offer. The
/// `navigator.standalone` half is iOS-only and predates display-mode.
export function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}
