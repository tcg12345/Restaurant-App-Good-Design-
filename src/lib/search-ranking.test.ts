import { describe, it, expect } from 'vitest';
import { matchScore, personNameLikeness, rankResults, rankBy, bestScore, type Rankable } from './search-ranking';

const person = (primary: string, extra: Partial<Rankable> = {}): Rankable =>
  ({ kind: 'person', primary, ...extra });
const restaurant = (primary: string, extra: Partial<Rankable> = {}): Rankable =>
  ({ kind: 'restaurant', primary, ...extra });
const recipe = (primary: string, extra: Partial<Rankable> = {}): Rankable =>
  ({ kind: 'recipe', primary, ...extra });

describe('matchScore', () => {
  it('tiers exact above prefix above word-prefix above substring', () => {
    expect(matchScore('Jenifer', 'jenifer')).toBe(100);
    expect(matchScore('Jenifer Lopez', 'jenifer')).toBe(85);
    expect(matchScore('Ana Jenifer', 'jenifer')).toBe(70);
    expect(matchScore('Bonjenifer', 'jenifer')).toBe(40);
    expect(matchScore('Pizza Place', 'jenifer')).toBe(0);
  });

  it('is empty-safe', () => {
    expect(matchScore(null, 'x')).toBe(0);
    expect(matchScore('x', '')).toBe(0);
  });

  it('does not let regex metacharacters in the query throw', () => {
    expect(() => matchScore('Joe (the Grill)', 'joe (')).not.toThrow();
  });
});

describe('personNameLikeness', () => {
  it('rates a plain one- or two-word name highly', () => {
    expect(personNameLikeness('Jenifer')).toBe(1);
    expect(personNameLikeness('Ana Ruiz')).toBe(1);
  });

  it('generalises past any first-name list', () => {
    for (const n of ['Ayesha', 'Kwame', 'Nguyen', 'Søren']) {
      expect(personNameLikeness(n)).toBeGreaterThan(0.5);
    }
  });

  it('rejects food and venue queries', () => {
    for (const q of ['pizza', 'sushi near me', 'best tacos', 'thai', 'coffee bar']) {
      expect(personNameLikeness(q)).toBe(0);
    }
  });

  it('rejects handles, digits and empty input', () => {
    expect(personNameLikeness('@jenifer')).toBe(0);
    expect(personNameLikeness('table 4')).toBe(0);
    expect(personNameLikeness('   ')).toBe(0);
  });

  it('is lukewarm about very short fragments', () => {
    expect(personNameLikeness('ba')).toBeLessThan(0.5);
  });
});

describe('rankResults', () => {
  it('puts a matching person above restaurants for a name-like query', () => {
    const ranked = rankResults([
      restaurant('Jenifer Street Cafe'),
      restaurant('Cafe Jenifer'),
      person('Jenifer Alvarez'),
    ], 'Jenifer');
    expect(ranked[0].kind).toBe('person');
  });

  it('still ranks restaurants first when the query is about food', () => {
    const ranked = rankResults([
      person('Pizza Pete'),
      restaurant('Pizza Union'),
    ], 'pizza');
    expect(ranked[0].kind).toBe('restaurant');
  });

  it('drops results that do not match at all', () => {
    const ranked = rankResults([restaurant('Noma'), person('Jenifer')], 'jenifer');
    expect(ranked).toHaveLength(1);
    expect(ranked[0].primary).toBe('Jenifer');
  });

  it('matches a person on their handle as well as their name', () => {
    const ranked = rankResults([
      restaurant('Something Else'),
      person('Ana Ruiz', { secondary: 'jenifer_r' }),
    ], 'jenifer');
    expect(ranked[0].primary).toBe('Ana Ruiz');
  });

  it('prefers a connection over a stranger at equal match quality', () => {
    const ranked = rankResults([
      person('Jenifer Stone'),
      person('Jenifer Stone', { connected: true, secondary: 'friend' }),
    ], 'Jenifer Stone');
    expect(ranked[0].connected).toBe(true);
  });

  it('never lets popularity outrank a better textual match', () => {
    const ranked = rankResults([
      restaurant('The Jeniferia', { popularity: 1 }),   // substring only
      person('Jenifer', { popularity: 0 }),             // exact
    ], 'Jenifer');
    expect(ranked[0].primary).toBe('Jenifer');
  });

  it('keeps recipes in the mix for food queries', () => {
    const ranked = rankResults([
      person('Ramen Guy'),
      recipe('Shoyu Ramen'),
    ], 'ramen');
    expect(ranked[0].kind).toBe('recipe');
  });

  it('is stable for equal scores, preserving caller order', () => {
    const a = restaurant('Jenifer A');
    const b = restaurant('Jenifer B');
    expect(rankResults([a, b], 'Jenifer').map((r) => r.primary)).toEqual(['Jenifer A', 'Jenifer B']);
  });

  it('passes everything through untouched for an empty query', () => {
    const items = [restaurant('A'), person('B')];
    expect(rankResults(items, '  ')).toEqual(items);
  });
});

describe('rankBy / bestScore — the section-ordering path', () => {
  // Stand-ins for the real UserProfile / PlaceResult shapes, which carry no
  // ranking fields of their own.
  const people = [{ display_name: 'Jenifer Alvarez', username: 'jen_a' }];
  const places = [{ name: 'Jenifer Street Cafe' }, { name: 'Noma' }];
  const asPerson = (p: typeof people[0]): Rankable =>
    ({ kind: 'person', primary: p.display_name, secondary: p.username });
  const asPlace = (r: typeof places[0]): Rankable => ({ kind: 'restaurant', primary: r.name });

  it('ranks domain objects without needing them to be Rankable', () => {
    expect(rankBy(places, 'noma', asPlace)).toEqual([{ name: 'Noma' }]);
  });

  it('scores the People group above the Restaurants group for a name', () => {
    expect(bestScore(people, 'Jenifer', asPerson))
      .toBeGreaterThan(bestScore(places, 'Jenifer', asPlace));
  });

  it('scores the Restaurants group above People for a food query', () => {
    const foodPlaces = [{ name: 'Pizza Union' }];
    const pizzaPeople = [{ display_name: 'Pizza Pete', username: 'pete' }];
    expect(bestScore(foodPlaces, 'pizza', asPlace))
      .toBeGreaterThan(bestScore(pizzaPeople, 'pizza', asPerson));
  });

  it('reports zero for a group with nothing matching', () => {
    expect(bestScore(places, 'jenifer', asPlace)).toBeGreaterThan(0);
    expect(bestScore([], 'jenifer', asPlace)).toBe(0);
    expect(bestScore(places, 'zzzz', asPlace)).toBe(0);
  });
});
