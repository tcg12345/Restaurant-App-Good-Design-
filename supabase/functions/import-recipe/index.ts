// AI Recipe Importer — Supabase Edge Function (Deno).
//
// Powers the Add Recipe modal's "Import" tab: turn a recipe that already
// exists somewhere else into a structured draft. Three sources:
//
//   { url }              — fetch the page server-side (no browser CORS),
//                          prefer its schema.org/Recipe JSON-LD, fall back
//                          to the readable page text, and have the model
//                          TRANSCRIBE the recipe it finds.
//   { text }             — pasted free text (an email, a note, a caption).
//   { images: [dataUrl] }— photos of a cookbook page / screenshot /
//                          handwritten card, read with Claude vision.
//
// Unlike build-recipe (an author), this function is a faithful
// transcriber: it must not invent ingredients, steps, or timings — and
// when the source simply has no recipe it declines instead of
// hallucinating one (decline_change tool, same envelope the client
// already understands).
//
// The Anthropic response is STREAMED (SSE proxied byte-for-byte) so long
// extractions don't trip the gateway's time-to-first-byte limit; the
// client reuses the build-recipe stream reader.
//
// The Anthropic API key lives as a Supabase secret (`ANTHROPIC_API_KEY`).
//
// SELF-CONTAINED ON PURPOSE: the auth guard, the abuse guards (rate
// limit + body cap), and the recipe input schema are inlined below
// (instead of imported from ../_shared) so this file can be pasted as-is
// into the Supabase Dashboard's function editor, which can't reach files
// outside the function's own folder. Keep the inlined blocks in sync
// with _shared/auth.ts, _shared/quota.ts, _shared/limits.ts, and
// _shared/recipe-spec.ts.

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

// Body cap must fit MAX_IMAGES base64 photos plus JSON overhead. The
// per-plan allowance lives in plan_limits (migration 087), split by mode:
// 'import-recipe' (link), 'import-recipe-text', 'import-recipe-photo'.
const MAX_BODY_BYTES = 22 * 1024 * 1024;

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
    return { response: jsonError(400, 'Invalid JSON body') };
  }
}

/* ── Recipe input schema (inlined from _shared/recipe-spec.ts) ── */

const CUISINE_HINT =
  'Afghan, African, American, Argentinian, Australian, Austrian, BBQ, Bakery, Belgian, Brazilian, British, Cajun, Caribbean, Chinese, Cuban, Dessert, Ethiopian, Filipino, French, Fusion, German, Greek, Hawaiian, Indian, Indonesian, Irish, Israeli, Italian, Jamaican, Japanese, Korean, Latin American, Lebanese, Malaysian, Mediterranean, Mexican, Middle Eastern, Moroccan, Nordic, Pakistani, Peruvian, Polish, Portuguese, Russian, Scandinavian, Seafood, Soul Food, Southern, Spanish, Sri Lankan, Swedish, Tex-Mex, Thai, Turkish, Ukrainian, Vegan, Vegetarian, Vietnamese';

const COURSE_HINT = 'Breakfast, Lunch, Dinner, Snack, Dessert, Drinks, Appetizer, Side';

const STEP_ITEM_SCHEMA = {
  type: 'object',
  required: ['body'],
  properties: {
    title: { type: 'string', description: 'Short imperative, e.g. "Brown the butter".' },
    body: { type: 'string', description: 'The complete instruction for this step, as the source gives it.' },
    durationMin: { type: 'integer', minimum: 0, description: 'Minutes this step takes, when the source states it.' },
    tip: { type: 'string', description: 'Optional inline tip for this step.' },
  },
};

