/**
 * Account lifecycle — currently just in-app account deletion.
 *
 * Apple's App Store Review Guideline 5.1.1(v) requires that apps with
 * account creation let users permanently delete the account (and its
 * data) from inside the app. The heavy lifting happens server-side in
 * the `delete-account` Edge Function (service-role key required to
 * remove the auth user); this module is the client wrapper that calls
 * it with the signed-in user's token and then clears local state.
 */
import { supabase, supabaseConfigured } from './supabase';
import { apiUrl, apiHeaders } from './api-base';
import { clearSignedUrlCache, SIGNED_URL_CACHE_LS_KEY } from './signed-url-cache';

/**
 * Permanently delete the signed-in user's account: storage media, every
 * application row (via ON DELETE CASCADE from auth.users), and the auth
 * user itself. On success the local session is cleared (scope 'local' —
 * the server session died with the account) so onAuthStateChange flips
 * the app to the signed-out screen.
 */
export async function deleteAccount(): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured) return { ok: false, error: 'Account service is not configured.' };
  try {
    const res = await fetch(apiUrl('delete-account'), {
      method: 'POST',
      headers: await apiHeaders(),
    });
    if (!res.ok) {
      let message = 'Could not delete the account. Please try again.';
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch { /* non-JSON error body — keep the generic message */ }
      return { ok: false, error: message };
    }
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    return { ok: true };
  } catch {
    return { ok: false, error: 'Network error — check your connection and try again.' };
  }
}

/** localStorage prefixes that hold app data. `gourmad-` covers ratings,
 *  meals, chats, drafts and prefs; `lp-chat-` is the AI assistant's
 *  saved-conversation cache; `gourmet-canvas-` covers recent searches. */
const APP_STORAGE_PREFIXES = ['gourmad-', 'lp-chat-', 'gourmet-canvas-'];

/** Exact app-data keys that don't share those prefixes. `sb-signed-urls-v1`
 *  is the signed-URL cache: tokens into PRIVATE reel/post buckets, valid for
 *  their full TTL, so they must be purged on any identity change. NOTE: this
 *  is an EXACT match, never an `sb-` prefix — the Supabase auth session lives
 *  under `sb-<ref>-auth-token` and must survive (guardDeviceAccount relies on
 *  it to reload as the new user). */
const APP_STORAGE_KEYS = [SIGNED_URL_CACHE_LS_KEY];

/**
 * Drop every app-owned localStorage key (ratings cache, home meals,
 * chats, AI conversations, recents, drafts, signed-URL cache…). Called on
 * sign-out, when entering guest mode, after account deletion, and by
 * AuthContext when a different user signs in on this device — so no personal
 * data leaks across accounts or lingers on the hardware.
 */
export function clearLocalAppData(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (APP_STORAGE_PREFIXES.some((p) => key.startsWith(p)) || APP_STORAGE_KEYS.includes(key))) {
        doomed.push(key);
      }
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch { /* storage unavailable — nothing to clear */ }
  // Also drop the signed-URL cache's IN-MEMORY map: sign-out doesn't reload
  // the page, so the JS heap would otherwise keep serving the prior user's
  // private-bucket URLs.
  clearSignedUrlCache();
}
