/**
 * The OpenStreetMap backup for cuisine (migration 070, the cuisine-lookup
 * Edge Function).
 *
 * Google leaves rural restaurants — inns, farmhouse restaurants, hotel
 * dining rooms — with nothing but "Restaurant". OSM's `cuisine=*` tag is
 * entered by someone who went there, and that is exactly where its coverage
 * is best. This is the client half: ask the server about places we still
 * can't describe, and remember what came back.
 *
 * Three things keep this from turning into traffic:
 *
 *   • Nothing is asked twice in a session (`asked`).
 *   • Requests inside one tick are coalesced into a single batch, so a list
 *     of thirty rows mounting at once produces one or two calls rather than
 *     thirty.
 *   • The server has the real defences — a shared cache, a negative cache,
 *     and a per-user rate limit. This layer just stops us being rude.
 *
 * Every failure path is silent. A missing cuisine is the status quo; it is
 * never worth a visible error.
 */
import { supabase, supabaseConfigured } from './supabase';

export interface LookupPlace {
  restaurantId: string;
  name: string;
  lat?: number | null;
  lng?: number | null;
}

/** Mirrors MAX_PLACES in the Edge Function. Sending more just gets the
 *  tail ignored, so split here instead. */
const MAX_PER_CALL = 25;

/** Asked for this session — hit or miss. The server remembers misses for
 *  45 days; this stops us re-asking within one page view. */
const asked = new Set<string>();

/** Places waiting for the next flush, and everyone waiting on them. */
let queue = new Map<string, LookupPlace>();
let pending: Promise<Record<string, string>> | null = null;

/** ODbL requires attribution wherever the data is shown. Populated from the
 *  server's own answer so the two can't drift. */
let attribution = 'Cuisine data © OpenStreetMap contributors (ODbL)';
export const osmAttribution = (): string => attribution;

/** True once a lookup in this session actually returned an OSM cuisine —
 *  which is when the attribution has to appear. */
let usedOsm = false;
export const hasOsmCuisine = (): boolean => usedOsm;

/**
 * Which places we are currently showing OpenStreetMap data for.
 *
 * ODbL wants the credit where the data is, and "the data" is one label on
 * one restaurant — not every restaurant in the app. Both routes to an OSM
 * cuisine record here: a lookup this session made, and a lookup someone
 * else made that we read out of the shared cache (restaurant-cuisine.ts
 * calls noteCuisineSource for that one).
 */
const fromOsm = new Set<string>();

export function noteCuisineSource(restaurantId: string, source: string): void {
  if (!restaurantId) return;
  if (source === 'osm') { fromOsm.add(restaurantId); usedOsm = true; }
  else fromOsm.delete(restaurantId);
}

/** Does this restaurant's displayed cuisine need the OSM credit? */
export const isOsmCuisine = (restaurantId: string): boolean => fromOsm.has(restaurantId);

async function callServer(places: LookupPlace[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < places.length; i += MAX_PER_CALL) {
    const batch = places.slice(i, i + MAX_PER_CALL);
    try {
      const { data, error } = await supabase.functions.invoke('cuisine-lookup', {
        body: {
          places: batch.map((p) => ({
            restaurantId: p.restaurantId,
            name: p.name,
            ...(typeof p.lat === 'number' && typeof p.lng === 'number' ? { lat: p.lat, lng: p.lng } : {}),
          })),
        },
      });
      if (error) {
        console.warn('[Cuisine] OSM lookup failed:', error.message);
        continue;
      }
      if (typeof data?.attribution === 'string' && data.attribution) attribution = data.attribution;
      const cuisines = (data?.cuisines || {}) as Record<string, { cuisine?: string; source?: string }>;
      for (const [id, entry] of Object.entries(cuisines)) {
        if (!entry?.cuisine) continue;
        out[id] = entry.cuisine;
        noteCuisineSource(id, entry.source || '');
      }
    } catch (err) {
      console.warn('[Cuisine] OSM lookup threw:', err);
    }
  }
  return out;
}

/**
 * Ask about these places, coalescing with anything else asked for in the
 * same tick. Resolves to the cuisines the server could name — which may
 * include places it answered from the shared cache rather than OSM, and
 * may be empty. Never rejects.
 *
 * A place with no coordinates is still worth sending: the server has its
 * own geocode cache and prefers it over anything a client claims.
 */
export function lookupCuisines(places: LookupPlace[]): Promise<Record<string, string>> {
  if (!supabaseConfigured) return Promise.resolve({});

  for (const p of places) {
    const id = (p.restaurantId || '').trim();
    const name = (p.name || '').trim();
    if (!id || !name || asked.has(id) || queue.has(id)) continue;
    queue.set(id, { restaurantId: id, name, lat: p.lat, lng: p.lng });
  }
  if (queue.size === 0) return Promise.resolve({});

  // One flush per tick: thirty list rows mounting together share a call.
  if (!pending) {
    pending = Promise.resolve().then(() => {
      const batch = [...queue.values()];
      queue = new Map();
      pending = null;
      for (const p of batch) asked.add(p.restaurantId);
      return callServer(batch);
    });
  }
  return pending;
}

/** Test seam — and the thing to call if a session ever needs to re-ask. */
export function resetCuisineLookups(): void {
  asked.clear();
  queue = new Map();
  pending = null;
  usedOsm = false;
  fromOsm.clear();
}
