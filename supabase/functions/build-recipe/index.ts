// AI Recipe Generator — Supabase Edge Function (Deno).
//
// Single-shot, structured recipe authoring for the Add Recipe modal's
// "Create with AI" flow, plus draft editing. The Anthropic response is
// STREAMED (SSE proxied byte-for-byte to the client) — a full Opus
// recipe can take 30s+, and a non-streaming call would block past the
// gateway's time-to-first-byte limit and 504. The client assembles the
// tool input from the streamed input_json_delta events.
//
// Request (one of):
//   { prompt, difficulty?, constraints? }   — create
//   { instruction, current }                — free-text refine
//   { ingredientEdit, current }             — remove/substitute one
//     ingredient; the model may DECLINE via the decline_change tool
//   { ideasPrompt, constraints?, avoidTitles? } — brainstorm: ~8 short
//     recipe IDEAS (title + blurb) via the suggest_recipe_ideas tool
//   { combine: { sources, notes? }, constraints? } — merge 2-3 sources
//   { nutritionFor: recipe }                 — per-serving nutrition estimate (Pro)
//     (ideas and/or full recipes) into ONE new recipe
// Response: Anthropic SSE stream (success) or { error } JSON (failure)
//
// The Anthropic API key lives as a Supabase secret (`ANTHROPIC_API_KEY`)
// and never reaches the browser bundle.

// Recipe quality bar + tool input schema are shared with the chat's
// build_recipe tool (location-chat) so both paths author equally
// calibrated recipes.
import { RECIPE_QUALITY_BAR, RECIPE_INPUT_SCHEMA, NUTRITION_SCHEMA } from '../_shared/recipe-spec.ts';
import { requireUser } from '../_shared/auth.ts';
import { readJsonBody } from '../_shared/limits.ts';
import { enforceQuota } from '../_shared/quota.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ANTHROPIC_API_KEY: string | undefined = Deno.env.get('ANTHROPIC_API_KEY');

// Opus authors noticeably better recipes (measurements, sequencing,
// realistic timing) than Sonnet, and this is a one-shot call rather
// than a high-volume chat, so the cost trade-off is worth it.
const MODEL = 'claude-opus-4-8';
// Ideas are titles and one-liners — easy work where latency IS the
// experience (a brainstorm that takes 20s isn't one). Sonnet keeps the
// suggestions varied and appealing at a fraction of the wait.
const IDEAS_MODEL = 'claude-sonnet-5';
const IDEAS_MAX_TOKENS = 2500;
const NUTRITION_MAX_TOKENS = 400;
// Headroom so a fully detailed complex recipe (a laminated dough with
// 15–20 richly-written steps, grouped ingredients, equipment, and a
// make-ahead timeline note) isn't truncated. Because the tool is forced,
// a max_tokens cutoff truncates the JSON mid-object and the client's
// JSON.parse fails — so we'd rather pay for the tokens than error out.
// Simple recipes stay cheap (cost scales with tokens actually produced).
const MAX_TOKENS = 12000;
const MAX_PROMPT_CHARS = 2000;

// Abuse guards (per signed-in user). The allowance per plan lives in
// plan_limits (migration 087): full builds and ideas draw from separate
// buckets ('build-recipe' / 'build-recipe-ideas') so a brainstorm session
// can't starve someone's actual recipe builds. The body cap fits the
// largest legit payload (a full recipe JSON + instruction) many times over.
const MAX_BODY_BYTES = 256 * 1024;

const SYSTEM_PROMPT = [
  'You are a meticulous recipe developer. Given a short description, you author ONE complete, REAL, testable recipe and return it by calling the `build_recipe` tool. You do not chat, ask questions, or add commentary — you always call the tool exactly once.',
  '',
  'Quality bar:',
  RECIPE_QUALITY_BAR,
  '- Honor every constraint in the user\'s prompt (servings, dietary restrictions, time budget, equipment, flavor direction). If the prompt is vague, make reasonable, appealing choices rather than asking.',
].join('\n');

