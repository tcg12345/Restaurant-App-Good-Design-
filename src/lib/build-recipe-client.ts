// Client for the /api/build-recipe Edge Function. Sends a single
// free-text prompt (create) or an instruction + current recipe
// (refine) and gets back one fully-formed recipe object, normalized
// into a HomeMeal ready for the Advanced builder / publish.

import type { HomeMeal } from '../contexts/ListsContext';
import { buildRecipeInputToHomeMeal, mergeRecipeEdit, type BuildRecipeInput } from './recipe-from-ai';

const FUNCTION_URL = '/api/build-recipe';

export interface GenerateRecipeResult {
  ok: boolean;
  /** Present when ok — a HomeMeal seeded with the AI's recipe. */
  meal?: HomeMeal;
  /** The raw tool input the AI emitted — useful when the caller needs
   *  to round-trip the recipe back to the model (chat history). */
  recipe?: BuildRecipeInput;
  /** Present when !ok — a user-facing error message. */
  error?: string;
}

/** Consume the proxied Anthropic SSE. The recipe arrives as a single
 *  build_recipe tool_use whose JSON input is delivered across many
 *  `input_json_delta` events; accumulate the partial_json fragments
 *  and parse once the stream ends. Streaming is what keeps the Edge
 *  function under the gateway timeout for long Opus generations.
 *  Returns the parsed BuildRecipeInput, or an error string. */
async function readRecipeStream(
  res: Response,
): Promise<{ recipe?: BuildRecipeInput; error?: string }> {
  if (!res.body) return { error: 'No response body.' };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let jsonBuffer = '';
  let stopReason: string | undefined;
  let streamError: string | undefined;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let blankIdx: number;
      while ((blankIdx = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, blankIdx);
        buffer = buffer.slice(blankIdx + 2);

        let dataPayload = '';
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data:')) {
            dataPayload += (dataPayload ? '\n' : '') + line.slice(5).trimStart();
          }
        }
        if (!dataPayload || dataPayload === '[DONE]') continue;

        let event: { type?: string; delta?: { type?: string; partial_json?: string; stop_reason?: string }; error?: { message?: string } };
        try {
          event = JSON.parse(dataPayload);
        } catch {
          continue;
        }

        if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
          jsonBuffer += event.delta.partial_json ?? '';
        } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
          stopReason = event.delta.stop_reason;
        } else if (event.type === 'error') {
          streamError = event.error?.message || 'Streaming error';
        }
      }
    }
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return { error: 'Cancelled.' };
    return { error: 'The connection dropped while writing the recipe. Try again.' };
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }

  if (streamError) return { error: streamError };
  const truncated = stopReason === 'max_tokens';
  if (truncated && !jsonBuffer) {
    return { error: 'The recipe was too long to finish. Try a slightly simpler request.' };
  }
  try {
    const recipe = jsonBuffer ? (JSON.parse(jsonBuffer) as BuildRecipeInput) : undefined;
    if (!recipe) return { error: "I couldn't generate that recipe. Try rephrasing your request." };
    return { recipe };
  } catch {
    return {
      error: truncated
        ? 'The recipe was too long to finish. Try a slightly simpler request.'
        : "I couldn't generate that recipe. Try rephrasing your request.",
    };
  }
}

/** POST to /api/build-recipe and parse the response (SSE on success,
 *  JSON error otherwise). Shared by create + refine. */
async function postRecipe(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ recipe?: BuildRecipeInput; error?: string }> {
  let res: Response;
  try {
    res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return { error: 'Cancelled.' };
    return { error: 'Network error — check your connection and try again.' };
  }
  if (!res.ok || !res.body) {
    let message = `Something went wrong (HTTP ${res.status}).`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* keep default */ }
    return { error: message };
  }
  return readRecipeStream(res);
}

/**
 * Generate a recipe from a natural-language prompt. Resolves with a
 * HomeMeal on success or a friendly error message on failure. Never
 * throws — the caller can render `error` directly.
 */
export async function generateRecipe(
  prompt: string,
  signal?: AbortSignal,
  difficulty?: 'Easy' | 'Medium' | 'Hard',
): Promise<GenerateRecipeResult> {
  const { recipe, error } = await postRecipe(
    difficulty ? { prompt, difficulty } : { prompt },
    signal,
  );
  if (error) return { ok: false, error };
  const meal = recipe ? buildRecipeInputToHomeMeal(recipe) : null;
  if (!meal) return { ok: false, error: "I couldn't generate that recipe. Try rephrasing your request." };
  return { ok: true, meal, recipe };
}

/** Compact BuildRecipeInput view of a HomeMeal — what we hand the model
 *  as the "current recipe" so it can revise it. */
function homeMealToInput(meal: HomeMeal): BuildRecipeInput {
  return {
    name: meal.name,
    summary: meal.summary || meal.description || undefined,
    introParagraph: meal.introParagraph || undefined,
    cuisine: meal.cuisine || undefined,
    course: meal.course,
    difficulty: meal.difficulty,
    prepTime: meal.prepTime,
    cookTime: meal.cookTime,
    chillTime: meal.chillTime,
    servings: meal.servings,
    yieldDescription: meal.yieldDescription,
    ingredientGroups: meal.ingredientGroups && meal.ingredientGroups.length > 0 ? meal.ingredientGroups : undefined,
    ingredients: (!meal.ingredientGroups || meal.ingredientGroups.length === 0) ? meal.ingredients : undefined,
    steps: meal.stepDetails && meal.stepDetails.length > 0
      ? meal.stepDetails
      : (meal.steps || []).map((body) => ({ body })),
    equipment: meal.equipment,
    tags: meal.tags,
    notes: meal.notes,
  };
}

/**
 * Refine an existing recipe with a free-text instruction ("make it
 * spicier", "swap walnuts for pecans"). The AI returns the full
 * revised recipe; we merge it back onto the current meal so its id,
 * cover photo, and saved photos are preserved. Never throws.
 */
export async function refineRecipe(
  current: HomeMeal,
  instruction: string,
  signal?: AbortSignal,
): Promise<GenerateRecipeResult> {
  const { recipe, error } = await postRecipe(
    { instruction, current: homeMealToInput(current) },
    signal,
  );
  if (error) return { ok: false, error };
  if (!recipe) return { ok: false, error: "I couldn't update that recipe. Try rephrasing." };
  // The model returns the full revised recipe — merge over the current
  // meal so identity-bearing fields (id, coverPhoto, photos) survive.
  const meal = mergeRecipeEdit(current, recipe);
  return { ok: true, meal, recipe };
}
