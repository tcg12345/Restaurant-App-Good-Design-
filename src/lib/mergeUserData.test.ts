import { describe, it, expect } from 'vitest';
import type { RestaurantRating, CustomList, WishlistItem, Trip, HomeMeal } from '../contexts/ListsContext';
import {
  unionIds,
  mergeById,
  mergeRatings,
  mergeLists,
  mergeWishlist,
  mergeTrips,
  mergeHomeMeals,
} from './mergeUserData';

/* ── Fixtures ──────────────────────────────────────────────────────────── */

function rating(id: string, over: Partial<RestaurantRating> = {}): RestaurantRating {
  return {
    restaurantId: id, name: id, image: '', cuisine: '', price: '', address: '',
    score: 5, notes: '', visitDate: '', wouldReturn: true, tags: [], photos: [],
    listIds: [], friendIds: [], createdAt: 1000, ...over,
  };
}
function list(id: string, over: Partial<CustomList> = {}): CustomList {
  return { id, name: id, emoji: '📍', restaurantIds: [], wishlistIds: [], recipes: [], createdAt: 1000, ...over };
}
function wish(id: string, over: Partial<WishlistItem> = {}): WishlistItem {
  return { restaurantId: id, name: id, image: '', cuisine: '', price: '', address: '', notes: '', listIds: [], addedAt: 1000, ...over };
}
function trip(id: string, over: Partial<Trip> = {}): Trip {
  return {
    id, name: id, destination: '', destinationLat: 0, destinationLng: 0, startDate: '', endDate: '',
    restaurants: [], status: 'planning', createdAt: 1000, ...over,
  };
}
function meal(id: string, over: Partial<HomeMeal> = {}): HomeMeal {
  return {
    id, name: id, date: '', score: 5, wouldMakeAgain: true, description: '', photos: [],
    tags: [], dishes: [], isPublic: false, createdAt: 1000, ...over,
  };
}

/* ── unionIds ──────────────────────────────────────────────────────────── */

