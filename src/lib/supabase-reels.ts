/**
 * Reels persistence layer.
 *
 * - `reels` row holds the video URL + denormalized restaurant/recipe snapshot.
 * - `reel_likes` / `reel_saves` are per-user join tables; counts are computed
 *   client-side from the rows we fetch alongside the reel (PostgREST embed).
 * - `reel_comments` holds threaded comments. Public-read, owner-write.
 * - Video bytes live in the `reels-videos` storage bucket under
 *   `<user_id>/<filename>`. Storage RLS forces uploads into your own folder.
 */
import { supabase, supabaseConfigured } from './supabase';
import { getCachedSignedUrl, putCachedSignedUrl } from './signed-url-cache';
import { captureVideoPoster, posterPathFor } from './video-poster';
import { backfillPosters } from './poster-backfill';
import { requestMuxUpload, uploadToMux, muxPosterUrl } from './mux';

const BUCKET = 'reels-videos';
export const REEL_MAX_DURATION_SECONDS = 60;
// Reels are duration-capped (60 seconds) but otherwise have no size cap.
// Storage RLS still gates uploads to the user's own folder, and the
// browser's own memory limits will catch absurdly large files at upload
// time, so we don't enforce a fixed byte ceiling here.

/* ── Types ──────────────────────────────────────────────────────────── */

export type ReelKind = 'restaurant' | 'recipe';

export interface ReelRestaurantSnapshot {
  id: string;
  name: string;
  cuisine: string;
  price: string;
  address: string;
  image?: string;
  score?: number;
  distanceMi?: number;
}

export interface ReelRecipeSnapshot {
  id: string;
  title: string;
  prepTime: number;
  cookTime: number;
  servings: number;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  image?: string;
}

export interface ReelAuthorSnapshot {
  username: string;
  displayName?: string;
  avatarColor: string;
  initials: string;
  isExpert: boolean;
}

export interface ReelRow {
  id: string;
  userId: string;
  kind: ReelKind;
  videoPath: string;
  videoUrl: string;
  /** Signed URL for the stored poster thumbnail, '' when none exists. */
  posterUrl: string;
  /** Mux public playback id once transcoded, '' for legacy/Storage reels. */
  muxPlaybackId: string;
  /** '' for legacy Storage reels; 'processing' | 'ready' | 'errored' for Mux. */
  muxStatus: string;
  caption: string;
  audioLabel: string;
  locationLabel: string;
  bgGradient: string;
  durationSeconds: number | null;
  restaurant: ReelRestaurantSnapshot | null;
  recipe: ReelRecipeSnapshot | null;
  author: ReelAuthorSnapshot | null;
  likesCount: number;
  savesCount: number;
  commentsCount: number;
  liked: boolean;
  saved: boolean;
  isPublic: boolean;
  createdAt: string;
}

export interface ReelComment {
  id: string;
  reelId: string;
  userId: string;
  body: string;
  createdAt: string;
  /** Parent comment id when this is a reply; null/undefined for top-level. */
  parentId?: string | null;
  author?: ReelAuthorSnapshot;
}

/* ── Row → object helpers ───────────────────────────────────────────── */

const rowToReel = (
  row: Record<string, unknown>,
  myLikes: Set<string>,
  mySaves: Set<string>,
): ReelRow => {
  // PostgREST returns embedded resources as nested arrays/objects. We ask
  // for `reel_likes(count)` etc. so the count comes back as `[{ count: N }]`.
  const likesEmbed = row.reel_likes as Array<{ count: number }> | undefined;
  const savesEmbed = row.reel_saves as Array<{ count: number }> | undefined;
  const commentsEmbed = row.reel_comments as Array<{ count: number }> | undefined;
  const id = String(row.id);
  return {
    id,
    userId: String(row.user_id),
    kind: row.kind as ReelKind,
    videoPath: String(row.video_path || ''),
    videoUrl: String(row.video_url || ''),
    posterUrl: '', // filled in after signing the derived poster path
    muxPlaybackId: String(row.mux_playback_id || ''),
    muxStatus: String(row.mux_status || ''),
    caption: String(row.caption || ''),
    audioLabel: String(row.audio_label || 'Original audio'),
    locationLabel: String(row.location_label || ''),
    bgGradient: String(row.bg_gradient || ''),
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    restaurant: (row.restaurant_data as ReelRestaurantSnapshot | null) || null,
    recipe: (row.recipe_data as ReelRecipeSnapshot | null) || null,
    author: null,
    likesCount: likesEmbed?.[0]?.count ?? 0,
    savesCount: savesEmbed?.[0]?.count ?? 0,
    commentsCount: commentsEmbed?.[0]?.count ?? 0,
    liked: myLikes.has(id),
    saved: mySaves.has(id),
    // Default to true so reels created before migration 020 (which added
    // the column with NOT NULL DEFAULT true) keep their public scope.
    isPublic: row.is_public === undefined ? true : !!row.is_public,
    createdAt: String(row.created_at || ''),
  };
};

