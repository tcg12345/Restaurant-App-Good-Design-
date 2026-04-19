/**
 * Shared restaurant-metadata cache. Backed by the `restaurant_meta_cache`
 * table (migration 017): one row per Google Place ID holding coords +
 * the canonical photo URL.
 *
 * The table is world-readable and authenticated-writable so the first user
 * who resolves a restaurant pays the Google Places cost once and every
 * future viewer (any user, any profile, any list) gets the result for free.
 *
 * A module-level in-memory map fronts the Supabase reads so repeated lookups
 * within the same session are instant and don't re-hit the DB either.
 */

import { supabase, supabaseConfigured } from './supabase';

export interface RestaurantMeta {
  restaurantId: string;
  lat: number | null;
  lng: number | null;
  photoUrl: string | null;
  name?: string | null;
  address?: string | null;
}

// Session cache. Maps restaurant_id → meta. A cache miss here still falls
// through to Supabase; a hit bypasses it entirely.
const memCache = new Map<string, RestaurantMeta>();

/** Pull whatever the in-memory session cache has — never throws, never waits. */
export function getRestaurantMetaFromMemory(id: string): RestaurantMeta | null {
  return memCache.get(id) || null;
}

/**
 * Look up a batch of restaurant IDs against the shared cache. Fills the
 * session map as a side effect so subsequent lookups for the same ids return
 * synchronously. Safe to call with a huge ids array — missing rows are just
 * absent in the result.
 */
export async function getRestaurantMetaBatch(ids: string[]): Promise<Record<string, RestaurantMeta>> {
  const out: Record<string, RestaurantMeta> = {};
  const toFetch: string[] = [];
  for (const id of ids) {
    const cached = memCache.get(id);
    if (cached) out[id] = cached;
    else toFetch.push(id);
  }
  if (!supabaseConfigured || toFetch.length === 0) return out;
  try {
    const { data, error } = await supabase
      .from('restaurant_meta_cache')
      .select('restaurant_id, lat, lng, photo_url, name, address')
      .in('restaurant_id', toFetch);
    if (!error && data) {
      for (const row of data as any[]) {
        const meta: RestaurantMeta = {
          restaurantId: row.restaurant_id,
          lat: row.lat,
          lng: row.lng,
          photoUrl: row.photo_url,
          name: row.name,
          address: row.address,
        };
        memCache.set(meta.restaurantId, meta);
        out[meta.restaurantId] = meta;
      }
    }
  } catch (err) {
    console.warn('[RestaurantMeta] batch read error:', err);
  }
  return out;
}

/**
 * Upsert a resolved meta row. Silently ignored if Supabase isn't configured
 * or the viewer isn't authenticated. We update the memory cache first so
 * other views in this session see the new data immediately even if the
 * Supabase write races or fails.
 */
export async function saveRestaurantMeta(meta: RestaurantMeta): Promise<void> {
  memCache.set(meta.restaurantId, meta);
  if (!supabaseConfigured) return;
  try {
    await supabase.from('restaurant_meta_cache').upsert(
      {
        restaurant_id: meta.restaurantId,
        lat: meta.lat,
        lng: meta.lng,
        photo_url: meta.photoUrl,
        name: meta.name ?? null,
        address: meta.address ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'restaurant_id' },
    );
  } catch (err) {
    console.warn('[RestaurantMeta] save error:', err);
  }
}
