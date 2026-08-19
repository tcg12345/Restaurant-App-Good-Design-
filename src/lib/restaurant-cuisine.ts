/**
 * Shared restaurant cuisine cache (restaurant_cuisine, migration 068).
 *
 * Cuisine is resolvable only from a Google place payload, which only the
 * device that opened the restaurant's detail page actually holds. Every
 * other surface — saved ratings, list rows, profile top lists — has just a
 * place id, so a place Google doesn't describe in `types` stayed blank for
 * everyone forever, however many people had eaten there and said what it
 * was. This is the shared memory that fixes that: whoever resolves a place
 * publishes the answer once, and everybody's saved copy picks it up.
 *
 * Writes are ranked server-side by `source` (see the migration): a guess
 * from the restaurant's name can never overwrite what a person typed. The
 * client sends only the source — it cannot promote its own answer.
 */
import { supabase, supabaseConfigured } from './supabase';
import { resolveCuisine, cuisineFromName, type CuisineSource } from './cuisine';
import { lookupCuisines, noteCuisineSource } from './cuisine-lookup';

/**
 * Where a cached cuisine came from, strongest first. Mirrors
 * cuisine_source_confidence() in migration 068 — the DB is authoritative;
 * this ordering is here so callers can set a threshold without a round trip.
 */
export const CUISINE_SOURCES = [
  'approved', 'consensus', 'michelin', 'community', 'community_single', 'google', 'osm', 'google_display', 'name',
] as const;
export type CuisineSourceName = (typeof CUISINE_SOURCES)[number];

const CONFIDENCE: Record<string, number> = {
  approved: 100, consensus: 95, michelin: 90, community: 80, community_single: 65,
  google: 60, osm: 55, google_display: 50, name: 30,
};

/**
 * What an OpenStreetMap answer is worth (migration 070). Anything already
 * at or above this has nothing to gain from a lookup, which is what makes
 * the lookup below cheap: it fires only where Google actually failed.
 */
export const OSM_CONFIDENCE = CONFIDENCE.osm;

/**
 * Tiers only the server may write (migration 069's guard drops them from
 * a client). Listed here so this module can't be edited into publishing
 * one by accident — publishRestaurantCuisine refuses them.
 */
const SERVER_ONLY: ReadonlySet<string> = new Set(['approved', 'consensus', 'community', 'osm']);

export function cuisineConfidence(source: string): number {
  return CONFIDENCE[source] ?? 0;
}

export interface CachedCuisine {
  cuisine: string;
  source: string;
  confidence: number;
}

/**
 * The floor for writing a cached cuisine into somebody's saved rating.
 *
 * Anything below this is a guess — good enough to SHOW on a detail page
 * where it's plainly the app's best read of the place, not good enough to
 * persist into a user's own data, where it would be indistinguishable from
 * something they entered. `name` (30) sits below the line on purpose.
 */
export const PERSIST_CONFIDENCE_FLOOR = 50;

const CHUNK = 200;

/**
 * Batched cache read — one `.in()` query per 200 ids. Missing rows are
 * simply absent; callers fall back to whatever they can resolve locally.
 * Never throws: a cuisine is an enhancement, never a reason to fail a screen.
 */
export async function getRestaurantCuisineBatch(ids: string[]): Promise<Record<string, CachedCuisine>> {
  const out: Record<string, CachedCuisine> = {};
  if (!supabaseConfigured || ids.length === 0) return out;
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += CHUNK) {
    try {
      const { data, error } = await supabase.from('restaurant_cuisine')
        .select('restaurant_id, cuisine, source, confidence')
        .in('restaurant_id', unique.slice(i, i + CHUNK));
      if (error) {
        console.warn('[Cuisine] cache read failed (migration 068 applied?):', error.message);
        return out;
      }
      for (const row of (data || []) as Array<{ restaurant_id: string; cuisine: string; source: string; confidence: number }>) {
        if (row.cuisine) {
          out[row.restaurant_id] = {
            cuisine: row.cuisine,
            source: row.source,
            confidence: row.confidence ?? cuisineConfidence(row.source),
          };
        }
      }
    } catch {
      return out;
    }
  }
  return out;
}

/** One id — convenience over the batch reader. */
export async function getRestaurantCuisine(id: string): Promise<CachedCuisine | null> {
  if (!id) return null;
  return (await getRestaurantCuisineBatch([id]))[id] ?? null;
}

/**
 * Fire-and-forget cache write. Safe to call on every resolve: the server
 * drops it when something stronger is already known, and the drop is a
 * silent no-op rather than an error.
 */
