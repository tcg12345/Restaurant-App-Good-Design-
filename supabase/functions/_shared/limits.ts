// Shared abuse guards for the AI Edge Functions, layered on top of the auth
// check in auth.ts: a hard cap on request-body size, and the ORIGINAL
// per-user hourly rate limit (consume_ai_rate_limit — migration 047).
// Since migration 087 every AI function counts requests through
// quota.ts (plan-aware, multi-window) instead; enforceRateLimit stays for
// any function that hasn't moved, and is otherwise unused.

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
 * Returns a retryable 503 when the limit cannot be verified.
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

  let result;
  try { result = await supabase.rpc('consume_ai_rate_limit', {
    p_endpoint: endpoint,
    p_max_per_hour: maxPerHour,
  }); } catch { return jsonResponse(503, 'Unable to check your allowance. Please try again shortly.'); }
  const { data, error } = result;
  if (error || typeof data !== 'boolean') {
    console.error(`[${endpoint}] rate-limit check unavailable`);
    return jsonResponse(503, 'Unable to check your allowance. Please try again shortly.');
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
 * through. `bytes` is the size actually read, for callers whose cap
 * depends on the mode they only learn from the parsed body.
 */
export async function readJsonBody<T>(
  req: Request,
  maxBytes: number,
): Promise<{ body: T; bytes: number } | { response: Response }> {
  const tooLarge = () => ({ response: jsonResponse(413, 'Request body is too large.') });

  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();

  let text = '';
  let total = 0;
  if (req.body) {
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
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
    return { body: JSON.parse(text) as T, bytes: total };
  } catch {
    return { response: jsonResponse(400, 'Invalid JSON body') };
  }
}
