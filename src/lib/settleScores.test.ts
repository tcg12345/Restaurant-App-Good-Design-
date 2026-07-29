import { describe, it, expect } from 'vitest';
import type { RestaurantRating } from '../contexts/ListsContext';
import {
  settleScores,
  applySettleChanges,
  tierOfScore,
  MIN_GAP,
  MATURITY_K,
} from './settleScores';
import {
  initH2H,
  pickComparison,
  applyChoice,
  isComplete,
  computeFinalScore,
  tierRange,
  type Tier,
} from './headToHeadRating';

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

/** Deterministic LCG so the "random" cases are reproducible. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Rows of one category+tier, in settle order (score desc, id asc). */
function tierRows(all: RestaurantRating[], tier: Tier): RestaurantRating[] {
  return all
    .filter((r) => tierOfScore(r.score) === tier)
    .sort((a, b) => b.score - a.score || (a.restaurantId < b.restaurantId ? -1 : 1));
}

function settleAndApply(all: RestaurantRating[], opts?: Parameters<typeof settleScores>[1]) {
  return applySettleChanges(all, settleScores(all, opts));
}

/* ── Core invariants ───────────────────────────────────────────────────── */

describe('settleScores invariants', () => {
  it('preserves order and produces strictly descending scores', () => {
    const all = [mk('a', 9.9), mk('b', 9.8), mk('c', 9.8), mk('d', 9.7), mk('e', 7.2)];
    const next = settleAndApply(all, { justRatedId: 'c' });
    const rows = tierRows(next, 'loved');
    // Same membership, order by original sort retained.
    expect(rows.map((r) => r.restaurantId)).toEqual(['a', 'b', 'c', 'd', 'e']);
    for (let i = 0; i < rows.length - 1; i++) {
      expect(rows[i].score).toBeGreaterThan(rows[i + 1].score);
    }
  });

  it('keeps every settled score inside its tier band (7.0 stays loved)', () => {
    const all = [mk('edge', 7.0), mk('a', 7.1), mk('b', 9.0), mk('c', 10.0), mk('d', 8.2)];
    const next = settleAndApply(all, { justRatedId: 'a' });
    const { min, max } = tierRange('loved');
    for (const r of next) {
      expect(r.score).toBeGreaterThanOrEqual(min);
      expect(r.score).toBeLessThanOrEqual(max);
      expect(tierOfScore(r.score)).toBe('loved');
    }
  });

  it('enforces the minimum 0.1 gap between adjacent tier-mates', () => {
    const all = [mk('a', 9.1), mk('b', 9.1), mk('c', 9.1), mk('d', 9.0), mk('e', 9.0)];
    const next = settleAndApply(all, { justRatedId: 'e' });
    const rows = tierRows(next, 'loved');
    for (let i = 0; i < rows.length - 1; i++) {
      expect(rows[i].score - rows[i + 1].score).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
    }
  });

  it('separates an all-equal tier into a strict 0.1 ladder', () => {
    const all = ['a', 'b', 'c', 'd', 'e'].map((id) => mk(id, 8.0));
    const next = settleAndApply(all, { justRatedId: 'e' });
    const rows = tierRows(next, 'loved');
    const scores = rows.map((r) => r.score);
    for (let i = 0; i < scores.length - 1; i++) {
      expect(round1(scores[i] - scores[i + 1])).toBeGreaterThanOrEqual(MIN_GAP);
    }
    expect(new Set(scores).size).toBe(scores.length);
  });

  it('a tie-placed row lands directly below the equal-scored incumbent', () => {
    const all = [mk('incumbent', 8.4), mk('above', 9.0), mk('below', 7.6), mk('new', 8.4)];
    const next = settleAndApply(all, { justRatedId: 'new' });
    const rows = tierRows(next, 'loved');
    const order = rows.map((r) => r.restaurantId);
    expect(order.indexOf('new')).toBe(order.indexOf('incumbent') + 1);
    const inc = next.find((r) => r.restaurantId === 'incumbent')!;
    const nw = next.find((r) => r.restaurantId === 'new')!;
    expect(inc.score).toBeGreaterThan(nw.score);
    // Adjacent with minimal separation — the gap floor scales gently with
    // tier maturity (0.1 → 0.3), so at n=4 the pair sits ~0.2 apart.
    expect(round1(inc.score - nw.score)).toBeLessThanOrEqual(0.2);
  });
});

