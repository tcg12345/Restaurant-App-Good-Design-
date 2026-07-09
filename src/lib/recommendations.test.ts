import { describe, it, expect } from 'vitest';
import {
  buildTasteProfile,
  scoreCandidates,
  type TasteProfile,
  type CandidateSignals,
} from './recommendations';
import type { PlaceResult } from './places';
import type { RestaurantRating, WishlistItem } from '../contexts/ListsContext';
import type { CommunityRating } from './supabase-community';

/* ── Fixtures ──────────────────────────────────────────────────────────── */

const DAY = 86_400_000;

const rating = (over: Partial<RestaurantRating> & { restaurantId: string }): RestaurantRating => ({
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
  createdAt: Date.now() - 7 * DAY,
  ...over,
});

const wish = (over: Partial<WishlistItem> & { restaurantId: string }): WishlistItem => ({
  name: over.restaurantId,
  image: '',
  cuisine: '',
  price: '',
  address: '',
  addedAt: Date.now(),
  ...over,
} as WishlistItem);

const place = (over: Partial<PlaceResult> & { id: string }): PlaceResult => ({
  name: over.id,
  lat: 40.73,
  lng: -73.99,
  rating: 4.4,
  priceLevel: 2,
  address: '2 Main St, New York',
  fullAddress: '2 Main St, New York, NY 10001, USA',
  photoUrl: null,
  types: ['italian_restaurant'],
  userRatingCount: 400,
  ...over,
});

const TARGET = { label: 'New York, NY', lat: 40.73, lng: -73.99 };
const RADIUS = 12_875; // 8 mi

const emptySignals = (): CandidateSignals => ({
  expertUserIds: new Set(),
  followedExpertIds: new Set(),
  friendUserIds: new Set(),
  communityByRestaurant: new Map(),
  expertRecRestaurantIds: new Set(),
});

const communityRow = (over: Partial<CommunityRating> & { user_id: string; restaurant_id: string }): CommunityRating => ({
  id: `${over.user_id}-${over.restaurant_id}`,
  restaurant_name: over.restaurant_id,
  score: 9,
  notes: '',
  cuisine: 'Italian',
  price: '$$',
  address: '2 Main St, New York, NY 10001, USA',
  visit_date: '2026-06-01',
  tags: [],
  would_return: true,
  friend_ids: [],
  lat: 40.73,
  lng: -73.99,
  photo_url: '',
  created_at: '2026-06-01T00:00:00Z',
  ...over,
});

const profileFrom = (ratings: RestaurantRating[], wishlist: WishlistItem[] = []): TasteProfile =>
  buildTasteProfile(ratings, wishlist, [], []);

/* ── buildTasteProfile ─────────────────────────────────────────────────── */

