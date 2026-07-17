// Client for the build-recipe Supabase Edge Function. Sends a single
// free-text prompt (create), an instruction + current recipe (refine),
// or a single-ingredient remove/substitute request (which the AI may
// decline) and gets back one fully-formed recipe object, normalized
// into a HomeMeal ready for the Advanced builder / publish.

import type { HomeMeal } from '../contexts/ListsContext';
import { buildRecipeInputToHomeMeal, mergeRecipeEdit, type BuildRecipeInput } from './recipe-from-ai';
import { apiUrl, apiHeaders } from './api-base';

const FUNCTION_URL = apiUrl('build-recipe');

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

/** Optional structured guidelines for `generateRecipe`. Sent as explicit
 *  hard requirements (not prose) so the model designs around them. */
export interface RecipeConstraints {
  /** Max total minutes — prep + cook + ALL passive time. */
  totalTimeMax?: number;
  servings?: number;
  course?: string;
  dietary?: string[];
}

export interface GenerateRecipeOptions {
  difficulty?: 'Easy' | 'Medium' | 'Hard';
  constraints?: RecipeConstraints;
}

/** A single-ingredient edit the user requested from the draft preview. */
export interface IngredientEdit {
  action: 'remove' | 'substitute';
  /** The ingredient (as displayed) to remove or replace. */
  ingredient: string;
  /** Optional replacement for `substitute`; blank lets the AI choose. */
  replacement?: string;
}

export interface IngredientEditResult extends GenerateRecipeResult {
  /** True when the AI judged the change would compromise the dish and
   *  left the recipe untouched. `declineReason` says why (user-facing). */
  declined?: boolean;
  declineReason?: string;
}

/** Consume the proxied Anthropic SSE. The response is a single tool_use
 *  whose JSON input is delivered across many `input_json_delta` events;
 *  accumulate the partial_json fragments per tool block and parse once
 *  the stream ends. Streaming is what keeps the Edge function under the
 *  gateway timeout for long Opus generations.
 *
 *  Two tools can arrive: `build_recipe` (a recipe object) or — in the
 *  ingredient-edit mode only — `decline_change` ({ reason }) when the
 *  model judged the change would wreck the dish.
 *
 *  Exported for tests. */
export async function readRecipeStream(
  res: Response,
): Promise<{ recipe?: BuildRecipeInput; declineReason?: string; error?: string }> {
  if (!res.body) return { error: 'No response body.' };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // JSON accumulated per tool name. Anthropic streams one content block
  // at a time: content_block_start names the tool, then input_json_delta
  // events carry its input. Track which block is open so each fragment
  // lands in the right buffer.
  const toolJson: Record<string, string> = {};
  let openTool = '';
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

        let event: {
          type?: string;
          content_block?: { type?: string; name?: string };
          delta?: { type?: string; partial_json?: string; stop_reason?: string };
          error?: { message?: string };
        };
        try {
          event = JSON.parse(dataPayload);
        } catch {
          continue;
        }

        if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          openTool = event.content_block.name || 'build_recipe';
          if (!(openTool in toolJson)) toolJson[openTool] = '';
        } else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
          const name = openTool || 'build_recipe';
          toolJson[name] = (toolJson[name] ?? '') + (event.delta.partial_json ?? '');
        } else if (event.type === 'content_block_stop') {
          openTool = '';
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

  // The model declined the change — surface its reason verbatim.
  if (toolJson['decline_change']) {
    try {
      const parsed = JSON.parse(toolJson['decline_change']) as { reason?: string };
      return { declineReason: (parsed.reason || '').trim() || "That change would compromise the recipe, so I left it as is." };
    } catch {
      return { declineReason: "That change would compromise the recipe, so I left it as is." };
    }
  }

  const recipeJson = toolJson['build_recipe'] ?? '';
  const truncated = stopReason === 'max_tokens';
  if (truncated && !recipeJson) {
    return { error: 'The recipe was too long to finish. Try a slightly simpler request.' };
  }
  try {
    const recipe = recipeJson ? (JSON.parse(recipeJson) as BuildRecipeInput) : undefined;
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

/** POST to the build-recipe function and parse the response (SSE on success,
 *  JSON error otherwise). Shared by create + refine + ingredient edit. */
async function postRecipe(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ recipe?: BuildRecipeInput; declineReason?: string; error?: string }> {
  let res: Response;
  try {
    res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: await apiHeaders(),
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
 * Generate a recipe from a natural-language prompt plus optional
 * structured guidelines (difficulty / time / servings / course /
 * dietary). Resolves with a HomeMeal on success or a friendly error
 * message on failure. Never throws — the caller can render `error`
 * directly.
 */
export async function generateRecipe(
  prompt: string,
  signal?: AbortSignal,
  options?: GenerateRecipeOptions,
): Promise<GenerateRecipeResult> {
  const payload: Record<string, unknown> = { prompt };
  if (options?.difficulty) payload.difficulty = options.difficulty;
  if (options?.constraints && Object.keys(options.constraints).length > 0) {
    payload.constraints = options.constraints;
  }
  const { recipe, error } = await postRecipe(payload, signal);
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
    // Hand the model grouped sections when the recipe has them so an AI
    // refine preserves (and can extend) the section structure; otherwise
    // send the flat step list.
    stepGroups: meal.stepGroups && meal.stepGroups.length > 0 ? meal.stepGroups : undefined,
    steps: (!meal.stepGroups || meal.stepGroups.length === 0)
      ? (meal.stepDetails && meal.stepDetails.length > 0
          ? meal.stepDetails
          : (meal.steps || []).map((body) => ({ body })))
      : undefined,
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

/**
 * Remove or substitute ONE ingredient in an existing draft. Unlike
 * `refineRecipe`, the AI is allowed to refuse: when the change would
 * compromise the dish's authenticity or quality it declines, the recipe
 * is left untouched, and `declined` + `declineReason` explain why.
 * Never throws.
 */
export async function editRecipeIngredient(
  current: HomeMeal,
  edit: IngredientEdit,
  signal?: AbortSignal,
): Promise<IngredientEditResult> {
  const { recipe, declineReason, error } = await postRecipe(
    {
      ingredientEdit: {
        action: edit.action,
        ingredient: edit.ingredient,
        replacement: edit.replacement || undefined,
      },
      current: homeMealToInput(current),
    },
    signal,
  );
  if (error) return { ok: false, error };
  if (declineReason) return { ok: false, declined: true, declineReason };
  if (!recipe) return { ok: false, error: "I couldn't update that recipe. Try again." };
  const meal = mergeRecipeEdit(current, recipe);
  return { ok: true, meal, recipe };
}
