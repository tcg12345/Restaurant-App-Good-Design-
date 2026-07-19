/**
 * Native (Capacitor / iOS) OAuth sign-in for Supabase.
 *
 * The plain web flow lets the browser navigate to the provider and back to
 * the app's origin, where supabase-js (detectSessionInUrl) finishes the
 * exchange. That can't work inside the native shell — there's no page to
 * redirect back to. Instead we:
 *
 *   1. Ask Supabase for the provider URL but skip the auto-redirect.
 *   2. Open that URL in the system browser sheet (@capacitor/browser).
 *   3. The provider redirects to our custom URL scheme, which iOS routes
 *      back into the app as an `appUrlOpen` event (@capacitor/app).
 *   4. We pull the PKCE `?code=` out of that URL and exchange it for a
 *      session. The code verifier was stored in this web view when step 1
 *      ran, so the exchange happens in the same storage context.
 *
 * If iOS jettisons the app while the user is over in the provider sheet
 * (memory pressure), the redirect COLD-STARTS the app instead: the step-3
 * listener is gone with the old JS context and the `?code=` arrives as the
 * launch URL. `completeOAuthFromLaunchUrl()` (called on boot) covers that
 * path — localStorage outlives the process, so the persisted verifier is
 * still there to finish the exchange.
 *
 * The imports tree-shake to Capacitor's tiny web stubs on the plain web
 * build; the native code only runs behind `isNativeRuntime()`.
 */

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from './supabase';

/** True only inside the Capacitor native shell (iOS / Android). */
export const isNativeRuntime = (): boolean => Capacitor.isNativePlatform();

/**
 * Custom URL scheme the OS routes back to the app after the provider
 * finishes. This must match, exactly:
 *   - the `CFBundleURLSchemes` entry in iOS `Info.plist`
 *     (scheme = the app's bundle id, `com.tylergorin.restaurantapp`), and
 *   - the Redirect URL allow-list in the Supabase dashboard
 *     (Authentication → URL Configuration).
 */
export const NATIVE_OAUTH_REDIRECT = 'com.tylergorin.restaurantapp://auth/callback';

/**
 * Run the OAuth dance inside the native shell. Resolves when the user
 * finishes or dismisses the browser sheet:
 *   - `{ error: null }` on success (a session is now set) or on a silent
 *     user cancel (no session — the caller just stops its spinner).
 *   - `{ error: message }` when the provider or the exchange fails.
 */
export async function signInWithOAuthNative(
  provider: 'google' | 'apple',
): Promise<{ error: string | null }> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: NATIVE_OAUTH_REDIRECT,
      // Don't navigate the app's own web view — we open the URL ourselves.
      skipBrowserRedirect: true,
    },
  });
  if (error) return { error: error.message };
  if (!data?.url) return { error: 'Could not start sign-in. Please try again.' };

  return new Promise<{ error: string | null }>((resolve) => {
    let settled = false;
    let gotCallback = false;

    const finish = (result: { error: string | null }) => {
      if (settled) return;
      settled = true;
      void appListener.then((l) => l.remove());
      void browserListener.then((l) => l.remove());
      resolve(result);
    };

    // Listen before opening the browser so a fast redirect can't be missed.
    const appListener = App.addListener('appUrlOpen', async ({ url }) => {
      if (!url.startsWith(NATIVE_OAUTH_REDIRECT)) return;
      gotCallback = true;
      // Pull the app back to the foreground; the system sheet slides away.
      try { await Browser.close(); } catch { /* may already be closed */ }
      try {
        const parsed = new URL(url);
        const errDesc = parsed.searchParams.get('error_description');
        if (errDesc) { finish({ error: errDesc }); return; }
        const code = parsed.searchParams.get('code');
        if (!code) { finish({ error: 'No authorization code returned.' }); return; }
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
        finish({ error: exErr?.message ?? null });
      } catch {
        finish({ error: 'Could not complete sign-in. Please try again.' });
      }
    });

    // User swiped the sheet away before finishing — treat as a quiet cancel,
    // but only if we haven't already caught the redirect (our own
    // Browser.close above also fires this event).
    const browserListener = Browser.addListener('browserFinished', () => {
      if (!gotCallback) finish({ error: null });
    });

    Browser.open({ url: data.url }).catch((e) => {
      console.error('[native-oauth] Browser.open failed:', e);
      finish({ error: 'Could not open the sign-in page. Please try again.' });
    });
  });
}

/**
 * Finish an OAuth sign-in whose redirect cold-started the app (see the
 * header comment). Called once on boot, before the initial session check.
 *
 * Only acts when BOTH hold:
 *   - the launch URL is our OAuth redirect carrying a `?code=`, and
 *   - the PKCE code verifier supabase-js persisted when the flow started
 *     is still in localStorage. Its absence means the exchange already
 *     happened in a previous life (iOS keeps reporting the same launch URL
 *     on later relaunches) or storage was cleared — either way the code is
 *     unusable, so skip quietly instead of firing a doomed exchange.
 *
 * Returns true only when a session was actually established; the caller's
 * normal boot path (getSession / onAuthStateChange) then picks it up.
 */
export async function completeOAuthFromLaunchUrl(): Promise<boolean> {
  if (!isNativeRuntime()) return false;

  let url: string | null = null;
  try {
    const launch = await App.getLaunchUrl();
    url = launch?.url ?? null;
  } catch {
    return false;
  }
  if (!url || !url.startsWith(NATIVE_OAUTH_REDIRECT)) return false;

  // supabase-js stores the verifier under `sb-<ref>-auth-token-code-verifier`;
  // match by suffix so the project ref never needs hardcoding here.
  let hasVerifier = false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.endsWith('-code-verifier')) { hasVerifier = true; break; }
    }
  } catch {
    return false;
  }
  if (!hasVerifier) return false;

  try {
    const parsed = new URL(url);
    if (parsed.searchParams.get('error_description')) return false;
    const code = parsed.searchParams.get('code');
    if (!code) return false;
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.warn('[native-oauth] launch-url code exchange failed:', error.message);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
