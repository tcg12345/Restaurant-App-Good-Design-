import { describe, it, expect } from 'vitest';
import {
  resolveCuisine, cuisineLabel, canonicalCuisineLabel, cuisineFromTypes, labelForCuisineType,
  cuisineFromName, isUnknownCuisine, displayCuisine, formatCuisines, SUGGESTABLE_CUISINES, searchCuisines } from './cuisine';

/** What Google returns for a rural place: it knows the type, but `types`
 *  carries only the generic tail. This is the case the whole module is for. */
const RURAL = {
  types: ['restaurant', 'point_of_interest', 'establishment'],
  primaryType: 'barbecue_restaurant',
  primaryTypeDisplayName: 'Barbecue restaurant',
};

describe('resolveCuisine', () => {
  it('prefers primaryType over the types array', () => {
    expect(resolveCuisine({ types: ['italian_restaurant'], primaryType: 'pizza_restaurant' }))
      .toEqual({ label: 'Pizza', canonical: true, source: 'primaryType' });
  });

  it('reads a rural place that types alone could not answer', () => {
    expect(resolveCuisine(RURAL)).toEqual({ label: 'BBQ', canonical: true, source: 'primaryType' });
    // …which is exactly what the old types-only pass could not do.
    expect(cuisineFromTypes(RURAL.types)).toBe('');
  });

  it('still reads places saved before primaryType was requested', () => {
    expect(resolveCuisine({ types: ['thai_restaurant', 'restaurant'] }))
      .toEqual({ label: 'Thai', canonical: true, source: 'types' });
  });

  // The bug: a place we know nothing about used to answer 'Restaurant',
  // which then rode along on saved ratings as if it were a real cuisine.
  it('is null — never "Restaurant" — when nothing is known', () => {
    expect(resolveCuisine({ types: ['restaurant', 'point_of_interest', 'establishment'] })).toBeNull();
    expect(resolveCuisine({ types: [] })).toBeNull();
    expect(resolveCuisine({})).toBeNull();
    expect(cuisineLabel({ types: ['restaurant'] })).toBe('');
  });

  it('ignores a generic primaryType and keeps looking', () => {
    expect(resolveCuisine({ types: ['greek_restaurant'], primaryType: 'restaurant' }))
      .toEqual({ label: 'Greek', canonical: true, source: 'types' });
    expect(resolveCuisine({ types: ['restaurant'], primaryType: 'restaurant', primaryTypeDisplayName: 'Restaurant' }))
      .toBeNull();
  });

  it('maps a display name back into the taxonomy', () => {
    const cases: Array<[string, string]> = [
      ['Barbecue restaurant', 'BBQ'],
      ['Steak house', 'Steakhouse'],
      ['Italian restaurant', 'Italian'],
      ['Coffee shop', 'Coffee Shop'],
      ['Sushi restaurant', 'Sushi'],
    ];
    for (const [display, label] of cases) {
      expect(resolveCuisine({ types: ['restaurant'], primaryTypeDisplayName: display }))
        .toEqual({ label, canonical: true, source: 'displayName' });
    }
  });

  // Display names are localized and open-ended. Showing one is fine;
  // letting it become a filter facet or a top-list category is not.
  it('keeps an unmapped display name for display only', () => {
    const resolved = resolveCuisine({ types: ['restaurant'], primaryTypeDisplayName: 'Chophouse' })!;
    expect(resolved).toEqual({ label: 'Chophouse', canonical: false, source: 'displayName' });
    expect(cuisineLabel({ types: ['restaurant'], primaryTypeDisplayName: 'Chophouse' })).toBe('Chophouse');
    expect(canonicalCuisineLabel({ types: ['restaurant'], primaryTypeDisplayName: 'Chophouse' })).toBe('');
  });

  it('canonicalCuisineLabel passes taxonomy answers through', () => {
    expect(canonicalCuisineLabel(RURAL)).toBe('BBQ');
  });

  // These read as generic but are real answers — they must not be swallowed.
  it('treats bar, cafe, pub, diner, deli and bakery as answers', () => {
    for (const [type, label] of [
      ['bar', 'Bar'], ['cafe', 'Cafe'], ['pub', 'Pub'],
      ['diner', 'Diner'], ['deli', 'Deli'], ['bakery', 'Bakery'],
    ] as Array<[string, string]>) {
      expect(cuisineLabel({ types: [type] })).toBe(label);
    }
  });

  it('skips generic entries earlier in the types array', () => {
    expect(cuisineLabel({ types: ['establishment', 'food', 'restaurant', 'korean_restaurant'] })).toBe('Korean');
  });
});

