// Shared abuse guards for the AI Edge Functions, layered on top of the auth
// check in auth.ts: a per-user hourly rate limit (backed by the
// consume_ai_rate_limit RPC — migration 047_ai_rate_limits.sql) and a hard
// cap on request-body size. Each function picks its own numbers; the
// mechanics live here so the four functions can't drift.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CORS_HEADERS } from './auth.ts';

function jsonResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/**
 * Count this request against the signed-in caller's hourly quota for
 * `endpoint`. Returns a ready-to-send 429 once the quota is exhausted, null
 * while under it. The RPC runs as the caller (their bearer token is
 * forwarded), so SECURITY DEFINER + auth.uid() scopes the counter to them.
 *
 * Fails open on infrastructure errors (RPC missing, DB hiccup): the caller
 * has already passed auth by the time this runs, and a function deploy that
 * briefly precedes migration 047 shouldn't take every AI feature down.
 */
export async function enforceRateLimit(
  req: Request,
  endpoint: string,
  maxPerHour: number,
  /** Shown to the caller on 429. Defaults to the AI wording, which is what
   *  every caller but cuisine-lookup wants. */
  message = "You've reached the hourly limit for AI requests. Please try again in a little while.",
): Promise<Response | null> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    },
  );

  const { data, error } = await supabase.rpc('consume_ai_rate_limit', {
    p_endpoint: endpoint,
    p_max_per_hour: maxPerHour,
  });
  if (error) {
    console.error(`[${endpoint}] rate-limit check failed (allowing request):`, error.message);
    return null;
  }
  if (data === false) {
    return jsonResponse(429, message);
  }
  return null;
}

/**
 * Read and JSON-parse a request body without ever buffering more than
 * `maxBytes`. Returns { body } on success, or { response } (413 / 400, CORS
 * attached) to send straight back. The stream is counted as it arrives, so a
 * missing or lying Content-Length header can't sneak an oversized payload
 * through.
 */
export async function readJsonBody<T>(
  req: Request,
  maxBytes: number,
): Promise<{ body: T } | { response: Response }> {
  const tooLarge = () => ({ response: jsonResponse(413, 'Request body is too large.') });

  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();

  let text = '';
  if (req.body) {
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* stream already errored */ }
        return tooLarge();
      }
      chunks.push(value);
    }
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      buf.set(chunk, offset);
      offset += chunk.byteLength;
    }
    text = new TextDecoder().decode(buf);
  }

  try {
    return { body: JSON.parse(text) as T };
  } catch {
    return { response: jsonResponse(400, 'Invalid JSON body') };
  }
}
