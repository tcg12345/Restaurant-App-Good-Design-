import { describe, it, expect, beforeEach, vi } from 'vitest';

const { rows, tagRows, upserts, upsert, osmHits, lookupCalls, credited } = vi.hoisted(() => ({
  rows: [] as Array<{ restaurant_id: string; cuisine: string; source: string; confidence: number }>,
  /** restaurant_cuisine_tags — the crowd-sourced additional cuisines (071). */
  tagRows: [] as Array<{ restaurant_id: string; cuisine: string; votes: number; created_at: string }>,
  upserts: [] as Array<{ restaurant_id: string; cuisine: string; source: string }>,
  upsert: vi.fn(),
  /** What the OSM lookup will claim to have found, keyed by place id. */
  osmHits: {} as Record<string, string>,
  lookupCalls: [] as Array<Array<{ restaurantId: string; name: string }>>,
  /** Which places got credited to which source, for the ODbL notice. */
  credited: {} as Record<string, string>,
}));

vi.mock('./cuisine-lookup', () => ({
  noteCuisineSource: (id: string, source: string) => { credited[id] = source; },
  lookupCuisines: async (places: Array<{ restaurantId: string; name: string }>) => {
    lookupCalls.push(places);
    const out: Record<string, string> = {};
    for (const p of places) if (osmHits[p.restaurantId]) out[p.restaurantId] = osmHits[p.restaurantId];
    return out;
  },
}));

vi.mock('./supabase', () => ({
  supabaseConfigured: true,
  supabase: {
    from: (table: string) => {
      const source = () => (table === 'restaurant_cuisine_tags' ? tagRows : rows) as Array<Record<string, unknown>>;
      // The tags read chains .in().order().order(); the primary read stops
      // at .in(). One thenable that answers both.
      const q = (filter: (r: Record<string, unknown>) => boolean) => {
        const self = {
          in: (_c: string, ids: string[]) => q((r) => filter(r) && ids.includes(r.restaurant_id as string)),
          eq: (c: string, v: unknown) => q((r) => filter(r) && r[c] === v),
          order: () => self,
          limit: () => self,
          then: (res: (v: unknown) => unknown) => res({ data: source().filter(filter), error: null }),
        };
        return self;
      };
      return {
        select: () => q(() => true),
        upsert: (row: { restaurant_id: string; cuisine: string; source: string }) => {
          upsert(row);
          upserts.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  },
}));

import { onCuisineChange, resetCuisineListeners } from './cuisine-events';
import {
  settleRestaurantCuisine, publishRestaurantCuisine, getRestaurantCuisineBatch,
  cuisineConfidence, PERSIST_CONFIDENCE_FLOOR, CUISINE_MAX_COUNT,
  getRestaurantCuisineTags,
} from './restaurant-cuisine';

/** A rural place: Google knows it's a restaurant and nothing more. */
const OPAQUE = { types: ['restaurant', 'point_of_interest', 'establishment'] };

beforeEach(() => {
  rows.length = 0; tagRows.length = 0; upserts.length = 0; upsert.mockClear();
  lookupCalls.length = 0;
  for (const k of Object.keys(osmHits)) delete osmHits[k];
  for (const k of Object.keys(credited)) delete credited[k];
});

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
    rows.push({ restaurant_id: 'p6', cuisine: 'Seafood', source: 'approved', confidence: 100 });
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
    publishRestaurantCuisine('x', '  Thai  ', 'google');
    expect(upserts).toEqual([{ restaurant_id: 'x', cuisine: 'Thai', source: 'google' }]);
  });

  // The reviewed tiers come from the approve RPC and the consensus
  // trigger. The server refuses them from a client; this stops the round
  // trip ever leaving.
  it('refuses to publish a tier only the server may write', () => {
    for (const source of ['approved', 'consensus', 'community'] as const) {
      publishRestaurantCuisine('x', 'Thai', source);
    }
    expect(upsert).not.toHaveBeenCalled();
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
    expect(out.a).toEqual({ cuisine: 'Thai', source: 'community', confidence: 80, cuisines: ['Thai'] });
  });

  // The floor is what stops a name guess being written into a user's rating.
  it('a name guess sits below the persist floor and a human answer above it', async () => {
    expect(cuisineConfidence('name')).toBeLessThan(PERSIST_CONFIDENCE_FLOOR);
    for (const source of ['approved', 'consensus', 'michelin', 'community', 'community_single', 'google']) {
      expect(cuisineConfidence(source)).toBeGreaterThanOrEqual(PERSIST_CONFIDENCE_FLOOR);
    }
    // The retired direct-write tier scores nothing, so an old client build
    // sending it can't land a row.
    expect(cuisineConfidence('user')).toBe(0);
  });

  it('is empty for an empty ask', async () => {
    expect(await getRestaurantCuisineBatch([])).toEqual({});
  });
});

