// AI Restaurant-List Importer — Supabase Edge Function (Deno).
//
// Powers the Import page's screenshot path: the user screenshots a
// restaurant list they already keep somewhere else (Beli's Been /
// Want-to-Try lists, Google Maps saved lists, a Notes app list, a
// spreadsheet) and Claude vision transcribes every visible entry into
// structured rows the client then resolves against Google Places.
//
//   { images: [dataUrl, …] } — up to MAX_IMAGES screenshots. Consecutive
//                              screenshots usually come from scrolling one
//                              list, so entries are deduped across them.
//
// Like import-recipe, this is a faithful TRANSCRIBER: it must never
// invent restaurants or scores. When the screenshots contain no readable
// restaurant list it declines (decline_change) instead of hallucinating.
//
// The Anthropic response is STREAMED (SSE proxied byte-for-byte) so long
// extractions don't trip the gateway's time-to-first-byte limit; the
// client accumulates the tool-call JSON the same way the recipe importer
// does.
//
// The Anthropic API key lives as a Supabase secret (`ANTHROPIC_API_KEY`).
//
// SELF-CONTAINED ON PURPOSE: the auth guard and the abuse guards (rate
// limit + body cap) are inlined below (instead of imported from
// ../_shared) so this file can be pasted as-is into the Supabase
// Dashboard's function editor. Keep the inlined blocks in sync with
// _shared/auth.ts and _shared/limits.ts.

import { createClient } from 'jsr:@supabase/supabase-js@2';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ANTHROPIC_API_KEY: string | undefined = Deno.env.get('ANTHROPIC_API_KEY');

/* ── Auth guard (inlined from _shared/auth.ts) ────────────────── */

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Sign in to use this feature.' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/** Verify the caller is a signed-in Supabase user. SUPABASE_URL /
 *  SUPABASE_ANON_KEY are injected automatically. */
async function requireUser(
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

/* ── Abuse guards (inlined from _shared/limits.ts) ────────────── */

// Body cap must fit MAX_IMAGES base64 screenshots plus JSON overhead. The
// per-plan allowance lives in plan_limits (migration 087).
const MAX_BODY_BYTES = 30 * 1024 * 1024;

/** "Resets in 3 hours" / "Resets Monday" / "Resets 1 Oct". */
function resetPhrase(resetsAt: string | null): string {
  if (!resetsAt) return '';
  const at = new Date(resetsAt);
  const ms = at.getTime() - Date.now();
  if (!Number.isFinite(ms)) return '';
  if (ms <= 60 * 60 * 1000) return `Resets in ${Math.max(1, Math.round(ms / 60000))} min.`;
  if (ms <= 36 * 60 * 60 * 1000) return `Resets in ${Math.round(ms / 3600000)} hours.`;
  if (ms <= 8 * 24 * 60 * 60 * 1000) return `Resets ${at.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}.`;
  return `Resets ${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}.`;
}

/** Count this request against the caller's plan allowance for `endpoint`
 *  (the consume_ai_quota RPC — migration 087_billing.sql; inlined from
 *  _shared/quota.ts, keep the two in sync). Returns { response } to send
 *  straight back (402 for a Pro-only feature, 429 when the allowance is
 *  used up), else the caller's plan and headroom. Allows on infrastructure
 *  errors: the caller already passed auth, and while the billing gates are
 *  off nothing is gated anyway. */
async function enforceQuota(
  req: Request,
  endpoint: string,
  message: string,
): Promise<{ response: Response } | { plan: 'free' | 'pro'; remaining: number | null; resetsAt: string | null }> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    },
  );
  const { data, error } = await supabase.rpc('consume_ai_quota', { p_endpoint: endpoint });
  if (error) {
    console.error(`[${endpoint}] quota check failed (allowing request):`, error.message);
    return { plan: 'pro', remaining: null, resetsAt: null };
  }
  const row = (data ?? {}) as { allowed?: boolean; plan?: string; pro_only?: boolean; remaining?: number | null; resets_at?: string | null };
  const json = (status: number, payload: Record<string, unknown>) =>
    new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
  if (row.allowed === false) {
    if (row.pro_only) {
      return { response: json(402, { error: 'This is a GoodEats Pro feature.', code: 'pro_required', plan: row.plan ?? 'free' }) };
    }
    return {
      response: json(429, {
        error: message.replace('%reset%', resetPhrase(row.resets_at ?? null)).trim(),
        code: 'quota',
        plan: row.plan ?? 'free',
        remaining: 0,
        resetsAt: row.resets_at ?? null,
      }),
    };
  }
  return {
    plan: row.plan === 'free' ? 'free' : 'pro',
    remaining: typeof row.remaining === 'number' ? row.remaining : null,
    resetsAt: row.resets_at ?? null,
  };
}

