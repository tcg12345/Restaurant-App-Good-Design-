/**
 * Native (Capacitor / iOS) "Sign in with Apple".
 *
 * Unlike Google — which we route through the system browser (see
 * lib/native-oauth.ts) — Apple expects its own native sheet on iOS
 * (Face ID / the device Apple ID). So instead of a web redirect we:
 *
 *   1. Ask the OS to present the native Apple sheet
 *      (@capacitor-community/apple-sign-in), which returns a signed
 *      identity token (a JWT) for the user.
 *   2. Hand that token to Supabase via `signInWithIdToken`, which verifies
 *      it and creates a session.
 *
 * Nonce handling (required so Supabase can verify the token wasn't
 * replayed): Apple echoes whatever nonce we send it into the token's
 * `nonce` claim, and Supabase compares the SHA-256 of the nonce we give it
 * against that claim. So we send Apple the *hashed* nonce and Supabase the
 * *raw* one.
 *
 * The web build bundles the plugin's no-op web stub; the native code only
 * runs behind the `isNativeRuntime()` guard in AuthContext.
 */

import { SignInWithApple } from '@capacitor-community/apple-sign-in';
import { supabase } from './supabase';

/**
 * The App ID (bundle identifier) that has the "Sign in with Apple"
 * capability enabled. The native identity token's `aud` claim is set to
 * this, so it must be in the Apple provider's allowed Client IDs list in
 * the Supabase dashboard.
 */
const APPLE_CLIENT_ID = 'com.tylergorin.restaurantapp';

/**
 * Required by the plugin's signature. It is NOT used to return the token on
 * native (the token comes back in-process), but Apple still validates it,
 * so we point it at the Supabase callback derived from the project URL.
 */
const APPLE_REDIRECT_URI = `${import.meta.env.VITE_SUPABASE_URL ?? ''}/auth/v1/callback`;

/** Hex-encoded SHA-256 of `input`, via the Web Crypto API. */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** A random, single-use nonce. */
function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Present the native Apple sheet and sign the user into Supabase.
 * Resolves `{ error: null }` on success or on a quiet user cancel, and
 * `{ error: message }` on a real failure.
 */
export async function signInWithAppleNative(): Promise<{ error: string | null }> {
  try {
    const rawNonce = randomNonce();
    const hashedNonce = await sha256Hex(rawNonce);

    const result = await SignInWithApple.authorize({
      clientId: APPLE_CLIENT_ID,
      redirectURI: APPLE_REDIRECT_URI,
      scopes: 'name email',
      // Apple writes this verbatim into the token's `nonce` claim.
      nonce: hashedNonce,
    });

    const idToken = result.response?.identityToken;
    if (!idToken) return { error: 'Apple did not return an identity token.' };

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: idToken,
      // Raw nonce — Supabase hashes it and matches against the token claim.
      nonce: rawNonce,
    });
    if (error) return { error: error.message };

    // Apple returns the user's name ONLY on the very first authorization for
    // this Apple ID + app; subsequent sign-ins return null. So when it's
    // present, persist it to Supabase user metadata immediately (must run
    // after the token exchange creates the session). ProfileSetup reads
    // `user_metadata.full_name` to pre-fill the name — App Store Guideline 4
    // forbids re-asking for the name the Authentication Services framework
    // already provided. `full_name` mirrors the key Google sign-in writes,
    // so ProfileSetup has one unified lookup.
    const givenName = result.response?.givenName ?? null;
    const familyName = result.response?.familyName ?? null;
    const fullName = [givenName, familyName].filter(Boolean).join(' ').trim();
    if (fullName) {
      try {
        await supabase.auth.updateUser({
          data: { full_name: fullName, given_name: givenName, family_name: familyName },
        });
      } catch (metaErr) {
        // A metadata write failure must never turn a successful sign-in into
        // an error — the name simply falls back to the email/username path.
        console.warn('[native-apple] could not persist Apple name:', metaErr);
      }
    }
    return { error: null };
  } catch (e) {
    // The plugin rejects when the user taps Cancel on the sheet — treat
    // that as a no-op rather than an error.
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(msg)) return { error: null };
    console.error('[native-apple] sign-in failed:', e);
    return { error: 'Could not complete Apple sign-in. Please try again.' };
  }
}
