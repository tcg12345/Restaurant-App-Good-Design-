/**
 * Posts persistence layer — multi-item carousels with per-item attachments.
 *
 * - `posts` row: post-level metadata (caption, location, audio, visibility).
 * - `post_items` rows (1–15): each item has its own media + caption +
 *   optional restaurant or recipe attachment (denormalized snapshot).
 * - `post_likes` / `post_saves` / `post_comments`: per-user join tables,
 *   counts computed via PostgREST embeds (mirrors the reels model).
 * - Media bytes live in the private `post-media` bucket; clients sign
 *   short-lived URLs at read time, gated by post visibility RLS.
 */
import { supabase, supabaseConfigured } from './supabase';
import { uploadFileWithProgress } from './storage-upload';
import { getCachedSignedUrl, putCachedSignedUrl } from './signed-url-cache';
import { captureVideoPoster, posterPathFor } from './video-poster';
import { compressImage, compressVideo } from './media-compress';
import { backfillPosters } from './poster-backfill';

const BUCKET = 'post-media';
export const POST_MAX_ITEMS = 15;
export const POST_VIDEO_MAX_DURATION_SECONDS = 60; // matches reels
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24; // 24h

/* ── Types ──────────────────────────────────────────────────────────── */

export type PostMediaType = 'photo' | 'video';
export type PostAttachedKind = 'restaurant' | 'recipe';

export interface PostRestaurantSnapshot {
  id: string;
  name: string;
  cuisine: string;
  price: string;
  address: string;
  image?: string;
  score?: number;
  distanceMi?: number;
}

export interface PostRecipeSnapshot {
  id: string;
  title: string;
  prepTime: number;
  cookTime: number;
  servings: number;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  image?: string;
}

export interface PostAuthorSnapshot {
  username: string;
  displayName?: string;
  avatarColor: string;
  initials: string;
  isExpert: boolean;
}

export interface PostItemRow {
  id: string;
  postId: string;
  position: number;
  mediaType: PostMediaType;
  mediaPath: string;
  /** Signed URL — minted at read time. Empty if signing failed (e.g. RLS). */
  mediaUrl: string;
  /** Signed URL for a video item's poster thumbnail, '' when none exists. */
  posterUrl: string;
  caption: string;
  attachedKind: PostAttachedKind | null;
  restaurant: PostRestaurantSnapshot | null;
  recipe: PostRecipeSnapshot | null;
  durationSeconds: number | null;
  bgGradient: string;
}

export interface PostRow {
  id: string;
  userId: string;
  caption: string;
  locationLabel: string;
  audioLabel: string;
  isPublic: boolean;
  createdAt: string;
  items: PostItemRow[];
  author: PostAuthorSnapshot | null;
  likesCount: number;
  savesCount: number;
  commentsCount: number;
  liked: boolean;
  saved: boolean;
}

export interface PostComment {
  id: string;
  postId: string;
  userId: string;
  body: string;
  createdAt: string;
  author?: PostAuthorSnapshot;
}

/* ── Author hydration (shared helper signature with reels lib) ──────── */

const AVATAR_PALETTE = [
  'bg-emerald-700', 'bg-rose-700', 'bg-amber-600', 'bg-indigo-700',
  'bg-sky-700', 'bg-fuchsia-700', 'bg-orange-700', 'bg-teal-700',
];
function pickAvatarColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

async function hydrateAuthors(userIds: string[]): Promise<Record<string, PostAuthorSnapshot>> {
  const out: Record<string, PostAuthorSnapshot> = {};
  if (!supabaseConfigured || userIds.length === 0) return out;
  try {
    const unique = Array.from(new Set(userIds));
    const { data } = await supabase.from('user_profiles')
      .select('user_id, username, display_name, is_expert')
      .in('user_id', unique);
    for (const row of data || []) {
      const r = row as { user_id: string; username?: string; display_name?: string; is_expert?: boolean };
      out[r.user_id] = {
        username: r.username || (r.display_name?.replace(/\s+/g, '').toLowerCase() || r.user_id.slice(0, 8)),
        displayName: r.display_name || r.username,
        avatarColor: pickAvatarColor(r.user_id),
        initials: initialsFor(r.display_name || r.username || ''),
        isExpert: !!r.is_expert,
      };
    }
  } catch { /* best-effort */ }
  return out;
}

