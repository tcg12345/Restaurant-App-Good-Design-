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
import { compressImage } from './media-compress';
import { backfillPosters } from './poster-backfill';
import { requestMuxUpload, uploadToMux, muxPosterUrl, fetchMuxTokens, type MuxPlaybackTokens, type MuxUploadTicket } from './mux';

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
  /** Signed URL — minted at read time. Empty if signing failed (e.g. RLS),
   *  or for a Mux video item (which plays from its playback id instead). */
  mediaUrl: string;
  /** Signed URL for a video item's poster thumbnail, '' when none exists. */
  posterUrl: string;
  /** Mux playback id once a video item finishes transcoding, '' else. */
  muxPlaybackId: string;
  /** '' for legacy/Storage items; 'processing' | 'ready' | 'errored' for Mux. */
  muxStatus: string;
  /** 'public' | 'signed' — signed (followers-only) playback needs muxTokens. */
  muxPlaybackPolicy: string;
  /** Viewer-scoped playback tokens for a signed asset; null when public,
   *  unavailable, or the viewer isn't allowed. */
  muxTokens: MuxPlaybackTokens | null;
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
  /** Parent comment id when this is a reply; null/undefined for top-level. */
  parentId?: string | null;
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
      .select('user_id, username, display_name, is_verified')
      .in('user_id', unique);
    for (const row of data || []) {
      const r = row as { user_id: string; username?: string; display_name?: string; is_verified?: boolean };
      out[r.user_id] = {
        username: r.username || (r.display_name?.replace(/\s+/g, '').toLowerCase() || r.user_id.slice(0, 8)),
        displayName: r.display_name || r.username,
        avatarColor: pickAvatarColor(r.user_id),
        initials: initialsFor(r.display_name || r.username || ''),
        isExpert: !!r.is_verified, // legacy field name; sourced from is_verified
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
// photo from ~2–4 MB to ~60 KB. Videos can't be transformed and posters are
// already tiny — both keep plain signed URLs.
//
// IMPORTANT: width-only does NOT preserve aspect ratio on Supabase — it keeps
// the original height, squishing the image into a sliver. We pass a square
// bounding box + resize:'contain', which scales the longest edge to 1280 and
// keeps the real aspect (e.g. 3024×4032 → 960×1280).
export const PHOTO_DISPLAY_TRANSFORM: MediaTransform = { width: 1280, height: 1280, resize: 'contain', quality: 62 };

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
  muxPlaybackId: String(row.mux_playback_id || ''),
  muxStatus: String(row.mux_status || ''),
  // Pre-migration-048 rows default to 'public' — every asset back then was.
  muxPlaybackPolicy: String(row.mux_playback_policy || 'public'),
  muxTokens: null,
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
  /** Cancels the media uploads (the long phase). createPost deletes the
   *  just-inserted post (items cascade), removes any uploaded photos, and
   *  rejects with an AbortError. */
  signal?: AbortSignal;
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

/** Upload all media + insert the post + items. Photos go to Storage (resized
 *  on read); VIDEO items go to Mux (transcoded to adaptive HLS). On failure
 *  mid-flight, attempts to clean up orphan storage objects + the row. */
export async function createPost(input: CreatePostInput): Promise<PostRow | null> {
  if (!supabaseConfigured) return null;
  if (input.items.length === 0) throw new Error('Add at least one photo or video.');
  if (input.items.length > POST_MAX_ITEMS) throw new Error(`Posts cap at ${POST_MAX_ITEMS} items.`);

  const { userId, caption, locationLabel, audioLabel, isPublic, items, onProgress } = input;

  // Stable client ids so each video item can carry its id to Mux as passthrough
  // (the webhook maps the finished asset straight back to the row, race-free).
  const itemIds = items.map(() => crypto.randomUUID());

  // Photos: resize + re-encode before upload. Videos: untouched — Mux transcodes.
  onProgress?.(0.01);
  const photoFiles: (File | null)[] = [];
  for (let i = 0; i < items.length; i++) {
    photoFiles[i] = items[i].mediaType === 'photo' ? await compressImage(items[i].file) : null;
  }
  onProgress?.(0.08);

  // Byte-weighted upload progress across every item (photos to Storage in the
  // prepare phase, video bytes to Mux once the rows exist) → the 0.10–0.92 band.
  const sizeOf = (it: NewPostItem, idx: number) => photoFiles[idx]?.size ?? it.file.size ?? 0;
  const totalBytes = items.reduce((sum, it, idx) => sum + sizeOf(it, idx), 0) || 1;
  const loadedBytes = new Array(items.length).fill(0);
  const emitProgress = () => {
    const loaded = loadedBytes.reduce((a, b) => a + b, 0);
    onProgress?.(0.10 + 0.82 * Math.min(1, loaded / totalBytes));
  };

  const photoPaths: (string | null)[] = items.map(() => null);
  const muxTickets: (MuxUploadTicket | null)[] = items.map(() => null);
  const localPosters: (string | null)[] = items.map(() => null);
  const cleanupLocal = () => localPosters.forEach((u) => { if (u) URL.revokeObjectURL(u); });
  const removePhotos = async () => {
    const paths = photoPaths.filter(Boolean) as string[];
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths).catch(() => {});
  };

  // Prepare: upload photos to Storage now (need the path at insert time); for
  // videos, mint a Mux direct-upload URL + capture a local poster for the
  // processing window.
  try {
    await Promise.all(items.map(async (item, idx) => {
      if (item.mediaType === 'photo') {
        const f = photoFiles[idx]!;
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${userId}/${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
        await uploadFileWithProgress({
          bucket: BUCKET, path, file: f,
          contentType: f.type || `image/${ext}`,
          upsert: false, cacheControlSeconds: 60 * 60 * 24 * 7,
          onProgress: ({ loaded }) => { loadedBytes[idx] = loaded; emitProgress(); },
        });
        photoPaths[idx] = path;
      } else {
        // Followers-only posts ask for the SIGNED playback policy so the
        // video itself is private, not just the DB rows.
        muxTickets[idx] = await requestMuxUpload({ passthrough: itemIds[idx], isPublic });
        const posterBlob = await captureVideoPoster(item.file).catch(() => null);
        if (posterBlob) localPosters[idx] = URL.createObjectURL(posterBlob);
      }
    }));
  } catch (err) {
    await removePhotos();
    cleanupLocal();
    throw err instanceof Error ? err : new Error('Upload failed');
  }

  // Insert the post.
  const postPayload: Record<string, unknown> = { user_id: userId, caption, location_label: locationLabel, audio_label: audioLabel, is_public: isPublic };
  let postInsert = await supabase.from('posts').insert(postPayload).select('id').single();
  if (postInsert.error && postInsert.error.code === 'PGRST204' && /is_public/i.test(postInsert.error.message || '')) {
    delete postPayload.is_public;
    postInsert = await supabase.from('posts').insert(postPayload).select('id').single();
  }
  if (postInsert.error || !postInsert.data) {
    await removePhotos();
    cleanupLocal();
    throw new Error(postInsert.error?.message || 'Failed to create post');
  }
  const postId = String((postInsert.data as { id: string }).id);

  // Insert items BEFORE the Mux byte upload, so a webhook that fires the instant
  // Mux finishes always has a row to update.
  const itemRows: Array<Record<string, unknown>> = items.map((item, idx) => ({
    id: itemIds[idx],
    post_id: postId,
    position: idx,
    media_type: item.mediaType,
    media_path: item.mediaType === 'photo' ? photoPaths[idx] : null,
    mux_upload_id: item.mediaType === 'video' ? muxTickets[idx]?.uploadId ?? null : null,
    mux_status: item.mediaType === 'video' ? 'processing' : null,
    mux_playback_policy: (item.mediaType === 'video' && muxTickets[idx]?.playbackPolicy) || 'public',
    caption: item.caption,
    attached_kind: item.attachedKind,
    restaurant_id: item.restaurant?.id ?? null,
    restaurant_data: item.restaurant ?? null,
    recipe_id: item.recipe?.id ?? null,
    recipe_data: item.recipe ?? null,
    duration_seconds: item.durationSeconds ?? null,
    bg_gradient: item.bgGradient,
  }));
  let itemsInsert = await supabase.from('post_items').insert(itemRows);
  // Migration-tolerance: a project without migration 048 lacks
  // mux_playback_policy — strip it and retry before the harder mux_* check.
  if (itemsInsert.error && itemsInsert.error.code === 'PGRST204' && /mux_playback_policy/i.test(itemsInsert.error.message || '')) {
    for (const row of itemRows) delete row.mux_playback_policy;
    itemsInsert = await supabase.from('post_items').insert(itemRows);
  }
  const itemsError = itemsInsert.error;
  if (itemsError) {
    await supabase.from('posts').delete().eq('id', postId);
    await removePhotos();
    cleanupLocal();
    if (itemsError.code === 'PGRST204' && /mux_/i.test(itemsError.message || '')) {
      throw new Error('Post videos need migration 031 applied to this project.');
    }
    throw new Error(itemsError.message || 'Failed to insert post items');
  }

  // Upload video bytes straight to Mux (the original never touches our server).
  await Promise.all(items.map(async (item, idx) => {
    const ticket = muxTickets[idx];
    if (item.mediaType !== 'video' || !ticket) return;
    try {
      await uploadToMux(ticket.uploadUrl, item.file, {
        onProgress: (f) => { loadedBytes[idx] = (item.file.size || 0) * f; emitProgress(); },
        signal: input.signal,
      });
    } catch (err) {
      // A user cancel aborts the whole post below — don't mark items.
      if ((err as { name?: string })?.name === 'AbortError') throw err;
      console.warn(`[Posts] mux upload failed for item ${idx + 1}:`, err);
      // Mark errored so the UI doesn't spin on a processing item forever.
      try { await supabase.from('post_items').update({ mux_status: 'errored' }).eq('id', itemIds[idx]); } catch { /* ignore */ }
    }
  })).catch(async (err) => {
    // Cancelled mid-upload: tear the whole post down (items cascade off the
    // posts row) so no ghost "processing" items outlive the cancel.
    if ((err as { name?: string })?.name === 'AbortError') {
      try { await supabase.from('posts').delete().eq('id', postId); } catch { /* best-effort */ }
      await removePhotos();
      cleanupLocal();
    }
    throw err;
  });

  // Hold at ~95% while any video item is still transcoding — the bar used
  // to hit 100% and then a "processing" spinner slide appeared anyway,
  // which read as a lie. Photo-only posts have nothing left to do.
  const hasVideo = items.some((it) => it.mediaType === 'video');
  onProgress?.(hasVideo ? 0.95 : 1);

  // Re-fetch with embeds + signed/Mux URLs, then attach the local poster for any
  // item still transcoding so the author sees a frame immediately. Posters
  // that DIDN'T get attached (item already ready with a Mux poster, or the
  // re-fetch failed) are dead blob: URLs — revoke them here or they pin
  // their poster bitmaps in memory for the life of the page.
  const post = await getPost(postId);
  const attached = new Set<number>();
  if (post) {
    for (const it of post.items) {
      if (it.mediaType === 'video' && it.muxStatus !== 'ready' && localPosters[it.position]) {
        it.posterUrl = localPosters[it.position] as string;
        attached.add(it.position);
      }
    }
  }
  localPosters.forEach((u, idx) => {
    if (u && !attached.has(idx)) URL.revokeObjectURL(u);
  });
  // Everything ready (or the transcode already finished during the
  // re-fetch) — the bar may complete honestly.
  const stillProcessing = post
    ? post.items.some((it) => it.muxStatus === 'processing')
    : hasVideo;
  if (!stillProcessing) onProgress?.(1);
  return post;
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
  await decoratePostItems(post.items);
  const authors = await hydrateAuthors([post.userId]);
  post.author = authors[post.userId] ?? null;
  return post;
}

/** Fill in each item's display URLs in place: Mux video items use Mux hosts
 *  (HLS + image thumbnail), photos get a resized WebP variant, and legacy
 *  Storage items get plain signed URLs. Poster paths are signed in a SEPARATE
 *  batch so a legacy item with no poster object can't break media signing. */
async function decoratePostItems(items: PostItemRow[]): Promise<void> {
  // Only legacy Storage items need signing; Mux items play from Mux.
  const legacy = items.filter((it) => it.mediaPath && !it.muxPlaybackId);
  const photoPaths = legacy.filter((it) => it.mediaType === 'photo').map((it) => it.mediaPath);
  const posterPaths = legacy.filter((it) => it.mediaType === 'video').map((it) => posterPathFor(it.mediaPath));
  const signedMux = items.filter((it) => it.muxPlaybackId && it.muxPlaybackPolicy === 'signed');
  const [signed, signedPhotos, signedPosters, muxTokens] = await Promise.all([
    signMediaPaths(legacy.map((it) => it.mediaPath)),
    signMediaPaths(photoPaths, PHOTO_DISPLAY_TRANSFORM),
    signMediaPaths(posterPaths),
    signedMux.length
      ? fetchMuxTokens(signedMux.map((it) => ({ kind: 'post_item' as const, id: it.id })))
      : Promise.resolve(new Map<string, MuxPlaybackTokens>()),
  ]);
  for (const it of items) {
    if (it.muxPlaybackId) {
      // Mux video item: HLS playback by id (no stored media_url) + Mux poster.
      // Signed (followers-only) items carry viewer-scoped tokens; one the
      // token function refused renders posterless and unplayable.
      it.mediaUrl = '';
      if (it.muxPlaybackPolicy === 'signed') {
        it.muxTokens = muxTokens.get(it.id) ?? null;
        it.posterUrl = it.muxTokens ? muxPosterUrl(it.muxPlaybackId, { token: it.muxTokens.thumbnail }) : '';
      } else {
        it.posterUrl = muxPosterUrl(it.muxPlaybackId);
      }
    } else {
      // Photos prefer the small display variant; everything (incl. a photo whose
      // transform failed) falls back to the plain signed URL.
      it.mediaUrl = (it.mediaType === 'photo' ? signedPhotos[it.mediaPath] : '') || signed[it.mediaPath] || '';
      if (it.mediaType === 'video') it.posterUrl = signedPosters[posterPathFor(it.mediaPath)] || '';
    }
  }
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
  /** Restrict to these authors SERVER-SIDE (chunk-safe). Without it, a
   *  caller that wants a friends-only feed has to fetch the global window
   *  and filter client-side — and once the platform has more recent public
   *  posts than `limit`, friends' older posts silently fall outside it. */
  userIds?: string[];
  /** Keyset cursor: return rows strictly OLDER than this (created_at, id)
   *  pair — pass the last row of the previous page to fetch the next one. */
  before?: { createdAt: string; id: string };
  /** Batch-get exactly these posts (e.g. everything the user commented on)
   *  instead of a feed window. Overrides userIds/before; newest first. */
  ids?: string[];
}): Promise<PostRow[] | null> {
  if (!supabaseConfigured) return [];
  const { viewerId, userIds, before, ids } = opts;
  const limit = ids ? ids.length : (opts.limit ?? 50);
  if (userIds && userIds.length === 0) return [];
  if (ids && ids.length === 0) return [];

  // (created_at, id) keyset filter — id breaks same-instant ties.
  const beforeFilter = before
    ? `created_at.lt."${before.createdAt}",and(created_at.eq."${before.createdAt}",id.lt."${before.id}")`
    : null;

  // Feed of posts — RLS scopes the row set to public + owner +
  // accepted-followers. Same author-agnostic philosophy as reels.
  // PostgREST .in() lists are URL-encoded, so cap the id list per query
  // and merge (author sets beyond a few hundred are unrealistic anyway).
  const IN_CHUNK = 150;
  let data: unknown[] | null = null;
  let error: { message: string } | null = null;
  if (userIds && !ids && userIds.length > IN_CHUNK) {
    const merged: unknown[] = [];
    for (let i = 0; i < userIds.length; i += IN_CHUNK) {
      let q = supabase.from('posts')
        .select('*, post_items(*), post_likes(count), post_saves(count), post_comments(count)')
        .in('user_id', userIds.slice(i, i + IN_CHUNK));
      if (beforeFilter) q = q.or(beforeFilter);
      const res = await q
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit);
      if (res.error) { error = res.error; break; }
      merged.push(...(res.data || []));
    }
    if (!error) {
      merged.sort((a, b) => String((b as { created_at?: string }).created_at || '').localeCompare(String((a as { created_at?: string }).created_at || '')));
      data = merged.slice(0, limit);
    }
  } else {
    let q = supabase.from('posts')
      .select('*, post_items(*), post_likes(count), post_saves(count), post_comments(count)');
    if (ids) q = q.in('id', ids);
    if (userIds && !ids) q = q.in('user_id', userIds);
    if (beforeFilter && !ids) q = q.or(beforeFilter);
    const res = await q
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
    data = res.data;
    error = res.error;
  }
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
  const [, authors] = await Promise.all([
    decoratePostItems(posts.flatMap((p) => p.items)),
    hydrateAuthors(posts.map((p) => p.userId)),
  ]);
  for (const p of posts) p.author = authors[p.userId] ?? null;
  return posts;
}

