import { describe, it, expect } from 'vitest';
import type { RestaurantRating } from '../contexts/ListsContext';
import { applyRatingSave } from './applyRatingSave';

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

/** Mirrors ListsContext.rateRestaurant's wiring: a ref threads each save's
 *  `next` into the following call, and each call's `next` is what gets
 *  persisted to localStorage and mirrored to the cloud (last write wins). */
function makeSaveHarness(initial: RestaurantRating[]) {
  const ref = { current: initial };
  let persisted: RestaurantRating[] = initial;
  return {
    ref,
    save(rating: RestaurantRating, opts?: { now?: number; settleOrder?: string[] }) {
      const result = applyRatingSave(ref.current, rating, { now: opts?.now ?? 1000, settleOrder: opts?.settleOrder });
      ref.current = result.next;
      persisted = result.next;
      return result;
    },
    get persisted() { return persisted; },
  };
}

const ids = (rows: RestaurantRating[]) => rows.map((r) => r.restaurantId).sort();

/* ── The H2 regression: two saves in one tick ──────────────────────────── */

describe('same-tick save serialization (rateRestaurant flow)', () => {
  it('keeps BOTH rows when two different restaurants are saved in one tick', () => {
    const h = makeSaveHarness([]);
    h.save(mk('a', 8.4));
    h.save(mk('b', 5.1));
    // Both the state array and the persisted/cloud payload (the last write)
    // must contain both saves — deriving each save from the same pre-save
    // snapshot dropped the first one everywhere.
    expect(ids(h.ref.current)).toEqual(['a', 'b']);
    expect(ids(h.persisted)).toEqual(['a', 'b']);
  });

  it('survives a bulk-import-sized burst without losing any row', () => {
    const h = makeSaveHarness([]);
    for (let i = 0; i < 25; i++) h.save(mk(`r${String(i).padStart(2, '0')}`, 1 + (i % 10)));
    expect(h.persisted).toHaveLength(25);
  });

  it('composes with pre-existing ratings and reports wasRated correctly', () => {
    const h = makeSaveHarness([mk('old', 7.5)]);
    const first = h.save(mk('new', 8.0));
    const second = h.save(mk('old', 6.0));
    expect(first.existing).toBeUndefined();
    expect(second.existing?.restaurantId).toBe('old');
    expect(ids(h.persisted)).toEqual(['new', 'old']);
  });

  it('re-saving the same restaurant twice in one tick keeps one row, last save winning', () => {
    const h = makeSaveHarness([]);
    h.save(mk('a', 8.0, { notes: 'first' }));
    const second = h.save(mk('a', 8.0, { notes: 'second' }));
    expect(h.persisted).toHaveLength(1);
    expect(h.persisted[0].notes).toBe('second');
    // The second call must see the first save as the existing row.
    expect(second.existing?.notes).toBe('first');
  });
});

/* ── Derivation details preserved from the inline version ──────────────── */

describe('applyRatingSave derivation', () => {
  it('stamps updatedAt on the saved row', () => {
    const { next } = applyRatingSave([], mk('a', 8.0), { now: 42 });
    expect(next[0].updatedAt).toBe(42);
  });

  it('does not settle on a note-only edit (same score)', () => {
    const prev = [mk('a', 9.9), mk('b', 9.8), mk('c', 9.7)];
    const { next, otherChanged } = applyRatingSave(prev, mk('b', 9.8, { notes: 'edited' }), { now: 1 });
    expect(otherChanged).toEqual([]);
    for (const r of prev) {
      expect(next.find((n) => n.restaurantId === r.restaurantId)?.score).toBe(r.score);
    }
  });

  it('settledSelf reflects the post-settle score and otherChanged excludes self', () => {
    // A crowded tier forces the settle to move neighbors.
    const prev = [mk('a', 9.9), mk('b', 9.9), mk('c', 9.8), mk('d', 9.8)];
    const result = applyRatingSave(prev, mk('e', 9.9), { now: 1 });
    const selfRow = result.next.find((r) => r.restaurantId === 'e');
    expect(result.settledSelf).toEqual(selfRow);
    expect(result.otherChanged.every((c) => c.restaurantId !== 'e')).toBe(true);
    // Rows the settle moved were stamped as modified too.
    for (const c of result.otherChanged) {
      expect(result.next.find((r) => r.restaurantId === c.restaurantId)?.updatedAt).toBe(1);
    }
  });
});