/* ── Signed URL helper ──────────────────────────────────────────────── */

/** Storage image-transform options (resize + recompress on read). */
export interface MediaTransform {
  width?: number;
  height?: number;
  quality?: number;
  resize?: 'cover' | 'contain' | 'fill';
}

// Photos are stored at full camera resolution (multi-MB, ~3000–4000 px) but
// are never shown wider than ~1280 px, even full-screen. Requesting a resized,
// recompressed variant from Storage's image CDN (/render/image) drops a feed
// photo from ~2–4 MB to ~100 KB. Videos can't be transformed and posters are
// already tiny — both keep plain signed URLs.
export const PHOTO_DISPLAY_TRANSFORM: MediaTransform = { width: 1280, quality: 62 };

async function signMediaPaths(paths: string[], transform?: MediaTransform): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!supabaseConfigured || paths.length === 0) return out;
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return out;
  // A transform makes its own cache variant so the small display URL and the
  // full-res URL for the same object never overwrite each other.
  const variant = transform ? `w${transform.width ?? 0}h${transform.height ?? 0}q${transform.quality ?? 0}` : '';
  // Reuse still-valid signed URLs (keeps them browser-cacheable across loads);
  // only the genuinely-new paths cost a sign round-trip.
  const misses: string[] = [];
  for (const p of unique) {
    const cached = getCachedSignedUrl(BUCKET, p, variant);
    if (cached) out[p] = cached;
    else misses.push(p);
  }
  if (misses.length === 0) return out;
  try {
    if (transform) {
      // The batch createSignedUrls endpoint doesn't accept per-object transform
      // options, so transformed variants are signed individually (in parallel).
      const signed = await Promise.all(misses.map(async (p) => {
        const { data, error } = await supabase.storage.from(BUCKET)
          .createSignedUrl(p, SIGNED_URL_TTL_SECONDS, { transform });
        return error || !data?.signedUrl ? null : { path: p, url: data.signedUrl };
      }));
      for (const s of signed) {
        if (!s) continue;
        out[s.path] = s.url;
        putCachedSignedUrl(BUCKET, s.path, s.url, SIGNED_URL_TTL_SECONDS, variant);
      }
    } else {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(misses, SIGNED_URL_TTL_SECONDS);
      if (error) {
        console.warn('[Posts] createSignedUrls failed:', error.message);
        return out;
      }
      for (const item of data || []) {
        const path = (item as { path?: string | null }).path;
        const url = (item as { signedUrl?: string }).signedUrl;
        if (path && url) {
          out[path] = url;
          putCachedSignedUrl(BUCKET, path, url, SIGNED_URL_TTL_SECONDS);
        }
      }
    }
  } catch (err) {
    console.warn('[Posts] sign exception:', err);
  }
  return out;
}

/* ── Row → object ───────────────────────────────────────────────────── */

const rowToItem = (row: Record<string, unknown>): PostItemRow => ({
  id: String(row.id),
  postId: String(row.post_id),
  position: Number(row.position) || 0,
  mediaType: (row.media_type as PostMediaType) || 'photo',
  mediaPath: String(row.media_path || ''),
  mediaUrl: '',
  posterUrl: '', // filled in after signing the derived poster path
  caption: String(row.caption || ''),
  attachedKind: (row.attached_kind as PostAttachedKind | null) || null,
  restaurant: (row.restaurant_data as PostRestaurantSnapshot | null) || null,
  recipe: (row.recipe_data as PostRecipeSnapshot | null) || null,
  durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
  bgGradient: String(row.bg_gradient || ''),
});

const rowToPost = (
  row: Record<string, unknown>,
  myLikes: Set<string>,
  mySaves: Set<string>,
): PostRow => {
  const id = String(row.id);
  const items = ((row.post_items as Record<string, unknown>[]) || [])
    .map(rowToItem)
    .sort((a, b) => a.position - b.position);
  const likesEmbed = row.post_likes as Array<{ count: number }> | undefined;
  const savesEmbed = row.post_saves as Array<{ count: number }> | undefined;
  const commentsEmbed = row.post_comments as Array<{ count: number }> | undefined;
  return {
    id,
    userId: String(row.user_id),
    caption: String(row.caption || ''),
    locationLabel: String(row.location_label || ''),
    audioLabel: String(row.audio_label || 'Original audio'),
    isPublic: row.is_public === undefined ? true : !!row.is_public,
    createdAt: String(row.created_at || ''),
    items,
    author: null,
    likesCount: likesEmbed?.[0]?.count ?? 0,
    savesCount: savesEmbed?.[0]?.count ?? 0,
    commentsCount: commentsEmbed?.[0]?.count ?? 0,
    liked: myLikes.has(id),
    saved: mySaves.has(id),
  };
};

