/**
 * Restaurant import — the parsing and resolve logic, with no React in it.
 *
 * Lifted out of pages/ImportRestaurants.tsx so the onboarding wizard can
 * run the same import the Settings page runs. The two surfaces share every
 * rule that decides what lands in the user's ladder and differ only in
 * their chrome; duplicating this would mean two ways to write ratings and
 * one of them going stale.
 *
 * Callers inject their own progress callbacks in place of setState, so the
 * loop is agnostic about whether a page or a wizard step is watching.
 */
import { searchPlacesByText, priceLevelToString, type PlaceResult } from './places';
import { extractRestaurantsFromCaptures, prepareScreenshotTiles } from './import-restaurants-client';
import { extractFramesFromRecording } from './video-frames';
import type { RestaurantRating, RestaurantMeta, WishlistItem } from '../contexts/ListsContext';

export interface ParsedRestaurant {
  name: string;
  address: string;
  city: string;
  cuisine: string;
  rating: number | null;
  notes: string;
  dateVisited: string;
  priceRange: number;
  isWishlist: boolean;
}

export type ImportRowStatus =
  | 'pending' | 'searching' | 'found' | 'updated'
  | 'not_found' | 'skipped' | 'no_data' | 'error';

export interface ImportRow {
  restaurant: ParsedRestaurant;
  /** 'updated' — the place was already rated with a DIFFERENT score, so the
   *  import corrected the score in place (a re-run heals earlier drift). */
  status: ImportRowStatus;
  placeResult?: PlaceResult;
  error?: string;
}

/** Max screenshots per AI read — 6 shots × up to 4 tiles fills one call. */
export const MAX_SCREENSHOTS = 6;
/** Max screen recordings per read — each extracts to many frames. */
export const MAX_RECORDINGS = 2;

/**
 * Tokenize a whole CSV document into rows of fields. A real state machine
 * over the raw text — quoted fields may contain commas, "" escaped quotes,
 * and embedded newlines (the old line-splitting parser corrupted every row
 * after a multiline note). Handles CRLF and a missing trailing newline.
 * Blank lines are dropped.
 */
export function tokenizeCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // "" = escaped quote
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export function parseCSV(text: string): ParsedRestaurant[] {
  const rows = tokenizeCSV(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => h.trim().toLowerCase());

  const nameIdx = headers.findIndex((h) => h.includes('name'));
  const addressIdx = headers.findIndex((h) => h.includes('address'));
  const cityIdx = headers.findIndex((h) => h.includes('city'));
  const cuisineIdx = headers.findIndex((h) => h.includes('cuisine'));
  const ratingIdx = headers.findIndex((h) => h.includes('rating') || h.includes('score'));
  const notesIdx = headers.findIndex((h) => h.includes('note'));
  const dateIdx = headers.findIndex((h) => h.includes('date') || h.includes('visited'));
  const priceIdx = headers.findIndex((h) => h.includes('price'));
  const wishlistIdx = headers.findIndex((h) => h.includes('wishlist'));

  if (nameIdx === -1) return [];

  return rows.slice(1).map((fields) => {
    const at = (idx: number) => (idx >= 0 ? (fields[idx] || '').trim() : '');

    const priceRaw = at(priceIdx);
    const priceRange = priceRaw.includes('$') ? priceRaw.replace(/[^$]/g, '').length : (parseInt(priceRaw) || 0);

    const ratingRaw = at(ratingIdx);
    const rating = ratingRaw ? parseFloat(ratingRaw) : null;

    return {
      name: at(nameIdx),
      address: at(addressIdx),
      city: at(cityIdx),
      cuisine: at(cuisineIdx),
      rating: rating !== null && !isNaN(rating) ? rating : null,
      notes: at(notesIdx),
      dateVisited: at(dateIdx),
      priceRange: Math.min(priceRange, 4),
      isWishlist: ['true', '1', 'yes'].includes(at(wishlistIdx).toLowerCase()),
    };
  }).filter((r) => r.name);
}

