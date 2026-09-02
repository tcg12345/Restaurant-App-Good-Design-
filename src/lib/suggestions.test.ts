import { describe, it, expect } from 'vitest';
import {
  rankSuggestedProfiles, suggestionSubtitle, tasteMatchScore, tasteMatchReason,
  suggestionScore, suggestionReasonKind, diversifySuggestions,
  type RankableProfile, type TasteSignal,
} from './suggestions';

function person(id: string, over: Partial<RankableProfile> = {}): RankableProfile {
  return { user_id: id, is_verified: false, ratingCount: 0, followerCount: 0, ...over };
}

describe('rankSuggestedProfiles', () => {
  it('does NOT require verification — the bug this replaced showed nobody', () => {
    // The rail this ordering replaced sourced from verified accounts only.
    // A young platform has none, so it rendered empty for every user, every
    // visit. Unverified people must still be suggestable.
    const out = rankSuggestedProfiles(
      [person('a', { ratingCount: 12 }), person('b', { ratingCount: 3 })],
      10,
    );
    expect(out.map((p) => p.user_id)).toEqual(['a', 'b']);
  });

  it('puts verified accounts first even when they have published less', () => {
    const out = rankSuggestedProfiles(
      [person('prolific', { ratingCount: 90 }), person('vip', { is_verified: true, ratingCount: 2 })],
      10,
    );
    expect(out[0].user_id).toBe('vip');
  });

  it('ranks by published ratings — following someone with none is a blank page', () => {
    const out = rankSuggestedProfiles(
      [person('quiet'), person('loud', { ratingCount: 40 }), person('some', { ratingCount: 7 })],
      10,
    );
    expect(out.map((p) => p.user_id)).toEqual(['loud', 'some', 'quiet']);
  });

  it('breaks rating ties on followers', () => {
    const out = rankSuggestedProfiles(
      [person('x', { ratingCount: 5, followerCount: 1 }), person('y', { ratingCount: 5, followerCount: 30 })],
      10,
    );
    expect(out.map((p) => p.user_id)).toEqual(['y', 'x']);
  });

  it('is stable for identical people, so the rail does not reshuffle on reload', () => {
    const a = [person('zed'), person('amy'), person('mo')];
    const first = rankSuggestedProfiles(a, 10).map((p) => p.user_id);
    const second = rankSuggestedProfiles([...a].reverse(), 10).map((p) => p.user_id);
    expect(first).toEqual(second);
    expect(first).toEqual(['amy', 'mo', 'zed']);
  });

  it('does not mutate the caller’s array', () => {
    const input = [person('b', { ratingCount: 1 }), person('a', { ratingCount: 9 })];
    rankSuggestedProfiles(input, 10);
    expect(input.map((p) => p.user_id)).toEqual(['b', 'a']);
  });

  it('honours the limit, and treats a nonsense limit as empty rather than throwing', () => {
    const people = [person('a'), person('b'), person('c')];
    expect(rankSuggestedProfiles(people, 2)).toHaveLength(2);
    expect(rankSuggestedProfiles(people, 0)).toHaveLength(0);
    expect(rankSuggestedProfiles(people, -3)).toHaveLength(0);
  });

  it('puts a strong taste match ahead of a merely popular stranger', () => {
    const out = rankSuggestedProfiles(
      [person('popular', { ratingCount: 200, followerCount: 500 }), person('twin', { matchScore: 0.8 })],
      10,
    );
    expect(out.map((p) => p.user_id)).toEqual(['twin', 'popular']);
  });
});

describe('tasteMatchScore', () => {
  const rome: TasteSignal = { cuisines: ['Italian', 'Japanese'], pricePrimary: 2, homeCity: 'Austin' };

  it('is 0 for two people with no comparable signal', () => {
    expect(tasteMatchScore({}, {})).toBe(0);
  });

  it('rewards shared cuisines', () => {
    const noOverlap = tasteMatchScore(rome, { cuisines: ['Thai'] });
    const fullOverlap = tasteMatchScore(rome, { cuisines: ['Italian', 'Japanese'] });
    expect(fullOverlap).toBeGreaterThan(noOverlap);
    expect(noOverlap).toBe(0);
  });

  it('rewards a matching home city', () => {
    expect(tasteMatchScore(rome, { homeCity: 'Austin' })).toBeGreaterThan(0);
    expect(tasteMatchScore(rome, { homeCity: 'Denver' })).toBe(0);
  });

  it('is case-insensitive on city names', () => {
    expect(tasteMatchScore(rome, { homeCity: 'austin' })).toBeGreaterThan(0);
  });

  it('prefers close coordinates over a plain city-string match, and scores farther pairs lower', () => {
    const viewer: TasteSignal = { homeLat: 30.2672, homeLng: -97.7431 }; // Austin
    const near = tasteMatchScore(viewer, { homeLat: 30.30, homeLng: -97.75 }); // few km away
    const far = tasteMatchScore(viewer, { homeLat: 40.7128, homeLng: -74.0060 }); // NYC
    expect(near).toBeGreaterThan(far);
    expect(far).toBe(0);
  });

  it('scores someone who matches on every signal higher than someone who matches on only one', () => {
    const full = tasteMatchScore(rome, { cuisines: ['Italian'], pricePrimary: 2, homeCity: 'Austin' });
    const partial = tasteMatchScore(rome, { cuisines: ['Italian'] });
    expect(full).toBeGreaterThan(partial);
  });

  it('rewards a closer price tier over a farther one', () => {
    const close = tasteMatchScore(rome, { pricePrimary: 3 });
    const farApart = tasteMatchScore(rome, { pricePrimary: 4 });
    expect(close).toBeGreaterThan(farApart);
  });
});

