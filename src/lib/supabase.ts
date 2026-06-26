import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder',
  {
    auth: {
      // PKCE works for both the web redirect and the native (Capacitor)
      // deep-link flow: the provider returns a `?code=` that we exchange
      // for a session. On web, detectSessionInUrl finishes the exchange
      // automatically; on native, lib/native-oauth.ts does it by hand.
      flowType: 'pkce',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  },
);
