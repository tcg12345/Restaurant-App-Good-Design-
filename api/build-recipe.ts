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

// Recipe quality bar + tool input schema are shared with the chat's
// build_recipe tool (api/location-chat.ts) so both paths author equally
// thorough recipes.
import { RECIPE_QUALITY_BAR, RECIPE_INPUT_SCHEMA } from './_recipe-spec';

export const config = { runtime: 'edge' };

/* eslint-disable @typescript-eslint/no-explicit-any */

const ANTHROPIC_API_KEY: string | undefined = typeof process !== 'undefined'
  ? process.env?.ANTHROPIC_API_KEY
  : undefined;

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
const MAX_TOKENS = 10000;
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
  '',
  'Quality bar (maintain it):',
  RECIPE_QUALITY_BAR,
].join('\n');

const TOOL_BUILD_RECIPE = {
  name: 'build_recipe',
  description: 'Return one complete recipe. Call this exactly once with every relevant field filled.',
  input_schema: RECIPE_INPUT_SCHEMA,
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

  let body: { prompt?: string; difficulty?: string; instruction?: string; current?: unknown };
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
    // Surface the chosen difficulty as a top-level directive (not buried in
    // the prompt prose) so the model reliably calibrates depth to it. When
    // absent, tell it to give the best/ideal version and self-label.
    const difficulty = ['Easy', 'Medium', 'Hard'].includes(body.difficulty as string)
      ? (body.difficulty as string)
      : '';
    const difficultyLine = difficulty
      ? `\n\nTarget difficulty: ${difficulty}. Follow the DIFFICULTY CALIBRATION for ${difficulty} in the quality bar, and set the difficulty field to "${difficulty}".`
      : '\n\nNo difficulty was specified — do NOT simplify. Produce the best, most authentic version of this dish, scaled to its true complexity, then set the difficulty field to whatever the recipe actually is.';
    messages = [{ role: 'user', content: prompt + difficultyLine }];
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