/* ── Author hydration (looks up user_profiles) ──────────────────────── */

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

async function hydrateAuthors(userIds: string[]): Promise<Record<string, ReelAuthorSnapshot>> {
  const out: Record<string, ReelAuthorSnapshot> = {};
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

/* ── Upload + create ────────────────────────────────────────────────── */

export interface UploadReelInput {
  userId: string;
  file: File;
  kind: ReelKind;
  caption: string;
  audioLabel: string;
  /** Optional free-text location label (e.g. "Brooklyn, NY"). */
  locationLabel: string;
  bgGradient: string;
  durationSeconds: number;
  isPublic: boolean;
  restaurant?: ReelRestaurantSnapshot;
  recipe?: ReelRecipeSnapshot;
  onProgress?: (fraction: number) => void;
}

/** Probe the duration of a local video file using a hidden <video>. */
export async function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.src = url;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      v.src = '';
    };
    v.onloadedmetadata = () => {
      const d = v.duration;
      cleanup();
      if (Number.isFinite(d) && d > 0) resolve(d);
      else reject(new Error("Couldn't read video duration"));
    };
    v.onerror = () => {
      cleanup();
      reject(new Error("Couldn't read video metadata"));
    };
  });
}

/**
 * Create a reel backed by Mux adaptive streaming.
 *
 * The browser uploads the original straight to Mux (it never touches our
 * server); Mux transcodes to HLS asynchronously and the `mux-webhook` Edge
 * Function writes the playback id back onto this row. We insert the row in a
 * 'processing' state BEFORE the upload so a fast webhook always finds it, and
 * return immediately with a locally-captured poster so the author sees a frame
 * while it transcodes. The feed polls until the status flips to 'ready'.
 */
