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

const BUCKET = 'reels-videos';
export const REEL_MAX_DURATION_SECONDS = 60;
export const REEL_MAX_BYTES = 80 * 1024 * 1024; // 80 MB

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
  caption: string;
  audioLabel: string;
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
  createdAt: string;
}

export interface ReelComment {
  id: string;
  reelId: string;
  userId: string;
  body: string;
  createdAt: string;
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
    caption: String(row.caption || ''),
    audioLabel: String(row.audio_label || 'Original audio'),
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
  bgGradient: string;
  durationSeconds: number;
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

/** Upload the video file + insert the reels row. Returns the new reel. */
export async function createReel(input: UploadReelInput): Promise<ReelRow | null> {
  if (!supabaseConfigured) return null;
  const { userId, file, kind, caption, audioLabel, bgGradient, durationSeconds, restaurant, recipe, onProgress } = input;

  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `${userId}/${filename}`;

  // Supabase JS upload doesn't expose progress yet, so we just emit a
  // pre-and-post tick so the UI can show a busy state.
  onProgress?.(0.05);
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || `video/${ext}`,
    upsert: false,
  });
  if (uploadError) {
    console.error('[Reels] upload failed:', uploadError);
    throw new Error(uploadError.message);
  }
  onProgress?.(0.85);

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const videoUrl = publicUrlData.publicUrl;

  const { data: row, error: insertError } = await supabase.from('reels')
    .insert({
      user_id: userId,
      kind,
      video_path: path,
      video_url: videoUrl,
      caption,
      audio_label: audioLabel,
      bg_gradient: bgGradient,
      duration_seconds: durationSeconds,
      restaurant_id: restaurant?.id ?? null,
      restaurant_data: restaurant ?? null,
      recipe_id: recipe?.id ?? null,
      recipe_data: recipe ?? null,
    })
    .select('*, reel_likes(count), reel_saves(count), reel_comments(count)')
    .single();

  if (insertError || !row) {
    console.error('[Reels] insert failed:', insertError);
    // Best-effort: clean up the orphaned upload.
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw new Error(insertError?.message || 'Failed to create reel');
  }
  onProgress?.(1);
  const reel = rowToReel(row as Record<string, unknown>, new Set(), new Set());
  // Hydrate author so the UI has a name to render immediately.
  const authors = await hydrateAuthors([reel.userId]);
  reel.author = authors[reel.userId] ?? null;
  return reel;
}

/* ── Read ───────────────────────────────────────────────────────────── */

export async function listReels(opts: {
  kind?: ReelKind;
  limit?: number;
  viewerId?: string | null;
}): Promise<ReelRow[]> {
  if (!supabaseConfigured) return [];
  const { kind, limit = 50, viewerId } = opts;

  let query = supabase.from('reels')
    .select('*, reel_likes(count), reel_saves(count), reel_comments(count)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (kind) query = query.eq('kind', kind);

  const { data, error } = await query;
  if (error) {
    console.warn('[Reels] list failed:', error.message);
    return [];
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

  const reels = data.map((row) => rowToReel(row as Record<string, unknown>, myLikes, mySaves));
  const authors = await hydrateAuthors(reels.map((r) => r.userId));
  for (const r of reels) r.author = authors[r.userId] ?? null;
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

export async function listComments(reelId: string): Promise<ReelComment[]> {
  if (!supabaseConfigured) return [];
  const { data, error } = await supabase.from('reel_comments')
    .select('*')
    .eq('reel_id', reelId)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[Reels] comments fetch failed:', error.message);
    return [];
  }
  const comments: ReelComment[] = (data || []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      reelId: String(r.reel_id),
      userId: String(r.user_id),
      body: String(r.body || ''),
      createdAt: String(r.created_at || ''),
    };
  });
  const authors = await hydrateAuthors(comments.map((c) => c.userId));
  for (const c of comments) c.author = authors[c.userId];
  return comments;
}

export async function addComment(reelId: string, userId: string, body: string): Promise<ReelComment | null> {
  if (!supabaseConfigured) return null;
  const trimmed = body.trim();
  if (!trimmed) return null;
  const { data, error } = await supabase.from('reel_comments')
    .insert({ reel_id: reelId, user_id: userId, body: trimmed.slice(0, 500) })
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
