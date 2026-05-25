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
  score: number;
}

export interface H2HStep {
  pickedNew: boolean;
  comparisonId: string;
  prevLo: number;
  prevHi: number;
  prevUpper: number;
  prevLower: number;
}

export interface H2HState {
  tier: Tier;
  candidates: H2HCandidate[];
  lo: number;
  hi: number;
  upperBound: number;
  lowerBound: number;
  history: H2HStep[];
  /** Set by applyTie — score is forced to the tie partner's score. */
  tieScore: number | null;
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
    history: [],
    tieScore: null,
    initialPoolSize: candidates.length,
  };
}

export function pickComparison(state: H2HState): H2HCandidate | null {
  if (state.tieScore !== null) return null;
  if (state.lo > state.hi) return null;
  const mid = Math.floor((state.lo + state.hi) / 2);
  return state.candidates[mid] ?? null;
}

export function applyChoice(state: H2HState, pickedNew: boolean): H2HState {
  if (state.tieScore !== null || state.lo > state.hi) return state;
  const mid = Math.floor((state.lo + state.hi) / 2);
  const comp = state.candidates[mid];
  if (!comp) return state;
  const step: H2HStep = {
    pickedNew,
    comparisonId: comp.restaurantId,
    prevLo: state.lo,
    prevHi: state.hi,
    prevUpper: state.upperBound,
    prevLower: state.lowerBound,
  };
  if (pickedNew) {
    // New restaurant beat the comparison → new is above comp.score
    return {
      ...state,
      lowerBound: Math.max(state.lowerBound, comp.score),
      hi: mid - 1,
      history: [...state.history, step],
    };
  }
  // Comparison beat the new restaurant → new is below comp.score
  return {
    ...state,
    upperBound: Math.min(state.upperBound, comp.score),
    lo: mid + 1,
    history: [...state.history, step],
  };
}

export function applyTie(state: H2HState): H2HState {
  if (state.lo > state.hi) return state;
  const mid = Math.floor((state.lo + state.hi) / 2);
  const comp = state.candidates[mid];
  if (!comp) return state;
  return { ...state, tieScore: comp.score };
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
    history: state.history.slice(0, -1),
    tieScore: null,
  };
}

export function isComplete(state: H2HState): boolean {
  if (state.tieScore !== null) return true;
  return state.lo > state.hi;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function computeFinalScore(state: H2HState): number {
  if (state.tieScore !== null) return Math.round(state.tieScore * 10) / 10;
  const { min, max } = tierRange(state.tier);
  // If the tier had zero candidates, settle on the tier midpoint instead of
  // (tier.min + tier.max) / 2 — same thing, but state.lower/upper are still
  // at the unmodified tier bounds so this falls out naturally.
  const raw = (state.upperBound + state.lowerBound) / 2;
  return Math.round(clamp(raw, min, max) * 10) / 10;
}

/**
 * How many comparisons we expect from the current state to completion.
 * Used to drive the progress bar — total = comparisons-made + estimated-remaining.
 */
export function estimateRemainingComparisons(state: H2HState): number {
  if (isComplete(state)) return 0;
  const remaining = state.hi - state.lo + 1;
  return Math.max(1, Math.ceil(Math.log2(remaining + 1)));
}

export function totalEstimatedComparisons(state: H2HState): number {
  return state.history.length + estimateRemainingComparisons(state);
}
