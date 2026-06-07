/**
 * Head-to-head (pairwise) rating algorithm.
 *
 * Pure logic — no React, no styling. The UI in RatingModal owns the
 * presentation; this module owns the binary-search bookkeeping that
 * turns a sequence of "which did you like better?" answers into a
 * single 0–10 score.
 */

import type { RestaurantRating } from '../contexts/ListsContext';
import {
  computeSimilarity,
  NEUTRAL_SIMILARITY,
  PEER_SIMILARITY_THRESHOLD,
  type SimilarityInput,
} from './restaurantSimilarity';

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
  /** Geo/locality, resolved lazily from restaurant meta when available.
   *  Used only to score similarity — absent fields degrade gracefully. */
  lat?: number;
  lng?: number;
  neighborhood?: string;
}

/** Resolver that maps a candidate's id to its geo/locality metadata, so the
 *  similarity engine can use coordinates the rating rows don't carry. */
export type CandidateMetaResolver = (
  restaurantId: string,
) => { lat?: number; lng?: number; neighborhood?: string; address?: string } | undefined;

/* ── Similarity-aware selection tunables ───────────────────────────────── */

/** Max real comparisons (choices + ties) before we finalize by interpolation. */
export const DEFAULT_BUDGET = 6;
/** Effectively no cap — used by the tie-break flow to preserve old behavior. */
export const UNLIMITED_BUDGET = Number.POSITIVE_INFINITY;
/** Selection weight on information-gain ramps from MIN (relevance-led, early)
 *  to MAX (convergence-led, late) as the search progresses. */
export const W_INFO_MIN = 0.35;
export const W_INFO_MAX = 0.9;
/** Rounds at which the schedule's round-progress signal saturates. */
export const SCHEDULE_ROUNDS_FULL = 4;
/** How hard a budget-capped final score is pulled toward the peer prior. */
export const PEER_PULL = 0.25;
/** At the very first comparison this fraction of the relevance signal comes
 *  purely from location, so opening matchups are dominated by "same area"
 *  before cuisine/price/tags weigh in. Decays to 0 as the search converges. */
export const LOCATION_EARLY_BIAS = 0.6;

const EPS = 1e-9;

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
  /** The restaurant being placed, as similarity attributes. Null in the
   *  tie-break flow → every candidate scores NEUTRAL (pure bisection). */
  target: SimilarityInput | null;
  /** Per-candidate similarity to `target`, index-aligned to `candidates`,
   *  each in [0,1]. Computed once at init; constant for the session. */
  similarity: number[];
  /** Per-candidate location sub-score, index-aligned to `candidates`. Falls
   *  back to the overall similarity when a candidate has no location signal,
   *  so unknown-location rows are neither boosted nor penalized. Lets early
   *  comparisons emphasize location specifically. */
  locationScores: number[];
  /** Max comparisons before finalizing by interpolation (ties count). */
  budget: number;
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

/** Fill in coords/neighborhood (and a better address) from the meta resolver
 *  when available — the rating rows don't carry geo data. */
function enrichCandidate(c: H2HCandidate, resolveMeta?: CandidateMetaResolver): H2HCandidate {
  if (!resolveMeta) return c;
  const meta = resolveMeta(c.restaurantId);
  if (!meta) return c;
  return {
    ...c,
    lat: meta.lat,
    lng: meta.lng,
    neighborhood: meta.neighborhood,
    address: c.address || meta.address || '',
  };
}

function candidateToInput(c: H2HCandidate): SimilarityInput {
  return {
    cuisine: c.cuisine,
    price: c.price,
    address: c.address,
    neighborhood: c.neighborhood,
    lat: c.lat,
    lng: c.lng,
    tags: c.tags,
  };
}

/** Per-candidate overall similarity and location sub-score. With no target
 *  (tie-break flow) both are flat-neutral, making selection pure bisection.
 *  A candidate with no location signal gets its overall similarity as the
 *  location score, so it isn't boosted or penalized by the early location bias. */