/** Read + JSON-parse the body without ever buffering more than
 *  MAX_BODY_BYTES, so a lying Content-Length can't sneak a huge payload in. */
async function readJsonBody<T>(req: Request): Promise<{ body: T } | { response: Response }> {
  const tooLarge = () => ({ response: jsonError(413, 'Request body is too large.') });
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();

  let text = '';
  if (req.body) {
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        try { await reader.cancel(); } catch { /* stream already errored */ }
        return tooLarge();
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
    text = new TextDecoder().decode(merged);
  }
  try {
    return { body: JSON.parse(text || '{}') as T };
  } catch {
    return { response: jsonError(400, 'Request body must be JSON.') };
  }
}

/* ── Model + prompt ───────────────────────────────────────────── */

// Extraction is transcription, not authoring — Sonnet is accurate at it,
// vision-capable, and much faster than Opus.
const MODEL = 'claude-sonnet-5';
// Generous output budget: 6 screenshots of a dense list can carry 100+
// rows, and truncation here silently DROPS restaurants.
const MAX_TOKENS = 16000;

// The client slices each screenshot into up to 4 overlapping tiles (so
// small score digits survive the vision pipeline's downscaling) and sends
// at most 6 screenshots per batch → 24 images.
const MAX_IMAGES = 24;
const MAX_IMAGE_B64_CHARS = 6_500_000; // ≈ 4.8MB binary per image

const SYSTEM_PROMPT = [
  'You are a meticulous transcriber of restaurant-list screenshots. You are given phone screenshots of a list the user keeps in another app — most often Beli (ranked "Been" lists with one-decimal scores, or bookmarked "Want to Try" lists), but also Google Maps saved lists, notes apps, or spreadsheets. Extract every restaurant entry you can actually read and return them all by calling the `extract_restaurants` tool exactly once. You never chat or add commentary.',
  '',
  'Fidelity rules — this is transcription, not authoring:',
  '- COMPLETENESS IS CRITICAL: one entry per restaurant visible anywhere in the images, in the order shown. Do NOT invent entries, and do NOT skip any row — including rows partially cut off at the top or bottom edge of an image, as long as their name is readable. Before calling the tool, re-scan every image top to bottom and confirm every visible row made it into your output.',
  '- The images overlap on purpose: they are scrolls of the SAME list and/or overlapping crops (tiles) of one screenshot. Emit each restaurant exactly once (same name + same location = one entry; keep the copy with more information).',
  "- score: the USER'S own score exactly as printed, digit for digit — 9.3 is 9.3, never rounded, estimated, or adjusted (Beli shows a decimal 0–10 in a colored circle on the right of each row). When a row shows several numbers, the user's score is the prominent one; ignore friend scores, match percentages, rank numbers (#1, #2…), review counts, and distances. If a score is cut off or too blurry to read with certainty, OMIT score for that row — never guess.",
  "- wishlist: true when the screenshot is clearly a want-to-try / bookmarked / saved list (e.g. Beli's Want to Try tab, a bookmark icon per row, no scores anywhere). Rated lists get wishlist: false.",
  '- city: the city / neighborhood text shown for that row (e.g. "New York, NY", "SoHo"). If the rows have no per-row location but the list header names a city, use that for every row. Omit when nothing is shown — never guess from the restaurant name.',
  '- cuisine: only when the row shows one (e.g. "Italian · $$$$"). Do not infer it.',
  '- notes: only text the USER wrote about that restaurant if visible. Not app UI copy.',
  '- Ignore all app chrome: tab bars, search fields, filter chips, headers, ads, friend avatars.',
  '',
  'When the screenshots contain NO readable restaurant list (a random photo, an unrelated app, illegible images), call `decline_change` instead with a short friendly reason — never fabricate entries.',
].join('\n');

