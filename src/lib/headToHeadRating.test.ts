import { describe, it, expect } from 'vitest';
import type { RestaurantRating } from '../contexts/ListsContext';
import {
  initH2H,
  initH2HTieBreak,
  pickComparison,
  applyChoice,
  applyTie,
  applySkip,
  undoLastChoice,
  isComplete,
  computeFinalScore,
  comparisonsMade,
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

describe('similarity-biased pivots prefer peers in the middle band', () => {
  it('first comparison is the most central peer', () => {
    // 7 candidates; the ones at sorted indices 1, 3, 5 are peers (Italian),
    // the rest non-peers (Thai). All three peers sit in the middle band and
    // tie on relevance, so proximity to the midpoint picks index 3 → 8.8.
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

describe('middle-band guardrail: an edge peer never hijacks the pivot', () => {
  const scores = [9.5, 9.2, 8.9, 8.6, 8.3, 8.0, 7.5];
  // Only the lowest-scored candidate (7.5) is a peer — and it sits at the
  // window edge, outside the middle band.
  const ratings = scores.map((s, i) =>
    mk(`r${i}`, s, { cuisine: i === scores.length - 1 ? 'Italian' : 'Thai' }),
  );
  const target: Target = { cuisine: 'Italian', price: '', address: '' };

  it('keeps the first pivot inside the middle band despite the edge peer', () => {
    const state = initH2H(ratings, 'loved', 'none', target);
    const first = pickComparison(state)!;
    // Window [0,6], middle 50% band = [1,5] — the peer at index 6 is off-limits.
    const firstIdx = state.candidates.findIndex((c) => c.restaurantId === first.restaurantId);
    expect(firstIdx).toBeGreaterThanOrEqual(1);
    expect(firstIdx).toBeLessThanOrEqual(5);
  });

  it('places just below the bottom when the new restaurant loses to everyone', () => {
    let state = initH2H(ratings, 'loved', 'none', target);
    const trueScore = 7.4; // new restaurant loses to everyone
    while (!isComplete(state)) {
      const comp = pickComparison(state)!;
      state = applyChoice(state, trueScore > comp.score);
    }
    expect(state.lo).toBeGreaterThan(state.hi); // window fully resolved, no truncation
    const final = computeFinalScore(state);
    expect(final).toBeGreaterThan(7.0);
    expect(final).toBeLessThan(7.5);
  });

  it('still converges to the top when the true position is high', () => {
    let state = initH2H(ratings, 'loved', 'none', target);
    const trueScore = 9.6; // beats everyone
    while (!isComplete(state)) {
      const comp = pickComparison(state)!;
      state = applyChoice(state, trueScore > comp.score);
    }
    expect(state.lo).toBeGreaterThan(state.hi);
    expect(computeFinalScore(state)).toBeGreaterThan(9.4);
  });

  it('every pivot stays inside the band even when similarity loads the edges', () => {
    // 21 candidates; the most similar ones (Italian, same city) sit at the
    // extremes of the score range, the middle is filler. No matter how the
    // user answers, no pivot may leave the live window's middle 50%.
    const n = 21;
    const ratings2 = Array.from({ length: n }, (_, i) =>
      mk(`r${String(i).padStart(2, '0')}`, 9.9 - i * 0.1, {
        cuisine: i < 3 || i >= n - 3 ? 'Italian' : 'Thai',
        address: i < 3 || i >= n - 3 ? 'New York, NY' : 'Los Angeles, CA',
      }),
    );
    const target2: Target = { cuisine: 'Italian', price: '', address: 'New York, NY' };
    for (const answerPattern of [true, false, null]) {
      let state = initH2H(ratings2, 'loved', 'none', target2);
      let flip = false;
      while (!isComplete(state)) {
        const comp = pickComparison(state)!;
        const idx = state.candidates.findIndex((c) => c.restaurantId === comp.restaurantId);
        const span = state.hi - state.lo + 1;
        if (span > 4) {
          // Widest allowed band is the warm start's middle 80%.
          const margin = Math.floor((span * (1 - 0.8)) / 2);
          expect(idx).toBeGreaterThanOrEqual(state.lo + margin);
          expect(idx).toBeLessThanOrEqual(state.hi - margin);
        }
        const pickNew = answerPattern === null ? (flip = !flip) : answerPattern;
        state = applyChoice(state, pickNew);
      }
    }
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
  it('a tie is NOT terminal — the search continues with other candidates', () => {
    const ratings = [mk('a', 8.0), mk('b', 7.5), mk('c', 7.0)];
    let state = initH2H(ratings, 'loved', 'none', undefined, undefined, BIG_BUDGET);
    const pivot = pickComparison(state)!;
    expect(pivot.restaurantId).toBe('b'); // midpoint of the 3-item window
    state = applyTie(state);
    expect(isComplete(state)).toBe(false); // soft signal — keep asking
    expect(state.tiedScores).toEqual([7.5]);
    // The tied pivot is set aside; a DIFFERENT candidate is shown next.
    expect(pickComparison(state)!.restaurantId).not.toBe('b');
    expect(comparisonsMade(state)).toBe(1); // ties consume budget
  });

  it('a tie with no decisive answers anywhere lands on the tied average', () => {
    const ratings = [mk('a', 8.0), mk('b', 7.5), mk('c', 7.0)];
    let state = initH2H(ratings, 'loved', 'none', undefined, undefined, BIG_BUDGET);
    while (!isComplete(state)) state = applyTie(state); // ties all the way down
    expect(state.tiedScores.length).toBe(3);
    expect(computeFinalScore(state)).toBeCloseTo((8.0 + 7.5 + 7.0) / 3, 6);
  });

  it('a tie pulls the final score toward the tied pivot within strict bounds', () => {
    // Hand-built completed state: decisive bounds [7,9], one tie at 8.6.
    const cand = (id: string, score: number): H2HCandidate => ({
      restaurantId: id, name: id, image: '', cuisine: '', price: '', address: '',
      notes: '', tags: [], score,
    });
    const step = (kind: 'choice' | 'tie'): H2HStep => ({
      kind, pickedNew: false, comparisonId: 'x', comparisonIndex: 0,
      prevLo: 0, prevHi: 0, prevUpper: 0, prevLower: 0,
      prevUpperFromComparison: false, prevLowerFromComparison: false,
      prevExcluded: [], prevTiedScores: [],
    });
    const state: H2HState = {
      tier: 'loved',
      candidates: [cand('hi', 9.0), cand('tied', 8.6), cand('lo', 7.0)],
      lo: 2, hi: 1, // window closed
      upperBound: 9.0, lowerBound: 7.0,
      upperBoundFromComparison: true, lowerBoundFromComparison: true,
      excluded: [1], tiedScores: [8.6],
      history: [step('choice'), step('tie'), step('choice')],
      initialPoolSize: 3, target: null,
      similarity: [0, 0, 0], locationScores: [0, 0, 0],
      budget: 8,
    };
    // Midpoint of [7,9] is 8.0; the tie at 8.6 pulls halfway → 8.3.
    expect(computeFinalScore(state)).toBeCloseTo(8.3, 6);
  });

  it('decisive answers cap the tie pull — strict bounds always rule', () => {
    const ratings = Array.from({ length: 7 }, (_, i) => mk(`r${i}`, 9.6 - i * 0.4));
    let state = initH2H(ratings, 'loved', 'none', undefined, undefined, BIG_BUDGET);
    state = applyTie(state); // ≈ the first pivot
    expect(isComplete(state)).toBe(false);
    while (!isComplete(state)) state = applyChoice(state, false); // then loses every one shown
    // However hard the tie pulls, losses bound the score from above.
    expect(computeFinalScore(state)).toBeLessThanOrEqual(state.upperBound);
  });

  it('a tie is undoable and the same pivot comes back', () => {
    const ratings = [mk('a', 8.0), mk('b', 7.5), mk('c', 7.0)];
    let state = initH2H(ratings, 'loved', 'none', undefined, undefined, BIG_BUDGET);
    state = applyTie(state);
    expect(state.tiedScores).toEqual([7.5]);
    state = undoLastChoice(state);
    expect(state.tiedScores).toEqual([]);
    expect(isComplete(state)).toBe(false);
    expect(pickComparison(state)!.restaurantId).toBe('b'); // session resumes intact
  });

  it('ties through a tie-break session land on the tied score', () => {
    const ratings = [
      mk('x', 8.0),
      mk('y', 8.0),
      mk('z', 8.0),
      mk('above', 9.0),
      mk('below', 7.0),
    ];
    let state = initH2HTieBreak(ratings, 8.0, 'self')!;
    expect(state.candidates).toHaveLength(3);
    while (!isComplete(state)) state = applyTie(state);
    expect(computeFinalScore(state)).toBeCloseTo(8.0, 6);
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

/* ── Skip ──────────────────────────────────────────────────────────────── */

describe('skip', () => {
  const ratings = [mk('a', 9.0), mk('b', 8.5), mk('c', 8.0), mk('d', 7.5), mk('e', 7.0)];

  it('drops the shown candidate and surfaces a different one, with no tie signal', () => {
    let state = initH2H(ratings, 'loved', 'none', undefined, undefined, BIG_BUDGET);
    const first = pickComparison(state)!;
    state = applySkip(state);
    expect(state.tiedScores).toEqual([]); // skip is not a tie
    expect(state.excluded.length).toBe(1);
    expect(comparisonsMade(state)).toBe(0); // skips aren't real comparisons
    expect(pickComparison(state)!.restaurantId).not.toBe(first.restaurantId);
  });

  it('does not consume the comparison budget', () => {
    const many = Array.from({ length: 10 }, (_, i) => mk(`r${i}`, 9.5 - i * 0.2));
    let state = initH2H(many, 'loved', 'none', undefined, undefined, 2);
    state = applySkip(state);
    state = applySkip(state);
    state = applySkip(state);
    expect(isComplete(state)).toBe(false); // three skips didn't end it
    state = applyChoice(state, false);
    state = applyChoice(state, false);
    expect(isComplete(state)).toBe(true); // two real comparisons did
  });

  it('skipping everything places at the tier midpoint with no signal', () => {
    let state = initH2H(ratings, 'loved', 'none', undefined, undefined, BIG_BUDGET);
    while (!isComplete(state)) state = applySkip(state);
    expect(state.tiedScores).toEqual([]);
    expect(computeFinalScore(state)).toBeCloseTo((7.0 + 10.0) / 2, 6); // loved-tier midpoint
  });

  it('is undoable via the back action', () => {
    let state = initH2H(ratings, 'loved', 'none', undefined, undefined, BIG_BUDGET);
    const first = pickComparison(state)!;
    state = applySkip(state);
    state = undoLastChoice(state);
    expect(state.excluded).toEqual([]);
    expect(pickComparison(state)!.restaurantId).toBe(first.restaurantId);
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

  it('matches existing behavior on tiny lists (1–3 candidates)', () => {
    for (const n of [1, 2, 3]) {
      const ratings = Array.from({ length: n }, (_, i) => mk(`r${i}`, 9.0 - i));
      const target: Target = { cuisine: 'Sushi', price: '$$', address: 'New York, NY' };
      let biased = initH2H(ratings, 'loved', 'none', target);
      let plain = initH2H(ratings, 'loved', 'none');
      const trueScore = 8.5 - (n - 1) / 2; // lands mid-list
      while (!isComplete(biased)) biased = applyChoice(biased, trueScore > pickComparison(biased)!.score);
      while (!isComplete(plain)) plain = applyChoice(plain, trueScore > pickComparison(plain)!.score);
      expect(computeFinalScore(biased)).toBeCloseTo(computeFinalScore(plain), 6);
    }
  });
});

/* ── Property test: global correctness ─────────────────────────────────── */

/** Deterministic LCG so the "random" cases are reproducible. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const CUISINE_POOL = ['Italian', 'Sushi', 'Japanese', 'Thai', 'Mexican', 'French', 'Pizza', ''];
const ADDRESS_POOL = [
  'New York, NY',
  'Brooklyn, NY',
  'Los Angeles, CA',
  'Boston, MA',
  'Paris, France',
  '',
];
const PRICE_POOL = ['', '$', '$$', '$$$', '$$$$'];
const TAG_POOL = ['Romantic', 'Cozy', 'Lively', 'Great cocktails'];

function randomRatings(rnd: () => number, n: number): RestaurantRating[] {
  return Array.from({ length: n }, (_, i) => {
    const score = 7 + Math.floor(rnd() * 30) / 10; // 7.0–9.9, duplicates allowed
    return mk(`r${String(i).padStart(3, '0')}`, score, {
      cuisine: CUISINE_POOL[Math.floor(rnd() * CUISINE_POOL.length)],
      address: ADDRESS_POOL[Math.floor(rnd() * ADDRESS_POOL.length)],
      price: PRICE_POOL[Math.floor(rnd() * PRICE_POOL.length)],
      tags: TAG_POOL.filter(() => rnd() < 0.3),
    });
  });
}

function runToCompletion(state: H2HState, trueScore: number): H2HState {
  let s = state;
  let guard = 0;
  while (!isComplete(s)) {
    const comp = pickComparison(s)!;
    s = applyChoice(s, trueScore > comp.score);
    if (++guard > 100) throw new Error('did not terminate');
  }
  return s;
}

describe('property: similarity bias never changes the final placement', () => {
  it('matches plain binary search across 150 randomized lists', () => {
    const rnd = makeRng(20260609);
    for (let trial = 0; trial < 150; trial++) {
      const n = Math.floor(rnd() * 81); // 0–80 candidates
      const ratings = randomRatings(rnd, n);
      // True score sits off the 0.1 grid so every answer is strict/consistent.
      const trueScore = 7 + Math.floor(rnd() * 30) / 10 + 0.05;
      const target: Target = {
        cuisine: CUISINE_POOL[Math.floor(rnd() * CUISINE_POOL.length)],
        address: ADDRESS_POOL[Math.floor(rnd() * ADDRESS_POOL.length)],
        price: PRICE_POOL[Math.floor(rnd() * PRICE_POOL.length)],
        tags: TAG_POOL.filter(() => rnd() < 0.3),
      };

      const biased = runToCompletion(initH2H(ratings, 'loved', 'none', target), trueScore);
      const plain = runToCompletion(
        initH2H(ratings, 'loved', 'none', undefined, undefined, BIG_BUDGET),
        trueScore,
      );

      // The window must close fully (the budget guard prevents truncation)…
      expect(biased.lo).toBeGreaterThan(biased.hi);
      // …and the placement must be exactly what plain bisection produces.
      expect(computeFinalScore(biased)).toBeCloseTo(computeFinalScore(plain), 6);
    }
  });

  it('is deterministic: the same inputs and answers replay identically', () => {
    const rnd = makeRng(42);
    const ratings = randomRatings(rnd, 30);
    const target: Target = { cuisine: 'Sushi', price: '$$$', address: 'New York, NY' };
    const seq = (): string[] => {
      let s = initH2H(ratings, 'loved', 'none', target);
      const ids: string[] = [];
      while (!isComplete(s)) {
        const comp = pickComparison(s)!;
        ids.push(comp.restaurantId);
        s = applyChoice(s, 8.55 > comp.score);
      }
      return ids;
    };
    expect(seq()).toEqual(seq());
  });
});

/* ── Comparison-count bounds ───────────────────────────────────────────── */

describe('comparison-count bounds', () => {
  it('always finishes within the default budget and fully resolves the window', () => {
    const rnd = makeRng(7);
    for (const n of [10, 25, 50, 120, 200]) {
      const ratings = randomRatings(rnd, n);
      const target: Target = { cuisine: 'Sushi', price: '$$$', address: 'New York, NY' };
      for (let t = 0; t < 10; t++) {
        const trueScore = 7 + Math.floor(rnd() * 30) / 10 + 0.05;
        const end = runToCompletion(initH2H(ratings, 'loved', 'none', target), trueScore);
        expect(comparisonsMade(end)).toBeLessThanOrEqual(8); // DEFAULT_BUDGET
        expect(end.lo).toBeGreaterThan(end.hi); // exact placement, no truncation
      }
    }
  });

  it('stays near log2(n) on flat-similarity inputs', () => {
    for (const n of [15, 31, 63]) {
      const ratings = Array.from({ length: n }, (_, i) => mk(`r${i}`, 9.9 - i * 0.01));
      const end = runToCompletion(
        initH2H(ratings, 'loved', 'none', undefined, undefined, BIG_BUDGET),
        7.005,
      );
      expect(comparisonsMade(end)).toBeLessThanOrEqual(Math.ceil(Math.log2(n + 1)));
    }
  });
});

/* ── Demo: rating a NYC sushi spot ─────────────────────────────────────── */

describe('demo: NYC sushi restaurant gets similar NYC opponents first', () => {
  it('early opponents are dominated by similar NYC spots', () => {
    const ratings = [
      mk('nyc-sushi-1', 9.6, { cuisine: 'Sushi', price: '$$$', address: 'New York, NY', tags: ['Date night'] }),
      mk('miami-steak', 9.4, { cuisine: 'Steakhouse', price: '$$$$', address: 'Miami, FL' }),
      mk('la-tacos', 9.1, { cuisine: 'Mexican', price: '$', address: 'Los Angeles, CA' }),
      mk('nyc-ramen', 8.9, { cuisine: 'Ramen', price: '$$', address: 'New York, NY' }),
      mk('chicago-pizza', 8.6, { cuisine: 'Pizza', price: '$$', address: 'Chicago, IL' }),
      mk('nyc-sushi-2', 8.4, { cuisine: 'Sushi', price: '$$$', address: 'New York, NY' }),
      mk('austin-bbq', 8.1, { cuisine: 'BBQ', price: '$$', address: 'Austin, TX' }),
      mk('nyc-italian', 7.8, { cuisine: 'Italian', price: '$$$', address: 'New York, NY' }),
      mk('sf-thai', 7.5, { cuisine: 'Thai', price: '$$', address: 'San Francisco, CA' }),
      mk('nyc-izakaya', 7.2, { cuisine: 'Japanese', price: '$$$', address: 'New York, NY' }),
    ];
    const target: Target = {
      cuisine: 'Sushi',
      price: '$$$',
      address: 'New York, NY',
      tags: ['Date night'],
    };
    let state = initH2H(ratings, 'loved', 'none', target);
    const trueScore = 8.75;
    const opponents: string[] = [];
    while (!isComplete(state)) {
      const comp = pickComparison(state)!;
      opponents.push(comp.restaurantId);
      state = applyChoice(state, trueScore > comp.score);
    }
    // eslint-disable-next-line no-console
    console.log(
      `[demo] opponent order: ${opponents.join(' → ')} | final score: ${computeFinalScore(state)}`,
    );
    // The first two comparisons are both highly similar NYC restaurants.
    expect(opponents.slice(0, 2).every((id) => id.startsWith('nyc'))).toBe(true);
    // And the placement is still globally exact.
    expect(state.lo).toBeGreaterThan(state.hi);
    expect(computeFinalScore(state)).toBeCloseTo(8.8, 6); // between 8.6 and 8.9
  });
});
