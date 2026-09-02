/**
 * Account lifecycle: in-app account deletion, and attaching a phone
 * number to an existing account.
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
/**
 * Attach a phone number to the signed-in account — step 1 of 2.
 *
 * Texts a 6-digit code to `phone` (which MUST already be E.164 — see
 * lib/phone.ts#toE164). Nothing is stored until `confirmPhoneChange`
 * verifies that code, which is the whole point: an unverified number
 * would let anyone claim someone else's, and once contact syncing is
 * live that number is how friends find you. The verification is what
 * makes discovery-by-phone spoof-proof.
 */
export async function addPhoneNumber(phone: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured) return { ok: false, error: 'Account service is not configured.' };
  try {
    const { error } = await supabase.auth.updateUser({ phone });
    if (error) {
      return {
        ok: false,
        error: /rate|seconds/i.test(error.message)
          ? 'A code was sent recently — wait a minute before requesting another.'
          : error.message,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Step 2 of 2: confirm the texted code and commit the number.
 *
 * `type: 'phone_change'` (not 'sms') — this is an update to an existing
 * signed-in account, not a sign-in.
 */
export async function confirmPhoneChange(phone: string, code: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured) return { ok: false, error: 'Account service is not configured.' };
  try {
    const { error } = await supabase.auth.verifyOtp({ phone, token: code.trim(), type: 'phone_change' });
    if (error) {
      return {
        ok: false,
        error: /expired|invalid|token/i.test(error.message)
          ? 'That code is invalid or expired — request a new one.'
          : error.message,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

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

/** localStorage prefixes that hold app data. `goodeats-` covers ratings,
 *  meals, chats, drafts, recent searches and prefs; `lp-chat-` is the AI
 *  assistant's saved-conversation cache.
 *
 *  The two legacy prefixes stay listed on purpose. lib/storage-migration.ts
 *  COPIES a pre-rename install's keys forward rather than moving them (so a
 *  rollback to an older bundle still finds its data), which leaves the
 *  originals on the device. They hold the same personal data as their
 *  renamed twins, so a purge that skipped them would leave one account's
 *  ratings readable by the next account on the same device. */
const APP_STORAGE_PREFIXES = ['goodeats-', 'lp-chat-', 'gourmad-', 'gourmet-canvas-'];

/** Exact app-data keys that don't share those prefixes. `sb-signed-urls-v1`
 *  is the signed-URL cache: tokens into PRIVATE reel/post buckets, valid for
 *  their full TTL, so they must be purged on any identity change. NOTE: this
 *  is an EXACT match, never an `sb-` prefix — the Supabase auth session lives
 *  under `sb-<ref>-auth-token` and must survive (guardDeviceAccount relies on
 *  it to reload as the new user). */
const APP_STORAGE_KEYS = [SIGNED_URL_CACHE_LS_KEY];

/** Device-scoped keys that survive every purge. `goodeats-preauth-done`
 *  records that this DEVICE has already been through first-launch
 *  onboarding — it is not any user's data, and dropping it re-walls a
 *  returning user with a flow they already completed. The pre-rename spelling
 *  is spared for the same reason: it is the only copy an older bundle can
 *  see, so purging it would re-wall anyone who rolled back. */
const DEVICE_SCOPED_KEYS = ['goodeats-preauth-done', 'gourmad-preauth-done'];

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
      if (key && DEVICE_SCOPED_KEYS.includes(key)) continue;
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
