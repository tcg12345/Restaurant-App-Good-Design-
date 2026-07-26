// Client for the import-restaurants Supabase Edge Function — the Import
// page's screenshot path. Sends screenshots of a restaurant list the user
// keeps elsewhere (Beli, Google Maps saved lists, notes, spreadsheets)
// and gets back structured rows ready for the page's Google Places
// resolution pipeline.
//
// The function streams the Anthropic SSE envelope (same proxy shape as
// import-recipe); the reader below accumulates the tool-call JSON per
// block. When the screenshots contain no restaurant list the model
// declines (decline_change) — surfaced here as a friendly error.

import { apiUrl, apiHeaders } from './api-base';

const FUNCTION_URL = apiUrl('import-restaurants');

export interface ExtractedRestaurant {
  name: string;
  city?: string;
  cuisine?: string;
  /** The user's own 0–10 score as shown in the screenshot. */
  score?: number;
  /** True when the entry came from a want-to-try / saved list. */
  wishlist?: boolean;
  notes?: string;
}

export interface ImportRestaurantsResult {
  ok: boolean;
  /** Present when ok — the transcribed list entries, in screenshot order. */
  restaurants?: ExtractedRestaurant[];
  /** Present when !ok — a user-facing message. */
  error?: string;
  /** !ok because of a transient failure (network drop, 5xx) — worth one
   *  automatic retry. Declines and empty reads are final, not retryable. */
  retryable?: boolean;
}

/* ── Screenshot preparation ────────────────────────────────────────────
   The vision API downscales anything over ~1.15 megapixels, and a whole
   phone screenshot squeezed under that ceiling leaves list rows (and the
   small decimal score circles especially) only a dozen pixels tall —
   which is how digits get misread and rows get skipped. So instead of
   sending one shrunken image per screenshot, slice each tall screenshot
   into overlapping tiles that each sit UNDER the downscale threshold:
   every row reaches the model at full legibility. The overlap plus the
   extractor's dedupe (below + server prompt) keeps boundary rows from
   importing twice. */

const TILE_TARGET_WIDTH = 1000;  // px — plenty for Beli's row text
const TILE_HEIGHT = 1100;        // 1000×1100 ≈ 1.1MP — under the API's resize cap
const TILE_OVERLAP = 140;        // a row cut at a tile edge is whole in the neighbor
const MAX_TILES_PER_SHOT = 4;

/**
 * Load a screenshot (or an extracted recording frame) and return 1–4 JPEG
 * data-URL tiles covering it top to bottom. Short images come back as a
 * single tile.
 */