export function parseJSON(text: string): ParsedRestaurant[] {
  try {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : data.restaurants || data.data || [];
    return arr.filter((r: any) => r.name).map((r: any) => ({
      name: r.name || '',
      address: r.address || '',
      city: r.city || r.location || '',
      cuisine: r.cuisine || r.type || '',
      rating: r.rating != null ? parseFloat(r.rating) : (r.score != null ? parseFloat(r.score) : null),
      notes: r.notes || r.review || '',
      dateVisited: r.dateVisited || r.date_visited || r.date || '',
      priceRange: typeof r.priceRange === 'number' ? r.priceRange : (typeof r.price_range === 'number' ? r.price_range : (r.price ? String(r.price).replace(/[^$]/g, '').length : 0)),
      isWishlist: !!(r.is_wishlist || r.isWishlist || r.wishlist),
    }));
  } catch { return []; }
}

/** Clamp an imported score onto the app's 0–10 scale — community_ratings
 *  has a CHECK (score <= 10), so an out-of-range value silently failed to
 *  publish while still saving a broken local rating. Also quantized to the
 *  0.01 storage grid (settleScores.MIN_GAP): a Beli 4.3★ doubles to a clean
 *  8.6, but an arbitrary CSV can carry 8.6666667, and imports skip the
 *  settle pass that would otherwise regrid it. */
export const clampScore = (n: number): number => Math.round(Math.min(10, Math.max(0, n)) * 100) / 100;

export async function findGooglePlace(
  restaurant: ParsedRestaurant,
  homeBias: { lat: number; lng: number } | null,
): Promise<PlaceResult | null> {
  const query = `${restaurant.name} ${restaurant.city || restaurant.address}`.trim();
  // Rows carrying a city/address are located by the QUERY TEXT — no
  // coordinate bias, so a home bias can't drag a "Rome trip" CSV toward a
  // same-named place near home. Name-only rows get the home-location bias.
  // Never (0,0): that anchored every match to Null Island, letting a
  // same-named restaurant in the wrong city win.
  const bias = restaurant.city || restaurant.address ? null : homeBias;
  try {
    const results = await searchPlacesByText(query, bias?.lat ?? null, bias?.lng ?? null);
    return results.length > 0 ? results[0] : null;
  } catch {
    try {
      const results = await searchPlacesByText(`${restaurant.name} restaurant`, homeBias?.lat ?? null, homeBias?.lng ?? null);
      return results.length > 0 ? results[0] : null;
    } catch { return null; }
  }
}


/** Route a picked file to the right parser and report the same error the
 *  page has always shown when nothing usable came back. */
export function parseImportFile(fileName: string, text: string): { rows: ParsedRestaurant[]; error?: string } {
  const rows = fileName.endsWith('.json') ? parseJSON(text) : parseCSV(text);
  if (rows.length === 0) {
    return { rows: [], error: 'Could not parse any restaurants. Make sure your file has a "name" column (CSV) or "name" field (JSON).' };
  }
  return { rows };
}

/** Every parsed rating ≤ 5 is almost certainly a 5-point scale, which would
 *  import as terrible /10 scores. Imports skip the settle, so nothing
 *  downstream would ever regrid them — the prompt this drives is the only
 *  chance to catch it. */
export function looksLikeFivePointScale(rows: ParsedRestaurant[]): boolean {
  const scores = rows.map((r) => r.rating).filter((n): n is number => n !== null);
  return scores.length > 0 && Math.max(...scores) <= 5;
}

export function scaleToTen(rows: ParsedRestaurant[]): ParsedRestaurant[] {
  return rows.map((r) => (r.rating !== null ? { ...r, rating: clampScore(r.rating * 2) } : r));
}

/** "6 screenshots + a screen recording" */
export function captureLabel(imageCount: number, videoCount: number): string {
  return [
    imageCount > 0 ? `${imageCount} screenshot${imageCount === 1 ? '' : 's'}` : '',
    videoCount > 0 ? (videoCount === 1 ? 'a screen recording' : `${videoCount} screen recordings`) : '',
  ].filter(Boolean).join(' + ');
}

