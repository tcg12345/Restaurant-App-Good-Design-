/**
 * The client half of the OSM cuisine lookup.
 *
 * What matters here is restraint. Overpass is volunteer-funded, so the
 * shape of the traffic this produces is as much a correctness property as
 * the answers are: one call for a screenful of rows, nothing asked twice,
 * and no failure that a user ever sees.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { invoke, calls } = vi.hoisted(() => ({
  calls: [] as Array<{ places: Array<{ restaurantId: string; name: string; lat?: number; lng?: number }> }>,
  invoke: vi.fn(),
}));

vi.mock('./supabase', () => ({
  supabaseConfigured: true,
  supabase: { functions: { invoke: (_name: string, opts: { body: unknown }) => {
    calls.push(opts.body as { places: Array<{ restaurantId: string; name: string }> });
    return invoke(opts.body);
  } } },
}));

import { lookupCuisines, resetCuisineLookups, osmAttribution, hasOsmCuisine } from './cuisine-lookup';

const answer = (cuisines: Record<string, string>, source = 'osm') => ({
  data: {
    cuisines: Object.fromEntries(Object.entries(cuisines).map(([k, v]) => [k, { cuisine: v, source }])),
    attribution: 'Cuisine data © OpenStreetMap contributors (ODbL)',
  },
  error: null,
});

beforeEach(() => {
  calls.length = 0;
  invoke.mockReset();
  invoke.mockResolvedValue(answer({}));
  resetCuisineLookups();
});

describe('lookupCuisines', () => {
  it('returns what the server could name', async () => {
    invoke.mockResolvedValue(answer({ a: 'Danish', b: 'Greek' }));
    expect(await lookupCuisines([
      { restaurantId: 'a', name: 'Falsled Kro' },
      { restaurantId: 'b', name: 'Nomade Westport' },
    ])).toEqual({ a: 'Danish', b: 'Greek' });
  });

  it('coalesces everything asked for in the same tick into one call', async () => {
    invoke.mockResolvedValue(answer({ a: 'Danish', b: 'Greek', c: 'Thai' }));
    const [r1, r2] = await Promise.all([
      lookupCuisines([{ restaurantId: 'a', name: 'Falsled Kro' }]),
      lookupCuisines([{ restaurantId: 'b', name: 'Nomade' }, { restaurantId: 'c', name: 'Bangkok House' }]),
    ]);
    // A list of rows mounting together must not become a request each.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(calls[0].places.map((p) => p.restaurantId)).toEqual(['a', 'b', 'c']);
    expect(r1).toEqual(r2);
  });

  it('never asks about the same place twice in a session', async () => {
    invoke.mockResolvedValue(answer({ a: 'Danish' }));
    await lookupCuisines([{ restaurantId: 'a', name: 'Falsled Kro' }]);
    await lookupCuisines([{ restaurantId: 'a', name: 'Falsled Kro' }]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('remembers a miss too — a place OSM does not know is asked once', async () => {
    await lookupCuisines([{ restaurantId: 'x', name: 'Nowhere Grill' }]);
    await lookupCuisines([{ restaurantId: 'x', name: 'Nowhere Grill' }]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('splits an oversized batch rather than letting the server drop the tail', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ restaurantId: `p${i}`, name: `Place ${i}` }));
    await lookupCuisines(many);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(calls.map((c) => c.places.length)).toEqual([25, 25, 10]);
  });

  it('sends coordinates only when it actually has them', async () => {
    await lookupCuisines([
      { restaurantId: 'a', name: 'Falsled Kro', lat: 55.126, lng: 10.184 },
      { restaurantId: 'b', name: 'No Coords' },
      { restaurantId: 'c', name: 'Half Coords', lat: 41.1, lng: null },
    ]);
    expect(calls[0].places[0]).toEqual({ restaurantId: 'a', name: 'Falsled Kro', lat: 55.126, lng: 10.184 });
    expect(calls[0].places[1]).toEqual({ restaurantId: 'b', name: 'No Coords' });
    expect(calls[0].places[2]).toEqual({ restaurantId: 'c', name: 'Half Coords' });
  });

  it('ignores places it cannot identify', async () => {
    expect(await lookupCuisines([
      { restaurantId: '', name: 'No Id' },
      { restaurantId: 'b', name: '   ' },
    ])).toEqual({});
    expect(invoke).not.toHaveBeenCalled();
  });

  it('is silent when the server errors', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'rate limited' } });
    await expect(lookupCuisines([{ restaurantId: 'a', name: 'Falsled Kro' }])).resolves.toEqual({});
  });

  it('is silent when the call throws outright', async () => {
    invoke.mockRejectedValue(new Error('offline'));
    await expect(lookupCuisines([{ restaurantId: 'a', name: 'Falsled Kro' }])).resolves.toEqual({});
  });
});

describe('attribution', () => {
  it('stays quiet until an OSM answer has actually been used', async () => {
    expect(hasOsmCuisine()).toBe(false);
    // An answer the server served from its own cache is not OSM data.
    invoke.mockResolvedValue(answer({ a: 'Italian' }, 'google'));
    await lookupCuisines([{ restaurantId: 'a', name: 'Amis' }]);
    expect(hasOsmCuisine()).toBe(false);
  });

  it('turns on as soon as one is, and repeats the server’s own wording', async () => {
    invoke.mockResolvedValue(answer({ b: 'Danish' }));
    await lookupCuisines([{ restaurantId: 'b', name: 'Falsled Kro' }]);
    expect(hasOsmCuisine()).toBe(true);
    expect(osmAttribution()).toContain('OpenStreetMap');
    expect(osmAttribution()).toContain('ODbL');
  });
});
