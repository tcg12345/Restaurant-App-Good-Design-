/**
 * Beli-style score redistribution ("settle").
 *
 * The head-to-head flow decides WHERE a restaurant ranks; this module decides
 * what everyone's 0–10 number looks like afterwards. Instead of freezing every
 * other score (which made each insertion halve an ever-smaller gap until the
 * whole tier piled up at 9–10), a settle pass lets rating one restaurant shift
 * its tier-mates up or down:
 *
 *  - ORDER IS SACRED: the settled scores always preserve the current ranking
 *    (ties broken deterministically; the just-rated row sorts below an equal
 *    incumbent — "too close to call" lands you right under the pivot).
 *  - GAP RATIOS ARE PRESERVED, not uniformed: the layout the tier relaxes
 *    toward distributes the band proportionally to the user's existing gaps,
 *    so a standout #1 keeps its lead. Never evenly spaced by design.
 *  - SOFT ANCHORING BY COUNT: with a handful of ratings the scores stay near
 *    where they were placed; as a tier matures (MATURITY_K), its layout
 *    contracts toward a full spread — the top of "loved" drifts to 10.0, the
 *    bottom of "disliked" to 1.0 — decompressing the crowded end for real.
 *  - MIN GAP 0.01: adjacent tier-mates always end at least one storage step
 *    apart (until a tier exceeds the band's 0.01-grid capacity). Scores are
 *    STORED at two decimals so the ranking is strict — no two restaurants
 *    tie — even when the 1-decimal display rounds neighbours together.
 *    Whether the second decimal is SHOWN is a display preference
 *    (SettingsContext.twoDecimalScores); it exists either way.
 *
 * Stability: the settle is a constraint PROJECTION (gap floors + anchor
 * inequalities), not a continuous pull — a layout that already satisfies the
 * constraints is a fixed point, so repeated settles are idempotent up to
 * 0.01-grid dust. Settles run only on score-changing events and touch only
 * the affected tier(s).
 */

import type { RestaurantRating } from '../contexts/ListsContext';
import { tierRange, type Tier } from './headToHeadRating';

/** Minimum gap between adjacent tier-mates — one step of the 0.01 STORAGE
 *  grid. Ratings are ranked, and a ranking with ties isn't one: two
 *  restaurants may display the same rounded 8.3, but underneath one is
 *  always strictly higher. */
export const MIN_GAP = 0.01;
/** The smallest gap that still reads as a difference at one decimal — what
 *  the layout tries to give every adjacent pair so no two ratings look
 *  identical. It is a TARGET, not a hard floor: it gets capped at half the
 *  average gap (see settleTierScores), because a minimum as large as the
 *  average forces every gap to BE the average, which is exactly the
 *  uniform-ladder failure this whole module exists to avoid. */
export const MIN_VISIBLE_GAP = 0.1;
/** Spacing a mature tier relaxes toward. 3.0 band / 0.3 = 10 gaps, so a tier
 *  reaches full spread right around the same count it reaches maturity.
 *  Drives the tier's SPAN, never a per-gap floor. */
export const PREFERRED_GAP = 0.3;
/** Maturity f = min(1, (n-1)/K): 1 item = untouched, 11+ = fully anchored. */
export const MATURITY_K = 10;

export interface SettleChange {
  restaurantId: string;
  score: number;
}

export interface SettleOptions {
  /** The row whose rating triggered the settle. Sorts BELOW equal-scored
   *  incumbents (tie → adjacent under the pivot) and selects which tier(s)
   *  settle (its own, plus `previousScore`'s when re-rating across tiers). */
  justRatedId?: string;
  /** The score a row is leaving behind — its tier settles too. Set on a
   *  re-rate that crosses tiers, and on a DELETE (where it is the only
   *  hint there is, since the row is already gone from `all`). */
  previousScore?: number;
  /** Settle every tier in both categories (the Reorder page's save). */
  allTiers?: boolean;
  /** Desired descending order (restaurant ids). Takes precedence over the
   *  raw scores for rows it contains — carries the H2H search's exact
   *  placement (and the Reorder page's dragged order) through equal-score
   *  blocks and off-by-a-step nudged scores. */
  explicitOrder?: string[];
}

