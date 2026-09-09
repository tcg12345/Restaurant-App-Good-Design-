import type { GuideEntry } from './supabase-guides';
/** Cover first, followed by every distinct photo in its original order. */
export function guidePhotoUrls(entry: Pick<GuideEntry, 'image' | 'photos'>, extra: readonly string[] = []): string[] {
  return [...new Set([entry.image, ...(Array.isArray(entry.photos) ? entry.photos : []), ...extra]
    .filter((url): url is string => typeof url === 'string' && !!url.trim()).map(url => url.trim()))];
}
