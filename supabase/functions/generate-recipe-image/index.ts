// AI Recipe Hero Image Generator — Vercel Edge Function.
//
// Generates a realistic, appetizing photo of a recipe's FINISHED dish for
// use as its cover photo. Takes the recipe's own knowledge (name, summary,
// cuisine, key ingredients) and composes a food-photography prompt, then
// calls OpenAI's image API. gpt-image models always return base64 — we hand
// that straight back to the client, which compresses it like an upload.
//
// The response is wrapped in an SSE stream with an early + periodic
// heartbeat. Image generation can take 10-40s; a plain non-streaming call
// would block past the gateway's time-to-first-byte limit and 504 (the same
// reason build-recipe.ts streams). The heartbeat sends bytes immediately so
// the connection stays open until the final image (or error) event.
//
// Request:  { recipe: { name, summary?, cuisine?, course?, difficulty?,
//                        ingredients?: string[], yieldDescription? } }
// Response: SSE — `: keep-alive` comments, then a single
//           `data: {"b64_json": "..."}` (success) or
//           `data: {"error": "..."}` (failure) event.
//
// The OpenAI API key lives here as a Vercel environment variable
// (`OPENAI_API_KEY`) and never reaches the browser bundle.

import { requireUser } from '../_shared/auth.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

const OPENAI_API_KEY: string | undefined = Deno.env.get('OPENAI_API_KEY');

// Single named constant so swapping the model is a one-line change. Falls
// back to gpt-image-1 if an account doesn't yet have access to gpt-image-2.
const MODEL = 'gpt-image-2';
// Landscape — matches the draft sheet's aspect-[16/9] hero crop.
const SIZE = '1536x1024';
const QUALITY = 'auto';
const OUTPUT_FORMAT = 'jpeg';
const MAX_INGREDIENTS = 10;
const MAX_PROMPT_CHARS = 2000;
// Cap heartbeats so a hung upstream can't keep the function alive forever.
const HEARTBEAT_MS = 5000;

interface RecipeImageInput {
  name?: string;
  summary?: string;
  cuisine?: string;
  course?: string[];
  difficulty?: string;
  ingredients?: string[];
  yieldDescription?: string;
}

// CORS so the native (Capacitor) build can call this cross-origin; the
// web app is same-origin. Every response must carry these, not just the
// preflight.
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

/** Compose a deterministic food-photography prompt from the recipe's own
 *  fields so the generated image actually matches the dish. */
function buildImagePrompt(recipe: RecipeImageInput): string {
  const name = (recipe.name || '').trim() || 'a home-cooked dish';
  const parts: string[] = [
    `Professional, photorealistic food photograph of the finished dish: ${name}.`,
  ];

  const summary = (recipe.summary || '').trim();
  if (summary) parts.push(summary.replace(/\s+/g, ' '));

  const cuisine = (recipe.cuisine || '').trim();
  const course = Array.isArray(recipe.course)
    ? recipe.course.filter((c) => typeof c === 'string' && c.trim()).join('/')
    : '';
  const descriptor = [cuisine, course].filter(Boolean).join(' ').trim();
  if (descriptor) parts.push(`A ${descriptor} dish.`);

  const ingredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients
        .filter((i) => typeof i === 'string' && i.trim())
        .map((i) => i.trim())
        .slice(0, MAX_INGREDIENTS)
    : [];
  if (ingredients.length > 0) {
    parts.push(`Made with ${ingredients.join(', ')}.`);
  }

  parts.push(
    'Beautifully plated and styled on a clean, modern surface, soft natural lighting, shallow depth of field, appetizing and fresh, high detail, true-to-life colors. Square-on or slight overhead angle. No text, no watermark, no hands, no people.',
  );

  return parts.join(' ').slice(0, MAX_PROMPT_CHARS);
}

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method === 'POST') {
    const auth = await requireUser(req);
    if ('response' in auth) return auth.response;
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'Method not allowed');
  }
  if (!OPENAI_API_KEY) {
    return jsonError(500, 'OPENAI_API_KEY is not configured on the function');
  }

  let body: { recipe?: RecipeImageInput };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const recipe = body.recipe;
  if (!recipe || !(recipe.name || '').trim()) {
    return jsonError(400, "I need the recipe before I can picture it.");
  }

  const prompt = buildImagePrompt(recipe);

  // Wrap the OpenAI call in an SSE stream. We flush a heartbeat immediately
  // (and every HEARTBEAT_MS) so the gateway sees bytes well before the slow
  // image call resolves, then emit a single terminal data event.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (text: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(text)); } catch { /* ignore */ }
      };

      // Beat the time-to-first-byte limit right away.
      safeEnqueue(': open\n\n');
      const heartbeat = setInterval(() => safeEnqueue(': keep-alive\n\n'), HEARTBEAT_MS);

      try {
        const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: MODEL,
            prompt,
            size: SIZE,
            quality: QUALITY,
            output_format: OUTPUT_FORMAT,
            n: 1,
          }),
        });

        if (!openaiRes.ok) {
          let message = `Image service error (HTTP ${openaiRes.status}).`;
          try {
            const j: any = await openaiRes.json();
            message = j?.error?.message || j?.error || message;
          } catch { /* ignore */ }
          safeEnqueue(`data: ${JSON.stringify({ error: String(message).slice(0, 500) })}\n\n`);
          return;
        }

        const data: any = await openaiRes.json();
        const b64 = data?.data?.[0]?.b64_json;
        if (!b64) {
          safeEnqueue(`data: ${JSON.stringify({ error: "The image came back empty. Try again." })}\n\n`);
          return;
        }
        safeEnqueue(`data: ${JSON.stringify({ b64_json: b64 })}\n\n`);
      } catch (err) {
        safeEnqueue(`data: ${JSON.stringify({ error: `Upstream fetch failed: ${(err as Error).message}`.slice(0, 500) })}\n\n`);
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try { controller.close(); } catch { /* ignore */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...CORS_HEADERS,
    },
  });
}

Deno.serve(handler);
