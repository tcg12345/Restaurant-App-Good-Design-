import { describe, it, expect } from 'vitest';
import { rankSuggestedProfiles, suggestionSubtitle, type RankableProfile } from './suggestions';

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