/* ── Soft anchor + gap ratios ──────────────────────────────────────────── */

describe('soft anchoring by count', () => {
  it('a lone item and a fresh pair stay near where they were placed', () => {
    expect(settleScores([mk('a', 8.3)], { justRatedId: 'a' })).toEqual([]);

    const pair = settleAndApply([mk('a', 7.4), mk('b', 7.2)], { justRatedId: 'b' });
    const a = pair.find((r) => r.restaurantId === 'a')!;
    const b = pair.find((r) => r.restaurantId === 'b')!;
    // f = 0.1 — gentle drift, no fake 10/7 spread.
    expect(Math.abs(a.score - 7.4)).toBeLessThanOrEqual(0.4);
    expect(Math.abs(b.score - 7.2)).toBeLessThanOrEqual(0.4);
    expect(a.score).toBeGreaterThan(b.score);
  });

  it('the loved top drifts to 10.0 as the tier matures', () => {
    let prevTop = 0;
    for (let n = 2; n <= MATURITY_K + 2; n++) {
      // n items clustered tightly at 8.0–8.4 (the crowding scenario).
      const all = Array.from({ length: n }, (_, i) => mk(`r${String(i).padStart(2, '0')}`, round1(8.4 - (0.4 * i) / Math.max(1, n - 1))));
      const next = settleAndApply(all, { justRatedId: all[n - 1].restaurantId });
      const top = Math.max(...next.map((r) => r.score));
      expect(top).toBeGreaterThanOrEqual(prevTop - 1e-9); // non-decreasing in n
      prevTop = top;
      if (n >= MATURITY_K + 1) expect(top).toBe(10.0);
    }
  });

  it('the disliked bottom drifts to 1.0 as the tier matures', () => {
    const n = MATURITY_K + 1;
    const all = Array.from({ length: n }, (_, i) => mk(`d${String(i).padStart(2, '0')}`, round1(3.5 - (0.3 * i) / (n - 1))));
    const next = settleAndApply(all, { justRatedId: all[0].restaurantId });
    expect(Math.min(...next.map((r) => r.score))).toBe(1.0);
  });

  it('preserves gap ratios at full maturity (no uniform spacing)', () => {
    // 11 items; one deliberate chasm between the top pair and the rest.
    const scores = [9.9, 9.8, 8.9, 8.8, 8.7, 8.6, 8.5, 8.4, 8.3, 8.2, 8.1];
    const all = scores.map((s, i) => mk(`g${String(i).padStart(2, '0')}`, s));
    const next = settleAndApply(all, { justRatedId: 'g10' });
    const rows = tierRows(next, 'loved');
    const gap01 = rows[0].score - rows[1].score;   // was 0.1
    const gap12 = rows[1].score - rows[2].score;   // was 0.9 — the chasm
    const gap23 = rows[2].score - rows[3].score;   // was 0.1
    // The chasm stays several times wider than its neighbors.
    expect(gap12).toBeGreaterThan(gap01 * 3);
    expect(gap12).toBeGreaterThan(gap23 * 3);
  });
});

/* ── The crowding regression ───────────────────────────────────────────── */

