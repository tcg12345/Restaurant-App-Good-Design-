/**
 * Head-to-head (pairwise) rating algorithm.
 *
 * Pure logic — no React, no styling. The UI in RatingModal owns the
 * presentation; this module owns the binary-search bookkeeping that
 * turns a sequence of "which did you like better?" answers into a
 * single 0–10 score.
 */

import type { RestaurantRating } from '../contexts/ListsContext';

export type Tier = 'loved' | 'fine' | 'disliked';

export interface H2HCandidate {
  restaurantId: string;
  name: string;
  image: string;
  cuisine: string;
  price: string;
  address: string;
  notes: string;
  tags: string[];
  score: number;
}

export interface H2HStep {
  kind: 'choice' | 'tie';
  pickedNew?: boolean;
  comparisonId: string;
  comparisonIndex: number;
  prevLo: number;
  prevHi: number;
  prevUpper: number;
  prevLower: number;
  prevUpperFromComparison: boolean;
  prevLowerFromComparison: boolean;
  prevExcluded: number[];
  prevTiedScores: number[];
}

export interface H2HState {
  tier: Tier;
  candidates: H2HCandidate[];
  lo: number;
  hi: number;
  upperBound: number;
  lowerBound: number;
  /** True if `upperBound` was tightened by a real comparison (strict <). */
  upperBoundFromComparison: boolean;
  /** True if `lowerBound` was tightened by a real comparison (strict >). */
  lowerBoundFromComparison: boolean;
  /** Indices of candidates the user marked "too close to call". They get
   *  skipped by `pickComparison` but feed the fallback in `computeFinalScore`
   *  when nothing else narrowed the bounds. */
  excluded: number[];
  /** Scores of the tied candidates, in tie order — used to average a final
   *  score when no real comparison ever tightened the bounds. */
  tiedScores: number[];
  history: H2HStep[];
  /** Total candidates considered when the search started — used for progress. */
  initialPoolSize: number;
}

export const TIER_LABELS: Record<Tier, string> = {
  loved: 'Loved it',
  fine: 'It was fine',
  disliked: "Didn't like it",
};

export const TIER_EMOJI: Record<Tier, string> = {
  loved: '🤩',
  fine: '🙂',
  disliked: '😕',
};

export const TIER_BLURB: Record<Tier, string> = {
  loved: '8s–10s',
  fine: '5s–6s',
  disliked: '1s–3s',
};

export function tierRange(tier: Tier): { min: number; max: number } {
  if (tier === 'loved') return { min: 7.0, max: 10.0 };
  if (tier === 'fine') return { min: 4.0, max: 6.9 };
  return { min: 1.0, max: 3.9 };
}

function ratingToCandidate(r: RestaurantRating): H2HCandidate {
  return {
    restaurantId: r.restaurantId,
    name: r.name,
    image: r.image,
    cuisine: r.cuisine,
    price: r.price,
    address: r.address || '',
    notes: r.notes || '',
    tags: r.tags || [],
    score: r.score,
  };
}

export function initH2H(
  allRatings: RestaurantRating[],
  tier: Tier,
  excludeId?: string,
): H2HState {
  const { min, max } = tierRange(tier);
  const candidates = allRatings
    .filter((r) => r.restaurantId !== excludeId)
    .filter((r) => r.score >= min && r.score <= max)
    .sort((a, b) => b.score - a.score)
    .map(ratingToCandidate);
  return {
    tier,
    candidates,
    lo: 0,
    hi: candidates.length - 1,
    upperBound: max,
    lowerBound: min,
    upperBoundFromComparison: false,
    lowerBoundFromComparison: false,
    excluded: [],
    tiedScores: [],
    history: [],
    initialPoolSize: candidates.length,
  };
}

/** Init a tie-break H2H session: candidates are only the restaurants whose
 *  rounded score matches `targetScore`, and bounds are the neighbouring
 *  ratings' scores so the search can refine the final score slightly above
 *  or below the tied group. Returns null if there are no tied candidates —
 *  the caller should just save with the slider score in that case. */
export function initH2HTieBreak(
  allRatings: RestaurantRating[],
  targetScore: number,
  excludeId?: string,
): H2HState | null {
  const targetRounded = round1(targetScore);
  const others = allRatings.filter((r) => r.restaurantId !== excludeId);
  const tiedRaw = others
    .filter((r) => round1(r.score) === targetRounded)
    .sort((a, b) => b.score - a.score);
  if (tiedRaw.length === 0) return null;
  const candidates = tiedRaw.map(ratingToCandidate);

  // Neighbours: highest score strictly less than target, lowest score
  // strictly greater. Bound on each side gives the search room to spill the
  // final score above or below the tied group when the user clearly beat
  // or lost to all of them.
  const sortedDesc = [...others].sort((a, b) => b.score - a.score);
  const higher = sortedDesc.filter((r) => round1(r.score) > targetRounded);
  const lower = sortedDesc.filter((r) => round1(r.score) < targetRounded);
  const upperBound = higher.length > 0 ? higher[higher.length - 1].score : 10;
  const lowerBound = lower.length > 0 ? lower[0].score : 0;

  // Tier is only used by computeFinalScore's empty-init fallback (which we
  // don't hit here because tiedRaw is non-empty). Pick the tier containing
  // the target so the value is at least coherent if read elsewhere.
  const tier: Tier = targetRounded >= 7 ? 'loved' : targetRounded >= 4 ? 'fine' : 'disliked';

  return {
    tier,
    candidates,
    lo: 0,
    hi: candidates.length - 1,
    upperBound,
    lowerBound,
    upperBoundFromComparison: false,
    lowerBoundFromComparison: false,
    excluded: [],
    tiedScores: [],
    history: [],
    initialPoolSize: candidates.length,
  };
}