// Used when the request carries `instruction` + `current` — the user is
// refining an existing draft. The model returns the FULL revised recipe.
const EDIT_SYSTEM_PROMPT = [
  'You are revising an EXISTING recipe. You will be given the current recipe as JSON and an instruction describing a change. Apply the instruction and return the COMPLETE revised recipe by calling the `build_recipe` tool exactly once.',
  '',
  'Rules:',
  '- Include ALL fields in your call — changed AND unchanged. The result fully replaces the old recipe, so anything you omit is lost.',
  '- Change ONLY what the instruction asks for (plus knock-on edits it implies — e.g. if asked to make it spicier, you may also add a note). Keep the rest faithful to the current recipe.',
  '- It is the SAME dish unless the instruction explicitly asks for a different one. Keep the name unless the change warrants a new one.',
  '- Preserve the recipe\'s level of complexity: a refinement is not an invitation to add steps, sections, or ceremony the change does not require.',
  '',
  'Quality bar (maintain it):',
  RECIPE_QUALITY_BAR,
].join('\n');

// Used when the request carries `ingredientEdit` + `current` — the user
// asked to remove or substitute ONE specific ingredient from the draft
// sheet. Unlike the generic refine, the model may DECLINE the change
// (via the decline_change tool) when it would wreck the dish.
const INGREDIENT_EDIT_SYSTEM_PROMPT = [
  'You are revising an EXISTING recipe: the cook wants one specific ingredient removed or substituted. You will be given the current recipe as JSON and the requested change. You must call exactly ONE tool:',
  '',
  'First, judge the change honestly:',
  '- If the dish stays authentic and genuinely good without the ingredient (or with a sound substitution), make the change: call `build_recipe` with the COMPLETE revised recipe.',
  '- If the ingredient is structural or defining — removing or replacing it would break the technique, texture, or the very identity of the dish (eggs in a meringue, the gochujang in tteokbokki, the flour in a roux-thickened gumbo) — do NOT change the recipe. Call `decline_change` with a short, friendly explanation of why, plus a workable alternative if one exists.',
  '- If the cook named a specific replacement that would not work, but the ingredient could be handled another way, still call `decline_change` — explain why their replacement fails and suggest what would work instead. Never silently substitute something the cook did not ask for.',
  '- Lean toward making the change whenever a respectable version of the dish exists without the ingredient; decline when the result would be a different or clearly worse dish wearing the same name.',
  '',
  'When you DO apply the change (build_recipe):',
  '- Include ALL fields — changed AND unchanged. The result fully replaces the old recipe.',
  '- Adjust everything the change touches: the ingredient list, quantities (a substitution rarely swaps 1:1), every step that mentions the ingredient, timings if they shift, and the name ONLY if it no longer fits (e.g. "Chicken Fried Rice" → "Vegetable Fried Rice").',
  '- For a removal, rebalance so the dish still works (replace lost liquid, fat, acid, or bulk as needed) — do not just delete the line.',
  '- For a substitution with no replacement named, choose the best one for this dish and use it consistently.',
  '- Add one brief `substitution` note recording what changed and anything the cook should watch for.',
  '- Keep everything else exactly as it was — same complexity, same voice, no unrelated rewrites.',
  '',
  'Quality bar (maintain it):',
  RECIPE_QUALITY_BAR,
].join('\n');

// Used for the `ideasPrompt` mode — a brainstorm, not an authoring pass.
const IDEAS_SYSTEM_PROMPT = [
  'You are a recipe ideation partner. Given a mood, craving, or set of constraints, you propose EIGHT distinct dish ideas by calling the `suggest_recipe_ideas` tool exactly once. You do not chat or add commentary.',
  '',
  'Rules:',
  '- Ideas, NOT recipes: a title and one enticing sentence. Never include ingredient lists, quantities, or steps.',
  '- Each idea is a REAL, specific, cookable dish ("Gochujang-glazed salmon rice bowls"), not a category ("something Korean").',
  '- Vary the set: spread across techniques, proteins/mains, and effort levels within the constraints. No two ideas should feel like siblings.',
  '- The blurb sells the dish in one breath — texture, flavor, why tonight. Max ~140 characters.',
  '- totalTimeMin is an honest estimate of prep + cook + passive time for a home cook.',
  '- Every idea must satisfy every hard requirement given. If a list of titles to avoid is provided, propose nothing that duplicates or trivially rephrases them.',
].join('\n');

