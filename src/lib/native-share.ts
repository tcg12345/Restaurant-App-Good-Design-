import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

/**
 * Cross-platform "share externally" used by every share popup's
 * "Share via…" button and the standalone share icons.
 *
 * Why this exists: inside the iOS Capacitor WebView the page is served from
 * `capacitor://localhost/…`, so `window.location.href` (and any share URL
 * derived from `window.location.origin`) is a non-web, localhost URL. iOS
 * rejects those, which made `navigator.share` throw and surface the
 * "Couldn't open the share sheet" error. On native we instead bridge
 * straight to the OS share sheet via @capacitor/share (UIActivityViewController),
 * which needs no transient activation and is immune to the WKWebView Web
 * Share quirks. The web path keeps using navigator.share with a copy fallback.
 */

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'unsupported';

export interface ExternalShareInput {
  title?: string;
  text?: string;
  url?: string;
}

/**
 * Public web origin for the app, e.g. "https://app.example.com". Set this
 * (VITE_PUBLIC_WEB_ORIGIN) to your deployed web domain and in-app share URLs
 * built from `window.location` — which inside the native shell are
 * `capacitor://localhost/…` — get rewritten to real, openable links. Left
 * unset, localhost/native URLs are simply dropped and we share title/text.
 */
const PUBLIC_WEB_ORIGIN = (import.meta.env.VITE_PUBLIC_WEB_ORIGIN as string | undefined)?.replace(/\/+$/, '') || '';

/**
 * Reduce an arbitrary URL down to one the OS share sheet will accept.
 * Public http(s) links pass through; `capacitor://`/localhost links are
 * rewritten onto PUBLIC_WEB_ORIGIN when configured, otherwise dropped so we
 * fall back to sharing title/text (which still opens the sheet).
 */
function shareableUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }
  const isWeb = u.protocol === 'http:' || u.protocol === 'https:';
  const host = u.hostname.toLowerCase();
  const isLocal = !host || host === 'localhost' || host === '127.0.0.1';
  if (isWeb && !isLocal) return u.toString();
  if (PUBLIC_WEB_ORIGIN) return `${PUBLIC_WEB_ORIGIN}${u.pathname}${u.search}${u.hash}`;
  return undefined;
}

function isCancel(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true;
    return /cancel/i.test(err.message);
  }
  return false;
}

async function copyToClipboard(value?: string): Promise<boolean> {
  if (!value) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* clipboard blocked — best effort */
  }
  return false;
}

export async function shareExternally(input: ExternalShareInput): Promise<ShareResult> {
  const url = shareableUrl(input.url);
  const title = input.title?.trim() || undefined;
  const text = input.text?.trim() || undefined;

  if (!title && !text && !url) return 'unsupported';

  // Native — go straight to the OS share sheet through the plugin.
  if (Capacitor.isNativePlatform()) {
    // The plugin requires at least one of url/text/files. When there's no
    // shareable URL, fall back to the title as the body so the sheet still
    // opens with meaningful content.
    const body = text || (!url ? title : undefined);
    try {
      await Share.share({ title, text: body, url, dialogTitle: title });
      return 'shared';
    } catch (err) {
      if (isCancel(err)) return 'cancelled';
      return (await copyToClipboard(url || text || title)) ? 'copied' : 'unsupported';
    }
  }

  // Web — prefer the Web Share API, fall back to copying the link.
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (err) {
      if (isCancel(err)) return 'cancelled';
      /* fall through to clipboard */
    }
  }
  return (await copyToClipboard(url || text || title)) ? 'copied' : 'unsupported';
}
