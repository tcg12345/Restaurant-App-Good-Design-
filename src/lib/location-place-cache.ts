/**
 * Shared per-city restaurant cache for the city-explore surfaces.
 *
 * Both /location (the list view) and /location/map (the map view)
 * need the same set of fetched restaurants for a given (city, coords,
 * price filter) tuple — without sharing the cache, opening the map
 * after browsing the list would re-pay the Google Places spend.
 *
 * The cache is module-level (in-memory for instant reads during a
 * session) with a localStorage mirror so reloads inside the TTL
 * window stay free. Entries are pruned to keep storage bounded.
 */

import type { PlaceResult } from './places';

/* Per-query cursor. Each query in the rotation paginates independently
   via Google's nextPageToken; we persist the current token + drained
   flag so reload-then-load-more resumes mid-stream rather than
   restarting from page 1. */
export interface QueryCursor {
  query: string;
  pageToken?: string;
  drained?: boolean;
}

export interface CachedCityData {
  placesPool: PlaceResult[];
  cursors: QueryCursor[];
  seenIds: string[];
  exhausted: boolean;
  /** Hash of the user's top cuisines at cache time. Lets the read site
   *  decide whether to keep the persisted cursors or rebuild them
   *  against a freshly-shifted taste profile. */
  cuisinesKey: string;
  updatedAt: number;
}

export const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
// v2 when the schema switched from {queryPool, queryCursor} to {cursors}.
export const CACHE_STORAGE_KEY = 'gourmad-location-page-cache-v2';
export const MAX_CACHED_CITIES = 24; // doubled from v1 since price tiers get their own slots

/**
 * Stable per-(city, coords, price-tier) key. Including the price tier
 * means switching between $ and $$$$ just looks up a different cache
 * entry — neither invalidates the other.
 */
export function cityCacheKey(
  lat: number,
  lng: number,
  cityKey: string,
  priceLevel: number,
): string {
  return `${cityKey.toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}|p=${priceLevel}`;
}

export function cuisinesKeyOf(topCuisines: string[]): string {
  return topCuisines.slice(0, 5).join('|');
}

type CacheMap = Record<string, CachedCityData>;

let memoryCache: CacheMap | null = null;

function loadCache(): CacheMap {
  if (memoryCache) return memoryCache;
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    memoryCache = raw ? (JSON.parse(raw) as CacheMap) : {};
  } catch {
    memoryCache = {};
  }
  return memoryCache;
}

function persistCache(cache: CacheMap) {
  // Keep only the most-recent N entries so storage doesn't grow unboundedly.
  const entries = Object.entries(cache)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, MAX_CACHED_CITIES);
  const pruned: CacheMap = {};
  for (const [k, v] of entries) pruned[k] = v;
  memoryCache = pruned;
  try {
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    /* quota exceeded / storage disabled — in-memory copy still works. */
  }
}

export function readCachedCity(key: string): CachedCityData | null {
  const cache = loadCache();
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > CACHE_TTL_MS) {
    delete cache[key];
    persistCache(cache);
    return null;
  }
  return entry;
}

export function writeCachedCity(key: string, data: Omit<CachedCityData, 'updatedAt'>) {
  const cache = loadCache();
  cache[key] = { ...data, updatedAt: Date.now() };
  persistCache(cache);
}
