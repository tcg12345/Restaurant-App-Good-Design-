import { describe, it, expect, beforeEach, vi } from 'vitest';

const { rows, upserts, upsert } = vi.hoisted(() => ({
  rows: [] as Array<{ restaurant_id: string; cuisine: string; source: string; confidence: number }>,
  upserts: [] as Array<{ restaurant_id: string; cuisine: string; source: string }>,
  upsert: vi.fn(),
}));

vi.mock('./supabase', () => ({
  supabaseConfigured: true,
  supabase: {
    from: () => ({
      select: () => ({
        in: async (_col: string, ids: string[]) => ({
          data: rows.filter((r) => ids.includes(r.restaurant_id)),
          error: null,
        }),
      }),
      upsert: (row: { restaurant_id: string; cuisine: string; source: string }) => {
        upsert(row);
        upserts.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

import {
  settleRestaurantCuisine, publishRestaurantCuisine, getRestaurantCuisineBatch,
  cuisineConfidence, PERSIST_CONFIDENCE_FLOOR,
} from './restaurant-cuisine';

/** A rural place: Google knows it's a restaurant and nothing more. */
const OPAQUE = { types: ['restaurant', 'point_of_interest', 'establishment'] };

beforeEach(() => { rows.length = 0; upserts.length = 0; upsert.mockClear(); });

describe('settleRestaurantCuisine', () => {
  it('takes Michelin over everything and contributes it', async () => {
    expect(await settleRestaurantCuisine({
      restaurantId: 'p1', name: 'Plénitude', michelinCuisine: 'Creative',
      place: { primaryType: 'french_restaurant' },
    })).toBe('Creative');
    expect(upserts).toEqual([{ restaurant_id: 'p1', cuisine: 'Creative', source: 'michelin' }]);
  });

  it("contributes Google's own answer as `google`", async () => {
    expect(await settleRestaurantCuisine({
      restaurantId: 'p2', name: 'Smokehouse 12',
      place: { types: ['restaurant'], primaryType: 'barbecue_restaurant' },
    })).toBe('BBQ');
    expect(upserts).toEqual([{ restaurant_id: 'p2', cuisine: 'BBQ', source: 'google' }]);
  });

  it('marks an off-taxonomy display name as the weaker `google_display`', async () => {
    expect(await settleRestaurantCuisine({
      restaurantId: 'p3', place: { types: ['restaurant'], primaryTypeDisplayName: 'Chophouse' },
    })).toBe('Chophouse');
    expect(upserts[0].source).toBe('google_display');
  });

  // The case the whole cache exists for: Google has nothing, but somebody
  // else already answered this place.
  it('falls back to what other people have published, and adds nothing', async () => {
    rows.push({ restaurant_id: 'p4', cuisine: 'Peruvian', source: 'community', confidence: 80 });
    expect(await settleRestaurantCuisine({ restaurantId: 'p4', name: 'Nowhere Grill', place: OPAQUE }))
      .toBe('Peruvian');
    expect(upserts).toEqual([]);
  });

  it('reads the name only when nothing else knows, and ranks it lowest', async () => {
    expect(await settleRestaurantCuisine({ restaurantId: 'p5', name: 'Taqueria El Sol', place: OPAQUE }))
      .toBe('Mexican');
    expect(upserts).toEqual([{ restaurant_id: 'p5', cuisine: 'Mexican', source: 'name' }]);
    expect(cuisineConfidence('name')).toBeLessThan(cuisineConfidence('community_single'));
  });

  it('prefers a published answer over its own guess about the name', async () => {
    rows.push({ restaurant_id: 'p6', cuisine: 'Seafood', source: 'user', confidence: 100 });
    expect(await settleRestaurantCuisine({ restaurantId: 'p6', name: 'Taqueria El Sol', place: OPAQUE }))
      .toBe('Seafood');
    expect(upserts).toEqual([]);
  });

  it("gives up honestly when the name says nothing either", async () => {
    expect(await settleRestaurantCuisine({ restaurantId: 'p7', name: 'The Farmhouse', place: OPAQUE })).toBe('');
    expect(upserts).toEqual([]);
  });

  it('needs an id', async () => {
    expect(await settleRestaurantCuisine({ restaurantId: '', name: 'Taqueria El Sol' })).toBe('');
    expect(upserts).toEqual([]);
  });
});

describe('publishRestaurantCuisine', () => {
  it('never spends a write on the non-answer', () => {
    publishRestaurantCuisine('x', 'Restaurant', 'google');
    publishRestaurantCuisine('x', '   ', 'google');
    publishRestaurantCuisine('', 'Thai', 'google');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('trims what it does send', () => {
    publishRestaurantCuisine('x', '  Thai  ', 'community');
    expect(upserts).toEqual([{ restaurant_id: 'x', cuisine: 'Thai', source: 'community' }]);
  });
});

describe('getRestaurantCuisineBatch', () => {
  it('keys the answers by place id', async () => {
    rows.push(
      { restaurant_id: 'a', cuisine: 'Thai', source: 'community', confidence: 80 },
      { restaurant_id: 'b', cuisine: 'Diner', source: 'name', confidence: 30 },
    );
    const out = await getRestaurantCuisineBatch(['a', 'b', 'missing']);
    expect(Object.keys(out).sort()).toEqual(['a', 'b']);
    expect(out.a).toEqual({ cuisine: 'Thai', source: 'community', confidence: 80 });
  });

  // The floor is what stops a name guess being written into a user's rating.
  it('a name guess sits below the persist floor and a human answer above it', async () => {
    expect(cuisineConfidence('name')).toBeLessThan(PERSIST_CONFIDENCE_FLOOR);
    for (const source of ['user', 'michelin', 'community', 'community_single', 'google']) {
      expect(cuisineConfidence(source)).toBeGreaterThanOrEqual(PERSIST_CONFIDENCE_FLOOR);
    }
  });

  it('is empty for an empty ask', async () => {
    expect(await getRestaurantCuisineBatch([])).toEqual({});
  });
});

// Phase 5's whole point: a correction has to reach other people's screens,
// not just sit in the table.
describe('settleRestaurantCuisine · a correction outranks local data', () => {
  it("a user's correction beats what Google says about the place", async () => {
    rows.push({ restaurant_id: 'p8', cuisine: 'Peruvian', source: 'user', confidence: 100 });
    expect(await settleRestaurantCuisine({
      restaurantId: 'p8', place: { primaryType: 'mexican_restaurant' },
    })).toBe('Peruvian');
    expect(upserts).toEqual([]); // and we don't argue back
  });

  it("a user's correction beats a Michelin match", async () => {
    rows.push({ restaurant_id: 'p9', cuisine: 'Basque', source: 'user', confidence: 100 });
    expect(await settleRestaurantCuisine({ restaurantId: 'p9', michelinCuisine: 'Creative' })).toBe('Basque');
    expect(upserts).toEqual([]);
  });

  it('but Michelin still beats what other people typed', async () => {
    rows.push({ restaurant_id: 'p10', cuisine: 'French', source: 'community', confidence: 80 });
    expect(await settleRestaurantCuisine({ restaurantId: 'p10', michelinCuisine: 'Creative' })).toBe('Creative');
    expect(upserts).toEqual([{ restaurant_id: 'p10', cuisine: 'Creative', source: 'michelin' }]);
  });

  it('and a single rater beats what Google guessed', async () => {
    rows.push({ restaurant_id: 'p11', cuisine: 'Laotian', source: 'community_single', confidence: 65 });
    expect(await settleRestaurantCuisine({
      restaurantId: 'p11', place: { primaryType: 'thai_restaurant' },
    })).toBe('Laotian');
  });

  it('spends no write when the cache already agrees', async () => {
    rows.push({ restaurant_id: 'p12', cuisine: 'BBQ', source: 'google', confidence: 60 });
    expect(await settleRestaurantCuisine({
      restaurantId: 'p12', place: { primaryType: 'barbecue_restaurant' },
    })).toBe('BBQ');
    expect(upserts).toEqual([]);
  });
});
