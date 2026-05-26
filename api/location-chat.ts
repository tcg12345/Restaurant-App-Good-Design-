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

const ANTHROPIC_API_KEY: string | undefined = typeof process !== 'undefined'
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
    "Surface recipe cards. Use this — not prose — whenever you want to point the user at a specific recipe. IDs MUST come from one of two sources:\n  (a) the user's own RECIPES section in the system prompt, OR\n  (b) a previous search_community_recipes tool result in this conversation (friends' / experts' / public recipes).\nNever invent ids. Cards for community recipes auto-show the author's name so the user knows it's not their own.",
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

const TOOL_SEARCH_COMMUNITY_RECIPES = {
  name: 'search_community_recipes',
  description:
    "Search public recipes from friends, experts, and other users across the app. Use this whenever the user asks for a recipe and the RECIPES section of the system prompt (their own saved recipes) doesn't cover the ask. ALSO use it any time the user explicitly mentions friends / experts / 'someone' (e.g. 'find me a recipe from a friend', 'any expert pasta recipes?'). Returns up to 10 matching recipes with id, title, cuisine, time, difficulty, author username. You can then pass any returned id to recommend_recipes — the cards will resolve and show the author. ALWAYS try this BEFORE telling the user there are no recipes; only fall back to restaurants if the user asks for restaurants or community search also returns nothing.",
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: "Free-text search — cuisine, dish, ingredient, technique. Examples: 'korean', 'pasta', 'chicken stir fry', 'quick weeknight'. Pass an empty string to browse everything.",
      },
      cuisine: {
        type: 'string',
        description: "Optional explicit cuisine filter (e.g. 'Italian', 'Korean'). Matched case-insensitively against the recipe's cuisine field.",
      },
      source: {
        type: 'string',
        enum: ['friends', 'experts', 'public', 'all'],
        description: "Optional. 'friends' = only the user's friends; 'experts' = only experts; 'public' = all public recipes; 'all' (default) = friends + experts + general public combined.",
      },
    },
    required: [],
  },
};

const TOOL_GET_CIRCLE_RATINGS = {
  name: 'get_circle_ratings',
  description:
    "Look up who in the user's circle (their friends + the experts they follow) has rated a specific restaurant. Returns each circle member's username, display name, score, optional notes, and whether they're a friend or an expert. Use this whenever the user asks 'have any of my friends been to X?', 'who in my circle rated X highly?', 'what did Mira think of Y?', etc. — pass the restaurant's Google place id. If the user mentions the restaurant by name only, first look up the id in the user's RATED / WISHLIST / Available sections, or call search_restaurants to resolve it.",
  input_schema: {
    type: 'object',
    properties: {
      restaurant_id: {
        type: 'string',
        description: "Google place id of the restaurant (e.g. 'ChIJ...').",
      },
    },
    required: ['restaurant_id'],
  },
};

const TOOL_LOOKUP_USER = {
  name: 'lookup_user',
  description:
    "Look up other users in the app by username or display name. Use when the user mentions another person (\"what does Camille think?\", \"find users named Jamie\") or when knowing a friend's / expert's taste would sharpen the recommendation. You can also call this with an empty query to browse general users — useful when the user asks \"who should I follow?\" or \"find me some interesting people\". Returns up to 8 public profiles with handle, display name, bio, expert flag, home city. You may then refer to them by name in your reply.",
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Username, display name, or partial name to match (case-insensitive substring). Pass an empty string to browse general users.',
      },
    },
    required: ['query'],
  },
};

const TOOL_FIND_EXPERTS = {
  name: 'find_experts',
  description:
    "Browse food experts on the app. Use when the user asks to find experts to follow, discover taste-makers, see who the top reviewers are, or wants experts in a particular cuisine or city. You can pass an optional cuisine filter and / or city filter, or leave both empty to surface a general list. Returns up to 8 expert profiles with handle, display name, bio, home city. Mention them by name in your reply — names auto-link to their profiles. Pair with the navigate tool ({ path: '/experts' }) when the user wants to see the full list.",
  input_schema: {
    type: 'object',
    properties: {
      cuisine: {
        type: 'string',
        description: "Optional. Filter experts by cuisine focus (e.g. 'italian', 'japanese', 'pizza'). Matched against their bio.",
      },
      city: {
        type: 'string',
        description: "Optional. Filter experts to those whose home city contains this string (e.g. 'New York', 'Tokyo').",
      },
    },
    required: [],
  },
};