describe('crowding decompression', () => {
  it('slider clumping at 8.8–9.6 + five H2H inserts spreads through the band', () => {
    // 12 slider ratings crammed into 8.8–9.6.
    let all: RestaurantRating[] = Array.from({ length: 12 }, (_, i) =>
      mk(`s${String(i).padStart(2, '0')}`, round1(8.8 + (0.8 * i) / 11)),
    );
    all = settleAndApply(all, { justRatedId: 's00' });

    const rng = makeRng(20260704);
    for (let k = 0; k < 5; k++) {
      const id = `h2h${k}`;
      // Hidden true position: a uniformly random slot in the loved order.
      const hidden = 7.0 + rng() * 3.0;
      let st = initH2H(all, 'loved', id);
      while (!isComplete(st)) {
        const comp = pickComparison(st);
        if (!comp) break;
        st = applyChoice(st, hidden > comp.score);
      }
      const placed = computeFinalScore(st);
      all = [...all, mk(id, placed)];
      all = settleAndApply(all, { justRatedId: id });
    }

    const rows = tierRows(all, 'loved');
    const scores = rows.map((r) => r.score);
    expect(Math.max(...scores)).toBeGreaterThanOrEqual(9.9);
    expect(Math.min(...scores)).toBeLessThanOrEqual(7.9);
    expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThanOrEqual(2.0);
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i] - scores[i + 1]).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
    }
  });
});

/* ── Stability ─────────────────────────────────────────────────────────── */

describe('stability and idempotence', () => {
  it('iterated settles reach an exact fixed point that stays put', () => {
    const rng = makeRng(987654321);
    for (let trial = 0; trial < 150; trial++) {
      const n = 2 + Math.floor(rng() * 18);
      let all = Array.from({ length: n }, (_, i) =>
        mk(`t${String(i).padStart(2, '0')}`, round1(7.0 + rng() * 3.0)),
      );
      const justRatedId = all[Math.floor(rng() * n)].restaurantId;
      all = settleAndApply(all, { justRatedId });
      // Min-gap flooring reshapes gap ratios between passes, so individual
      // items may drift a few tenths across settles — the stability contract
      // is CONVERGENCE: an exact fixed point within a handful of passes,
      // which then stays put.
      let cur = all;
      let settledAt = -1;
      for (let i = 0; i < 8; i++) {
        const ch = settleScores(cur, { justRatedId });
        if (ch.length === 0) { settledAt = i; break; }
        cur = applySettleChanges(cur, ch);
      }
      expect(settledAt).toBeGreaterThanOrEqual(0);
      // …and the fixed point is genuinely fixed.
      expect(settleScores(cur, { justRatedId })).toEqual([]);
    }
  });

  it('is deterministic', () => {
    const all = [mk('a', 9.4), mk('b', 8.8), mk('c', 8.8), mk('d', 7.3)];
    const one = settleScores(all, { justRatedId: 'c' });
    const two = settleScores(all, { justRatedId: 'c' });
    expect(two).toEqual(one);
  });
});

/* ── Scoping ───────────────────────────────────────────────────────────── */

describe('scoping: tiers and categories', () => {
  it('settling a fine-tier rating leaves loved and disliked untouched', () => {
    const all = [
      mk('l1', 9.9), mk('l2', 9.8),
      mk('f1', 5.5), mk('f2', 5.5), mk('f3', 5.0),
      mk('d1', 2.0), mk('d2', 1.9),
    ];
    const changes = settleScores(all, { justRatedId: 'f2' });
    for (const c of changes) {
      expect(['f1', 'f2', 'f3']).toContain(c.restaurantId);
      expect(tierOfScore(c.score)).toBe('fine');
    }
  });

  it('previousScore re-settles the departed tier on a cross-tier re-rate', () => {
    const all = [
      mk('moved', 8.0),             // now loved; used to be fine
      mk('f1', 5.2), mk('f2', 5.2), // crowded fine pair should separate
      mk('l1', 8.0),
    ];
    const changes = settleScores(all, { justRatedId: 'moved', previousScore: 5.2 });
    const fineIds = changes.filter((c) => ['f1', 'f2'].includes(c.restaurantId));
    expect(fineIds.length).toBeGreaterThan(0);
  });

  it('note-only style calls with no justRatedId and no allTiers are no-ops', () => {
    const all = [mk('a', 9.0), mk('b', 9.0)];
    expect(settleScores(all, {})).toEqual([]);
  });
});

