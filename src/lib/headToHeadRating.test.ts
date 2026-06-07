import { describe, it, expect } from 'vitest';
import type { RestaurantRating } from '../contexts/ListsContext';
import {
  initH2H,
  initH2HTieBreak,
  isHotelRating,
  pickComparison,
  applyChoice,
  applyTie,
  isComplete,
  computeFinalScore,
  type H2HState,
  type H2HStep,
  type H2HCandidate,
} from './headToHeadRating';
import type { SimilarityInput } from './restaurantSimilarity';

type Target = SimilarityInput;

/* ── Fixtures ──────────────────────────────────────────────────────────── */

function mk(id: string, score: number, over: Partial<RestaurantRating> = {}): RestaurantRating {
  return {
    restaurantId: id,
    name: id,
    image: '',
    cuisine: '',
    price: '',
    address: '',
    score,
    notes: '',
    visitDate: '',
    wouldReturn: true,
    tags: [],
    photos: [],
    listIds: [],
    friendIds: [],
    createdAt: 0,
    ...over,
  };
}

/** The original midpoint selector — the oracle we must match under uniform
 *  similarity (proves the relevance layer doesn't change plain placement). */
function oracleIndex(lo: number, hi: number, excluded: number[]): number | null {
  if (lo > hi) return null;
  const target = Math.floor((lo + hi) / 2);
  const ex = new Set(excluded);
  for (let off = 0; off <= hi - lo; off++) {
    const cs = off === 0 ? [target] : [target - off, target + off];
    for (const idx of cs) {
      if (idx < lo || idx > hi) continue;
      if (!ex.has(idx)) return idx;
    }
  }
  return null;
}

const BIG_BUDGET = 999;

/* ── Correctness invariant ─────────────────────────────────────────────── */

describe('selection equals plain binary search under uniform similarity', () => {
  it('probes the same candidate as the midpoint oracle at every step', () => {
    const ratings = Array.from({ length: 15 }, (_, i) => mk(`r${i}`, 9.9 - i * 0.1));
    let state = initH2H(ratings, 'loved', 'none', undefined, undefined, BIG_BUDGET);

    let steps = 0;
    while (!isComplete(state)) {
      const picked = pickComparison(state)!;
      const oi = oracleIndex(state.lo, state.hi, state.excluded)!;
      expect(picked.restaurantId).toBe(state.candidates[oi].restaurantId);
      // "comparison wins" each round → walks lo upward deterministically.
      state = applyChoice(state, false);
      if (++steps > 50) throw new Error('did not terminate');
    }
    expect(Number.isFinite(computeFinalScore(state))).toBe(true);
  });

  it('converges to the true position (brackets the hidden score)', () => {
    const ratings = [
      mk('a', 9.5),
      mk('b', 9.0),
      mk('c', 8.5),
      mk('d', 8.0),
      mk('e', 7.5),
    ];
    const trueScore = 8.3;
    let state = initH2H(ratings, 'loved', 'none', undefined, undefined, BIG_BUDGET);
    while (!isComplete(state)) {
      const comp = pickComparison(state)!;
      state = applyChoice(state, trueScore > comp.score);
    }
    const final = computeFinalScore(state);
    expect(final).toBeGreaterThan(8.0);
    expect(final).toBeLessThan(8.5);
  });
});

/* ── No-peers fallback ─────────────────────────────────────────────────── */

describe('flat (no-peer) similarity behaves like bisection', () => {
  it('probe order matches the oracle when every candidate is equally dissimilar', () => {
    // Target Italian; all candidates Thai → similarity 0 for all → flat.
    const ratings = Array.from({ length: 12 }, (_, i) => mk(`r${i}`, 9.9 - i * 0.1, { cuisine: 'Thai' }));
    const target: Target = { cuisine: 'Italian', price: '', address: '' };
    let state = initH2H(ratings, 'loved', 'none', target, undefined, BIG_BUDGET);
    // Confirm there are genuinely no peers.
    expect(Math.max(...state.similarity)).toBeLessThan(0.55);

    while (!isComplete(state)) {
      const picked = pickComparison(state)!;
      const oi = oracleIndex(state.lo, state.hi, state.excluded)!;
      expect(picked.restaurantId).toBe(state.candidates[oi].restaurantId);
      state = applyChoice(state, false);
    }
  });
});

/* ── Warm start & outlier reachability ─────────────────────────────────── */

describe('warm start seeds near the peer cohort', () => {
  it('first comparison is the peer-median candidate', () => {
    // 7 candidates; make the ones at sorted indices 1, 3, 5 peers (Italian),
    // the rest non-peers (Thai). Peer-median index = 3 → score 8.8.
    const scores = [9.7, 9.4, 9.1, 8.8, 8.5, 8.2, 7.9];
    const ratings = scores.map((s, i) =>
      mk(`r${i}`, s, { cuisine: i % 2 === 1 ? 'Italian' : 'Thai' }),
    );
    const target: Target = { cuisine: 'Italian', price: '', address: '' };
    const state = initH2H(ratings, 'loved', 'none', target);
    const first = pickComparison(state)!;
    expect(first.score).toBeCloseTo(8.8, 6);
  });

  it('is deterministic: identical init yields identical similarity and probe', () => {
    const ratings = [mk('a', 9.0, { cuisine: 'Italian' }), mk('b', 8.0, { cuisine: 'Thai' })];
    const target: Target = { cuisine: 'Italian', price: '', address: '' };
    const s1 = initH2H(ratings, 'loved', 'none', target);
    const s2 = initH2H(ratings, 'loved', 'none', target);
    expect(s1.similarity).toEqual(s2.similarity);
    expect(pickComparison(s1)!.restaurantId).toBe(pickComparison(s2)!.restaurantId);
  });
});