const RECIPE_INPUT_SCHEMA = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', description: 'Recipe title.' },
    summary: { type: 'string', description: 'One line shown as the byline under the title.' },
    introParagraph: { type: 'string', description: 'A longer intro (2–4 sentences) shown at the top of the recipe page body, when the source has one.' },
    cuisine: { type: 'string', description: `Best-fit cuisine (examples: ${CUISINE_HINT}).` },
    course: { type: 'array', items: { type: 'string' }, description: `One or more of: ${COURSE_HINT}. E.g. ["Dessert"] or ["Lunch", "Dinner"].` },
    difficulty: { type: 'string', enum: ['Easy', 'Medium', 'Hard'] },
    prepTime: { type: 'integer', minimum: 0, description: 'Minutes of hands-on prep.' },
    cookTime: { type: 'integer', minimum: 0, description: 'Minutes of cook / bake / sear time.' },
    chillTime: { type: 'integer', minimum: 0, description: 'Total passive minutes — proofing, chilling, resting, marinating, cooling.' },
    servings: { type: 'integer', minimum: 1 },
    yieldDescription: { type: 'string', description: 'Free-text yield label, e.g. "1 loaf (12 slices)".' },
    ingredients: {
      type: 'array',
      description: 'Flat list of ingredients for single-stage recipes. Use this OR ingredientGroups.',
      items: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Ingredient name with its preparation note, exactly as the source gives it.' },
          amount: { type: 'string', description: 'Number or fraction as a string. Blank when "to taste".' },
          unit: { type: 'string', description: 'g, ml, tsp, tbsp, cup, oz, etc.' },
        },
      },
    },
    ingredientGroups: {
      type: 'array',
      description: 'Grouped ingredients when the source has sections ("For the sauce"). Use either this OR ingredients — not both.',
      items: {
        type: 'object',
        required: ['name', 'ingredients'],
        properties: {
          name: { type: 'string', description: 'Section name.' },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
                amount: { type: 'string' },
                unit: { type: 'string' },
              },
            },
          },
        },
      },
    },
    steps: {
      type: 'array',
      description: 'Ordered cooking steps for a single-flow recipe. Use this OR stepGroups — not both.',
      items: STEP_ITEM_SCHEMA,
    },
    stepGroups: {
      type: 'array',
      description: 'The method split into named sections, when the source has them. Use this OR the flat steps array — not both.',
      items: {
        type: 'object',
        required: ['name', 'steps'],
        properties: {
          name: { type: 'string', description: 'Section name, e.g. "For the duxelles" or "Assembly".' },
          steps: {
            type: 'array',
            description: 'Ordered steps within this section.',
            items: STEP_ITEM_SCHEMA,
          },
        },
      },
    },
    equipment: { type: 'array', items: { type: 'string' }, description: 'Cookware, e.g. "9×5 loaf pan".' },
    tags: { type: 'array', items: { type: 'string' } },
    notes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type', 'text'],
        properties: {
          type: { type: 'string', enum: ['tip', 'makeAhead', 'substitution', 'general'] },
          text: { type: 'string' },
        },
      },
    },
  },
};

// Extraction is transcription, not authoring — Sonnet is accurate at it,
// vision-capable for the photo mode, and much faster than Opus.
const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 9000;

const MAX_TEXT_CHARS = 24000;      // pasted text / page text handed to the model
const MAX_JSONLD_CHARS = 15000;    // extracted JSON-LD handed to the model
const MAX_IMAGES = 3;
const MAX_IMAGE_B64_CHARS = 6_500_000; // ≈ 4.8MB binary per image
const FETCH_TIMEOUT_MS = 12000;
const MAX_HTML_BYTES = 2_500_000;

