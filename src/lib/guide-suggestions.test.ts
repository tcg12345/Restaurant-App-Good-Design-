import { describe, it, expect } from 'vitest';
import {
  readBrief,
  scoreRatings,
  scoreRecipes,
  describeCriteria,
  type RatingLike,
  type RecipeLike,
} from './guide-suggestions';

const brief = (title: string, tags: string[] = []) => readBrief({ title, tags });

const RATINGS: RatingLike[] = [
  { restaurantId: 'i1', name: 'Via Carota', cuisine: 'Italian', price: '$$$', address: '51 Grove St, West Village, New York', score: 9.4, tags: ['Romantic'] },
  { restaurantId: 'i2', name: 'Rubirosa', cuisine: 'Pizza', price: '$$', address: '235 Mulberry St, Nolita, New York', score: 8.9 },
  { restaurantId: 'i3', name: "L'Artusi", cuisine: 'Modern Italian', price: '$$$$', address: '228 W 10th St, West Village, New York', score: 9.1 },
  { restaurantId: 't1', name: 'Thai Diner', cuisine: 'Thai', price: '$$', address: '186 Mott St, Nolita, New York', score: 9.8, tags: ['Great for groups'] },
  { restaurantId: 'j1', name: 'Sushi Noz', cuisine: 'Japanese', price: '$$$$', address: '181 E 78th St, Upper East Side, New York', score: 9.6 },
  { restaurantId: 'c1', name: 'Joe’s Pizza', cuisine: 'Pizza', price: '$', address: '7 Carmine St, West Village, New York', score: 7.8 },
];

describe('readBrief — reading what the user actually wrote', () => {
  it('pulls the cuisine out of the canonical case', () => {
    const c = brief('Best italian food');
    expect(c.cuisines).toEqual(['Italian']);
    expect(c.superlative).toBe(true);
    expect(c.isGeneric).toBe(false);
  });

  it('resolves an alias to the label the app actually stores', () => {
    expect(brief('my favourite taqueria').cuisines).toEqual(['Mexican']);
    expect(brief('best barbecue in texas').cuisines).toEqual(['BBQ']);
  });

  it('prefers the longest cuisine phrase', () => {
    // "korean bbq" must not become Korean + BBQ.
    expect(brief('korean bbq roundup').cuisines).toEqual(['Korean BBQ']);
  });

  it('does not invent a cuisine from a partial word', () => {
    // The fuzzy picker search would reach for something here; this must not.
    expect(brief('Best places').cuisines).toEqual([]);
    expect(brief('Thainess').cuisines).toEqual([]);
  });

  it('reads price intent both ways', () => {
    expect(brief('cheap eats').price).toBe('cheap');
    expect(brief('fancy tasting menu spots').price).toBe('splurge');
    expect(brief('Italian dinner').price).toBeNull();
  });

  it('reads a vibe from the title', () => {
    expect(brief('cozy date night spots').vibes).toContain('romantic');
    expect(brief('cozy date night spots').vibes).toContain('cozy');
  });

  it('reads tags as part of the brief, not just the title', () => {
    const c = brief('Weekend list', ['Brunch']);
    expect(c.vibes).toContain('brunch');
    expect(c.isGeneric).toBe(false);
  });

  it('treats leftover words as a place, with the vocabularies consumed first', () => {
    const c = brief('Best Thai in Austin');
    expect(c.cuisines).toEqual(['Thai']);
    // 'best' (superlative) and 'thai' (cuisine) must not survive as places.
    expect(c.places).toEqual(['austin']);
  });

  it('drops filler words that would otherwise look like place names', () => {
    expect(brief('The best food places').places).toEqual([]);
  });

  it('keeps a multi-word neighbourhood together', () => {
    expect(brief('Best pizza in the West Village').places).toEqual(['west village']);
  });

  it('marks a contentless title generic', () => {
    const c = brief('My guide');
    expect(c.isGeneric).toBe(true);
    expect(describeCriteria(c)).toMatch(/highest rated/i);
  });

  it('reads recipe time, spelled out or implied', () => {
    expect(brief('30 minute dinners').maxMinutes).toBe(30);
    expect(brief('quick weeknight meals').maxMinutes).toBe(30);
    expect(brief('Sunday braises').maxMinutes).toBeNull();
  });
});

