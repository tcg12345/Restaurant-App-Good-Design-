import { useEffect } from 'react';
import { useLists } from '../contexts/ListsContext';
import { fetchLocationDataForPlace } from './places';

/** One shot per place per session — fetchLocationDataForPlace dedupes
 *  in-flight calls, this set stops repeat attempts for places whose
 *  lookup failed (bad/synthetic id, offline). */
const attempted = new Set<string>();

/** Cap the burst so switching on a filter over a huge list can't fan out
 *  hundreds of details calls at once. Deliberately generous: a typical
 *  rated list fits entirely, and the details cache makes repeats free. */
const WARM_CAP = 50;

/**
 * Proactively backfill opening hours for the given restaurants while an
 * hours filter is active.
 *
 * The hours filter reads `restaurantMeta[id].hours`, but that cache is
 * normally only warmed when a restaurant's card mounts (or its detail
 * page is visited). Filtering happens BEFORE cards render, so a list
 * that was never browsed has no hours anywhere — and the filter's
 * unknown-hours fallback (never hide a place we have no data for) then
 * keeps everything, which reads as "the filter doesn't work".
 *
 * While `active`, this fetches details (deduped + cached) for every id
 * whose meta lacks hours and writes them back to the shared meta; the
 * state update re-runs the caller's filter with real data. Ids that
 * can't resolve (synthetic entries) fail once, silently, and are
 * not retried.
 */
export function useWarmHoursForFilter(ids: Array<string | undefined>, active: boolean): void {
  const { restaurantMeta, cacheRestaurantMeta } = useLists();
  useEffect(() => {
    if (!active) return;
    const missing: string[] = [];
    for (const id of ids) {
      if (!id || attempted.has(id) || restaurantMeta[id]?.hours !== undefined) continue;
      missing.push(id);
      if (missing.length >= WARM_CAP) break;
    }
    if (missing.length === 0) return;
    let cancelled = false;
    for (const id of missing) {
      attempted.add(id);
      fetchLocationDataForPlace(id).then(({ addressComponents, neighborhood, lat, lng, hours }) => {
        if (cancelled) return;
        if (!addressComponents?.length && !neighborhood && lat == null && lng == null && hours == null) return;
        cacheRestaurantMeta({
          id,
          ...(addressComponents?.length ? { addressComponents } : {}),
          ...(neighborhood ? { neighborhood } : {}),
          ...(lat != null ? { lat } : {}),
          ...(lng != null ? { lng } : {}),
          // Empty array = "asked, none published" so we never refetch.
          ...(hours != null ? { hours } : {}),
        });
      });
    }
    return () => { cancelled = true; };
  }, [ids, active, restaurantMeta, cacheRestaurantMeta]);
}
