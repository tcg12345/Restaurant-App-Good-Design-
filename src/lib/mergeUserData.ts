/**
 * Multi-device merge for user data (ListsContext sign-in reconciliation).
 *
 * The old sign-in "merge" was pick-whichever-side-is-non-empty, so a stale
 * device's first save clobbered newer cloud data, and an edit made to an
 * entry that existed on both sides was silently dropped (cloud won wholesale
 * for shared ids). These pure functions replace that with a real merge:
 *
 *   - entries are keyed by id and the NEWER one wins (by updatedAt, falling
 *     back to createdAt / addedAt), so an edit on either device survives;
 *   - array memberships (a rating's listIds, a list's restaurantIds /
 *     wishlistIds / recipes) are UNIONED rather than taken from one side, so
 *     "added to a list on device A" and "added to a different list on device
 *     B" both stick.
 *
 * Tombstones (deletions) are applied by the caller AFTER merging — a union
 * can't represent a removal on its own. Keep these functions pure and
 * dependency-free so they stay unit-testable.
 */
import type { RestaurantRating, CustomList, WishlistItem, Trip, HomeMeal, Recipe } from '../contexts/ListsContext';

/** Effective "last touched" timestamp, by PRECEDENCE not max: updatedAt if
 *  present, else createdAt, else addedAt, else 0. Precedence (not max) is
 *  what lets an edited entry (updatedAt bumped above its createdAt) beat an
 *  un-edited copy of the same entity that carries only the shared createdAt —
 *  a max would let that stable createdAt mask the edit. Relies on the
 *  invariant that we always stamp updatedAt = Date.now() ≥ createdAt. */
function tsOf(entry: Record<string, unknown>): number {
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return num(entry.updatedAt) ?? num(entry.createdAt) ?? num(entry.addedAt) ?? 0;
}

/** Union two string arrays preserving order: `primary` first, then any ids in
 *  `secondary` not already present. Falsy entries are dropped. */
export function unionIds(primary: string[] | undefined, secondary: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...(primary || []), ...(secondary || [])]) {
    if (id && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

/**
 * Generic id-keyed merge. For each id: if only one side has it, keep it; if
 * both do, keep the newer entry's scalar fields and let `combine` reconcile
 * any array/nested fields (given winner + loser). Order follows cloud first
 * (stable server order), then local-only entries appended.
 */
export function mergeById<T extends Record<string, unknown>>(
  local: T[],
  cloud: T[],
  getId: (entry: T) => string | undefined,
  combine?: (winner: T, loser: T) => T,
): T[] {
  const cloudById = new Map<string, T>();
  const order: string[] = [];
  for (const c of cloud || []) {
    const id = getId(c);
    if (!id) continue;
    if (!cloudById.has(id)) order.push(id);
    cloudById.set(id, c);
  }
  const result = new Map<string, T>(cloudById);
  for (const l of local || []) {
    const id = getId(l);
    if (!id) continue;
    const existing = result.get(id);
    if (!existing) {
      order.push(id);
      result.set(id, l);
      continue;
    }
    const winner = tsOf(l) > tsOf(existing) ? l : existing;
    const loser = winner === l ? existing : l;
    result.set(id, combine ? combine(winner, loser) : winner);
  }
  return order.map((id) => result.get(id)!).filter(Boolean);
}

export function mergeRatings(local: RestaurantRating[], cloud: RestaurantRating[]): RestaurantRating[] {
  return mergeById(
    local as unknown as Record<string, unknown>[],
    cloud as unknown as Record<string, unknown>[],
    (r) => (r as unknown as RestaurantRating).restaurantId,
    (winner, loser) => ({
      ...winner,
      // Membership is additive across devices — union rather than pick a side.
      listIds: unionIds((winner as unknown as RestaurantRating).listIds, (loser as unknown as RestaurantRating).listIds),
      friendIds: unionIds((winner as unknown as RestaurantRating).friendIds, (loser as unknown as RestaurantRating).friendIds),
    }),
  ) as unknown as RestaurantRating[];
}

export function mergeWishlist(local: WishlistItem[], cloud: WishlistItem[]): WishlistItem[] {
  return mergeById(
    local as unknown as Record<string, unknown>[],
    cloud as unknown as Record<string, unknown>[],
    (w) => (w as unknown as WishlistItem).restaurantId,
    (winner, loser) => ({
      ...winner,
      listIds: unionIds((winner as unknown as WishlistItem).listIds, (loser as unknown as WishlistItem).listIds),
    }),
  ) as unknown as WishlistItem[];
}

export function mergeLists(local: CustomList[], cloud: CustomList[]): CustomList[] {
  return mergeById(
    local as unknown as Record<string, unknown>[],
    cloud as unknown as Record<string, unknown>[],
    (l) => (l as unknown as CustomList).id,
    (winner, loser) => {
      const w = winner as unknown as CustomList;
      const l = loser as unknown as CustomList;
      // Recipes are their own id-keyed entities — merge them too (newer wins)
      // instead of dropping the losing side's recipes.
      const recipes = mergeById(
        (l.recipes || []) as unknown as Record<string, unknown>[],
        (w.recipes || []) as unknown as Record<string, unknown>[],
        (r) => (r as unknown as Recipe).id,
      ) as unknown as Recipe[];
      return {
        ...w,
        restaurantIds: unionIds(w.restaurantIds, l.restaurantIds),
        wishlistIds: unionIds(w.wishlistIds, l.wishlistIds),
        recipes: (w.recipes || l.recipes) ? recipes : w.recipes,
        // listRatings: keep the winner's map, backfilling keys only the loser had.
        listRatings: (w.listRatings || l.listRatings)
          ? { ...(l.listRatings || {}), ...(w.listRatings || {}) }
          : w.listRatings,
      } as unknown as Record<string, unknown>;
    },
  ) as unknown as CustomList[];
}

export function mergeTrips(local: Trip[], cloud: Trip[]): Trip[] {
  // Trips are edited as a unit (a trip's restaurants/hotels move together), so
  // newer-wins on the whole entry is correct; no sub-array union needed.
  return mergeById(
    local as unknown as Record<string, unknown>[],
    cloud as unknown as Record<string, unknown>[],
    (t) => (t as unknown as Trip).id,
  ) as unknown as Trip[];
}

export function mergeHomeMeals(local: HomeMeal[], cloud: HomeMeal[]): HomeMeal[] {
  return mergeById(
    local as unknown as Record<string, unknown>[],
    cloud as unknown as Record<string, unknown>[],
    (m) => (m as unknown as HomeMeal).id,
  ) as unknown as HomeMeal[];
}