/* ── ACTION tools ────────────────────────────────────────────────
   These execute work in the app on the user's behalf — opening
   modals, navigating, toggling state. Every action tool maps to a
   handler the frontend wires up via the AppAssistant component.

   IMPORTANT for the model: action tools are NOT idempotent. Only
   call them when the user has clearly asked for the action — don't
   pre-emptively open modals or navigate when the user is just
   asking a question. After an action runs, the frontend usually
   closes the chat so the modal / new page is visible. */

const TOOL_NAVIGATE = {
  name: 'navigate',
  description:
    "Navigate the user to a different page in the app. Use whenever the user asks you to 'take me to', 'go to', 'open', 'show me' a page. Supported paths:\n- '/' — Home / Discover\n- '/circle' — friends + activity\n- '/pantry' — saved recipes\n- '/reels' — short videos feed\n- '/activity' — notifications / saved / likes\n- '/experts' — browse experts to follow\n- '/profile' — the user's own profile\n- '/messages' — DMs\n- '/search' — search\n- '/location' — explore restaurants by city\n- '/location/map' — map view\n- '/recipes-for-you' — recipe recommendations\n- '/restaurant/<id>' — a specific restaurant detail page\n- '/user/<username>' — another user's profile (resolve via lookup_user first)\n- '/recipe/<userId>/<recipeId>' — a specific recipe (prefer recommend_recipes for the user's own recipes)\nAlways include the leading slash. After navigating, the chat closes automatically.",
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: "The absolute path to navigate to, e.g. '/pantry' or '/user/jamie'.",
      },
      label: {
        type: 'string',
        description: "Optional human-friendly label for the destination (e.g. 'your Pantry', \"Jamie's profile\"). Used only in the tool result confirmation.",
      },
    },
    required: ['path'],
  },
};

const TOOL_OPEN_RATING_MODAL = {
  name: 'open_rating_modal',
  description:
    "Open the rating / add-restaurant flow for a specific restaurant — the same multi-step modal the user gets when tapping the '+' button on a restaurant card. Use whenever the user says 'rate <restaurant>', 'log a visit to <restaurant>', 'I want to review <restaurant>', 'add <restaurant>', etc. The restaurant_id MUST be a Google place id from the user's RATED / WISHLIST / Available sections OR a previous search_restaurants result. If you don't know the id, call search_restaurants first. The chat closes automatically when the modal opens.",
  input_schema: {
    type: 'object',
    properties: {
      restaurant_id: {
        type: 'string',
        description: 'Google place id of the restaurant to rate / log.',
      },
    },
    required: ['restaurant_id'],
  },
};

const TOOL_OPEN_ADD_RESTAURANT_MODAL = {
  name: 'open_add_restaurant_modal',
  description:
    "Alias of open_rating_modal that lets you pick a specific starting screen of the flow (notes / new-visit). Prefer open_rating_modal unless you really need the initial_page parameter.",
  input_schema: {
    type: 'object',
    properties: {
      restaurant_id: {
        type: 'string',
        description: 'Google place id of the restaurant.',
      },
      initial_page: {
        type: 'string',
        description: "Optional starting screen for the modal (e.g. 'new-visit').",
      },
    },
    required: ['restaurant_id'],
  },
};

const TOOL_OPEN_ADD_TO_LIST_MODAL = {
  name: 'open_add_to_list_modal',
  description:
    "Open the 'add to list' modal so the user can save a restaurant to one of their custom lists. Use when the user says 'add <restaurant> to my <list> list' or 'save <restaurant> to a list'. The restaurant_id MUST be a real Google place id. The chat closes automatically when the modal opens.",
  input_schema: {
    type: 'object',
    properties: {
      restaurant_id: {
        type: 'string',
        description: 'Google place id of the restaurant.',
      },
    },
    required: ['restaurant_id'],
  },
};

