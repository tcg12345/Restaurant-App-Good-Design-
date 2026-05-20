/**
 * Universal Restaurant Rating (URR) — data access layer.
 *
 * URR captures pairwise restaurant comparisons (matches) and exposes
 * filter-aware ratings computed nightly by the urr_compute Edge Function.
 * This module is the client-side counterpart: writing matches, building
 * normalized filter keys, and reading from the world-readable cache.
 */
import { supabase, supabaseConfigured } from './supabase';
import { extractCityState } from './places';
import type { RestaurantRating, RestaurantMeta } from '../contexts/ListsContext';

const ALGO_VERSION = 'elo-v1';

export interface UrrContext {
  cuisine: string;
  price: string;
  city: string;
  neighborhood: string;
  lat?: number;
  lng?: number;
}

export interface UrrMatch {
  winnerId: string;
  loserId: string;
  margin: number;
  winnerCtx: UrrContext;
  loserCtx: UrrContext;
  source: 'explicit' | 'reorder' | 'backfill' | 'experimental';
  sourceRef?: string;
}

export interface UrrRatingEntry {
  /** User-facing 0-10 score (per-slice logistic rescale of internal Elo). */
  score: number;
  /** Internal Elo rating, centered at 1500. */
  rating: number;
  /** TrueSkill mean (mirrors `rating` in MVP). */
  mu: number;
  /** TrueSkill standard deviation (null in MVP). */
  sigma: number | null;
  ci_low: number;
  ci_high: number;
  n_matches: number;
  n_raters: number;
  /** Distinct raters with experience >= 0.5 in MVP. */
  experienced_n: number;
}