/* ── Reorder support ───────────────────────────────────────────────────── */

describe('explicitOrder and overflow', () => {
  it('respects explicitOrder through duplicate scores', () => {
    const all = [mk('a', 8.0), mk('b', 8.0), mk('c', 8.0)];
    const next = settleAndApply(all, { allTiers: true, explicitOrder: ['c', 'a', 'b'] });
    const byId = Object.fromEntries(next.map((r) => [r.restaurantId, r.score]));
    expect(byId.c).toBeGreaterThan(byId.a);
    expect(byId.a).toBeGreaterThan(byId.b);
  });

  it('overflow (35 loved) stays band-contained and order-preserving', () => {
    const all = Array.from({ length: 35 }, (_, i) =>
      mk(`o${String(i).padStart(2, '0')}`, round1(10 - (i * 3) / 34)),
    );
    const next = settleAndApply(all, { justRatedId: 'o34' });
    const rows = tierRows(next, 'loved');
    for (const r of rows) {
      expect(r.score).toBeGreaterThanOrEqual(7.0);
      expect(r.score).toBeLessThanOrEqual(10.0);
    }
    for (let i = 0; i < rows.length - 1; i++) {
      expect(rows[i].score).toBeGreaterThanOrEqual(rows[i + 1].score);
    }
  });

  it('empty input produces no changes', () => {
    expect(settleScores([], { allTiers: true })).toEqual([]);
  });
});

/* ── placementOrder + explicit-order settle (crowded-insertion fix) ───── */

import { placementOrder, applyTie } from './headToHeadRating';
import { normalizeScores } from './settleScores';

describe('placementOrder', () => {
  // Drive a real search answering with ground truth: the new restaurant is
  // better than anything scored ≤ `beats`, worse than anything above it.
  function runSearch(all: RestaurantRating[], beats: number) {
    let st = initH2H(all, 'loved');
    while (!isComplete(st)) {
      const comp = pickComparison(st)!;
      st = applyChoice(st, comp.score <= beats);
    }
    return st;
  }

  it('closed window: inserts exactly between the loser and the winner', () => {
    const all = [mk('r10', 10), mk('r99', 9.9), mk('r98', 9.8), mk('r97', 9.7), mk('r96', 9.6)];
    const st = runSearch(all, 9.7); // beats 9.7 and below, loses to 9.8 up
    const final = computeFinalScore(st);
    const order = placementOrder(st, 'new', final);
    expect(order).toEqual(['r10', 'r99', 'r98', 'new', 'r97', 'r96']);
  });

  it('tie: lands directly below the tied pivot', () => {
    const all = [mk('a', 9.9), mk('b', 9.5), mk('c', 9.1)];
    let st = initH2H(all, 'loved');
    st = applyTie(st); // pivot = b (midpoint) — soft signal, search continues
    const order = placementOrder(st, 'new', computeFinalScore(st));
    expect(order).toEqual(['a', 'b', 'new', 'c']);
  });

  it("THE crowded case: beating the 9.7 in a 0.1 gap shifts the block DOWN, never inverts", () => {
    const all = [mk('r10', 10), mk('r99', 9.9), mk('r98', 9.8), mk('r97', 9.7), mk('r96', 9.6)];
    const st = runSearch(all, 9.7);
    const final = computeFinalScore(st);
    // The raw score collides with the beaten neighbor — that's the trap.
    expect(final).toBe(9.7);
    const order = placementOrder(st, 'new', final);
    const next = settleAndApply([mk('new', final), ...all], {
      justRatedId: 'new',
      explicitOrder: order,
    });
    const score = (id: string) => next.find((r) => r.restaurantId === id)!.score;
    // Order faithful to the comparisons: new sits between r98 and r97 …
    expect(score('r98')).toBeGreaterThan(score('new'));
    expect(score('new')).toBeGreaterThan(score('r97'));
    // … and the block below shifted down to make room (no crowding).
    expect(score('r97')).toBeLessThanOrEqual(9.6);
    expect(score('r97') - score('r96')).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
    // Everything stays distinct on the 0.1 grid.
    const sorted = [...next].sort((a, b) => b.score - a.score).map((r) => r.score);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1] - sorted[i]).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
    }
  });

  it('without the explicit order the same save used to invert — guard the regression', () => {
    const all = [mk('r10', 10), mk('r99', 9.9), mk('r98', 9.8), mk('r97', 9.7), mk('r96', 9.6)];
    const withOrder = settleAndApply([mk('new', 9.7), ...all], {
      justRatedId: 'new',
      explicitOrder: ['r10', 'r99', 'r98', 'new', 'r97', 'r96'],
    });
    const score = (id: string) => withOrder.find((r) => r.restaurantId === id)!.score;
    expect(score('new')).toBeGreaterThan(score('r97'));
  });
});

