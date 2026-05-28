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

  if (!res.ok || !res.body) {
    // Errors come back as JSON; the success path is an SSE stream.
    let message = `Something went wrong (HTTP ${res.status}).`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* keep default */ }
    return { ok: false, error: message };
  }

  // Consume the proxied Anthropic SSE. The recipe arrives as a single
  // build_recipe tool_use whose JSON input is delivered across many
  // `input_json_delta` events; accumulate the partial_json fragments
  // and parse once the stream ends. Streaming is what keeps the Edge
  // function under the gateway timeout for long Opus generations.
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
    if ((err as { name?: string })?.name === 'AbortError') {
      return { ok: false, error: 'Cancelled.' };
    }
    return { ok: false, error: 'The connection dropped while writing the recipe. Try again.' };
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }

  if (streamError) {
    return { ok: false, error: streamError };
  }
  if (stopReason === 'max_tokens' && !jsonBuffer) {
    return { ok: false, error: 'The recipe was too long to finish. Try a slightly simpler request.' };
  }

  let recipe: BuildRecipeInput | undefined;
  try {
    recipe = jsonBuffer ? (JSON.parse(jsonBuffer) as BuildRecipeInput) : undefined;
  } catch {
    return {
      ok: false,
      error: stopReason === 'max_tokens'
        ? 'The recipe was too long to finish. Try a slightly simpler request.'
        : "I couldn't generate that recipe. Try rephrasing your request.",
    };
  }

  const meal = recipe ? buildRecipeInputToHomeMeal(recipe) : null;
  if (!meal) {
    return { ok: false, error: "I couldn't generate that recipe. Try rephrasing your request." };
  }
  return { ok: true, meal };
}
