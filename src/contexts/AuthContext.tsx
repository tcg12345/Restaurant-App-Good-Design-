import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { getProfile, getPendingRequests, type UserProfile } from '../lib/supabase-community';
import type { User, Session } from '@supabase/supabase-js';

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
      const p = await getProfile(userId);
      setProfile(p);
    } catch {
      setProfile(null);
    }
    try {
      const reqs = await getPendingRequests(userId);
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
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted) return;
        const u = session?.user ?? null;
        setUser(u);
        if (u) await loadProfile(u.id);
      } catch {
        // Auth failed — continue as signed out
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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    if (!supabaseConfigured) return { error: 'Authentication is not configured' };
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null };
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
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      return !error;
    } catch {
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
