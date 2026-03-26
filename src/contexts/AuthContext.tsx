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
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);

  const loadProfile = useCallback(async (userId: string) => {
    setProfileLoaded(false);
    const p = await getProfile(userId);
    setProfile(p);
    setProfileLoaded(true);
    // Also load pending requests
    const reqs = await getPendingRequests(userId);
    setPendingRequestCount(reqs.length);
  }, []);

  const refreshPendingRequests = useCallback(async () => {
    if (user?.id) {
      const reqs = await getPendingRequests(user.id);
      setPendingRequestCount(reqs.length);
    }
  }, [user]);

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      setProfileLoaded(true);
      return;
    }

    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        const u = session?.user ?? null;
        setUser(u);
        if (u) {
          await loadProfile(u.id);
        } else {
          setProfileLoaded(true);
        }
      })
      .catch(() => {
        setProfileLoaded(true);
      })
      .finally(() => { setLoading(false); });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event: string, session: Session | null) => {
        const u = session?.user ?? null;
        setUser(u);
        if (u) {
          await loadProfile(u.id);
        } else {
          setProfile(null);
          setProfileLoaded(true);
        }
      }
    );

    return () => subscription.unsubscribe();
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
    setProfileLoaded(true);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user?.id) await loadProfile(user.id);
  }, [user, loadProfile]);

  const profileComplete = !!(profile && profile.username && profile.display_name);

  // Don't stop showing the loading screen until both auth AND profile are resolved
  const isFullyLoaded = !loading && profileLoaded;

  return (
    <AuthContext.Provider value={{ isSignedIn: !!user, user, profile, profileComplete, loading: !isFullyLoaded, signIn, signUp, signOut, refreshProfile, pendingRequestCount, refreshPendingRequests }}>
      {children}
    </AuthContext.Provider>
  );
};
