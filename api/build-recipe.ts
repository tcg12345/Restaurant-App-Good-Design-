// AI Recipe Generator — Vercel Edge Function.
//
// Single-shot, structured recipe authoring for the Add Recipe modal's
// "Create with AI" flow. Takes one free-text prompt and forces the
// `build_recipe` tool so the model's only possible output is a clean
// recipe JSON. The Anthropic response is STREAMED (SSE proxied
// byte-for-byte to the client) — a full Opus recipe can take 30s+, and
// a non-streaming call would block past the gateway's time-to-first-
// byte limit and 504. The client assembles the tool input from the
// streamed input_json_delta events.
//
// Request:  { prompt: string }
// Response: Anthropic SSE stream (success) or { error } JSON (failure)
//
// The Anthropic API key lives here as a Vercel environment variable
// (`ANTHROPIC_API_KEY`) and never reaches the browser bundle.

export const config = { runtime: 'edge' };

/* eslint-disable @typescript-eslint/no-explicit-any */

const ANTHROPIC_API_KEY: string | undefined = typeof process !== 'undefined'
  ? process.env?.ANTHROPIC_API_KEY
  : undefined;

// Opus authors noticeably better recipes (measurements, sequencing,
// realistic timing) than Sonnet, and this is a one-shot call rather
// than a high-volume chat, so the cost trade-off is worth it.
const MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 6000;
const MAX_PROMPT_CHARS = 2000;

const CUISINE_HINT =
  'Afghan, African, American, Argentinian, Australian, Austrian, BBQ, Bakery, Belgian, Brazilian, British, Cajun, Caribbean, Chinese, Cuban, Dessert, Ethiopian, Filipino, French, Fusion, German, Greek, Hawaiian, Indian, Indonesian, Irish, Israeli, Italian, Jamaican, Japanese, Korean, Latin American, Lebanese, Malaysian, Mediterranean, Mexican, Middle Eastern, Moroccan, Nordic, Pakistani, Peruvian, Polish, Portuguese, Russian, Scandinavian, Seafood, Soul Food, Southern, Spanish, Sri Lankan, Swedish, Tex-Mex, Thai, Turkish, Ukrainian, Vegan, Vegetarian, Vietnamese';

const COURSE_HINT = 'Breakfast, Lunch, Dinner, Snack, Dessert, Drinks, Appetizer, Side';

const QUALITY_BAR = [
  '- Real, accurate measurements with units. Use mass (g) for baking when precision matters.',
  '- Sensible step ordering; one clear action per step. Add a short `title` to each step.',
  '- Realistic prep/cook/chill timing in minutes.',
  '- Group ingredients by stage with `ingredientGroups` ONLY when the recipe truly has distinct stages ("For the batter", "For the glaze"); otherwise use the flat `ingredients` list.',
  '- Include `equipment` the cook needs and 1–3 genuinely useful `notes` (a chef tip, a substitution, or a make-ahead).',
  '- Write BOTH a `summary` (one punchy line, the byline under the title) AND a longer `introParagraph` (2–4 sentences of prose for the top of the recipe page). They MUST be different: the intro describes what the dish actually is — its flavor and texture, where it comes from or when to serve it, and why it is worth cooking. Do NOT just restate the summary.',
  `- Set a sensible \`cuisine\` (examples: ${CUISINE_HINT}) and \`course\` (one or more of: ${COURSE_HINT}).`,
].join('\n');

const SYSTEM_PROMPT = [
  'You are a meticulous recipe developer. Given a short description, you author ONE complete, REAL, testable recipe and return it by calling the `build_recipe` tool. You do not chat, ask questions, or add commentary — you always call the tool exactly once.',
  '',
  'Quality bar:',
  QUALITY_BAR,
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
  '',
  'Quality bar (maintain it):',
  QUALITY_BAR,
].join('\n');