describe('location leads the opening comparison', () => {
  it('opens with a same-city restaurant over a same-cuisine one elsewhere', () => {
    // Target: NYC Italian. One candidate is same-city (different cuisine),
    // another is same-cuisine in another city. Location should win the open.
    const ratings = [
      mk('a', 9.5, { cuisine: 'Thai', address: 'Los Angeles, CA' }),
      mk('sameCuisine', 9.0, { cuisine: 'Italian', address: 'Los Angeles, CA' }),
      mk('c', 8.5, { cuisine: 'Thai', address: 'Los Angeles, CA' }),
      mk('sameCity', 8.0, { cuisine: 'Thai', address: 'New York, NY' }),
      mk('e', 7.5, { cuisine: 'Thai', address: 'Los Angeles, CA' }),
    ];
    const target: Target = { cuisine: 'Italian', price: '', address: 'New York, NY' };
    const state = initH2H(ratings, 'loved', 'none', target);
    expect(pickComparison(state)!.restaurantId).toBe('sameCity');
  });
});

describe('outliers stay reachable; relevance never prunes the window', () => {
  const scores = [9.5, 9.2, 8.9, 8.6, 8.3, 8.0, 7.5];
  // Only the lowest-scored candidate (7.5) is a peer.
  const ratings = scores.map((s, i) =>
    mk(`r${i}`, s, { cuisine: i === scores.length - 1 ? 'Italian' : 'Thai' }),
  );
  const target: Target = { cuisine: 'Italian', price: '', address: '' };

  it('probes the low-scored peer first, then places just below it', () => {
    let state = initH2H(ratings, 'loved', 'none', target);
    const first = pickComparison(state)!;
    expect(first.score).toBeCloseTo(7.5, 6); // warm start reaches the edge peer
    const trueScore = 7.4; // new restaurant loses to everyone
    while (!isComplete(state)) {
      const comp = pickComparison(state)!;
      state = applyChoice(state, trueScore > comp.score);
    }
    const final = computeFinalScore(state);
    expect(final).toBeGreaterThan(7.0);
    expect(final).toBeLessThan(7.5);
  });

  it('still converges to the top when the true position is high', () => {
    let state = initH2H(ratings, 'loved', 'none', target);
    const trueScore = 9.6; // beats everyone, despite the low-similarity seed
    while (!isComplete(state)) {
      const comp = pickComparison(state)!;
      state = applyChoice(state, trueScore > comp.score);
    }
    expect(computeFinalScore(state)).toBeGreaterThan(9.4);
  });
});

/* ── Budget ────────────────────────────────────────────────────────────── */

describe('comparison budget', () => {
  it('caps the number of comparisons and finalizes within the residual window', () => {
    const ratings = Array.from({ length: 20 }, (_, i) => mk(`r${i}`, 9.9 - i * 0.1));
    let state = initH2H(ratings, 'loved', 'none', undefined, undefined, 3);
    let n = 0;
    while (!isComplete(state)) {
      state = applyChoice(state, false);
      n++;
    }
    expect(n).toBe(3);
    expect(state.history.length).toBe(3);
    // Window still open (20 items can't resolve in 3 probes).
    expect(state.lo).toBeLessThanOrEqual(state.hi);

    const final = computeFinalScore(state);
    const upperNeighbor = state.candidates[state.lo].score;
    const lowerNeighbor = state.candidates[state.hi].score;
    expect(final).toBeGreaterThanOrEqual(lowerNeighbor - 0.06);
    expect(final).toBeLessThanOrEqual(upperNeighbor + 0.06);
    expect(final).toBeGreaterThanOrEqual(state.lowerBound - 0.06);
    expect(final).toBeLessThanOrEqual(state.upperBound + 0.06);
  });

  it('pulls a budget-capped score toward the peer prior', () => {
    // Hand-built open-window state (lo..hi spans the whole pool, budget spent).
    const cand = (id: string, score: number): H2HCandidate => ({
      restaurantId: id, name: id, image: '', cuisine: '', price: '', address: '',
      notes: '', tags: [], score,
    });
    const fakeStep = (): H2HStep => ({
      kind: 'choice', pickedNew: false, comparisonId: 'x', comparisonIndex: 0,
      prevLo: 0, prevHi: 0, prevUpper: 0, prevLower: 0,
      prevUpperFromComparison: false, prevLowerFromComparison: false,
      prevExcluded: [], prevTiedScores: [],
    });
    const base: Omit<H2HState, 'similarity'> = {
      tier: 'loved',
      candidates: [cand('hi', 9.0), cand('mid', 8.0), cand('lo', 7.0)],
      lo: 0,
      hi: 2,
      upperBound: 9.0,
      lowerBound: 7.0,
      upperBoundFromComparison: true,
      lowerBoundFromComparison: true,
      excluded: [],
      tiedScores: [],
      history: [fakeStep(), fakeStep(), fakeStep()],
      initialPoolSize: 3,
      target: null,
      locationScores: [0, 0, 0],
      budget: 3,
    };
    const withoutPeers = computeFinalScore({ ...base, similarity: [0, 0, 0] });
    const withHighPeer = computeFinalScore({ ...base, similarity: [0.9, 0, 0] });
    expect(withoutPeers).toBeCloseTo(8.0, 6); // midpoint of [7,9]
    expect(withHighPeer).toBeGreaterThan(withoutPeers); // pulled up toward 9.0
    expect(withHighPeer).toBeCloseTo(8.3, 6); // 0.75*8 + 0.25*9 = 8.25 → 8.3
  });
});

