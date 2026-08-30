import {
  buildTasteProfile, buildCandidateQueries, scoreCandidates,
  type CandidateSignals, type ScoredPlace, type RecCandidate,
} from './recommendations';
import {
  searchPlacesByText, searchPlacesByTextPaged, isFoodPlace, isVenuePlace,
  CUISINE_TYPES, TEXT_EXACT_SUFFICIENT_POOL, type PlaceResult,
} from './places';
import { cuisineLabel } from './cuisine';
import type { HomeLocation } from '../components/HomeLocationBar';

/**
 * Cold-start "here's what we'd suggest" preview: quiz answers → taste
 * profile → candidate queries → live search → scorer. Shared by the
 * pre-auth preview screen and the wizard's rate-places step, so both show
 * the same real recommendation path rather than each inventing its own
 * "starter" list.
 */

const emptySignals = (): CandidateSignals => ({
  expertUserIds: new Set(),
  followedExpertIds: new Set(),
  friendUserIds: new Set(),
  communityByRestaurant: new Map(),
  expertRecRestaurantIds: new Set(),
});

const PREVIEW_RADIUS_M = 12_000;

/**
 * Does this place actually serve one of the cuisines the user named?
 *
 * Google's own `types` are the real signal — `japanese_restaurant` is
 * asserted by Places, whereas a display label is derived — so that is
 * checked first, with the label as a fallback for places typed only as
 * `restaurant`. Substring either direction so "Modern Japanese" answers
 * "Japanese".
 */
function matchesStatedCuisine(place: PlaceResult, stated: string[]): boolean {
  if (stated.length === 0) return true;
  const types = new Set(place.types ?? []);
  const label = (cuisineLabel(place) || '').toLowerCase();
  for (const name of stated) {
    const wanted = CUISINE_TYPES.find((c) => c.label.toLowerCase() === name.toLowerCase());
    if (wanted?.type && types.has(wanted.type)) return true;
    const n = name.toLowerCase();
    if (label && (label.includes(n) || n.includes(label))) return true;
  }
  return false;
}

/** Exposed for tests — the cuisine gate is the thing that keeps this
 *  screen's "built from your answers" claim honest, so it is pinned. */
export const __testing = { matchesStatedCuisine };

/** At most 3 billed text searches, behind the search memo. */
export async function fetchTastePreview(
  answers: { cuisines: string[]; prices: number[] },
  city: HomeLocation,
  opts?: { limit?: number },
): Promise<ScoredPlace[]> {
  // Same signal shape the flow persists — otherwise the preview would rank
  // by different rules than the app the user is about to sign up for.
  const profile = buildTasteProfile([], [], [], [], {
    cuisines: answers.cuisines,
    prices: answers.prices,
    pricePrimary: answers.prices[0],
    priceSecondary: answers.prices[1],
    city: city.label,
  });
  const queries = buildCandidateQueries(profile, city).slice(0, 3);
  const batches = await Promise.all(queries.map((q) =>
    q.priceLevels && q.priceLevels.length > 0
      ? searchPlacesByTextPaged(q.text, {
          lat: city.lat, lng: city.lng, radiusMeters: PREVIEW_RADIUS_M,
          useRestriction: true, priceLevels: q.priceLevels,
        }).then((page) => page.places).catch(() => [] as PlaceResult[])
      : searchPlacesByText(q.text, city.lat, city.lng, city.label, true, PREVIEW_RADIUS_M,
          undefined, { minExactResults: TEXT_EXACT_SUFFICIENT_POOL })
          .catch(() => [] as PlaceResult[]),
  ));
  const seen = new Set<string>();
  const pool: RecCandidate[] = [];
  for (const p of batches.flat()) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    // Light quality floor — a suggestion is a first impression, and a 3.4★
    // with nine reviews makes the "made for your taste" claim ring false.
    if (!isFoodPlace(p.types) || isVenuePlace(p)) continue;
    if ((p.rating || 0) < 4.0 || (p.userRatingCount || 0) < 25) continue;
    pool.push(p);
  }
  const limit = opts?.limit ?? 6;
  // Rank deeper than we intend to show, so the cuisine pass below has a real
  // bench to draw from rather than reordering the same six.
  const ranked = scoreCandidates(pool, profile, emptySignals(), city, PREVIEW_RADIUS_M, {
    limit: Math.max(limit * 3, 18),
  });

  // A stated cuisine leads. The queries above already ask for it, but a text
  // search is a suggestion, not a filter — Google will still hand back the
  // celebrated brasserie two doors down. This screen's whole claim is "built
  // from your answers", so anything that answers them outranks anything that
  // doesn't; the rest stay as backfill rather than being dropped, because a
  // short honest list is worse than a full one that leads with the right
  // places.
  const stated = answers.cuisines ?? [];
  if (stated.length === 0) return ranked.slice(0, limit);
  const onCuisine: ScoredPlace[] = [];
  const rest: ScoredPlace[] = [];
  for (const p of ranked) (matchesStatedCuisine(p, stated) ? onCuisine : rest).push(p);
  return [...onCuisine, ...rest].slice(0, limit);
}