/* ── Create ─────────────────────────────────────────────────────────── */

export interface NewPostItem {
  file: File;
  mediaType: PostMediaType;
  caption: string;
  durationSeconds?: number | null;
  bgGradient: string;
  attachedKind: PostAttachedKind | null;
  restaurant?: PostRestaurantSnapshot;
  recipe?: PostRecipeSnapshot;
}

export interface CreatePostInput {
  userId: string;
  caption: string;
  locationLabel: string;
  audioLabel: string;
  isPublic: boolean;
  items: NewPostItem[];
  onProgress?: (fraction: number) => void;
}

/** Probe a video file's duration via a hidden <video>. */
export async function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.src = url;
    const cleanup = () => { URL.revokeObjectURL(url); v.src = ''; };
    v.onloadedmetadata = () => {
      const d = v.duration;
      cleanup();
      if (Number.isFinite(d) && d > 0) resolve(d);
      else reject(new Error("Couldn't read video duration"));
    };
    v.onerror = () => { cleanup(); reject(new Error("Couldn't read video metadata")); };
  });
}

/** Upload all media + insert the post + items in a single transactional flow.
 *  On failure mid-flight, attempts to clean up orphan storage objects. */
export async function createPost(input: CreatePostInput): Promise<PostRow | null> {
  if (!supabaseConfigured) return null;
  if (input.items.length === 0) throw new Error('Add at least one photo or video.');
  if (input.items.length > POST_MAX_ITEMS) throw new Error(`Posts cap at ${POST_MAX_ITEMS} items.`);

  const { userId, caption, locationLabel, audioLabel, isPublic, items, onProgress } = input;

  // Phase 1 — compress each item before uploading so stored files are smaller
  // (photos resize + re-encode quickly; videos downscale + re-encode in real
  // time). Best-effort: anything that can't be shrunk passes through unchanged.
  // This drives the 0.01–0.30 slice of the progress bar.
  onProgress?.(0.01);
  const uploadFiles: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    uploadFiles[i] = it.mediaType === 'photo'
      ? await compressImage(it.file)
      : await compressVideo(it.file, { onProgress: (frac) => onProgress?.(0.01 + 0.29 * ((i + frac) / items.length)) });
  }
  onProgress?.(0.30);

  // Phase 2 — upload every (compressed) file in parallel, collecting paths.
  // Byte-level progress is aggregated across all items (weighted by size, so a
  // big video doesn't get out-paced by a small photo) into the 0.30–0.88 band.
  const uploadedPaths: string[] = [];
  const totalBytes = uploadFiles.reduce((sum, f) => sum + (f.size || 0), 0) || 1;
  const loadedBytes = new Array(items.length).fill(0);
  const emitProgress = () => {
    const loaded = loadedBytes.reduce((a, b) => a + b, 0);
    onProgress?.(0.30 + 0.58 * Math.min(1, loaded / totalBytes));
  };

  const uploadPromises = items.map(async (item, idx) => {
    const uploadFile = uploadFiles[idx];
    const ext = (uploadFile.name.split('.').pop() || (item.mediaType === 'video' ? 'mp4' : 'jpg')).toLowerCase();
    const filename = `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const path = `${userId}/${filename}`;
    // Start poster capture for video items in parallel with the media upload —
    // it's local decode work that overlaps the network transfer. Best-effort.
    const posterPromise = item.mediaType === 'video'
      ? captureVideoPoster(uploadFile).catch(() => null)
      : Promise.resolve(null);
    try {
      await uploadFileWithProgress({
        bucket: BUCKET,
        path,
        file: uploadFile,
        contentType: uploadFile.type || (item.mediaType === 'video' ? `video/${ext}` : `image/${ext}`),
        upsert: false,
        // Immutable path → let the browser hold the bytes for a long time.
        cacheControlSeconds: 60 * 60 * 24 * 7, // 1 week
        onProgress: ({ loaded }) => { loadedBytes[idx] = loaded; emitProgress(); },
      });
    } catch (err) {
      throw new Error(`Upload failed for item ${idx + 1}: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
    uploadedPaths[idx] = path;
    // Upload the poster thumbnail (derived path, same folder so RLS allows it).
    // Never fatal — a missing poster just falls back to today's behaviour.
    const posterBlob = await posterPromise;
    if (posterBlob) {
      await uploadFileWithProgress({
        bucket: BUCKET,
        path: posterPathFor(path),
        file: posterBlob,
        contentType: 'image/jpeg',
        upsert: true,
        cacheControlSeconds: 60 * 60 * 24 * 7, // 1 week
      }).catch((e) => console.warn('[Posts] poster upload skipped:', e));
    }
    return path;
  });

  try {
    await Promise.all(uploadPromises);
  } catch (err) {
    // Rollback: best-effort delete any objects that did land.
    const toRemove = uploadedPaths.filter(Boolean);
    if (toRemove.length > 0) {
      await supabase.storage.from(BUCKET).remove(toRemove).catch(() => {});
    }
    throw err;
  }

  onProgress?.(0.9);

  // Insert the post row first.
  const postPayload: Record<string, unknown> = {
    user_id: userId,
    caption,
    location_label: locationLabel,
    audio_label: audioLabel,
    is_public: isPublic,
  };

  let postInsert = await supabase.from('posts')
    .insert(postPayload)
    .select('id')
    .single();
  // Defensive: if the schema cache hasn't picked up `is_public` yet, retry
  // without it. The migration default fills it in as true.
  if (postInsert.error && postInsert.error.code === 'PGRST204' && /is_public/i.test(postInsert.error.message || '')) {
    console.warn('[Posts] is_public column missing — falling back to public-only insert.');
    delete postPayload.is_public;
    postInsert = await supabase.from('posts').insert(postPayload).select('id').single();
  }

  if (postInsert.error || !postInsert.data) {
    // Rollback uploads.
    await supabase.storage.from(BUCKET).remove(uploadedPaths).catch(() => {});
    throw new Error(postInsert.error?.message || 'Failed to create post');
  }

  const postId = String((postInsert.data as { id: string }).id);

  // Insert all items.
  const itemRows = items.map((item, idx) => ({
    post_id: postId,
    position: idx,
    media_type: item.mediaType,
    media_path: uploadedPaths[idx],
    caption: item.caption,
    attached_kind: item.attachedKind,
    restaurant_id: item.restaurant?.id ?? null,
    restaurant_data: item.restaurant ?? null,
    recipe_id: item.recipe?.id ?? null,
    recipe_data: item.recipe ?? null,
    duration_seconds: item.durationSeconds ?? null,
    bg_gradient: item.bgGradient,
  }));
  const { error: itemsError } = await supabase.from('post_items').insert(itemRows);
  if (itemsError) {
    // Rollback: delete the post (cascades) and the uploads.
    await supabase.from('posts').delete().eq('id', postId).catch(() => {});
    await supabase.storage.from(BUCKET).remove(uploadedPaths).catch(() => {});
    throw new Error(itemsError.message || 'Failed to insert post items');
  }

  onProgress?.(1);

  // Re-fetch with embeds + sign URLs so the UI can render immediately.
  return getPost(postId);
}

