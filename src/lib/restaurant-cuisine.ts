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

/**
 * Where a cached cuisine came from, strongest first. Mirrors
 * cuisine_source_confidence() in migration 068 — the DB is authoritative;
 * this ordering is here so callers can set a threshold without a round trip.
 */
export const CUISINE_SOURCES = [
  'user', 'michelin', 'community', 'community_single', 'google', 'google_display', 'name',
] as const;
export type CuisineSourceName = (typeof CUISINE_SOURCES)[number];

const CONFIDENCE: Record<string, number> = {
  user: 100, michelin: 90, community: 80, community_single: 65,
  google: 60, google_display: 50, name: 30,
};

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
 * against whatever is in the cache, where a human correction sits at 100
 * and other people's ratings at 65–80. A write only goes out when what we
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

  // Contribute only when we actually know better than what's published.
  if (local && localRank > cachedRank) {
    publishRestaurantCuisine(restaurantId, local.label, local.source);
    return local.label;
  }
  return cached?.cuisine || local?.label || '';
}