const SYSTEM_PROMPT = [
  'You are a meticulous recipe transcriber. You are given source material that may contain a recipe — a web page (its structured data and/or readable text), pasted text, or photos. Your job is to extract THE recipe and return it by calling the `build_recipe` tool exactly once. You never chat or add commentary.',
  '',
  'Fidelity rules — this is transcription, not authoring:',
  '- Preserve the source exactly: every ingredient with its original quantity, unit, and preparation note ("2 cups flour, sifted" stays "2 cups flour, sifted"); every step in order. Do NOT invent, add, "improve", or omit ingredients or steps.',
  '- You may lightly clean up: fix obvious OCR/typo artifacts, split a wall-of-text method into numbered steps at its natural boundaries, and give steps short titles drawn from their content.',
  '- Keep the source\'s ingredient sections ("For the sauce") and method sections when it has them.',
  '- prepTime / cookTime / servings: use the source\'s stated values. If a value is not stated anywhere, omit the field (or use 0) — never guess.',
  '- name: the recipe\'s title as the source gives it (drop site-name suffixes like "| Bon Appétit").',
  '- summary: use the source\'s own description, shortened to one line. If it has none, write one PLAIN factual line describing the dish — no marketing voice.',
  '- cuisine / course / difficulty / tags: set only what the source states or what is unambiguous from the dish itself; difficulty is your honest read of the method. Leave tags to at most 5.',
  '- notes: carry over the author\'s tips / storage / make-ahead notes (type them appropriately: tip, makeAhead, substitution, general). Do not write your own.',
  '- If the material contains SEVERAL recipes, extract the main/first complete one.',
  '',
  'When there is NO actual recipe in the material (a homepage, a roundup with no ingredients, an unrelated photo, illegible scans), call `decline_change` instead with a short friendly reason — never fabricate a recipe.',
].join('\n');

const TOOL_BUILD_RECIPE = {
  name: 'build_recipe',
  description: 'Return the transcribed recipe. Call exactly once with every field the source supports.',
  input_schema: RECIPE_INPUT_SCHEMA,
};

