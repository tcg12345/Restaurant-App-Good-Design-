import { describe, expect, it, vi } from 'vitest';

// dish-photo imports lib/images (canvas + Supabase upload); only the pure
// helpers are exercised here, so stub the boundary.
vi.mock('./images', () => ({
  compressImage: async () => 'data:image/jpeg;base64,stub',
  dataUrlToBlob: () => new Blob(),
}));

import { hostedCoverUrl, isOwnDishPhoto, mayUseAsCover, recreatedFromOf, type DishPhotoOrigin } from './dish-photo';

const ME = 'user-me';
const rating: DishPhotoOrigin = { kind: 'rating', restaurantId: 'r1', restaurantName: 'Kawa Ni', caption: 'Ramen', url: 'https://x.supabase.co/storage/v1/object/public/photos/me/1.jpg' };
const theirs: DishPhotoOrigin = { kind: 'community', restaurantId: 'r1', restaurantName: 'Kawa Ni', url: 'https://x.supabase.co/storage/v1/object/public/photos/them/2.jpg', ownerUserId: 'user-them' };
const mine: DishPhotoOrigin = { ...theirs, ownerUserId: ME } as DishPhotoOrigin;

describe('dish-photo provenance', () => {
  it('camera and library photos are own and carry no restaurant', () => {
    expect(recreatedFromOf({ kind: 'camera' }, ME)).toEqual({ own: true });
    expect(recreatedFromOf({ kind: 'library' }, null)).toEqual({ own: true });
  });

  it('rating photos keep the restaurant and the hosted URL', () => {
    expect(recreatedFromOf(rating, ME)).toEqual({
      own: true, restaurantId: 'r1', restaurantName: 'Kawa Ni', photoUrl: rating.url,
    });
  });

  it('never persists data: or blob: URLs as provenance', () => {
    const inline: DishPhotoOrigin = { ...rating, url: 'data:image/jpeg;base64,AAAA' } as DishPhotoOrigin;
    const session: DishPhotoOrigin = { ...rating, url: 'blob:https://app/abc' } as DishPhotoOrigin;
    expect(recreatedFromOf(inline, ME).photoUrl).toBeUndefined();
    expect(recreatedFromOf(session, ME).photoUrl).toBeUndefined();
  });

  it("another member's community photo is not own; my own upload is", () => {
    expect(recreatedFromOf(theirs, ME).own).toBe(false);
    expect(recreatedFromOf(mine, ME).own).toBe(true);
    expect(isOwnDishPhoto(theirs, null)).toBe(false);
  });
});

describe('cover rule', () => {
  it('allows own photos only', () => {
    expect(mayUseAsCover({ kind: 'camera' }, ME)).toBe(true);
    expect(mayUseAsCover({ kind: 'library' }, ME)).toBe(true);
    expect(mayUseAsCover(rating, ME)).toBe(true);
    expect(mayUseAsCover(mine, ME)).toBe(true);
    expect(mayUseAsCover(theirs, ME)).toBe(false);
  });

  it('reuses the hosted URL for photos already on Storage', () => {
    expect(hostedCoverUrl(rating)).toBe(rating.url);
    expect(hostedCoverUrl({ kind: 'camera' })).toBeNull();
    expect(hostedCoverUrl({ ...rating, url: 'data:image/jpeg;base64,AAAA' } as DishPhotoOrigin)).toBeNull();
  });
});