/** Shape the vision extractor's rows into the parser's shape. */
export function fromExtracted(rows: Array<{
  name: string; city?: string; cuisine?: string; score?: number | null;
  notes?: string; wishlist?: boolean;
}>): ParsedRestaurant[] {
  return rows.map((r) => ({
    name: r.name,
    address: '',
    city: r.city || '',
    cuisine: r.cuisine || '',
    rating: r.score ?? null,
    notes: r.notes || '',
    dateVisited: '',
    priceRange: 0,
    isWishlist: !!r.wishlist,
  }));
}

/**
 * Capture path: screenshots and/or a screen recording → vision read.
 *
 * A recording is first distilled into still frames covering the scroll
 * (video-frames.ts); from there both kinds flow through the same tiling +
 * extraction pipeline. Each capture becomes 1–4 overlapping high-resolution
 * tiles so small row text (Beli's decimal score circles especially) stays
 * legible to the vision model; the extractor dedupes the overlap.
 *
 * The sign-in gate is deliberately NOT here — the wizard's user is provably
 * signed in, the Settings page's may not be, so each caller states its own.
 */
export async function readCapturesToRows(
  files: File[],
  opts: {
    onStage?: (stage: string) => void;
    onPreviews?: (dataUrls: string[]) => void;
    maxScreenshots?: number;
    maxRecordings?: number;
  } = {},
): Promise<{ ok: true; rows: ParsedRestaurant[]; label: string } | { ok: false; error: string }> {
  const images = files.filter((f) => f.type.startsWith('image/')).slice(0, opts.maxScreenshots ?? MAX_SCREENSHOTS);
  const videos = files.filter((f) => f.type.startsWith('video/')).slice(0, opts.maxRecordings ?? MAX_RECORDINGS);
  if (images.length === 0 && videos.length === 0) return { ok: false, error: '' };
  try {
    const tileGroups: string[][] = [];
    for (const f of images) tileGroups.push(await prepareScreenshotTiles(f));
    for (const v of videos) {
      opts.onStage?.('Scanning your recording…');
      const frames = await extractFramesFromRecording(v, (p) => {
        opts.onStage?.(`Scanning your recording… ${Math.round(p * 100)}%`);
      });
      for (const frame of frames) tileGroups.push(await prepareScreenshotTiles(frame));
    }
    opts.onPreviews?.(tileGroups.map((t) => t[0]));
    const result = await extractRestaurantsFromCaptures(tileGroups, {
      onBatchProgress: (i, total) => {
        opts.onStage?.(total > 1 ? `Reading part ${i + 1} of ${total}…` : '');
      },
    });
    if (!result.ok || !result.restaurants) {
      return { ok: false, error: result.error || "Couldn't read those captures. Try again with clearer ones." };
    }
    return { ok: true, rows: fromExtracted(result.restaurants), label: captureLabel(images.length, videos.length) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error && err.message
        ? err.message
        : "Couldn't read one of those files. Use JPG/PNG screenshots or an MP4/MOV recording and try again.",
    };
  }
}

export interface ImportSummary {
  rated: number; wishlisted: number; updated: number;
  skipped: number; notFound: number; noData: number; errors: number;
}

/**
 * Resolve each parsed row to a Google place and write it into the user's
 * data. The rules preserved here are load-bearing:
 *
 * - `ratingMethod: 'import'` + `skipSettle` — imported scores are
 *   transcriptions of ratings the user already made elsewhere and must
 *   land EXACTLY as shown. The settle engine nudges tier-mates on every
 *   save and reshuffled whole batches. Migration 063's aggregation
 *   contract and the feed-share suppression both key off that method.
 * - The duplicate guards GROW during the run, so two rows resolving to the
 *   same place (the same restaurant read from two overlapping screenshots)
 *   create one entry, not two.
 * - A re-run CORRECTS a drifted score in place rather than skipping it,
 *   keeping the rating's notes, photos, lists and visit history.
 */
