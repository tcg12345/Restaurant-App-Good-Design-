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

  it('hotels and restaurants settle independently', () => {
    const all = [
      mk('r1', 9.0), mk('r2', 9.0),
      mk('h1', 9.0, { cuisine: 'Hotel Breakfast' }),
      mk('h2', 9.0, { cuisine: 'Hotel Breakfast' }),
    ];
    const changes = settleScores(all, { justRatedId: 'r2' });
    expect(changes.every((c) => c.restaurantId.startsWith('r'))).toBe(true);
    const hotelChanges = settleScores(all, { justRatedId: 'h2' });
    expect(hotelChanges.every((c) => c.restaurantId.startsWith('h'))).toBe(true);
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
