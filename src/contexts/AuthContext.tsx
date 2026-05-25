import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { getProfile, getPendingRequests, type UserProfile } from '../lib/supabase-community';
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
  user: User | null;
  profile: UserProfile | null;
  profileComplete: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  pendingRequestCount: number;
  refreshPendingRequests: () => Promise<void>;
  /** Probe whether an email is already registered. Returns `true` when
   *  Supabase reports the address exists, `false` when it doesn't (or
   *  the check can't be performed). Used by the desktop sign-in to
   *  branch between "Welcome back" and "Create account". */
  checkEmailExists: (email: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType>({
  isSignedIn: false,
  user: null,
  profile: null,
  profileComplete: false,
  loading: true,
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null }),
  signOut: async () => {},
  refreshProfile: async () => {},
  pendingRequestCount: 0,
  refreshPendingRequests: async () => {},
  checkEmailExists: async () => false,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);

  const loadProfile = useCallback(async (userId: string) => {
    try {
      const p = await withTimeout(getProfile(userId), 8000, 'getProfile');
      setProfile(p);
    } catch {
      setProfile(null);
    }
    try {
      const reqs = await withTimeout(getPendingRequests(userId), 8000, 'getPendingRequests');
      setPendingRequestCount(reqs.length);
    } catch {
      setPendingRequestCount(0);
    }
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      return;
    }

    let mounted = true;

    (async () => {
      try {
        const { data: { session } } = await withTimeout(
          supabase.auth.getSession(),
          6000,
          'auth.getSession',
        );
        if (!mounted) return;
        const u = session?.user ?? null;
        setUser(u);
        if (u) await loadProfile(u.id);
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
        setUser(u);
        if (u) loadProfile(u.id);
        else { setProfile(null); setPendingRequestCount(0); }
      }
    );

    return () => { mounted = false; subscription.unsubscribe(); };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabaseConfigured) return { error: 'Authentication is not configured' };
    try {
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        12000,
        'auth.signInWithPassword',
      );
      return { error: error?.message ?? null };
    } catch {
      return { error: 'Sign in took too long. Check your connection and try again.' };
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    if (!supabaseConfigured) return { error: 'Authentication is not configured' };
    try {
      const { error } = await withTimeout(
        supabase.auth.signUp({ email, password }),
        12000,
        'auth.signUp',
      );
      return { error: error?.message ?? null };
    } catch {
      return { error: 'Sign up took too long. Check your connection and try again.' };
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!supabaseConfigured) return;
    await supabase.auth.signOut();
    setProfile(null);
    setPendingRequestCount(0);
  }, []);

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
  const checkEmailExists = useCallback(async (email: string): Promise<boolean> => {
    if (!supabaseConfigured) return false;
    try {
      const { error } = await withTimeout(
        supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false },
        }),
        8000,
        'checkEmailExists',
      );
      return !error;
    } catch {
      // Timed out or threw — assume the email isn't on file. The caller will
      // route to the sign-up step; if the user actually has an account they
      // can hit back and try again.
      return false;
    }
  }, []);

  const profileComplete = !!(profile && profile.username && profile.display_name);

  return (
    <AuthContext.Provider value={{ isSignedIn: !!user, user, profile, profileComplete, loading, signIn, signUp, signOut, refreshProfile, pendingRequestCount, refreshPendingRequests, checkEmailExists }}>
      {children}
    </AuthContext.Provider>
  );
};
