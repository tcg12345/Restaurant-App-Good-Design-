/**
 * These tests exist for one reason: every request this module makes is
 * billed. The behaviours below aren't incidental implementation details —
 * "one search costs one request", "a seeded backfill costs none" — they are
 * the product of a bill that ran to $118/month, and a refactor that quietly
 * restores a parallel duplicate request would not fail any other test.
 *
 * So each case asserts a CALL COUNT, not just a result.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  searchPlacesByText,
  searchNearbyRestaurants,
  fetchLocationDataForPlace,
  TEXT_EXACT_SUFFICIENT_POOL,
} from './places';

/** A Google v1 search response carrying `n` plain restaurants. */
function placesResponse(n: number, prefix: string) {
  return {
    places: Array.from({ length: n }, (_, i) => ({
      id: `${prefix}-${i}`,
      displayName: { text: `${prefix} ${i}` },
      location: { latitude: 40.7 + i / 1000, longitude: -74 + i / 1000 },
      types: ['restaurant'],
      primaryType: 'restaurant',
      formattedAddress: `${i} Main St`,
    })),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

/** Count only the calls that cost money — Mapbox is a different vendor. */
function googleCalls(): string[] {
  return fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes('places.googleapis.com'));
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('searchPlacesByText — one request, not two', () => {
  it('bills ONE request for a name lookup that resolves to a single place', async () => {
    // The real-world case, verified against the live API: typing "jungsik"
    // returns exactly one restaurant, and the broad "<q> restaurant"
    // follow-up returned that same place — billed, and additive of nothing.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => placesResponse(1, 'jungsik'),
      text: async () => '',
    });

    const out = await searchPlacesByText('jungsik name lookup', 40.7, -74);

    expect(googleCalls()).toHaveLength(1);
    expect(out.length).toBe(1);
  });

  it('falls back to the broad query when the exact one finds no food at all', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ places: [] }), text: async () => '' })
      .mockResolvedValueOnce({ ok: true, json: async () => placesResponse(6, 'empty-broad'), text: async () => '' });

    const out = await searchPlacesByText('mistyped quesr', 40.7, -74);

    expect(googleCalls()).toHaveLength(2);
    expect(out.length).toBe(6);
  });

  it('honours a caller that wants pool DEPTH rather than the best match', async () => {
    // The recommendation engine passes a higher bar: 3 exact hits is a
    // complete answer for a typeahead but a thin pool for recs, so the
    // broad phrasing is still worth its request there.
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => placesResponse(3, 'pool-exact'), text: async () => '' })
      .mockResolvedValueOnce({ ok: true, json: async () => placesResponse(6, 'pool-broad'), text: async () => '' });

    const out = await searchPlacesByText(
      'best ramen in a small town', 40.7, -74, undefined, false, undefined, undefined,
      { minExactResults: TEXT_EXACT_SUFFICIENT_POOL },
    );

    expect(googleCalls()).toHaveLength(2);
    // exact-matches-first ordering is preserved through the fallback
    expect(out[0].id).toBe('pool-exact-0');
    expect(out.length).toBe(9);
  });

  it('does NOT widen for the same thin response when the caller is a typeahead', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => placesResponse(3, 'typeahead-thin'),
      text: async () => '',
    });

    const out = await searchPlacesByText('three hits typeahead', 40.7, -74);

    expect(googleCalls()).toHaveLength(1);
    expect(out.length).toBe(3);
  });

  it('never bills a repeat of the same search (memo)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => placesResponse(7, 'memo'),
      text: async () => '',
    });

    const first = await searchPlacesByText('jungsik memo case', 40.7, -74);
    const callsAfterFirst = googleCalls().length;
    const second = await searchPlacesByText('jungsik memo case', 40.7, -74);

    expect(callsAfterFirst).toBe(1);
    expect(googleCalls()).toHaveLength(1); // the repeat cost nothing
    expect(second).toEqual(first);
  });

  it('does not bill a one-character typeahead query', async () => {
    const out = await searchPlacesByText('j', 40.7, -74);
    expect(googleCalls()).toHaveLength(0);
    expect(out).toEqual([]);
  });
});