/* ── Read ───────────────────────────────────────────────────────────── */

export async function getPost(postId: string): Promise<PostRow | null> {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase.from('posts')
    .select('*, post_items(*), post_likes(count), post_saves(count), post_comments(count)')
    .eq('id', postId)
    .maybeSingle();
  if (error || !data) return null;
  const post = rowToPost(data as Record<string, unknown>, new Set(), new Set());
  // Poster paths (video items only) are signed in a SEPARATE batch so items
  // with no poster object can't make the call fail and break media playback.
  const posterPaths = post.items
    .filter((it) => it.mediaType === 'video' && it.mediaPath)
    .map((it) => posterPathFor(it.mediaPath));
  const photoPaths = post.items
    .filter((it) => it.mediaType === 'photo' && it.mediaPath)
    .map((it) => it.mediaPath);
  const [signed, signedPhotos, signedPosters, authors] = await Promise.all([
    signMediaPaths(post.items.map((it) => it.mediaPath)),
    signMediaPaths(photoPaths, PHOTO_DISPLAY_TRANSFORM),
    signMediaPaths(posterPaths),
    hydrateAuthors([post.userId]),
  ]);
  for (const it of post.items) {
    // Photos prefer the small display variant; everything (incl. a photo whose
    // transform failed) falls back to the plain signed URL.
    it.mediaUrl = (it.mediaType === 'photo' ? signedPhotos[it.mediaPath] : '') || signed[it.mediaPath] || '';
    if (it.mediaType === 'video') it.posterUrl = signedPosters[posterPathFor(it.mediaPath)] || '';
  }
  post.author = authors[post.userId] ?? null;
  return post;
}