describe('tasteMatchReason', () => {
  const rome: TasteSignal = { cuisines: ['Italian', 'Japanese'], homeCity: 'Austin' };

  it('names the shared cuisines', () => {
    expect(tasteMatchReason(rome, { cuisines: ['Italian'] })).toBe('Also loves Italian');
  });

  it('combines cuisine and city when both match', () => {
    expect(tasteMatchReason(rome, { cuisines: ['Italian'], homeCity: 'Austin' })).toBe('Also loves Italian · Austin');
  });

  it('falls back to the city alone when cuisines don’t overlap', () => {
    expect(tasteMatchReason(rome, { cuisines: ['Thai'], homeCity: 'Austin' })).toBe('Also in Austin');
  });

  it('is null when nothing is shared', () => {
    expect(tasteMatchReason(rome, { cuisines: ['Thai'], homeCity: 'Denver' })).toBeNull();
  });
});

describe('suggestionSubtitle', () => {
  it('leads with ratings — the promise about what lands in your feed', () => {
    expect(suggestionSubtitle({ ratingCount: 24, followerCount: 900 })).toBe('24 ratings');
  });

  it('singularises', () => {
    expect(suggestionSubtitle({ ratingCount: 1, followerCount: 0 })).toBe('1 rating');
    expect(suggestionSubtitle({ ratingCount: 0, followerCount: 1 })).toBe('1 follower');
  });

  it('falls back to followers only when there are no ratings to report', () => {
    expect(suggestionSubtitle({ ratingCount: 0, followerCount: 12 })).toBe('12 followers');
  });

  it('never shows a zero — "0 ratings" is a reason not to follow someone', () => {
    expect(suggestionSubtitle({ ratingCount: 0, followerCount: 0 })).toBe('New here');
  });
});

/* ── The blended "people you may know" ranking ─────────────────────────── */

describe('suggestionScore blend', () => {
  it('a contact match outranks a taste match outranks a popular stranger', () => {
    const out = rankSuggestedProfiles([
      person('popular', { ratingCount: 500, followerCount: 900 }),
      person('tasty', { matchScore: 1 }),
      person('known', { contactMatch: true }),
    ], 10);
    expect(out.map((p) => p.user_id)).toEqual(['known', 'tasty', 'popular']);
  });

  it('someone who follows you outranks an equivalent stranger', () => {
    const out = rankSuggestedProfiles([
      person('stranger', { ratingCount: 20 }),
      person('fan', { ratingCount: 20, followsYou: true }),
    ], 10);
    expect(out[0].user_id).toBe('fan');
  });

  it('5 mutual friends outranks 1, but by less than 5× (saturation)', () => {
    const one = suggestionScore(person('a', { mutualCount: 1 }));
    const five = suggestionScore(person('b', { mutualCount: 5 }));
    expect(five).toBeGreaterThan(one);
    expect(five).toBeLessThan(one * 5);
  });

  it('signals genuinely combine — mutuals plus agreement beats more mutuals alone', () => {
    // The reason this is a weighted sum and not a cascade: a strict
    // mutual-count-first sort could never express this.
    const combined = suggestionScore(person('a', { mutualCount: 2, coRatedAgreement: 4, matchScore: 0.5 }));
    const mutualsOnly = suggestionScore(person('b', { mutualCount: 3 }));
    expect(combined).toBeGreaterThan(mutualsOnly);
  });

  it('demonstrated agreement outweighs stated taste', () => {
    const agrees = suggestionScore(person('a', { coRatedAgreement: 5 }));
    const similar = suggestionScore(person('b', { matchScore: 1 }));
    expect(agrees).toBeGreaterThan(similar);
  });

  it('zero social signal falls back to exactly the old verified → ratings → followers order', () => {
    const out = rankSuggestedProfiles([
      person('quiet'),
      person('prolific', { ratingCount: 90 }),
      person('vip', { is_verified: true, ratingCount: 2 }),
      person('followed', { followerCount: 50 }),
    ], 10);
    expect(out.map((p) => p.user_id)).toEqual(['vip', 'prolific', 'followed', 'quiet']);
  });

  it('is stable across reloads for identical inputs', () => {
    const people = [
      person('zed', { mutualCount: 2 }),
      person('amy', { mutualCount: 2 }),
      person('mo', { followsYou: true }),
    ];
    const a = rankSuggestedProfiles(people, 10).map((p) => p.user_id);
    const b = rankSuggestedProfiles([...people].reverse(), 10).map((p) => p.user_id);
    expect(a).toEqual(b);
  });
});

