// AI Recipe Generator — Vercel Edge Function.
//
// Single-shot, structured recipe authoring for the Add Recipe modal's
// "Create with AI" flow. Unlike /api/location-chat (a streaming, multi-
// turn, multi-tool chat), this endpoint takes one free-text prompt and
// returns one fully-formed recipe object — no streaming, no chat
// history, no follow-up questions. It forces the `build_recipe` tool so
// the model's only possible output is a clean recipe JSON.
//
// Request:  { prompt: string }
// Response: { recipe: BuildRecipeInput }
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
const MODEL = 'claude-opus-4-7';
const MAX_TOKENS = 6000;
const MAX_PROMPT_CHARS = 2000;

const CUISINE_HINT =
  'Afghan, African, American, Argentinian, Australian, Austrian, BBQ, Bakery, Belgian, Brazilian, British, Cajun, Caribbean, Chinese, Cuban, Dessert, Ethiopian, Filipino, French, Fusion, German, Greek, Hawaiian, Indian, Indonesian, Irish, Israeli, Italian, Jamaican, Japanese, Korean, Latin American, Lebanese, Malaysian, Mediterranean, Mexican, Middle Eastern, Moroccan, Nordic, Pakistani, Peruvian, Polish, Portuguese, Russian, Scandinavian, Seafood, Soul Food, Southern, Spanish, Sri Lankan, Swedish, Tex-Mex, Thai, Turkish, Ukrainian, Vegan, Vegetarian, Vietnamese';

const COURSE_HINT = 'Breakfast, Lunch, Dinner, Snack, Dessert, Drinks, Appetizer, Side';

const SYSTEM_PROMPT = [
  'You are a meticulous recipe developer. Given a short description, you author ONE complete, REAL, testable recipe and return it by calling the `build_recipe` tool. You do not chat, ask questions, or add commentary — you always call the tool exactly once.',
  '',
  'Quality bar:',
  '- Real, accurate measurements with units. Use mass (g) for baking when precision matters.',
  '- Sensible step ordering; one clear action per step. Add a short `title` to each step.',
  '- Realistic prep/cook/chill timing in minutes.',
  '- Group ingredients by stage with `ingredientGroups` ONLY when the recipe truly has distinct stages ("For the batter", "For the glaze"); otherwise use the flat `ingredients` list.',
  '- Include `equipment` the cook needs and 1–3 genuinely useful `notes` (a chef tip, a substitution, or a make-ahead).',
  `- Set a sensible \`cuisine\` (examples: ${CUISINE_HINT}) and \`course\` (one or more of: ${COURSE_HINT}).`,
  '- Honor every constraint in the user\'s prompt (servings, dietary restrictions, time budget, equipment, flavor direction). If the prompt is vague, make reasonable, appealing choices rather than asking.',
].join('\n');

const TOOL_BUILD_RECIPE = {
  name: 'build_recipe',
  description: 'Return one complete recipe. Call this exactly once with every relevant field filled.',
  input_schema: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', description: 'Recipe title.' },
      summary: { type: 'string', description: 'One-line description shown under the title.' },
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

  let body: { prompt?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }
  const prompt = (body.prompt || '').trim().slice(0, MAX_PROMPT_CHARS);
  if (!prompt) {
    return jsonError(400, 'Tell me what recipe you want to create.');
  }

  const anthropicBody = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [TOOL_BUILD_RECIPE],
    // Force the tool so the only possible output is a recipe object.
    tool_choice: { type: 'tool', name: 'build_recipe' },
    messages: [{ role: 'user', content: prompt }],
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

  if (!anthropicRes.ok) {
    let errText = `Upstream HTTP ${anthropicRes.status}`;
    try {
      const j: any = await anthropicRes.json();
      errText = j?.error?.message || j?.error || errText;
    } catch { /* ignore */ }
    return jsonError(502, errText);
  }

  let payload: any;
  try {
    payload = await anthropicRes.json();
  } catch {
    return jsonError(502, 'Could not parse the recipe response.');
  }

  // Pull the build_recipe tool_use block out of the content array.
  const blocks: any[] = Array.isArray(payload?.content) ? payload.content : [];
  const toolUse = blocks.find((b) => b?.type === 'tool_use' && b?.name === 'build_recipe');
  const recipe = toolUse?.input;

  if (!recipe || typeof recipe !== 'object' || !(recipe.name || '').toString().trim()) {
    // Most common cause is max_tokens truncation on a very large recipe.
    const truncated = payload?.stop_reason === 'max_tokens';
    return jsonError(
      502,
      truncated
        ? 'The recipe was too long to finish. Try a slightly simpler request.'
        : "I couldn't generate that recipe. Try rephrasing your request.",
    );
  }

  return new Response(JSON.stringify({ recipe }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
