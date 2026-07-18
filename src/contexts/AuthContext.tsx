import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { isNativeRuntime, signInWithOAuthNative, completeOAuthFromLaunchUrl } from '../lib/native-oauth';
import { signInWithAppleNative } from '../lib/native-apple';
import { fetchProfile, getPendingRequests, type UserProfile } from '../lib/supabase-community';
import { isAppAdmin } from '../lib/supabase-verification';
import { clearLocalAppData } from '../lib/supabase-account';
import type { User, Session } from '@supabase/supabase-js';

/** Race a promise against a timeout. Used to make sure a hung Supabase
 *  call can't park the app on the splash forever. The supabase-js client
 *  doesn't impose its own timeout, so we add one at the call sites that
 *  block first-paint (session check, profile load) and the sign-in
 *  email-existence probe. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms);
    promise.then(
      (value) => { clearTimeout(id); resolve(value); },
      (err) => { clearTimeout(id); reject(err); },
    );
  });
}

interface AuthContextType {
  isSignedIn: boolean;
  /** True when the user chose "Browse without an account". Lets App.tsx
   *  render the app for a signed-out guest (App Store Guideline 5.1.1(v) —
   *  non-account features must be reachable without registering). Cleared
   *  automatically once a real session appears, and on sign-out. */
  isGuest: boolean;
  /** Enter guest mode (from the Auth screen's "Browse without an account"). */
  continueAsGuest: () => void;
  user: User | null;
  profile: UserProfile | null;
  profileComplete: boolean;
  /** True when the LAST profile fetch failed (network/timeout) — meaning we
   *  don't actually know whether a profile row exists. App.tsx must show a
   *  retry screen in that state, never ProfileSetup: re-onboarding an
   *  existing user overwrites their real profile (bio wiped, private flipped
   *  public). Cleared by any successful fetch. */
  profileError: boolean;
  /** True while a profile fetch is in flight AFTER initial boot (e.g. right
   *  after sign-in). Lets App.tsx hold the splash instead of flashing
   *  ProfileSetup before the row has arrived. */
  profileLoading: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  /** `needsVerification` is true when Supabase created the account but
   *  requires the emailed 6-digit code before a session exists (project
   *  has "Confirm email" enabled). The caller shows the code screen. */
  signUp: (email: string, password: string) => Promise<{ error: string | null; needsVerification?: boolean }>;
  /** Start the verify-first email signup: sends a 6-digit code to the
   *  address (creating the account if needed) WITHOUT a password —
   *  supabase.auth.signInWithOtp. Always sends, independent of the
   *  project's "Confirm email" setting. */
  startEmailSignup: (email: string) => Promise<{ error: string | null }>;
  /** Confirm the emailed 6-digit code. On success Supabase creates the
   *  session and onAuthStateChange takes over. Pass `expectPasswordSetup`
   *  on the verify-first signup path so the app keeps showing the
   *  choose-password screen (needsPasswordSetup) instead of jumping
   *  straight into profile setup. */
  verifyEmailCode: (email: string, code: string, expectPasswordSetup?: boolean) => Promise<{ error: string | null; passwordSetupNeeded?: boolean }>;
  /** Re-send the signup verification email (code + link). */
  resendVerificationCode: (email: string) => Promise<{ error: string | null }>;
  /** True while a verified-by-code signup still needs its password chosen.
   *  App.tsx keeps rendering the Auth screen (setpassword step) until
   *  completePasswordSetup clears it. Survives an app relaunch. */
  needsPasswordSetup: boolean;
  /** Set the password for a code-verified signup (auth.updateUser). */
  completePasswordSetup: (password: string) => Promise<{ error: string | null }>;
  /** Start an OAuth sign-in (e.g. Google). Redirects the browser to the
   *  provider and back to the app, where the session is picked up by
   *  `onAuthStateChange`. Returns an error only when the redirect itself
   *  can't be started. */
  signInWithOAuth: (provider: 'google' | 'apple') => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  pendingRequestCount: number;
  refreshPendingRequests: () => Promise<void>;
  /** True when this account is on the app_admins allowlist (verification
   *  reviewer). Drives the admin-only settings entry + /admin/verification;
   *  real enforcement is server-side (RLS + RPC checks). */
  isAdmin: boolean;
  /** Tri-state admin check: 'unknown' until the allowlist probe resolves
   *  (it runs AFTER profile load, up to ~8 s on slow networks), then
   *  true/false. Admin-gated pages must show a spinner while 'unknown' —
   *  gating on !isAdmin alone flashed "not available" at real admins. */
  adminChecked: boolean | 'unknown';
  /** Probe whether an email is already registered. Tri-state on purpose:
   *  'yes' / 'no' when the check succeeds, and 'unknown' when it fails
   *  (RPC error / timeout). Callers MUST treat 'unknown' as "couldn't tell,
   *  ask the user to retry" — assuming "new user" on failure railroads a
   *  returning user into the signup flow, which then resets their password. */
  checkEmailExists: (email: string) => Promise<'yes' | 'no' | 'unknown'>;
}