const TOOL_BUILD_RECIPE = {
  name: 'build_recipe',
  description: 'Return one complete recipe. Call this exactly once with every relevant field filled.',
  input_schema: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', description: 'Recipe title.' },
      summary: { type: 'string', description: 'One punchy line shown as the byline under the title.' },
      introParagraph: { type: 'string', description: 'A longer intro (2–4 sentences) shown at the top of the recipe page body. Describe what the dish is — its flavor/texture, origin or occasion, and why it is worth making. Must be distinct prose, NOT a repeat of `summary`.' },
      cuisine: { type: 'string' },
      course: { type: 'array', items: { type: 'string' }, description: 'E.g. ["Dessert"] or ["Lunch", "Dinner"].' },
      difficulty: { type: 'string', enum: ['Easy', 'Medium', 'Hard'] },
      prepTime: { type: 'integer', minimum: 0, description: 'Minutes of hands-on prep.' },
      cookTime: { type: 'integer', minimum: 0, description: 'Minutes of cook / bake / sear time.' },
      chillTime: { type: 'integer', minimum: 0, description: 'Optional rest / chill / proof minutes.' },
      servings: { type: 'integer', minimum: 1 },
      yieldDescription: { type: 'string', description: 'Free-text yield label, e.g. "1 loaf (12 slices)".' },
      ingredients: {
        type: 'array',
        description: 'Flat list of ingredients for single-stage recipes.',
        items: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            amount: { type: 'string', description: 'Number or fraction as a string. Blank when "to taste".' },
            unit: { type: 'string', description: 'g, ml, tsp, tbsp, cup, oz, etc.' },
          },
        },
      },
      ingredientGroups: {
        type: 'array',
        description: 'Grouped ingredients for multi-stage recipes. Use either this OR ingredients.',
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
        description: 'Ordered cooking steps.',
        items: {
          type: 'object',
          required: ['body'],
          properties: {
            title: { type: 'string', description: 'Short imperative, e.g. "Brown the butter".' },
            body: { type: 'string', description: 'One action per step, named clearly.' },
            durationMin: { type: 'integer', minimum: 0 },
            tip: { type: 'string', description: 'Optional inline tip for this step.' },
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
  },
};

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
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

  let body: { prompt?: string; instruction?: string; current?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  // Two modes:
  //  • create — { prompt }
  //  • refine — { instruction, current }  (edit an existing draft)
  const instruction = (body.instruction || '').trim().slice(0, MAX_PROMPT_CHARS);
  const isRefine = !!instruction && !!body.current;

  let messages: Array<{ role: 'user'; content: string }>;
  if (isRefine) {
    let currentJson = '';
    try {
      currentJson = JSON.stringify(body.current).slice(0, 12000);
    } catch {
      return jsonError(400, 'Could not read the current recipe.');
    }
    messages = [{
      role: 'user',
      content: `Here is the current recipe as JSON:\n\n${currentJson}\n\nApply this change and return the COMPLETE revised recipe (all fields): ${instruction}`,
    }];
  } else {
    const prompt = (body.prompt || '').trim().slice(0, MAX_PROMPT_CHARS);
    if (!prompt) {
      return jsonError(400, 'Tell me what recipe you want to create.');
    }
    messages = [{ role: 'user', content: prompt }];
  }

  const anthropicBody = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // Stream the response. A full ~6000-token Opus recipe can take
    // 30s+ to finish; a non-streaming call would block until then and
    // trip the platform's time-to-first-byte limit (gateway 504).
    // Streaming sends bytes immediately, so we just proxy Anthropic's
    // SSE straight through and let the client assemble the tool input.
    stream: true,
    system: isRefine ? EDIT_SYSTEM_PROMPT : SYSTEM_PROMPT,
    tools: [TOOL_BUILD_RECIPE],
    // Force the tool so the only possible output is a recipe object.
    tool_choice: { type: 'tool', name: 'build_recipe' },
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
  // the build_recipe tool_use input from the input_json_delta events.
  return new Response(anthropicRes.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