describe('searchNearbyRestaurants — the broad sweep escalates instead of fanning out', () => {
  it('bills 3 requests (2 nearby + 1 text) when the first wave fills the cap', async () => {
    // Distinct ids per call so the deduped pool clears BROAD_CAP (50).
    let call = 0;
    fetchMock.mockImplementation(async () => {
      // Capture the prefix NOW: json() resolves later, and reading `call`
      // inside it would give every response the same ids.
      const prefix = `dense-${(call += 1)}`;
      return { ok: true, json: async () => placesResponse(20, prefix), text: async () => '' };
    });

    const out = await searchNearbyRestaurants(40.7, -74, 20000);

    // Was 6 (2 nearby + 4 text) unconditionally.
    expect(googleCalls()).toHaveLength(3);
    expect(out.length).toBe(50);
  });

  it('still fires the extra angles when the area is genuinely sparse', async () => {
    // Every call returns the SAME 4 places, so the pool can never fill —
    // exactly the rural case the extra queries exist for.
    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => placesResponse(4, 'sparse'),
      text: async () => '',
    }));

    const out = await searchNearbyRestaurants(40.7, -74, 20000);

    // 2 nearby + 1 text, then the 3 escalation queries — the old total.
    expect(googleCalls()).toHaveLength(6);
    expect(out.length).toBe(4);
  });
});

describe('fetchLocationDataForPlace — a seeded row costs no Places call', () => {
  it('makes ZERO Google calls when the caller already has the search result', async () => {
    const out = await fetchLocationDataForPlace('seeded-place-1', {
      addressComponents: [{ longText: 'Manhattan', shortText: 'Manhattan', types: ['sublocality'] }],
      lat: 40.73,
      lng: -74.0,
      hours: ['Monday: 5:00 – 10:00 PM'],
    });

    expect(googleCalls()).toHaveLength(0);
    // and it still returns the full shape its callers destructure
    expect(out.lat).toBe(40.73);
    expect(out.hours).toEqual(['Monday: 5:00 – 10:00 PM']);
    expect(out.addressComponents).toHaveLength(1);
  });

  it('treats "no published hours" as a complete seed, not a missing one', async () => {
    const out = await fetchLocationDataForPlace('seeded-place-2', {
      addressComponents: [{ longText: 'Brooklyn', shortText: 'Brooklyn', types: ['sublocality'] }],
      lat: 40.68,
      lng: -73.94,
      hours: [], // Google has none — an answer, not an absence
    });

    expect(googleCalls()).toHaveLength(0);
    expect(out.hours).toEqual([]);
  });

  it('falls through to the real call when the seed is incomplete', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'partial-place',
        displayName: { text: 'Somewhere' },
        location: { latitude: 40.7, longitude: -74 },
        types: ['restaurant'],
        regularOpeningHours: { weekdayDescriptions: ['Monday: Closed'] },
      }),
      text: async () => '',
    });

    // No hours in the seed — a half-filled meta entry must not be cached as
    // though it were the whole answer.
    const out = await fetchLocationDataForPlace('partial-place', {
      addressComponents: [{ longText: 'Queens', shortText: 'Queens', types: ['sublocality'] }],
      lat: 40.7,
      lng: -74,
    });

    expect(googleCalls()).toHaveLength(1);
    expect(out.hours).toEqual(['Monday: Closed']);
  });
});

