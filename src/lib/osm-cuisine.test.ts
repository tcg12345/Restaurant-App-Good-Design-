/**
 * The OpenStreetMap cuisine lookup's pure half (migration 070, the
 * cuisine-lookup Edge Function).
 *
 * The fetch itself cannot be exercised here — and was not reachable from
 * the machine this was written on — so everything either side of it is
 * pinned down instead: the query we send, the matching that decides which
 * OSM element is which restaurant, and the tag→label mapping. The Overpass
 * payloads below are hand-built in the real response shape (nodes with
 * lat/lon, ways with `center`, `tags.cuisine` as a semicolon list).
 *
 * The named restaurants are the ones this app's own measurement left with
 * no cuisine. Nothing here asserts what OSM actually holds for them — that
 * is what scripts/probe-overpass.mjs is for — only that a response of that
 * shape is read correctly.
 */
import { describe, it, expect } from 'vitest';
import {
  SEARCH_RADIUS_M, MAX_MATCH_DISTANCE_M,
  buildOverpassQuery, normalizeName, namesMatch, distanceM, matchPlace,
  cuisineFromOsmTag, CUISINE_ATTRIBUTION,
  type OsmElement, type OsmPlace,
} from '../../supabase/functions/_shared/osm-cuisine';

const node = (
  id: number, lat: number, lon: number, tags: Record<string, string>,
): OsmElement => ({ type: 'node', id, lat, lon, tags: { amenity: 'restaurant', ...tags } });

const way = (
  id: number, lat: number, lon: number, tags: Record<string, string>,
): OsmElement => ({ type: 'way', id, center: { lat, lon }, tags: { amenity: 'restaurant', ...tags } });

/** Roughly 111.2 m per 0.001° of latitude, anywhere. */
const metresNorth = (lat: number, m: number) => lat + m / 111_195;

describe('buildOverpassQuery', () => {
  const places: OsmPlace[] = [
    { restaurantId: 'a', name: 'Nômade Westport', lat: 41.141_5, lng: -73.357_9 },
    { restaurantId: 'b', name: 'The Dining Room at Edson Hill', lat: 44.505_2, lng: -72.755_1 },
  ];

  it('emits one around: clause per place, never a bounding box', () => {
    const q = buildOverpassQuery(places);
    expect(q).toContain(`(around:${SEARCH_RADIUS_M},41.141500,-73.357900)`);
    expect(q).toContain(`(around:${SEARCH_RADIUS_M},44.505200,-72.755100)`);
    // A box spanning Connecticut to Vermont would return a phone book.
    expect(q).not.toMatch(/\bbbox\b/);
    expect(q.match(/around:/g)).toHaveLength(2);
  });

  it('asks for JSON, food amenities, and centres for ways', () => {
    const q = buildOverpassQuery(places);
    expect(q.startsWith('[out:json]')).toBe(true);
    expect(q).toContain('amenity~"^(restaurant|cafe|fast_food|bar|pub|ice_cream|biergarten|food_court)$"');
    // Without `center`, ways come back with no coordinates and every
    // distance check below becomes unanswerable.
    expect(q.trimEnd().endsWith('out tags center;')).toBe(true);
  });

  it('honours a caller-supplied radius', () => {
    expect(buildOverpassQuery(places.slice(0, 1), 300)).toContain('(around:300,');
  });

  it('drops places with unusable coordinates rather than emitting NaN', () => {
    const q = buildOverpassQuery([
      ...places.slice(0, 1),
      { restaurantId: 'c', name: 'Nowhere', lat: Number.NaN, lng: 12 },
      { restaurantId: 'd', name: 'Nowhere Else', lat: 12, lng: Number.POSITIVE_INFINITY },
    ]);
    expect(q).not.toContain('NaN');
    expect(q).not.toContain('Infinity');
    expect(q.match(/around:/g)).toHaveLength(1);
  });

  it('produces no clauses at all for an empty batch', () => {
    expect(buildOverpassQuery([])).not.toContain('around:');
  });
});

describe('normalizeName', () => {
  it('strips accents so a mapper’s spelling and Google’s agree', () => {
    expect(normalizeName('Nômade Westport')).toBe('nomade westport');
    expect(normalizeName('Café Rüstica')).toBe('rustica');
    // Composed and decomposed forms of the same word must agree.
    expect(normalizeName('Nômade')).toBe(normalizeName('Nômade'));
  });

  it('drops the words that appear in every restaurant name', () => {
    expect(normalizeName('The Dining Room at Edson Hill')).toBe('dining edson hill');
    expect(normalizeName('The Little Barn Restaurant')).toBe('little barn');
  });

  it('deletes apostrophes instead of splitting on them', () => {
    // Google and OSM disagree about apostrophes constantly, and a split
    // leaves a stray "s" that makes one name look unlike the other.
    expect(normalizeName("Joe's Pizza")).toBe('joes pizza');
    expect(normalizeName('Joes Pizza')).toBe('joes pizza');
    expect(normalizeName('  MARIO’S  TRATTORIA  ')).toBe('marios trattoria');
  });

  it('folds the remaining punctuation away', () => {
    // "and" is itself a noise word, so both spellings land in one place.
    expect(normalizeName('Ben & Jerry')).toBe('ben jerry');
    expect(normalizeName('Ben and Jerry')).toBe('ben jerry');
    expect(normalizeName('Pane-Vino')).toBe('pane vino');
  });

  it('returns empty for a name made only of noise', () => {
    expect(normalizeName('The Restaurant')).toBe('');
    expect(normalizeName('')).toBe('');
  });
});

