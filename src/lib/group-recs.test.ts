import { describe, it, expect } from 'vitest';
import {
  aggregateGroup, groupVeto, groupCentroid, groupVerdict, fitOf,
  FAIRNESS, type GroupMember,
} from './group-recs';
import { buildTasteProfile } from './recommendations';
import type { RestaurantRating } from '../contexts/ListsContext';

const rating = (over: Partial<RestaurantRating> & { restaurantId: string }): RestaurantRating => ({
  name: over.restaurantId, image: '', cuisine: 'Italian', price: '$$', address: 'New York, NY',
  score: 8, notes: '', visitDate: '', wouldReturn: true, tags: [], photos: [],
  listIds: [], friendIds: [], createdAt: Date.now(), updatedAt: Date.now(), ...over,
} as RestaurantRating);

/** A member whose spending sits squarely in one tier. */
const memberAt = (userId: string, priceSigns: string, over: Partial<GroupMember> = {}): GroupMember => ({
  userId,
  name: userId,
  profile: buildTasteProfile(
    Array.from({ length: 12 }, (_, i) =>
      rating({ restaurantId: `${userId}-${i}`, price: priceSigns, score: 8 + (i % 3) * 0.3 })),
    [], [], [],
  ),
  ...over,
});

const M = (userId: string): GroupMember => ({
  userId, name: userId, profile: buildTasteProfile([], [], [], []),
});

describe('aggregateGroup', () => {
  it('sits between the mean and the minimum, never outside them', () => {
    const members = [M('a'), M('b'), M('c')];
    const s = aggregateGroup(members, [9, 8, 6]);
    expect(s.mean).toBeCloseTo(23 / 3, 5);
    expect(s.min).toBe(6);
    expect(s.group).toBeGreaterThan(s.min);
    expect(s.group).toBeLessThan(s.mean);
  });

  it('prefers the option nobody dislikes over the higher average', () => {
    const members = [M('a'), M('b')];
    // Divisive: great for one, poor for the other. Consensus: good for both.
    const divisive = aggregateGroup(members, [9.6, 5.6]);
    const consensus = aggregateGroup(members, [7.4, 7.3]);
    expect(divisive.mean).toBeGreaterThan(consensus.mean);   // averaging picks the divisive one…
    expect(consensus.group).toBeGreaterThan(divisive.group); // …fairness does not.
  });

  it('reports spread and who is left out', () => {
    const s = aggregateGroup([M('a'), M('b'), M('c')], [9, 8.2, 5.5]);
    expect(s.spread).toBeCloseTo(3.5, 5);
    expect(s.everyoneIn).toBe(false);
    expect(s.fits.find((f) => f.userId === 'c')!.fit).toBe('poor');
    expect(s.fits.find((f) => f.userId === 'a')!.fit).toBe('loves');
  });

  it('counts a missing prediction against the group instead of averaging over it', () => {
    // Members are scored with their history kept, so a gap means that
    // member's own price band excluded the place — negative information.
    const withGap = aggregateGroup([M('a'), M('b')], [9.2, undefined]);
    const both = aggregateGroup([M('a'), M('b')], [9.2, 9.2]);
    expect(withGap.group).toBeLessThan(both.group);
    expect(withGap.fits[1].fit).toBe('poor');
    expect(withGap.everyoneIn).toBe(false);
  });

  it('collapses to the individual score for a group of one', () => {
    const s = aggregateGroup([M('a')], [8.4]);
    expect(s.group).toBeCloseTo(8.4, 5);
    expect(s.everyoneIn).toBe(true);
  });

  it('returns a zero score rather than NaN when nobody could be scored', () => {
    const s = aggregateGroup([M('a'), M('b')], [undefined, undefined]);
    expect(s.group).toBe(0);
    expect(s.fits).toEqual([]);
  });

  it('honours the fairness knob at both extremes', () => {
    const members = [M('a'), M('b')];
    expect(aggregateGroup(members, [9, 6], 0).group).toBeCloseTo(7.5, 5);   // pure mean
    expect(aggregateGroup(members, [9, 6], 1).group).toBeCloseTo(6, 5);     // pure least-misery
    expect(FAIRNESS).toBeGreaterThan(0);
    expect(FAIRNESS).toBeLessThan(1);
  });
});