/** Which user this device's localStorage caches belong to. */
const ACTIVE_USER_KEY = 'gourmad-active-user';

/** Persisted flag for "Browse without an account" so guest mode survives
 *  navigation and reloads (App.tsx would otherwise re-show Auth on every
 *  paint because there's no Supabase session). */
const GUEST_MODE_KEY = 'gourmad-guest-mode';

/** Set between OTP verification and password creation on the verify-first
 *  signup path, so a relaunch mid-flow still lands on the choose-password
 *  screen instead of leaving a passwordless account behind. */
const NEEDS_PASSWORD_KEY = 'gourmad-needs-password';

/**
 * Cross-account leak guard. Several stores cache personal data in
 * localStorage under fixed keys (chats, home meals, recipes, drafts…);
 * if a DIFFERENT user signs in on the same device, the providers would
 * boot from the previous account's cache and then merge it into the new
 * account's cloud data. So: on an account switch we purge all app-local
 * storage and reload before any provider acts on the new identity. The
 * Supabase session lives under its own `sb-*` key and survives the
 * purge, so the reload comes back signed in as the new user with clean
 * caches. Same-user re-logins keep their offline cache untouched.
 *
 * Returns true when a switch was detected and a reload is in flight —
 * the caller should stop (not propagate the user into React state).
 */
function guardDeviceAccount(newUserId: string): boolean {
  try {
    const prev = localStorage.getItem(ACTIVE_USER_KEY);
    if (prev && prev !== newUserId) {
      clearLocalAppData();
      localStorage.setItem(ACTIVE_USER_KEY, newUserId);
      window.location.reload();
      return true;
    }
    localStorage.setItem(ACTIVE_USER_KEY, newUserId);
  } catch { /* storage unavailable — nothing cached, nothing to leak */ }
  return false;
}