/** Band membership by score, tolerant of float dust on the 0.01 grid.
 *  The half-step (0.005) tolerance matters at the band seams: the H2H
 *  strict-bound nudge can put a score at 6.99 — deliberately BELOW the
 *  loved band — and that must classify as fine, while a float-dusted
 *  6.999999999 that means 7.0 must stay loved. */
export function tierOfScore(score: number): Tier {
  if (score >= 6.995) return 'loved';
  if (score >= 3.995) return 'fine';
  return 'disliked';
}

/** Quantize to the 0.01 storage grid. */
const roundGrid = (v: number): number => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Distinct 0.01-grid slots available in a tier band (301 loved / 291 fine / 291 disliked). */
function bandCapacity(tier: Tier): number {
  const { min, max } = tierRange(tier);
  return Math.round((max - min) / MIN_GAP) + 1;
}

interface OrderedRow {
  restaurantId: string;
  score: number;
}

/**
 * Raise every gap to at least `floor`, paying for it out of the roomier
 * gaps in proportion to how much room each has to spare. Total span is
 * unchanged, and the gaps that weren't at the floor keep their ratios to
 * each other — that's the whole point: a chasm the user actually meant
 * stays a chasm, it just donates a little of itself so its crowded
 * neighbours become legible.
 *
 * Feasible in one pass whenever `floor` ≤ span/nGaps (callers guarantee
 * a much stronger bound); the loop is belt-and-braces.
 */
function waterFillGaps(gaps: number[], floor: number): void {
  for (let iter = 0; iter < 8; iter++) {
    let deficit = 0;
    let surplus = 0;
    for (const g of gaps) {
      if (g < floor) deficit += floor - g;
      else surplus += g - floor;
    }
    if (deficit <= 1e-12) return;
    if (surplus <= 1e-12) { gaps.fill(floor); return; }
    const take = Math.min(1, deficit / surplus);
    for (let i = 0; i < gaps.length; i++) {
      gaps[i] = gaps[i] < floor ? floor : floor + (gaps[i] - floor) * (1 - take);
    }
  }
}

/**
 * Close the crater a departed rating leaves behind.
 *
 * Deleting a row — or re-rating it into a different tier — merges the two
 * gaps that surrounded it into one, so the ladder keeps a double-width hole
 * shaped by a restaurant that is no longer in the list. The constraint
 * projection cannot fix this on its own and never will: to it, a wide gap
 * is a wide gap, indistinguishable from a chasm the user meant. The repair
 * has to happen here, at the one moment we still know which score left.
 *
 * The merged gap becomes max(gapAbove, gapBelow) — the larger of the two
 * real separations survives, so a genuine chasm on one side of the departed
 * row is kept, and only the room the row itself occupied is reclaimed.
 * Everything below the hole lifts by that amount; the settle then re-spreads
 * the shortened ladder as usual.
 */
function closeDepartedGap(rows: OrderedRow[], departed: number): OrderedRow[] {
  const n = rows.length;
  let j = -1;
  for (let i = 0; i < n - 1; i++) {
    if (rows[i].score >= departed && departed >= rows[i + 1].score) { j = i; break; }
  }
  if (j < 0) return rows; // it sat at an end — no two gaps merged
  const merged = rows[j].score - rows[j + 1].score;
  const target = Math.max(rows[j].score - departed, departed - rows[j + 1].score, MIN_GAP);
  if (target >= merged - 1e-9) return rows; // nothing to reclaim
  const lift = merged - target;
  return rows.map((r, i) => (i > j ? { ...r, score: roundGrid(r.score + lift) } : r));
}

