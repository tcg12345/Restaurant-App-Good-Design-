import { describe, it, expect } from 'vitest';
import type { PhotoItem, RestaurantRating } from '../contexts/ListsContext';
import {
  isPendingUploadUrl,
  collectPendingPhotoUploads,
  countPendingPhotoUploads,
  applyPhotoUrlReplacements,
} from './pendingPhotos';

/* ── Fixtures ──────────────────────────────────────────────────────────── */

const photo = (url: string, over: Partial<PhotoItem> = {}): PhotoItem => ({
  url, caption: '', isFavorite: false, ...over,
});

function mk(id: string, photos: PhotoItem[], over: Partial<RestaurantRating> = {}): RestaurantRating {
  return {
    restaurantId: id,
    name: id,
    image: '',
    cuisine: '',
    price: '',
    address: '',
    score: 8,
    notes: '',
    visitDate: '',
    wouldReturn: true,
    tags: [],
    photos,
    listIds: [],
    friendIds: [],
    createdAt: 0,
    updatedAt: 100,
    ...over,
  };
}

const INLINE_A = 'data:image/jpeg;base64,AAAA';
const INLINE_B = 'data:image/jpeg;base64,BBBB';
const STORED = 'https://cdn.example.com/photos/u1/1-x.jpg';

/* ── Scanning ──────────────────────────────────────────────────────────── */

describe('pending photo scan', () => {
  it('treats data: URLs as pending and http(s) Storage URLs as done', () => {
    expect(isPendingUploadUrl(INLINE_A)).toBe(true);
    expect(isPendingUploadUrl(STORED)).toBe(false);
  });

  it('collects every inline photo across ratings with its restaurantId', () => {
    const ratings = [
      mk('a', [photo(STORED), photo(INLINE_A)]),
      mk('b', [photo(INLINE_B)]),
      mk('c', [photo(STORED)]),
      mk('d', []),
    ];
    expect(collectPendingPhotoUploads(ratings)).toEqual([
      { restaurantId: 'a', url: INLINE_A },
      { restaurantId: 'b', url: INLINE_B },
    ]);
    expect(countPendingPhotoUploads(ratings)).toBe(2);
  });
});

/* ── Replacement ───────────────────────────────────────────────────────── */

describe('applyPhotoUrlReplacements', () => {
  it('swaps inline URLs for uploaded ones, stamps updatedAt, reports changed rows', () => {
    const ratings = [
      mk('a', [photo(INLINE_A, { caption: 'pasta', isFavorite: true }), photo(STORED)]),
      mk('b', [photo(STORED)]),
    ];
    const { next, changedIds } = applyPhotoUrlReplacements(
      ratings, new Map([[INLINE_A, 'https://cdn.example.com/photos/u1/2-y.jpg']]), 500,
    );
    expect(changedIds).toEqual(['a']);
    const a = next.find((r) => r.restaurantId === 'a')!;
    expect(a.photos[0].url).toBe('https://cdn.example.com/photos/u1/2-y.jpg');
    // Caption / favorite flags ride along untouched.
    expect(a.photos[0].caption).toBe('pasta');
    expect(a.photos[0].isFavorite).toBe(true);
    expect(a.updatedAt).toBe(500);
    // Untouched rows keep identity (and their merge stamp).
    expect(next.find((r) => r.restaurantId === 'b')).toBe(ratings[1]);
  });

  it('is a no-op (same array identity) when nothing matches', () => {
    const ratings = [mk('a', [photo(STORED)])];
    const { next, changedIds } = applyPhotoUrlReplacements(ratings, new Map([[INLINE_A, STORED]]), 500);
    expect(next).toBe(ratings);
    expect(changedIds).toEqual([]);
  });

  it('a photo deleted between scan and upload completion is simply not matched', () => {
    const ratings = [mk('a', [photo(INLINE_B)])];
    const { next, changedIds } = applyPhotoUrlReplacements(ratings, new Map([[INLINE_A, STORED]]), 500);
    expect(next).toBe(ratings);
    expect(changedIds).toEqual([]);
  });
});

/* ── The retry loop end-to-end (scan → upload → replace → queue drains) ── */

describe('retry flow', () => {
  it('drains the derived queue once uploads succeed', () => {
    let ratings = [
      mk('a', [photo(INLINE_A)]),
      mk('b', [photo(INLINE_B), photo(STORED)]),
    ];
    // First pass: one upload succeeds, one fails (stays inline).
    const pending = collectPendingPhotoUploads(ratings);
    expect(pending).toHaveLength(2);
    const replacements = new Map([[pending[0].url, 'https://cdn.example.com/photos/u1/3-z.jpg']]);
    ratings = applyPhotoUrlReplacements(ratings, replacements, 600).next;
    expect(countPendingPhotoUploads(ratings)).toBe(1);
    // Second pass (next trigger): the remaining upload succeeds.
    const rest = collectPendingPhotoUploads(ratings);
    ratings = applyPhotoUrlReplacements(
      ratings, new Map([[rest[0].url, 'https://cdn.example.com/photos/u1/4-w.jpg']]), 700,
    ).next;
    expect(countPendingPhotoUploads(ratings)).toBe(0);
    expect(ratings.every((r) => r.photos.every((p) => p.url.startsWith('https://')))).toBe(true);
  });
});