function computeRelevance(
  target: SimilarityInput | null,
  candidates: H2HCandidate[],
): { similarity: number[]; locationScores: number[] } {
  if (!target) {
    const flat = candidates.map(() => NEUTRAL_SIMILARITY);
    return { similarity: flat, locationScores: [...flat] };
  }
  const similarity: number[] = [];
  const locationScores: number[] = [];
  for (const c of candidates) {
    const r = computeSimilarity(target, candidateToInput(c));
    similarity.push(r.score);
    locationScores.push(r.present.location ? r.parts.location ?? r.score : r.score);
  }
  return { similarity, locationScores };
}

export function initH2H(
  allRatings: RestaurantRating[],
  tier: Tier,
  excludeId?: string,
  target?: SimilarityInput,
  resolveMeta?: CandidateMetaResolver,
  budget: number = DEFAULT_BUDGET,
): H2HState {
  const { min, max } = tierRange(tier);
  const candidates = allRatings
    .filter((r) => r.restaurantId !== excludeId)
    .filter((r) => r.score >= min && r.score <= max)
    .sort((a, b) => b.score - a.score)
    .map(ratingToCandidate)
    .map((c) => enrichCandidate(c, resolveMeta));
  const { similarity, locationScores } = computeRelevance(target ?? null, candidates);
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
    target: target ?? null,
    similarity,
    locationScores,
    budget,
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
    // No similarity target: every candidate scores neutral, so selection is
    // pure bisection and the budget never bites — identical to the original
    // tie-break behavior.
    target: null,
    similarity: candidates.map(() => NEUTRAL_SIMILARITY),
    locationScores: candidates.map(() => NEUTRAL_SIMILARITY),
    budget: UNLIMITED_BUDGET,
  };
}

/** In-window, non-excluded candidate indices, in ascending order. */
function activeIndices(state: H2HState): number[] {
  const excludedSet = new Set(state.excluded);
  const out: number[] = [];
  for (let i = state.lo; i <= state.hi; i++) {
    if (!excludedSet.has(i)) out.push(i);
  }
  return out;
}

/** Median index of the peer cohort across the whole pool — used once, at the
 *  first comparison, to open near where similar restaurants already sit in the
 *  tier's sorted list. Returns null when there are no peers. */
function peerSeedIndex(state: H2HState): number | null {
  const peers: number[] = [];
  for (let i = state.lo; i <= state.hi; i++) {
    if ((state.similarity[i] ?? NEUTRAL_SIMILARITY) >= PEER_SIMILARITY_THRESHOLD) peers.push(i);
  }
  if (peers.length === 0) return null;
  return peers[Math.floor((peers.length - 1) / 2)]; // lower median (deterministic)
}

/** How far the search has progressed, in [0,1]: the max of round-count and
 *  window-shrinkage signals. Drives both the info/relevance balance and the
 *  early location bias. 0 = just started (relevance- and location-led), 1 =
 *  converging (information-gain-led). */
function selectionProgress(state: H2HState): number {
  const roundProgress = clamp(state.history.length / SCHEDULE_ROUNDS_FULL, 0, 1);
  const countInWindow = activeIndices(state).length;
  const denom = Math.max(1, state.initialPoolSize - 1);
  const windowProgress = 1 - clamp((countInWindow - 1) / denom, 0, 1);
  return Math.max(roundProgress, windowProgress);
}

/** Weight on information-gain vs. relevance. Ramps toward MAX as the search
 *  progresses, so early asks are relevant and late asks converge. */
function infoWeight(progress: number): number {
  return W_INFO_MIN + (W_INFO_MAX - W_INFO_MIN) * progress;
}

/**
 * Choose the next index to compare against. Among in-window, non-excluded
 * candidates we maximize `w_info·informationGain + w_relevance·relevance`,
 * where `relevance` blends overall similarity with a location-only term that
 * dominates early (so opening matchups favor the same area) and fades as the
 * search converges. Information gain peaks at the (integer) window midpoint, so
 * selection never prunes the window — it only picks *which* in-window item to
 * ask about, keeping the binary-search correctness invariant intact (every
 * answer still moves exactly one boundary). With neutral/uniform similarity
 * this reduces to the classic midpoint walk. Returns null when nothing remains.
 */