/**
 * Settle one tier's rows (already ordered desc) — a constraint PROJECTION,
 * not a continuous relaxation, so it is idempotent: once the constraints
 * hold, settling again changes nothing.
 *
 *  - SPAN grows with maturity: the tier claims f·(n−1)·PREFERRED_GAP of its
 *    band, capped at the band, and never gives back span it already earned.
 *  - SHAPE is preserved by SCALING the gaps to that span, not by flooring
 *    them. This is the difference that matters, and getting it wrong is
 *    what made this feature look broken: flooring maps every gap below the
 *    floor onto the SAME number, and in a crowded tier that's all of them —
 *    so three tight clusters separated by real chasms came out as one
 *    perfectly even ladder, erasing the user's judgment. Scaling multiplies
 *    every gap by one constant, so a chasm stays exactly N× its neighbours.
 *  - A visible floor is then water-filled in (see waterFillGaps) so crowded
 *    pairs still separate — but it is capped at HALF the average gap,
 *    because demanding a large minimum inside a crowded band is itself a
 *    recipe for uniformity: if every gap must be ≥ the average, every gap
 *    IS the average.
 *  - The anchor is an INEQUALITY, not a pull: loved's top must sit at or above
 *    bandMin + f·W (→ pinned to 10.0 at maturity), disliked's bottom at or
 *    below bandMax − f·W (→ 1.0). Layouts already satisfying it don't move.
 *
 * Returns the new score per index: order-preserving, band-contained,
 * 0.01-grid, min-gap enforced.
 */