export function prepareScreenshotTiles(file: Blob): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = document.createElement('img');
      img.onload = () => {
        const scale = Math.min(1, TILE_TARGET_WIDTH / img.width);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const full = document.createElement('canvas');
        full.width = w;
        full.height = h;
        const fctx = full.getContext('2d');
        if (!fctx) { reject(new Error('Canvas unavailable')); return; }
        fctx.drawImage(img, 0, 0, w, h);

        const sliceAt = (top: number, height: number): string => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = height;
          c.getContext('2d')?.drawImage(full, 0, top, w, height, 0, 0, w, height);
          return c.toDataURL('image/jpeg', 0.85);
        };

        if (h <= TILE_HEIGHT + TILE_OVERLAP) {
          resolve([sliceAt(0, h)]);
          return;
        }
        // Evenly-spaced tiles covering the full height. For any normal
        // phone screenshot the step keeps ≥ TILE_OVERLAP of overlap; only
        // a pathologically tall capture (> ~4 screens stitched) would
        // spread thinner.
        const count = Math.min(
          MAX_TILES_PER_SHOT,
          Math.max(2, Math.ceil((h - TILE_OVERLAP) / (TILE_HEIGHT - TILE_OVERLAP))),
        );
        const step = (h - TILE_HEIGHT) / (count - 1);
        const tiles: string[] = [];
        for (let i = 0; i < count; i++) {
          tiles.push(sliceAt(Math.round(i * step), TILE_HEIGHT));
        }
        resolve(tiles);
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/** Normalized identity for a row — dedupe key across screenshots. */
const rowKey = (name: string, city?: string) =>
  `${name.toLowerCase().replace(/\s+/g, ' ').trim()}::${(city || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;

/**
 * Collapse duplicate entries — scrolling a list and screenshotting it
 * produces overlapping captures, so the same restaurant routinely appears
 * in two images (the model is told to dedupe, but this is the guarantee).
 * Two passes: exact name+city, then name-only where one copy is missing
 * its city (same list, so a bare "Nobu" and "Nobu · New York" are the same
 * row). Merged copies keep the most information; a rated copy beats a
 * wishlist one.
 */
export function dedupeExtracted(rows: ExtractedRestaurant[]): ExtractedRestaurant[] {
  const merge = (a: ExtractedRestaurant, b: ExtractedRestaurant): ExtractedRestaurant => ({
    name: a.name,
    city: a.city || b.city,
    cuisine: a.cuisine || b.cuisine,
    score: a.score ?? b.score,
    // A score means it came from a rated list — never demote it to wishlist.
    wishlist: (a.score ?? b.score) !== undefined ? false : (a.wishlist || b.wishlist),
    notes: a.notes || b.notes,
  });

  // Pass 1 — exact name + city.
  const byExact = new Map<string, ExtractedRestaurant>();
  for (const r of rows) {
    const key = rowKey(r.name, r.city);
    const prev = byExact.get(key);
    byExact.set(key, prev ? merge(prev, r) : r);
  }

  // Pass 2 — name-only, but ONLY when one of the copies has no city (two
  // real restaurants with the same name in different cities must survive).
  const out: ExtractedRestaurant[] = [];
  const byName = new Map<string, number[]>(); // name key → indexes into out
  for (const r of byExact.values()) {
    const nameKey = rowKey(r.name);
    const candidates = byName.get(nameKey) ?? [];
    const mergeIdx = candidates.find((i) => !out[i].city || !r.city);
    if (mergeIdx !== undefined) {
      out[mergeIdx] = merge(out[mergeIdx], r);
      continue;
    }
    byName.set(nameKey, [...candidates, out.length]);
    out.push(r);
  }
  return out;
}

/**
 * Extract restaurant-list entries from screenshots. Resolves with the
 * transcribed rows on success or a friendly error message on failure
 * (including "these screenshots aren't a restaurant list" declines).
 * Never throws.
 */
export async function extractRestaurantsFromScreenshots(
  images: string[],
  signal?: AbortSignal,
): Promise<ImportRestaurantsResult> {
  let res: Response;
  try {
    res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: await apiHeaders(),
      body: JSON.stringify({ images }),
      signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return { ok: false, error: 'Cancelled.' };
    return { ok: false, error: 'Network error — check your connection and try again.', retryable: true };
  }
  if (!res.ok || !res.body) {
    let message = `Something went wrong (HTTP ${res.status}).`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* keep default */ }
    // 5xx is transient; 4xx (auth, rate limit, bad request) won't improve
    // on an immediate retry.
    return { ok: false, error: message, retryable: res.status >= 500 };
  }

  // ── SSE tool-call accumulator (mirrors readRecipeStream) ──
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const toolJson: Record<string, string> = {};      // last complete block per tool
  const toolJsonOpen: Record<string, string> = {};  // in-progress block buffers
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
          openTool = event.content_block.name || 'extract_restaurants';
          toolJsonOpen[openTool] = '';
        } else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
          const name = openTool || 'extract_restaurants';
          toolJsonOpen[name] = (toolJsonOpen[name] ?? '') + (event.delta.partial_json ?? '');
        } else if (event.type === 'content_block_stop') {
          if (openTool) toolJson[openTool] = toolJsonOpen[openTool] ?? '';
          openTool = '';
        } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
          stopReason = event.delta.stop_reason;
        } else if (event.type === 'error') {
          streamError = event.error?.message || 'Streaming error';
        }
      }
    }
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return { ok: false, error: 'Cancelled.' };
    return { ok: false, error: 'The connection dropped while reading your screenshots. Try again.', retryable: true };
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }

  if (streamError) return { ok: false, error: streamError, retryable: true };

  const declineJson = toolJson['decline_change'] || toolJsonOpen['decline_change'];
  if (declineJson) {
    try {
      const parsed = JSON.parse(declineJson) as { reason?: string };
      return { ok: false, error: (parsed.reason || '').trim() || "Couldn't find a restaurant list in those screenshots." };
    } catch {
      return { ok: false, error: "Couldn't find a restaurant list in those screenshots." };
    }
  }

  const listJson = toolJson['extract_restaurants'] || toolJsonOpen['extract_restaurants'] || '';
  const truncated = stopReason === 'max_tokens';
  try {
    const parsed = listJson ? (JSON.parse(listJson) as { restaurants?: unknown }) : undefined;
    const rows = Array.isArray(parsed?.restaurants) ? (parsed!.restaurants as ExtractedRestaurant[]) : [];
    const cleaned = dedupeExtracted(rows
      .filter((r) => r && typeof r.name === 'string' && r.name.trim().length > 0)
      .map((r) => ({
        name: r.name.trim(),
        city: typeof r.city === 'string' ? r.city.trim() : undefined,
        cuisine: typeof r.cuisine === 'string' ? r.cuisine.trim() : undefined,
        score: typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : undefined,
        wishlist: r.wishlist === true,
        notes: typeof r.notes === 'string' ? r.notes.trim() : undefined,
      })));
    if (cleaned.length === 0) {
      return { ok: false, error: "Couldn't read any restaurants from those screenshots. Try clearer, closer screenshots of the list." };
    }
    return { ok: true, restaurants: cleaned };
  } catch {
    return {
      ok: false,
      error: truncated
        ? 'That list was too long to read in one go — try importing it a few screenshots at a time.'
        : "Couldn't read those screenshots. Try again with clearer images.",
    };
  }
}

/* ── Multi-call batching (screen recordings) ───────────────────────────
   A screen recording of a long list extracts to more frames than one
   function call may carry (the server reads at most MAX_IMAGES_PER_CALL
   images), so the tile stream is chunked into several sequential calls
   and the transcriptions merged. Chunk boundaries always fall BETWEEN
   captures — a capture's overlapping tiles stay together, so a row cut
   at one tile's edge is always whole in a neighbor within the same call. */

/** Matches the edge function's MAX_IMAGES. */
export const MAX_IMAGES_PER_CALL = 24;

/**
 * Pack per-capture tile groups into batches of at most `cap` images
 * without splitting a group. A single group larger than the cap (never
 * produced by the tiler) is clamped to fit.
 */
export function chunkTileGroups(groups: string[][], cap = MAX_IMAGES_PER_CALL): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  for (const group of groups) {
    const tiles = group.slice(0, cap);
    if (tiles.length === 0) continue;
    if (current.length > 0 && current.length + tiles.length > cap) {
      batches.push(current);
      current = [];
    }
    current = current.concat(tiles);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Extract restaurants from any number of captures (screenshots and/or
 * recording frames), spreading the read across as many function calls as
 * the tile count needs. Transient batch failures get one retry; a batch
 * that declines (e.g. trailing recording frames past the end of the list)
 * simply contributes nothing. Fails only when NO batch produced rows.
 */
export async function extractRestaurantsFromCaptures(
  tileGroups: string[][],
  opts: {
    /** Called before each batch is sent — drive "Reading part x of y". */
    onBatchProgress?: (index: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<ImportRestaurantsResult> {
  const batches = chunkTileGroups(tileGroups);
  if (batches.length === 0) return { ok: false, error: 'Nothing to read.' };

  const rows: ExtractedRestaurant[] = [];
  let firstError: string | undefined;
  for (let i = 0; i < batches.length; i++) {
    if (opts.signal?.aborted) return { ok: false, error: 'Cancelled.' };
    opts.onBatchProgress?.(i, batches.length);
    let result = await extractRestaurantsFromScreenshots(batches[i], opts.signal);
    if (!result.ok && result.retryable && !opts.signal?.aborted) {
      result = await extractRestaurantsFromScreenshots(batches[i], opts.signal);
    }
    if (result.ok && result.restaurants) rows.push(...result.restaurants);
    else firstError ??= result.error;
  }

  if (rows.length === 0) {
    return { ok: false, error: firstError || "Couldn't read a restaurant list in those captures." };
  }
  // Frames overlap across batch boundaries too — dedupe the merged set.
  return { ok: true, restaurants: dedupeExtracted(rows) };
}