describe('namesMatch', () => {
  it('matches the same restaurant across spelling differences', () => {
    expect(namesMatch('Nômade Westport', 'Nomade Westport')).toBe(true);
    expect(namesMatch('Falsled Kro', 'FALSLED KRO')).toBe(true);
    expect(namesMatch("Joe's Pizza", 'Joes Pizza')).toBe(true);
  });

  it('matches when one side carries extra words', () => {
    expect(namesMatch('Falsled Kro', 'Falsled Kro Hotel')).toBe(true);
    expect(namesMatch('The Dining Room at Edson Hill', 'Edson Hill Dining Room')).toBe(false);
    expect(namesMatch('Gordon Ramsay Hell’s Kitchen', "Gordon Ramsay Hell's Kitchen Foxwoods")).toBe(true);
  });

  it('refuses short coincidences', () => {
    // "Kro" is Danish for inn and appears in hundreds of names.
    expect(namesMatch('Kro', 'Falsled Kro')).toBe(false);
    expect(namesMatch('Nomad', 'Nomade Westport')).toBe(false);
  });

  it('refuses names that share nothing', () => {
    expect(namesMatch('Nômade Westport', 'The Little Barn')).toBe(false);
    expect(namesMatch('Happy Monkey', 'Sushi Nakazawa')).toBe(false);
  });

  it('refuses when either side is all noise, rather than matching everything', () => {
    expect(namesMatch('The Restaurant', 'The Little Barn')).toBe(false);
    expect(namesMatch('Nomade Westport', '')).toBe(false);
  });
});

describe('distanceM', () => {
  it('is zero for the same point', () => {
    expect(distanceM(41.1415, -73.3579, 41.1415, -73.3579)).toBe(0);
  });

  it('measures a known separation', () => {
    expect(distanceM(41.1415, -73.3579, metresNorth(41.1415, 100), -73.3579)).toBeCloseTo(100, 0);
  });

  it('measures across a city, not around it', () => {
    // Westport CT to Stamford CT, about 17 km.
    const d = distanceM(41.1415, -73.3579, 41.0534, -73.5387);
    expect(d).toBeGreaterThan(15_000);
    expect(d).toBeLessThan(20_000);
  });
});

describe('matchPlace', () => {
  const nomade: OsmPlace = { restaurantId: 'p1', name: 'Nômade Westport', lat: 41.141_5, lng: -73.357_9 };

  it('reads a cuisine off the matching element', () => {
    const m = matchPlace(nomade, [
      node(1, metresNorth(41.141_5, 20), -73.357_9, { name: 'Nomade Westport', cuisine: 'mediterranean' }),
    ]);
    expect(m?.label).toBe('Mediterranean');
    expect(m?.canonical).toBe(true);
    expect(m?.rawCuisine).toBe('mediterranean');
    expect(m?.distanceM).toBeCloseTo(20, 0);
  });

  it('ignores the restaurant next door', () => {
    const m = matchPlace(nomade, [
      node(1, metresNorth(41.141_5, 15), -73.357_9, { name: 'Little Barn', cuisine: 'american' }),
      node(2, metresNorth(41.141_5, 30), -73.357_9, { name: 'Amis Trattoria', cuisine: 'italian' }),
    ]);
    expect(m).toBeNull();
  });

  it('prefers a farther element that states a cuisine over a nearer one that does not', () => {
    const m = matchPlace(nomade, [
      node(1, metresNorth(41.141_5, 5), -73.357_9, { name: 'Nomade Westport' }),
      node(2, metresNorth(41.141_5, 60), -73.357_9, { name: 'Nomade Westport', cuisine: 'mediterranean' }),
    ]);
    // Matching the building is not the goal; learning the cuisine is.
    expect(m?.label).toBe('Mediterranean');
  });

  it('takes the nearest when several match', () => {
    const m = matchPlace(nomade, [
      node(1, metresNorth(41.141_5, 90), -73.357_9, { name: 'Nomade Westport', cuisine: 'french' }),
      node(2, metresNorth(41.141_5, 10), -73.357_9, { name: 'Nomade Westport', cuisine: 'mediterranean' }),
    ]);
    expect(m?.label).toBe('Mediterranean');
  });

  it('reads a way through its center, the way `out center` returns it', () => {
    const edson: OsmPlace = { restaurantId: 'p2', name: 'The Dining Room at Edson Hill', lat: 44.505_2, lng: -72.755_1 };
    const m = matchPlace(edson, [
      way(10, metresNorth(44.505_2, 40), -72.755_1, { name: 'Edson Hill Dining Room', cuisine: 'american' }),
      way(11, metresNorth(44.505_2, 25), -72.755_1, { name: 'The Dining Room at Edson Hill', cuisine: 'regional;american' }),
    ]);
    expect(m?.label).toBe('American');
    expect(m?.osmName).toBe('The Dining Room at Edson Hill');
  });

  it('never matches the same-named restaurant in the next town', () => {
    // One Overpass query covers the whole batch, so its elements include
    // every other place's neighbourhood. This is the guard for that.
    const brooklyn: OsmPlace = { restaurantId: 'p3', name: "Joe's Pizza", lat: 40.688_0, lng: -73.990_0 };
    const manhattanJoes = node(20, 40.730_6, -74.002_3, { name: "Joe's Pizza", cuisine: 'pizza' });
    expect(matchPlace(brooklyn, [manhattanJoes])).toBeNull();
    expect(distanceM(brooklyn.lat, brooklyn.lng, 40.730_6, -74.002_3)).toBeGreaterThan(MAX_MATCH_DISTANCE_M);
  });

  it('tolerates a large building whose centroid sits just outside the circle', () => {
    const m = matchPlace(nomade, [
      way(30, metresNorth(41.141_5, SEARCH_RADIUS_M + 40), -73.357_9, { name: 'Nomade Westport', cuisine: 'greek' }),
    ]);
    expect(m?.label).toBe('Greek');
  });

  it('rejects an element it cannot locate rather than trusting it', () => {
    const m = matchPlace(nomade, [
      { type: 'node', id: 40, tags: { name: 'Nomade Westport', cuisine: 'italian' } },
    ]);
    expect(m).toBeNull();
  });

  it('skips a match whose cuisine tag says nothing', () => {
    const m = matchPlace(nomade, [
      node(1, metresNorth(41.141_5, 10), -73.357_9, { name: 'Nomade Westport', cuisine: 'regional' }),
    ]);
    expect(m).toBeNull();
  });

  it('returns null for an empty response', () => {
    expect(matchPlace(nomade, [])).toBeNull();
  });
});