describe('labelForCuisineType', () => {
  it('maps a bare type for filter chips', () => {
    expect(labelForCuisineType('vietnamese_restaurant')).toBe('Vietnamese');
    expect(labelForCuisineType('restaurant')).toBe('');
    expect(labelForCuisineType(undefined)).toBe('');
  });
});

describe('cuisineFromName', () => {
  it('reads the cuisine-specific venue words rural names are full of', () => {
    const cases: Array<[string, string]> = [
      ['Taqueria El Sol', 'Mexican'],
      ['Trattoria Bella', 'Italian'],
      ["Tony's Pizzeria", 'Pizza'],
      ['Sakura Sushi House', 'Sushi'],
      ['Ippudo Ramen', 'Ramen'],
      ['Pho 88', 'Vietnamese'],
      ['Le Petit Bistro', 'French'],
      ['Athens Taverna', 'Greek'],
      ['Tandoori Nights', 'Indian'],
      ['Bubba’s Smokehouse', 'BBQ'],
      ['The Chophouse', 'Steakhouse'],
      ['Golden Wok', 'Chinese'],
      ['Ali Baba Kebab', 'Kebab'],
      ['Harbor Oyster Bar', 'Seafood'],
      ['Village Creamery', 'Ice Cream'],
      ['Ridge Road Roasters', 'Coffee Shop'],
      ['Katz Delicatessen', 'Deli'],
      ['Route 9 Diner', 'Diner'],
      ['The Old Tavern', 'Pub'],
    ];
    for (const [name, label] of cases) {
      expect([name, cuisineFromName(name)]).toEqual([name, label]);
    }
  });

  it('reads a nationality in the name', () => {
    expect(cuisineFromName('Mario’s Italian Kitchen')).toBe('Italian');
    expect(cuisineFromName('Thai Basil')).toBe('Thai');
    expect(cuisineFromName('Addis Ethiopian Cuisine')).toBe('Ethiopian');
  });

  // The whole value of this source is that it stays accurate. A name that
  // merely *contains* the letters of a cuisine word must not match, and
  // words that every cuisine uses must never match at all.
  it('does not match inside longer words', () => {
    expect(cuisineFromName('Barbounia')).toBe('');       // not barbecue
    expect(cuisineFromName('Phoenix Grill')).toBe('');   // not pho
    expect(cuisineFromName('Woking Man Cafe')).not.toBe('Chinese');
    expect(cuisineFromName('Thailor Made')).toBe('');    // not thai
  });

  it('ignores words every cuisine uses', () => {
    for (const name of [
      'The Grill', 'Hudson Kitchen', 'The Restaurant', 'Corner Bar',
      'The Farmhouse', 'Main Street Eatery', 'Nowhere Grill',
    ]) {
      expect([name, cuisineFromName(name)]).toEqual([name, '']);
    }
  });

  it('is empty for nothing', () => {
    expect(cuisineFromName('')).toBe('');
    expect(cuisineFromName(undefined)).toBe('');
  });
});

