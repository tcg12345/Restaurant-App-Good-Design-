import { describe, expect, it } from 'vitest';
import { buildHomeHighlights, emptyHighlightHistory, highlightActivityAge, type HighlightSocial } from './home-highlights';
const now = new Date(2026, 8, 5, 12);
const daysAgo = (days: number) => now.getTime() - days * 86400000;
const base = { userId: 'alex', city: 'New York', now, ratings: [], wishlist: [], recipes: [] };
const social: HighlightSocial = {
  people: [{ id: 'maya', name: 'Maya', username: 'maya' }], experts: [],
  suggestions: [{ id: 'jordan', name: 'Jordan', username: 'jordan', reason: '2 mutual friends · explore their favorites.', relevance: 6 }],
  places: [{ restaurantId: 'lilia', name: 'Lilia', cuisine: 'Italian', score: 9, createdAt: daysAgo(1), authorId: 'maya', authorName: 'Maya', expert: false }, { restaurantId: 'estela', name: 'Estela', score: 9.2, createdAt: daysAgo(2), authorId: 'chef', authorName: 'Sam', expert: true }],
  recipes: [{ id: 'maya:pasta', title: 'Pasta night', cuisine: 'Italian', href: '/recipe/maya/pasta', authorId: 'maya', createdAt: daysAgo(1), authorName: 'Maya', expert: false }],
};
const rich = { ...base, social,
  ratings: ['a', 'b', 'c'].map(restaurantId => ({ restaurantId, name: restaurantId, score: 9, cuisine: 'Italian', createdAt: daysAgo(300) })),
  wishlist: [{ restaurantId: 'old-save', name: 'Old saved place', addedAt: daysAgo(500) }],
  recipes: [{ id: 'old-meal', title: 'My old salmon', href: '/recipe/alex/old-meal', createdAt: daysAgo(500) }],
};
describe('timely home highlights', () => {
  it('puts fresh friends, real suggestions and fresh recipes ahead of general prompts', () => {
    const cards = buildHomeHighlights(rich);
    expect(cards.find(c => c.id === 'social-maya-lilia')).toMatchObject({ href: '/restaurant/lilia', detail: 'Maya rated it 9.0 · yesterday' });
    expect(cards.find(c => c.id === 'person-jordan')).toMatchObject({ href: '/user/jordan', detail: '2 mutual friends · explore their favorites.' });
    expect(cards.find(c => c.id === 'social-recipe-maya:pasta')).toMatchObject({ href: '/recipe/maya/pasta' });
    expect(cards.slice(0, 4).every(c => c.id.startsWith('social-') || c.id.startsWith('person-'))).toBe(true);
  });
  it('never fills the carousel with own historical ratings, saved places or recipes', () => {
    for (let session = 0; session < 50; session++) {
      expect(buildHomeHighlights({ ...rich, session }).some(c => /^(favorite-|saved-|recipe-old)/.test(c.id))).toBe(false);
    }
  });
  it('rejects stale, undated, invalid, future and imported old activity', () => {
    for (const createdAt of [undefined, NaN, daysAgo(15), daysAgo(-1)]) {
      const cards = buildHomeHighlights({ ...base, social: { ...social, places: social.places.map(p => ({ ...p, createdAt })), recipes: social.recipes.map(r => ({ ...r, createdAt })) } });
      expect(cards.some(c => c.id.startsWith('social-'))).toBe(false);
    }
    expect(highlightActivityAge(daysAgo(0), new Date(daysAgo(100)).toISOString(), now)).toBe(100);
    expect(highlightActivityAge(daysAgo(0), 'not a date', now)).toBe(Infinity);
    expect(highlightActivityAge(daysAgo(0), new Date(daysAgo(-1)).toISOString(), now)).toBe(Infinity);
    const imported = buildHomeHighlights({ ...base, social: { ...social, places: social.places.map(p => ({ ...p, createdAt: daysAgo(0), visitDate: new Date(daysAgo(100)).toISOString() })) } });
    expect(imported.some(c => c.href?.startsWith('/restaurant/'))).toBe(false);
  });
  it('limits recipe activity to seven days and rating activity to fourteen', () => {
    const cards = buildHomeHighlights({ ...base, social: { ...social, places: social.places.map(p => ({ ...p, createdAt: daysAgo(14) })), recipes: social.recipes.map(p => ({ ...p, createdAt: daysAgo(8) })) } });
    expect(cards.some(c => c.id === 'social-maya-lilia')).toBe(true);
    expect(cards.some(c => c.id.startsWith('social-recipe'))).toBe(false);
  });
  it('excludes own content even if a social response accidentally includes it', () => {
    const cards = buildHomeHighlights({ ...base, social: { ...social, places: social.places.map(p => ({ ...p, authorId: 'alex' })), recipes: social.recipes.map(p => ({ ...p, authorId: 'alex' })), suggestions: [{ id: 'alex', name: 'Alex', username: 'alex' }] } });
    expect(cards.some(c => c.id.startsWith('social-') || c.id.startsWith('person-'))).toBe(false);
  });
  it('counts distinct recent friends for consensus and does not repeat the restaurant', () => {
    const place = social.places[0];
    const cards = buildHomeHighlights({ ...rich, social: { ...social, places: [place, place, { ...place, authorId: 'sam', authorName: 'Sam' }] } });
    expect(cards.find(c => c.id === 'circle-favorite-lilia')?.detail).toBe('2 friends rated it 8+ in the last two weeks.');
    expect(cards.filter(c => c.href === '/restaurant/lilia')).toHaveLength(1);
    expect(buildHomeHighlights({ ...rich, social: { ...social, places: [place, place] } }).some(c => c.id.startsWith('circle-favorite'))).toBe(false);
  });
  it('excludes already followed people, already visited places and low or invalid scores', () => {
    const cards = buildHomeHighlights({ ...base, ratings: [{ restaurantId: 'lilia', name: 'Lilia' }], social: { ...social, suggestions: [{ ...social.people[0] }, { id: 'x', name: 'X', username: 'x', followed: true }], places: [...social.places.filter(p => !p.expert), ...[7, NaN, 11].map(score => ({ ...social.places[1], score }))] } });
    expect(cards.some(c => c.id.startsWith('person-') || c.href?.startsWith('/restaurant/'))).toBe(false);
  });
  it('uses cuisine affinity to choose between equally recent friends’ picks', () => {
    const p = social.places[0];
    const cards = buildHomeHighlights({ ...rich, social: { ...social, suggestions: [], places: [{ ...p, restaurantId: 'thai', cuisine: 'Thai' }, { ...p, restaurantId: 'italian', cuisine: 'Italian' }] } });
    expect(cards.find(c => c.category === 'friend-pick')?.href).toBe('/restaurant/italian');
  });
  it('keeps the deck stable across input ordering with six diverse cards', () => {
    const cards = buildHomeHighlights(rich);
    expect(cards).toEqual(buildHomeHighlights({ ...rich, social: { ...social, places: [...social.places].reverse() }, ratings: [...rich.ratings].reverse() }));
    expect(cards).toHaveLength(6);
    expect(new Set(cards.map(c => c.category)).size).toBe(6);
    for (const family of new Set(cards.map(c => c.family))) expect(cards.filter(c => c.family === family).length).toBeLessThanOrEqual(2);
  });
  it('uses exposure history to reduce repeats without allowing stale content back in', () => {
    const first = buildHomeHighlights(rich), history = emptyHighlightHistory();
    for (const card of first) { history.seen[card.id] = now.getTime(); history.clicked[card.id] = now.getTime(); }
    const next = buildHomeHighlights({ ...rich, history });
    expect(next.filter(c => first.some(p => p.id === c.id)).length).toBeLessThan(first.length);
    expect(next.some(c => c.id.startsWith('favorite-') || c.id.startsWith('saved-'))).toBe(false);
  });
  it('adapts prompts to daypart and actual pending activity', () => {
    expect(buildHomeHighlights({ ...base, userId: undefined }).find(c => c.id === 'discover')?.title).toBe('A new spot for brunch.');
    const cards = buildHomeHighlights({ ...base, now: new Date(2026, 8, 7, 19), pendingRequestCount: 2, unreadCount: 1 });
    expect(cards.find(c => c.id === 'requests')).toMatchObject({ title: '2 people want to follow you.', href: '/circle' });
    expect(cards.find(c => c.id === 'messages')?.href).toBe('/messages');
    expect(cards.find(c => c.id === 'discover')?.title).toBe('A new spot for dinner.');
    expect(buildHomeHighlights(base).some(c => c.id === 'requests' || c.id === 'messages')).toBe(false);
  });
  it('offers honest usable fallbacks when social loading is empty, including guests', () => {
    const cards = buildHomeHighlights(base);
    expect(cards.length).toBeGreaterThanOrEqual(4);
    expect(cards.every(c => c.action || c.href)).toBe(true);
    expect(cards.some(c => c.id === 'first-ratings')).toBe(true);
    const guest = buildHomeHighlights({ ...rich, userId: undefined, pendingRequestCount: 2, unreadCount: 3 });
    expect(guest.some(c => /Maya|Jordan|Sam|salmon|Lilia|Estela/.test(c.title + c.detail))).toBe(false);
    expect(guest.every(c => !c.href || c.href === '/recipes-for-you')).toBe(true);
  });
});

describe('device-local highlight memory', () => {
  it('isolates account history and tolerates corrupted storage', async () => {
    const { vi } = await import('vitest');
    const { readHighlightHistory, recordHighlight } = await import('./home-highlights');
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) || null, setItem: (k: string, v: string) => storage.set(k, v) });
    try {
      const card = buildHomeHighlights(rich)[0];
      recordHighlight('alex', card, 'clicked', now.getTime());
      expect(readHighlightHistory('alex').clicked[card.id]).toBe(now.getTime());
      expect(readHighlightHistory('maya')).toEqual(emptyHighlightHistory());
      expect(readHighlightHistory()).toEqual(emptyHighlightHistory());
      recordHighlight(undefined, card, 'seen');
      expect(storage.size).toBe(1);
      storage.set('goodeats:home-highlights:v2:alex', '{broken');
      expect(readHighlightHistory('alex')).toEqual(emptyHighlightHistory());
    } finally { vi.unstubAllGlobals(); }
  });
});
