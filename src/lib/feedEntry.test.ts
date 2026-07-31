import { describe, it, expect } from 'vitest';
import type { CommunityRating, FriendHomeMeal } from './supabase-community';
import type { PostRow, PostItemRow } from './supabase-posts';
import { mergeFeed, fromPost, fromRating, hasMedia, isImportedRating } from './feedEntry';

/* ── Fixtures ──────────────────────────────────────────────────────────── */

const iso = (msFromEpoch: number) => new Date(msFromEpoch).toISOString();

function mkRating(over: Partial<CommunityRating> = {}): CommunityRating {
  return {
    id: 'r1', user_id: 'u1', restaurant_id: 'rest1', restaurant_name: 'Carbone',
    score: 9.1, notes: '', cuisine: 'Italian', price: '$$$', address: '181 Thompson St',
    visit_date: '2026-07-01', tags: [], would_return: true, friend_ids: [],
    lat: null, lng: null, photo_url: '',
    created_at: iso(1_000), updated_at: iso(1_000),
    ...over,
  };
}

function mkItem(over: Partial<PostItemRow> = {}): PostItemRow {
  return {
    id: 'i1', postId: 'p1', position: 0, mediaType: 'photo',
    mediaPath: 'u1/a.jpg', mediaUrl: 'https://cdn/a.jpg', posterUrl: '',
    muxPlaybackId: '', muxStatus: '', muxPlaybackPolicy: '', muxTokens: null,
    caption: '', attachedKind: null, restaurant: null, recipe: null,
    durationSeconds: null, bgGradient: '',
    ...over,
  };
}

function mkPost(over: Partial<PostRow> = {}): PostRow {
  return {
    id: 'p1', userId: 'u1', caption: '', locationLabel: '', audioLabel: '',
    isPublic: true, createdAt: iso(2_000), items: [mkItem()], author: null,
    likesCount: 0, savesCount: 0, commentsCount: 0, liked: false, saved: false,
    ...over,
  };
}

const mkMeal = (over: Partial<FriendHomeMeal> = {}): FriendHomeMeal => ({
  id: 'm1', userId: 'u2', name: 'Ragu', createdAt: 3_000, tags: [],
  ...over,
} as unknown as FriendHomeMeal);

/* ── One meal, one card ────────────────────────────────────────────────── */

describe('dedupe: a shared rating renders once', () => {
  it('drops the standalone rating when a post links it', () => {
    const rating = mkRating({ id: 'r-shared' });
    const post = mkPost({ id: 'p-shared', ratingId: 'r-shared', score: 9.1 });
    const feed = mergeFeed({ posts: [post], ratings: [rating] });
    expect(feed).toHaveLength(1);
    expect(feed[0].key).toBe('post-p-shared');
    // The surviving card still knows it's a scored review and which rating
    // it belongs to, so the score badge and /review/:id nav both work.
    expect(feed[0].score).toBe(9.1);
    expect(feed[0].ratingId).toBe('r-shared');
  });

  it('keeps an unlinked rating and an unrelated post as two entries', () => {
    const feed = mergeFeed({
      posts: [mkPost({ id: 'p-other' })],
      ratings: [mkRating({ id: 'r-solo' })],
    });
    expect(feed.map((e) => e.key).sort()).toEqual(['post-p-other', 'rating-r-solo']);
  });

  it('a post linking a rating that is not in the fetch window still renders', () => {
    const feed = mergeFeed({ posts: [mkPost({ ratingId: 'r-elsewhere' })], ratings: [] });
    expect(feed).toHaveLength(1);
  });
});

/* ── What each flag means ──────────────────────────────────────────────── */

