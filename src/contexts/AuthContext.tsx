import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { getProfile, type UserProfile } from '../lib/supabase-community';
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
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    const p = await getProfile(userId);
    setProfile(p);
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        const u = session?.user ?? null;
        setUser(u);
        if (u) loadProfile(u.id);
      })
      .catch(() => {})
      .finally(() => { setLoading(false); });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: string, session: Session | null) => {
        const u = session?.user ?? null;
        setUser(u);
        if (u) loadProfile(u.id);
        else setProfile(null);
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
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user?.id) await loadProfile(user.id);
  }, [user, loadProfile]);

  const profileComplete = !!(profile && profile.username && profile.display_name);

  return (
    <AuthContext.Provider value={{ isSignedIn: !!user, user, profile, profileComplete, loading, signIn, signUp, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};