const TOOL_SUGGEST_IDEAS = {
  name: 'suggest_recipe_ideas',
  description: 'Return exactly eight distinct recipe ideas. Call this exactly once.',
  input_schema: {
    type: 'object',
    required: ['ideas'],
    properties: {
      ideas: {
        type: 'array',
        minItems: 8,
        maxItems: 8,
        items: {
          type: 'object',
          required: ['title', 'blurb', 'cuisine', 'totalTimeMin', 'difficulty'],
          properties: {
            title: { type: 'string', description: 'The dish, named specifically. 2-8 words.' },
            blurb: { type: 'string', description: 'One enticing sentence, ≤140 characters. No ingredients lists, no steps.' },
            cuisine: { type: 'string', description: "The dish's cuisine, one or two words." },
            totalTimeMin: { type: 'number', description: 'Honest total minutes: prep + cook + passive.' },
            difficulty: { type: 'string', enum: ['Easy', 'Medium', 'Hard'] },
          },
        },
      },
    },
  },
};

// Used for the `combine` mode — merging 2-3 sources into one new dish.
const COMBINE_SYSTEM_PROMPT = [
  'You are a meticulous recipe developer. You will be given two or three SOURCE items — recipe ideas and/or complete recipes — and optionally a note about what the cook wants from each. Merge them into ONE new, coherent, REAL, testable recipe and return it by calling the `build_recipe` tool exactly once. You do not chat or add commentary.',
  '',
  'Rules for combining:',
  '- The result is one dish a cook would actually make and be proud of — a genuine synthesis, never two recipes stapled together or served side by side.',
  "- The cook's note, when present, is your ranked priority list: the qualities it names MUST survive into the result.",
  '- Without a note, take the most distinctive, best-loved element of each source (a technique, a sauce, a flavor pairing, a texture) and build the dish around how they genuinely complement each other.',
  '- Resolve conflicts in favor of what cooks best, not an even split. It is fine for one source to dominate.',
  '- Name the dish as ITSELF — what it actually is — never "X meets Y" or mashed-up source titles.',
  '- Write the complete recipe from scratch to the quality bar; do not copy steps verbatim from the sources.',
  '',
  'Quality bar:',
  RECIPE_QUALITY_BAR,
].join('\n');

const TOOL_BUILD_RECIPE = {
  name: 'build_recipe',
  description: 'Return one complete recipe. Call this exactly once with every relevant field filled.',
  input_schema: RECIPE_INPUT_SCHEMA,
};

// The nutrition-estimate mode: a recipe in, per-serving numbers out.
const TOOL_ESTIMATE_NUTRITION = {
  name: 'estimate_nutrition',
  description: 'Return the per-serving nutrition estimate for the given recipe. Call exactly once.',
  input_schema: NUTRITION_SCHEMA,
};
const NUTRITION_SYSTEM_PROMPT = [
  'You are a careful nutrition estimator. You will be given a recipe as JSON (ingredients with amounts, and servings). Estimate the nutrition PER SERVING and return it by calling the `estimate_nutrition` tool exactly once.',
  '- Work from the ingredient amounts and standard nutrition data; divide totals by `servings` (assume 4 when missing).',
  '- Count only what ends up on the plate: discard marinade or frying oil that is not absorbed, water, and garnish that is clearly optional.',
  '- Round to whole numbers. Never return all zeros.',
].join('\n');

// Escape hatch for the ingredient-edit mode: lets the model refuse a
// change that would compromise the dish instead of forcing a bad edit.
const TOOL_DECLINE_CHANGE = {
  name: 'decline_change',
  description: 'Decline the requested ingredient change because the recipe cannot stay authentic and genuinely good with it. The recipe is left untouched. Explain why in a friendly way and suggest a workable alternative when one exists.',
  input_schema: {
    type: 'object',
    required: ['reason'],
    properties: {
      reason: {
        type: 'string',
        description: '1–3 friendly sentences addressed to the cook: why this change would hurt the dish, and (when possible) what would work instead.',
      },
    },
  },
};

// CORS so the native (Capacitor) build can call this cross-origin; the
// web app is same-origin. Every response must carry these, not just the
// preflight.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * The difficulty + guidelines as an explicit hard-requirement checklist
 * (not buried in the prompt prose) so the model reliably designs around
 * them — the difficulty governs which version of the dish gets written,
 * and time/servings/dietary become verifiable line items the quality bar
 * tells it to re-check. Shared by the create, ideas, and combine modes.
 */