/* ── normalizeScores (one-shot decompression) ──────────────────────────── */

describe('normalizeScores', () => {
  it('decompresses a crowded top: full spread at maturity, order kept, grid gaps', () => {
    const scores = [10, 9.9, 9.9, 9.8, 9.8, 9.8, 9.7, 9.7, 9.6, 9.6, 9.5, 9.5];
    const all = scores.map((s, i) => mk(`r${String(i).padStart(2, '0')}`, s));
    const next = applySettleChanges(all, normalizeScores(all));
    const rows = tierRows(next, 'loved');
    // Same order (ids were minted in descending-score order).
    expect(rows.map((r) => r.restaurantId)).toEqual(all.map((r) => r.restaurantId));
    // Mature tier (n−1 ≥ K): top anchored at 10, span stretched to the band.
    expect(rows[0].score).toBe(10);
    expect(rows[0].score - rows[rows.length - 1].score).toBeGreaterThanOrEqual(2.5);
    // Strictly descending on the 0.1 grid, inside the band.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].score - rows[i].score).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
    }
    expect(rows[rows.length - 1].score).toBeGreaterThanOrEqual(7.0);
  });

  it('is NOT an even respace: a standout gap stays the largest', () => {
    const all = [mk('a', 10), mk('b', 9.9), mk('c', 9.8), mk('d', 8.5), mk('e', 8.4)];
    const next = applySettleChanges(all, normalizeScores(all));
    const s = (id: string) => next.find((r) => r.restaurantId === id)!.score;
    const gaps = [s('a') - s('b'), s('b') - s('c'), s('c') - s('d'), s('d') - s('e')];
    expect(Math.max(...gaps)).toBe(gaps[2]); // the c→d chasm survives
    expect(gaps[2]).toBeGreaterThan(gaps[0] + 0.1);
  });

  it('anchors disliked to the floor as it matures and keeps tiers contained', () => {
    const disliked = Array.from({ length: 11 }, (_, i) => mk(`d${String(i).padStart(2, '0')}`, 3.9 - i * 0.05));
    const fine = [mk('f1', 5.5), mk('f2', 5.4)];
    const next = applySettleChanges([...disliked, ...fine], normalizeScores([...disliked, ...fine]));
    const dRows = tierRows(next, 'disliked');
    expect(dRows[dRows.length - 1].score).toBe(1);
    expect(dRows[0].score).toBeLessThanOrEqual(3.9);
    for (const r of tierRows(next, 'fine')) {
      expect(r.score).toBeGreaterThanOrEqual(4.0);
      expect(r.score).toBeLessThanOrEqual(6.9);
    }
  });

  it('leaves an already well-spread list essentially alone', () => {
    const all = [mk('a', 9.8), mk('b', 9.2), mk('c', 8.6), mk('d', 8.0)];
    const changes = normalizeScores(all);
    // f = 0.3 → gentle: nothing should move more than a few display steps.
    const next = applySettleChanges(all, changes);
    for (const r of all) {
      const now = next.find((x) => x.restaurantId === r.restaurantId)!.score;
      expect(Math.abs(now - r.score)).toBeLessThanOrEqual(0.4);
    }
  });
});