// Phase 5's whole point: a correction has to reach other people's screens,
// not just sit in the table.
describe('settleRestaurantCuisine · a correction outranks local data', () => {
  it('an approved correction beats what Google says about the place', async () => {
    rows.push({ restaurant_id: 'p8', cuisine: 'Peruvian', source: 'approved', confidence: 100 });
    expect(await settleRestaurantCuisine({
      restaurantId: 'p8', place: { primaryType: 'mexican_restaurant' },
    })).toBe('Peruvian');
    expect(upserts).toEqual([]); // and we don't argue back
  });

  it('an approved correction beats a Michelin match', async () => {
    rows.push({ restaurant_id: 'p9', cuisine: 'Basque', source: 'approved', confidence: 100 });
    expect(await settleRestaurantCuisine({ restaurantId: 'p9', michelinCuisine: 'Creative' })).toBe('Basque');
    expect(upserts).toEqual([]);
  });

  it('a consensus of suggesters beats Michelin', async () => {
    rows.push({ restaurant_id: 'p13', cuisine: 'Basque', source: 'consensus', confidence: 95 });
    expect(await settleRestaurantCuisine({ restaurantId: 'p13', michelinCuisine: 'Creative' })).toBe('Basque');
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


/**
 * The OpenStreetMap fallback (migration 070). It is opt-in and last: it
 * only runs where everything else has already failed to describe the
 * place, which is what keeps it off the hot path for city restaurants.
 */
describe('settleRestaurantCuisine · the OSM fallback', () => {
  it('does not fire unless the caller asks for it', async () => {
    expect(await settleRestaurantCuisine({ restaurantId: 'r1', name: 'Falsled Kro', place: OPAQUE })).toBe('');
    expect(lookupCalls).toHaveLength(0);
  });

  it('asks OSM when nothing else could name the place', async () => {
    osmHits.r2 = 'Danish';
    expect(await settleRestaurantCuisine({
      restaurantId: 'r2', name: 'Falsled Kro', place: OPAQUE, lookup: true, lat: 55.126, lng: 10.184,
    })).toBe('Danish');
    expect(lookupCalls).toHaveLength(1);
    expect(lookupCalls[0][0]).toMatchObject({ restaurantId: 'r2', name: 'Falsled Kro', lat: 55.126, lng: 10.184 });
  });

  it('overrides a guess read off the restaurant’s name', async () => {
    // 'name' scores 30; an OSM tag is a mapper who went there.
    osmHits.r3 = 'Peruvian';
    expect(await settleRestaurantCuisine({
      restaurantId: 'r3', name: 'Taqueria El Sol', place: OPAQUE, lookup: true,
    })).toBe('Peruvian');
  });

  it('leaves Google’s own answer alone — it outranks OSM', async () => {
    osmHits.r4 = 'Greek';
    expect(await settleRestaurantCuisine({
      restaurantId: 'r4', name: 'Amis', place: { types: ['italian_restaurant'] }, lookup: true,
    })).toBe('Italian');
    expect(lookupCalls).toHaveLength(0);
  });

  it('leaves an approved correction alone', async () => {
    rows.push({ restaurant_id: 'r5', cuisine: 'Basque', source: 'approved', confidence: 100 });
    osmHits.r5 = 'Spanish';
    expect(await settleRestaurantCuisine({
      restaurantId: 'r5', name: 'Txikito', place: OPAQUE, lookup: true,
    })).toBe('Basque');
    expect(lookupCalls).toHaveLength(0);
  });

  it('still asks when the cache holds only Google’s out-of-taxonomy label', async () => {
    // google_display is 50, below OSM's 55 — a real tag beats "Fine dining
    // restaurant", which names a price bracket rather than a cuisine.
    rows.push({ restaurant_id: 'r6', cuisine: 'Fine Dining Restaurant', source: 'google_display', confidence: 50 });
    osmHits.r6 = 'American';
    expect(await settleRestaurantCuisine({
      restaurantId: 'r6', name: 'The Dining Room at Edson Hill', lookup: true,
    })).toBe('American');
  });

  it('falls back to what it already had when OSM comes up empty', async () => {
    rows.push({ restaurant_id: 'r7', cuisine: 'Diner', source: 'name', confidence: 30 });
    expect(await settleRestaurantCuisine({ restaurantId: 'r7', name: 'Nowhere Diner', lookup: true })).toBe('Diner');
    expect(lookupCalls).toHaveLength(1);
  });

  it('never publishes an osm cuisine from the client — that tier is the server’s', async () => {
    osmHits.r8 = 'Danish';
    await settleRestaurantCuisine({ restaurantId: 'r8', name: 'Falsled Kro', place: OPAQUE, lookup: true });
    expect(upserts.some((u) => u.source === 'osm')).toBe(false);
  });
});

describe('settleRestaurantCuisine · crediting the source', () => {
  it('flags a cached OSM answer so the screen can print the ODbL notice', async () => {
    rows.push({ restaurant_id: 'c1', cuisine: 'Danish', source: 'osm', confidence: 55 });
    expect(await settleRestaurantCuisine({ restaurantId: 'c1', name: 'Falsled Kro', place: OPAQUE })).toBe('Danish');
    expect(credited.c1).toBe('osm');
  });

  it('clears the flag once something stronger describes the place', async () => {
    rows.push({ restaurant_id: 'c2', cuisine: 'Danish', source: 'osm', confidence: 55 });
    // Michelin outranks OSM, so the label on screen is no longer OSM's.
    expect(await settleRestaurantCuisine({ restaurantId: 'c2', michelinCuisine: 'Nordic' })).toBe('Nordic');
    expect(credited.c2).toBe('michelin');
  });

  it('credits nothing when Google answered', async () => {
    await settleRestaurantCuisine({ restaurantId: 'c3', place: { types: ['thai_restaurant'] } });
    expect(credited.c3).toBe('google');
  });
});


/**
 * A restaurant can be more than one thing (migration 071).
 *
 * The extras are crowd-sourced only — approved, or agreed by enough
 * people — so they never come through the source ranking above. The
 * primary keeps its meaning exactly: it is the one canonical value that
 * filters, facets, top lists and saved ratings mean by "the cuisine".
 */
const tag = (restaurantId: string, cuisine: string, votes = 1, created = '2026-01-01') =>
  ({ restaurant_id: restaurantId, cuisine, votes, created_at: created });

describe('getRestaurantCuisineBatch · additional cuisines', () => {
  it('returns the primary first, then the extras', async () => {
    rows.push({ restaurant_id: 'a', cuisine: 'Italian', source: 'google', confidence: 60 });
    tagRows.push(tag('a', 'Pizza'), tag('a', 'Seafood'));
    const out = await getRestaurantCuisineBatch(['a']);
    expect(out.a.cuisine).toBe('Italian');
    expect(out.a.cuisines).toEqual(['Italian', 'Pizza', 'Seafood']);
  });

  it('leaves a single-cuisine restaurant as a one-item list', async () => {
    rows.push({ restaurant_id: 'b', cuisine: 'Thai', source: 'community', confidence: 80 });
    expect((await getRestaurantCuisineBatch(['b'])).b.cuisines).toEqual(['Thai']);
  });

  it('never exceeds the cap, whatever the database hands back', async () => {
    rows.push({ restaurant_id: 'c', cuisine: 'Italian', source: 'google', confidence: 60 });
    tagRows.push(tag('c', 'Pizza'), tag('c', 'Seafood'), tag('c', 'Greek'), tag('c', 'Cuban'));
    const out = await getRestaurantCuisineBatch(['c']);
    expect(out.c.cuisines).toHaveLength(CUISINE_MAX_COUNT);
  });

  it('never repeats the primary as an extra', async () => {
    rows.push({ restaurant_id: 'd', cuisine: 'Italian', source: 'google', confidence: 60 });
    // 071 refuses this at the database, but a stale row must not produce
    // "Italian, Italian" on a card either.
    tagRows.push(tag('d', 'italian'), tag('d', 'Pizza'));
    expect((await getRestaurantCuisineBatch(['d'])).d.cuisines).toEqual(['Italian', 'Pizza']);
  });

  it('ignores tags for a restaurant with no primary', async () => {
    // A tag only exists alongside a primary; one without means the primary
    // was just removed, and the honest answer meanwhile is nothing.
    tagRows.push(tag('orphan', 'Pizza'));
    expect(await getRestaurantCuisineBatch(['orphan'])).toEqual({});
  });
});

describe('getRestaurantCuisineTags', () => {
  it('returns only the extras, not the primary', async () => {
    rows.push({ restaurant_id: 'e', cuisine: 'Italian', source: 'google', confidence: 60 });
    tagRows.push(tag('e', 'Pizza'));
    expect(await getRestaurantCuisineTags('e')).toEqual(['Pizza']);
  });

  it('is empty for a restaurant with one cuisine, and for no id', async () => {
    expect(await getRestaurantCuisineTags('nothing')).toEqual([]);
    expect(await getRestaurantCuisineTags('')).toEqual([]);
  });
});


/**
 * Publishing must announce.
 *
 * The cards read a persisted meta blob, so nothing on screen notices a
 * cache write on its own. If publish stops announcing, the symptom is not
 * an error — it is a card quietly showing last week's answer.
 */
describe('publishRestaurantCuisine · announcing', () => {
  beforeEach(() => resetCuisineListeners());

  it('tells the app which restaurant changed', async () => {
    const seen: string[] = [];
    onCuisineChange((id) => seen.push(id));
    publishRestaurantCuisine('ChIJxyz', 'Peruvian', 'google');
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual(['ChIJxyz']);
  });

  it('says nothing when there was nothing to write', async () => {
    const seen: string[] = [];
    onCuisineChange((id) => seen.push(id));
    publishRestaurantCuisine('ChIJxyz', 'Restaurant', 'google');  // the non-answer
    publishRestaurantCuisine('ChIJxyz', '', 'google');
    publishRestaurantCuisine('', 'Thai', 'google');
    publishRestaurantCuisine('ChIJxyz', 'Thai', 'approved');      // server-only tier
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([]);
  });
});
