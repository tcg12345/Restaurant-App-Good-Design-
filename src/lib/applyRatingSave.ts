/**
 * Pure derivation for a rating save: given the CURRENT ratings array and the
 * row being saved, produce the next array plus everything the save flow needs
 * afterwards (settled self, other settle moves, the replaced row).
 *
 * Extracted from ListsContext.rateRestaurant so the "two saves in one tick"
 * flow is unit-testable: the context threads each call's `next` back in as the
 * following call's `prev` (via ratingsRef), and this function must compose —
 * applyRatingSave(applyRatingSave(prev, a).next, b).next keeps BOTH rows.
 */

import type { RestaurantRating } from '../contexts/ListsContext';
import { settleScores, applySettleChanges, type SettleChange } from './settleScores';

export interface RatingSaveResult {
  /** The full ratings array after the save + settle. */
  next: RestaurantRating[];
  /** The row this save replaced (undefined for a first-time rating). */
  existing: RestaurantRating | undefined;
  /** The saved row as it landed — its score may differ from the input's
   *  because the settle can nudge the just-rated row too. */
  settledSelf: RestaurantRating;
  /** Settle moves affecting OTHER rows (for republish + the toast note). */
  otherChanged: SettleChange[];
}

export function applyRatingSave(
  prev: RestaurantRating[],
  rating: RestaurantRating,
  opts: { now: number; settleOrder?: string[] },
): RatingSaveResult {
  const existing = prev.find((r) => r.restaurantId === rating.restaurantId);
  // Beli-style settle: a score-changing save may shift tier-mates so the
  // ranked order gets breathing room (crowding fix). Note-only edits keep
  // the score identical and must NOT settle (drift guard).
  const scoreChanged = !existing || existing.score !== rating.score;
  // Stamp updatedAt now so this save wins the multi-device merge over any
  // stale copy of the same rating on another device.
  const stampedRating: RestaurantRating = { ...rating, updatedAt: opts.now };
  const baseNext = [stampedRating, ...prev.filter((r) => r.restaurantId !== rating.restaurantId)];
  const settleChanges: SettleChange[] = scoreChanged
    ? settleScores(baseNext, {
        justRatedId: rating.restaurantId,
        previousScore: existing ? existing.score : undefined,
        // Head-to-head saves carry the search's exact placement so the
        // settle can't invert an order the comparisons already decided.
        explicitOrder: opts.settleOrder,
      })
    : [];
  // Every row the settle moved (plus the rated row) is a modification —
  // bump updatedAt on each so their new scores survive a merge too.
  const changedIds = new Set<string>([rating.restaurantId, ...settleChanges.map((c) => c.restaurantId)]);
  const next = applySettleChanges(baseNext, settleChanges)
    .map((r) => (changedIds.has(r.restaurantId) ? { ...r, updatedAt: opts.now } : r));
  const settledSelf = next.find((r) => r.restaurantId === rating.restaurantId) ?? stampedRating;
  const otherChanged = settleChanges.filter((c) => c.restaurantId !== rating.restaurantId);
  return { next, existing, settledSelf, otherChanged };
}
