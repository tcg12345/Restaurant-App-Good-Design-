import { describe, it, expect } from 'vitest';
import { sampleRatings, buildTasteSummary, searchRatings } from './assistant-taste';
import { buildTasteProfile } from './recommendations';
import type { RestaurantRating } from '../contexts/ListsContext';

/** Same shape the engine's own tests use — a full RestaurantRating with
 *  sensible defaults, so these exercise the real builder. */
const full = (over: Partial<RestaurantRating> & { restaurantId: string }): RestaurantRating => ({
  name: over.restaurantId,
  image: '',
  cuisine: 'Italian',
  price: '$$',
  address: '1 Main St, New York, NY 10001, USA',
  score: 9,
  notes: '',
  visitDate: '2026-06-01',
  wouldReturn: true,
  tags: [],
  photos: [],
  listIds: [],
  friendIds: [],
  createdAt: Date.now() - 7 * 86_400_000,
  ...over,
});

const r = (o: Partial<{ restaurantId: string; name: string; score: number; cuisine: string; address: string; updatedAt: number }>) => ({
  restaurantId: o.restaurantId ?? 'x',
  name: o.name ?? 'Place',
  score: o.score,
  cuisine: o.cuisine,
  address: o.address,
  updatedAt: o.updatedAt,
});

describe('sampleRatings', () => {
  it('returns everything, untruncated, under the cap', () => {
    const list = Array.from({ length: 10 }, (_, i) => r({ restaurantId: `a${i}`, score: i }));
    const s = sampleRatings(list, 60);
    expect(s.total).toBe(10);
    expect(s.truncated).toBe(false);
    expect(s.rows).toHaveLength(10);
  });

  it('reports the TRUE total when it truncates', () => {
    // The bug this file exists for: the prompt used to report the truncated
    // length as the total, so the model believed a 200-rating account had 50.
    const list = Array.from({ length: 200 }, (_, i) => r({ restaurantId: `a${i}`, score: i % 10 }));
    const s = sampleRatings(list, 60);
    expect(s.total).toBe(200);
    expect(s.truncated).toBe(true);
    expect(s.rows).toHaveLength(60);
  });

  it('keeps the LOW ratings, not just a highlight reel', () => {
    // Sorting by score alone dropped every dislike — the signal that stops
    // the chat recommending somewhere the user already hated.
    const list = [
      ...Array.from({ length: 100 }, (_, i) => r({ restaurantId: `hi${i}`, score: 9 })),
      r({ restaurantId: 'awful', score: 2.1 }),
      r({ restaurantId: 'bad', score: 3.4 }),
    ];
    const ids = sampleRatings(list, 60).rows.map((x) => x.restaurantId);
    expect(ids).toContain('awful');
    expect(ids).toContain('bad');
  });

  it('keeps recent ratings even when they are middling', () => {
    const list = [
      ...Array.from({ length: 100 }, (_, i) => r({ restaurantId: `hi${i}`, score: 9, updatedAt: 1 })),
      r({ restaurantId: 'lastnight', score: 7, updatedAt: 9_999_999 }),
    ];
    expect(sampleRatings(list, 60).rows.map((x) => x.restaurantId)).toContain('lastnight');
  });

  it('never returns a duplicate and never exceeds the cap', () => {
    const list = Array.from({ length: 300 }, (_, i) => r({ restaurantId: `a${i}`, score: i % 11, updatedAt: i }));
    const rows = sampleRatings(list, 60).rows;
    expect(rows).toHaveLength(60);
    expect(new Set(rows.map((x) => x.restaurantId)).size).toBe(60);
  });
});

describe('buildTasteSummary', () => {
  const many = (cuisine: string, price: string, score: number, n: number, tag = 'Romantic') =>
    Array.from({ length: n }, (_, i) => full({
      restaurantId: `${cuisine}${price}${i}`,
      name: `${cuisine} ${i}`,
      score,
      cuisine,
      price,
      tags: [tag],
    }));

  it('describes how the user grades, in their own terms', () => {
    const tough = buildTasteProfile(many('Italian', '$$', 5.5, 12), [], [], []);
    expect(buildTasteSummary(tough, null).gradingStyle).toMatch(/tough/);
    const easy = buildTasteProfile(many('Italian', '$$', 9.2, 12), [], [], []);
    expect(buildTasteSummary(easy, null).gradingStyle).toMatch(/generous/);
  });

  it('surfaces the pairs and the price concentration the engine actually uses', () => {
    const p = buildTasteProfile(many('Japanese', '$$$$', 9, 14), [], [], []);
    const s = buildTasteSummary(p, null);
    expect(s.topPairs?.[0]).toBe('Japanese $$$$');
    expect(s.priceLabel).toMatch(/\$\$\$\$/);
    expect(s.ratingCount).toBe(14);
  });

  it('carries the quiz answers, including what to avoid', () => {
    const quiz = {
      cuisines: ['Thai'], avoidCuisines: ['Steakhouse'], dietary: ['vegetarian'],
      pricePrimary: 2, completedAt: 1,
    };
    // quizMass is only non-zero when the PROFILE was built with the quiz —
    // the same wiring the recommendation surfaces use.
    const p = buildTasteProfile([], [], [], [], quiz);
    const s = buildTasteSummary(p, quiz);
    expect(s.quiz?.completed).toBe(true);
    expect(s.quiz?.avoidCuisines).toEqual(['Steakhouse']);
    expect(s.quiz?.dietary).toEqual(['vegetarian']);
    // With no ratings the quiz is doing all the work.
    expect(s.quizInfluence).toBe(1);
  });
});

describe('searchRatings', () => {
  const list = [
    r({ restaurantId: '1', name: 'Neptune Oyster', cuisine: 'Seafood', address: 'Boston, MA', score: 9.1 }),
    r({ restaurantId: '2', name: 'Giulia', cuisine: 'Italian', address: 'Cambridge, MA', score: 8.4 }),
    r({ restaurantId: '3', name: 'Carbone', cuisine: 'Italian', address: 'New York, NY', score: 7.2 }),
  ];

  it('matches across name, cuisine and address — every word must land', () => {
    expect(searchRatings(list, { query: 'boston' }).rows.map((x) => x.restaurantId)).toEqual(['1']);
    expect(searchRatings(list, { query: 'italian new york' }).rows.map((x) => x.restaurantId)).toEqual(['3']);
  });

  it('filters by score band and reports the true match count', () => {
    const out = searchRatings(list, { minScore: 8, limit: 1 });
    expect(out.matched).toBe(2);
    expect(out.rows).toHaveLength(1);
  });
});