describe('score and media flags', () => {
  it('a rating is always scored; a plain post is not', () => {
    expect(fromRating(mkRating({ score: 7.4 })).score).toBe(7.4);
    expect(fromPost(mkPost()).score).toBeUndefined();
  });

  it('a photoless rating carries no media (compact card, hidden from grids)', () => {
    const entry = fromRating(mkRating({ photo_url: '' }));
    expect(entry.media).toEqual([]);
    expect(hasMedia(entry)).toBe(false);
  });

  it('a rating with a cover photo carries one media item', () => {
    const entry = fromRating(mkRating({ photo_url: 'https://cdn/cover.jpg' }));
    expect(entry.media).toEqual([{ kind: 'photo', url: 'https://cdn/cover.jpg' }]);
    expect(hasMedia(entry)).toBe(true);
  });

  it('post media follows item position and keeps per-photo captions', () => {
    const post = mkPost({
      items: [
        mkItem({ id: 'b', position: 1, mediaUrl: 'https://cdn/b.jpg', caption: 'second' }),
        mkItem({ id: 'a', position: 0, mediaUrl: 'https://cdn/a.jpg', caption: 'first' }),
      ],
    });
    expect(fromPost(post).media.map((m) => m.caption)).toEqual(['first', 'second']);
  });

  it('drops a Mux item that is still transcoding (no url, no playback id)', () => {
    const post = mkPost({
      items: [
        mkItem({ id: 'ready', position: 0, mediaUrl: '', muxPlaybackId: 'pb1', mediaType: 'video' }),
        mkItem({ id: 'pending', position: 1, mediaUrl: '', muxPlaybackId: '', muxStatus: 'processing', mediaType: 'video' }),
      ],
    });
    expect(fromPost(post).media).toHaveLength(1);
  });

  it('marks slider scores as self-scored', () => {
    expect(fromRating(mkRating({ rating_method: 'slider' })).selfScored).toBe(true);
    expect(fromRating(mkRating({ rating_method: 'h2h' })).selfScored).toBe(false);
  });

  it('surfaces the restaurant a post is about, from the attached item', () => {
    const post = mkPost({
      items: [mkItem({
        attachedKind: 'restaurant',
        restaurant: { id: 'rest9', name: 'Lilia', cuisine: 'Italian', price: '$$$', address: 'Brooklyn' },
      })],
    });
    expect(fromPost(post).restaurant?.name).toBe('Lilia');
  });
});

/* ── Imports never reach the feed ──────────────────────────────────────── */

describe('imported ratings', () => {
  it('are excluded from the merged feed', () => {
    const feed = mergeFeed({
      ratings: [
        mkRating({ id: 'r-import', rating_method: 'import' }),
        mkRating({ id: 'r-real', rating_method: 'h2h' }),
      ],
    });
    expect(feed.map((e) => e.ratingId)).toEqual(['r-real']);
  });

  it('a 200-row Beli import contributes nothing', () => {
    const ratings = Array.from({ length: 200 }, (_, i) =>
      mkRating({ id: `imp-${i}`, rating_method: 'import' }));
    expect(mergeFeed({ ratings })).toHaveLength(0);
  });

  it('isImportedRating only matches the import method', () => {
    expect(isImportedRating({ rating_method: 'import' })).toBe(true);
    expect(isImportedRating({ rating_method: null })).toBe(false);
  });
});

/* ── Ordering ──────────────────────────────────────────────────────────── */

describe('ordering', () => {
  it('interleaves posts, ratings and home meals newest-first', () => {
    const feed = mergeFeed({
      posts: [mkPost({ id: 'p-old', createdAt: iso(1_000) }), mkPost({ id: 'p-new', createdAt: iso(5_000) })],
      ratings: [mkRating({ id: 'r-mid', created_at: iso(3_000), updated_at: iso(3_000) })],
      homeMeals: [mkMeal({ id: 'm-newest', createdAt: 9_000 })],
    });
    expect(feed.map((e) => e.key)).toEqual(['meal-m-newest', 'post-p-new', 'rating-r-mid', 'post-p-old']);
  });

  it('a re-visit resurfaces a rating (updated_at drives rating order)', () => {
    // The whole point of the feed is "what my friends ate recently" — a new
    // visit to a place rated a year ago must come back to the top.
    const feed = mergeFeed({
      ratings: [
        mkRating({ id: 'r-revisited', created_at: iso(1_000), updated_at: iso(8_000) }),
        mkRating({ id: 'r-fresh', created_at: iso(4_000), updated_at: iso(4_000) }),
      ],
    });
    expect(feed.map((e) => e.ratingId)).toEqual(['r-revisited', 'r-fresh']);
  });

  it('flags an edited rating but not a freshly created one', () => {
    expect(fromRating(mkRating({ created_at: iso(1_000), updated_at: iso(600_000) })).edited).toBe(true);
    expect(fromRating(mkRating({ created_at: iso(1_000), updated_at: iso(1_000) })).edited).toBe(false);
  });

  it('is deterministic when two entries share a timestamp', () => {
    const input = {
      posts: [mkPost({ id: 'p-b', createdAt: iso(1_000) }), mkPost({ id: 'p-a', createdAt: iso(1_000) })],
    };
    expect(mergeFeed(input).map((e) => e.key)).toEqual(mergeFeed(input).map((e) => e.key));
    expect(mergeFeed(input).map((e) => e.key)).toEqual(['post-p-a', 'post-p-b']);
  });

  it('rows with no timestamp sort last instead of throwing', () => {
    const feed = mergeFeed({
      posts: [mkPost({ id: 'p-undated', createdAt: '' })],
      ratings: [mkRating({ id: 'r-dated', created_at: iso(2_000), updated_at: iso(2_000) })],
    });
    expect(feed.map((e) => e.key)).toEqual(['rating-r-dated', 'post-p-undated']);
  });

  it('empty input produces an empty feed', () => {
    expect(mergeFeed({})).toEqual([]);
  });
});
