/**
 * Head-to-head (pairwise) rating algorithm.
 *
 * Pure logic — no React, no styling. The UI in AddRestaurantModal owns the
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

/** BIAS budget — how many real answers (choices + ties) may use similarity-
 *  biased (off-midpoint) pivots. It does NOT end the session: the search
 *  always continues until every candidate left inside the window has been
 *  shown (decisively answered, tied, or skipped), so a placement can never
 *  sit between two restaurants the user was never asked about. Once the
 *  budget is spent, `pickComparisonIndex`'s guard falls back to pure midpoint
 *  bisection, keeping the decisive-answer count near ceil(log2(pool)) —
 *  8 covers pools up to 2^8−1 = 255. Ties/skips each add one extra question. */
export const DEFAULT_BUDGET = 8;
/** No bias cap — used by the tie-break flow (pure bisection anyway). */
export const UNLIMITED_BUDGET = Number.POSITIVE_INFINITY;
/** Pivots may only come from this centered fraction of the live window, so
 *  every answer is guaranteed to cut the window by at least ~25%. Never pick
 *  outside it (no matter how similar a candidate is) — a degenerate answer
 *  sequence could otherwise blow the comparison count past the budget. */
export const MIDDLE_BAND_FRACTION = 0.5;
/** Warm start: for the first comparisons, when the user has a real peer
 *  cohort, widen the pivot band so an especially relevant opponent slightly
 *  off-center is reachable. Still bounded — worst case ~10% cut per answer
 *  for at most WARM_START_COMPARISONS rounds, and only when the budget guard
 *  says we can afford it. */
export const WARM_START_BAND_FRACTION = 0.8;
export const WARM_START_COMPARISONS = 2;
export const WARM_START_MIN_PEERS = 5;
/** Windows at or below this size just bisect — biasing buys nothing there. */
export const SMALL_WINDOW_SIZE = 4;
/** Rounds at which the schedule's round-progress signal saturates. */
export const SCHEDULE_ROUNDS_FULL = 4;
/** How hard a budget-capped final score is pulled toward the peer prior. */
export const PEER_PULL = 0.25;
/** How hard "too close to call" pivots pull the final score toward their
 *  average. A tie says "about equal to this one" — strong local evidence,
 *  but later decisive answers (strict bounds) always cap the pull. */
export const TIE_PULL = 0.5;
/** At the very first comparison this fraction of the relevance signal comes
 *  purely from location, so opening matchups are dominated by "same area"
 *  before cuisine/price/tags weigh in. Decays to 0 as the search converges. */
export const LOCATION_EARLY_BIAS = 0.6;

const EPS = 1e-9;