describe('fitOf', () => {
  it('names the three states a member can be in', () => {
    expect(fitOf(8.5)).toBe('loves');
    expect(fitOf(7)).toBe('fine');
    expect(fitOf(5.4)).toBe('poor');
  });
});

describe('groupVeto', () => {
  const veg: GroupMember = { ...M('dev'), dietary: ['vegetarian'] };

  it('vetoes a steakhouse for a vegetarian', () => {
    expect(groupVeto({ cuisine: 'Steakhouse', priceLevel: 3 }, [M('a'), veg]))
      .toEqual({ reason: 'dietary', userId: 'dev' });
  });

  it('does NOT veto one the community says has vegetarian options', () => {
    expect(groupVeto(
      { cuisine: 'Steakhouse', priceLevel: 3, tags: ['Good Vegetarian Options'] },
      [M('a'), veg],
    )).toBeNull();
  });

  it('leaves ordinary cuisines alone — a veto is a strong claim', () => {
    expect(groupVeto({ cuisine: 'Italian', priceLevel: 2 }, [M('a'), veg])).toBeNull();
    expect(groupVeto({ cuisine: 'Japanese', priceLevel: 3 }, [M('a'), veg])).toBeNull();
  });

  it('vetoes a price tier nobody in the group spends in', () => {
    const cheap = memberAt('cheap', '$');
    const alsoCheap = memberAt('cheap2', '$');
    const v = groupVeto({ cuisine: 'French', priceLevel: 4 }, [cheap, alsoCheap]);
    expect(v?.reason).toBe('price');
  });

  it('keeps a tier when ANY member spends there — that is a low score, not a veto', () => {
    const cheap = memberAt('cheap', '$');
    const lavish = memberAt('lavish', '$$$$');
    expect(groupVeto({ cuisine: 'French', priceLevel: 4 }, [cheap, lavish])).toBeNull();
  });

  it('never vetoes on price for a member with no demonstrated band', () => {
    expect(groupVeto({ cuisine: 'French', priceLevel: 4 }, [M('cold')])).toBeNull();
  });
});

describe('groupCentroid', () => {
  it('averages the members who have coordinates', () => {
    expect(groupCentroid([{ lat: 0, lng: 0 }, { lat: 2, lng: 4 }])).toEqual({ lat: 1, lng: 2 });
  });

  it('skips members without coordinates instead of pulling toward null island', () => {
    const c = groupCentroid([{ lat: 40, lng: -74 }, { lat: null, lng: null }, {}]);
    expect(c).toEqual({ lat: 40, lng: -74 });
  });

  it('returns null when nobody has one', () => {
    expect(groupCentroid([{}, { lat: null, lng: undefined }])).toBeNull();
  });
});

describe('groupVerdict', () => {
  const name = (id: string) => ({ a: 'Maya', b: 'Dev', c: 'Sam' }[id] || id);

  it('leads with the honest headline', () => {
    expect(groupVerdict(aggregateGroup([M('a'), M('b')], [8.6, 8.2]), name)).toBe('Everyone loves this');
    expect(groupVerdict(aggregateGroup([M('a'), M('b')], [8.6, 7.0]), name)).toBe('Everyone’s in');
    expect(groupVerdict(aggregateGroup([M('a'), M('b')], [8.6, 5.4]), name)).toBe('Not really Dev’s thing');
    expect(groupVerdict(aggregateGroup([M('a'), M('b'), M('c')], [8.6, 5.4, 5.1]), name)).toBe('Not for 2 of you');
  });
});
