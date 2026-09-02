import { describe, it, expect } from 'vitest';
import {
  tastePoints, tierFor, statsFromRatings, cuisineTokens, cityToken, monthKey, TIERS,
} from './taste-tier';

describe('tastePoints', () => {
  // Hand-checked. The same case is pinned in migration 083's comment — if
  // this number changes, the SQL must change with it.
  it('matches the reference arithmetic', () => {
    const { total, components } = tastePoints({
      ratingCount: 10, cuisineCount: 4, cityCount: 1, noteCount: 2,
      photoCount: 3, tagCount: 5, scoreSpread: 1.2, monthCount: 2,
    });
    // depth 10·ln(11)=23.98, breadth 12, range 4, discernment 24,
    // voice 2, eye 4·√3=6.93, detail 5, tenure 6 → 83.91
    expect(total).toBe(84);
    const by = Object.fromEntries(components.map((c) => [c.key, c.points]));
    expect(by.depth).toBeCloseTo(23.979, 2);
    expect(by.breadth).toBe(12);
    expect(by.range).toBe(4);
    expect(by.discernment).toBeCloseTo(24, 6);
    expect(by.voice).toBe(2);
    expect(by.eye).toBeCloseTo(6.928, 2);
    expect(by.detail).toBe(5);
    expect(by.tenure).toBe(6);
  });

  it('has no ceiling — every component keeps growing', () => {
    const base = { ratingCount: 100, cuisineCount: 30, cityCount: 20, noteCount: 80, photoCount: 400, tagCount: 40, scoreSpread: 2.5, monthCount: 24 };
    const a = tastePoints(base);
    const b = tastePoints({
      ratingCount: 200, cuisineCount: 31, cityCount: 21, noteCount: 81, photoCount: 401, tagCount: 41, scoreSpread: 2.6, monthCount: 25,
    });
    for (const [i, c] of a.components.entries()) expect(b.components[i].points).toBeGreaterThan(c.points);
    expect(b.total).toBeGreaterThan(a.total);
    expect(tierFor(b.total).tier.key).toBe('critic'); // 559 pts: past Critic (400), short of Legend (650)
    // Photos grow on a root curve: 4× the photos is 2× the points.
    const eye = (photos: number) => tastePoints({ ...base, photoCount: photos }).components.find((c) => c.key === 'eye')!.points;
    expect(eye(400) / eye(100)).toBeCloseTo(2, 6);
  });

  it('is zero for an empty account', () => {
    expect(tastePoints({
      ratingCount: 0, cuisineCount: 0, cityCount: 0, noteCount: 0,
      photoCount: 0, tagCount: 0, scoreSpread: 0, monthCount: 0,
    }).total).toBe(0);
  });
});

describe('tierFor', () => {
  it('walks the ladder and reports progress to the next floor', () => {
    expect(tierFor(0).tier.key).toBe('newcomer');
    expect(tierFor(59).tier.key).toBe('newcomer');
    expect(tierFor(60).tier.key).toBe('regular');
    const mid = tierFor(105);
    expect(mid.tier.key).toBe('regular');
    expect(mid.next?.key).toBe('explorer');
    expect(mid.progress).toBeCloseTo(0.5, 5);
    expect(mid.toNext).toBe(45);
  });
  it('tops out at Legend with no next tier', () => {
    const top = tierFor(5000);
    expect(top.tier.key).toBe('legend');
    expect(top.next).toBeNull();
    expect(top.progress).toBe(1);
    expect(top.toNext).toBe(0);
  });
  it('tiers are ascending and start at zero', () => {
    expect(TIERS[0].min).toBe(0);
    for (let i = 1; i < TIERS.length; i++) expect(TIERS[i].min).toBeGreaterThan(TIERS[i - 1].min);
  });
});

describe('statsFromRatings', () => {
  it('splits compound cuisines, parses cities like the top lists do, and counts months in UTC', () => {
    const stats = statsFromRatings([
      { score: 8, cuisine: 'Korean, Contemporary', address: '1 Main St, Boston, MA', notes: 'great', tags: ['Cozy Atmosphere'], photos: [1, 2], createdAt: Date.UTC(2026, 0, 15) },
      { score: 6, cuisine: 'korean', address: '2 Rue X, Paris', notes: ' ', tags: ['cozy atmosphere', 'Romantic'], createdAt: Date.UTC(2026, 0, 30) },
      { score: 9, cuisine: 'Thai / Lao', address: '3 High St, Boston, MA 02116', createdAt: Date.UTC(2026, 1, 2) },
    ]);
    expect(stats.ratingCount).toBe(3);
    expect(stats.cuisineCount).toBe(4); // korean, contemporary, thai, lao
    expect(stats.cityCount).toBe(2);    // boston, paris
    expect(stats.noteCount).toBe(1);    // whitespace-only notes don't count
    expect(stats.photoCount).toBe(2);
    expect(stats.tagCount).toBe(2);     // case-insensitive distinct
    expect(stats.monthCount).toBe(2);
    expect(stats.scoreSpread).toBeCloseTo(1.247, 2);
  });

  it('helpers', () => {
    expect(cuisineTokens('Japanese & Sushi')).toEqual(['japanese', 'sushi']);
    expect(cuisineTokens('Restaurant')).toEqual([]);
    expect(cuisineTokens('Italian, Food, Establishment')).toEqual(['italian']);
    expect(cityToken('181 Thompson St, New York, NY 10012')).toBe('new york');
    expect(cityToken('150 Main St, Westport, CT 06880, USA')).toBe('westport');
    expect(cityToken('Wildersgade 10B, 1408 København, Denmark')).toBe('københavn');
    expect(cityToken('8 Quai du Louvre, Paris')).toBe('paris');
    expect(cityToken('')).toBeNull();
    expect(monthKey(Date.UTC(2026, 11, 31, 23))).toBe('2026-12');
    expect(monthKey(0)).toBeNull();
  });
});