/* ── Ties ──────────────────────────────────────────────────────────────── */

describe('tie handling', () => {
  it('averages the tied scores when nothing tightened a bound', () => {
    const ratings = [mk('a', 8.0), mk('b', 7.5), mk('c', 7.0)];
    let state = initH2H(ratings, 'loved', 'none', undefined, undefined, BIG_BUDGET);
    while (!isComplete(state)) {
      state = applyTie(state);
    }
    expect(state.history.length).toBe(3); // ties count toward progress
    expect(state.excluded.length).toBe(3);
    expect(state.tiedScores.slice().sort()).toEqual([7.0, 7.5, 8.0]);
    expect(computeFinalScore(state)).toBeCloseTo(7.5, 6); // (8+7.5+7)/3
  });

  it('applies the strict-bound nudge when a comparison beats the only peer', () => {
    // Single candidate at the tier floor; "comparison wins" → score spills to 6.9.
    const ratings = [mk('only', 7.0)];
    let state = initH2H(ratings, 'loved', 'none', undefined, undefined, BIG_BUDGET);
    state = applyChoice(state, false);
    expect(isComplete(state)).toBe(true);
    expect(computeFinalScore(state)).toBeCloseTo(6.9, 6);
  });
});

/* ── Hotels vs restaurants ─────────────────────────────────────────────── */

describe('hotels and restaurants never compare against each other', () => {
  it('isHotelRating recognizes the stored hotel markers', () => {
    expect(isHotelRating('Hotel Breakfast')).toBe(true);
    expect(isHotelRating('hotel')).toBe(true);
    expect(isHotelRating('Italian')).toBe(false);
    expect(isHotelRating('')).toBe(false);
    expect(isHotelRating(undefined)).toBe(false);
  });

  const mixed = [
    mk('rest1', 9.0, { cuisine: 'Italian' }),
    mk('hotelA', 8.5, { cuisine: 'Hotel Breakfast' }),
    mk('rest2', 8.0, { cuisine: 'Thai' }),
    mk('hotelB', 7.5, { cuisine: 'Hotel' }),
  ];

  it('initH2H excludes hotels when rating a restaurant', () => {
    const target: Target = { cuisine: 'Italian', price: '', address: '' };
    const state = initH2H(mixed, 'loved', 'none', target);
    expect(state.candidates.map((c) => c.restaurantId)).toEqual(['rest1', 'rest2']);
  });

  it('initH2H keeps only hotels when rating a hotel', () => {
    const target: Target = { cuisine: 'Hotel Breakfast', price: '', address: '' };
    const state = initH2H(mixed, 'loved', 'none', target);
    expect(state.candidates.map((c) => c.restaurantId)).toEqual(['hotelA', 'hotelB']);
  });

  it('initH2H with no target defaults to the restaurant pool', () => {
    const state = initH2H(mixed, 'loved', 'none');
    expect(state.candidates.every((c) => !isHotelRating(c.cuisine))).toBe(true);
  });

  it('initH2HTieBreak excludes hotels when refining a restaurant score', () => {
    const ratings = [
      mk('rest1', 8.0, { cuisine: 'Italian' }),
      mk('hotelA', 8.0, { cuisine: 'Hotel Breakfast' }),
      mk('rest2', 9.0, { cuisine: 'Thai' }),
    ];
    const state = initH2HTieBreak(ratings, 8.0, 'self', 'Italian');
    expect(state).not.toBeNull();
    expect(state!.candidates.map((c) => c.restaurantId)).toEqual(['rest1']);
  });
});

/* ── Cold start ────────────────────────────────────────────────────────── */

describe('cold start', () => {
  it('completes immediately with no candidates in the tier', () => {
    const state = initH2H([], 'loved', 'none', { cuisine: 'Italian', price: '', address: '' });
    expect(isComplete(state)).toBe(true);
    const final = computeFinalScore(state);
    expect(final).toBeGreaterThanOrEqual(7.0);
    expect(final).toBeLessThanOrEqual(10.0);
  });
});
