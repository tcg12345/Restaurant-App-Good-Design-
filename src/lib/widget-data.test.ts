import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { buildWidgetSnapshot, widgetDestination } from './widget-data';
import type { TasteProfileState } from './useTasteProfile';
import type { CalendarPlan } from './calendar';
import type { RestaurantRating, WishlistItem } from '../contexts/ListsContext';

const now = Date.parse('2026-09-08T22:00:00Z');
const taste = { standing: { tier: { name: 'Explorer' }, next: { name: 'Connoisseur' }, progress: .5, toNext: 50 }, points: { total: 150 }, stats: { ratingCount: 12, cuisineCount: 4, cityCount: 2 }, insights: { palate: { archetype: 'A curious palate' } }, benchmarks: { benchmarks: { myRank: 23 } } } as TasteProfileState;
const meal = { id: 'meal-1', user_id: 'alice', kind: 'restaurant', title: 'Dinner', status: 'planned', starts_at: new Date(now + 3600000).toISOString(), ends_at: new Date(now + 7200000).toISOString(), details: { reservation: 'confirmed', notes: 'private notes', location: 'private address', confirmation: 'secret' } } as CalendarPlan;
const place = { restaurantId: 'p1', name: 'First place', cuisine: 'Italian', score: 8, addedAt: now, notes: 'private note' } as RestaurantRating & WishlistItem;
const input = { owner: 'alice', plans: [meal], ratings: [place], wishlist: [place], taste, messages: 2, requests: 1, now };

describe('widget snapshots', () => {
  it('shares only display fields, never notes, addresses, or confirmation codes', () => {
    const result = buildWidgetSnapshot(input);
    expect(JSON.stringify(result)).not.toMatch(/private|secret|location|confirmation|notes/);
    expect(result.meals[0]).toMatchObject({ title: 'Dinner', start: (now + 3600000) / 1000, confirmed: true });
    expect(result.taste.rank).toBe(23);
    // Read by the Swift contract checks: prove that the actual JS payload decodes natively.
    writeFileSync('/tmp/goodeats-widget-contract.json', JSON.stringify(result));
  });
  it('excludes other accounts, cancelled, completed, malformed, and ended plans', () => {
    const plans = [meal, { ...meal, user_id: 'bob' }, { ...meal, status: 'cancelled' }, { ...meal, status: 'completed' }, { ...meal, starts_at: 'bad' }, { ...meal, ends_at: new Date(now).toISOString() }] as CalendarPlan[];
    expect(buildWidgetSnapshot({ ...input, plans }).meals).toHaveLength(1);
  });
  it('keeps in-progress cooking plans and sorts upcoming meals with a bounded payload', () => {
    const plans = Array.from({ length: 40 }, (_, i) => ({ ...meal, id: String(i), starts_at: new Date(now + i * 60000).toISOString(), ends_at: new Date(now + 7200000 + i * 60000).toISOString() })).reverse();
    plans.push({ ...meal, id: 'cooking', kind: 'recipe', starts_at: new Date(now - 60000).toISOString() });
    const result = buildWidgetSnapshot({ ...input, plans });
    expect(result.meals).toHaveLength(24);
    expect(result.meals[0]).toMatchObject({ id: 'cooking', kind: 'recipe' });
  });
  it('ranks personal favorites without exposing locked numeric ratings', () => {
    const result = buildWidgetSnapshot({ ...input, ratings: [place, { ...place, restaurantId: 'best', score: 9 }] });
    expect(result.favorites.map(p => p.id)).toEqual(['best', 'p1']);
    expect(result.favorites[0]).not.toHaveProperty('score');
    expect(result.saved[0].path).toBe('/restaurant/p1');
  });
  it('handles empty accounts and invalid counts', () => {
    const result = buildWidgetSnapshot({ ...input, plans: [], ratings: [], wishlist: [], messages: NaN, requests: -1 });
    expect(result.social).toEqual({ messages: 0, requests: 0 });
    expect(result.meals).toEqual([]);
    expect(result.saved).toEqual([]);
  });
});
describe('widget links', () => {
  const link = (path: string) => `com.tylergorin.restaurantapp://widget?path=${encodeURIComponent(path)}`;
  it('opens only supported destinations, preserving the plan query', () => {
    for (const path of ['/calendar', '/calendar?plan=meal-1', '/restaurant/place-1', '/profile/taste', '/messages', '/pantry']) expect(widgetDestination(link(path))).toBe(path);
  });
  it('rejects external links, auth callbacks, and route traversal', () => {
    for (const url of ['https://evil.com/widget?path=/calendar', 'com.tylergorin.restaurantapp://auth?path=/calendar', link('//evil.com'), link('/settings/account'), link('/restaurant/%2e%2e'), link('/restaurant/p%2Fother'), link('/calendar?plan=1&delete=true')]) expect(widgetDestination(url)).toBeNull();
  });
});
