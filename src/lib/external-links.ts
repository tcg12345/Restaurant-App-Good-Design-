import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

/**
 * Public support + legal pages, hosted on GitHub Pages from the
 * standalone `gourmetcanvas-support` repo (separate from the app source).
 * These same URLs are what's filed under App Store Connect's Support URL
 * and Privacy Policy URL, so the in-app links and the store listing point
 * at exactly one canonical place.
 */
export const SUPPORT_URL = 'https://tcg12345.github.io/gourmetcanvas-support/support';
export const PRIVACY_URL = 'https://tcg12345.github.io/gourmetcanvas-support/privacy';
export const TERMS_URL = 'https://tcg12345.github.io/gourmetcanvas-support/terms';

/**
 * Open an external URL the native way. On iOS/Capacitor this presents an
 * in-app SFSafariViewController sheet (the user stays in the app and can
 * swipe back) rather than cold-switching to Safari; on the web it opens a
 * new tab. Mirrors how native-oauth.ts uses @capacitor/browser.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await Browser.open({ url });
      return;
    } catch (err) {
      console.warn('[external-links] Browser.open failed, falling back:', err);
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
