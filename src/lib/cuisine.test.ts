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
