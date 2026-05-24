// LocationPage AI chatbot — Vercel Edge Function.
//
// Proxies the browser's chat requests to Anthropic's Messages API and
// streams the response back as Server-Sent Events. The Anthropic API
// key lives here as a Vercel environment variable (`ANTHROPIC_API_KEY`)
// and never reaches the browser bundle.
//
// Deploy: set ANTHROPIC_API_KEY in Vercel Dashboard → Settings → Environment
// Variables, then push to your linked repo (or run `vercel deploy`).
//
// Local dev: `npx vercel dev` runs Vite + this function together at
// http://localhost:3000 so the frontend's relative POST to
// /api/location-chat resolves correctly.
//
// Request body shape and the streaming-response wire format are
// identical to the previous Supabase variant — the frontend client
// is unchanged apart from the URL.

// Vercel Edge runtime: standard Web APIs (fetch / Request / Response /
// ReadableStream). Edge is the right choice for chat: faster cold
// starts than Node serverless and native support for streaming bodies.
export const config = { runtime: 'edge' };

/* eslint-disable @typescript-eslint/no-explicit-any */

// @ts-expect-error — process.env is available in Vercel Edge at runtime
// even though @types/node isn't installed in this project's tsconfig.
const ANTHROPIC_API_KEY: string | undefined = typeof process !== 'undefined'
  // @ts-expect-error see above
  ? process.env?.ANTHROPIC_API_KEY
  : undefined;

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_RESTAURANTS_IN_PROMPT = 50;

// The single tool Claude gets. We don't expose a free-form
// "search Google" tool — Claude works off the Available list the
// frontend curated and filtered for the user.
const TOOL_RECOMMEND = {
  name: 'recommend_restaurants',
  description:
    "Recommend specific restaurants from the Available list. Always use this tool when you want to suggest places — never type their names in prose. IDs MUST be the (id: ...) Google place ids from the Available restaurants section of the system prompt.",
  input_schema: {
    type: 'object',
    properties: {
      restaurant_ids: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 6,
      },
      reason: {
        type: 'string',
        description: 'One short sentence on why these match the user.',
      },
    },
    required: ['restaurant_ids'],
  },
};

interface CompactRestaurant {
  id: string;
  name: string;
  cuisine?: string;
  price?: string;
  score?: string;
  neighborhood?: string;
  distance?: string;
}

interface ChatFilters {
  cuisines?: string[];
  price?: number;
  neighborhoods?: string[];
  radius?: number;
  sort?: string;
}

interface ChatRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: any }>;
  restaurants?: CompactRestaurant[];
  filters?: ChatFilters;
  city?: string;
  model?: string;
}

function buildSystemPrompt(body: ChatRequest): string {
  const city = body.city || 'this area';
  const filters = body.filters || {};
  const lines: string[] = [];
  lines.push(
    `You are a restaurant concierge for ${city}. The user is browsing the explore page for this location and you're helping them choose where to eat.`,
  );
  lines.push('');

  const filterParts: string[] = [];
  if (filters.cuisines && filters.cuisines.length > 0) {
    filterParts.push(`Cuisine: ${filters.cuisines.join(', ')}`);
  }
  if (typeof filters.price === 'number' && filters.price > 0) {
    filterParts.push(`Price tier: ${'$'.repeat(filters.price)}`);
  }
  if (filters.neighborhoods && filters.neighborhoods.length > 0) {
    filterParts.push(`Neighborhoods: ${filters.neighborhoods.join(', ')}`);
  }
  if (typeof filters.radius === 'number' && filters.radius > 0) {
    filterParts.push(`Within ${filters.radius} mi of the city centre`);
  }
  if (filters.sort && filters.sort !== 'recommended') {
    filterParts.push(`Sort: ${filters.sort}`);
  }
  if (filterParts.length > 0) {
    lines.push('Active filters:');
    for (const part of filterParts) lines.push(`- ${part}`);
    lines.push('');
  } else {
    lines.push('Active filters: none (the user is browsing the recommended pool).');
    lines.push('');
  }

  lines.push(
    'Available restaurants (filtered for the user; recommend ONLY from this list):',
  );
  const restaurants = (body.restaurants || []).slice(0, MAX_RESTAURANTS_IN_PROMPT);
  if (restaurants.length === 0) {
    lines.push('(no restaurants loaded yet — ask the user to wait or widen the filters)');
  } else {
    restaurants.forEach((r, i) => {
      const meta = [r.cuisine, r.price, r.neighborhood, r.score, r.distance]
        .filter(Boolean)
        .join(' · ');
      lines.push(`${i + 1}. ${r.name}  (id: ${r.id})  ${meta}`);
    });
  }
  lines.push('');

  lines.push('Guidelines:');
  lines.push('- Keep replies short (1-3 paragraphs unless asked for more).');
  lines.push(
    '- When suggesting specific places, ALWAYS call the recommend_restaurants tool — never type the names in prose.',
  );
  lines.push(
    '- Only recommend from the Available list above. If none of them fit what the user asked for, say so plainly and suggest the user widen the filters (clear the cuisine, raise the price tier, etc.).',
  );
  lines.push('- Be conversational, not robotic. Speak like a friendly local.');

  return lines.join('\n');
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    // Same-origin in production (Vercel serves both the SPA and the
    // API from the same domain) but allowing OPTIONS keeps `vercel dev`
    // and any future cross-origin testing painless.
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type, authorization',
      },
    });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'Method not allowed');
  }
  if (!ANTHROPIC_API_KEY) {
    return jsonError(500, 'ANTHROPIC_API_KEY is not configured on the function');
  }

  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }
  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonError(400, 'Missing messages[]');
  }

  const systemText = buildSystemPrompt(body);

  const anthropicBody = {
    model: body.model || DEFAULT_MODEL,
    max_tokens: 1024,
    stream: true,
    // System is shipped as a single text block with ephemeral cache_control
    // so consecutive turns against the same filter snapshot hit Anthropic's
    // prompt cache (~90% discount on cached input tokens).
    system: [
      {
        type: 'text',
        text: systemText,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [TOOL_RECOMMEND],
    messages: body.messages,
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
      const j = await anthropicRes.json();
      errText = j?.error?.message || j?.error || errText;
    } catch {
      // ignore body parse errors
    }
    return jsonError(anthropicRes.status, String(errText).slice(0, 500));
  }

  // Proxy the Anthropic SSE stream byte-for-byte. The frontend client
  // parses Anthropic's standard streaming event format.
  return new Response(anthropicRes.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