const TOOL_TOGGLE_WISHLIST = {
  name: 'toggle_wishlist',
  description:
    "Add a restaurant to the user's wishlist (if not already on it) or remove it (if it is). Use when the user says 'add <restaurant> to my wishlist', 'wishlist <restaurant>', 'I want to try <restaurant>', or 'remove <restaurant> from my wishlist'. The restaurant_id MUST be a real Google place id from the user's data or a search result. Confirm what happened in your reply.",
  input_schema: {
    type: 'object',
    properties: {
      restaurant_id: {
        type: 'string',
        description: 'Google place id of the restaurant.',
      },
    },
    required: ['restaurant_id'],
  },
};

const TOOL_OPEN_ADD_RECIPE_MODAL = {
  name: 'open_add_recipe_modal',
  description:
    "Open the Log Home Meal modal — the canonical surface for adding a dish the user cooked at home, with ingredients, steps, photos, and a score. Use when the user says 'add a recipe', 'create a recipe', 'log a recipe', 'add a home meal', 'log what I cooked', etc. The chat closes automatically when the modal opens.",
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

const TOOL_OPEN_ADD_POST_MODAL = {
  name: 'open_add_post_modal',
  description:
    "Open the Add Post modal so the user can create a new multi-media post (photos / videos with a caption + location). Use when the user says 'create a post', 'make a post', 'share something'. The chat closes automatically when the modal opens.",
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

const TOOL_OPEN_ADD_REEL_MODAL = {
  name: 'open_add_reel_modal',
  description:
    "Open the Add Reel modal so the user can create a short video reel. Use when the user says 'create a reel', 'make a reel', 'upload a video'. The chat closes automatically when the modal opens.",
  input_schema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: ['restaurant', 'recipe'],
        description: "Optional. 'restaurant' attaches the reel to a restaurant; 'recipe' attaches it to one of the user's recipes. Omit to let the user choose.",
      },
    },
    required: [],
  },
};

