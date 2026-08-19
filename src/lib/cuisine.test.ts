import { describe, it, expect } from 'vitest';
import {
  resolveCuisine, cuisineLabel, canonicalCuisineLabel, cuisineFromTypes, labelForCuisineType,
  cuisineFromName,
} from './cuisine';

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
