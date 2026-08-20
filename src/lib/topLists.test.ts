import { describe, it, expect } from 'vitest';
import {
  cityFromAddress, topListKey, parseTopListKey, topListMetaText, buildTopList,
  deriveTopLists, MIN_LIST_SIZE, type TopListRating, type TopListCustomization,
} from './topLists';

const r = (over: Partial<TopListRating> & { restaurantId: string; score: number }): TopListRating => ({
  name: over.restaurantId, cuisine: '', price: '', address: '', tags: [], ...over,
});

const NONE: TopListCustomization = { hidden: [], custom: [], order: [] };

describe('cityFromAddress', () => {
  it('takes the middle part of a three-part address, not the state', () => {
    expect(cityFromAddress('181 Thompson St, New York, NY 10012')).toBe('New York');
  });
  it('takes the last part of a two-part address', () => {
    expect(cityFromAddress('8 Quai du Louvre, Paris')).toBe('Paris');
  });
  it('is null for nothing', () => {
    expect(cityFromAddress('')).toBeNull();
  });
});

describe('topListKey / parseTopListKey', () => {
  it('round-trips every slice type', () => {
    for (const c of [
      { type: 'overall' } as const,
      { type: 'cuisine', value: 'Japanese' } as const,
      { type: 'city', value: 'New York' } as const,
      { type: 'price', value: '$$$$' } as const,
      { type: 'tag', value: 'Date night' } as const,
    ]) {
      expect(parseTopListKey(topListKey(c))).toEqual(c);
    }
  });

  // A city can legitimately contain a colon-free comma but the value is the
  // whole remainder, so "city:Washington, DC" must survive intact.
  it('keeps everything after the first colon as the value', () => {
    expect(parseTopListKey('city:Washington, DC')).toEqual({ type: 'city', value: 'Washington, DC' });
  });

  it('rejects junk rather than inventing a list', () => {
    expect(parseTopListKey('')).toBeNull();
    expect(parseTopListKey('nonsense')).toBeNull();
    expect(parseTopListKey('cuisine:')).toBeNull();
    expect(parseTopListKey(':Japanese')).toBeNull();
  });
});

describe('topListMetaText', () => {
  const rating = r({ restaurantId: 'a', score: 9, cuisine: 'Japanese', price: '$$$', address: '1 A St, New York, NY' });
  it("drops the facet the list already states", () => {
    expect(topListMetaText({ type: 'cuisine', value: 'Japanese' }, rating)).toBe('New York · $$$');
    expect(topListMetaText({ type: 'city', value: 'New York' }, rating)).toBe('Japanese · $$$');
    expect(topListMetaText({ type: 'price', value: '$$$' }, rating)).toBe('Japanese · New York');
  });
  it('defers to the default line for overall and tags', () => {
    expect(topListMetaText({ type: 'overall' }, rating)).toBeUndefined();
    expect(topListMetaText({ type: 'tag', value: 'x' }, rating)).toBeUndefined();
  });
});

describe('buildTopList', () => {
  const ratings = [
    r({ restaurantId: 'low', score: 6 }),
    r({ restaurantId: 'high', score: 9.4 }),
    r({ restaurantId: 'mid', score: 8 }),
  ];

  it('ranks by score and reports the full set alongside the preview', () => {
    const list = buildTopList({ type: 'overall' }, ratings, 2)!;
    expect(list.all.map((x) => x.restaurantId)).toEqual(['high', 'mid', 'low']);
    expect(list.items.map((x) => x.restaurantId)).toEqual(['high', 'mid']);
    expect(list.total).toBe(3);
    expect(list.avg).toBeCloseTo((6 + 9.4 + 8) / 3);
  });

  it('is null when nothing matches, so empty slices can be dropped', () => {
    expect(buildTopList({ type: 'cuisine', value: 'Thai' }, ratings)).toBeNull();
  });
});

describe('deriveTopLists', () => {
  // MIN_LIST_SIZE ratings of a cuisine earn it a list; fewer do not.
  const ratings = [
    ...Array.from({ length: MIN_LIST_SIZE }, (_, i) =>
      r({ restaurantId: `jp${i}`, score: 9 - i * 0.1, cuisine: 'Japanese', address: '1 A St, New York, NY' })),
    r({ restaurantId: 'thai', score: 7, cuisine: 'Thai', address: '2 B St, Boston, MA' }),
  ];

  // The four Japanese places share a city, so New York clears the
  // threshold too — cuisines lead, cities follow.
  it('seeds overall plus every cuisine and city over the threshold', () => {
    const { lists } = deriveTopLists(ratings, NONE);
    expect(lists.map((l) => l.key)).toEqual(['overall', 'cuisine:Japanese', 'city:New York']);
    expect(lists[0].total).toBe(MIN_LIST_SIZE + 1);
  });

  it('leaves a cuisine below the threshold out until it is added by hand', () => {
    const { lists } = deriveTopLists(ratings, NONE);
    expect(lists.map((l) => l.key)).not.toContain('cuisine:Thai');
  });

  it('honours a hidden list and a hand-added slice', () => {
    const { lists } = deriveTopLists(ratings, {
      hidden: ['cuisine:Japanese'],
      custom: [{ type: 'cuisine', value: 'Thai' }],
      order: [],
    });
    expect(lists.map((l) => l.key)).toEqual(['overall', 'city:New York', 'cuisine:Thai']);
  });

  it('applies the saved order, leaving unknown keys at the end', () => {
    const { lists } = deriveTopLists(ratings, { ...NONE, order: ['cuisine:Japanese'] });
    expect(lists.map((l) => l.key)).toEqual(['cuisine:Japanese', 'overall', 'city:New York']);
  });

  // The card and the page it opens must agree, so the key on a card has to
  // resolve back to the same list.
  it('every list key resolves back to that same list', () => {
    const { lists } = deriveTopLists(ratings, NONE);
    for (const list of lists) {
      const config = parseTopListKey(list.key)!;
      expect(buildTopList(config, ratings)!.all.map((x) => x.restaurantId))
        .toEqual(list.all.map((x) => x.restaurantId));
    }
  });
});