export async function createReel(input: UploadReelInput): Promise<ReelRow | null> {
  if (!supabaseConfigured) return null;
  const { userId, file, kind, caption, audioLabel, locationLabel, bgGradient, durationSeconds, isPublic, restaurant, recipe, onProgress } = input;

  // Our own id up-front: it doubles as the Mux `passthrough`, so every webhook
  // maps straight back to this row by primary key — no upload/asset-id race.
  const reelId = crypto.randomUUID();

  // Grab a first-frame poster locally so the author sees a still immediately
  // while Mux transcodes (Mux's own poster only exists once the asset is ready).
  // Best-effort — a missing poster just shows the processing state.
  onProgress?.(0.02);
  const posterBlob = await captureVideoPoster(file).catch(() => null);
  const localPosterUrl = posterBlob ? URL.createObjectURL(posterBlob) : '';

  // 1) Mint a one-time Mux direct-upload URL (server-side; holds the creds).
  onProgress?.(0.06);
  let ticket;
  try {
    ticket = await requestMuxUpload({ passthrough: reelId });
  } catch (err) {
    if (localPosterUrl) URL.revokeObjectURL(localPosterUrl);
    console.error('[Reels] mux upload init failed:', err);
    throw err instanceof Error ? err : new Error('Could not start the upload');
  }

  // 2) Insert the row in 'processing' BEFORE uploading, so a webhook that fires
  //    the instant Mux finishes always has a row to update.
  const insertPayload: Record<string, unknown> = {
    id: reelId,
    user_id: userId,
    kind,
    video_path: null,
    video_url: '',
    mux_upload_id: ticket.uploadId,
    mux_status: 'processing',
    caption,
    audio_label: audioLabel,
    location_label: locationLabel,
    bg_gradient: bgGradient,
    duration_seconds: durationSeconds,
    is_public: isPublic,
    restaurant_id: restaurant?.id ?? null,
    restaurant_data: restaurant ?? null,
    recipe_id: recipe?.id ?? null,
    recipe_data: recipe ?? null,
  };
  const insertSelect = '*, reel_likes(count), reel_saves(count), reel_comments(count)';

  let insertResult = await supabase.from('reels').insert(insertPayload).select(insertSelect).single();
  // Migration-tolerance: strip optional columns and retry if a project hasn't
  // applied migration 020 (is_public) / 025 (location_label) yet.
  if (insertResult.error && insertResult.error.code === 'PGRST204' && /is_public/i.test(insertResult.error.message || '')) {
    delete insertPayload.is_public;
    insertResult = await supabase.from('reels').insert(insertPayload).select(insertSelect).single();
  }
  if (insertResult.error && insertResult.error.code === 'PGRST204' && /location_label/i.test(insertResult.error.message || '')) {
    delete insertPayload.location_label;
    insertResult = await supabase.from('reels').insert(insertPayload).select(insertSelect).single();
  }

  const { data: row, error: insertError } = insertResult;
  if (insertError || !row) {
    if (localPosterUrl) URL.revokeObjectURL(localPosterUrl);
    console.error('[Reels] insert failed:', insertError);
    if (insertError?.code === 'PGRST204' && /mux_/i.test(insertError.message || '')) {
      throw new Error('Video uploads need migration 030 applied to this project.');
    }
    throw new Error(insertError?.message || 'Failed to create reel');
  }

  // 3) Upload the bytes straight to Mux — drives the bulk of the progress bar.
  onProgress?.(0.12);
  try {
    await uploadToMux(ticket.uploadUrl, file, { onProgress: (f) => onProgress?.(0.12 + 0.86 * f) });
  } catch (err) {
    // Roll the row back so a failed upload doesn't leave a ghost processing reel.
    try { await supabase.from('reels').delete().eq('id', reelId); } catch { /* best-effort */ }
    if (localPosterUrl) URL.revokeObjectURL(localPosterUrl);
    console.error('[Reels] mux upload failed:', err);
    throw err instanceof Error ? err : new Error('Upload failed');
  }
  onProgress?.(1);

  // Build the UI row: still transcoding, so no playback id yet. The local
  // poster carries the author through the processing window; the feed polls
  // (see ReelsContext) until the webhook flips mux_status to 'ready'.
  const reel = rowToReel(row as Record<string, unknown>, new Set(), new Set());
  reel.posterUrl = localPosterUrl;
  const authors = await hydrateAuthors([reel.userId]);
  reel.author = authors[reel.userId] ?? null;
  return reel;
}

/** Fetch one reel row (with signed/Mux URLs applied), e.g. to poll a freshly
 *  uploaded reel until Mux finishes transcoding. Returns null if it's gone. */
export async function getReel(reelId: string): Promise<ReelRow | null> {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase.from('reels')
    .select('*, reel_likes(count), reel_saves(count), reel_comments(count)')
    .eq('id', reelId)
    .maybeSingle();
  if (error || !data) return null;
  const reel = rowToReel(data as Record<string, unknown>, new Set(), new Set());
  if (reel.muxPlaybackId) {
    reel.posterUrl = muxPosterUrl(reel.muxPlaybackId);
  } else if (reel.videoPath) {
    const [signed, signedPoster] = await Promise.all([
      signVideoPaths([reel.videoPath]),
      signVideoPaths([posterPathFor(reel.videoPath)]),
    ]);
    reel.videoUrl = signed[reel.videoPath] || '';
    reel.posterUrl = signedPoster[posterPathFor(reel.videoPath)] || '';
  }
  const authors = await hydrateAuthors([reel.userId]);
  reel.author = authors[reel.userId] ?? null;
  return reel;
}