describe('unionIds', () => {
  it('unions preserving primary order then secondary extras', () => {
    expect(unionIds(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });
  it('dedupes and drops falsy', () => {
    expect(unionIds(['a', 'a', ''], ['', 'a', 'b'])).toEqual(['a', 'b']);
  });
  it('handles undefined inputs', () => {
    expect(unionIds(undefined, ['x'])).toEqual(['x']);
    expect(unionIds(['x'], undefined)).toEqual(['x']);
    expect(unionIds(undefined, undefined)).toEqual([]);
  });
});

/* ── mergeById (generic) ───────────────────────────────────────────────── */

describe('mergeById', () => {
  const getId = (e: Record<string, unknown>) => e.id as string;

  it('keeps disjoint entries from both sides (cloud order, then local-only)', () => {
    const local = [{ id: 'L', createdAt: 1 }];
    const cloud = [{ id: 'C', createdAt: 1 }];
    expect(mergeById(local, cloud, getId).map((e) => e.id)).toEqual(['C', 'L']);
  });

  it('on id conflict keeps the entry with the newer updatedAt', () => {
    const local = [{ id: 'X', createdAt: 1, updatedAt: 200, v: 'local' }];
    const cloud = [{ id: 'X', createdAt: 1, updatedAt: 100, v: 'cloud' }];
    expect(mergeById(local, cloud, getId)).toEqual([{ id: 'X', createdAt: 1, updatedAt: 200, v: 'local' }]);
  });

  it('falls back to createdAt when updatedAt absent', () => {
    const local = [{ id: 'X', createdAt: 50, v: 'local' }];
    const cloud = [{ id: 'X', createdAt: 100, v: 'cloud' }];
    expect(mergeById(local, cloud, getId)[0].v).toBe('cloud');
  });

  it('updatedAt beats a higher createdAt on the other side', () => {
    const local = [{ id: 'X', createdAt: 1, updatedAt: 500, v: 'local-edited' }];
    const cloud = [{ id: 'X', createdAt: 400, v: 'cloud-old' }];
    expect(mergeById(local, cloud, getId)[0].v).toBe('local-edited');
  });

  it('local wins exact-timestamp ties — the device in the user\'s hand is authoritative', () => {
    const local = [{ id: 'X', createdAt: 100, v: 'local' }];
    const cloud = [{ id: 'X', createdAt: 100, v: 'cloud' }];
    expect(mergeById(local, cloud, getId)[0].v).toBe('local');
  });

  it('an offline edit that stamped updatedAt beats an un-stamped stale cloud copy', () => {
    // The entity predates updatedAt, so both sides carry only the shared
    // createdAt — until the local device edits it and stamps updatedAt. That
    // stamp must let the edit win (the H1 data-loss fix).
    const local = [{ id: 'X', createdAt: 1000, updatedAt: 1000_005, v: 'edited-offline' }];
    const cloud = [{ id: 'X', createdAt: 1000, v: 'stale-cloud' }];
    expect(mergeById(local, cloud, getId)[0].v).toBe('edited-offline');
  });

  it('skips entries with no id', () => {
    const local = [{ id: '', v: 'noid' }, { id: 'A', v: 'a' }];
    const cloud: Record<string, unknown>[] = [];
    expect(mergeById(local, cloud, getId).map((e) => e.id)).toEqual(['A']);
  });

  it('applies the combine callback with (winner, loser)', () => {
    const local = [{ id: 'X', updatedAt: 2, tags: ['local'] }];
    const cloud = [{ id: 'X', updatedAt: 1, tags: ['cloud'] }];
    const merged = mergeById(local, cloud, getId, (w, l) => ({
      ...w, tags: [...(w.tags as string[]), ...(l.tags as string[])],
    }));
    expect(merged[0].tags).toEqual(['local', 'cloud']);
  });
});

/* ── mergeRatings ──────────────────────────────────────────────────────── */

describe('mergeRatings', () => {
  it('disjoint: keeps every rating from both devices', () => {
    const merged = mergeRatings([rating('local1')], [rating('cloud1')]);
    expect(merged.map((r) => r.restaurantId).sort()).toEqual(['cloud1', 'local1']);
  });

  it('overlapping: newer local edit wins over stale cloud copy', () => {
    const local = [rating('r1', { score: 9, updatedAt: 500, notes: 'edited here' })];
    const cloud = [rating('r1', { score: 4, updatedAt: 100, notes: 'old' })];
    const merged = mergeRatings(local, cloud);
    expect(merged).toHaveLength(1);
    expect(merged[0].score).toBe(9);
    expect(merged[0].notes).toBe('edited here');
  });

  it('overlapping: newer cloud edit wins over stale local copy', () => {
    const local = [rating('r1', { score: 3, updatedAt: 100 })];
    const cloud = [rating('r1', { score: 8, updatedAt: 900 })];
    expect(mergeRatings(local, cloud)[0].score).toBe(8);
  });

  it('unions listIds/friendIds regardless of which side is newer', () => {
    // Same restaurant added to list A on the (newer) local device and to
    // list B on the cloud device — both memberships must survive.
    const local = [rating('r1', { updatedAt: 500, listIds: ['A'], friendIds: ['f1'] })];
    const cloud = [rating('r1', { updatedAt: 100, listIds: ['B'], friendIds: ['f2'] })];
    const merged = mergeRatings(local, cloud);
    expect(merged[0].listIds.sort()).toEqual(['A', 'B']);
    expect(merged[0].friendIds.sort()).toEqual(['f1', 'f2']);
  });

  it('reproduces the C5 bug fix: an edit made on a fresh second device is not lost', () => {
    // Device 2 has empty local, cloud has r1@score4. User re-rates r1 to 9
    // (updatedAt now) BEFORE the load merges. localRatings = [r1@9], cloud = [r1@4].
    const local = [rating('r1', { score: 9, updatedAt: 999 })];
    const cloud = [rating('r1', { score: 4, updatedAt: 100 }), rating('r2', { score: 7, updatedAt: 100 })];
    const merged = mergeRatings(local, cloud);
    // Both cloud ratings survive AND the new edit wins.
    expect(merged.map((r) => r.restaurantId).sort()).toEqual(['r1', 'r2']);
    expect(merged.find((r) => r.restaurantId === 'r1')!.score).toBe(9);
    expect(merged.find((r) => r.restaurantId === 'r2')!.score).toBe(7);
  });

  it('empty local leaves cloud untouched (and vice versa)', () => {
    expect(mergeRatings([], [rating('a'), rating('b')]).map((r) => r.restaurantId)).toEqual(['a', 'b']);
    expect(mergeRatings([rating('a')], []).map((r) => r.restaurantId)).toEqual(['a']);
    expect(mergeRatings([], [])).toEqual([]);
  });
});

/* ── mergeLists ────────────────────────────────────────────────────────── */

describe('mergeLists', () => {
  it('unions restaurantIds and wishlistIds across devices', () => {
    const local = [list('l1', { updatedAt: 200, restaurantIds: ['a'], wishlistIds: ['w1'] } as Partial<CustomList>)];
    const cloud = [list('l1', { createdAt: 100, restaurantIds: ['b'], wishlistIds: ['w2'] })];
    const merged = mergeLists(local, cloud);
    expect(merged[0].restaurantIds.sort()).toEqual(['a', 'b']);
    expect(merged[0].wishlistIds.sort()).toEqual(['w1', 'w2']);
  });

  it('merges each list\'s recipes by id (union, newer wins)', () => {
    const localList = list('l1', {
      recipes: [{ id: 'rec1', title: 'edited', updatedAt: 500 } as any, { id: 'rec2', title: 'local-only' } as any],
    } as Partial<CustomList>);
    const cloudList = list('l1', {
      recipes: [{ id: 'rec1', title: 'stale', updatedAt: 100 } as any],
    });
    const merged = mergeLists([localList], [cloudList]);
    const ids = merged[0].recipes!.map((r) => r.id).sort();
    expect(ids).toEqual(['rec1', 'rec2']);
    expect(merged[0].recipes!.find((r) => r.id === 'rec1')!.title).toBe('edited');
  });

  it('appends a list created only on the local device', () => {
    const merged = mergeLists([list('local-new')], [list('cloud1')]);
    expect(merged.map((l) => l.id).sort()).toEqual(['cloud1', 'local-new']);
  });

  it('keeps the newer name on scalar conflict', () => {
    const local = [list('l1', { name: 'Renamed', updatedAt: 900 } as Partial<CustomList>)];
    const cloud = [list('l1', { name: 'Old', createdAt: 100 })];
    expect(mergeLists(local, cloud)[0].name).toBe('Renamed');
  });
});

/* ── mergeWishlist ─────────────────────────────────────────────────────── */

describe('mergeWishlist', () => {
  it('disjoint hearts from both devices both survive', () => {
    const merged = mergeWishlist([wish('a')], [wish('b')]);
    expect(merged.map((w) => w.restaurantId).sort()).toEqual(['a', 'b']);
  });
  it('unions listIds on conflict (addedAt as the timestamp)', () => {
    const local = [wish('a', { addedAt: 300, listIds: ['L1'] })];
    const cloud = [wish('a', { addedAt: 100, listIds: ['L2'] })];
    expect(mergeWishlist(local, cloud)[0].listIds.sort()).toEqual(['L1', 'L2']);
  });
});

/* ── mergeTrips / mergeHomeMeals ───────────────────────────────────────── */

describe('mergeTrips', () => {
  it('disjoint trips survive; conflict keeps newer', () => {
    const local = [trip('t1', { name: 'new', createdAt: 500 }), trip('t2')];
    const cloud = [trip('t1', { name: 'old', createdAt: 100 }), trip('t3')];
    const merged = mergeTrips(local, cloud);
    expect(merged.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
    expect(merged.find((t) => t.id === 't1')!.name).toBe('new');
  });

  it('a trip note edited offline (updatedAt stamped) survives over the stale cloud copy', () => {
    // The H1 verify scenario: same createdAt on both sides; the local device
    // edited the note and stamped updatedAt, so the edit must win.
    const local = [trip('t1', { notes: 'edited offline', createdAt: 1000, updatedAt: 2000 } as Partial<Trip>)];
    const cloud = [trip('t1', { notes: 'stale', createdAt: 1000 })];
    expect(mergeTrips(local, cloud)[0].notes).toBe('edited offline');
  });

  it('equal timestamps break toward the local trip', () => {
    const local = [trip('t1', { notes: 'local', createdAt: 1000 })];
    const cloud = [trip('t1', { notes: 'cloud', createdAt: 1000 })];
    expect(mergeTrips(local, cloud)[0].notes).toBe('local');
  });
});

describe('mergeHomeMeals', () => {
  it('disjoint meals survive; conflict keeps newer by updatedAt then createdAt', () => {
    const local = [meal('m1', { name: 'edited', createdAt: 100, updatedAt: 900 } as Partial<HomeMeal>), meal('m2')];
    const cloud = [meal('m1', { name: 'old', createdAt: 100 }), meal('m3')];
    const merged = mergeHomeMeals(local, cloud);
    expect(merged.map((m) => m.id).sort()).toEqual(['m1', 'm2', 'm3']);
    expect(merged.find((m) => m.id === 'm1')!.name).toBe('edited');
  });

  it('an offline home-meal edit (updatedAt stamped) wins over the same-createdAt cloud copy', () => {
    const local = [meal('m1', { name: 'edited offline', createdAt: 1000, updatedAt: 1500 } as Partial<HomeMeal>)];
    const cloud = [meal('m1', { name: 'stale', createdAt: 1000 })];
    expect(mergeHomeMeals(local, cloud)[0].name).toBe('edited offline');
  });
});