/* ── Equal-score block insertion (the "always lands at the top" bug) ───── */

describe('equal-score block insertion', () => {
  it('an explicit placement INSIDE an equal block survives the settle (order outranks the nudged score)', () => {
    // a..d imported with identical scores; the search placed e between b
    // and c. Bracketed inside the block, computeFinalScore nudges e one
    // display step off it (7.9) — the old score-first comparator then
    // dumped e below the whole block (or above it when nudged up).
    const all = [mk('e', 7.9), mk('a', 8.0), mk('b', 8.0), mk('c', 8.0), mk('d', 8.0)];
    const next = settleAndApply(all, { justRatedId: 'e', explicitOrder: ['a', 'b', 'e', 'c', 'd'] });
    const byId = Object.fromEntries(next.map((r) => [r.restaurantId, r.score]));
    expect(byId.a).toBeGreaterThan(byId.b);
    expect(byId.b).toBeGreaterThan(byId.e);
    expect(byId.e).toBeGreaterThan(byId.c);
    expect(byId.c).toBeGreaterThan(byId.d);
  });

  it('end-to-end: rating into a 4-equal block through the real search lands mid-block', () => {
    const all = [mk('a', 8.0), mk('b', 8.0), mk('c', 8.0), mk('d', 8.0)];
    // Ground truth: e sits between b and c (beats c/d, loses to a/b).
    const beats = new Set(['c', 'd']);
    let st = initH2H(all, 'loved', 'e');
    let guard = 0;
    while (!isComplete(st)) {
      const comp = pickComparison(st)!;
      st = applyChoice(st, beats.has(comp.restaurantId));
      if (++guard > 20) throw new Error('did not terminate');
    }
    const raw = computeFinalScore(st);
    const order = placementOrder(st, 'e', raw);
    expect(order).toEqual(['a', 'b', 'e', 'c', 'd']);
    const next = settleAndApply(
      [mk('e', raw), ...all],
      { justRatedId: 'e', explicitOrder: order },
    );
    // The plain score sort every list uses reproduces the placement exactly.
    const sorted = [...next].sort((x, y) => y.score - x.score).map((r) => r.restaurantId);
    expect(sorted).toEqual(['a', 'b', 'e', 'c', 'd']);
  });

  it('overflow: a mid-block insert stays mid-block and scores are STRICTLY descending', () => {
    // 40 loved rows — past the 31-slot 0.1 grid. The old uniform fill
    // rounded to duplicate scores, so display sorts (stable, with the
    // just-rated row at the array head) showed the new row at the TOP of
    // its equal run instead of where the comparisons placed it.
    const all = Array.from({ length: 40 }, (_, i) => mk(`r${String(i).padStart(2, '0')}`, round1(10 - (i * 3) / 39)));
    const order = all.map((r) => r.restaurantId);
    order.splice(20, 0, 'new'); // placed between r19 and r20
    const next = settleAndApply(
      [mk('new', all[20].score), ...all],
      { justRatedId: 'new', explicitOrder: order },
    );
    const rows = tierRows(next, 'loved');
    for (let i = 0; i < rows.length - 1; i++) {
      expect(rows[i].score).toBeGreaterThan(rows[i + 1].score); // no duplicates
    }
    expect(rows.map((r) => r.restaurantId)).toEqual(order);
    // Idempotent: settling the settled layout again moves nothing.
    expect(settleScores(next, { justRatedId: 'new', explicitOrder: order })).toEqual([]);
  });
});