describe('cuisineFromOsmTag', () => {
  it('maps the common tags into the app’s own labels', () => {
    expect(cuisineFromOsmTag('italian')).toEqual({ label: 'Italian', canonical: true });
    expect(cuisineFromOsmTag('barbecue')).toEqual({ label: 'BBQ', canonical: true });
    expect(cuisineFromOsmTag('steak_house')).toEqual({ label: 'Steakhouse', canonical: true });
    expect(cuisineFromOsmTag('sichuan')).toEqual({ label: 'Szechuan', canonical: true });
    expect(cuisineFromOsmTag('sri_lankan')).toEqual({ label: 'Sri Lanka'.concat('n'), canonical: true });
  });

  it('takes the most specific value from a semicolon list', () => {
    expect(cuisineFromOsmTag('pizza;italian').label).toBe('Pizza');
    expect(cuisineFromOsmTag('italian;pizza').label).toBe('Italian');
  });

  it('steps over values that describe service rather than food', () => {
    expect(cuisineFromOsmTag('regional;danish').label).toBe('Danish');
    expect(cuisineFromOsmTag('yes;burger').label).toBe('Burgers');
    expect(cuisineFromOsmTag('takeaway;fish_and_chips').label).toBe('Fish & Chips');
  });

  it('prefers a mapped value anywhere in the list over an unmapped one first', () => {
    // "Bavarian" is a fine label, but "German" is one of ours.
    expect(cuisineFromOsmTag('bavarian;german')).toEqual({ label: 'German', canonical: true });
  });

  it('title-cases a value we have no label for, and says it is not canonical', () => {
    expect(cuisineFromOsmTag('bavarian')).toEqual({ label: 'Bavarian', canonical: false });
    expect(cuisineFromOsmTag('new_nordic')).toEqual({ label: 'New Nordic', canonical: false });
  });

  it('refuses to show a tag that means nothing', () => {
    for (const tag of ['regional', 'yes', 'no', 'international', 'variable', 'friture', '']) {
      expect(cuisineFromOsmTag(tag).label).toBe('');
    }
  });

  it('refuses codes and stray fragments that are not words', () => {
    expect(cuisineFromOsmTag('123').label).toBe('');
    expect(cuisineFromOsmTag('a').label).toBe('');
    expect(cuisineFromOsmTag('#!?').label).toBe('');
  });

  it('is insensitive to the whitespace and casing mappers actually use', () => {
    expect(cuisineFromOsmTag('  Italian ;  Pizza  ').label).toBe('Italian');
    expect(cuisineFromOsmTag('GREEK').label).toBe('Greek');
  });
});

describe('attribution', () => {
  it('names OpenStreetMap and the licence, because ODbL requires it', () => {
    expect(CUISINE_ATTRIBUTION).toContain('OpenStreetMap');
    expect(CUISINE_ATTRIBUTION).toContain('ODbL');
  });
});