export async function runRestaurantImport(
  rows: ParsedRestaurant[],
  deps: {
    rateRestaurant: (r: RestaurantRating, o?: { skipSettle?: boolean; silent?: boolean }) => void;
    addToWishlist: (w: WishlistItem) => void;
    cacheRestaurantMeta: (m: RestaurantMeta) => void;
    existingRatings: RestaurantRating[];
    existingWishlistIds: string[];
    homeBias: { lat: number; lng: number } | null;
    /** Suppress the per-save toast. A bulk import re-keys the app's single
     *  toast slot once per row, re-rendering every consumer beneath the
     *  provider for no information the summary doesn't already give. */
    silent?: boolean;
    isAborted?: () => boolean;
    onRow: (index: number, patch: Partial<ImportRow>) => void;
    delayMs?: number;
  },
): Promise<ImportSummary> {
  const summary: ImportSummary = { rated: 0, wishlisted: 0, updated: 0, skipped: 0, notFound: 0, noData: 0, errors: 0 };
  const ratingByPlaceId = new Map<string, RestaurantRating>(deps.existingRatings.map((r) => [r.restaurantId, r]));
  const existingIds = new Set(deps.existingRatings.map((r) => r.restaurantId));
  const existingWishlistIds = new Set(deps.existingWishlistIds);
  const save = { skipSettle: true, silent: deps.silent };

  for (let i = 0; i < rows.length; i++) {
    if (deps.isAborted?.()) break;
    const restaurant = rows[i];

    // Nothing to import for this row (no rating, no wishlist flag) — say so
    // honestly instead of burning a search and marking it green.
    if (!restaurant.isWishlist && restaurant.rating === null) {
      deps.onRow(i, { status: 'no_data' });
      summary.noData++;
      continue;
    }

    deps.onRow(i, { status: 'searching' });
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, deps.delayMs ?? 300));

    try {
      const place = await findGooglePlace(restaurant, deps.homeBias);
      if (!place) { deps.onRow(i, { status: 'not_found' }); summary.notFound++; continue; }

      const isDuplicate = existingIds.has(place.id)
        || (restaurant.isWishlist && existingWishlistIds.has(place.id));
      if (isDuplicate) {
        const existing = ratingByPlaceId.get(place.id);
        const importedScore = restaurant.rating !== null ? clampScore(restaurant.rating) : null;
        if (!restaurant.isWishlist && importedScore !== null && existing && existing.score !== importedScore) {
          deps.rateRestaurant({ ...existing, score: importedScore, ratingMethod: 'import' }, save);
          ratingByPlaceId.set(place.id, { ...existing, score: importedScore });
          deps.onRow(i, { status: 'updated', placeResult: place });
          summary.updated++;
        } else {
          deps.onRow(i, { status: 'skipped', placeResult: place });
          summary.skipped++;
        }
        continue;
      }

      const price = priceLevelToString(restaurant.priceRange || place.priceLevel);
      deps.cacheRestaurantMeta({
        id: place.id, name: place.name, image: place.photoUrl || '',
        cuisine: restaurant.cuisine, price, address: place.address || restaurant.address,
      });

      if (restaurant.isWishlist) {
        deps.addToWishlist({
          restaurantId: place.id, name: place.name, image: place.photoUrl || '',
          cuisine: restaurant.cuisine, price, address: place.address || restaurant.address,
          notes: restaurant.notes, listIds: [], addedAt: Date.now() - (rows.length - i),
        });
        existingWishlistIds.add(place.id);
        summary.wishlisted++;
      } else if (restaurant.rating !== null) {
        deps.rateRestaurant({
          restaurantId: place.id, name: place.name, image: place.photoUrl || '',
          cuisine: restaurant.cuisine, price, address: place.address || restaurant.address,
          score: clampScore(restaurant.rating), notes: restaurant.notes, visitDate: restaurant.dateVisited || '',
          wouldReturn: true, tags: [], photos: [], listIds: [], friendIds: [],
          ratingMethod: 'import',
          // Import order survives as list order.
          createdAt: Date.now() - (rows.length - i),
        }, save);
        summary.rated++;
      }
      existingIds.add(place.id);
      deps.onRow(i, { status: 'found', placeResult: place });
    } catch (err) {
      deps.onRow(i, { status: 'error', error: String(err) });
      summary.errors++;
    }
  }
  return summary;
}
