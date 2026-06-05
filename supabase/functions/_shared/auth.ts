// Shared CORS + auth helpers for the AI Edge Functions.
//
// These functions are deployed with `verify_jwt = false` so that the
// unauthenticated CORS preflight (OPTIONS) can be answered — the browser
// never sends an Authorization header on a preflight, and the gateway
// would otherwise 401 it. We therefore verify the caller's Supabase JWT
// ourselves inside each handler via `requireUser`.

import { createClient } from 'jsr:@supabase/supabase-js@2';

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Sign in to use this feature.' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/**
 * Verify the caller is a signed-in Supabase user. On success returns the
 * user's id; on failure returns a ready-to-send 401 Response (with CORS).
 * SUPABASE_URL / SUPABASE_ANON_KEY are injected into every Edge Function
 * automatically — no secrets to set.
 */
export async function requireUser(
  req: Request,
): Promise<{ userId: string } | { response: Response }> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { response: unauthorized() };

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { response: unauthorized() };
  return { userId: data.user.id };
}
