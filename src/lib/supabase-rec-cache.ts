/**
 * Home-page recommendation cache. Persists the Google Places results we
 * computed for a given (user, location) pair so returning to the same city
 * doesn't spend the Places API budget every time.
 *
 * Cache slots are keyed by a 2-decimal-rounded "lat_lng" (≈1 km), so
 * neighborhood-level picks within the same city share a slot. The caller
 * passes a preferences hash so we can detect when the user's top cuisines /
 * price tiers have drifted and supplement with a small top-up call.
 */

import { supabase, supabaseConfigured } from './supabase';
import type { PlaceResult } from './places';

export interface HomeRecCacheEntry {
  places: PlaceResult[];
  preferencesHash: string;
  updatedAt: number; // ms since epoch
}

/** Round a coordinate to 2 decimals so nearby picks collide (≈1.1 km slot). */
export function locationKey(lat: number, lng: number): string {
  const round = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
  return `${round(lat)}_${round(lng)}`;
}

/**
 * Deterministic hash of the preference signals that drive rec queries. We
 * only care about the top-N entries since the rec engine only reads those.
 */
export function preferencesHash(cuisines: string[], prices: number[]): string {
  const topCuisines = [...cuisines.slice(0, 5)].sort().join(',');
  const topPrices = [...prices].sort((a, b) => a - b).slice(0, 3).join(',');
  return `${topCuisines}|${topPrices}`;
}

/** Fetch the cached recommendations for this user + location, if any. */
export async function getHomeRecsCache(
  userId: string,
  key: string,
): Promise<HomeRecCacheEntry | null> {
  if (!supabaseConfigured || !userId) return null;
  try {
    const { data, error } = await supabase
      .from('home_rec_cache')
      .select('places_data, preferences_hash, updated_at')
      .eq('user_id', userId)
      .eq('location_key', key)
      .maybeSingle();
    if (error || !data) return null;
    const places = Array.isArray((data as any).places_data)
      ? ((data as any).places_data as PlaceResult[])
      : [];
    return {
      places,
      preferencesHash: (data as any).preferences_hash || '',
      updatedAt: new Date((data as any).updated_at).getTime(),
    };
  } catch (err) {
    console.warn('[RecCache] get error:', err);
    return null;
  }
}

/** Upsert the cache slot for this user + location. */
export async function saveHomeRecsCache(
  userId: string,
  key: string,
  label: string,
  lat: number,
  lng: number,
  prefsHash: string,
  places: PlaceResult[],
): Promise<void> {
  if (!supabaseConfigured || !userId || places.length === 0) return;
  try {
    await supabase.from('home_rec_cache').upsert(
      {
        user_id: userId,
        location_key: key,
        location_label: label,
        location_lat: lat,
        location_lng: lng,
        preferences_hash: prefsHash,
        places_data: places,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,location_key' },
    );
  } catch (err) {
    console.warn('[RecCache] save error:', err);
  }
}