/** Generate + store posters for video items uploaded before posters existed.
 *  Calls `onPoster(postId, itemId, localUrl)` as each completes so the current
 *  feed can swap its gradient for a frame. Best-effort and bandwidth-capped. */
export async function backfillPostPosters(
  posts: PostRow[],
  onPoster: (postId: string, itemId: string, localUrl: string) => void,
): Promise<void> {
  if (!supabaseConfigured) return;
  const targets: { id: string; bucket: string; videoPath: string; videoUrl: string }[] = [];
  for (const p of posts) {
    for (const it of p.items) {
      if (it.mediaType === 'video' && it.mediaUrl && it.mediaPath && !it.posterUrl) {
        targets.push({ id: `${p.id}|${it.id}`, bucket: BUCKET, videoPath: it.mediaPath, videoUrl: it.mediaUrl });
      }
    }
  }
  await backfillPosters(targets, (id, localUrl) => {
    const sep = id.indexOf('|');
    onPoster(id.slice(0, sep), id.slice(sep + 1), localUrl);
  });
}

/** Returns null when the fetch itself failed (offline, Supabase down) so
 * callers can tell "couldn't load" apart from "feed is genuinely empty". */
export async function listPosts(opts: {
  limit?: number;
  viewerId?: string | null;
}): Promise<PostRow[] | null> {
  if (!supabaseConfigured) return [];
  const { limit = 50, viewerId } = opts;

  // Public feed of posts — RLS scopes the row set to public + owner +
  // accepted-followers. Same author-agnostic philosophy as reels.
  const { data, error } = await supabase.from('posts')
    .select('*, post_items(*), post_likes(count), post_saves(count), post_comments(count)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[Posts] list failed:', error.message);
    return null;
  }
  if (!data || data.length === 0) return [];

  const postIds = data.map((p) => String((p as { id: unknown }).id));
  let myLikes = new Set<string>();
  let mySaves = new Set<string>();
  if (viewerId) {
    const [{ data: likeRows }, { data: saveRows }] = await Promise.all([
      supabase.from('post_likes').select('post_id').eq('user_id', viewerId).in('post_id', postIds),
      supabase.from('post_saves').select('post_id').eq('user_id', viewerId).in('post_id', postIds),
    ]);
    myLikes = new Set((likeRows || []).map((r) => String((r as { post_id: unknown }).post_id)));
    mySaves = new Set((saveRows || []).map((r) => String((r as { post_id: unknown }).post_id)));
  }

  const posts = data.map((row) => rowToPost(row as Record<string, unknown>, myLikes, mySaves));
  const allPaths: string[] = [];
  const photoPaths: string[] = [];
  const posterPaths: string[] = [];
  for (const p of posts) for (const it of p.items) {
    if (it.mediaPath) allPaths.push(it.mediaPath);
    if (it.mediaType === 'photo' && it.mediaPath) photoPaths.push(it.mediaPath);
    if (it.mediaType === 'video' && it.mediaPath) posterPaths.push(posterPathFor(it.mediaPath));
  }
  // Posters signed in a separate batch (see getPost) — isolated from media so
  // pre-feature posts with no poster object can't break media signing. Photos
  // additionally get a small display variant; videos keep the plain URL.
  const [signed, signedPhotos, signedPosters, authors] = await Promise.all([
    signMediaPaths(allPaths),
    signMediaPaths(photoPaths, PHOTO_DISPLAY_TRANSFORM),
    signMediaPaths(posterPaths),
    hydrateAuthors(posts.map((p) => p.userId)),
  ]);
  for (const p of posts) {
    p.author = authors[p.userId] ?? null;
    for (const it of p.items) {
      it.mediaUrl = (it.mediaType === 'photo' ? signedPhotos[it.mediaPath] : '') || signed[it.mediaPath] || '';
      if (it.mediaType === 'video') it.posterUrl = signedPosters[posterPathFor(it.mediaPath)] || '';
    }
  }
  return posts;
}

