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
/** Spacing a mature tier relaxes toward. 3.0 band / 0.3 = 10 gaps, so a tier
 *  reaches full spread right around the same count it reaches maturity. */
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
  /** The row's previous score when re-rating — the departed tier settles too. */
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
 * Settle one tier's rows (already ordered desc) — a constraint PROJECTION,
 * not a continuous relaxation, so it is idempotent: once the constraints
 * hold, settling again changes nothing.
 *
 *  - Every adjacent gap is floored at gapFloor(f) = MIN_GAP + f·(PREFERRED_GAP
 *    − MIN_GAP): tight clumps stretch apart as the tier matures, while gaps
 *    already wider than the floor are kept verbatim (ratios preserved, never
 *    uniformed).
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
  const gapFloor = MIN_GAP + f * (PREFERRED_GAP - MIN_GAP);

  // Floor the gaps; keep anything wider untouched (gap ratios survive).
  // The one-grid-step tolerance is what keeps repeated settles idempotent:
  // a gap this projection floored last pass, then rounded onto the 0.01
  // grid while building the ladder, can sit a step under the floor — re-
  // flooring it every pass would wiggle the layout forever.
  const applyFloor = (fl: number): { gaps: number[]; span: number } => {
    const gs: number[] = [];
    let sp = 0;
    for (let i = 0; i < n - 1; i++) {
      const raw = Math.max(0, s[i] - s[i + 1]);
      const g = raw >= fl - MIN_GAP - 1e-9 ? Math.max(raw, MIN_GAP) : fl;
      gs.push(g);
      sp += g;
    }
    return { gaps: gs, span: sp };
  };

  let { gaps, span } = applyFloor(gapFloor);
  if (span > W + 1e-9) {
    // The floored ladder can't fit. DEGRADE THE FLOOR toward MIN_GAP
    // rather than compressing everything proportionally: the user's real
    // gaps always fit (they came from in-band scores), so crowding should
    // cost the aesthetic spacing — never the gap ratios. (The old
    // proportional compression also wasn't a projection: each settle
    // shrank the wide gaps a little more, and only the coarse 0.1 grid's
    // rounding froze the decay. The 0.01 grid absorbs nothing, so the
    // fitting floor must be found, not approximated.)
    let lo = MIN_GAP;
    let hi = gapFloor;
    for (let iter = 0; iter < 40; iter++) {
      const mid = (lo + hi) / 2;
      if (applyFloor(mid).span > W + 1e-9) hi = mid;
      else lo = mid;
    }
    // Quantize the found floor DOWN to the grid so a hair of pass-to-pass
    // input wiggle can't flip it to a different value.
    const fq = Math.max(MIN_GAP, Math.floor(lo * 100) / 100);
    ({ gaps, span } = applyFloor(fq));
    if (span > W + 1e-9) {
      // Even MIN_GAP floors beside the verbatim wide gaps don't fit — the
      // tier is at genuine capacity pressure (raw span ≈ the whole band
      // plus tied rows). Snap to a GRID uniform fill: it depends only on
      // (n, band), so settling the result again reproduces it exactly —
      // proportional compression here would shave the wide gaps a little
      // more on every settle instead of reaching a fixed point.
      const fill = new Array<number>(n);
      for (let i = 0; i < n; i++) fill[i] = roundGrid(bandMax - (i * W) / (n - 1));
      for (let i = 1; i < n; i++) fill[i] = Math.min(fill[i], roundGrid(fill[i - 1] - MIN_GAP));
      if (fill[n - 1] < bandMin) {
        fill[n - 1] = bandMin;
        for (let i = n - 2; i >= 0; i--) fill[i] = Math.max(fill[i], roundGrid(fill[i + 1] + MIN_GAP));
      }
      return fill;
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
  return out.map((v) => clamp(roundGrid(v), bandMin, bandMax));
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
  } else if (justRated) {
    tiersToSettle.add(tierOfScore(justRated.score));
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
    const settled = settleTierScores(rows, tier);
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
