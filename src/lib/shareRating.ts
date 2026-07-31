/**
 * Publishing a rating as a post — the bridge that makes one meal one card.
 *
 * A rating with photos and a post about the same dinner used to be two
 * unrelated rows, so the feed had no way to know they were the same thing.
 * `publishRatingShare` writes the post that a rating's photos belong to and
 * stamps `rating_id` on it, which is what lets lib/feedEntry drop the
 * duplicate. `syncRatingShare` keeps an existing share honest when the
 * rating is edited afterwards.
 *
 * The photo pipelines differ by design: rating photos live as URLs
 * (Storage links, or inline data URLs when the upload hadn't landed yet),
 * while posts own their bytes in the private `post-media` bucket. So the
 * bridge re-materializes each photo as a File and hands it to createPost —
 * the post keeps working (signed URLs, Mux, per-photo captions) with no
 * special-casing downstream.
 */

import { createPost, updatePost, listPosts, type PostRow, type NewPostItem, type PostRestaurantSnapshot } from './supabase-posts';
import { dataUrlToBlob } from './images';

export interface SharePhoto {
  url: string;
  caption?: string;
}

export interface RatingShareInput {
  userId: string;
  /** community_ratings.id — the link that dedupes the feed. */
  ratingId: string;
  score: number;
  /** The rating's notes become the post's caption. */
  notes: string;
  restaurant: PostRestaurantSnapshot;
  photos: SharePhoto[];
  /** Mirrors the rating's own visibility choice. */
  isPublic?: boolean;
}

/** Turn a stored photo URL back into a File so it can ride the post
 *  pipeline. Returns null for anything unusable — a session-scoped blob:
 *  preview, an empty slot, or a fetch the browser refuses. */
export async function photoUrlToFile(url: string, index: number): Promise<File | null> {
  const trimmed = (url || '').trim();
  if (!trimmed || trimmed.startsWith('blob:')) return null;
  try {
    const blob = trimmed.startsWith('data:')
      ? dataUrlToBlob(trimmed)
      : await fetch(trimmed).then((r) => (r.ok ? r.blob() : null));
    if (!blob || blob.size === 0) return null;
    const type = blob.type || 'image/jpeg';
    if (!type.startsWith('image/')) return null;
    const ext = type.split('/')[1]?.split('+')[0] || 'jpg';
    return new File([blob], `share-${index}.${ext}`, { type });
  } catch (err) {
    console.warn('[shareRating] could not materialize photo:', err);
    return null;
  }
}

/**
 * Publish a rating's photos as a linked post. Returns the created post, or
 * null when there was nothing shareable (every photo failed to
 * materialize) — the rating itself is already saved either way, so a
 * failure here costs the share, never the score.
 */
export async function publishRatingShare(input: RatingShareInput): Promise<PostRow | null> {
  const { userId, ratingId, score, notes, restaurant, photos, isPublic = true } = input;
  if (!userId || !ratingId || photos.length === 0) return null;

  const items: NewPostItem[] = [];
  for (let i = 0; i < photos.length; i++) {
    const file = await photoUrlToFile(photos[i].url, i);
    if (!file) continue;
    const isFirst = items.length === 0;
    items.push({
      file,
      mediaType: 'photo',
      caption: photos[i].caption || '',
      bgGradient: '',
      // The restaurant rides on the first item, which is what the post
      // card reads for its "featured place" chip.
      attachedKind: isFirst ? 'restaurant' : null,
      ...(isFirst ? { restaurant } : {}),
    });
  }
  if (items.length === 0) return null;

  try {
    return await createPost({
      userId,
      caption: notes || '',
      locationLabel: restaurant.address || restaurant.name || '',
      audioLabel: '',
      isPublic,
      items,
      ratingId,
      score,
    });
  } catch (err) {
    console.warn('[shareRating] publish failed — the rating is saved, the share is not:', err);
    return null;
  }
}

/** The share already published for this rating, if any (newest first). */
export async function findRatingShare(userId: string, ratingId: string): Promise<PostRow | null> {
  const rows = await listPosts({ viewerId: userId, userIds: [userId], limit: 100 });
  if (!rows) return null;
  return rows.find((p) => p.ratingId === ratingId) || null;
}

/**
 * Keep an existing share in step with an edited rating — a corrected score
 * or a rewritten note updates the card in place instead of posting a
 * second one. A NEW VISIT deliberately does not come through here: that
 * publishes a fresh share, because it's a genuinely new thing to say.
 */
export async function syncRatingShare(
  post: PostRow,
  updates: { score?: number; notes?: string },
): Promise<boolean> {
  const patch: { score?: number; caption?: string } = {};
  if (typeof updates.score === 'number' && updates.score !== post.score) patch.score = updates.score;
  if (typeof updates.notes === 'string' && updates.notes !== post.caption) patch.caption = updates.notes;
  if (Object.keys(patch).length === 0) return true;
  return updatePost(post.id, patch);
}
