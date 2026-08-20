/**
 * "This restaurant's cuisine is no longer what you think."
 *
 * Every consumer of the shared cuisine cache reads it once, on mount, and
 * then holds what it got: the detail page settles in an effect keyed on
 * the place, and the cards read a persisted meta blob written whenever the
 * detail page last rendered. So an approval landed in the database and the
 * app went on showing the old answer — on the cards indefinitely, because
 * that blob outlives the session.
 *
 * Nothing here polls or subscribes to the database. It only carries the
 * fact that something changed, which is enough: every path that changes a
 * cuisine runs inside this app, on the device of the person who is about
 * to go looking for the change.
 *
 * Its own module rather than a corner of restaurant-cuisine.ts, because
 * both that file and cuisine-lookup.ts need to announce, and they already
 * import each other — putting the emitter in either one closes the cycle.
 */
type CuisineListener = (restaurantId: string) => void;

const listeners = new Set<CuisineListener>();

/** Announce that a restaurant's cuisine has changed. Safe to over-call: a
 *  listener re-reads, finds nothing new, and does nothing. */
export function announceCuisineChange(restaurantId: string): void {
  if (!restaurantId) return;
  for (const fn of [...listeners]) {
    try { fn(restaurantId); } catch (err) { console.warn('[Cuisine] listener threw:', err); }
  }
}

/** Subscribe. Returns the unsubscribe, shaped for an effect cleanup. */
export function onCuisineChange(fn: CuisineListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Test seam. */
export function resetCuisineListeners(): void {
  listeners.clear();
}