function pickComparisonIndex(state: H2HState): number | null {
  if (state.lo > state.hi) return null;
  const idxs = activeIndices(state);
  if (idxs.length === 0) return null;

  // Center information gain on the geometric midpoint, except on the very
  // first comparison, where we seed near the peer cohort's central position.
  const seed = state.history.length === 0 ? peerSeedIndex(state) : null;
  const center = seed ?? Math.floor((state.lo + state.hi) / 2);
  const half = Math.max(1, (state.hi - state.lo) / 2);

  const progress = selectionProgress(state);
  const wInfo = infoWeight(progress);
  const wRel = 1 - wInfo;
  // Early on, most of the relevance signal is pure location; this decays to 0.
  const locBias = LOCATION_EARLY_BIAS * (1 - progress);

  let best = idxs[0];
  let bestScore = -Infinity;
  let bestInfo = -Infinity;
  for (const i of idxs) {
    const info = clamp(1 - Math.abs(i - center) / half, 0, 1);
    const sim = state.similarity[i] ?? NEUTRAL_SIMILARITY;
    const loc = state.locationScores[i] ?? sim;
    const rel = locBias * loc + (1 - locBias) * sim;
    const s = wInfo * info + wRel * rel;
    // Deterministic preference: higher blended score, then higher info gain
    // (closer to center), then lower index.
    const better =
      s > bestScore + EPS ||
      (Math.abs(s - bestScore) <= EPS && info > bestInfo + EPS);
    if (better) {
      best = i;
      bestScore = s;
      bestInfo = info;
    }
  }
  return best;
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
  return pickComparisonIndex(state) === null || state.history.length >= state.budget;
}

/** Peer indices to anchor a budget-capped final score. Prefers peers still
 *  inside the live window; falls back to all peers when none remain. */
function peerIndicesForFinalize(state: H2HState): number[] {
  const excludedSet = new Set(state.excluded);
  const inWindow: number[] = [];
  const all: number[] = [];
  for (let i = 0; i < state.candidates.length; i++) {
    if ((state.similarity[i] ?? NEUTRAL_SIMILARITY) >= PEER_SIMILARITY_THRESHOLD) {
      all.push(i);
      if (i >= state.lo && i <= state.hi && !excludedSet.has(i)) inWindow.push(i);
    }
  }
  return inWindow.length > 0 ? inWindow : all;
}

/** When the budget runs out with the window still open, place the score
 *  between the bounding remaining candidates (clamped to the comparison-derived
 *  envelope), optionally pulled toward the peer prior. */
function interpolateOpenWindow(state: H2HState): number {
  // Candidates are sorted desc: candidates[lo] is the highest-scored item
  // still above the new restaurant's slot, candidates[hi] the lowest below.
  const upperNeighbor = state.candidates[state.lo]?.score ?? state.upperBound;
  const lowerNeighbor = state.candidates[state.hi]?.score ?? state.lowerBound;
  const upper = Math.min(state.upperBound, upperNeighbor);
  const lower = Math.max(state.lowerBound, lowerNeighbor);
  const hiV = Math.max(upper, lower);
  const loV = Math.min(upper, lower);

  let raw = (hiV + loV) / 2;
  const peers = peerIndicesForFinalize(state);
  if (peers.length > 0) {
    const mean = peers.reduce((s, i) => s + state.candidates[i].score, 0) / peers.length;
    raw = (1 - PEER_PULL) * raw + PEER_PULL * mean;
  }
  return clamp(raw, loV, hiV);
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

  // Budget exhausted with the window still open: interpolate between the
  // bounding remaining candidates rather than the (still-wide) tier bounds.
  const windowOpen = activeIndices(state).length > 0;
  const raw =
    windowOpen && state.history.length >= state.budget
      ? interpolateOpenWindow(state)
      : (state.upperBound + state.lowerBound) / 2;
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
  const remaining = activeIndices(state).length;
  const est = Math.max(1, Math.ceil(Math.log2(remaining + 1)));
  // Never promise more comparisons than the budget allows.
  const budgetLeft = Math.max(0, state.budget - state.history.length);
  return Math.min(est, budgetLeft);
}

export function totalEstimatedComparisons(state: H2HState): number {
  return state.history.length + estimateRemainingComparisons(state);
}