// Cases taken verbatim from measuring the real gap — the two the wider
// field mask "recovered" were the two worth checking.
describe('resolveCuisine · what the field mask actually returned', () => {
  it('does not pass off the property a restaurant sits in as its cuisine', () => {
    // Falsled Kro, a Relais & Châteaux place: Google's only label was "Inn".
    expect(resolveCuisine({ types: ['restaurant'], primaryTypeDisplayName: 'Inn' })).toBeNull();
    for (const venue of ['Hotel', 'Resort', 'Casino', 'Lodge', 'Country club', 'Bed and breakfast']) {
      expect([venue, resolveCuisine({ types: ['restaurant'], primaryTypeDisplayName: venue })])
        .toEqual([venue, null]);
    }
  });

  it('drops the suffix so the label reads like a cuisine', () => {
    // Colombia Kaliente came back as "Colombian Restaurant".
    expect(resolveCuisine({ types: ['restaurant'], primaryTypeDisplayName: 'Colombian Restaurant' }))
      .toEqual({ label: 'Colombian', canonical: false, source: 'displayName' });
    expect(cuisineLabel({ types: ['restaurant'], primaryTypeDisplayName: 'Sri Lankan Restaurant' }))
      .toBe('Sri Lankan');
  });

  it('still prefers a taxonomy hit over the stripped word', () => {
    // "Barbecue restaurant" must stay BBQ, not become "Barbecue".
    expect(resolveCuisine({ types: ['restaurant'], primaryTypeDisplayName: 'Barbecue restaurant' }))
      .toEqual({ label: 'BBQ', canonical: true, source: 'displayName' });
    expect(cuisineLabel({ types: ['restaurant'], primaryTypeDisplayName: 'Fine dining restaurant' }))
      .toBe('Fine Dining');
  });

  it('a venue type in the types array is not a cuisine either', () => {
    expect(cuisineLabel({ types: ['lodging', 'hotel', 'restaurant'] })).toBe('');
  });
});

/**
 * A venue is not a cuisine.
 *
 * Cinemas, malls and stadiums carry `restaurant` or `food` in their types —
 * they have a concession stand or a food court — so they reach the cuisine
 * resolver looking like food places. Before this, the display-name fallback
 * printed Google's label for them verbatim and a cinema's cuisine read
 * "Movie theater".
 *
 * The places named here are the ones that actually turned up in the app's
 * recommendations.
 */
describe('resolveCuisine · venues never yield a cuisine', () => {
  it('refuses a cinema, however much popcorn it sells', () => {
    // Cinemark North Haven and XD
    expect(resolveCuisine({
      primaryType: 'movie_theater',
      primaryTypeDisplayName: 'Movie theater',
      types: ['movie_theater', 'restaurant', 'point_of_interest', 'establishment'],
    })).toBeNull();
  });

  it('refuses a shopping mall with a food court', () => {
    // Meriden Mall
    expect(resolveCuisine({
      primaryType: 'shopping_mall',
      primaryTypeDisplayName: 'Shopping mall',
      types: ['shopping_mall', 'food', 'point_of_interest', 'establishment'],
    })).toBeNull();
  });

  it('refuses the rest of the venue family', () => {
    for (const [primaryType, display] of [
      ['stadium', 'Stadium'],
      ['supermarket', 'Supermarket'],
      ['gas_station', 'Gas station'],
      ['hospital', 'Hospital'],
      ['bowling_alley', 'Bowling alley'],
      ['airport', 'Airport'],
      ['casino', 'Casino'],
      ['golf_course', 'Golf course'],
    ] as const) {
      expect(resolveCuisine({ primaryType, primaryTypeDisplayName: display, types: ['restaurant'] }))
        .toBeNull();
    }
  });

  it('still answers for the rural restaurants this fallback exists for', () => {
    // The Phase 1 win must survive: `types` says nothing, the display name
    // carries the answer.
    expect(resolveCuisine({
      primaryType: 'barbecue_restaurant',
      primaryTypeDisplayName: 'Barbecue restaurant',
      types: ['restaurant', 'point_of_interest', 'establishment'],
    })?.label).toBe('BBQ');
    expect(resolveCuisine({
      primaryTypeDisplayName: 'Colombian restaurant',
      types: ['restaurant', 'point_of_interest', 'establishment'],
    })?.label).toBe('Colombian');
  });

  it('still answers for a restaurant that happens to sit in a venue', () => {
    // A real restaurant inside a casino resort: its own place id, its own
    // primaryType. Only the property POI is excluded, never the restaurant.
    expect(resolveCuisine({
      primaryType: 'fine_dining_restaurant',
      primaryTypeDisplayName: 'Fine dining restaurant',
      types: ['fine_dining_restaurant', 'restaurant', 'casino'],
    })?.label).toBe('Fine Dining');
  });
});