export function publishRestaurantCuisine(restaurantId: string, cuisine: string, source: CuisineSourceName): void {
  const trimmed = (cuisine || '').trim();
  if (!supabaseConfigured || !restaurantId || !trimmed) return;
  // 'Restaurant' is the non-answer this whole effort removes — the server
  // rejects it too, but there's no point spending a round trip on it.
  if (trimmed.toLowerCase() === 'restaurant') return;
  // Reviewed tiers come from the approve RPC and the consensus trigger,
  // never from here. The server refuses them from a client anyway; this
  // makes the rule visible at the call site.
  if (SERVER_ONLY.has(source)) return;
  void supabase.from('restaurant_cuisine')
    .upsert({ restaurant_id: restaurantId, cuisine: trimmed, source }, { onConflict: 'restaurant_id' })
    .then(({ error }) => { if (error) console.warn('[Cuisine] cache write failed:', error.message); });
}

/**
 * Settle a place's cuisine and contribute whatever we learned back.
 *
 * The detail page is the one screen holding a full Google payload and a
 * Michelin match, so it is where the shared cache gets fed. It is also
 * where a correction has to surface: someone fixing a wrong label is
 * pointless if this screen keeps preferring the label they fixed. So the
 * published answer and the locally derivable one are compared by rank, and
 * the stronger wins:
 *
 *   michelin (90) — curated, and it names the cuisine outright
 *   google   (60) — Google's own primaryType / types for the place
 *   google_display (50) — Google's label, outside our taxonomy
 *   name     (30) — read off the restaurant's name; a guess
 *
 * against whatever is in the cache, where a reviewed correction sits at
 * 95–100 and other people's ratings at 65–80. A write only goes out when what we
 * derived here beats what is already published — so a screen that already
 * agrees with the cache costs one read and nothing else.
 *
 * The read never throws and the write is fire-and-forget, so the caller
 * gets an answer (possibly '') without any of this being able to fail a
 * screen.
 */
export async function settleRestaurantCuisine(opts: {
  restaurantId: string;
  name?: string;
  /** Cuisine from a Michelin dataset match, when there is one. */
  michelinCuisine?: string | null;
  /** The Google place payload, when the caller has one. */
  place?: CuisineSource | null;
  /**
   * Fall back to OpenStreetMap when everything above still leaves this
   * place below the `osm` tier — the rural inns and hotel dining rooms
   * Google describes as nothing but "Restaurant".
   *
   * Opt-in because it can cost a network round trip, and only a screen
   * that will still be there when it lands should pay for it. Off by
   * default, so a caller that just wants what is already known is
   * unaffected.
   */
  lookup?: boolean;
  /** Helps the lookup find the place. Optional: the server prefers its own
   *  geocode cache over anything a client claims. */
  lat?: number | null;
  lng?: number | null;
}): Promise<string> {
  const { restaurantId, name, michelinCuisine, place } = opts;
  if (!restaurantId) return '';

  // What this screen can work out on its own, and what that's worth.
  let local: { label: string; source: CuisineSourceName } | null = null;
  const michelin = (michelinCuisine || '').trim();
  if (michelin) {
    local = { label: michelin, source: 'michelin' };
  } else {
    const resolved = place ? resolveCuisine(place) : null;
    if (resolved) {
      local = { label: resolved.label, source: resolved.canonical ? 'google' : 'google_display' };
    } else {
      const guess = cuisineFromName(name);
      if (guess) local = { label: guess, source: 'name' };
    }
  }

  const cached = await getRestaurantCuisine(restaurantId);
  const localRank = local ? cuisineConfidence(local.source) : 0;
  const cachedRank = cached?.cuisine ? cached.confidence : 0;

  // Whoever ran the lookup, if what we are about to show came from
  // OpenStreetMap the screen owes it a credit. Cleared here too, so a
  // place that has since been corrected stops claiming one.
  if (cached?.cuisine && cachedRank >= localRank) noteCuisineSource(restaurantId, cached.source);
  else noteCuisineSource(restaurantId, local?.source || '');

  // Contribute only when we actually know better than what's published.
  // Contributing and answering are separate decisions: a guess read off
  // the name is worth publishing at its own low tier, and is still not
  // the answer if OpenStreetMap can do better.
  if (local && localRank > cachedRank) {
    publishRestaurantCuisine(restaurantId, local.label, local.source);
  }
  const best = local && localRank > cachedRank ? local.label : (cached?.cuisine || local?.label || '');

  // Everything above has had its say and this place is still described
  // worse than an OSM tag would describe it — which, for a rural
  // restaurant, usually means not described at all. Go and ask.
  if (opts.lookup && Math.max(localRank, cachedRank) < OSM_CONFIDENCE) {
    const found = await lookupCuisines([{ restaurantId, name: name || '', lat: opts.lat, lng: opts.lng }]);
    if (found[restaurantId]) return found[restaurantId];
  }
  return best;
}