describe('suggestionReasonKind', () => {
  it('picks the strongest applicable signal, in weight order', () => {
    expect(suggestionReasonKind(person('a', { contactMatch: true, followsYou: true, mutualCount: 5 }))).toBe('contact');
    expect(suggestionReasonKind(person('a', { followsYou: true, mutualCount: 5 }))).toBe('followsYou');
    expect(suggestionReasonKind(person('a', { mutualCount: 1, coRatedAgreement: 3 }))).toBe('mutual');
    expect(suggestionReasonKind(person('a', { coRatedAgreement: 3, matchScore: 0.9 }))).toBe('agreement');
    expect(suggestionReasonKind(person('a', { matchScore: 0.2 }))).toBe('taste');
    expect(suggestionReasonKind(person('a'))).toBe('account');
  });
});

describe('diversifySuggestions', () => {
  const contacts = (n: number) => Array.from({ length: n }, (_, i) => person(`c${i}`, { contactMatch: true }));
  const mutuals = (n: number) => Array.from({ length: n }, (_, i) => person(`m${i}`, { mutualCount: 2 }));

  it('caps one category at half the list and lets the next category through', () => {
    const ranked = rankSuggestedProfiles([...contacts(8), ...mutuals(4)], 12);
    const out = diversifySuggestions(ranked, 8);
    const kinds = out.map(suggestionReasonKind);
    expect(kinds.filter((k) => k === 'contact').length).toBe(4);
    expect(kinds.filter((k) => k === 'mutual').length).toBe(4);
  });

  it('backfills from a capped category rather than returning a short list', () => {
    // Only contacts exist — the cap must not starve the list.
    const ranked = rankSuggestedProfiles(contacts(8), 8);
    expect(diversifySuggestions(ranked, 6)).toHaveLength(6);
  });

  it('is a no-op when nothing exceeds the cap — pure rank order survives', () => {
    // 3 + 3 with limit 6 and cap 3: nothing overflows, so the output must
    // be exactly the ranked order, untouched.
    const ranked = rankSuggestedProfiles([...contacts(3), ...mutuals(3)], 6);
    expect(diversifySuggestions(ranked, 6).map((p) => p.user_id))
      .toEqual(ranked.map((p) => p.user_id));
  });

  it('preserves rank order within each category when the cap does bite', () => {
    const ranked = rankSuggestedProfiles([...contacts(8), ...mutuals(4)], 12);
    const out = diversifySuggestions(ranked, 8);
    const contactIds = out.filter((p) => suggestionReasonKind(p) === 'contact').map((p) => p.user_id);
    const mutualIds = out.filter((p) => suggestionReasonKind(p) === 'mutual').map((p) => p.user_id);
    expect(contactIds).toEqual(['c0', 'c1', 'c2', 'c3']);
    expect(mutualIds).toEqual(['m0', 'm1', 'm2', 'm3']);
  });

  it('handles limit 0 and an empty list', () => {
    expect(diversifySuggestions([], 5)).toEqual([]);
    expect(diversifySuggestions(rankSuggestedProfiles(contacts(3), 3), 0)).toEqual([]);
  });
});

describe('suggestionSubtitle with social signals', () => {
  const base = { ratingCount: 24, followerCount: 5 };

  it('contact name leads when known', () => {
    expect(suggestionSubtitle({ ...base, contactMatch: true, contactName: 'Maya Chen' }))
      .toBe('Maya Chen · in your contacts');
    expect(suggestionSubtitle({ ...base, contactMatch: true })).toBe('In your contacts');
  });

  it('follows-you beats mutuals', () => {
    expect(suggestionSubtitle({ ...base, followsYou: true, mutualCount: 4 })).toBe('Follows you');
  });

  it('names mutuals when resolved, counts them when not', () => {
    expect(suggestionSubtitle({ ...base, mutualCount: 3, mutualNames: ['alice', 'bob'] }))
      .toBe('Followed by alice, bob + 1 more');
    expect(suggestionSubtitle({ ...base, mutualCount: 2, mutualNames: ['alice', 'bob'] }))
      .toBe('Followed by alice, bob');
    expect(suggestionSubtitle({ ...base, mutualCount: 1 })).toBe('1 mutual friend');
  });

  it('still falls back to taste, then the account facts', () => {
    expect(suggestionSubtitle({ ...base, matchReason: 'Also loves Italian' })).toBe('Also loves Italian');
    expect(suggestionSubtitle(base)).toBe('24 ratings');
  });
});