const AuthContext = createContext<AuthContextType>({
  isSignedIn: false,
  isGuest: false,
  continueAsGuest: () => {},
  user: null,
  profile: null,
  profileComplete: false,
  profileError: false,
  profileLoading: false,
  loading: true,
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null }),
  startEmailSignup: async () => ({ error: null }),
  verifyEmailCode: async () => ({ error: null }),
  resendVerificationCode: async () => ({ error: null }),
  needsPasswordSetup: false,
  completePasswordSetup: async () => ({ error: null }),
  signInWithOAuth: async () => ({ error: null }),
  signOut: async () => {},
  refreshProfile: async () => {},
  pendingRequestCount: 0,
  refreshPendingRequests: async () => {},
  isAdmin: false,
  adminChecked: 'unknown',
  checkEmailExists: async () => 'unknown',
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileError, setProfileError] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState<boolean | 'unknown'>('unknown');
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState<boolean>(() => {
    try { return localStorage.getItem(NEEDS_PASSWORD_KEY) === '1'; } catch { return false; }
  });
  const markNeedsPassword = useCallback((on: boolean) => {
    setNeedsPasswordSetup(on);
    try {
      if (on) localStorage.setItem(NEEDS_PASSWORD_KEY, '1');
      else localStorage.removeItem(NEEDS_PASSWORD_KEY);
    } catch { /* storage unavailable */ }
  }, []);
  const [isGuest, setIsGuest] = useState<boolean>(() => {
    try { return localStorage.getItem(GUEST_MODE_KEY) === '1'; } catch { return false; }
  });

  const continueAsGuest = useCallback(() => {
    // Purge any app data a previous signed-in user left on this device BEFORE
    // raising the guest flag (clearLocalAppData drops gourmad-* keys, which
    // includes GUEST_MODE_KEY — so clear first, then set it), so a guest never
    // sees the prior account's ratings / meals / cached private-bucket URLs.
    clearLocalAppData();
    try { localStorage.setItem(GUEST_MODE_KEY, '1'); } catch { /* storage unavailable */ }
    setIsGuest(true);
  }, []);

  // Drop guest mode the moment a real session exists (or is gone after
  // sign-out) so the flag never lingers into a signed-in session.
  const clearGuest = useCallback(() => {
    try { localStorage.removeItem(GUEST_MODE_KEY); } catch { /* noop */ }
    setIsGuest(false);
  }, []);

  const loadProfile = useCallback(async (userId: string) => {
    setProfileLoading(true);
    try {
      // fetchProfile resolves null ONLY when no profile row exists, and
      // throws on network/timeout failure. The distinction is load-bearing:
      // profile=null with no error routes the user into ProfileSetup, whose
      // save overwrites the real row — so a transient failure must NEVER
      // read as "no profile". On failure we keep whatever profile state we
      // already had and raise profileError; App.tsx shows a retry screen.
      const p = await withTimeout(fetchProfile(userId), 8000, 'fetchProfile');
      setProfile(p);
      setProfileError(false);
    } catch {
      setProfileError(true);
    } finally {
      setProfileLoading(false);
    }
    try {
      const reqs = await withTimeout(getPendingRequests(userId), 8000, 'getPendingRequests');
      setPendingRequestCount(reqs.length);
    } catch {
      setPendingRequestCount(0);
    }
    try {
      const admin = await withTimeout(isAppAdmin(), 8000, 'isAppAdmin');
      setIsAdmin(admin);
      setAdminChecked(admin);
    } catch {
      // The probe itself failed (timeout) — resolve to false so gated pages
      // don't spin forever, but only after the full timeout, never a flash.
      setIsAdmin(false);
      setAdminChecked(false);
    }
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      setAdminChecked(false);
      return;
    }

    let mounted = true;

    (async () => {
      try {
        // Native cold start caused BY the OAuth redirect (iOS killed the app
        // while the user was in the provider sheet): finish the PKCE code
        // exchange BEFORE the session check, or the completed sign-in
        // evaporates and the user lands back on the auth screen. No-op on
        // web and on ordinary launches.
        if (isNativeRuntime()) {
          try {
            await withTimeout(completeOAuthFromLaunchUrl(), 8000, 'oauth launch-url');
          } catch { /* proceed with the normal signed-out boot */ }
        }
        const { data: { session } } = await withTimeout(
          supabase.auth.getSession(),
          6000,
          'auth.getSession',
        );
        if (!mounted) return;
        const u = session?.user ?? null;
        // Account switched on this device — purge stale caches + reload
        // before any provider sees the new identity.
        if (u && guardDeviceAccount(u.id)) return;
        setUser(u);
        if (u) { clearGuest(); await loadProfile(u.id); }
      } catch {
        // Session check failed / timed out — fall through to signed-out so
        // the splash clears and the user lands on the auth screen instead
        // of being stuck.
      }
      if (mounted) setLoading(false);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: string, session: Session | null) => {
        const u = session?.user ?? null;
        if (u && guardDeviceAccount(u.id)) return;
        setUser(u);
        if (u) { clearGuest(); loadProfile(u.id); }
        else { setProfile(null); setProfileError(false); setPendingRequestCount(0); setIsAdmin(false); setAdminChecked(false); }
      }
    );

    return () => { mounted = false; subscription.unsubscribe(); };
  }, [loadProfile, clearGuest]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabaseConfigured) return { error: 'Authentication is not configured' };
    try {
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        12000,
        'auth.signInWithPassword',
      );
      if (!error) markNeedsPassword(false); // password exists — flag is stale
      return { error: error?.message ?? null };
    } catch {
      return { error: 'Sign in took too long. Check your connection and try again.' };
    }
  }, [markNeedsPassword]);

  const signUp = useCallback(async (email: string, password: string) => {
    if (!supabaseConfigured) return { error: 'Authentication is not configured' };
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signUp({ email, password }),
        12000,
        'auth.signUp',
      );
      if (error) return { error: error.message };
      // With "Confirm email" enabled Supabase returns a user but NO session
      // until the emailed code/link is used — surface that so the UI can
      // show the enter-code screen. (Confirmation disabled → session exists
      // and the app proceeds immediately, as before.)
      return { error: null, needsVerification: !data.session };
    } catch {
      return { error: 'Sign up took too long. Check your connection and try again.' };
    }
  }, []);

  const startEmailSignup = useCallback(async (email: string) => {
    if (!supabaseConfigured) return { error: 'Authentication is not configured' };
    try {
      const { error } = await withTimeout(
        supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }),
        12000,
        'auth.signInWithOtp',
      );
      if (error) {
        return {
          error: /rate|seconds/i.test(error.message)
            ? 'A code was sent recently — wait a minute before requesting another.'
            : error.message,
        };
      }
      return { error: null };
    } catch {
      return { error: 'Could not send the code. Check your connection and try again.' };
    }
  }, []);

  // After an OTP verification the caller may need to know whether the
  // just-signed-in account already has a password (has_password RPC,
  // migration 049), so the email-first signup path doesn't force a
  // choose-password screen — which would RESET a returning user's password —
  // onto an account that already has one. Fails SAFE: on any RPC error we
  // return true ("assume it has a password") so we never overwrite silently.
  const accountHasPassword = useCallback(async (): Promise<boolean> => {
    if (!supabaseConfigured) return true;
    try {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.rpc('has_password')),
        8000,
        'has_password',
      );
      if (error) return true;
      return data !== false;
    } catch {
      return true;
    }
  }, []);

  const verifyEmailCode = useCallback(async (email: string, code: string, expectPasswordSetup = false) => {
    if (!supabaseConfigured) return { error: 'Authentication is not configured' };
    // Raise the flag BEFORE the session lands: onAuthStateChange fires inside
    // verifyOtp, and App must already know to hold the Auth screen for the
    // choose-password step (otherwise ProfileSetup flashes in).
    if (expectPasswordSetup) markNeedsPassword(true);
    const attempt = (type: 'email' | 'signup') =>
      withTimeout(
        supabase.auth.verifyOtp({ email, token: code.trim(), type }),
        12000,
        'auth.verifyOtp',
      );
    try {
      // 'email' covers OTP signups/sign-ins on supabase-js v2; fall back to
      // 'signup' for accounts created via the legacy password-first path.
      let { error } = await attempt('email');
      if (error) ({ error } = await attempt('signup'));
      if (error) {
        if (expectPasswordSetup) markNeedsPassword(false);
        return { error: error.message };
      }
      // Verified — the session now exists. On the signup path we assumed a
      // NEW (passwordless) account. If it actually already has a password
      // (checkEmailExists returned a false 'no', or the accounts raced), do
      // NOT force a password reset: clear the flag and sign in normally.
      if (expectPasswordSetup) {
        const hasPassword = await accountHasPassword();
        if (hasPassword) {
          markNeedsPassword(false);
          return { error: null, passwordSetupNeeded: false };
        }
        return { error: null, passwordSetupNeeded: true };
      }
      return { error: null };
    } catch {
      if (expectPasswordSetup) markNeedsPassword(false);
      return { error: 'Verification took too long. Check your connection and try again.' };
    }
  }, [markNeedsPassword, accountHasPassword]);

  const completePasswordSetup = useCallback(async (password: string) => {
    if (!supabaseConfigured) return { error: 'Authentication is not configured' };
    try {
      const { error } = await withTimeout(
        supabase.auth.updateUser({ password }),
        12000,
        'auth.updateUser',
      );
      if (error) return { error: error.message };
      markNeedsPassword(false);
      return { error: null };
    } catch {
      return { error: 'Saving your password took too long. Try again.' };
    }
  }, [markNeedsPassword]);

  const resendVerificationCode = useCallback(async (email: string) => {
    if (!supabaseConfigured) return { error: 'Authentication is not configured' };
    try {
      const { error } = await withTimeout(
        supabase.auth.resend({ type: 'signup', email }),
        12000,
        'auth.resend',
      );
      return { error: error?.message ?? null };
    } catch {
      return { error: 'Could not resend the code. Check your connection and try again.' };
    }
  }, []);

  const signInWithOAuth = useCallback(async (provider: 'google' | 'apple') => {
    if (!supabaseConfigured) return { error: 'Authentication is not configured' };
    // Native shell: Apple gets its own native sheet (identity-token flow);
    // Google goes through the system browser + deep-link exchange.
    if (isNativeRuntime()) {
      return provider === 'apple'
        ? signInWithAppleNative()
        : signInWithOAuthNative(provider);
    }
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          // Return to the app after the provider hands control back. The
          // supabase-js client (detectSessionInUrl: true) finishes the
          // exchange on load and onAuthStateChange takes it from there.
          redirectTo: window.location.origin,
        },
      });
      // On success the browser is already navigating away, so this return
      // mainly surfaces configuration errors (e.g. provider not enabled).
      return { error: error?.message ?? null };
    } catch {
      return { error: 'Could not start sign-in. Please try again.' };
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!supabaseConfigured) return;
    await supabase.auth.signOut();
    markNeedsPassword(false);
    clearGuest();
    // End the session's data footprint on this device: React state alone isn't
    // enough — the data providers sit ABOVE the auth gate, so they stay mounted
    // (still holding the prior user's ratings/meals in memory), and localStorage
    // + the signed-URL cache would otherwise persist. Purge storage, then hard
    // reload so the whole tree re-inits from a clean slate on the Auth screen —
    // the same clean-identity technique guardDeviceAccount uses on an account
    // switch. (supabase.auth.signOut already cleared the session, so the reload
    // comes back signed-out.)
    clearLocalAppData();
    try {
      window.location.reload();
      return;
    } catch { /* no window (SSR/tests) — fall back to clearing React state */ }
    setProfile(null);
    setProfileError(false);
    setPendingRequestCount(0);
    setIsAdmin(false);
    setAdminChecked(false);
  }, [clearGuest, markNeedsPassword]);

  const refreshProfile = useCallback(async () => {
    if (user?.id) await loadProfile(user.id);
  }, [user, loadProfile]);

  const refreshPendingRequests = useCallback(async () => {
    if (user?.id) {
      try {
        const reqs = await getPendingRequests(user.id);
        setPendingRequestCount(reqs.length);
      } catch { setPendingRequestCount(0); }
    }
  }, [user]);

  // Probe Supabase for an existing account by attempting a passwordless
  // OTP sign-in with `shouldCreateUser: false`. Supabase rejects the
  // request when the email isn't registered and accepts it (mailing an
  // OTP) when it is. We only need the existence signal — the user will
  // type their password on the next step. The OTP email is a known
  // side effect; replace this with a backend RPC / edge function when
  // you want to suppress the email.
  const checkEmailExists = useCallback(async (email: string): Promise<'yes' | 'no' | 'unknown'> => {
    if (!supabaseConfigured) return 'unknown';
    try {
      // Read auth.users via the email_exists() function (migration 032/049).
      // Sends NO email; rate-limited server-side per IP. A failure is reported
      // as 'unknown' — NOT 'no' — so the caller can ask the user to retry
      // instead of dropping a returning user into the signup+password flow.
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.rpc('email_exists', { check_email: email.trim() })),
        8000,
        'checkEmailExists',
      );
      if (error) return 'unknown';
      return data === true ? 'yes' : 'no';
    } catch {
      return 'unknown';
    }
  }, []);

  const profileComplete = !!(profile && profile.username && profile.display_name);

  return (
    <AuthContext.Provider value={{ isSignedIn: !!user, isGuest, continueAsGuest, user, profile, profileComplete, profileError, profileLoading, loading, signIn, signUp, signInWithOAuth, signOut, refreshProfile, pendingRequestCount, refreshPendingRequests, checkEmailExists, isAdmin, adminChecked, verifyEmailCode, resendVerificationCode, startEmailSignup, needsPasswordSetup, completePasswordSetup }}>
      {children}
    </AuthContext.Provider>
  );
};