/* ── Like / save / visibility / delete ──────────────────────────────── */

export async function setPostLike(postId: string, userId: string, liked: boolean): Promise<boolean> {
  if (!supabaseConfigured) return false;
  if (liked) {
    const { error } = await supabase.from('post_likes')
      .insert({ post_id: postId, user_id: userId })
      .select();
    if (error && !error.message.toLowerCase().includes('duplicate')) {
      console.warn('[Posts] like failed:', error.message);
      return false;
    }
    return true;
  }
  const { error } = await supabase.from('post_likes')
    .delete()
    .eq('post_id', postId)
    .eq('user_id', userId);
  if (error) { console.warn('[Posts] unlike failed:', error.message); return false; }
  return true;
}

export async function setPostSave(postId: string, userId: string, saved: boolean): Promise<boolean> {
  if (!supabaseConfigured) return false;
  if (saved) {
    const { error } = await supabase.from('post_saves')
      .insert({ post_id: postId, user_id: userId })
      .select();
    if (error && !error.message.toLowerCase().includes('duplicate')) {
      console.warn('[Posts] save failed:', error.message);
      return false;
    }
    return true;
  }
  const { error } = await supabase.from('post_saves')
    .delete()
    .eq('post_id', postId)
    .eq('user_id', userId);
  if (error) { console.warn('[Posts] unsave failed:', error.message); return false; }
  return true;
}

export async function setPostVisibility(postId: string, isPublic: boolean): Promise<boolean> {
  if (!supabaseConfigured) return false;
  const { error } = await supabase.from('posts')
    .update({ is_public: isPublic })
    .eq('id', postId);
  if (error) {
    if (error.code === 'PGRST204' && /is_public/i.test(error.message || '')) {
      console.warn('[Posts] setVisibility no-op — schema cache missing is_public.');
    } else {
      console.warn('[Posts] setVisibility failed:', error.message);
    }
    return false;
  }
  return true;
}

/* ── Update (post-level + per-item, no media swaps) ──────────────────
   Owner-only via the existing UPDATE RLS. Media files are immutable
   here — editing covers caption / location / audio at the post level
   and per-item caption + attached restaurant or recipe. */

export interface PostUpdate {
  caption?: string;
  locationLabel?: string;
  audioLabel?: string;
}

export async function updatePost(postId: string, updates: PostUpdate): Promise<boolean> {
  if (!supabaseConfigured) return false;
  const payload: Record<string, unknown> = {};
  if (updates.caption !== undefined) payload.caption = updates.caption;
  if (updates.locationLabel !== undefined) payload.location_label = updates.locationLabel;
  if (updates.audioLabel !== undefined) payload.audio_label = updates.audioLabel;
  if (Object.keys(payload).length === 0) return true;
  const { error } = await supabase.from('posts').update(payload).eq('id', postId);
  if (error) { console.warn('[Posts] updatePost failed:', error.message); return false; }
  return true;
}

export interface PostItemUpdate {
  itemId: string;
  caption?: string;
  /** `null` clears the attachment; pass an attached_kind together with
   *  the matching snapshot to switch (e.g. restaurant → recipe). */
  attachedKind?: PostAttachedKind | null;
  restaurant?: PostRestaurantSnapshot | null;
  recipe?: PostRecipeSnapshot | null;
}

/** Apply a batch of per-item updates in parallel. Returns true when every
 *  patch succeeded; false if any failed (caller can re-fetch to reconcile). */
