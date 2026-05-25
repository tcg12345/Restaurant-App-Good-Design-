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

// Tools Claude can use.
//
// `recommend_restaurants` is the ONLY way the model surfaces a place
// to the user — typing names in prose doesn't render cards.
//
// `search_restaurants` lets Claude fetch fresh Google Places results
// when the Available list doesn't contain what the user asked for
// (e.g. user asks for "chicken wings" but the filtered pool is full
// of fine-dining French). The frontend executes the search, appends
// the hits to a chat-local pool, and returns a compact id-keyed
// listing in the tool_result. Claude can then recommend those ids.
const TOOL_RECOMMEND = {
  name: 'recommend_restaurants',
  description:
    "Recommend specific restaurants to the user. Always use this tool when you want to surface places — never type their names in prose. IDs MUST be the (id: ...) Google place ids from either the Available restaurants section of the system prompt OR a previous search_restaurants tool result in this conversation.",
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

const TOOL_SEARCH = {
  name: 'search_restaurants',
  description:
    "Search Google Places for restaurants when the Available list doesn't have what the user is asking for, OR when you need to turn a restaurant name (e.g. from web_search results) into a real id you can render as a card. Use this whenever you want the user to see CLICKABLE CARDS — the only way cards appear is by passing a real Google place id to recommend_restaurants, and this tool is how you get those ids.",
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          "Free-text search query. Can be a category ('chicken wings', 'late-night ramen') or a specific restaurant name returned by web_search ('Felice Westport', 'Carbone'). The frontend will combine this with the city.",
      },
      city: {
        type: 'string',
        description:
          "Optional. City to anchor the search to, e.g. 'Westport, CT', 'Tokyo', 'Paris'. Omit (or leave empty) to search the user's CURRENT city. Set this when the user asked about a different city or when web_search results pointed you to a city other than the current one.",
      },
    },
    required: ['query'],
  },
};

const TOOL_RECOMMEND_RECIPES = {
  name: 'recommend_recipes',
  description:
    "Surface recipe cards for recipes the user has saved (from the RECIPES section of the system prompt). Use this — not prose — when you want to point the user at one of their own recipes (e.g. they ask 'what should I cook tonight?' or 'do I have any pasta recipes?'). IDs MUST be from the RECIPES section.",
  input_schema: {
    type: 'object',
    properties: {
      recipe_ids: {
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
    required: ['recipe_ids'],
  },
};

const TOOL_LOOKUP_USER = {
  name: 'lookup_user',
  description:
    "Look up other users in the app by username or display name. Use when the user mentions another person (\"what does Camille think?\", \"find users named Jamie\") or when knowing a friend's / expert's taste would sharpen the recommendation. Returns up to 5 public profiles with handle, display name, bio, expert flag, home city, and a count of their public ratings. You may then refer to them by name in your reply.",
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Username, display name, or partial name to match (case-insensitive substring).',
      },
    },
    required: ['query'],
  },
};

// Anthropic's built-in server-side web_search tool. Anthropic runs
// the searches inside the API call; results come back as content
// blocks the model integrates into its reply. Bills separately
// (~$10 / 1,000 searches as of mid-2025) but is the cleanest path
// to letting Claude verify facts or pull recent info (closures,
// new openings, recent press) without standing up our own proxy.
const TOOL_WEB_SEARCH = {
  type: 'web_search_20250305',
  name: 'web_search',
  // Bound per-turn cost. Five is plenty for "is this place still
  // open?" / "any recent reviews?" verifications.
  max_uses: 5,
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

// Personalization context the frontend assembles from useLists() /
// useAuth() / signals + areaExperts. Optional everywhere so the
// chat keeps working for unauthenticated browsing.
interface UserContext {
  displayName?: string;
  username?: string;
  homeCity?: string;
  /** Lowercased cuisine words the user gravitates toward, derived
   *  from their ratings / wishlist / lists via buildTasteProfile. */
  topCuisines?: string[];
  /** User's own most-recent / top-rated restaurants. `id` is the
   *  Google place id (= restaurantId on the rating row) so Claude
   *  can pass it to recommend_restaurants to render a card. */
  topRated?: Array<{ id?: string; name: string; score?: number; cuisine?: string; neighborhood?: string }>;
  /** Restaurants in the user's wishlist. */
  wishlist?: Array<{ id?: string; name: string; cuisine?: string; neighborhood?: string }>;
  /** Recipes the user has saved / cooked. */
  recipes?: Array<{
    id: string;
    title: string;
    cuisine?: string;
    prepTime?: number;
    cookTime?: number;
    difficulty?: string;
    ingredientCount?: number;
    stepCount?: number;
  }>;
  /** Friends the user has connected with — display names only. */
  friends?: Array<{ displayName: string; username?: string }>;
  /** Experts the user follows. */
  followedExperts?: Array<{ displayName: string; username?: string; bio?: string }>;
  /** Visible-restaurant ids the user's circle has rated, with how
   *  many friends and experts respectively touched each one. Lets
   *  Claude weight 'Mira has rated this 9.4' kinds of signals. */
  circleSignals?: Array<{ restaurantId: string; friendCount?: number; expertCount?: number }>;
}

interface ChatRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: any }>;
  restaurants?: CompactRestaurant[];
  filters?: ChatFilters;
  city?: string;
  userContext?: UserContext;
  model?: string;
}