/** Return the next index to compare against, or null when nothing valid
 *  remains in [lo, hi]. Walks outward from the midpoint so we keep the
 *  search balanced even after several ties have eaten into the window. */
function pickComparisonIndex(state: H2HState): number | null {
  if (state.lo > state.hi) return null;
  const target = Math.floor((state.lo + state.hi) / 2);
  const excludedSet = new Set(state.excluded);
  const span = state.hi - state.lo;
  for (let offset = 0; offset <= span; offset++) {
    const candidates = offset === 0 ? [target] : [target - offset, target + offset];
    for (const idx of candidates) {
      if (idx < state.lo || idx > state.hi) continue;
      if (!excludedSet.has(idx)) return idx;
    }
  }
  return null;
}

export function pickComparison(state: H2HState): H2HCandidate | null {
  const idx = pickComparisonIndex(state);
  if (idx === null) return null;
  return state.candidates[idx] ?? null;
}

export function applyChoice(state: H2HState, pickedNew: boolean): H2HState {
  const mid = pickComparisonIndex(state);
  if (mid === null) return state;
  const comp = state.candidates[mid];
  if (!comp) return state;
  const step: H2HStep = {
    kind: 'choice',
    pickedNew,
    comparisonId: comp.restaurantId,
    comparisonIndex: mid,
    prevLo: state.lo,
    prevHi: state.hi,
    prevUpper: state.upperBound,
    prevLower: state.lowerBound,
    prevUpperFromComparison: state.upperBoundFromComparison,
    prevLowerFromComparison: state.lowerBoundFromComparison,
    prevExcluded: state.excluded,
    prevTiedScores: state.tiedScores,
  };
  if (pickedNew) {
    // New restaurant beat the comparison → new is strictly above comp.score
    const newLower = Math.max(state.lowerBound, comp.score);
    return {
      ...state,
      lowerBound: newLower,
      lowerBoundFromComparison: true,
      hi: mid - 1,
      history: [...state.history, step],
    };
  }
  // Comparison beat the new restaurant → new is strictly below comp.score
  const newUpper = Math.min(state.upperBound, comp.score);
  return {
    ...state,
    upperBound: newUpper,
    upperBoundFromComparison: true,
    lo: mid + 1,
    history: [...state.history, step],
  };
}

export function applyTie(state: H2HState): H2HState {
  const mid = pickComparisonIndex(state);
  if (mid === null) return state;
  const comp = state.candidates[mid];
  if (!comp) return state;
  const step: H2HStep = {
    kind: 'tie',
    comparisonId: comp.restaurantId,
    comparisonIndex: mid,
    prevLo: state.lo,
    prevHi: state.hi,
    prevUpper: state.upperBound,
    prevLower: state.lowerBound,
    prevUpperFromComparison: state.upperBoundFromComparison,
    prevLowerFromComparison: state.lowerBoundFromComparison,
    prevExcluded: state.excluded,
    prevTiedScores: state.tiedScores,
  };
  return {
    ...state,
    excluded: [...state.excluded, mid],
    tiedScores: [...state.tiedScores, comp.score],
    history: [...state.history, step],
  };
}

export function undoLastChoice(state: H2HState): H2HState {
  if (state.history.length === 0) return state;
  const last = state.history[state.history.length - 1];
  return {
    ...state,
    lo: last.prevLo,
    hi: last.prevHi,
    upperBound: last.prevUpper,
    lowerBound: last.prevLower,
    upperBoundFromComparison: last.prevUpperFromComparison,
    lowerBoundFromComparison: last.prevLowerFromComparison,
    excluded: last.prevExcluded,
    tiedScores: last.prevTiedScores,
    history: state.history.slice(0, -1),
  };
}

export function isComplete(state: H2HState): boolean {
  return pickComparisonIndex(state) === null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function computeFinalScore(state: H2HState): number {
  // All-ties fallback: no real comparison ever tightened a bound, so use the
  // average of the tied scores — that's the best signal the user gave us.
  if (
    !state.upperBoundFromComparison &&
    !state.lowerBoundFromComparison &&
    state.tiedScores.length > 0
  ) {
    const avg = state.tiedScores.reduce((s, x) => s + x, 0) / state.tiedScores.length;
    return clamp(round1(avg), 0, 10);
  }

  const raw = (state.upperBound + state.lowerBound) / 2;
  let rounded = round1(raw);

  // Strict-bound nudge: when a bound came from a real comparison the user
  // told us the new restaurant is strictly above/below that score. If the
  // average rounded right onto the bound it would tie with that comparison
  // and sort against the H2H result — push it off by 0.1 in the correct
  // direction. Allow spill outside the tier (e.g. a "loved" rating that
  // lost to everything can land at 6.9) because that's the honest outcome.
  if (state.upperBoundFromComparison && rounded >= state.upperBound) {
    rounded = round1(state.upperBound - 0.1);
  } else if (state.lowerBoundFromComparison && rounded <= state.lowerBound) {
    rounded = round1(state.lowerBound + 0.1);
  }

  return clamp(rounded, 0, 10);
}

/**
 * How many comparisons we expect from the current state to completion.
 * Used to drive the progress bar — total = comparisons-made + estimated-remaining.
 */
export function estimateRemainingComparisons(state: H2HState): number {
  if (isComplete(state)) return 0;
  const excludedSet = new Set(state.excluded);
  let remaining = 0;
  for (let i = state.lo; i <= state.hi; i++) {
    if (!excludedSet.has(i)) remaining += 1;
  }
  return Math.max(1, Math.ceil(Math.log2(remaining + 1)));
}

export function totalEstimatedComparisons(state: H2HState): number {
  return state.history.length + estimateRemainingComparisons(state);
}