function settleTierScores(rows: OrderedRow[], tier: Tier): number[] {
  const n = rows.length;
  const s = rows.map((r) => r.score);
  if (n <= 1) return s.map(roundGrid);

  const { min: bandMin, max: bandMax } = tierRange(tier);
  const W = bandMax - bandMin;
  const nGaps = n - 1;

  // Overflow fill: more rows than distinct 0.01 slots. Rounding here would
  // collapse neighbors into DUPLICATE scores — and every list in the app
  // sorts by score, where ties fall back to array order (the just-rated row
  // sits at the array head), so the settled order scrambled on display: a
  // restaurant placed mid-block rendered at the top of it. Emit strictly-
  // descending UNROUNDED scores instead — badges still display one decimal
  // (visual ties are unavoidable past capacity), but the exact order now
  // survives every score sort in the app.
  const uniformFill = (): number[] =>
    s.map((_, i) => tier === 'disliked'
      ? bandMin + ((n - 1 - i) * W) / (n - 1)
      : bandMax - (i * W) / (n - 1));

  // Overflow: more rows than distinct grid slots — uniform band fill.
  if (n > bandCapacity(tier)) return uniformFill();

  const f = Math.min(1, (n - 1) / MATURITY_K);

  // ── 1. The span this tier should occupy ───────────────────────────
  const rawGaps: number[] = [];
  let rawSpan = 0;
  for (let i = 0; i < nGaps; i++) {
    const g = Math.max(0, s[i] - s[i + 1]);
    rawGaps.push(g);
    rawSpan += g;
  }
  const spanT = clamp(
    Math.max(rawSpan, f * Math.min(W, nGaps * PREFERRED_GAP)),
    nGaps * MIN_GAP,
    W,
  );

  // ── 2. Scale to it — ratios preserved exactly ─────────────────────
  const gaps = rawSpan <= 1e-9
    ? new Array<number>(nGaps).fill(spanT / nGaps)   // every score identical
    : rawGaps.map((g) => g * (spanT / rawSpan));

  // ── 3. Lift crowded pairs to a visible floor, paid for in proportion ──
  waterFillGaps(gaps, Math.max(MIN_GAP, Math.min(MIN_VISIBLE_GAP, (spanT / nGaps) * 0.5)));

  // Quantize the gaps (not just the final positions) so the ladder this
  // pass emits is exactly the ladder the next pass reads back.
  let span = 0;
  for (let i = 0; i < nGaps; i++) {
    gaps[i] = Math.max(MIN_GAP, roundGrid(gaps[i]));
    span += gaps[i];
  }
  if (span > W + 1e-9) {
    // Grid rounding pushed the ladder a hair past the band — shave the
    // widest gaps back a step at a time until it fits.
    for (let guard = 0; span > W + 1e-9 && guard < nGaps * 4; guard++) {
      let widest = 0;
      for (let i = 1; i < nGaps; i++) if (gaps[i] > gaps[widest]) widest = i;
      if (gaps[widest] <= MIN_GAP) break;
      gaps[widest] = roundGrid(gaps[widest] - MIN_GAP);
      span = roundGrid(span - MIN_GAP);
    }
  }

  const out = new Array<number>(n).fill(0);
  if (tier === 'disliked') {
    // Bottom-anchored: the worst rating must reach down toward the band
    // floor as the tier matures.
    const bottomReq = bandMax - f * W;
    const bottom = clamp(roundGrid(Math.min(s[n - 1], bottomReq)), bandMin, roundGrid(bandMax - span));
    out[n - 1] = Math.max(bottom, bandMin);
    let cum = 0;
    for (let i = n - 2; i >= 0; i--) {
      cum += gaps[i];
      out[i] = Math.max(roundGrid(out[n - 1] + cum), roundGrid(out[i + 1] + MIN_GAP));
    }
    // Rounding drift can poke the head above the ceiling — push it back
    // while keeping the grid ladder (capacity guarantees the fit).
    if (out[0] > bandMax) {
      out[0] = bandMax;
      for (let i = 1; i < n - 1; i++) {
        out[i] = Math.min(out[i], roundGrid(out[i - 1] - MIN_GAP));
      }
    }
  } else {
    // Top-anchored: loved's best must reach up toward 10 as the tier
    // matures; fine has no anchor pull (containment + gaps only).
    const topReq = tier === 'loved' ? bandMin + f * W : bandMin;
    const top = clamp(roundGrid(Math.max(s[0], topReq)), roundGrid(bandMin + span), bandMax);
    out[0] = Math.min(top, bandMax);
    let cum = 0;
    for (let i = 1; i < n; i++) {
      cum += gaps[i - 1];
      out[i] = Math.min(roundGrid(out[0] - cum), roundGrid(out[i - 1] - MIN_GAP));
    }
    // Rounding drift can nudge the tail below the band floor — lift it back
    // while keeping the grid ladder (capacity guarantees the fit).
    if (out[n - 1] < bandMin) {
      out[n - 1] = bandMin;
      for (let i = n - 2; i >= 1; i--) {
        out[i] = Math.max(out[i], roundGrid(out[i + 1] + MIN_GAP));
      }
    }
  }
  const settled = out.map((v) => clamp(roundGrid(v), bandMin, bandMax));

  // Idempotence guard. Everything above works in real numbers and then
  // lands on the 0.01 grid, so a layout that is already correct can come
  // back a few thousandths off and re-register as a change forever. A move
  // smaller than half a grid step isn't a move — report the input, snapped
  // to the grid so legacy off-grid scores still get regridded exactly once.
  let moved = false;
  for (let i = 0; i < n; i++) {
    if (Math.abs(settled[i] - s[i]) > MIN_GAP / 2) { moved = true; break; }
  }
  return moved ? settled : s.map((v) => clamp(roundGrid(v), bandMin, bandMax));
}

/**
 * Compute the settle for a ratings snapshot. Returns only the rows whose
 * (rounded) score actually changes. Only the affected tier(s) are touched
 * unless `allTiers` is set.
 */
