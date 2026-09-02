import { describe, it, expect } from 'vitest';
import { buildTasteProfile } from './recommendations';
import { buildTasteInsights, type InsightRating, type TasteBenchmarks } from './taste-insights';
import type { RestaurantRating } from '../contexts/ListsContext';

const NOW = Date.UTC(2026, 8, 1, 12); // 2026-09-01

const rating = (over: Partial<InsightRating> & { restaurantId: string; score: number }): InsightRating => ({
  name: over.restaurantId, cuisine: 'Italian', price: '$$', address: '1 St, Boston, MA',
  notes: '', tags: [], photos: [], friendIds: [], wouldReturn: true, createdAt: NOW - 200 * 86_400_000,
  ...over,
});

/** The engine's builder takes the full rating shape; pad the fields it
 *  reads but the insight fixture doesn't care about. */
const asEngineRating = (r: InsightRating): RestaurantRating => ({
  restaurantId: r.restaurantId, name: r.name ?? r.restaurantId, image: '', cuisine: r.cuisine ?? '',
  price: r.price ?? '', address: r.address ?? '', score: r.score, notes: r.notes ?? '', visitDate: r.visitDate ?? '',
  wouldReturn: r.wouldReturn ?? true, tags: r.tags ?? [], photos: [], listIds: [], friendIds: r.friendIds ?? [],
  createdAt: r.createdAt ?? 0,
});

function insightsFor(rows: InsightRating[], bench?: TasteBenchmarks | null) {
  const profile = buildTasteProfile(rows.map(asEngineRating), [], [], [], null);
  return buildTasteInsights(rows, profile, { benchmarks: bench ?? null, now: NOW });
}

const bench: TasteBenchmarks = {
  rankedUsers: 40, myRank: 3, myPoints: 150, platformAvgScore: 7.6, avgCuisineCount: 8,
  avgCityCount: 2, medianRatingCount: 20, gradingPercentile: 0.8, breadthPercentile: 0.9,
  distinctivePercentile: 0.9, platformPriceShare: [0.1, 0.5, 0.3, 0.1], concentratedUserShare: 0.3,
};