export interface UrrFallbackResult {
  entry: UrrRatingEntry;
  /** The slice key that actually hit — may be broader than what was requested. */
  filterKey: string;
  /** Human label for the slice that hit, e.g. "Italian" or "overall". */
  label: string;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Normalization helpers                                                    */
/* ──────────────────────────────────────────────────────────────────────── */

function slugifyBase(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[,\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function slugifyCuisine(s: string): string {
  return slugifyBase(s);
}

/**
 * Slugify a city string and strip a trailing two-letter state code so
 * "New York, NY", "new york ny", and "NEW YORK" all collapse to "new-york".
 * Prevents slice-cache fragmentation across the same city.
 */
export function slugifyCity(s: string): string {
  const slug = slugifyBase(s);
  return slug.replace(/-[a-z]{2}$/, '');
}

/**
 * Build a canonical filter key. Always lowercase, slugified, alphabetically
 * sorted, pipe-joined. Returns "overall" when no filters are provided.
 */
export function buildFilterKey(opts: { cuisine?: string; city?: string; price?: string }): string {
  const parts: string[] = [];
  if (opts.cuisine) parts.push(`cuisine:${slugifyCuisine(opts.cuisine)}`);
  if (opts.city) parts.push(`city:${slugifyCity(opts.city)}`);
  if (opts.price) parts.push(`price:${opts.price}`);
  return parts.length === 0 ? 'overall' : parts.sort().join('|');
}

/**
 * Build a UrrContext from a rating + (optional) meta. Cuisine and city are
 * slugified at write time so backfilled and live-emitted matches collide
 * on identical keys.
 */
export function buildContext(rating: RestaurantRating, meta?: RestaurantMeta): UrrContext {
  const rawCity = extractCityState(rating.address, '') || '';
  return {
    cuisine: slugifyCuisine(rating.cuisine || ''),
    price: rating.price || '',
    city: slugifyCity(rawCity),
    neighborhood: slugifyBase(meta?.neighborhood ?? ''),
    lat: meta?.lat,
    lng: meta?.lng,
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Writes                                                                   */
/* ──────────────────────────────────────────────────────────────────────── */

function toRow(userId: string, m: UrrMatch) {
  return {
    user_id: userId,
    winner_restaurant_id: m.winnerId,
    loser_restaurant_id: m.loserId,
    margin: m.margin,
    context_tags: { winner: m.winnerCtx, loser: m.loserCtx },
    source: m.source,
    source_ref: m.sourceRef ?? null,
  };
}

/**
 * Insert pairwise match rows. Idempotent on (user_id, source, source_ref);
 * duplicates are silently ignored. Fire-and-forget at call sites.
 */
export async function emitMatches(userId: string, matches: UrrMatch[]): Promise<boolean> {
  if (!supabaseConfigured || !userId || matches.length === 0) return false;
  try {
    const rows = matches.map((m) => toRow(userId, m));
    const { error } = await supabase
      .from('urr_matches')
      .upsert(rows, { onConflict: 'user_id,source,source_ref', ignoreDuplicates: true });
    if (error) {
      console.error('[URR] emitMatches error:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[URR] emitMatches exception:', err);
    return false;
  }
}

/**
 * For each pair, DELETE any prior `source='reorder'` rows (either direction)
 * and INSERT the new one. Atomic per pair via the replace_reorder_match RPC.
 * The frontend issues N concurrent RPCs for a batch drag-end.
 */
export async function replaceReorderMatches(userId: string, matches: UrrMatch[]): Promise<boolean> {
  if (!supabaseConfigured || !userId || matches.length === 0) return false;
  try {
    const results = await Promise.allSettled(
      matches.map((m) =>
        supabase.rpc('replace_reorder_match', {
          p_winner: m.winnerId,
          p_loser: m.loserId,
          p_margin: m.margin,
          p_context_tags: { winner: m.winnerCtx, loser: m.loserCtx },
          p_source_ref: m.sourceRef ?? null,
        }),
      ),
    );
    const failures = results.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error));
    if (failures.length > 0) {
      console.error('[URR] replaceReorderMatches partial failure:', failures);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[URR] replaceReorderMatches exception:', err);
    return false;
  }
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Reads                                                                    */
/* ──────────────────────────────────────────────────────────────────────── */

async function loadSlice(filterKey: string): Promise<Record<string, UrrRatingEntry> | null> {
  if (!supabaseConfigured) return null;
  try {
    const { data, error } = await supabase
      .from('urr_ratings_cache')
      .select('ratings_data')
      .eq('filter_key', filterKey)
      .eq('algo_version', ALGO_VERSION)
      .maybeSingle();
    if (error || !data) return null;
    return (data.ratings_data ?? {}) as Record<string, UrrRatingEntry>;
  } catch (err) {
    console.error('[URR] loadSlice exception:', err);
    return null;
  }
}

/** Single-restaurant lookup in a slice. */
export async function getUrrForRestaurant(
  restaurantId: string,
  filterKey: string = 'overall',
): Promise<UrrRatingEntry | null> {
  const blob = await loadSlice(filterKey);
  if (!blob) return null;
  return blob[restaurantId] ?? null;
}

/**
 * Walk from most-specific to least-specific filter key until a slice with
 * this restaurant is found. Returns null if even the overall slice has no
 * data for this restaurant.
 */
export async function getUrrWithFallback(
  restaurantId: string,
  filters: { cuisine?: string; city?: string; price?: string },
): Promise<UrrFallbackResult | null> {
  const cuisine = filters.cuisine ? slugifyCuisine(filters.cuisine) : '';
  const city = filters.city ? slugifyCity(filters.city) : '';
  const price = filters.price ?? '';

  const tiers: Array<{ key: string; label: string }> = [];
  if (cuisine && city && price) tiers.push({ key: buildFilterKey({ cuisine, city, price }), label: `${cuisine} (${city}, ${price})` });
  if (cuisine && city) tiers.push({ key: buildFilterKey({ cuisine, city }), label: `${cuisine} (${city})` });
  if (cuisine) tiers.push({ key: buildFilterKey({ cuisine }), label: cuisine });
  if (city) tiers.push({ key: buildFilterKey({ city }), label: city });
  tiers.push({ key: 'overall', label: 'overall' });

  for (const tier of tiers) {
    const entry = await getUrrForRestaurant(restaurantId, tier.key);
    if (entry) return { entry, filterKey: tier.key, label: tier.label };
  }
  return null;
}

/** Sorted leaderboard for a slice. */
export async function getUrrLeaderboard(
  filterKey: string = 'overall',
  limit: number = 50,
): Promise<Array<{ restaurantId: string } & UrrRatingEntry>> {
  const blob = await loadSlice(filterKey);
  if (!blob) return [];
  return Object.entries(blob)
    .map(([restaurantId, entry]) => ({ restaurantId, ...entry }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Latest successful compute run timestamp — used for "URR updated Nh ago". */
export async function getLatestComputeRun(): Promise<{ finishedAt: string; algoVersion: string } | null> {
  if (!supabaseConfigured) return null;
  try {
    const { data, error } = await supabase
      .from('urr_compute_runs')
      .select('finished_at, algo_version')
      .eq('status', 'success')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.finished_at) return null;
    return { finishedAt: data.finished_at, algoVersion: data.algo_version };
  } catch {
    return null;
  }
}
