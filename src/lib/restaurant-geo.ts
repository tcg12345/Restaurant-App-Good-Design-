/**
 * Shared restaurant geocode cache (restaurant_geo, migration 054).
 *
 * Client-side geocoding of coordinate-less ratings costs a paid Places /
 * Mapbox call per restaurant, and the old "persistence" — republishing the
 * rating row under its OWNER's id — was rejected by RLS whenever the
 * viewer wasn't the owner, so other users' profiles/maps re-geocoded the
 * same places on every mount. This cache is keyed by the public place id
 * and readable/writable by any authenticated user: whoever geocodes a
 * place first pays the API call once, everyone else gets a batched read.
 */
import { supabase, supabaseConfigured } from './supabase';

export interface RestaurantGeo {
  lat: number;
  lng: number;
}

const CHUNK = 200;

/** Batched cache read — one .in() query per 200 ids. Missing/failed rows
 *  are simply absent; callers geocode only what's left. */
export async function getRestaurantGeoBatch(ids: string[]): Promise<Record<string, RestaurantGeo>> {
  const out: Record<string, RestaurantGeo> = {};
  if (!supabaseConfigured || ids.length === 0) return out;
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += CHUNK) {
    try {
      const { data, error } = await supabase.from('restaurant_geo')
        .select('restaurant_id, lat, lng')
        .in('restaurant_id', unique.slice(i, i + CHUNK));
      if (error) {
        console.warn('[Geo] cache read failed (migration 054 applied?):', error.message);
        return out;
      }
      for (const row of (data || []) as Array<{ restaurant_id: string; lat: number; lng: number }>) {
        if (Number.isFinite(row.lat) && Number.isFinite(row.lng)) {
          out[row.restaurant_id] = { lat: row.lat, lng: row.lng };
        }
      }
    } catch {
      return out;
    }
  }
  return out;
}

/** Fire-and-forget cache write after a successful geocode. */
export function saveRestaurantGeo(restaurantId: string, lat: number, lng: number): void {
  if (!supabaseConfigured || !restaurantId || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
  void supabase.from('restaurant_geo')
    .upsert({ restaurant_id: restaurantId, lat, lng, updated_at: new Date().toISOString() }, { onConflict: 'restaurant_id' })
    .then(({ error }) => { if (error) console.warn('[Geo] cache write failed:', error.message); });
}