const TOOL_NO_RECIPE = {
  name: 'decline_change',
  description: 'Report that the provided material does not contain a usable recipe. Explain briefly and helpfully what was found instead.',
  input_schema: {
    type: 'object',
    required: ['reason'],
    properties: {
      reason: {
        type: 'string',
        description: '1–2 friendly sentences: why no recipe could be extracted (e.g. the link is a category page, the photo is unreadable).',
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

/* ── URL mode helpers ─────────────────────────────────────────── */

/** Basic SSRF guard: only public http(s) hosts. */
function isFetchableUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null;
  // IPv4 literal in a private / loopback / link-local range.
  const ip4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip4) {
    const [a, b] = [Number(ip4[1]), Number(ip4[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) {
      return null;
    }
  }
  if (host.includes(':')) return null; // IPv6 literals — skip entirely
  return u;
}

/** Pull every JSON-LD block that mentions a Recipe. */
function extractRecipeJsonLd(html: string): string {
  const blocks: string[] = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const body = (m[1] || '').trim();
    if (!body || !/"@type"\s*:\s*("|\[)[^"]*Recipe/i.test(body.replace(/\s+/g, ' '))) continue;
    blocks.push(body);
    if (blocks.join('\n').length > MAX_JSONLD_CHARS) break;
  }
  return blocks.join('\n\n').slice(0, MAX_JSONLD_CHARS);
}

/** Crude but effective HTML → readable text. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)[^>]*>/gi, '\n')
    .replace(/<br[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&frac12;/gi, '½')
    .replace(/&frac14;/gi, '¼')
    .replace(/&frac34;/gi, '¾')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n')
    .trim();
}

async function fetchPage(u: URL): Promise<{ html?: string; error?: string }> {
  let res: Response;
  try {
    res = await fetch(u.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 GoodEatsImporter/1.0',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en',
      },
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    return { error: name === 'TimeoutError' ? 'That site took too long to respond.' : 'Could not reach that link.' };
  }
  if (!res.ok) return { error: `That link answered with HTTP ${res.status}.` };
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (type && !type.includes('html') && !type.includes('text')) {
    return { error: 'That link is not a web page. Try the page the recipe lives on.' };
  }
  // Stream-read with a byte cap so a huge page can't blow memory.
  const reader = res.body?.getReader();
  if (!reader) return { error: 'Could not read that page.' };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_HTML_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c.subarray(0, Math.min(c.byteLength, total - off)), off); off += c.byteLength; if (off >= total) break; }
  return { html: new TextDecoder('utf-8', { fatal: false }).decode(buf) };
}

/* ── Image mode helpers ───────────────────────────────────────── */

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
  if (!ANTHROPIC_API_KEY) {
    return jsonError(500, 'ANTHROPIC_API_KEY is not configured on the function');
  }

  const parsed = await readJsonBody<{ url?: string; text?: string; images?: string[] }>(req);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  // A link, photos and pasted text draw from different allowances, so the
  // quota check waits for the body (it only reads the Authorization header
  // otherwise). Same precedence as the mode dispatch below.
  const hasUrl = typeof body.url === 'string' && body.url.trim().length > 0;
  const hasImages = Array.isArray(body.images) && body.images.length > 0;
  const quotaEndpoint = hasUrl ? 'import-recipe' : hasImages ? 'import-recipe-photo' : 'import-recipe-text';
  const quota = await enforceQuota(req, quotaEndpoint, "You've used your recipe imports for now. %reset%");
  if ('response' in quota) return quota.response;

  // Build the user message for whichever source was provided.
  let content: Array<Record<string, unknown>>;

  if (typeof body.url === 'string' && body.url.trim()) {
    const u = isFetchableUrl(body.url.trim());
    if (!u) return jsonError(400, "That doesn't look like a valid public web address.");
    const { html, error } = await fetchPage(u);
    if (!html) return jsonError(422, error || 'Could not read that page.');
    const jsonLd = extractRecipeJsonLd(html);
    const pageText = htmlToText(html).slice(0, jsonLd ? 8000 : MAX_TEXT_CHARS);
    if (!jsonLd && pageText.length < 80) {
      return jsonError(422, "That page didn't have readable content — it may require JavaScript or a login. Try pasting the recipe text instead.");
    }
    const parts: string[] = [`Source URL: ${u.toString()}`];
    if (jsonLd) {
      parts.push(`The page's structured recipe data (schema.org JSON-LD — treat this as the primary source):\n\n${jsonLd}`);
      parts.push(`The page's readable text (for anything the structured data lacks — author notes, section names):\n\n${pageText}`);
    } else {
      parts.push(`The page's readable text:\n\n${pageText}`);
    }
    parts.push('Extract the recipe from this page and call build_recipe. If there is no actual recipe on it, call decline_change.');
    content = [{ type: 'text', text: parts.join('\n\n---\n\n') }];
  } else if (Array.isArray(body.images) && body.images.length > 0) {
    const images = body.images.slice(0, MAX_IMAGES).map(parseDataUrl);
    if (images.some((i) => i === null)) {
      return jsonError(400, 'One of the photos could not be read. Use JPG, PNG, or WebP.');
    }
    content = [
      ...images.map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img!.media_type, data: img!.data },
      })),
      {
        type: 'text',
        text: `These photo${images.length > 1 ? 's show' : ' shows'} a recipe (a cookbook page, screenshot, or handwritten card — later photos continue the same recipe). Read ${images.length > 1 ? 'them' : 'it'} carefully and transcribe the recipe with build_recipe. If no readable recipe is present, call decline_change.`,
      },
    ];
  } else if (typeof body.text === 'string' && body.text.trim()) {
    const text = body.text.trim().slice(0, MAX_TEXT_CHARS);
    content = [{
      type: 'text',
      text: `Here is pasted text that should contain a recipe:\n\n${text}\n\nTranscribe the recipe with build_recipe. If there is no actual recipe in it, call decline_change.`,
    }];
  } else {
    return jsonError(400, 'Provide a link, pasted text, or photos to import.');
  }

  const anthropicBody = {
    model: MODEL,
    // Keep forced tools and the existing non-thinking output budget.
    thinking: { type: 'disabled' },
    output_config: { effort: 'high' },
    max_tokens: MAX_TOKENS,
    stream: true,
    system: SYSTEM_PROMPT,
    tools: [TOOL_BUILD_RECIPE, TOOL_NO_RECIPE],
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
