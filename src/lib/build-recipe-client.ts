// Client for the /api/build-recipe Edge Function. Sends a single
// free-text prompt and gets back one fully-formed recipe object,
// normalized into a HomeMeal ready for the Advanced builder / publish.

import type { HomeMeal } from '../contexts/ListsContext';
import { buildRecipeInputToHomeMeal, type BuildRecipeInput } from './recipe-from-ai';

const FUNCTION_URL = '/api/build-recipe';

export interface GenerateRecipeResult {
  ok: boolean;
  /** Present when ok — a HomeMeal seeded with the AI's recipe. */
  meal?: HomeMeal;
  /** Present when !ok — a user-facing error message. */
  error?: string;
}

/**
 * Generate a recipe from a natural-language prompt. Resolves with a
 * HomeMeal on success or a friendly error message on failure. Never
 * throws — the caller can render `error` directly.
 */
export async function generateRecipe(
  prompt: string,
  signal?: AbortSignal,
): Promise<GenerateRecipeResult> {
  let res: Response;
  try {
    res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      return { ok: false, error: 'Cancelled.' };
    }
    return { ok: false, error: 'Network error — check your connection and try again.' };
  }

  if (!res.ok) {
    let message = `Something went wrong (HTTP ${res.status}).`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* keep default */ }
    return { ok: false, error: message };
  }

  let recipe: BuildRecipeInput | undefined;
  try {
    const body = await res.json();
    recipe = body?.recipe;
  } catch {
    return { ok: false, error: "Couldn't read the recipe response. Try again." };
  }

  const meal = recipe ? buildRecipeInputToHomeMeal(recipe) : null;
  if (!meal) {
    return { ok: false, error: "I couldn't generate that recipe. Try rephrasing your request." };
  }
  return { ok: true, meal };
}