export function settleScores(all: RestaurantRating[], opts: SettleOptions = {}): SettleChange[] {
  const { justRatedId, previousScore, allTiers, explicitOrder } = opts;

  const orderIndex = new Map<string, number>();
  if (explicitOrder) explicitOrder.forEach((id, i) => orderIndex.set(id, i));

  const justRated = justRatedId ? all.find((r) => r.restaurantId === justRatedId) : undefined;

  const tiersToSettle = new Set<Tier>();
  if (allTiers) {
    tiersToSettle.add('loved');
    tiersToSettle.add('fine');
    tiersToSettle.add('disliked');
  } else if (justRated || typeof previousScore === 'number') {
    // `previousScore` alone is a valid request: a DELETE has no just-rated
    // row, only the score that left. Requiring justRated here is what made
    // deleting a rating skip the settle entirely.
    if (justRated) tiersToSettle.add(tierOfScore(justRated.score));
    if (typeof previousScore === 'number') tiersToSettle.add(tierOfScore(previousScore));
  } else {
    return [];
  }

  const compare = (a: RestaurantRating, b: RestaurantRating): number => {
    // The explicit order — the H2H search's exact placement (or the Reorder
    // page's dragged order) — OUTRANKS the raw scores for rows it covers.
    // A row bracketed inside an equal-scored block can't express "strictly
    // above C, strictly below B" in one number: computeFinalScore nudges it
    // one display step off the block, and a score-first sort would dump it
    // at the block's edge (above/below ALL the equals) instead of the slot
    // the user's comparisons decided. The order contains every tier-mate of
    // a rated row, so this stays a total order within a tier's sort.
    const ai = orderIndex.get(a.restaurantId);
    const bi = orderIndex.get(b.restaurantId);
    if (ai !== undefined && bi !== undefined && ai !== bi) return ai - bi;
    if (b.score !== a.score) return b.score - a.score;
    // The just-rated row yields to an equal-scored incumbent: a tie places it
    // directly BELOW the pivot; the incumbent keeps its exact spot.
    if (a.restaurantId === justRatedId) return 1;
    if (b.restaurantId === justRatedId) return -1;
    return a.restaurantId < b.restaurantId ? -1 : a.restaurantId > b.restaurantId ? 1 : 0;
  };

  const changes: SettleChange[] = [];
  for (const tier of tiersToSettle) {
    const rows = all
      .filter((r) => tierOfScore(r.score) === tier)
      .sort(compare)
      .map((r) => ({ restaurantId: r.restaurantId, score: r.score }));
    if (rows.length <= 1) continue;
    // A score LEFT this tier (a delete, or a re-rate that moved the row to a
    // different tier) — close the hole before laying the ladder out. Not for
    // a same-tier re-rate: there the row is still here, just somewhere else,
    // and the insert accounts for its own space.
    const departedHere = typeof previousScore === 'number'
      && tierOfScore(previousScore) === tier
      && !(justRated && tierOfScore(justRated.score) === tier);
    const laidOut = departedHere ? closeDepartedGap(rows, previousScore!) : rows;
    const settled = settleTierScores(laidOut, tier);
    for (let i = 0; i < rows.length; i++) {
      // Epsilon compare (not grid equality): overflow fills emit unrounded
      // scores, and a float that equals the stored value exactly must not
      // re-register as a change on every settle.
      if (Math.abs(settled[i] - rows[i].score) > 1e-9) {
        changes.push({ restaurantId: rows[i].restaurantId, score: settled[i] });
      }
    }
  }
  return changes;
}

/**
 * One-shot, explicit "spread my scores out" pass — for lists that grew
 * crowded at the top before the settle engine existed.
 *
 * Rank-preserving decompression, NOT an even respace:
 *  - Order is sacred (same tie-breaks as settle; explicitOrder honored).
 *  - Each row's position in the new layout blends its ORIGINAL relative
 *    position (60%) with its uniform rank position (40%) — clumps open up,
 *    but a standout gap stays visibly bigger than a tight pair.
 *  - The tier stretches toward a full spread as it matures: loved's top
 *    drifts to 10.0, disliked's bottom to 1.0, span grows toward
 *    min(band, (n−1)·PREFERRED_GAP).
 *  - 0.01 grid, MIN_GAP enforced while the band has capacity; beyond
 *    capacity a uniform fill with rounded duplicates is unavoidable.
 */