describe('buildTasteInsights', () => {
  it('finds the cuisine you love more than you eat, and the one you eat more than you love', () => {
    const rows: InsightRating[] = [
      // Italian: eaten most, rated under the bar.
      ...[5.5, 6, 6.2, 5.8, 6.4, 6.1].map((s, i) => rating({ restaurantId: `it${i}`, score: s, cuisine: 'Italian' })),
      // Japanese: middle of the pack.
      ...[7.5, 8, 7.8].map((s, i) => rating({ restaurantId: `jp${i}`, score: s, cuisine: 'Japanese' })),
      // Mexican: filler at the anchor so the distribution is honest.
      ...[7, 7.2, 6.9].map((s, i) => rating({ restaurantId: `mx${i}`, score: s, cuisine: 'Mexican' })),
      // Thai: rarely eaten, loved.
      ...[9.4, 9.1].map((s, i) => rating({ restaurantId: `th${i}`, score: s, cuisine: 'Thai' })),
    ];
    const ins = insightsFor(rows);
    expect(ins.loveMoreThanEat?.name).toBe('Thai');
    expect(ins.eatMoreThanLove?.name).toBe('Italian');
    expect(ins.cuisines[0].name).toBe('Italian');
    expect(ins.sentences.some((s) => s.id === 'love-more')).toBe(true);
    expect(ins.sentences.some((s) => s.id === 'eat-more')).toBe(true);
  });

  it('reads price concentration and grading against the platform', () => {
    const rows = Array.from({ length: 12 }, (_, i) => rating({
      restaurantId: `r${i}`, score: 6 + (i % 3) * 0.4, price: i < 10 ? '$$$' : '$$',
    }));
    const ins = insightsFor(rows, bench);
    expect(ins.price.dominantTier).toBe(3);
    expect(ins.price.dominantShare).toBeCloseTo(10 / 12, 5);
    const priceLine = ins.sentences.find((s) => s.id === 'price');
    expect(priceLine?.headline).toBe('You live in $$$');
    expect(priceLine?.detail).toContain('only 30% of raters');
    const grading = ins.sentences.find((s) => s.id === 'grading');
    expect(grading?.headline).toMatch(/tougher than the average rater/);
    expect(ins.grading.label).toBe('tough');
    expect(ins.chips).toContain('Lives in $$$');
    expect(ins.chips).toContain('Tough grader');
    expect(ins.chips.length).toBeLessThanOrEqual(3);
    // Distinctive percentile leads the sentences when it is available.
    expect(ins.sentences[0].id).toBe('distinctive');
  });

  it('never compares to the platform without benchmarks', () => {
    const rows = Array.from({ length: 8 }, (_, i) => rating({ restaurantId: `r${i}`, score: 8.5 + (i % 2) * 0.3 }));
    const ins = insightsFor(rows, null);
    expect(ins.grading.vsPlatform).toBeNull();
    expect(ins.sentences.find((s) => s.id === 'grading')?.headline).toBe('A generous grader');
    expect(ins.sentences.some((s) => s.id === 'distinctive')).toBe(false);
  });

  it('sees score drift and newly discovered cuisines in the last 90 days', () => {
    const old = (i: number) => NOW - (120 + i * 10) * 86_400_000;
    const recent = (i: number) => NOW - (5 + i * 7) * 86_400_000;
    const rows: InsightRating[] = [
      ...[6, 6.5, 6.2, 6.8].map((s, i) => rating({ restaurantId: `o${i}`, score: s, cuisine: 'Italian', createdAt: old(i) })),
      ...[8, 8.4, 7.9].map((s, i) => rating({ restaurantId: `n${i}`, score: s, cuisine: ['Thai', 'Peruvian', 'Thai'][i], createdAt: recent(i) })),
    ];
    const ins = insightsFor(rows);
    expect(ins.trend.drift).toBeCloseTo(8.1 - 6.375, 5);
    expect(ins.trend.newCuisines).toEqual(['Thai', 'Peruvian']);
    expect(ins.trend.recentTopCuisine).toBe('Thai');
    expect(ins.trend.priorTopCuisine).toBe('Italian');
    expect(ins.trend.periods.length).toBeGreaterThanOrEqual(2);
    expect(ins.trend.periods[ins.trend.periods.length - 1].cuisinesToDate).toBe(3);
    expect(ins.sentences.some((s) => s.id === 'drift')).toBe(true);
    expect(ins.sentences.some((s) => s.id === 'new-cuisines')).toBe(true);
  });

  it('reads the calendar and the table: weekends, company, repeat visits', () => {
    const rows = Array.from({ length: 10 }, (_, i) => rating({
      restaurantId: `r${i}`, score: 7 + (i % 4) * 0.5,
      // 2026-09-05 is a Saturday; step by weeks so 8 of 10 are Saturdays.
      visitDate: i < 8 ? new Date(Date.UTC(2026, 8, 5 - i * 7, 12)).toISOString().slice(0, 10) : '2026-09-02',
      friendIds: i % 2 ? ['f'] : [],
    }));
    const ins = insightsFor(rows);
    expect(ins.habits.weekendShare).toBeCloseTo(0.8, 5);
    expect(ins.habits.favoriteDay).toBe('Saturday');
    expect(ins.habits.socialShare).toBe(0.5);
    expect(ins.sentences.find((s) => s.id === 'weekend')?.headline).toBe('A weekend diner');
    const withVisits = buildTasteInsights(rows, buildTasteProfile(rows.map(asEngineRating), [], [], [], null), {
      now: NOW, extraVisits: { r0: 2, r1: 1, r2: 1, r3: 3 },
    });
    expect(withVisits.habits.repeatShare).toBeCloseTo(0.4, 5);
    expect(withVisits.sentences.find((s) => s.id === 'loyalty')?.headline).toBe('A regular — you go back');
  });

  it('adds Michelin stars up, and has no Michelin section when nothing matched', () => {
    const rows = Array.from({ length: 10 }, (_, i) => rating({ restaurantId: `r${i}`, score: 9 - i * 0.3 }));
    const profile = buildTasteProfile(rows.map(asEngineRating), [], [], [], null);
    const hits = new Map([
      ['r0', { stars: 3, bibGourmand: false }],
      ['r1', { stars: 3, bibGourmand: false }],
      ['r2', { stars: 1, bibGourmand: false }],
      ['r3', { stars: 0, bibGourmand: true }],
      ['r9', { stars: 0, bibGourmand: false }], // Selected
    ]);
    const ins = buildTasteInsights(rows, profile, { now: NOW, michelinById: hits });
    expect(ins.habits.michelin).toEqual({ count: 5, starCount: 3, totalStars: 7, bibCount: 1, share: 0.5 });
    const line = ins.sentences.find((s) => s.id === 'michelin');
    expect(line?.headline).toBe('5 of your top 10 are Michelin-recognized');
    expect(line?.detail).toBe('5 Guide restaurants rated, 3 of them starred — 7 stars in all.');

    const none = buildTasteInsights(rows, profile, { now: NOW, michelinById: new Map() });
    expect(none.habits.michelin).toBeNull();
    expect(none.sentences.some((s) => s.id === 'michelin')).toBe(false);
    expect(none.chips.some((c) => c.includes('Michelin'))).toBe(false);
  });

  it('names the palate and draws its petals from what you eat and love', () => {
    const rows: InsightRating[] = [
      ...[9.2, 9.4, 8.9].map((s, i) => rating({ restaurantId: `th${i}`, score: s, cuisine: 'Thai', price: '$$$$' })),
      ...[8.8, 8.5].map((s, i) => rating({ restaurantId: `kr${i}`, score: s, cuisine: 'Korean', price: '$$$$' })),
      ...[6, 6.5, 6.2, 7].map((s, i) => rating({ restaurantId: `it${i}`, score: s, cuisine: 'Italian', price: '$$$' })),
      rating({ restaurantId: 'fr0', score: 7.5, cuisine: 'French', price: '$$$$' }),
    ];
    const ins = insightsFor(rows);
    expect(ins.palate.archetype).toBe('The Fine-Dining Specialist');
    expect(ins.palate.tagline).toBe('Loves Thai, Korean and Italian, eats at the top of the menu.');
    expect(ins.palate.petals[0].name).toBe('Thai');
    expect(ins.palate.petals[0].affinity).toBeGreaterThan(ins.palate.petals[1].affinity);
    expect(ins.palate.petals.every((p) => p.affinity >= 0 && p.affinity <= 1)).toBe(true);
    // A devotee: one cuisine is 40%+ of the record and rated above the bar.
    const devotee = insightsFor([
      ...[8, 8.5, 9, 8.2, 8.8].map((s, i) => rating({ restaurantId: `jp${i}`, score: s, cuisine: 'Japanese', price: '$$' })),
      ...[7, 6.5].map((s, i) => rating({ restaurantId: `mx${i}`, score: s, cuisine: 'Mexican', price: '$$' })),
      rating({ restaurantId: 'th', score: 7, cuisine: 'Thai', price: '$' }),
    ]);
    expect(devotee.palate.archetype).toBe('The Value Japanese Devotee');
  });

  it('stays quiet on a thin account', () => {
    const ins = insightsFor([rating({ restaurantId: 'a', score: 8 }), rating({ restaurantId: 'b', score: 6 })]);
    expect(ins.n).toBe(2);
    expect(ins.sentences).toEqual([]);
    expect(ins.chips).toEqual([]);
    expect(ins.habits.weekendShare).toBeNull();
    expect(ins.trend.drift).toBeNull();
    expect(ins.palate.archetype).toBeNull();
    expect(ins.palate.petals).toEqual([]);
  });
});