/** Fetch one post's items afresh (with current Mux status / playback id), e.g.
 *  to poll a just-uploaded post until its video items finish transcoding. */
export async function getPostItems(postId: string): Promise<PostItemRow[] | null> {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase.from('post_items').select('*').eq('post_id', postId);
  if (error || !data) return null;
  const items = data.map((r) => rowToItem(r as Record<string, unknown>)).sort((a, b) => a.position - b.position);
  await decoratePostItems(items);
  return items;
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
  // Align every video item's Mux playback policy with the new visibility —
  // RLS only hides the DB rows; the old public stream URLs would keep working
  // otherwise. Playback ids change in the swap, so callers should refetch the
  // post's items after this resolves.
  try {
    await supabase.functions.invoke('mux-set-visibility', { body: { kind: 'post', id: postId } });
  } catch (err) {
    console.warn('[Posts] mux playback-policy sync failed:', err);
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
      parentId: r.parent_id ? String(r.parent_id) : null,
    };
  });
  const authors = await hydrateAuthors(comments.map((c) => c.userId));
  for (const c of comments) c.author = authors[c.userId];
  return comments;
}

export async function addPostComment(postId: string, userId: string, body: string, parentId?: string | null): Promise<PostComment | null> {
  if (!supabaseConfigured) return null;
  const trimmed = body.trim();
  if (!trimmed) return null;
  // Only include parent_id for replies — keeping it off the top-level insert
  // means top-level comments still work on DBs where the column hasn't been
  // added yet (replies require the migration).
  const payload: Record<string, unknown> = { post_id: postId, user_id: userId, body: trimmed.slice(0, 500) };
  if (parentId) payload.parent_id = parentId;
  const { data, error } = await supabase.from('post_comments')
    .insert(payload)
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
    parentId: r.parent_id ? String(r.parent_id) : null,
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
