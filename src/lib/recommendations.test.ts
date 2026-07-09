import { describe, it, expect } from 'vitest';
import {
  buildTasteProfile,
  scoreCandidates,
  buildCandidateQueries,
  sliceQueriesBalanced,
  type TasteProfile,
  type CandidateSignals,
  type RecCandidate,
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

  it('emits reason chips for the strongest factors and a bounded predicted score', () => {
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
    expect(top.predicted).toBeGreaterThanOrEqual(5);
    expect(top.predicted).toBeLessThanOrEqual(9.8);
    // One decimal, always.
    expect(Math.round(top.predicted! * 10) / 10).toBe(top.predicted);
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

/* ── v3: price fidelity, distinctiveness, predicted score, queries ─────── */

// ~70-rating premium palate: 2×$, 5×$$, 25×$$$, 38×$$$$ across 8 cuisines,
// scores 7.0–9.4 (mean 8.2). Mirrors the real complaint profile.
const P70_CUISINES = ['French', 'Japanese', 'Korean', 'Italian', 'Spanish', 'Creative', 'Indian', 'Thai'];
const premium70 = (): TasteProfile => {
  const rs: Parameters<typeof buildTasteProfile>[0] = [];
  let i = 0;
  const add = (price: string, count: number) => {
    for (let k = 0; k < count; k++, i++) {
      rs.push(rating({
        restaurantId: `p70-${i}`,
        cuisine: P70_CUISINES[i % P70_CUISINES.length],
        price,
        score: 7 + (i % 5) * 0.6,
      }));
    }
  };
  add('$', 2);
  add('$$', 5);
  add('$$$', 25);
  add('$$$$', 38);
  return buildTasteProfile(rs, [], [], []);
};

const mich = (stars: 0 | 1 | 2 | 3, over: Partial<NonNullable<RecCandidate['michelin']>> = {}) =>
  ({ stars, bibGourmand: false, selected: false, ...over });

describe('v3 price fidelity', () => {
  it('REGRESSION: a popular cheap spot ranks well below a premium taste match', () => {
    const p = premium70();
    const out = scoreCandidates(
      [
        place({ id: 'cheap-trap', types: ['italian_restaurant'], priceLevel: 1, rating: 4.6, userRatingCount: 3000 }),
        place({ id: 'premium-match', types: ['french_restaurant'], priceLevel: 4, rating: 4.5, userRatingCount: 400 }),
      ],
      p,
      emptySignals(),
      TARGET,
      RADIUS,
    );
    const trap = out.find((x) => x.id === 'cheap-trap')!;
    const match = out.find((x) => x.id === 'premium-match')!;
    expect(out[0].id).toBe('premium-match');
    expect(match.recScore).toBeGreaterThan(trap.recScore + 1.5);
    expect(trap.predicted!).toBeLessThan(match.predicted!);
  });

  it('unknown price is a mild negative for a concentrated palate — not a free pass, not assumed-cheap', () => {
    const p = premium70();
    const base = { types: [] as string[], rating: 4.4, userRatingCount: 400 };
    const out = scoreCandidates(
      [
        place({ id: 'mystery', ...base, priceLevel: -1 }),
        place({ id: 'known-4', ...base, priceLevel: 4 }),
        place({ id: 'known-1', ...base, priceLevel: 1 }),
      ],
      p,
      emptySignals(),
      TARGET,
      RADIUS,
    );
    const score = (id: string) => out.find((x) => x.id === id)!.recScore;
    expect(score('known-4')).toBeGreaterThan(score('mystery'));
    expect(score('mystery')).toBeGreaterThan(score('known-1'));
  });
});

describe('v3 distinctiveness', () => {
  it('a Michelin star lifts candidates for a distinctive palate, with a chip and source', () => {
    const p = premium70();
    const base = { types: ['french_restaurant'], priceLevel: 4, rating: 4.5, userRatingCount: 900 };
    const starred: RecCandidate = { ...place({ id: 'starred', ...base }), michelin: mich(1) };
    const out = scoreCandidates([place({ id: 'plain', ...base }), starred], p, emptySignals(), TARGET, RADIUS);
    expect(out[0].id).toBe('starred');
    expect(out[0].reasons!.join(' | ')).toContain('Michelin 1-star');
    expect(out[0].sources).toContain('michelin');
  });

  it('Michelin-only candidates (no Google rating) get a quality substitute instead of sinking', () => {
    const p = premium70();
    const ghost: RecCandidate = {
      ...place({ id: 'michelin:40.73,-73.99,Ghost', name: 'Ghost', types: ['french_restaurant'], priceLevel: 4, rating: 0, userRatingCount: 0 }),
      michelin: mich(2),
    };
    const noSignal = place({ id: 'nosignal', types: ['french_restaurant'], priceLevel: 4, rating: 0, userRatingCount: 0 });
    const out = scoreCandidates([noSignal, ghost], p, emptySignals(), TARGET, RADIUS);
    expect(out[0].id).toBe('michelin:40.73,-73.99,Ghost');
    expect(out[0].recScore).toBeGreaterThan(out[1].recScore + 1);
  });

  it('drops Michelin synthetic duplicates of places already rated, by normalized name', () => {
    const p = buildTasteProfile(
      [rating({ restaurantId: 'g-1', name: 'Le Fantôme', cuisine: 'French', price: '$$$$', score: 9.5 })],
      [], [], [],
    );
    const synth: RecCandidate = {
      ...place({ id: 'michelin:40.73,-73.99,Le%20Fant%C3%B4me', name: 'Le Fantôme', types: ['french_restaurant'], priceLevel: 4, rating: 0, userRatingCount: 0 }),
      michelin: mich(1),
    };
    const out = scoreCandidates([synth], p, emptySignals(), TARGET, RADIUS, { keepWishlisted: true });
    expect(out.length).toBe(0);
  });

  it('crowd size matters less to a distinctive palate', () => {
    const premium = premium70();
    const massMarket = buildTasteProfile(
      Array.from({ length: 12 }, (_, i) => rating({ restaurantId: `m${i}`, cuisine: 'Italian', price: '$', score: 9 })),
      [], [], [],
    );
    const busy = place({ id: 'busy', types: [], priceLevel: 2, rating: 4.5, userRatingCount: 3000 });
    const quiet = place({ id: 'quiet', types: [], priceLevel: 2, rating: 4.5, userRatingCount: 50 });
    const delta = (profile: TasteProfile) => {
      const out = scoreCandidates([busy, quiet], profile, emptySignals(), TARGET, RADIUS);
      return out.find((x) => x.id === 'busy')!.recScore - out.find((x) => x.id === 'quiet')!.recScore;
    };
    expect(delta(premium)).toBeLessThan(delta(massMarket));
  });
});

describe('v3 predicted score', () => {
  it("speaks each grader's own scale", () => {
    const candidates = [place({ id: 'nice', types: ['italian_restaurant'], priceLevel: 2, rating: 4.5, userRatingCount: 500 })];
    const generous = buildTasteProfile(
      Array.from({ length: 12 }, (_, i) => rating({ restaurantId: `g${i}`, cuisine: 'Italian', price: '$$', score: 8.6 })),
      [], [], [],
    );
    const tough = buildTasteProfile(
      Array.from({ length: 12 }, (_, i) => rating({ restaurantId: `t${i}`, cuisine: 'Italian', price: '$$', score: 6.8 })),
      [], [], [],
    );
    const [gOut] = scoreCandidates(candidates, generous, emptySignals(), TARGET, RADIUS);
    const [tOut] = scoreCandidates(candidates, tough, emptySignals(), TARGET, RADIUS);
    expect(gOut.predicted!).toBeGreaterThan(tOut.predicted! + 0.8);
    // Never promises above the user's own realistic ceiling.
    expect(tOut.predicted!).toBeLessThanOrEqual(6.8 + 0.4);
  });

  it('spreads predictions instead of pinning everything at the top', () => {
    const p = premium70();
    const out = scoreCandidates(
      [
        place({ id: 'dream', types: ['french_restaurant'], priceLevel: 4, rating: 4.7, userRatingCount: 600 }),
        place({ id: 'meh', types: [], priceLevel: 1, rating: 4.0, userRatingCount: 80 }),
      ],
      p,
      emptySignals(),
      TARGET,
      RADIUS,
    );
    const dream = out.find((x) => x.id === 'dream')!.predicted!;
    const meh = out.find((x) => x.id === 'meh')!.predicted!;
    expect(dream - meh).toBeGreaterThan(1.2);
    expect(dream).toBeLessThanOrEqual(9.8);
    expect(meh).toBeGreaterThanOrEqual(5.0);
  });

  it("keeps rated rows at the user's own score (LocationPage path)", () => {
    const p = buildTasteProfile([rating({ restaurantId: 'mine', score: 6.3 })], [], [], []);
    const out = scoreCandidates([place({ id: 'mine' })], p, emptySignals(), TARGET, RADIUS, { skipUserHistory: false });
    expect(out[0].predicted).toBe(6.3);
  });
});

describe('v3 candidate queries', () => {
  it('premium palate: no cheap queries, tasting-menu/michelin added, tiers restricted', () => {
    const qs = buildCandidateQueries(premium70(), TARGET);
    const texts = qs.map((q) => q.text).join(' | ');
    expect(texts).not.toMatch(/cheap /);
    expect(texts).toMatch(/tasting menu/);
    expect(texts).toMatch(/michelin star restaurants/);
    expect(qs.some((q) => q.priceLevels && q.priceLevels.every((t) => t >= 3))).toBe(true);
  });

  it('a genuinely value-leaning palate keeps its cheap queries', () => {
    const p = buildTasteProfile(
      Array.from({ length: 10 }, (_, i) => rating({ restaurantId: `v${i}`, cuisine: 'Mexican', price: i % 2 ? '$' : '$$', score: 9 })),
      [], [], [],
    );
    const texts = buildCandidateQueries(p, TARGET).map((q) => q.text).join(' | ');
    expect(texts).toMatch(/cheap Mexican/);
  });

  it('sliceQueriesBalanced always keeps ≥2 unrestricted queries in the slice', () => {
    const restricted = Array.from({ length: 8 }, (_, i) => ({ text: `r${i}`, priceLevels: [4] }));
    const tail = [{ text: 'u1' }, { text: 'u2' }];
    const out = sliceQueriesBalanced([...restricted, ...tail], 8);
    expect(out.length).toBe(8);
    expect(out.filter((q) => !q.priceLevels).length).toBe(2);
  });
});

/* ── v3.1: hard price band, Michelin taste, in-app popularity ──────────── */

describe('v3.1 hard price band (rec surfaces)', () => {
  it('a $$$/$$$$ palate gets NO $ recs at all when enforced — and still soft-ranks them elsewhere', () => {
    const p = premium70(); // t1 share ≈ 3%, t2 ≈ 7% → only $ is out of band
    const candidates = [
      place({ id: 'dollar', types: [], priceLevel: 1, rating: 4.7, userRatingCount: 2000 }),
      place({ id: 'fancy', types: [], priceLevel: 4, rating: 4.4, userRatingCount: 300 }),
    ];
    const enforced = scoreCandidates(candidates, p, emptySignals(), TARGET, RADIUS, { enforcePriceBand: true });
    expect(enforced.map((x) => x.id)).not.toContain('dollar');
    expect(enforced.map((x) => x.id)).toContain('fancy');
    // Browse surfaces (LocationPage) keep listing everything.
    const browse = scoreCandidates(candidates, p, emptySignals(), TARGET, RADIUS, { enforcePriceBand: false });
    expect(browse.map((x) => x.id)).toContain('dollar');
  });

  it('vice versa: a strictly-$ palate gets no $$$$ recs', () => {
    const p = buildTasteProfile(
      Array.from({ length: 10 }, (_, i) => rating({ restaurantId: `c${i}`, cuisine: 'Mexican', price: '$', score: 9 })),
      [], [], [],
    );
    const out = scoreCandidates(
      [
        place({ id: 'splurge', types: [], priceLevel: 4, rating: 4.8, userRatingCount: 900 }),
        place({ id: 'value', types: [], priceLevel: 1, rating: 4.3, userRatingCount: 200 }),
      ],
      p,
      emptySignals(),
      TARGET,
      RADIUS,
      { enforcePriceBand: true },
    );
    expect(out.map((x) => x.id)).not.toContain('splurge');
    expect(out.map((x) => x.id)).toContain('value');
  });

  it('wishlisted places are exempt — explicit intent beats the band', () => {
    const ratings = Array.from({ length: 10 }, (_, i) => rating({ restaurantId: `c${i}`, price: '$$$$', score: 9 }));
    const wishlist = [wish({ restaurantId: 'cheap-wish', cuisine: 'Italian', price: '$' })];
    const p = buildTasteProfile(ratings, wishlist, [], []);
    const out = scoreCandidates(
      [place({ id: 'cheap-wish', types: [], priceLevel: 1 })],
      p,
      emptySignals(),
      TARGET,
      RADIUS,
      { enforcePriceBand: true, keepWishlisted: true },
    );
    expect(out.map((x) => x.id)).toContain('cheap-wish');
  });

  it('thin histories (<8 priced ratings) never hard-exclude', () => {
    const p = buildTasteProfile(
      Array.from({ length: 4 }, (_, i) => rating({ restaurantId: `c${i}`, price: '$$$$', score: 9 })),
      [], [], [],
    );
    const out = scoreCandidates(
      [place({ id: 'dollar', types: [], priceLevel: 1 })],
      p,
      emptySignals(),
      TARGET,
      RADIUS,
      { enforcePriceBand: true },
    );
    expect(out.map((x) => x.id)).toContain('dollar');
  });
});

describe('v3.1 Michelin taste match', () => {
  it('a demonstrated star-chaser gets starred candidates lifted beyond the generic boost', () => {
    const base = premium70();
    const starChaser: TasteProfile = { ...base, michelinTaste: { starShare: 0.4, bibShare: 0, selectedShare: 0 } };
    const cand = (id: string): RecCandidate => ({
      ...place({ id, types: ['french_restaurant'], priceLevel: 4, rating: 4.5, userRatingCount: 400 }),
      michelin: mich(1),
    });
    const [withTaste] = scoreCandidates([cand('a')], starChaser, emptySignals(), TARGET, RADIUS);
    const [withoutTaste] = scoreCandidates([cand('a')], base, emptySignals(), TARGET, RADIUS);
    expect(withTaste.recScore).toBeGreaterThan(withoutTaste.recScore + 0.5);
  });

  it('the boost tracks the matching distinction bucket, not all of them', () => {
    const base = premium70();
    const bibHunter: TasteProfile = { ...base, michelinTaste: { starShare: 0, bibShare: 0.3, selectedShare: 0 } };
    const starred: RecCandidate = { ...place({ id: 's', types: [], priceLevel: 3, rating: 4.5, userRatingCount: 400 }), michelin: mich(1) };
    const bib: RecCandidate = { ...place({ id: 'b', types: [], priceLevel: 3, rating: 4.5, userRatingCount: 400 }), michelin: mich(0, { bibGourmand: true }) };
    const out = scoreCandidates([starred, bib], bibHunter, emptySignals(), TARGET, RADIUS);
    // Bib candidate gains the taste boost; the starred one only keeps the
    // generic distinctiveness (higher weight) — net: bib closes the gap.
    const noTaste = scoreCandidates([starred, bib], base, emptySignals(), TARGET, RADIUS);
    const gapWith = out.find((x) => x.id === 's')!.recScore - out.find((x) => x.id === 'b')!.recScore;
    const gapWithout = noTaste.find((x) => x.id === 's')!.recScore - noTaste.find((x) => x.id === 'b')!.recScore;
    expect(gapWith).toBeLessThan(gapWithout);
  });
});

describe('v3.1 in-app popularity', () => {
  it('more community raters lift a place and chip it', () => {
    const p = premium70();
    const popular: RecCandidate = { ...place({ id: 'pop', types: [], priceLevel: 4, rating: 4.4, userRatingCount: 400 }), appRatingCount: 12 };
    const unknown: RecCandidate = { ...place({ id: 'unk', types: [], priceLevel: 4, rating: 4.4, userRatingCount: 400 }), appRatingCount: 0 };
    const out = scoreCandidates([popular, unknown], p, emptySignals(), TARGET, RADIUS);
    expect(out[0].id).toBe('pop');
    expect(out[0].reasons!.join(' | ')).toContain('Rated by 12 in the community');
  });

  it('is dormant when nobody has rated anything (today’s state)', () => {
    const p = premium70();
    const a: RecCandidate = { ...place({ id: 'a', types: [], priceLevel: 4 }), appRatingCount: 0 };
    const b = place({ id: 'b', types: [], priceLevel: 4 });
    const out = scoreCandidates([a, b], p, emptySignals(), TARGET, RADIUS);
    expect(Math.abs(out[0].recScore - out[1].recScore)).toBeLessThan(0.001);
  });
});