describe('scoreRatings — a specific brief filters, it does not merely nudge', () => {
  it('returns only the Italian places for an Italian title', () => {
    const out = scoreRatings(RATINGS, brief('Best italian food'));
    expect(out.map((s) => s.item.restaurantId)).toEqual(['i1', 'i3']);
  });

  it('does not let a higher-scoring wrong-cuisine place in', () => {
    // Thai Diner is the user's best-rated place at 9.8. It is still wrong.
    const ids = scoreRatings(RATINGS, brief('Best italian food')).map((s) => s.item.restaurantId);
    expect(ids).not.toContain('t1');
  });

  it('orders by the user\'s own score inside the matching set', () => {
    const out = scoreRatings(RATINGS, brief('Best italian food'));
    expect(out[0].item.restaurantId).toBe('i1'); // 9.4 over L'Artusi's 9.1
  });

  it('falls back to highest-rated when the brief says nothing', () => {
    const out = scoreRatings(RATINGS, brief('My guide'), { limit: 3 });
    expect(out.map((s) => s.item.restaurantId)).toEqual(['t1', 'j1', 'i1']);
  });

  it('combines a cuisine and a neighbourhood', () => {
    const out = scoreRatings(RATINGS, brief('Best pizza in the West Village'));
    // Joe's is West Village pizza and wins on both counts; Rubirosa is
    // pizza in Nolita and still qualifies on cuisine alone.
    expect(out[0].item.restaurantId).toBe('c1');
    expect(out.map((s) => s.item.restaurantId)).toContain('i2');
  });

  it('honours a price ceiling', () => {
    const ids = scoreRatings(RATINGS, brief('cheap eats')).map((s) => s.item.restaurantId);
    expect(ids).toContain('c1');   // $
    expect(ids).toContain('i2');   // $$
    expect(ids).not.toContain('j1'); // $$$$
  });

  it('matches a vibe against the tags the user put on their own rating', () => {
    const out = scoreRatings(RATINGS, brief('date night spots'));
    expect(out.map((s) => s.item.restaurantId)).toContain('i1'); // tagged Romantic
  });

  it('never suggests something already added', () => {
    const out = scoreRatings(RATINGS, brief('Best italian food'), { exclude: new Set(['i1']) });
    expect(out.map((s) => s.item.restaurantId)).toEqual(['i3']);
  });

  it('says why each suggestion is there', () => {
    const out = scoreRatings(RATINGS, brief('Best italian food'));
    expect(out[0].reasons).toContain('Italian');
  });

  it('respects the limit and is stable across input order', () => {
    const a = scoreRatings(RATINGS, brief('My guide'), { limit: 4 });
    const b = scoreRatings([...RATINGS].reverse(), brief('My guide'), { limit: 4 });
    expect(a.map((s) => s.item.restaurantId)).toEqual(b.map((s) => s.item.restaurantId));
    expect(a).toHaveLength(4);
  });

  it('returns nothing rather than something wrong when nothing matches', () => {
    expect(scoreRatings(RATINGS, brief('Best Ethiopian food'))).toEqual([]);
  });

  it('lets a named cuisine veto a place that answers every OTHER criterion', () => {
    // Thai Diner is cheap, in Nolita, tagged for groups, and the user's
    // highest-rated place. It is not Italian, so it is not eligible.
    const ids = scoreRatings(RATINGS, brief('cheap italian in nolita for groups'))
      .map((s) => s.item.restaurantId);
    expect(ids).not.toContain('t1');
    expect(ids).toContain('i1');
  });
});

const RECIPES: RecipeLike[] = [
  { id: 'r1', title: 'Cacio e pepe', cuisine: 'Italian', difficulty: 'easy', prepTimeMinutes: 5, cookTimeMinutes: 15, score: 9.2 },
  { id: 'r2', title: 'Sunday ragu', cuisine: 'Italian', difficulty: 'hard', prepTimeMinutes: 30, cookTimeMinutes: 240, score: 9.5 },
  { id: 'r3', title: 'Pad kee mao', cuisine: 'Thai', difficulty: 'medium', prepTimeMinutes: 15, cookTimeMinutes: 15, score: 8.8 },
  { id: 'r4', title: 'Weeknight miso salmon', cuisine: 'Japanese', difficulty: 'easy', prepTimeMinutes: 5, cookTimeMinutes: 20 },
];

describe('scoreRecipes', () => {
  it('filters by cuisine like the restaurant half', () => {
    const out = scoreRecipes(RECIPES, brief('Best italian recipes'));
    expect(out.map((s) => s.item.id).sort()).toEqual(['r1', 'r2']);
  });

  it('applies an implied time budget', () => {
    const ids = scoreRecipes(RECIPES, brief('quick weeknight dinners')).map((s) => s.item.id);
    expect(ids).toContain('r1');   // 20 min
    expect(ids).toContain('r4');   // 25 min
    expect(ids).not.toContain('r2'); // 270 min
  });

  it('combines cuisine and time', () => {
    const out = scoreRecipes(RECIPES, brief('quick italian recipes'));
    expect(out[0].item.id).toBe('r1');
    // The 4½-hour ragu still matches on cuisine, so it survives — but under
    // the one that answers both.
    expect(out.map((s) => s.item.id)).toEqual(['r1', 'r2']);
  });

  it('treats an unscored recipe as unknown, not bad', () => {
    // r4 has no score; against a generic brief it should still place above
    // nothing and below the well-rated ones rather than being dropped.
    const ids = scoreRecipes(RECIPES, brief('My recipes')).map((s) => s.item.id);
    expect(ids).toContain('r4');
    expect(ids.indexOf('r2')).toBeLessThan(ids.indexOf('r4'));
  });
});