function constraintReqs(
  rawDifficulty: unknown,
  constraints: { totalTimeMax?: number; servings?: number; course?: string; dietary?: string[] } | undefined,
): string[] {
  const difficulty = ['Easy', 'Medium', 'Hard'].includes(rawDifficulty as string)
    ? (rawDifficulty as string)
    : '';
  const c = constraints || {};
  const reqs: string[] = [];
  if (difficulty) {
    reqs.push(`Difficulty: ${difficulty}. Apply the ${difficulty} DIFFICULTY CONTRACT from the quality bar — it governs technique choice, ingredient count, equipment, and step count, not just tone. Set the difficulty field to "${difficulty}".`);
  }
  if (typeof c.servings === 'number' && c.servings >= 1 && c.servings <= 100) {
    reqs.push(`Serves exactly ${Math.round(c.servings)} — set the servings field to ${Math.round(c.servings)} and scale every quantity to match.`);
  }
  if (typeof c.totalTimeMax === 'number' && c.totalTimeMax >= 5 && c.totalTimeMax <= 100000) {
    const max = Math.round(c.totalTimeMax);
    reqs.push(`Total time of at most ${max} minutes — prepTime + cookTime + chillTime (ALL passive time included) must sum to ≤ ${max}. If the classic version cannot fit, write a faster authentic variation that can; never misreport timings.`);
  }
  if (typeof c.course === 'string' && c.course.trim()) {
    reqs.push(`Course: ${c.course.trim().slice(0, 40)} — the dish must genuinely suit it.`);
  }
  if (Array.isArray(c.dietary) && c.dietary.length > 0) {
    const diets = c.dietary
      .filter((d) => typeof d === 'string' && d.trim())
      .map((d) => d.trim().slice(0, 40))
      .slice(0, 8);
    if (diets.length > 0) {
      reqs.push(`Strictly ${diets.join(' and ')} — applies to every ingredient, garnish, and suggested substitution, no exceptions.`);
    }
  }
  return reqs;
}

/**
 * One combine source, serialized with a per-source budget. NOT the
 * refine mode's readCurrentJson: that hard-slices the WHOLE payload at
 * 12k chars, which truncates mid-JSON — and two or three full recipes
 * routinely exceed it. Here each source gets its own cap, and the prose
 * fields nobody needs for a merge (description, notes) are dropped
 * first; only then is the source refused outright.
 */