describe('buildTasteProfile', () => {
  it('weights recent ratings above stale ones (18-month half-life)', () => {
    const recent = profileFrom([rating({ restaurantId: 'a', cuisine: 'Thai', score: 9, createdAt: Date.now() - 10 * DAY })]);
    const stale = profileFrom([rating({ restaurantId: 'a', cuisine: 'Thai', score: 9, createdAt: Date.now() - 3 * 365 * DAY })]);
    expect(recent.cuisineScore['Thai']).toBeGreaterThan(stale.cuisineScore['Thai']);
    // Floor: even ancient loves keep at least 35% of their weight.
    expect(stale.cuisineScore['Thai']).toBeGreaterThan(recent.cuisineScore['Thai'] * 0.34);
  });

  it('wouldReturn amplifies praise; "high score but never again" is dampened', () => {
    const returner = profileFrom([rating({ restaurantId: 'a', cuisine: 'Thai', score: 9, wouldReturn: true })]);
    const oneOff = profileFrom([rating({ restaurantId: 'a', cuisine: 'Thai', score: 9, wouldReturn: false })]);
    expect(returner.cuisineScore['Thai']).toBeGreaterThan(oneOff.cuisineScore['Thai']);
  });

  it('low scores with no intent to return go negative', () => {
    const p = profileFrom([
      rating({ restaurantId: 'good', cuisine: 'Thai', score: 9 }),
      rating({ restaurantId: 'bad', cuisine: 'Steakhouse', score: 3, wouldReturn: false }),
    ]);
    expect(p.cuisineScore['Steakhouse']).toBeLessThan(0);
  });

  it('centers on the user’s own bar: a tough grader’s 7.5 still reads as praise', () => {
    const tough = profileFrom([
      ...[1, 2, 3, 4].map((i) => rating({ restaurantId: `t${i}`, cuisine: 'Diner', score: 5, wouldReturn: false })),
      rating({ restaurantId: 'fav', cuisine: 'Omakase', score: 7.5 }),
    ]);
    expect(tough.cuisineScore['Omakase']).toBeGreaterThan(0);
  });

  it('counts wishlist cuisine interest even when the price is unknown', () => {
    const p = profileFrom([], [wish({ restaurantId: 'w1', cuisine: 'Ramen', price: '' })]);
    expect(p.cuisineScore['Ramen']).toBeGreaterThan(0);
  });

  it('splits compound cuisine labels so they match single-label candidates', () => {
    const p = profileFrom([rating({ restaurantId: 'a', cuisine: 'Korean, Contemporary', score: 9.5 })]);
    expect(p.cuisineScore['Korean']).toBeGreaterThan(0);
    expect(p.cuisineScore['Contemporary']).toBeGreaterThan(0);
    expect(p.cuisineScore['Korean, Contemporary']).toBeUndefined();
  });

  it('exposes avgScore and per-restaurant scores for similarity', () => {
    const p = profileFrom([
      rating({ restaurantId: 'a', score: 8 }),
      rating({ restaurantId: 'b', score: 6 }),
    ]);
    expect(p.avgScore).toBe(7);
    expect(p.myScoreById.get('a')).toBe(8);
    expect(p.myScoreById.get('b')).toBe(6);
  });
});

/* ── scoreCandidates ───────────────────────────────────────────────────── */

// A profile that loves $$ Italian (enough ratings to fully exit cold start).
const italianLover = () =>
  profileFrom([
    rating({ restaurantId: 'r1', cuisine: 'Italian', price: '$$', score: 9.5 }),
    rating({ restaurantId: 'r2', cuisine: 'Italian', price: '$$', score: 9 }),
    rating({ restaurantId: 'r3', cuisine: 'Italian', price: '$$', score: 8.5 }),
    rating({ restaurantId: 'r4', cuisine: 'Japanese', price: '$$$', score: 8 }),
  ]);

