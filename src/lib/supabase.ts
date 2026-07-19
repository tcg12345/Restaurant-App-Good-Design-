import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { authStorage, authStorageKey } from './auth-storage';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

/** Where the session lives — same `sb-<ref>-auth-token` key supabase-js
 *  would derive itself, made explicit so lib/auth-storage's boot-time
 *  fallback reader and the client can never disagree. */
export const SESSION_STORAGE_KEY = authStorageKey(supabaseUrl || 'https://placeholder.supabase.co');

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
      // Durable storage: @capacitor/preferences on native (WKWebView
      // localStorage is evictable — the root cause of users waking up
      // signed out), plain localStorage on web. See lib/auth-storage.ts.
      storage: authStorage,
      storageKey: SESSION_STORAGE_KEY,
    },
  },
);

// iOS suspends the webview's timers while the app is backgrounded, so the
// auto-refresh ticker can miss the access token's expiry entirely; on resume
// the app then runs with a stale token until the next tick. Pause the
// ticker in the background and restart it on foreground — restarting runs
// an immediate refresh check, so a resumed app repairs its session right
// away instead of bouncing requests off 401s (or, worse, looking signed
// out) for the first seconds.
if (Capacitor.isNativePlatform()) {
  void App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}
