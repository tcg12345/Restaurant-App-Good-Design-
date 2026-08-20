import { describe, it, expect } from 'vitest';
import type { CommunityRating, FriendHomeMeal } from './supabase-community';
import type { PostRow, PostItemRow } from './supabase-posts';
import { mergeFeed, fromPost, fromRating, hasMedia, isImportedRating, layoutFeed } from './feedEntry';

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

  it('a rating carries no media (compact card, hidden from grids)', () => {
    const entry = fromRating(mkRating({ photo_url: '' }));
    expect(entry.media).toEqual([]);
    expect(hasMedia(entry)).toBe(false);
  });

  // photo_url is the RESTAURANT's stock cover, not the author's pictures.
  // Counting it as media rendered these full-width, and drew an empty card
  // whenever the Places URL had expired.
  it('a stock cover photo is not the rating\'s own media', () => {
    const entry = fromRating(mkRating({ photo_url: 'https://cdn/cover.jpg' }));
    expect(entry.media).toEqual([]);
    expect(hasMedia(entry)).toBe(false);
    // It still rides along as the restaurant's image for thumbnails.
    expect(entry.restaurant?.image).toBe('https://cdn/cover.jpg');
  });

  it('every rating is compact, so none of them render full-width', () => {
    const rows = layoutFeed([
      fromPost(mkPost({ id: 'p1', createdAt: iso(9_000) })),
      fromRating(mkRating({ id: 'r-cover', photo_url: 'https://cdn/cover.jpg', created_at: iso(8_000), updated_at: iso(8_000) })),
      fromRating(mkRating({ id: 'r-bare', photo_url: '', created_at: iso(7_000), updated_at: iso(7_000) })),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['full', 'strip']);
    expect(rows[1].kind === 'strip' && rows[1].entries.map((e) => e.ratingId)).toEqual(['r-cover', 'r-bare']);
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

describe('layoutFeed', () => {
  // Newest-first order matches mergeFeed's output; ids encode what they are.
  // A rating never carries media (photo_url is the restaurant's cover, not
  // the author's pictures), so every rating is a strip candidate — a
  // rating whose author added photos reaches the feed as its linked post.
  const plainRating = (id: string, t: number) =>
    fromRating(mkRating({ id, photo_url: '', created_at: iso(t), updated_at: iso(t) }));
  const post = (id: string, t: number) => fromPost(mkPost({ id, createdAt: iso(t) }));

  const shape = (rows: ReturnType<typeof layoutFeed>) =>
    rows.map((r) => (r.kind === 'full' ? r.entry.key : `strip(${r.entries.map((e) => e.key).join(',')})`));

  it('keeps posts full-width and strips every rating', () => {
    const rows = layoutFeed([
      post('p1', 9_000), plainRating('r1', 8_000), plainRating('r2', 7_000),
      plainRating('r3', 6_000), post('p2', 5_000), plainRating('r4', 4_000),
      post('p3', 3_000),
    ]);
    expect(shape(rows)).toEqual([
      'post-p1', 'post-p2', 'post-p3',
      'strip(rating-r1,rating-r2,rating-r3,rating-r4)',
    ]);
  });

  it('lands a strip after every 4 full cards', () => {
    const entries = [
      ...Array.from({ length: 9 }, (_, i) => post(`p${i}`, 9_000 - i)),
      ...Array.from({ length: 6 }, (_, i) => plainRating(`r${i}`, 5_000 - i)),
    ];
    const kinds = layoutFeed(entries).map((r) => r.kind);
    // full×4, strip, full×4, strip, full×1, then the leftover strip.
    expect(kinds).toEqual([
      'full', 'full', 'full', 'full', 'strip',
      'full', 'full', 'full', 'full', 'strip',
      'full',
    ]);
  });

  // Chunks of four that land back-to-back are one run, not two sections:
  // the feed borders each row, so a stacked pair read as the same block
  // repeated under a divider.
  it('runs the leftovers as a single strip, not stacked chunks of four', () => {
    const rows = layoutFeed([
      ...Array.from({ length: 4 }, (_, i) => post(`p${i}`, 9_000 - i)),
      ...Array.from({ length: 6 }, (_, i) => plainRating(`r${i}`, 5_000 - i)),
    ]);
    const strips = rows.filter((r) => r.kind === 'strip');
    expect(strips.map((r) => (r.kind === 'strip' ? r.entries.length : 0))).toEqual([6]);
  });

  it('never emits two strips back to back, however the run falls', () => {
    for (const posts of [0, 1, 3, 4, 5, 8]) {
      for (const ratings of [1, 2, 5, 9, 13]) {
        const rows = layoutFeed([
          ...Array.from({ length: posts }, (_, i) => post(`p${i}`, 9_000 - i)),
          ...Array.from({ length: ratings }, (_, i) => plainRating(`r${i}`, 5_000 - i)),
        ]);
        const adjacent = rows.some((r, i) => r.kind === 'strip' && rows[i - 1]?.kind === 'strip');
        expect(adjacent, `${posts} posts + ${ratings} ratings`).toBe(false);
        // Nothing is lost to the merge.
        expect(rows.flatMap((r) => (r.kind === 'strip' ? r.entries : []))).toHaveLength(ratings);
      }
    }
  });

  it('never opens the feed with a strip', () => {
    const rows = layoutFeed([
      plainRating('r1', 9_000), plainRating('r2', 8_000), post('p1', 7_000),
    ]);
    expect(rows[0].kind).toBe('full');
  });

  it('keeps the leftovers rather than dropping them', () => {
    const entries = [
      post('p1', 9_000),
      ...Array.from({ length: 10 }, (_, i) => plainRating(`r${i}`, 8_000 - i)),
    ];
    const rows = layoutFeed(entries);
    const stripped = rows.flatMap((r) => (r.kind === 'strip' ? r.entries : []));
    expect(stripped).toHaveLength(10);
  });

  it('a feed of nothing but photoless ratings is one strip', () => {
    const rows = layoutFeed(Array.from({ length: 5 }, (_, i) => plainRating(`r${i}`, 9_000 - i)));
    expect(rows.map((r) => r.kind)).toEqual(['strip']);
    expect(rows[0].kind === 'strip' && rows[0].entries).toHaveLength(5);
  });

  it('disabled renders everything full-width (the Verified tab)', () => {
    const entries = [post('p1', 9_000), plainRating('r1', 8_000), plainRating('r2', 7_000)];
    const rows = layoutFeed(entries, { enabled: false });
    expect(rows.map((r) => r.kind)).toEqual(['full', 'full', 'full']);
  });

  it('loses no entry, whatever the split', () => {
    const entries = [
      post('p1', 9_000), plainRating('r1', 8_500), plainRating('r2', 8_000),
      plainRating('r3', 7_500), post('p2', 7_000), plainRating('r4', 6_500),
      plainRating('r5', 6_000), post('p3', 5_500), plainRating('r6', 5_000),
    ];
    const rows = layoutFeed(entries);
    const seen = rows.flatMap((r) => (r.kind === 'full' ? [r.entry.key] : r.entries.map((e) => e.key)));
    expect(seen.sort()).toEqual(entries.map((e) => e.key).sort());
  });

  it('empty input produces no rows', () => {
    expect(layoutFeed([])).toEqual([]);
  });
});