export interface H2HStep {
  kind: 'choice' | 'tie' | 'skip';
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
  /** Indices of candidates set aside mid-search — "too close to call"
   *  ties and skips. pickComparison won't show them again. */
  excluded: number[];
  /** Scores of the "too close to call" candidates, in tie order. A tie is
   *  SOFT evidence, not a stop: the search continues with other candidates
   *  and these scores pull the final placement toward the tied pivots
   *  (they're the whole answer only when nothing decisive was ever said). */
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
  /** Bias budget: real answers that may use similarity-biased pivots. Never
   *  ends the session — see DEFAULT_BUDGET. */
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

export function tierRange(tier: Tier): { min: number; max: number } {
  if (tier === 'loved') return { min: 7.0, max: 10.0 };
  if (tier === 'fine') return { min: 4.0, max: 6.9 };
  return { min: 1.0, max: 3.9 };
}

/** Deterministic order for equal scores, so the same inputs always produce
 *  the same candidate list (and therefore the same comparison sequence). */
function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
    .sort((a, b) => b.score - a.score || byId(a.restaurantId, b.restaurantId))
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
    .sort((a, b) => b.score - a.score || byId(a.restaurantId, b.restaurantId));
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

/** Count of peers (similarity ≥ threshold) across the whole pool — gates the
 *  warm start: with a real cohort of similar restaurants, the first couple of
 *  comparisons may search a wider band to reach an especially relevant one. */
function peerCount(state: H2HState): number {
  let n = 0;
  for (const s of state.similarity) {
    if (s >= PEER_SIMILARITY_THRESHOLD) n++;
  }
  return n;
}

/** How far the search has progressed, in [0,1]: the max of round-count and
 *  window-shrinkage signals. Drives the early location bias. 0 = just started
 *  (location-led matchups), 1 = converging (overall similarity only). */
function selectionProgress(state: H2HState): number {
  const roundProgress = clamp(comparisonsMade(state) / SCHEDULE_ROUNDS_FULL, 0, 1);
  const countInWindow = activeIndices(state).length;
  const denom = Math.max(1, state.initialPoolSize - 1);
  const windowProgress = 1 - clamp((countInWindow - 1) / denom, 0, 1);
  return Math.max(roundProgress, windowProgress);
}

/**
 * Choose the next index to compare against — binary search structure with a
 * similarity-biased pivot.
 *
 * Instead of always probing the exact midpoint, we consider the candidates in
 * the centered middle band of the live window (middle 50%; middle 80% for the
 * first couple of comparisons when a peer cohort exists) and pick the most
 * *relevant* one — overall similarity blended with a location term that
 * dominates early and fades as the search converges. Ties break by proximity
 * to the true midpoint, then by lower index, so selection is deterministic
 * and flat similarity reduces exactly to the classic midpoint walk.
 *
 * Two hard guardrails keep the binary search honest:
 *  - The pivot NEVER leaves the middle band, no matter how similar an edge
 *    candidate is — every answer cuts the window by at least the band margin.
 *  - A budget guard only allows off-midpoint pivots while the remaining
 *    bias budget still covers the worst-case window they could leave behind;
 *    otherwise we fall back to the exact midpoint. Biasing can therefore
 *    never inflate the decisive-answer count past what plain bisection
 *    needs, and the final position is identical to plain binary search.
 *
 * Selection only picks *which* in-window item to ask about — it never prunes
 * the window itself, so every answer still moves exactly one boundary and
 * placement correctness is preserved by construction. Returns null when
 * nothing valid remains.
 */
function pickComparisonIndex(state: H2HState): number | null {
  if (state.lo > state.hi) return null;
  const idxs = activeIndices(state);
  if (idxs.length === 0) return null;

  const mid = Math.floor((state.lo + state.hi) / 2);
  const span = state.hi - state.lo + 1;
  const made = comparisonsMade(state);
  const budgetLeft = state.budget - made;

  if (span > SMALL_WINDOW_SIZE) {
    const warm = made < WARM_START_COMPARISONS && peerCount(state) >= WARM_START_MIN_PEERS;
    // Try the widest affordable band: warm-start band first (when active),
    // then the standard middle band.
    const fractions = warm
      ? [WARM_START_BAND_FRACTION, MIDDLE_BAND_FRACTION]
      : [MIDDLE_BAND_FRACTION];
    for (const bandFraction of fractions) {
      const margin = Math.floor((span * (1 - bandFraction)) / 2);
      const bandLo = state.lo + margin;
      const bandHi = state.hi - margin;
      // Budget guard: the worst case after an off-midpoint pivot is the larger
      // side of the most off-center pick in the band. Only bias while the
      // remaining budget can still bisect that window to completion.
      const worstRemaining = Math.max(bandHi - state.lo, state.hi - bandLo);
      const worstStepsAfter = Math.ceil(Math.log2(worstRemaining + 1));
      if (budgetLeft - 1 < worstStepsAfter) continue; // too wide — try narrower
      const progress = selectionProgress(state);
      // Early on, most of the relevance signal is pure location; decays to 0.
      const locBias = LOCATION_EARLY_BIAS * (1 - progress);
      let best = -1;
      let bestRel = -Infinity;
      let bestDist = Infinity;
      for (const i of idxs) {
        if (i < bandLo || i > bandHi) continue;
        const sim = state.similarity[i] ?? NEUTRAL_SIMILARITY;
        const loc = state.locationScores[i] ?? sim;
        const rel = locBias * loc + (1 - locBias) * sim;
        const dist = Math.abs(i - mid);
        // Deterministic: higher relevance, then closer to the midpoint, then
        // lower index (idxs are ascending, so first-seen wins remaining ties).
        const better =
          rel > bestRel + EPS || (Math.abs(rel - bestRel) <= EPS && dist < bestDist);
        if (better) {
          best = i;
          bestRel = rel;
          bestDist = dist;
        }
      }
      if (best !== -1) return best;
      // Whole band excluded by ties/skips (a narrower band would be too) —
      // fall through to the midpoint walk.
      break;
    }
  }

  // Plain bisection: walk outward from the midpoint, skipping excluded.
  const excludedSet = new Set(state.excluded);
  for (let offset = 0; offset <= state.hi - state.lo; offset++) {
    const probes = offset === 0 ? [mid] : [mid - offset, mid + offset];
    for (const idx of probes) {
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
  // "Too close to call" is soft evidence, not a stop: the new restaurant
  // sits somewhere near this pivot, but the user couldn't split them — so
  // set the pivot aside and KEEP ASKING. Later decisive answers narrow the
  // window as usual, and the tied score pulls the final placement toward
  // the pivot (see computeFinalScore). Ties consume budget (they're real
  // questions answered), so an all-ties session still terminates.
  return {
    ...state,
    excluded: [...state.excluded, mid],
    tiedScores: [...state.tiedScores, comp.score],
    history: [...state.history, step],
  };
}

/** Skip the current comparison: the user can't (or doesn't want to) judge it.
 *  Unlike a tie this carries NO signal at all — the candidate is dropped from
 *  the pickable set so a different one is shown, but it neither pulls the
 *  score (ties do) nor consumes the comparison budget. Undoable. */
export function applySkip(state: H2HState): H2HState {
  const mid = pickComparisonIndex(state);
  if (mid === null) return state;
  const comp = state.candidates[mid];
  if (!comp) return state;
  const step: H2HStep = {
    kind: 'skip',
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

/** Number of real comparisons answered so far (choices + ties). Skips don't
 *  count — they carry no signal and don't consume the budget. */
export function comparisonsMade(state: H2HState): number {
  let n = 0;
  for (const s of state.history) if (s.kind !== 'skip') n++;
  return n;
}

/** The session ends ONLY when no un-shown candidate remains inside the
 *  window — every answer strictly shrinks the pickable set (a choice moves a
 *  boundary past the pivot; a tie/skip excludes it), so this always
 *  terminates, and at completion every candidate still between the bounds
 *  was directly shown to the user. The budget never cuts a search short. */
export function isComplete(state: H2HState): boolean {
  return pickComparisonIndex(state) === null;
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

/** When the window still spans candidates at completion — which can only
 *  mean every one of them was tied or skipped by the user — place the score
 *  between the bounding leftover candidates (clamped to the comparison-derived
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
  // All-ties fallback: no real comparison ever tightened a bound, so the
  // average of the tied scores is the best signal the user gave us.
  if (
    !state.upperBoundFromComparison &&
    !state.lowerBoundFromComparison &&
    state.tiedScores.length > 0
  ) {
    const avg = state.tiedScores.reduce((s, x) => s + x, 0) / state.tiedScores.length;
    return clamp(round1(avg), 0, 10);
  }

  // Tied/skipped candidates remain between real comparison bounds: anchor
  // between the bounding leftover candidates (clamped by the strict bounds)
  // rather than the wider bound midpoint. The comparison-derived-bound gate
  // matters: an all-skips session has no bounds and no tie signal, and must
  // fall through to the tier midpoint below.
  let raw =
    state.lo <= state.hi &&
    (state.upperBoundFromComparison || state.lowerBoundFromComparison)
      ? interpolateOpenWindow(state)
      : (state.upperBound + state.lowerBound) / 2;
  // "Too close to call" pivots pull the placement toward their average —
  // the user said the new restaurant sits ABOUT there, and the comparisons
  // that followed only bracketed it. Decisive answers still rule: the pull
  // is clamped inside the strict comparison-derived bounds.
  if (state.tiedScores.length > 0) {
    const tieAvg = state.tiedScores.reduce((s, x) => s + x, 0) / state.tiedScores.length;
    raw = (1 - TIE_PULL) * raw + TIE_PULL * tieAvg;
    const boundLo = Math.min(state.lowerBound, state.upperBound);
    const boundHi = Math.max(state.lowerBound, state.upperBound);
    raw = clamp(raw, boundLo, boundHi);
  }
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
 * The exact descending order a completed search implies: every candidate id
 * with the new restaurant inserted at its resolved slot.
 *
 * This is the search's REAL result — the final 0-10 number is derived from it
 * and can collide with a neighbor's score when the bracketing gap is only one
 * display step (beat the 9.7, lost to the 9.8 → lands ON 9.7). Feeding this
 * order into the settle pass as `explicitOrder` keeps the ranking faithful
 * through such collisions: the beaten neighbor (and the block below it)
 * shifts DOWN to make room instead of the new arrival being sorted under
 * the very restaurant it just beat.
 *
 *  - Closed window (lo > hi) → exact: everything above `lo` beat the new
 *    item, everything from `lo` down lost to it. ("Too close to call"
 *    pivots were set aside without moving the window; the tie-pulled final
 *    score decides which side of them the new item lands on.)
 *  - Open window at completion → every index inside [lo..hi] was tied or
 *    skipped by the user (never-shown candidates can't remain — isComplete
 *    requires the pickable set to be empty); they order against the
 *    anchored final score.
 */
export function placementOrder(
  state: H2HState,
  newId: string,
  finalScore: number,
): string[] {
  const ids = state.candidates.map((c) => c.restaurantId);
  let insertAt = state.lo;
  if (state.lo <= state.hi) {
    // Open window: place among the un-compared block by score. `>=` keeps
    // an equal-scored incumbent (a "too close to call" pivot, typically)
    // ABOVE the new arrival — the settle sorts a just-rated row below its
    // equal, and the order fed to it must agree.
    while (insertAt <= state.hi && state.candidates[insertAt].score >= finalScore) insertAt++;
  }
  insertAt = Math.max(0, Math.min(ids.length, insertAt));
  return [...ids.slice(0, insertAt), newId, ...ids.slice(insertAt)];
}

/**
 * How many comparisons we expect from the current state to completion.
 * Used to drive the progress bar — total = comparisons-made + estimated-remaining.
 */
export function estimateRemainingComparisons(state: H2HState): number {
  if (isComplete(state)) return 0;
  const remaining = activeIndices(state).length;
  // No budget clamp: the session runs until the window is exhausted, so the
  // estimate must stay ≥ 1 while incomplete (a clamp to spent budget would
  // peg the progress bar at 100% with questions still coming).
  return Math.max(1, Math.ceil(Math.log2(remaining + 1)));
}

export function totalEstimatedComparisons(state: H2HState): number {
  return comparisonsMade(state) + estimateRemainingComparisons(state);
}
