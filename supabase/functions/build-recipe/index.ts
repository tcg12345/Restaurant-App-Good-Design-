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
// Response: Anthropic SSE stream (success) or { error } JSON (failure)
//
// The Anthropic API key lives as a Supabase secret (`ANTHROPIC_API_KEY`)
// and never reaches the browser bundle.
//
// Mirror of api/build-recipe.ts — keep the two in sync.

// Recipe quality bar + tool input schema are shared with the chat's
// build_recipe tool (location-chat) so both paths author equally
// calibrated recipes.
import { RECIPE_QUALITY_BAR, RECIPE_INPUT_SCHEMA } from '../_shared/recipe-spec.ts';
import { requireUser } from '../_shared/auth.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ANTHROPIC_API_KEY: string | undefined = Deno.env.get('ANTHROPIC_API_KEY');

// Opus authors noticeably better recipes (measurements, sequencing,
// realistic timing) than Sonnet, and this is a one-shot call rather
// than a high-volume chat, so the cost trade-off is worth it.
const MODEL = 'claude-opus-4-8';
// Headroom so a fully detailed complex recipe (a laminated dough with
// 15–20 richly-written steps, grouped ingredients, equipment, and a
// make-ahead timeline note) isn't truncated. Because the tool is forced,
// a max_tokens cutoff truncates the JSON mid-object and the client's
// JSON.parse fails — so we'd rather pay for the tokens than error out.
// Simple recipes stay cheap (cost scales with tokens actually produced).
const MAX_TOKENS = 12000;
const MAX_PROMPT_CHARS = 2000;

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

const TOOL_BUILD_RECIPE = {
  name: 'build_recipe',
  description: 'Return one complete recipe. Call this exactly once with every relevant field filled.',
  input_schema: RECIPE_INPUT_SCHEMA,
};

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
  if (req.method === 'POST') {
    const auth = await requireUser(req);
    if ('response' in auth) return auth.response;
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'Method not allowed');
  }
  if (!ANTHROPIC_API_KEY) {
    return jsonError(500, 'ANTHROPIC_API_KEY is not configured on the function');
  }

  let body: {
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
  };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  // Three modes:
  //  • create          — { prompt, difficulty?, constraints? }
  //  • refine          — { instruction, current }  (edit an existing draft)
  //  • ingredient edit — { ingredientEdit, current }  (remove/substitute one
  //    ingredient; the model may decline via the decline_change tool)
  const instruction = (body.instruction || '').trim().slice(0, MAX_PROMPT_CHARS);
  const ingredientName = (body.ingredientEdit?.ingredient || '').trim().slice(0, 200);
  const isIngredientEdit = !!ingredientName && !!body.current;
  const isRefine = !isIngredientEdit && !!instruction && !!body.current;

  const readCurrentJson = (): string | null => {
    try {
      return JSON.stringify(body.current).slice(0, 12000);
    } catch {
      return null;
    }
  };

  let messages: Array<{ role: 'user'; content: string }>;
  if (isIngredientEdit) {
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
  } else {
    const prompt = (body.prompt || '').trim().slice(0, MAX_PROMPT_CHARS);
    if (!prompt) {
      return jsonError(400, 'Tell me what recipe you want to create.');
    }
    // Surface the difficulty and every guideline as an explicit hard-
    // requirement checklist (not buried in the prompt prose) so the model
    // reliably designs the recipe around them — the difficulty governs which
    // version of the dish gets written, and time/servings/dietary become
    // verifiable line items the quality bar tells it to re-check.
    const difficulty = ['Easy', 'Medium', 'Hard'].includes(body.difficulty as string)
      ? (body.difficulty as string)
      : '';
    const c = body.constraints || {};
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
    const reqBlock = reqs.length > 0
      ? `\n\nHard requirements — every one is mandatory; re-check the finished recipe against each before returning:\n${reqs.map((r) => `- ${r}`).join('\n')}`
      : '\n\nNo difficulty was specified — write the dish at its natural complexity (simple dishes stay simple; demanding dishes get the full treatment), then set the difficulty field to what the recipe honestly is.';
    messages = [{ role: 'user', content: prompt + reqBlock }];
  }

  const anthropicBody = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // Stream the response. A long Opus recipe can take 30s+ to finish;
    // a non-streaming call would block until then and
    // trip the platform's time-to-first-byte limit (gateway 504).
    // Streaming sends bytes immediately, so we just proxy Anthropic's
    // SSE straight through and let the client assemble the tool input.
    stream: true,
    system: isIngredientEdit
      ? INGREDIENT_EDIT_SYSTEM_PROMPT
      : isRefine ? EDIT_SYSTEM_PROMPT : SYSTEM_PROMPT,
    // The ingredient-edit mode carries the decline escape hatch; the other
    // modes force build_recipe so the only possible output is a recipe.
    tools: isIngredientEdit ? [TOOL_BUILD_RECIPE, TOOL_DECLINE_CHANGE] : [TOOL_BUILD_RECIPE],
    tool_choice: isIngredientEdit
      ? { type: 'any' }
      : { type: 'tool', name: 'build_recipe' },
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
