// Service-role Supabase client for Edge Functions. Bypasses RLS — only used
// from server-side compute and backfill jobs.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export function createAdminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Authorize a request against the secret configured in pg_cron
 * (app.urr_compute_secret). Falls back to allowing any request when no
 * secret is configured — useful in local dev.
 */
export function authorize(req: Request): boolean {
  const expected = Deno.env.get('URR_COMPUTE_SECRET');
  if (!expected) return true;
  const header = req.headers.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  return token === expected;
}