export function normalizeScores(
  all: RestaurantRating[],
  opts: { explicitOrder?: string[] } = {},
): SettleChange[] {
  const orderIndex = new Map<string, number>();
  if (opts.explicitOrder) opts.explicitOrder.forEach((id, i) => orderIndex.set(id, i));
  const compare = (a: RestaurantRating, b: RestaurantRating): number => {
    // Same precedence as settleScores: the dragged order outranks raw
    // scores for rows it covers (see the comment there).
    const ai = orderIndex.get(a.restaurantId);
    const bi = orderIndex.get(b.restaurantId);
    if (ai !== undefined && bi !== undefined && ai !== bi) return ai - bi;
    if (b.score !== a.score) return b.score - a.score;
    return a.restaurantId < b.restaurantId ? -1 : a.restaurantId > b.restaurantId ? 1 : 0;
  };

  const changes: SettleChange[] = [];
  for (const tier of ['loved', 'fine', 'disliked'] as Tier[]) {
    const rows = all
      .filter((r) => r.score > 0 && tierOfScore(r.score) === tier)
      .sort(compare);
    const n = rows.length;
    if (n <= 1) continue;

    const { min: bandMin, max: bandMax } = tierRange(tier);
    const W = bandMax - bandMin;
    const s0 = rows[0].score;
    const sLast = rows[n - 1].score;
    const f = Math.min(1, (n - 1) / MATURITY_K);

    let out: number[];
    if (n > bandCapacity(tier)) {
      // More rows than 0.01 slots — uniform fill. Unrounded so the scores
      // stay strictly descending (see settleTierScores.uniformFill).
      out = rows.map((_, i) => bandMax - (i * W) / (n - 1));
    } else {
      const currentSpan = Math.max(0, s0 - sLast);
      const spanT = clamp(
        Math.max(currentSpan, f * Math.min(W, (n - 1) * PREFERRED_GAP)),
        (n - 1) * MIN_GAP,
        W,
      );
      // Anchors: loved reaches up toward 10, disliked down toward 1 as the
      // tier matures; fine stays centered on where the user put it.
      let top: number;
      if (tier === 'loved') {
        top = clamp(bandMax - (1 - f) * (bandMax - s0), bandMin + spanT, bandMax);
      } else if (tier === 'disliked') {
        const bottom = clamp(bandMin + (1 - f) * (sLast - bandMin), bandMin, bandMax - spanT);
        top = bottom + spanT;
      } else {
        const center = (s0 + sLast) / 2;
        top = clamp(center + spanT / 2, bandMin + spanT, bandMax);
      }

      // Blend original relative position with uniform rank position.
      out = rows.map((r, i) => {
        const u = i / (n - 1);
        const q = currentSpan > 1e-9 ? (s0 - r.score) / currentSpan : u;
        const pos = 0.6 * q + 0.4 * u;
        return roundGrid(top - spanT * pos);
      });
      // Grid ladder: strictly descending by ≥ MIN_GAP, inside the band.
      out[0] = clamp(out[0], bandMin, bandMax);
      for (let i = 1; i < n; i++) {
        out[i] = Math.min(out[i], roundGrid(out[i - 1] - MIN_GAP));
      }
      if (out[n - 1] < bandMin) {
        out[n - 1] = bandMin;
        for (let i = n - 2; i >= 0; i--) {
          out[i] = Math.max(out[i], roundGrid(out[i + 1] + MIN_GAP));
        }
        out[0] = Math.min(out[0], bandMax);
      }
      out = out.map((v) => clamp(roundGrid(v), bandMin, bandMax));
    }

    for (let i = 0; i < n; i++) {
      // Epsilon compare — overflow fills are unrounded (see settleScores).
      if (Math.abs(out[i] - rows[i].score) > 1e-9) {
        changes.push({ restaurantId: rows[i].restaurantId, score: out[i] });
      }
    }
  }
  return changes;
}

/** Map settle changes onto a ratings array (immutable). */
export function applySettleChanges(
  all: RestaurantRating[],
  changes: SettleChange[],
): RestaurantRating[] {
  if (changes.length === 0) return all;
  const byId = new Map(changes.map((c) => [c.restaurantId, c.score]));
  return all.map((r) => {
    const next = byId.get(r.restaurantId);
    return next === undefined || next === r.score ? r : { ...r, score: next };
  });
}