/**
 * The word "Restaurant" in someone's saved rating.
 *
 * For years the resolver ended in an unconditional `return 'Restaurant'`,
 * so that word is sitting in real rows today — five of the six ratings in
 * this app that have no usable cuisine say "Restaurant", not "".
 *
 * That is why this is a predicate rather than an emptiness check. The
 * backfill in ListsContext only repairs rows it considers unanswered, so
 * `if (r.cuisine)` silently excluded exactly the rows that needed fixing.
 */
describe('isUnknownCuisine', () => {
  it('treats the resolver’s old non-answer as unanswered', () => {
    expect(isUnknownCuisine('Restaurant')).toBe(true);
    expect(isUnknownCuisine('restaurant')).toBe(true);
    expect(isUnknownCuisine('  Restaurant  ')).toBe(true);
  });

  it('treats an empty cuisine as unanswered', () => {
    expect(isUnknownCuisine('')).toBe(true);
    expect(isUnknownCuisine('   ')).toBe(true);
    expect(isUnknownCuisine(null)).toBe(true);
    expect(isUnknownCuisine(undefined)).toBe(true);
  });

  it('treats the other Places-type leakage as unanswered', () => {
    for (const junk of ['Food', 'Establishment', 'Point of interest', 'point_of_interest', 'Store']) {
      expect(isUnknownCuisine(junk)).toBe(true);
    }
  });

  it('leaves real cuisines alone — including the ones that look generic', () => {
    // These are answers, not fallbacks: a bar is a bar.
    for (const real of ['Bar', 'Cafe', 'Café', 'Bakery', 'Diner', 'Deli', 'Pub',
                        'American', 'Fine Dining', 'Steakhouse', 'Wine Bar']) {
      expect(isUnknownCuisine(real)).toBe(false);
    }
  });

  it('does not swallow a cuisine that merely contains the word', () => {
    expect(isUnknownCuisine('Restaurant Week Special')).toBe(false);
    expect(isUnknownCuisine('Seafood Restaurant')).toBe(false);
  });
});

describe('displayCuisine', () => {
  it('blanks a non-answer so meta lines drop it instead of printing it', () => {
    // Every meta line in the app is .filter(Boolean).join(' · ').
    expect(displayCuisine('Restaurant')).toBe('');
    expect(displayCuisine('Food')).toBe('');
    expect(['', '$$$'].filter(Boolean).join(' · ')).toBe('$$$');
  });

  it('passes a real cuisine through, trimmed', () => {
    expect(displayCuisine('  Peruvian ')).toBe('Peruvian');
    expect(displayCuisine('Bar')).toBe('Bar');
  });
});


/**
 * Several cuisines on one line (migration 071).
 *
 * The separator is the whole point. Every meta line in the app is
 * `[cuisine, price, city].filter(Boolean).join(' · ')`, so cuisines cannot
 * also be joined with ' · ' — "Italian · Pizza · $$" reads as three fields
 * and no reader can tell where the cuisines end.
 */
describe('formatCuisines', () => {
  it('joins with a comma so the meta line stays parseable', () => {
    expect(formatCuisines(['Italian', 'Pizza'])).toBe('Italian, Pizza');
    expect(['Italian, Pizza', '$$'].filter(Boolean).join(' · ')).toBe('Italian, Pizza · $$');
  });

  it('handles the ordinary single-cuisine case', () => {
    expect(formatCuisines(['Thai'])).toBe('Thai');
  });

  it('is empty when there is nothing to say', () => {
    expect(formatCuisines([])).toBe('');
    expect(formatCuisines([''])).toBe('');
    expect(formatCuisines([null, undefined])).toBe('');
  });

  it('drops the non-answers rather than printing them alongside real ones', () => {
    expect(formatCuisines(['Restaurant', 'Peruvian'])).toBe('Peruvian');
    expect(formatCuisines(['Italian', 'Food'])).toBe('Italian');
  });

  it('collapses duplicates, however they are cased', () => {
    expect(formatCuisines(['Italian', 'italian', 'Pizza'])).toBe('Italian, Pizza');
  });

  it('preserves the order it is given — the primary comes first', () => {
    expect(formatCuisines(['Pizza', 'Italian'])).toBe('Pizza, Italian');
  });
});


