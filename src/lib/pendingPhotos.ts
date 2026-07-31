/**
 * Pending photo uploads — the retry side of processPhoto's fallback.
 *
 * processPhoto (src/lib/images.ts) falls back to an inline data: URL when the
 * Storage upload fails or the user is offline / signed out, so photos always
 * render locally. But syncRatingsToCloud drops any inline URL over
 * MAX_INLINE_PHOTO_BYTES from the cloud payload (an 800px/q0.6 JPEG routinely
 * exceeds it), so without a retry such a photo lives on one device forever.
 *
 * The queue is DERIVED, not stored: a photo whose url starts with `data:` IS
 * a pending upload — that's the pipeline's invariant (uploaded photos are
 * short http(s) Storage URLs). Deriving from the ratings array means the
 * queue survives reloads for free (ratings persist), never drifts out of
 * sync with photo edits/reorders the way a stored {ratingId, photoIndex}
 * list would, and self-heals: the moment a URL is replaced, it leaves the
 * queue. ListsContext re-runs the scan on boot, foreground, connectivity
 * regain, and sign-in, uploads what it finds, and swaps URLs via
 * applyPhotoUrlReplacements.
 */

import type { RestaurantRating } from '../contexts/ListsContext';

/** An inline (not-yet-uploaded) photo payload. Uploaded photos are short
 *  http(s) Storage URLs; anything still `data:` is waiting on an upload. */
export function isPendingUploadUrl(url: string): boolean {
  return url.startsWith('data:');
}

/**
 * Drop photo entries whose image can never render again:
 *  - `url: ''` — a pre-C6 cloud sync BLANKED oversized inline photos to ''
 *    (keeping the entry) instead of dropping them; those rows synced back
 *    down and left permanent blank tiles. The bytes are gone — the dead
 *    entry is all that remains.
 *  - `blob:` object URLs — session-scoped previews; after any reload they
 *    point at nothing. The rating save path filters them, but a copy that
 *    slipped into storage must not survive as a blank tile.
 * Returns the same array reference when nothing needed dropping, so callers
 * can cheap-detect "no change".
 */
export function dropDeadPhotos<T extends { url?: unknown }>(photos: T[]): T[] {
  const kept = photos.filter((p) => {
    const url = p?.url;
    if (typeof url !== 'string') return false;
    const trimmed = url.trim();
    return trimmed !== '' && !trimmed.startsWith('blob:');
  });
  return kept.length === photos.length ? photos : kept;
}

export interface PendingPhotoUpload {
  restaurantId: string;
  /** The inline data: URL — doubles as the photo's identity for replacement,
   *  so edits/reorders between scan and upload completion can't mis-target. */
  url: string;
}

/** Scan ratings for photos still carrying inline data: URLs. */
export function collectPendingPhotoUploads(ratings: RestaurantRating[]): PendingPhotoUpload[] {
  const out: PendingPhotoUpload[] = [];
  for (const r of ratings) {
    for (const p of r.photos) {
      if (isPendingUploadUrl(p.url)) out.push({ restaurantId: r.restaurantId, url: p.url });
    }
  }
  return out;
}

export function countPendingPhotoUploads(ratings: RestaurantRating[]): number {
  let n = 0;
  for (const r of ratings) {
    for (const p of r.photos) if (isPendingUploadUrl(p.url)) n++;
  }
  return n;
}

export interface PhotoReplacementResult {
  /** New ratings array; row/array identity is preserved where nothing changed. */
  next: RestaurantRating[];
  /** restaurantIds whose photo set changed (for the community-gallery republish). */
  changedIds: string[];
}

/**
 * Replace photo URLs per `replacements` (old inline URL → Storage URL) and
 * stamp updatedAt on every changed row so the swap wins the multi-device
 * merge. Rows without a matching URL are returned by reference; a photo
 * deleted between scan and upload is simply not matched (no-op).
 */
export function applyPhotoUrlReplacements(
  ratings: RestaurantRating[],
  replacements: Map<string, string>,
  now: number,
): PhotoReplacementResult {
  if (replacements.size === 0) return { next: ratings, changedIds: [] };
  const changedIds: string[] = [];
  let anyChanged = false;
  const next = ratings.map((r) => {
    let rowChanged = false;
    const photos = r.photos.map((p) => {
      const uploaded = replacements.get(p.url);
      if (!uploaded) return p;
      rowChanged = true;
      return { ...p, url: uploaded };
    });
    if (!rowChanged) return r;
    anyChanged = true;
    changedIds.push(r.restaurantId);
    return { ...r, photos, updatedAt: now };
  });
  return anyChanged ? { next, changedIds } : { next: ratings, changedIds: [] };
}