/** Generate + store posters for reels uploaded before posters existed, so
 *  they load instantly on the next visit. Calls `onPoster(reelId, localUrl)`
 *  as each completes so the current feed can swap its gradient for a frame. */
export async function backfillReelPosters(
  reels: { id: string; videoPath: string; videoUrl: string; posterUrl: string }[],
  onPoster: (reelId: string, localUrl: string) => void,
): Promise<void> {
  if (!supabaseConfigured) return;
  const targets = reels
    .filter((r) => r.videoUrl && r.videoPath && !r.posterUrl)
    .map((r) => ({ id: r.id, bucket: BUCKET, videoPath: r.videoPath, videoUrl: r.videoUrl }));
  await backfillPosters(targets, onPoster);
}

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24; // 24h

/** Batch-mint signed URLs for a set of storage paths. Reuses still-valid
 *  cached URLs so repeat loads stay stable (browser-cacheable) and only the
 *  genuinely-new paths cost a sign round-trip. Drops any that the viewer can't
 *  see (storage RLS denies → empty for that entry). */
async function signVideoPaths(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!supabaseConfigured || paths.length === 0) return out;
  // De-dup so we don't waste signatures on the same path twice.
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return out;
  // Serve cache hits immediately; only sign the misses.
  const misses: string[] = [];
  for (const p of unique) {
    const cached = getCachedSignedUrl(BUCKET, p);
    if (cached) out[p] = cached;
    else misses.push(p);
  }
  if (misses.length === 0) return out;
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(misses, SIGNED_URL_TTL_SECONDS);
    if (error) {
      console.warn('[Reels] createSignedUrls failed:', error.message);
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
  } catch (err) {
    console.warn('[Reels] sign exception:', err);
  }
  return out;
}

/* ── Read ───────────────────────────────────────────────────────────── */

/** Returns null when the fetch itself failed (offline, Supabase down) so
 * callers can tell "couldn't load" apart from "feed is genuinely empty". */
