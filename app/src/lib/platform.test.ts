import { describe, expect, it } from 'vitest';
import { detectInstallPlatform, isIosLike, isIosSafari, isMobileLike, type PlatformSignals } from './platform';

// Real user-agent strings, so these stay honest about what browsers
// actually send rather than what we assume they send.
const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1',
  // iPadOS 13+ with the default "Request Desktop Website" — note there is
  // no "iPad" anywhere in this string.
  ipadDesktopMode:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
};

const signals = (userAgent: string, over: Partial<PlatformSignals> = {}): PlatformSignals => ({
  userAgent,
  maxTouchPoints: 0,
  ...over,
});

describe('isIosLike', () => {
  it('detects iPhone', () => {
    expect(isIosLike(signals(UA.iphoneSafari))).toBe(true);
  });

  it('detects an iPadOS 13+ Safari masquerading as a Mac — the pitfall a naive /ipad/ test misses', () => {
    expect(isIosLike(signals(UA.ipadDesktopMode, { maxTouchPoints: 5 }))).toBe(true);
  });

  it('does not mistake a real Mac for an iPad', () => {
    // Same UA string as the iPad above — only maxTouchPoints separates them.
    expect(isIosLike(signals(UA.macSafari, { maxTouchPoints: 0 }))).toBe(false);
    expect(isIosLike(signals(UA.macChrome, { maxTouchPoints: 0 }))).toBe(false);
  });

  it('does not treat Android or Windows as iOS', () => {
    expect(isIosLike(signals(UA.androidChrome))).toBe(false);
    expect(isIosLike(signals(UA.windowsChrome))).toBe(false);
  });
});

describe('isIosSafari', () => {
  it('is true for real Safari on iPhone', () => {
    expect(isIosSafari(signals(UA.iphoneSafari))).toBe(true);
  });

  it('is false for Chrome on iOS, which reaches the action through its own menu', () => {
    expect(isIosSafari(signals(UA.iphoneChrome))).toBe(false);
  });

  it('is false for anything not iOS at all', () => {
    expect(isIosSafari(signals(UA.macSafari))).toBe(false);
  });
});

describe('isMobileLike', () => {
  it('trusts the Client Hints mobile flag when present', () => {
    expect(isMobileLike(signals(UA.androidChrome, { uaDataMobile: true }))).toBe(true);
    expect(isMobileLike(signals(UA.macChrome, { uaDataMobile: false }))).toBe(false);
  });

  it('falls back to a coarse pointer when Client Hints are unavailable', () => {
    expect(isMobileLike(signals(UA.androidChrome, { coarsePointer: true }))).toBe(true);
  });

  it('falls back to the UA string when neither is available', () => {
    expect(isMobileLike(signals(UA.androidChrome))).toBe(true);
    expect(isMobileLike(signals(UA.windowsChrome))).toBe(false);
  });
});

describe('detectInstallPlatform', () => {
  it('classifies desktop Chrome as desktop — the reported bug, where a phone-shaped install banner appeared on Chrome for macOS', () => {
    expect(detectInstallPlatform(signals(UA.macChrome, { uaDataMobile: false }))).toBe('desktop');
    expect(detectInstallPlatform(signals(UA.windowsChrome, { uaDataMobile: false }))).toBe('desktop');
  });

  it('classifies the iOS browsers apart, since their instructions differ', () => {
    expect(detectInstallPlatform(signals(UA.iphoneSafari))).toBe('ios-safari');
    expect(detectInstallPlatform(signals(UA.iphoneChrome))).toBe('ios-other-browser');
    expect(detectInstallPlatform(signals(UA.ipadDesktopMode, { maxTouchPoints: 5 }))).toBe('ios-safari');
  });

  it('classifies Android Chrome as android', () => {
    expect(detectInstallPlatform(signals(UA.androidChrome, { uaDataMobile: true }))).toBe('android');
  });
});