function serializeCombineSource(source: unknown, cap = 9000): string | null {
  const attempt = (v: unknown): string | null => {
    try {
      const j = JSON.stringify(v);
      return j.length <= cap ? j : null;
    } catch {
      return null;
    }
  };
  const full = attempt(source);
  if (full) return full;
  if (source && typeof source === 'object') {
    const slim: Record<string, unknown> = { ...(source as Record<string, unknown>) };
    delete slim.description;
    delete slim.notes;
    delete slim.nutrition;
    return attempt(slim);
  }
  return null;
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

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

  const parsed = await readJsonBody<{
    prompt?: string;
    difficulty?: string;
    constraints?: {
      totalTimeMax?: number;
      servings?: number;
      course?: string;
      dietary?: string[];
    };
    instruction?: string;
    ingredientEdit?: { action?: string; ingredient?: string; replacement?: string };
    current?: unknown;
    ideasPrompt?: string;
    avoidTitles?: string[];
    combine?: { sources?: Array<{ kind?: string; idea?: unknown; recipe?: unknown }>; notes?: string };
    nutritionFor?: unknown;
  }>(req, MAX_BODY_BYTES);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  // Ideas draw from their own bucket; everything that produces a full
  // recipe shares the other. The quota call only reads the Authorization
  // header, so running it after the body parse (to know which mode this
  // is) costs nothing.
  const isIdeas = typeof body.ideasPrompt === 'string';
  const isNutrition = !isIdeas && !!body.nutritionFor && typeof body.nutritionFor === 'object';
  const quota = await enforceQuota(
    req,
    isNutrition ? 'nutrition-estimate' : isIdeas ? 'build-recipe-ideas' : 'build-recipe',
    isNutrition ? 'Nutrition estimates are part of GoodEats Pro.' : isIdeas ? "You've used your recipe ideas for now. %reset%" : "You've used your AI recipe generations for now. %reset%",
  );
  if ('response' in quota) return quota.response;

  // Five modes:
  //  • create          — { prompt, difficulty?, constraints? }
  //  • refine          — { instruction, current }  (edit an existing draft)
  //  • ingredient edit — { ingredientEdit, current }  (remove/substitute one
  //    ingredient; the model may decline via the decline_change tool)
  //  • ideas           — { ideasPrompt, constraints?, avoidTitles? }
  //  • combine         — { combine: { sources, notes? }, constraints? }
  // Sniffing is unambiguous: refine/ingredient-edit require `current`,
  // ideas requires the `ideasPrompt` string, combine its own key, and
  // only a bare `prompt` falls through to create.
  const instruction = (body.instruction || '').trim().slice(0, MAX_PROMPT_CHARS);
  const ingredientName = (body.ingredientEdit?.ingredient || '').trim().slice(0, 200);
  const isIngredientEdit = !!ingredientName && !!body.current;
  const isRefine = !isIngredientEdit && !!instruction && !!body.current;
  const isCombine = !isIngredientEdit && !isRefine && !isIdeas && !isNutrition && !!body.combine;

  const readCurrentJson = (): string | null => {
    try {
      return JSON.stringify(body.current).slice(0, 12000);
    } catch {
      return null;
    }
  };

  let messages: Array<{ role: 'user'; content: string }>;
  if (isNutrition) {
    let recipeJson: string | null = null;
    try { recipeJson = JSON.stringify(body.nutritionFor).slice(0, 12000); } catch { recipeJson = null; }
    if (!recipeJson) return jsonError(400, 'Could not read the recipe.');
    messages = [{ role: 'user', content: `Recipe (JSON):\n${recipeJson}\n\nEstimate the per-serving nutrition and return it with estimate_nutrition.` }];
  } else if (isIngredientEdit) {
    const currentJson = readCurrentJson();
    if (!currentJson) return jsonError(400, 'Could not read the current recipe.');
    const action = body.ingredientEdit?.action === 'substitute' ? 'substitute' : 'remove';
    const replacement = (body.ingredientEdit?.replacement || '').trim().slice(0, 200);
    const ask = action === 'remove'
      ? `The cook wants to REMOVE this ingredient: "${ingredientName}".`
      : replacement
        ? `The cook wants to SUBSTITUTE this ingredient: "${ingredientName}" — replacing it with "${replacement}".`
        : `The cook wants to SUBSTITUTE this ingredient: "${ingredientName}" — with the best replacement you'd choose for this dish.`;
    messages = [{
      role: 'user',
      content: `Here is the current recipe as JSON:\n\n${currentJson}\n\n${ask}\n\nFirst decide honestly whether this can be done while keeping the dish authentic and genuinely good. If yes, call build_recipe with the COMPLETE revised recipe (all fields). If not, call decline_change and leave the recipe untouched.`,
    }];
  } else if (isRefine) {
    const currentJson = readCurrentJson();
    if (!currentJson) return jsonError(400, 'Could not read the current recipe.');
    messages = [{
      role: 'user',
      content: `Here is the current recipe as JSON:\n\n${currentJson}\n\nApply this change and return the COMPLETE revised recipe (all fields): ${instruction}`,
    }];
  } else if (isIdeas) {
    const prompt = (body.ideasPrompt || '').trim().slice(0, MAX_PROMPT_CHARS);
    const reqs = constraintReqs(body.difficulty, body.constraints);
    // Previously-shown titles, capped hard: this list only ever grows as
    // the user asks for more, and an unbounded echo of it is the one way
    // this cheap mode gets expensive.
    const avoid = (Array.isArray(body.avoidTitles) ? body.avoidTitles : [])
      .filter((t): t is string => typeof t === 'string' && !!t.trim())
      .map((t) => t.trim().slice(0, 120))
      .slice(0, 40);
    const parts = [
      prompt
        ? `The cook is in the mood for: ${prompt}`
        : 'The cook has no particular dish in mind — propose a varied, appealing spread within the requirements.',
    ];
    if (reqs.length > 0) {
      parts.push(`Hard requirements — every idea must satisfy every one:\n${reqs.map((r) => `- ${r}`).join('\n')}`);
    }
    if (avoid.length > 0) {
      parts.push(`Already shown — do not repeat or trivially rephrase any of these:\n${avoid.map((t) => `- ${t}`).join('\n')}`);
    }
    messages = [{ role: 'user', content: parts.join('\n\n') }];
  } else if (isCombine) {
    const rawSources = Array.isArray(body.combine?.sources) ? body.combine!.sources! : [];
    if (rawSources.length < 2 || rawSources.length > 3) {
      return jsonError(400, 'Combining takes two or three sources.');
    }
    const blocks: string[] = [];
    for (let i = 0; i < rawSources.length; i++) {
      const src = rawSources[i];
      const kind = src?.kind === 'recipe' ? 'recipe' : 'idea';
      const payload = kind === 'recipe' ? src?.recipe : src?.idea;
      const json = serializeCombineSource(payload);
      if (!json) return jsonError(400, `Could not read source ${i + 1}.`);
      blocks.push(`SOURCE ${i + 1} (a ${kind === 'recipe' ? 'complete recipe' : 'recipe idea'}):\n${json}`);
    }
    const notes = (body.combine?.notes || '').trim().slice(0, MAX_PROMPT_CHARS);
    const reqs = constraintReqs(body.difficulty, body.constraints);
    const parts = [blocks.join('\n\n')];
    if (notes) parts.push(`What the cook wants from them (ranked priorities):\n${notes}`);
    if (reqs.length > 0) {
      parts.push(`Hard requirements — every one is mandatory:\n${reqs.map((r) => `- ${r}`).join('\n')}`);
    }
    parts.push('Merge these into ONE new, coherent recipe and return it with build_recipe (all fields).');
    messages = [{ role: 'user', content: parts.join('\n\n') }];
  } else {
    const prompt = (body.prompt || '').trim().slice(0, MAX_PROMPT_CHARS);
    if (!prompt) {
      return jsonError(400, 'Tell me what recipe you want to create.');
    }
    const reqs = constraintReqs(body.difficulty, body.constraints);
    const reqBlock = reqs.length > 0
      ? `\n\nHard requirements — every one is mandatory; re-check the finished recipe against each before returning:\n${reqs.map((r) => `- ${r}`).join('\n')}`
      : '\n\nNo difficulty was specified — write the dish at its natural complexity (simple dishes stay simple; demanding dishes get the full treatment), then set the difficulty field to what the recipe honestly is.';
    messages = [{ role: 'user', content: prompt + reqBlock }];
  }

  const anthropicBody = {
    model: isIdeas || isNutrition ? IDEAS_MODEL : MODEL,
    max_tokens: isNutrition ? NUTRITION_MAX_TOKENS : isIdeas ? IDEAS_MAX_TOKENS : MAX_TOKENS,
    // Stream the response. A long Opus recipe can take 30s+ to finish;
    // a non-streaming call would block until then and
    // trip the platform's time-to-first-byte limit (gateway 504).
    // Streaming sends bytes immediately, so we just proxy Anthropic's
    // SSE straight through and let the client assemble the tool input.
    stream: true,
    system: isNutrition
      ? NUTRITION_SYSTEM_PROMPT
      : isIngredientEdit
      ? INGREDIENT_EDIT_SYSTEM_PROMPT
      : isRefine ? EDIT_SYSTEM_PROMPT
      : isIdeas ? IDEAS_SYSTEM_PROMPT
      : isCombine ? COMBINE_SYSTEM_PROMPT
      : SYSTEM_PROMPT,
    // The ingredient-edit mode carries the decline escape hatch; every
    // other mode forces its single tool so the only possible output is
    // the structured payload.
    tools: isNutrition
      ? [TOOL_ESTIMATE_NUTRITION]
      : isIngredientEdit
      ? [TOOL_BUILD_RECIPE, TOOL_DECLINE_CHANGE]
      : isIdeas ? [TOOL_SUGGEST_IDEAS]
      : [TOOL_BUILD_RECIPE],
    tool_choice: isIngredientEdit
      ? { type: 'any' }
      : { type: 'tool', name: isNutrition ? 'estimate_nutrition' : isIdeas ? 'suggest_recipe_ideas' : 'build_recipe' },
    messages,
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

  // Proxy the Anthropic SSE stream byte-for-byte. The client assembles
  // the tool_use input from the input_json_delta events.
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