export async function updatePostItems(updates: PostItemUpdate[]): Promise<boolean> {
  if (!supabaseConfigured || updates.length === 0) return true;
  const results = await Promise.all(updates.map(async (u) => {
    const payload: Record<string, unknown> = {};
    if (u.caption !== undefined) payload.caption = u.caption;
    if (u.attachedKind !== undefined) {
      payload.attached_kind = u.attachedKind;
      // Clear both snapshots first; whichever side this is becomes
      // the authoritative one below.
      payload.restaurant_id = null;
      payload.restaurant_data = null;
      payload.recipe_id = null;
      payload.recipe_data = null;
    }
    if (u.restaurant !== undefined) {
      payload.restaurant_id = u.restaurant?.id ?? null;
      payload.restaurant_data = u.restaurant;
    }
    if (u.recipe !== undefined) {
      payload.recipe_id = u.recipe?.id ?? null;
      payload.recipe_data = u.recipe;
    }
    if (Object.keys(payload).length === 0) return true;
    const { error } = await supabase.from('post_items').update(payload).eq('id', u.itemId);
    if (error) { console.warn('[Posts] updatePostItems failed for', u.itemId, error.message); return false; }
    return true;
  }));
  return results.every(Boolean);
}

export async function deletePost(postId: string): Promise<boolean> {
  if (!supabaseConfigured) return false;
  // Pull paths to clean up storage after the row delete (CASCADE removes
  // post_items rows but storage objects are orphaned otherwise).
  const { data: items } = await supabase.from('post_items')
    .select('media_path')
    .eq('post_id', postId);
  const paths = ((items || []) as { media_path?: string }[])
    .map((it) => it.media_path)
    .filter((p): p is string => !!p);

  const { error } = await supabase.from('posts').delete().eq('id', postId);
  if (error) { console.warn('[Posts] delete failed:', error.message); return false; }
  if (paths.length > 0) {
    await supabase.storage.from(BUCKET).remove(paths).catch(() => {});
  }
  return true;
}

/* ── Comments ───────────────────────────────────────────────────────── */

/** Returns null when the fetch failed, [] when there are no comments. */
export async function listPostComments(postId: string): Promise<PostComment[] | null> {
  if (!supabaseConfigured) return [];
  const { data, error } = await supabase.from('post_comments')
    .select('*')
    .eq('post_id', postId)
    .order('created_at', { ascending: false });
  if (error) { console.warn('[Posts] comments fetch failed:', error.message); return null; }
  const comments: PostComment[] = (data || []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      postId: String(r.post_id),
      userId: String(r.user_id),
      body: String(r.body || ''),
      createdAt: String(r.created_at || ''),
    };
  });
  const authors = await hydrateAuthors(comments.map((c) => c.userId));
  for (const c of comments) c.author = authors[c.userId];
  return comments;
}

export async function addPostComment(postId: string, userId: string, body: string): Promise<PostComment | null> {
  if (!supabaseConfigured) return null;
  const trimmed = body.trim();
  if (!trimmed) return null;
  const { data, error } = await supabase.from('post_comments')
    .insert({ post_id: postId, user_id: userId, body: trimmed.slice(0, 500) })
    .select('*')
    .single();
  if (error || !data) { console.warn('[Posts] add comment failed:', error?.message); return null; }
  const r = data as Record<string, unknown>;
  const comment: PostComment = {
    id: String(r.id),
    postId: String(r.post_id),
    userId: String(r.user_id),
    body: String(r.body || ''),
    createdAt: String(r.created_at || ''),
  };
  const authors = await hydrateAuthors([comment.userId]);
  comment.author = authors[comment.userId];
  return comment;
}

export async function deletePostComment(commentId: string): Promise<boolean> {
  if (!supabaseConfigured) return false;
  const { error } = await supabase.from('post_comments').delete().eq('id', commentId);
  if (error) { console.warn('[Posts] delete comment failed:', error.message); return false; }
  return true;
}

/** Distinct post ids the given user has commented on, newest comment first. */
export async function listPostIdsCommentedByUser(userId: string): Promise<string[]> {
  if (!supabaseConfigured || !userId) return [];
  const { data, error } = await supabase
    .from('post_comments')
    .select('post_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[Posts] listPostIdsCommentedByUser failed:', error.message);
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of (data || []) as Array<{ post_id: string }>) {
    if (row.post_id && !seen.has(row.post_id)) {
      seen.add(row.post_id);
      out.push(row.post_id);
    }
  }
  return out;
}