function buildSystemPrompt(body: ChatRequest): string {
  const city = body.city || 'this area';
  const filters = body.filters || {};
  const lines: string[] = [];
  lines.push(
    `You are a restaurant concierge. The user is currently browsing the explore page for ${city}, so that's your DEFAULT location: when they say "where should I eat?" or "what looks good?" without specifying a city, recommend things in ${city}.`,
  );
  lines.push(
    `BUT the user can also ask about restaurants anywhere in the world — "best pizza in Naples", "where to eat in Tokyo", "is X still open in LA". Answer those normally; use web_search for current info (closures, recent openings, press) and answer from general knowledge for established places. The search_restaurants tool only works in ${city}, so don't call it for other cities.`,
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

  // ── About this user ─────────────────────────────────────────────
  // Personalization block. Helps Claude tailor recommendations to
  // someone's taste history instead of cold-recommending from the
  // city's top-N. Empty fields are skipped so the prompt stays tight.
  const u = body.userContext;
  if (u && (u.displayName || u.topCuisines?.length || u.topRated?.length || u.wishlist?.length || u.recipes?.length || u.friends?.length || u.followedExperts?.length)) {
    lines.push('About this user:');
    if (u.displayName || u.username) {
      const parts = [u.displayName, u.username ? `@${u.username}` : null].filter(Boolean);
      lines.push(`- Name: ${parts.join(' ')}`);
    }
    if (u.homeCity) lines.push(`- Home city: ${u.homeCity}`);
    if (u.topCuisines && u.topCuisines.length > 0) {
      lines.push(`- Taste leans toward: ${u.topCuisines.slice(0, 6).join(', ')}`);
    }
    if (u.topRated && u.topRated.length > 0) {
      // RATED = the user has actually been there and scored it.
      // Listed one-per-line so individual entries are unambiguous
      // when the user asks "which of my Boston spots is highest
      // rated?". This list is exhaustive (up to 50 from the frontend) —
      // if the user mentions a city that doesn't appear in any of these
      // lines, they truly have no rating for it.
      lines.push(`- RATED restaurants (places the user has visited and scored, ${u.topRated.length} total). Each row carries the place id you'd pass to recommend_restaurants if you want to show a card:`);
      for (const r of u.topRated) {
        const bits = [
          r.name,
          r.id ? `(id: ${r.id})` : null,
          r.score != null ? `RATED ${r.score}/10` : null,
          r.cuisine,
          r.neighborhood,
        ].filter(Boolean);
        lines.push(`    • ${bits.join(' · ')}`);
      }
    }
    if (u.wishlist && u.wishlist.length > 0) {
      // WISHLIST = haven't been yet, want to try. Crucial that this
      // is never conflated with rated places — they're entirely
      // different signals. Listed one-per-line for the same reason.
      lines.push(`- WISHLIST (places the user wants to try but has NOT visited or rated, ${u.wishlist.length} total). Each row has the place id for recommend_restaurants:`);
      for (const r of u.wishlist) {
        const bits = [r.name, r.id ? `(id: ${r.id})` : null, r.cuisine, r.neighborhood].filter(Boolean);
        lines.push(`    • ${bits.join(' · ')}`);
      }
    }
    if (u.recipes && u.recipes.length > 0) {
      // RECIPES = the user's own saved cooking recipes (dishes with
      // ingredients + steps). NEVER conflate with restaurants. The
      // frontend already filters out stub entries (0 ingredients AND
      // 0 steps), so every row below is a real recipe.
      lines.push(`- RECIPES (the user's own saved COOKING recipes — dishes they cook at home, with ingredients and steps. NOT restaurants. ${u.recipes.length} total):`);
      for (const r of u.recipes) {
        const time = (r.prepTime || 0) + (r.cookTime || 0);
        const bits = [
          r.title,
          `(id: ${r.id})`,
          r.cuisine,
          time > 0 ? `${time} min total` : null,
          r.difficulty,
          r.ingredientCount != null ? `${r.ingredientCount} ingredient${r.ingredientCount === 1 ? '' : 's'}` : null,
          r.stepCount != null ? `${r.stepCount} step${r.stepCount === 1 ? '' : 's'}` : null,
        ].filter(Boolean);
        lines.push(`    • ${bits.join(' · ')}`);
      }
    } else {
      // Be explicit when empty — gives the AI a definite signal so it
      // doesn't try to be helpful by surfacing restaurants instead.
      lines.push(`- RECIPES: the user has NO saved cooking recipes. If they ask about recipes, tell them this honestly — do not substitute restaurants from RATED or WISHLIST.`);
    }
    if (u.friends && u.friends.length > 0) {
      lines.push(`- Friends: ${u.friends.slice(0, 10).map((f) => f.username ? `${f.displayName} (@${f.username})` : f.displayName).join(', ')}`);
    }
    if (u.followedExperts && u.followedExperts.length > 0) {
      lines.push(`- Follows experts: ${u.followedExperts.slice(0, 8).map((e) => {
        const handle = e.username ? `@${e.username}` : '';
        const bio = e.bio ? ` — ${e.bio}` : '';
        return `${e.displayName}${handle ? ` (${handle})` : ''}${bio}`;
      }).join('; ')}`);
    }
    if (u.circleSignals && u.circleSignals.length > 0) {
      // Tell Claude which (visible) restaurants have circle ratings.
      // The full counts let it preferentially recommend places
      // backed by people the user trusts.
      const sig = u.circleSignals.slice(0, 20).map((s) => {
        const bits: string[] = [s.restaurantId];
        if (s.friendCount) bits.push(`${s.friendCount} friend${s.friendCount === 1 ? '' : 's'}`);
        if (s.expertCount) bits.push(`${s.expertCount} expert${s.expertCount === 1 ? '' : 's'}`);
        return `[${bits.join(' / ')}]`;
      }).join(' ');
      lines.push(`- Circle ratings on visible places: ${sig}`);
    }
    lines.push('');
  }

  lines.push(
    "Available restaurants (the user's currently-filtered pool — this is a starting set, NOT the only places you can recommend):",
  );
  const restaurants = (body.restaurants || []).slice(0, MAX_RESTAURANTS_IN_PROMPT);
  if (restaurants.length === 0) {
    lines.push('(no restaurants loaded yet for the current filters — use search_restaurants for anything the user asks for)');
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
  lines.push('- Be conversational, not robotic. Speak like a friendly local.');
  lines.push('');
  lines.push('How to find the right places (tool playbook):');
  lines.push(
    '1. Check the Available list first. If it covers the ask, recommend from there.',
  );
  lines.push(
    "2. If Available doesn't have what the user asked for (specific dish, vibe, cuisine missing), call search_restaurants with a focused query.",
  );
  lines.push(
    "3. If the user mentions another person by name, or it'd help to weight a friend's / expert's taste, call lookup_user — you get back public profile info you can reference.",
  );
  lines.push(
    "4. If the user asks something that needs current real-world info (is X still open, recent press, new restaurant openings, who won a James Beard, etc.) use web_search. Don't use it for trivia covered in the Available list.",
  );
  lines.push(
    "4a. After web_search returns specific restaurant NAMES, do not just list them in prose — for each one you want to recommend, call search_restaurants({ query: '<the name>', city: '<the city the user asked about>' }) to convert it into a Google place id, then pass those ids to recommend_restaurants. That's the only way the user gets clickable cards from web results.",
  );
  lines.push(
    "5. ALWAYS surface places via the recommend_restaurants tool. EVERY restaurant you mention by name — including ones from the user's RATED list, their WISHLIST, or anywhere else — needs to be passed to recommend_restaurants with the place id from that row. The card render is what makes the name clickable for the user. Likewise, when surfacing one of the user's own RECIPES, use the recommend_recipes tool — never just type names in prose.",
  );
  lines.push(
    "5a. RECIPES vs RESTAURANTS — these are SEPARATE worlds. Restaurants are places to eat out (RATED, WISHLIST, the Available pool). Recipes are dishes to cook at home (the RECIPES section). NEVER pass a restaurant id to recommend_recipes, and NEVER pass a recipe id to recommend_restaurants. When the user asks about RECIPES (\"what should I cook tonight?\", \"what recipe have I rated highest?\", \"any rice recipes?\"), look ONLY at the RECIPES section. If RECIPES is empty or has no match, say so honestly — DO NOT substitute restaurants from RATED / WISHLIST as if they were recipes. The correct response when there are no matching recipes is: \"You don't have a saved recipe for [X]. Want me to suggest some general ideas, or look up restaurants serving it?\"",
  );
  lines.push(
    "6. Only say 'I couldn't find anything' AFTER trying search_restaurants and / or web_search and they genuinely returned nothing useful.",
  );
  lines.push(
    "7. Personalize. If the About-this-user section is present, weight recommendations toward their taste leanings, what their friends and experts have rated, etc. Mention the connection (\"this fits your Italian-leaning taste\", \"Mira has this at 9.4\") when it strengthens the case — but don't be sycophantic.",
  );
  lines.push(
    "7a. ACCURACY around user data: when the user asks about their own ratings or wishlist (\"what have I rated highest in Boston?\"), answer ONLY from the RATED restaurants or WISHLIST sections above. Treat them as SEPARATE — wishlist entries are places the user has NEVER rated. Read the city tag on each entry carefully when filtering by location; never claim the user has no ratings in a city without checking every RATED line for that city's name. If you genuinely don't see a match, say so plainly rather than guessing.",
  );
  lines.push(
    "8. Active filters may be hiding good answers; you can call it out (\"your Japanese filter is hiding wing spots — I searched broader\") but don't ask the user to clear filters first, just help.",
  );

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
    tools: [TOOL_RECOMMEND, TOOL_RECOMMEND_RECIPES, TOOL_SEARCH, TOOL_LOOKUP_USER, TOOL_WEB_SEARCH],
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