const TOOL_OPEN_HOME_MEAL_MODAL = {
  name: 'open_home_meal_modal',
  description:
    "Alias of open_add_recipe_modal — opens the Log Home Meal modal. Either tool is fine; both surface the same flow.",
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

const TOOL_OPEN_GUIDE_CREATOR = {
  name: 'open_guide_creator',
  description:
    "Open the Guide Creator so the user can build a new restaurant or recipe guide (a curated themed collection). Use when the user says 'create a guide', 'make a new guide', 'start a guide about...'. The chat closes automatically when the sheet opens.",
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
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
  /** Where the user currently is in the app. Lets Claude tailor the
   *  reply ("you're already on the Pantry page", "I'll take you back
   *  to Explore"). Defaults to the explore page when omitted. */
  currentPath?: string;
  /** Human-readable label for the current page (e.g. "the Pantry",
   *  "your Profile") — used in the system prompt directly. */
  currentPageLabel?: string;
  model?: string;
}

function buildSystemPrompt(body: ChatRequest): string {
  const city = body.city || 'this area';
  const filters = body.filters || {};
  const currentPath = body.currentPath || '/location';
  const currentPageLabel = body.currentPageLabel || 'the explore page';
  const onLocationPage = currentPath === '/location' || currentPath.startsWith('/location/');
  const lines: string[] = [];
  lines.push(
    `You are the in-app assistant for a restaurant + recipe social app. You can answer questions AND execute tasks for the user — opening modals, navigating between pages, toggling wishlist, looking up other users, recommending places.`,
  );
  lines.push('');
  lines.push(`The user is currently on: ${currentPageLabel} (route: ${currentPath}).`);
  if (onLocationPage) {
    lines.push(
      `That page shows restaurants for ${city}, so that's your DEFAULT location: when they say "where should I eat?" or "what looks good?" without specifying a city, recommend things in ${city}.`,
    );
  } else {
    lines.push(
      `When the user asks for restaurant recommendations without specifying a city, default to ${city} (their home city / last explored city).`,
    );
  }
  lines.push(
    `The user can ask about restaurants anywhere in the world — "best pizza in Naples", "where to eat in Tokyo", "is X still open in LA". Answer those normally; use web_search for current info (closures, recent openings, press) and answer from general knowledge for established places. The search_restaurants tool defaults to ${city} but accepts a city override.`,
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
      lines.push(`- RECIPES: the user has NO saved cooking recipes of their own. If they ask about recipes, DO NOT say "you don't have any" and stop — call search_community_recipes to look across friends / experts / public recipes FIRST.`);
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
  lines.push('- After running an ACTION tool, your reply should briefly confirm what you did, not narrate the click-by-click.');
  lines.push('');
  lines.push('When to take ACTIONS vs answer in prose:');
  lines.push(
    "- If the user clearly asks for something to happen ('rate Carbone', 'take me to Jamie\\'s profile', 'add Per Se to my wishlist', 'open a new post', 'create a guide'), run the matching action tool. Don't ask for permission — just do it and confirm.",
  );
  lines.push(
    "- If they just want a recommendation or info, answer normally without firing actions.",
  );
  lines.push('- For actions that need a restaurant id (open_rating_modal, toggle_wishlist, open_add_to_list_modal, open_add_restaurant_modal): resolve the id from the user\'s RATED / WISHLIST / Available sections, or call search_restaurants to look it up. NEVER invent an id.');
  lines.push("- For navigating to another user's profile: call lookup_user first to get the @username, then call navigate({ path: '/user/<username>' }). If the user says \"find me an expert who…\" or \"who should I follow?\", use find_experts (optionally filtered by cuisine / city) and present a few — name-mentions auto-link.");
  lines.push('');
  lines.push('How to find the right places (tool playbook):');
  lines.push(
    '1. Check the Available list first. If it covers the ask, recommend from there.',
  );
  lines.push(
    "2. If Available doesn't have what the user asked for (specific dish, vibe, cuisine missing), call search_restaurants with a focused query.",
  );
  lines.push(
    "3. If the user mentions another person by name, or it'd help to weight a friend's / expert's taste, call lookup_user — you get back public profile info you can reference. When the user asks 'have my friends been to X' / 'who rated X' / 'what did <name> think of X', call get_circle_ratings(restaurant_id) — you'll get back a list of circle members with their scores. Names you mention in your reply will auto-link to their profile pages.",
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
    "5a. RECIPES vs RESTAURANTS — these are SEPARATE worlds. Restaurants are places to eat out (RATED, WISHLIST, the Available pool). Recipes are dishes to cook at home. NEVER pass a restaurant id to recommend_recipes, and NEVER pass a recipe id to recommend_restaurants.",
  );
  lines.push(
    "5b. RECIPES — TWO POOLS. (1) The user's OWN RECIPES (the RECIPES section of this prompt). (2) The COMMUNITY RECIPES pool — public recipes from friends, followed experts, and other users — fetched on demand via the search_community_recipes tool. When the user asks about a recipe (\"find me a korean recipe\", \"any good pasta recipes?\", \"what should I cook tonight?\"):",
  );
  lines.push(
    "    Step 1. Check the user's OWN RECIPES first. If something matches, recommend it via recommend_recipes.",
  );
  lines.push(
    "    Step 2. If nothing in their own pool matches (or they explicitly ask for friends' / experts' / other people's recipes), CALL search_community_recipes with a focused query. Pass any returned id to recommend_recipes — the card will render with the author's name.",
  );
  lines.push(
    "    Step 3. ONLY after both pools come up empty should you offer alternatives — and even then, prefer 'here are some general ideas / want me to web_search for one?' over 'want restaurants instead?'. NEVER pivot to restaurants unprompted when the user clearly wanted a recipe. Restaurants are an option only if the user accepts the pivot or explicitly asks for them.",
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
    tools: [
      TOOL_RECOMMEND,
      TOOL_RECOMMEND_RECIPES,
      TOOL_SEARCH,
      TOOL_SEARCH_COMMUNITY_RECIPES,
      TOOL_LOOKUP_USER,
      TOOL_FIND_EXPERTS,
      TOOL_GET_CIRCLE_RATINGS,
      // Action tools — execute work on the user's behalf.
      TOOL_NAVIGATE,
      TOOL_OPEN_RATING_MODAL,
      TOOL_OPEN_ADD_RESTAURANT_MODAL,
      TOOL_OPEN_ADD_TO_LIST_MODAL,
      TOOL_TOGGLE_WISHLIST,
      TOOL_OPEN_ADD_RECIPE_MODAL,
      TOOL_OPEN_ADD_POST_MODAL,
      TOOL_OPEN_ADD_REEL_MODAL,
      TOOL_OPEN_HOME_MEAL_MODAL,
      TOOL_OPEN_GUIDE_CREATOR,
      TOOL_WEB_SEARCH,
    ],
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
