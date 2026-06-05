// Resolve URL + auth headers for the AI Supabase Edge Functions.
//
// The AI endpoints (chat, recipe build, recipe image) run as Supabase Edge
// Functions at https://<ref>.supabase.co/functions/v1/<name>. That URL is
// stable and already known to every build (web and native) via
// VITE_SUPABASE_URL, so there's nothing platform-specific to configure —
// both web and the native (Capacitor) app call the same absolute URL.
//
// The functions verify the caller's Supabase session (see
// functions/_shared/auth.ts), so requests must carry the signed-in user's
// access token.

import { supabase } from './supabase';

const FUNCTIONS_BASE = `${(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')}/functions/v1`;
const ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '') as string;

/** Absolute URL of a deployed Edge Function, e.g. apiUrl('location-chat'). */
export function apiUrl(name: string): string {
  return `${FUNCTIONS_BASE}/${name}`;
}

/**
 * Headers for an Edge Function call: JSON body + the signed-in user's bearer
 * token (which the function verifies). Falls back to the anon key when there
 * is no session — the function then responds 401, surfaced to the user.
 */
export async function apiHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token || ANON_KEY;
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'apikey': ANON_KEY,
  };
}