describe('search failure recovery', () => {
  it('does not widen or memoize an HTTP error; the same query can recover immediately', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: {} }) })
      .mockResolvedValue({ ok: true, json: async () => placesResponse(1, 'recovered') });
    expect(await searchPlacesByText('recovery HTTP', 40.7, -74)).toEqual([]);
    expect(googleCalls()).toHaveLength(1);
    expect(await searchPlacesByText('recovery HTTP', 40.7, -74)).toHaveLength(1);
    expect(googleCalls()).toHaveLength(2);
  });

  it('surfaces network failures to retry-aware callers without launching a broad query', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(searchPlacesByText('retry-aware query', 40.7, -74, undefined, false, undefined, undefined,
      { throwOnError: true })).rejects.toThrow('Failed to fetch');
    expect(googleCalls()).toHaveLength(1);
  });

  it('does not memoize malformed responses', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ places: {} }) })
      .mockResolvedValue({ ok: true, json: async () => placesResponse(1, 'valid') });
    expect(await searchPlacesByText('malformed recovery', 40.7, -74)).toEqual([]);
    expect(await searchPlacesByText('malformed recovery', 40.7, -74)).toHaveLength(1);
    expect(googleCalls()).toHaveLength(2);
  });

  it('does not reuse a shallow typeahead memo for a recommendation needing depth', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => placesResponse(1, 'depth') });
    await searchPlacesByText('different depth', 40.7, -74);
    await searchPlacesByText('different depth', 40.7, -74, undefined, false, undefined, undefined,
      { minExactResults: TEXT_EXACT_SUFFICIENT_POOL });
    expect(googleCalls()).toHaveLength(3);
  });

  it('rejects complete nearby outages after the first wave instead of returning an empty pool', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(searchNearbyRestaurants(40.7, -74, 20000)).rejects.toThrow('Failed to fetch');
    expect(googleCalls()).toHaveLength(3);
  });

  it('retains successful nearby sources during partial failure without expanding the search', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ ok: true, json: async () => placesResponse(4, 'partial') });
    expect(await searchNearbyRestaurants(40.7, -74, 20000)).toHaveLength(4);
    expect(googleCalls()).toHaveLength(3);
  });

  it('retains the first wave when all supplemental queries fail', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => placesResponse(4, 'first') })
      .mockResolvedValueOnce({ ok: true, json: async () => placesResponse(4, 'first') })
      .mockResolvedValueOnce({ ok: true, json: async () => placesResponse(4, 'first') })
      .mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await searchNearbyRestaurants(40.7, -74, 20000)).toHaveLength(4);
    expect(googleCalls()).toHaveLength(6);
  });

  it('does not let an unused nearby supplement mask a filtered-search failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(searchNearbyRestaurants(40.7, -74, 20000, ['italian_restaurant'])).rejects.toThrow();
    expect(googleCalls()).toHaveLength(1);
  });

  it('does not start requests for an already cancelled search', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(searchNearbyRestaurants(40.7, -74, 20000, [], 0, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(await searchPlacesByText('already cancelled', 40.7, -74, undefined, false, undefined, controller.signal)).toEqual([]);
    expect(googleCalls()).toHaveLength(0);
  });

  it('cancels the complete wave and never launches extra requests after supersession', async () => {
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }));
    const controller = new AbortController();
    const result = searchNearbyRestaurants(40.7, -74, 20000, [], 0, undefined, controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    expect(googleCalls()).toHaveLength(3);
  });

  it('times out stalled response bodies and allows an immediate retry', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce((_url, init) => Promise.resolve({ ok: true,
        json: () => new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        }),
      })).mockResolvedValue({ ok: true, json: async () => placesResponse(1, 'timeout-recovery') });
      const result = searchPlacesByText('body timeout', 40.7, -74, undefined, false, undefined, undefined, { throwOnError: true });
      const assertion = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(12000);
      await assertion;
      expect(await searchPlacesByText('body timeout', 40.7, -74)).toHaveLength(1);
      expect(googleCalls()).toHaveLength(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

it('does not treat a successful empty source plus failed sources as proof of no restaurants', async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ places: [] }) })
    .mockRejectedValue(new TypeError('Failed to fetch'));
  await expect(searchNearbyRestaurants(40.7, -74, 20000)).rejects.toThrow('Failed to fetch');
  expect(googleCalls()).toHaveLength(3);
});

it('keeps exact results when only the depth supplement fails, and retries that incomplete pool', async () => {
  const exact = { ok: true, json: async () => placesResponse(2, 'exact-survives') };
  fetchMock.mockResolvedValueOnce(exact).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(exact).mockResolvedValueOnce({ ok: true, json: async () => placesResponse(5, 'broad-recovers') });
  const search = () => searchPlacesByText('depth partial failure', 40.7, -74, undefined, false, undefined, undefined,
    { minExactResults: TEXT_EXACT_SUFFICIENT_POOL });
  expect(await search()).toHaveLength(2);
  expect(await search()).toHaveLength(7);
  expect(googleCalls()).toHaveLength(4);
});