export async function listReels(opts: {
  kind?: ReelKind;
  limit?: number;
  viewerId?: string | null;
}): Promise<ReelRow[] | null> {
  if (!supabaseConfigured) return [];
  const { kind, limit = 50, viewerId } = opts;

  // Public feed — every reel regardless of author or follow state. Do not
  // add a `user_id` / friends filter here: the product is "discover what
  // anyone is posting", not a follow-only timeline. RLS policy
  // ("Anyone can read reels" USING (true)) already permits this.
  let query = supabase.from('reels')
    .select('*, reel_likes(count), reel_saves(count), reel_comments(count)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (kind) query = query.eq('kind', kind);

  const { data, error } = await query;
  if (error) {
    console.warn('[Reels] list failed:', error.message);
    return null;
  }
  if (!data || data.length === 0) return [];

  // Fetch the viewer's like/save state for these specific reels in one hit.
  const reelIds = data.map((r) => String((r as { id: unknown }).id));
  let myLikes = new Set<string>();
  let mySaves = new Set<string>();
  if (viewerId) {
    const [{ data: likeRows }, { data: saveRows }] = await Promise.all([
      supabase.from('reel_likes').select('reel_id').eq('user_id', viewerId).in('reel_id', reelIds),
      supabase.from('reel_saves').select('reel_id').eq('user_id', viewerId).in('reel_id', reelIds),
    ]);
    myLikes = new Set((likeRows || []).map((r) => String((r as { reel_id: unknown }).reel_id)));
    mySaves = new Set((saveRows || []).map((r) => String((r as { reel_id: unknown }).reel_id)));
  }

  const allReels = data.map((row) => rowToReel(row as Record<string, unknown>, myLikes, mySaves));
  // Hide other people's still-transcoding Mux reels — they have no playable
  // asset yet. The author keeps seeing their own (with its processing state).
  const reels = allReels.filter((r) => !(r.muxStatus && r.muxStatus !== 'ready' && r.userId !== viewerId));
  // Only legacy Storage reels need signed URLs; Mux reels play from Mux hosts.
  // Posters are signed in a SEPARATE batch so a legacy reel with no poster
  // object can't make the call fail and break playback.
  const legacy = reels.filter((r) => !r.muxPlaybackId && r.videoPath);
  const [signed, signedPosters, authors] = await Promise.all([
    signVideoPaths(legacy.map((r) => r.videoPath)),
    signVideoPaths(legacy.map((r) => posterPathFor(r.videoPath))),
    hydrateAuthors(reels.map((r) => r.userId)),
  ]);
  for (const r of reels) {
    r.author = authors[r.userId] ?? null;
    if (r.muxPlaybackId) {
      r.videoUrl = '';
      r.posterUrl = muxPosterUrl(r.muxPlaybackId);
    } else {
      r.videoUrl = signed[r.videoPath] || '';
      r.posterUrl = signedPosters[posterPathFor(r.videoPath)] || '';
    }
  }
  return reels;
}

/* ── Like / save toggles ────────────────────────────────────────────── */

export async function setLike(reelId: string, userId: string, liked: boolean): Promise<boolean> {
  if (!supabaseConfigured) return false;
  if (liked) {
    const { error } = await supabase.from('reel_likes')
      .insert({ reel_id: reelId, user_id: userId })
      // Idempotent — double-tap shouldn't error.
      .select();
    if (error && !error.message.toLowerCase().includes('duplicate')) {
      console.warn('[Reels] like failed:', error.message);
      return false;
    }
    return true;
  }
  const { error } = await supabase.from('reel_likes')
    .delete()
    .eq('reel_id', reelId)
    .eq('user_id', userId);
  if (error) {
    console.warn('[Reels] unlike failed:', error.message);
    return false;
  }
  return true;
}

export async function setSave(reelId: string, userId: string, saved: boolean): Promise<boolean> {
  if (!supabaseConfigured) return false;
  if (saved) {
    const { error } = await supabase.from('reel_saves')
      .insert({ reel_id: reelId, user_id: userId })
      .select();
    if (error && !error.message.toLowerCase().includes('duplicate')) {
      console.warn('[Reels] save failed:', error.message);
      return false;
    }
    return true;
  }
  const { error } = await supabase.from('reel_saves')
    .delete()
    .eq('reel_id', reelId)
    .eq('user_id', userId);
  if (error) {
    console.warn('[Reels] unsave failed:', error.message);
    return false;
  }
  return true;
}

/* ── Delete (owner only — also removes the storage object) ──────────── */

/** Toggle a reel's visibility. Owner-only via the existing UPDATE RLS. */
export async function setReelVisibility(reelId: string, isPublic: boolean): Promise<boolean> {
  if (!supabaseConfigured) return false;
  const { error } = await supabase.from('reels')
    .update({ is_public: isPublic })
    .eq('id', reelId);
  if (error) {
    if (error.code === 'PGRST204' && /is_public/i.test(error.message || '')) {
      console.warn('[Reels] setVisibility no-op — run migration 020 to enable per-reel privacy.');
    } else {
      console.warn('[Reels] setVisibility failed:', error.message);
    }
    return false;
  }
  return true;
}

/* ── Update (caption / audio / featured attachment) ──────────────────
   Owner-only via the existing UPDATE RLS. Media path is immutable —
   editing is for text fields and the attached restaurant or recipe. */

export interface ReelUpdate {
  caption?: string;
  audioLabel?: string;
  locationLabel?: string;
  /** Pass `null` to clear the attachment, an object to set it,
   *  or omit the key to leave it untouched. */
  restaurant?: ReelRestaurantSnapshot | null;
  recipe?: ReelRecipeSnapshot | null;
}

export async function updateReel(reelId: string, updates: ReelUpdate): Promise<boolean> {
  if (!supabaseConfigured) return false;
  const payload: Record<string, unknown> = {};
  if (updates.caption !== undefined) payload.caption = updates.caption;
  if (updates.audioLabel !== undefined) payload.audio_label = updates.audioLabel;
  if (updates.locationLabel !== undefined) payload.location_label = updates.locationLabel;
  if (updates.restaurant !== undefined) {
    payload.restaurant_id = updates.restaurant?.id ?? null;
    payload.restaurant_data = updates.restaurant;
  }
  if (updates.recipe !== undefined) {
    payload.recipe_id = updates.recipe?.id ?? null;
    payload.recipe_data = updates.recipe;
  }
  if (Object.keys(payload).length === 0) return true;
  let { error } = await supabase.from('reels').update(payload).eq('id', reelId);
  // Same fallback as createReel — if the column hasn't been added yet,
  // drop location_label and retry so the rest of the edit still goes
  // through.
  if (error && (error as { code?: string }).code === 'PGRST204' && /location_label/i.test(error.message || '')) {
    console.warn('[Reels] location_label column missing — retrying update without it. Run migration 025 to enable reel locations.');
    delete payload.location_label;
    ({ error } = await supabase.from('reels').update(payload).eq('id', reelId));
  }
  if (error) {
    console.warn('[Reels] update failed:', error.message);
    return false;
  }
  return true;
}

export async function deleteReel(reelId: string): Promise<boolean> {
  if (!supabaseConfigured) return false;
  // Read the video_path so we can clean up storage even if RLS prevents
  // joining storage.objects. Failing the storage delete still lets the
  // row removal succeed.
  const { data: row } = await supabase.from('reels')
    .select('video_path')
    .eq('id', reelId)
    .maybeSingle();
  const path = (row as { video_path?: string } | null)?.video_path;

  const { error } = await supabase.from('reels').delete().eq('id', reelId);
  if (error) {
    console.warn('[Reels] delete failed:', error.message);
    return false;
  }
  if (path) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
  }
  return true;
}

