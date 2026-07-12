// Client for the /api/import-recipe Edge Function — the "Import" tab of
// the Add Recipe modal. Sends a recipe source (a web link, pasted text,
// or photos) and gets back one structured recipe, normalized into a
// HomeMeal ready for the Advanced builder's Review step.
//
// The function streams the same Anthropic SSE envelope as build-recipe,
// so the stream reader is shared. When the source contains no recipe the
// model declines (decline_change) — surfaced here as a friendly error.

import type { HomeMeal, RecipeNote } from '../contexts/ListsContext';
import { buildRecipeInputToHomeMeal } from './recipe-from-ai';
import { readRecipeStream } from './build-recipe-client';
import { apiUrl, apiHeaders } from './api-base';

const FUNCTION_URL = apiUrl('import-recipe');

export type ImportSource =
  | { url: string }
  | { text: string }
  | { images: string[] };

export interface ImportRecipeResult {
  ok: boolean;
  /** Present when ok — a HomeMeal seeded with the imported recipe. */
  meal?: HomeMeal;
  /** Present when !ok — a user-facing message. */
  error?: string;
}

/** Human label for the source, stored as a note on the imported meal so
 *  provenance survives publishing. */
function sourceNote(source: ImportSource): RecipeNote | null {
  if ('url' in source) {
    try {
      const host = new URL(source.url).hostname.replace(/^www\./, '');
      return { type: 'general', text: `Imported from ${host} — ${source.url}` };
    } catch {
      return { type: 'general', text: `Imported from ${source.url}` };
    }
  }
  if ('images' in source) return { type: 'general', text: 'Imported from a photo.' };
  return null;
}

/**
 * Import a recipe from a link, pasted text, or photos. Resolves with a
 * HomeMeal on success or a friendly error message on failure (including
 * "that page has no recipe on it"-style declines). Never throws.
 */
export async function importRecipe(
  source: ImportSource,
  signal?: AbortSignal,
): Promise<ImportRecipeResult> {
  let res: Response;
  try {
    res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: await apiHeaders(),
      body: JSON.stringify(source),
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

  const { recipe, declineReason, error } = await readRecipeStream(res);
  if (error) return { ok: false, error };
  if (declineReason) return { ok: false, error: declineReason };
  const meal = recipe ? buildRecipeInputToHomeMeal(recipe) : null;
  if (!meal) return { ok: false, error: "Couldn't read a recipe from that. Try a different source." };

  // Record where it came from without touching the transcription itself.
  const note = sourceNote(source);
  if (note) meal.notes = [...(meal.notes || []), note];
  return { ok: true, meal };
}

/** Compress a photo for upload: downscale to max 1600px and re-encode as
 *  JPEG. Text needs to stay legible for the vision model, so this is a
 *  gentler squeeze than the app's usual cover-photo compression. */
export function compressImportPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = document.createElement('img');
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 1600;
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) { height = (height / width) * maxSize; width = maxSize; }
          else { width = (width / height) * maxSize; height = maxSize; }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