const TOOL_EXTRACT = {
  name: 'extract_restaurants',
  description: 'Return every restaurant entry transcribed from the screenshots. Call exactly once.',
  input_schema: {
    type: 'object',
    required: ['restaurants'],
    properties: {
      restaurants: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Restaurant name exactly as shown.' },
            city: { type: 'string', description: 'City / neighborhood shown for this row (or the list\'s stated location). Omit when not shown.' },
            cuisine: { type: 'string', description: 'Cuisine label shown for this row. Omit when not shown.' },
            score: { type: 'number', description: "The user's own 0–10 score exactly as displayed. Omit when the row shows none." },
            wishlist: { type: 'boolean', description: 'True when this entry comes from a want-to-try / saved list rather than a rated list.' },
            notes: { type: 'string', description: 'The user\'s own note for this row, when visible.' },
          },
        },
      },
    },
  },
};

const TOOL_NO_LIST = {
  name: 'decline_change',
  description: 'Report that the screenshots do not contain a readable restaurant list. Explain briefly and helpfully what was found instead.',
  input_schema: {
    type: 'object',
    required: ['reason'],
    properties: {
      reason: {
        type: 'string',
        description: '1–2 friendly sentences: why no list could be read (e.g. the image is not a restaurant list, the text is illegible).',
      },
    },
  },
};

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/* ── Image helpers ────────────────────────────────────────────── */

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function parseDataUrl(raw: string): { media_type: string; data: string } | null {
  const m = raw.match(/^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const mediaType = m[1].toLowerCase();
  if (!IMAGE_TYPES.has(mediaType)) return null;
  if (m[2].length > MAX_IMAGE_B64_CHARS) return null;
  return { media_type: mediaType, data: m[2] };
}

/* ── Handler ──────────────────────────────────────────────────── */

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'Method not allowed');
  }
  const auth = await requireUser(req);
  if ('response' in auth) return auth.response;
  const quota = await enforceQuota(req, 'import-restaurants', "You've used your restaurant imports for now. %reset%");
  if ('response' in quota) return quota.response;
  if (!ANTHROPIC_API_KEY) {
    return jsonError(500, 'ANTHROPIC_API_KEY is not configured on the function');
  }

  const parsed = await readJsonBody<{ images?: string[] }>(req);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  if (!Array.isArray(body.images) || body.images.length === 0) {
    return jsonError(400, 'Provide screenshots to import.');
  }
  const images = body.images.slice(0, MAX_IMAGES).map(parseDataUrl);
  if (images.some((i) => i === null)) {
    return jsonError(400, 'One of the screenshots could not be read. Use JPG, PNG, or WebP.');
  }

  const content: Array<Record<string, unknown>> = [
    ...images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img!.media_type, data: img!.data },
    })),
    {
      type: 'text',
      text: `These ${images.length > 1 ? `${images.length} images show` : 'image shows'} a restaurant list from another app${images.length > 1 ? ' (they are overlapping crops and/or scrolls of the same list — the same row may appear in several images)' : ''}. Transcribe EVERY readable restaurant entry, exactly once each, with extract_restaurants — re-scan each image before finishing to make sure no row was missed, and copy scores digit for digit. If there is no readable restaurant list, call decline_change.`,
    },
  ];

  const anthropicBody = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    stream: true,
    system: SYSTEM_PROMPT,
    tools: [TOOL_EXTRACT, TOOL_NO_LIST],
    tool_choice: { type: 'any' },
    messages: [{ role: 'user', content }],
  };

  let anthropicRes: Response;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(anthropicBody),
    });
  } catch (err) {
    return jsonError(502, `Upstream fetch failed: ${(err as Error).message}`);
  }

  if (!anthropicRes.ok || !anthropicRes.body) {
    let errText = `Upstream HTTP ${anthropicRes.status}`;
    try {
      const j: any = await anthropicRes.json();
      errText = j?.error?.message || j?.error || errText;
    } catch { /* ignore */ }
    return jsonError(anthropicRes.status, String(errText).slice(0, 500));
  }

  return new Response(anthropicRes.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...CORS_HEADERS,
    },
  });
}

Deno.serve(handler);