/**
 * What a person can propose.
 *
 * The list is the app's vocabulary for the whole crowd-sourcing flow — a
 * cuisine that is not in it cannot be suggested, cannot reach consensus,
 * and cannot ever be shown. The gap was measurable: the Michelin data
 * this app ships labels 4,229 restaurants "Modern", 1,690 "Contemporary"
 * and 1,426 "Creative", and it DISPLAYED all of them while offering none.
 */
describe('SUGGESTABLE_CUISINES', () => {
  const has = (label: string) =>
    SUGGESTABLE_CUISINES.some((c) => c.toLowerCase() === label.toLowerCase());

  it('covers the styles the app already displays', () => {
    for (const label of ['Modern', 'Contemporary', 'Creative', 'Traditional',
                         'Classic', 'Seasonal', 'Fusion', 'Innovative']) {
      expect(has(label), label).toBe(true);
    }
  });

  it('covers style-crossed-with-place, which is how guides name a kitchen', () => {
    for (const label of ['American Contemporary', 'Modern British', 'Modern French',
                         'Classic French', 'Italian Contemporary', 'Japanese Contemporary']) {
      expect(has(label), label).toBe(true);
    }
  });

  it('covers regional slices, not just national ones', () => {
    for (const label of ['Sichuan', 'Shanghainese', 'Cantonese', 'Northern Thai',
                         'South Indian', 'Piedmontese', 'Sicilian', 'Provençal',
                         'Andalusian', 'Oaxacan', 'Lowcountry']) {
      expect(has(label), label).toBe(true);
    }
  });

  it('has no duplicates, in any casing', () => {
    const lower = SUGGESTABLE_CUISINES.map((c) => c.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });

  it('never offers a non-answer as something to suggest', () => {
    // "Restaurant", "Food", "International" describe nothing. Offering one
    // would let the crowd vote a place back to having no cuisine at all.
    for (const junk of ['Restaurant', 'Food', 'Establishment', 'International',
                        'Regional', 'World', 'Other']) {
      expect(has(junk), junk).toBe(false);
    }
  });

  it('is sorted, so the unsearched list is navigable', () => {
    const sorted = [...SUGGESTABLE_CUISINES].sort((a, b) => a.localeCompare(b));
    expect(SUGGESTABLE_CUISINES).toEqual(sorted);
  });
});

/**
 * Searching it.
 *
 * At 400 labels the ranking IS the feature. And the aliases are what stop
 * the taxonomy's own vocabulary being a barrier: the list says "BBQ", the
 * sign outside says "Barbecue", and before this the second one found
 * nothing at all.
 */
describe('searchCuisines', () => {
  const first = (q: string) => searchCuisines(q)[0];

  it('finds a cuisine by the word on the restaurant’s sign', () => {
    expect(first('barbecue')).toBe('BBQ');
    expect(first('barbeque')).toBe('BBQ');
    expect(first('szechuan')).toBe('Sichuan');
    expect(first('boba')).toBe('Bubble Tea');
    expect(first('taqueria')).toBe('Mexican');
    expect(first('hamburger')).toBe('Burgers');
  });

  it('puts an exact prefix first, ahead of a mere containment', () => {
    expect(first('ch')).toBe('Chaozhou');
    expect(first('contemporary')).toBe('Contemporary');
    expect(first('modern')).toBe('Modern');
    expect(first('american')).toBe('American');
  });

  it('matches a word inside a label, so a second word is reachable', () => {
    const r = searchCuisines('contemporary');
    expect(r).toContain('American Contemporary');
    expect(r).toContain('Japanese Contemporary');
  });

  it('returns the whole list for an empty query', () => {
    expect(searchCuisines('')).toEqual(SUGGESTABLE_CUISINES);
    expect(searchCuisines('   ')).toEqual(SUGGESTABLE_CUISINES);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(searchCuisines('zzzzz')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(searchCuisines('THAI')).toContain('Thai');
    expect(searchCuisines('BaRbEcUe')[0]).toBe('BBQ');
  });

  it('never returns a label twice', () => {
    for (const q of ['a', 'e', 'an', 'american', 'contemporary', 'bbq']) {
      const r = searchCuisines(q);
      expect(new Set(r).size, q).toBe(r.length);
    }
  });
});
