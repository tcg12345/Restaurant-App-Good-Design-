// Client for the /api/generate-recipe-image Edge Function. Sends a compact
// view of a recipe and gets back a single AI-generated hero photo of the
// finished dish, normalized into a JPEG data-URL ready to drop into the
// cover-photo plumbing (onCoverPhotoChange) — exactly like an upload.

import type { HomeMeal } from '../contexts/ListsContext';
import { apiUrl } from './api-base';

const FUNCTION_URL = apiUrl('/api/generate-recipe-image');

export interface GenerateImageResult {
  ok: boolean;
  /** Present when ok — a JPEG data-URL for the generated cover photo. */
  dataUrl?: string;
  /** Present when !ok — a user-facing error message. */
  error?: string;
}

/** Compact recipe view handed to the image function — just enough for it to
 *  picture the finished dish. Ingredient names are flattened from whichever
 *  representation the meal carries (grouped or flat). */
function recipeImagePayload(meal: HomeMeal) {
  const groups = meal.ingredientGroups && meal.ingredientGroups.length > 0
    ? meal.ingredientGroups
    : undefined;
  const ingredientNames = (groups
    ? groups.flatMap((g) => g.ingredients)
    : (meal.ingredients || [])
  )
    .map((i) => (i?.name || '').trim())
    .filter(Boolean);

  return {
    name: meal.name,
    summary: meal.summary || meal.description || undefined,
    cuisine: meal.cuisine || undefined,
    course: meal.course,
    difficulty: meal.difficulty,
    ingredients: ingredientNames,
    yieldDescription: meal.yieldDescription,
  };
}

/** Consume the heartbeat SSE from the image function. The image arrives as a
 *  single terminal `data: {b64_json}` (or `data: {error}`) event after a
 *  series of `: keep-alive` comments; ignore the comments and resolve on the
 *  first data event. Returns the base64 image or an error string. */
async function readImageStream(
  res: Response,
): Promise<{ b64_json?: string; error?: string }> {
  if (!res.body) return { error: 'No response body.' };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: { b64_json?: string; error?: string } | undefined;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let blankIdx: number;
      while ((blankIdx = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, blankIdx);
        buffer = buffer.slice(blankIdx + 2);

        // Skip SSE comment lines (heartbeats) — they start with ':'.
        let dataPayload = '';
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data:')) {
            dataPayload += (dataPayload ? '\n' : '') + line.slice(5).trimStart();
          }
        }
        if (!dataPayload || dataPayload === '[DONE]') continue;

        try {
          const event = JSON.parse(dataPayload) as { b64_json?: string; error?: string };
          result = event;
        } catch {
          continue;
        }
        if (result) break;
      }
      if (result) break;
    }
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return { error: 'Cancelled.' };
    return { error: 'The connection dropped while generating the photo. Try again.' };
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }

  if (!result) return { error: "I couldn't generate that photo. Try again." };
  return result;
}

/**
 * Generate a hero photo of the finished dish for a recipe. Resolves with a
 * JPEG data-URL on success or a friendly error message on failure. Never
 * throws — the caller can render `error` directly.
 */
export async function generateRecipeImage(
  meal: HomeMeal,
  signal?: AbortSignal,
): Promise<GenerateImageResult> {
  let res: Response;
  try {
    res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipe: recipeImagePayload(meal) }),
      signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return { ok: false, error: 'Cancelled.' };
    return { ok: false, error: 'Network error — check your connection and try again.' };
  }
  if (!res.ok || !res.body) {
    let message = `Something went wrong (HTTP ${res.status}).`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* keep default */ }
    return { ok: false, error: message };
  }

  const { b64_json, error } = await readImageStream(res);
  if (error) return { ok: false, error };
  if (!b64_json) return { ok: false, error: "I couldn't generate that photo. Try again." };
  return { ok: true, dataUrl: `data:image/jpeg;base64,${b64_json}` };
}