describe('scoreCandidates', () => {
  it('affinities are normalized: a 50-rating power user and a 4-rating user agree on direction', () => {
    const power = profileFrom(
      Array.from({ length: 50 }, (_, i) => rating({ restaurantId: `p${i}`, cuisine: 'Italian', price: '$$', score: 9 })),
    );
    const casual = italianLover();
    const candidates = [
      place({ id: 'match', types: ['italian_restaurant'], priceLevel: 2 }),
      place({ id: 'off', types: ['bar_and_grill'], priceLevel: 2 }),
    ];
    for (const profile of [power, casual]) {
      const out = scoreCandidates(candidates, profile, emptySignals(), TARGET, RADIUS);
      expect(out[0].id).toBe('match');
      // Bounded: the taste gap can't blow past the weighted max no matter
      // how many ratings back it.
      expect(out[0].recScore - out[1].recScore).toBeLessThan(6);
    }
  });

  it('Bayesian quality: 4.6★ × 1000 reviews outranks 5.0★ × 3 reviews', () => {
    const p = profileFrom([]); // cold start → quality/popularity only
    const out = scoreCandidates(
      [
        place({ id: 'proven', rating: 4.6, userRatingCount: 1000, types: [] }),
        place({ id: 'tiny', rating: 5.0, userRatingCount: 3, types: [] }),
      ],
      p,
      emptySignals(),
      TARGET,
      RADIUS,
    );
    expect(out[0].id).toBe('proven');
  });

  it('a like-minded friend’s rave lifts more than a taste-opposite friend’s', () => {
    // I rated shared-1/2/3; twin agreed on all three, contrarian was 4+ off.
    const mine = [
      rating({ restaurantId: 'shared-1', score: 9 }),
      rating({ restaurantId: 'shared-2', score: 4, wouldReturn: false }),
      rating({ restaurantId: 'shared-3', score: 8 }),
      rating({ restaurantId: 'r1', cuisine: 'Italian', price: '$$', score: 9 }),
      rating({ restaurantId: 'r2', cuisine: 'Italian', price: '$$', score: 9 }),
      rating({ restaurantId: 'r3', cuisine: 'Italian', price: '$$', score: 8.5 }),
    ];
    const profile = profileFrom(mine);
    const signals = emptySignals();
    signals.friendUserIds = new Set(['twin', 'contrarian']);
    const rows: CommunityRating[] = [
      communityRow({ user_id: 'twin', restaurant_id: 'shared-1', score: 9 }),
      communityRow({ user_id: 'twin', restaurant_id: 'shared-2', score: 4 }),
      communityRow({ user_id: 'twin', restaurant_id: 'shared-3', score: 8 }),
      communityRow({ user_id: 'contrarian', restaurant_id: 'shared-1', score: 3 }),
      communityRow({ user_id: 'contrarian', restaurant_id: 'shared-2', score: 9 }),
      communityRow({ user_id: 'contrarian', restaurant_id: 'shared-3', score: 3 }),
      communityRow({ user_id: 'twin', restaurant_id: 'candidate-twin', score: 10 }),
      communityRow({ user_id: 'contrarian', restaurant_id: 'candidate-contrarian', score: 10 }),
    ];
    for (const row of rows) {
      const arr = signals.communityByRestaurant.get(row.restaurant_id) || [];
      arr.push(row);
      signals.communityByRestaurant.set(row.restaurant_id, arr);
    }
    const out = scoreCandidates(
      [
        place({ id: 'candidate-twin', types: [], rating: 4.2, userRatingCount: 200 }),
        place({ id: 'candidate-contrarian', types: [], rating: 4.2, userRatingCount: 200 }),
      ],
      profile,
      signals,
      TARGET,
      RADIUS,
    );
    const twinPick = out.find((p) => p.id === 'candidate-twin')!;
    const contrarianPick = out.find((p) => p.id === 'candidate-contrarian')!;
    expect(twinPick.recScore).toBeGreaterThan(contrarianPick.recScore);
  });

  it('a friend panning a place pushes it below an identical place with no signal', () => {
    const profile = italianLover();
    const signals = emptySignals();
    signals.friendUserIds = new Set(['f1']);
    signals.communityByRestaurant.set('panned', [
      communityRow({ user_id: 'f1', restaurant_id: 'panned', score: 3 }),
    ]);
    const out = scoreCandidates(
      [place({ id: 'panned' }), place({ id: 'neutral' })],
      profile,
      signals,
      TARGET,
      RADIUS,
    );
    expect(out.find((p) => p.id === 'neutral')!.recScore).toBeGreaterThan(
      out.find((p) => p.id === 'panned')!.recScore,
    );
  });

  it('penalizes prices far from everything the user favors', () => {
    const p = profileFrom([
      rating({ restaurantId: 'r1', cuisine: 'Creative', price: '$$$$', score: 9.5 }),
      rating({ restaurantId: 'r2', cuisine: 'Creative', price: '$$$$', score: 9 }),
      rating({ restaurantId: 'r3', cuisine: 'Creative', price: '$$$$', score: 9 }),
    ]);
    const out = scoreCandidates(
      [
        place({ id: 'splurge', types: [], priceLevel: 4 }),
        place({ id: 'dive', types: [], priceLevel: 1 }),
      ],
      p,
      emptySignals(),
      TARGET,
      RADIUS,
    );
    expect(out.find((x) => x.id === 'splurge')!.recScore).toBeGreaterThan(
      out.find((x) => x.id === 'dive')!.recScore,
    );
  });

  it('diversifies the top of the list instead of stacking one cuisine', () => {
    // Two cuisines the user loves equally — without the diversity pass the
    // slightly-higher-starred Italians would sweep ranks 1-4 and the equally
    // matched Japanese spot would sit dead last.
    const p = profileFrom([
      rating({ restaurantId: 'r1', cuisine: 'Italian', price: '$$', score: 9 }),
      rating({ restaurantId: 'r2', cuisine: 'Italian', price: '$$', score: 9 }),
      rating({ restaurantId: 'r3', cuisine: 'Japanese', price: '$$', score: 9 }),
      rating({ restaurantId: 'r4', cuisine: 'Japanese', price: '$$', score: 9 }),
    ]);
    const out = scoreCandidates(
      [
        place({ id: 'i1', rating: 4.8, userRatingCount: 900 }),
        place({ id: 'i2', rating: 4.7, userRatingCount: 900 }),
        place({ id: 'i3', rating: 4.6, userRatingCount: 900 }),
        place({ id: 'i4', rating: 4.5, userRatingCount: 900 }),
        place({ id: 'jp', types: ['japanese_restaurant'], rating: 4.5, userRatingCount: 900 }),
      ],
      p,
      emptySignals(),
      TARGET,
      RADIUS,
    );
    const jpRank = out.findIndex((x) => x.id === 'jp');
    expect(jpRank).toBeGreaterThan(-1);
    expect(jpRank).toBeLessThanOrEqual(2); // interleaved near the top, not dead last
  });

  it('emits reason chips for the strongest factors and a bounded match %', () => {
    const profile = italianLover();
    const signals = emptySignals();
    signals.friendUserIds = new Set(['f1', 'f2']);
    signals.communityByRestaurant.set('hit', [
      communityRow({ user_id: 'f1', restaurant_id: 'hit', score: 9 }),
      communityRow({ user_id: 'f2', restaurant_id: 'hit', score: 8.5 }),
    ]);
    const [top] = scoreCandidates(
      [place({ id: 'hit', rating: 4.7, userRatingCount: 1200 })],
      profile,
      signals,
      TARGET,
      RADIUS,
    );
    expect(top.reasons!.length).toBeGreaterThan(0);
    expect(top.reasons!.length).toBeLessThanOrEqual(3);
    expect(top.reasons!.join(' | ')).toMatch(/Top cuisine: Italian|sweet spot|Loved by 2 friends/);
    expect(top.match).toBeGreaterThanOrEqual(5);
    expect(top.match).toBeLessThanOrEqual(99);
  });

  it('always hides rated places; keepWishlisted surfaces wishlisted ones with a chip', () => {
    const ratings = [rating({ restaurantId: 'been-there', score: 9 })];
    const wishlist = [wish({ restaurantId: 'want-to-go', cuisine: 'Italian', price: '$$' })];
    const profile = buildTasteProfile(ratings, wishlist, [], []);
    const candidates = [place({ id: 'been-there' }), place({ id: 'want-to-go' }), place({ id: 'fresh' })];

    const hidden = scoreCandidates(candidates, profile, emptySignals(), TARGET, RADIUS);
    expect(hidden.map((p) => p.id)).not.toContain('been-there');
    expect(hidden.map((p) => p.id)).not.toContain('want-to-go');

    const kept = scoreCandidates(candidates, profile, emptySignals(), TARGET, RADIUS, {
      keepWishlisted: true,
    });
    expect(kept.map((p) => p.id)).not.toContain('been-there');
    const wanted = kept.find((p) => p.id === 'want-to-go')!;
    expect(wanted.reasons).toContain('On your wishlist');
  });
});
