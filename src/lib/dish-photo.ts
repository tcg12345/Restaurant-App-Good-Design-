// Helpers for the "Recreate a dish" flow — one photo of a plated dish in,
// one AI-authored recipe out. Pure where possible (the provenance and
// cover rules are unit-tested); the two image helpers wrap lib/images.

import type { RecreatedFromRef } from '../contexts/ListsContext';
import { compressImage, dataUrlToBlob } from './images';

/** Where the chosen photo came from. Drives provenance and the cover rule. */
export type DishPhotoOrigin =
  | { kind: 'camera' }
  | { kind: 'library' }
  | { kind: 'rating'; restaurantId: string; restaurantName: string; caption?: string; url: string }
  | { kind: 'community'; restaurantId: string; restaurantName: string; caption?: string; url: string; ownerUserId: string };

export interface DishPhotoPick {
  file: File;
  origin: DishPhotoOrigin;
}

/** Longest edge handed to the vision model. 1600px keeps garnish and
 *  texture legible; the app's usual 800px cover size loses too much. */
export const DISH_PHOTO_MAX_DIM = 1600;
export const DISH_PHOTO_QUALITY = 0.82;

/**
 * Any photo URL the app holds — a public Storage http(s) URL, an inline
 * data: URL, or a session blob: preview — back into a File. Unlike
 * shareRating.photoUrlToFile this accepts blob: URLs: the bytes only need
 * to live for this session (they are re-encoded before upload/transport).
 * Resolves null for anything unusable.
 */
export async function dishPhotoUrlToFile(url: string): Promise<File | null> {
  const trimmed = (url || '').trim();
  if (!trimmed) return null;
  try {
    const blob = trimmed.startsWith('data:')
      ? dataUrlToBlob(trimmed)
      : await fetch(trimmed).then((r) => (r.ok ? r.blob() : null));
    if (!blob || blob.size === 0) return null;
    const type = blob.type || 'image/jpeg';
    if (!type.startsWith('image/')) return null;
    const ext = type.split('/')[1]?.split('+')[0] || 'jpg';
    return new File([blob], `dish.${ext}`, { type });
  } catch (err) {
    console.warn('[dish-photo] could not load photo:', err);
    return null;
  }
}

/** File → JPEG data URL sized for the vision model. Goes through
 *  lib/images.compressImage (createImageBitmap first) so the HEIC
 *  originals the native photo library hands back decode on Safari. */
export function prepareDishPhoto(file: File): Promise<string> {
  return compressImage(file, { maxDim: DISH_PHOTO_MAX_DIM, quality: DISH_PHOTO_QUALITY });
}

const isHttpUrl = (u: string | undefined): u is string => !!u && /^https?:\/\//i.test(u);

/** Is this photo the signed-in user's own? Camera, library and rating
 *  photos always are; a community photo only when they uploaded it. */
export function isOwnDishPhoto(origin: DishPhotoOrigin, currentUserId: string | null): boolean {
  if (origin.kind === 'community') return !!currentUserId && origin.ownerUserId === currentUserId;
  return true;
}

/** Provenance stored on the generated recipe. Only a public http(s) URL
 *  is kept as `photoUrl` — data:/blob: bytes never belong in the blob. */
export function recreatedFromOf(origin: DishPhotoOrigin, currentUserId: string | null): RecreatedFromRef {
  const own = isOwnDishPhoto(origin, currentUserId);
  if (origin.kind === 'camera' || origin.kind === 'library') return { own };
  return {
    own,
    restaurantId: origin.restaurantId,
    restaurantName: origin.restaurantName,
    photoUrl: isHttpUrl(origin.url) ? origin.url : undefined,
  };
}

/** Whether the photo may double as the draft's cover: the user's own
 *  photos only. Another member's community photo is never copied. */
export function mayUseAsCover(origin: DishPhotoOrigin, currentUserId: string | null): boolean {
  return isOwnDishPhoto(origin, currentUserId);
}

/** The already-hosted URL to reuse as the cover when one exists (an own
 *  rating photo is on Storage already — no need to re-upload it). */
export function hostedCoverUrl(origin: DishPhotoOrigin): string | null {
  if (origin.kind === 'rating' || origin.kind === 'community') {
    return isHttpUrl(origin.url) ? origin.url : null;
  }
  return null;
}

/** Keep the cook's explicit request first: the server caps hints at 600
 * characters. Restaurant context fills only the remaining space. */
export function dishPhotoHint(hint: string, origin: DishPhotoOrigin): string | undefined {
  const context = origin.kind === 'rating' || origin.kind === 'community'
    ? [origin.restaurantName && `Restaurant: ${origin.restaurantName}`, origin.caption && `Photo caption: ${origin.caption}`]
    : [];
  return [hint.trim(), ...context].filter(Boolean).join('\n').slice(0, 600) || undefined;
}