/* ── Comments ───────────────────────────────────────────────────────── */

/** Returns null when the fetch failed, [] when there are no comments. */
export async function listComments(reelId: string): Promise<ReelComment[] | null> {
  if (!supabaseConfigured) return [];
  const { data, error } = await supabase.from('reel_comments')
    .select('*')
    .eq('reel_id', reelId)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[Reels] comments fetch failed:', error.message);
    return null;
  }
  const comments: ReelComment[] = (data || []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      reelId: String(r.reel_id),
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

export async function addComment(reelId: string, userId: string, body: string, parentId?: string | null): Promise<ReelComment | null> {
  if (!supabaseConfigured) return null;
  const trimmed = body.trim();
  if (!trimmed) return null;
  // parent_id only for replies — top-level inserts stay column-agnostic so
  // they keep working before the migration that adds the column runs.
  const payload: Record<string, unknown> = { reel_id: reelId, user_id: userId, body: trimmed.slice(0, 500) };
  if (parentId) payload.parent_id = parentId;
  const { data, error } = await supabase.from('reel_comments')
    .insert(payload)
    .select('*')
    .single();
  if (error || !data) {
    console.warn('[Reels] add comment failed:', error?.message);
    return null;
  }
  const r = data as Record<string, unknown>;
  const comment: ReelComment = {
    id: String(r.id),
    reelId: String(r.reel_id),
    userId: String(r.user_id),
    body: String(r.body || ''),
    createdAt: String(r.created_at || ''),
    parentId: r.parent_id ? String(r.parent_id) : null,
  };
  const authors = await hydrateAuthors([comment.userId]);
  comment.author = authors[comment.userId];
  return comment;
}

export async function deleteComment(commentId: string): Promise<boolean> {
  if (!supabaseConfigured) return false;
  const { error } = await supabase.from('reel_comments').delete().eq('id', commentId);
  if (error) {
    console.warn('[Reels] delete comment failed:', error.message);
    return false;
  }
  return true;
}

/** Distinct reel ids the given user has commented on, newest comment first.
 *  Used by the Activity page to render "reels you've commented on". */
export async function listReelIdsCommentedByUser(userId: string): Promise<string[]> {
  if (!supabaseConfigured || !userId) return [];
  const { data, error } = await supabase
    .from('reel_comments')
    .select('reel_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[Reels] listReelIdsCommentedByUser failed:', error.message);
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of (data || []) as Array<{ reel_id: string }>) {
    if (row.reel_id && !seen.has(row.reel_id)) {
      seen.add(row.reel_id);
      out.push(row.reel_id);
    }
  }
  return out;
}
