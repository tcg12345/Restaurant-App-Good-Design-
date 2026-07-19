import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { useSignInModal } from './SignInModalContext';
import { supabaseConfigured } from '../lib/supabase';
import { createToggleQueue } from '../lib/toggle-queue';
import { isFollowingUser } from '../lib/supabase-community';
import {
  listReels,
  createReel as cloudCreateReel,
  updateReel as cloudUpdateReel,
  setLike as cloudSetLike,
  setSave as cloudSetSave,
  setReelVisibility as cloudSetReelVisibility,
  deleteReel as cloudDeleteReel,
  backfillReelPosters,
  getReel as cloudGetReel,
  listComments as cloudListComments,
  addComment as cloudAddComment,
  deleteComment as cloudDeleteComment,
  readVideoDuration,
  REEL_MAX_DURATION_SECONDS,
  type ReelRow,
  type ReelKind,
  type ReelUpdate,
  type ReelRestaurantSnapshot,
  type ReelRecipeSnapshot,
  type ReelComment,
} from '../lib/supabase-reels';
import type { MuxPlaybackTokens } from '../lib/mux';

export type { ReelKind, ReelRestaurantSnapshot, ReelRecipeSnapshot, ReelComment };
export { REEL_MAX_DURATION_SECONDS };

/* ── UI-shape Reel type. Mirrors what the Reels page already expects. ── */

export interface Reel {
  id: string;
  kind: ReelKind;
  authorId: string;
  authorUsername: string;
  authorDisplayName?: string;
  authorAvatarColor: string;
  authorInitials: string;
  isExpert: boolean;
  videoUrl?: string;
  posterUrl?: string;
  /** Mux playback id — present once a Mux reel finishes transcoding. */
  muxPlaybackId?: string;
  /** Mux lifecycle: 'processing' | 'ready' | 'errored'. Undefined = legacy
   *  Storage reel (plays from videoUrl). */
  muxStatus?: 'processing' | 'ready' | 'errored';
  /** Viewer-scoped playback tokens — present only for signed (followers-only)
   *  Mux reels the viewer may watch. */
  muxTokens?: MuxPlaybackTokens;
  bgGradient: string;
  bgLabel?: string;
  caption: string;
  audioLabel: string;
  locationLabel: string;
  restaurant?: ReelRestaurantSnapshot;
  recipe?: ReelRecipeSnapshot;
  likes: number;
  comments: number;
  saves: number;
  liked: boolean;
  saved: boolean;
  /** True when the reel is visible to everyone; false = followers only. */
  isPublic: boolean;
  createdAt: number;
}

const AVATAR_PALETTE = [
  'bg-emerald-700', 'bg-rose-700', 'bg-amber-600', 'bg-indigo-700',
  'bg-sky-700', 'bg-fuchsia-700', 'bg-orange-700', 'bg-teal-700',
];
function pickFromPool<T>(pool: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}

const DEFAULT_BG = 'from-stone-900 via-amber-900 to-stone-900';

/** Exported for surfaces that batch-fetch reels outside the feed (e.g. the
 *  Activity "Comments" grid) and need the same UI mapping the feed uses. */
export function reelRowToUi(row: ReelRow): Reel { return rowToUi(row); }

function rowToUi(row: ReelRow): Reel {
  const username = row.author?.username || row.userId.slice(0, 8);
  return {
    id: row.id,
    kind: row.kind,
    authorId: row.userId,
    authorUsername: username,
    authorDisplayName: row.author?.displayName,
    authorAvatarColor: row.author?.avatarColor || pickFromPool(AVATAR_PALETTE, row.userId),
    authorInitials: row.author?.initials || username.slice(0, 2).toUpperCase(),
    isExpert: row.author?.isExpert ?? false,
    videoUrl: row.videoUrl || undefined,
    posterUrl: row.posterUrl || undefined,
    muxPlaybackId: row.muxPlaybackId || undefined,
    muxStatus: (row.muxStatus || undefined) as Reel['muxStatus'],
    muxTokens: row.muxTokens || undefined,
    bgGradient: row.bgGradient || DEFAULT_BG,
    caption: row.caption,
    audioLabel: row.audioLabel,
    locationLabel: row.locationLabel,
    restaurant: row.restaurant ?? undefined,
    recipe: row.recipe ?? undefined,
    likes: row.likesCount,
    comments: row.commentsCount,
    saves: row.savesCount,
    liked: row.liked,
    saved: row.saved,
    isPublic: row.isPublic,
    createdAt: row.createdAt ? Date.parse(row.createdAt) : Date.now(),
  };
}

/* ── Context value ──────────────────────────────────────────────────── */

interface ReelsContextValue {
  reels: Reel[];
  restaurantReels: Reel[];
  recipeReels: Reel[];

  loading: boolean;
  /** True when the last feed fetch failed (offline / Supabase error) —
   * lets the page render "couldn't load" + retry instead of a false
   * "nothing here yet" empty state. */
  loadError: boolean;
  refreshReels: () => Promise<void>;
  /** Fetch the next keyset page and append it. No-op while one is in flight
   *  or when the feed is exhausted. */
  loadMoreReels: () => Promise<void>;
  hasMoreReels: boolean;

  postReel: (input: {
    file: File;
    kind: ReelKind;
    caption: string;
    audioLabel: string;
    locationLabel: string;
    bgGradient: string;
    durationSeconds: number;
    isPublic: boolean;
    restaurant?: ReelRestaurantSnapshot;
    recipe?: ReelRecipeSnapshot;
    onProgress?: (n: number) => void;
    /** Cancels the Mux upload — the just-inserted row is rolled back and
     *  the promise rejects with an AbortError. */
    signal?: AbortSignal;
  }) => Promise<Reel | null>;

  toggleLike: (reelId: string) => Promise<void>;
  toggleSave: (reelId: string) => Promise<void>;
  setReelVisibility: (reelId: string, isPublic: boolean) => Promise<boolean>;
  updateReel: (reelId: string, updates: ReelUpdate) => Promise<boolean>;
  deleteReel: (reelId: string) => Promise<boolean>;

  // Comments
  /** Resolves to null when the fetch failed (vs [] for "no comments"). */
  loadComments: (reelId: string) => Promise<ReelComment[] | null>;
  addComment: (reelId: string, body: string, parentId?: string | null) => Promise<ReelComment | null>;
  /** `removedCount` = 1 + the comment's replies (DB cascades parent_id). */
  deleteComment: (reelId: string, commentId: string, removedCount?: number) => Promise<boolean>;

  // Modal
  addReelModalOpen: boolean;
  addReelInitialKind: ReelKind | null;
  /** When set, the modal is in edit mode against this reel's id. */
  editingReelId: string | null;
  /** Open the composer, optionally pre-loaded with a video file handed
   *  off from the Create page's embedded surface. */
  openAddReelModal: (kind?: ReelKind, video?: File) => void;
  /** One-shot: the video passed to openAddReelModal, consumed by the
   *  modal on open. Returns null after the first call. */
  consumePendingReelVideo: () => File | null;
  openEditReelModal: (reelId: string) => void;
  closeAddReelModal: () => void;

  // Comments sheet
  openCommentsReelId: string | null;
  openCommentsSheet: (reelId: string) => void;
  closeCommentsSheet: () => void;

  // Follow state, shared across every slide of the same author. Keyed by
  // author userId — per-slide state let following on one slide leave the
  // same author's other slides stale, and re-queried the DB per slide.
  followingByUser: Record<string, boolean>;
  /** Resolve (once) whether the viewer follows this author; no-op when
   *  already known or in flight. */
  ensureFollowState: (authorId: string) => void;
  /** Write-through used by optimistic follow toggles (and rollbacks). */
  setFollowState: (authorId: string, following: boolean) => void;

  // For owner-only actions
  currentUserId: string | null;
}

const ReelsContext = createContext<ReelsContextValue | null>(null);

/* ── Provider ───────────────────────────────────────────────────────── */

export const ReelsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { requireSignIn } = useSignInModal();
  const userId = user?.id ?? null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const [reels, setReels] = useState<Reel[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [addReelModalOpen, setAddReelModalOpen] = useState(false);
  const [addReelInitialKind, setAddReelInitialKind] = useState<ReelKind | null>(null);
  const [editingReelId, setEditingReelId] = useState<string | null>(null);
  const [openCommentsReelId, setOpenCommentsReelId] = useState<string | null>(null);

  // Shared author-follow map (see the interface comment). The ref mirrors
  // the state so ensureFollowState can dedupe without re-creating itself,
  // and the in-flight set stops N near-window slides of the same author
  // from each firing the same lookup.
  const [followingByUser, setFollowingByUser] = useState<Record<string, boolean>>({});
  const followingByUserRef = useRef<Record<string, boolean>>({});
  const followFetchesRef = useRef<Set<string>>(new Set());
  const ensureFollowState = useCallback((authorId: string) => {
    const viewer = userIdRef.current;
    if (!viewer || !authorId || viewer === authorId) return;
    if (authorId in followingByUserRef.current || followFetchesRef.current.has(authorId)) return;
    followFetchesRef.current.add(authorId);
    isFollowingUser(viewer, authorId)
      .then((yes) => {
        followingByUserRef.current = { ...followingByUserRef.current, [authorId]: yes };
        setFollowingByUser(followingByUserRef.current);
      })
      .catch(() => { /* transient — retried next time a slide asks */ })
      .finally(() => { followFetchesRef.current.delete(authorId); });
  }, []);
  const setFollowState = useCallback((authorId: string, following: boolean) => {
    followingByUserRef.current = { ...followingByUserRef.current, [authorId]: following };
    setFollowingByUser(followingByUserRef.current);
  }, []);
  // The map is the VIEWER's follow graph — drop it when the account changes.
  useEffect(() => {
    followingByUserRef.current = {};
    followFetchesRef.current.clear();
    setFollowingByUser({});
  }, [userId]);

  // Keyset pagination: the feed loads a page at a time instead of one
  // hard-capped window (older reels simply didn't exist past row 100, and
  // every refresh re-downloaded everything). The cursor is the last row of
  // the previous page; like/save state batches per page inside listReels.
  const PAGE_SIZE = 30;
  const [hasMoreReels, setHasMoreReels] = useState(true);
  const reelsCursorRef = useRef<{ createdAt: string; id: string } | null>(null);
  const loadingMoreRef = useRef(false);

  const refreshReels = useCallback(async () => {
    if (!supabaseConfigured) return;
    setLoading(true);
    try {
      const rows = await listReels({ viewerId: userIdRef.current, limit: PAGE_SIZE });
      if (rows) {
        setReels(rows.map(rowToUi));
        const last = rows[rows.length - 1];
        reelsCursorRef.current = last ? { createdAt: last.createdAt, id: last.id } : null;
        setHasMoreReels(rows.length >= PAGE_SIZE);
        setLoadError(false);
        // Heal posters for older reels that never had one, in the background.
        // As each lands, swap that reel's gradient for the captured frame.
        void backfillReelPosters(rows, (reelId, localUrl) => {
          setReels((prev) => prev.map((r) => (r.id === reelId && !r.posterUrl ? { ...r, posterUrl: localUrl } : r)));
        });
      } else {
        setLoadError(true);
      }
    } catch (err) {
      console.warn('[Reels] refresh failed:', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMoreReels = useCallback(async () => {
    if (!supabaseConfigured || loadingMoreRef.current) return;
    const before = reelsCursorRef.current;
    if (!before) return;
    loadingMoreRef.current = true;
    try {
      const rows = await listReels({ viewerId: userIdRef.current, limit: PAGE_SIZE, before });
      if (!rows) return;
      const last = rows[rows.length - 1];
      if (last) reelsCursorRef.current = { createdAt: last.createdAt, id: last.id };
      setHasMoreReels(rows.length >= PAGE_SIZE);
      if (rows.length > 0) {
        setReels((prev) => {
          const seen = new Set(prev.map((r) => r.id));
          return [...prev, ...rows.filter((r) => !seen.has(r.id)).map(rowToUi)];
        });
        void backfillReelPosters(rows, (reelId, localUrl) => {
          setReels((prev) => prev.map((r) => (r.id === reelId && !r.posterUrl ? { ...r, posterUrl: localUrl } : r)));
        });
      }
    } catch (err) {
      console.warn('[Reels] load more failed:', err);
    } finally {
      loadingMoreRef.current = false;
    }
  }, []);

  // Re-fetch when the viewer changes (so liked/saved state is theirs).
  useEffect(() => {
    refreshReels();
  }, [userId, refreshReels]);

  const restaurantReels = useMemo(
    () => reels.filter((r) => r.kind === 'restaurant'),
    [reels],
  );
  const recipeReels = useMemo(
    () => reels.filter((r) => r.kind === 'recipe'),
    [reels],
  );

  /* ── Mutations ─────────────────────────────────────────────────── */

  // Poll a freshly-uploaded Mux reel until the webhook flips it to 'ready',
  // then swap the local processing poster for real Mux playback. Non-blocking;
  // gives up quietly after a few minutes (the next feed refresh would catch it).
  const pollReelReady = useCallback((reelId: string) => {
    let attempts = 0;
    const MAX_ATTEMPTS = 60; // ~3 min at 3s intervals
    const tick = async () => {
      attempts += 1;
      const fresh = await cloudGetReel(reelId).catch(() => null);
      if (fresh && fresh.muxStatus === 'ready' && fresh.muxPlaybackId) {
        setReels((prev) => prev.map((r) => {
          if (r.id !== reelId) return r;
          const nextPoster = fresh.posterUrl || r.posterUrl;
          // The local processing poster is a blob: object URL — release it
          // once the real Mux poster replaces it (revoking twice is a no-op,
          // so a StrictMode re-run of this updater is harmless).
          if (nextPoster !== r.posterUrl && r.posterUrl?.startsWith('blob:')) {
            try { URL.revokeObjectURL(r.posterUrl); } catch { /* noop */ }
          }
          return { ...r, muxStatus: 'ready', muxPlaybackId: fresh.muxPlaybackId, muxTokens: fresh.muxTokens || undefined, posterUrl: nextPoster };
        }));
        return;
      }
      if (fresh && fresh.muxStatus === 'errored') {
        setReels((prev) => prev.map((r) => (r.id === reelId ? { ...r, muxStatus: 'errored' } : r)));
        return;
      }
      if (attempts < MAX_ATTEMPTS) setTimeout(tick, 3000);
    };
    setTimeout(tick, 3000);
  }, []);

  const postReel = useCallback<ReelsContextValue['postReel']>(async (input) => {
    const me = userIdRef.current;
    if (!me) throw new Error('Sign in to post reels');
    const created = await cloudCreateReel({ userId: me, ...input });
    if (!created) return null;
    const ui = rowToUi(created);
    setReels((prev) => [ui, ...prev]);
    // Mux reels come back 'processing'; poll until the webhook says ready.
    if (ui.muxStatus === 'processing') pollReelReady(created.id);
    return ui;
  }, [pollReelReady]);

  // Serializes like/save requests per reel: a second tap queues behind the
  // in-flight one (INSERT and DELETE can never race), and a tap whose
  // desired state the server already confirmed sends nothing.
  const toggleQueueRef = useRef(createToggleQueue());

  const toggleLike = useCallback(async (reelId: string) => {
    const me = userIdRef.current;
    if (!me) { requireSignIn('Sign in to like'); return; }
    let nextLiked: boolean | null = null;
    setReels((prev) => prev.map((r) => {
      if (r.id !== reelId) return r;
      nextLiked = !r.liked;
      return { ...r, liked: nextLiked, likes: r.likes + (nextLiked ? 1 : -1) };
    }));
    if (nextLiked == null) return;
    const desired = nextLiked;
    const outcome = await toggleQueueRef.current.run(`like:${reelId}`, desired, () => cloudSetLike(reelId, me, desired));
    if (outcome === 'failed') {
      // Roll back ONLY while the UI still shows this failed optimistic
      // state — the old unconditional flip clobbered any newer toggle.
      setReels((prev) => prev.map((r) => {
        if (r.id !== reelId || r.liked !== desired) return r;
        return { ...r, liked: !desired, likes: r.likes + (desired ? -1 : 1) };
      }));
    }
  }, []);

  const toggleSave = useCallback(async (reelId: string) => {
    const me = userIdRef.current;
    if (!me) { requireSignIn('Sign in to save'); return; }
    let nextSaved: boolean | null = null;
    setReels((prev) => prev.map((r) => {
      if (r.id !== reelId) return r;
      nextSaved = !r.saved;
      return { ...r, saved: nextSaved, saves: r.saves + (nextSaved ? 1 : -1) };
    }));
    if (nextSaved == null) return;
    const desired = nextSaved;
    const outcome = await toggleQueueRef.current.run(`save:${reelId}`, desired, () => cloudSetSave(reelId, me, desired));
    if (outcome === 'failed') {
      setReels((prev) => prev.map((r) => {
        if (r.id !== reelId || r.saved !== desired) return r;
        return { ...r, saved: !desired, saves: r.saves + (desired ? -1 : 1) };
      }));
    }
  }, []);

  const updateReel = useCallback(async (reelId: string, updates: ReelUpdate): Promise<boolean> => {
    const ok = await cloudUpdateReel(reelId, updates);
    if (!ok) return false;
    // Optimistically reflect the patch in local state so the UI updates
    // without a full re-fetch.
    setReels((prev) => prev.map((r) => {
      if (r.id !== reelId) return r;
      const next = { ...r };
      if (updates.caption !== undefined) next.caption = updates.caption;
      if (updates.audioLabel !== undefined) next.audioLabel = updates.audioLabel;
      if (updates.locationLabel !== undefined) next.locationLabel = updates.locationLabel;
      if (updates.restaurant !== undefined) next.restaurant = updates.restaurant ?? undefined;
      if (updates.recipe !== undefined) next.recipe = updates.recipe ?? undefined;
      return next;
    }));
    return true;
  }, []);

  const setReelVisibility = useCallback(async (reelId: string, isPublic: boolean): Promise<boolean> => {
    // Optimistic — flip locally, fire the cloud update, roll back on failure.
    let prevValue: boolean | null = null;
    setReels((prev) => prev.map((r) => {
      if (r.id !== reelId) return r;
      prevValue = r.isPublic;
      return { ...r, isPublic };
    }));
    const ok = await cloudSetReelVisibility(reelId, isPublic);
    if (!ok && prevValue != null) {
      setReels((prev) => prev.map((r) => r.id === reelId ? { ...r, isPublic: prevValue! } : r));
    }
    if (ok) {
      // The flip swaps the Mux playback id (public ↔ signed policy) — refetch
      // so local state picks up the new id + tokens and playback keeps working.
      const fresh = await cloudGetReel(reelId).catch(() => null);
      if (fresh) setReels((prev) => prev.map((r) => r.id === reelId ? rowToUi(fresh) : r));
    }
    return ok;
  }, []);

  const deleteReel = useCallback(async (reelId: string) => {
    const ok = await cloudDeleteReel(reelId);
    if (ok) setReels((prev) => prev.filter((r) => r.id !== reelId));
    return ok;
  }, []);

  /* ── Comments ──────────────────────────────────────────────────── */

  const loadComments = useCallback(async (reelId: string): Promise<ReelComment[] | null> => {
    return cloudListComments(reelId);
  }, []);

  const addComment = useCallback(async (reelId: string, body: string, parentId?: string | null): Promise<ReelComment | null> => {
    const me = userIdRef.current;
    if (!me) return null;
    const c = await cloudAddComment(reelId, me, body, parentId);
    if (c) {
      // Bump the comment count on the reel so the rail updates.
      setReels((prev) => prev.map((r) => r.id === reelId ? { ...r, comments: r.comments + 1 } : r));
    }
    return c;
  }, []);

  // `removedCount` = 1 + the comment's replies: parent_id cascades in the
  // DB (migration 057), so deleting a parent removes N+1 rows — the badge
  // used to drop by only 1 and drift until the next full load.
  const deleteComment = useCallback(async (reelId: string, commentId: string, removedCount = 1): Promise<boolean> => {
    const ok = await cloudDeleteComment(commentId);
    if (ok) {
      setReels((prev) => prev.map((r) => r.id === reelId ? { ...r, comments: Math.max(0, r.comments - removedCount) } : r));
    }
    return ok;
  }, []);

  /* ── Modals ────────────────────────────────────────────────────── */

  const pendingReelVideoRef = useRef<File | null>(null);
  const openAddReelModal = useCallback((kind?: ReelKind, video?: File) => {
    if (!userIdRef.current) { requireSignIn('Sign in to post a reel'); return; }
    pendingReelVideoRef.current = video ?? null;
    setEditingReelId(null);
    setAddReelInitialKind(kind ?? null);
    setAddReelModalOpen(true);
  }, [requireSignIn]);
  const consumePendingReelVideo = useCallback(() => {
    const f = pendingReelVideoRef.current;
    pendingReelVideoRef.current = null;
    return f;
  }, []);
  const openEditReelModal = useCallback((reelId: string) => {
    if (!userIdRef.current) { requireSignIn('Sign in to edit your reel'); return; }
    pendingReelVideoRef.current = null;
    setEditingReelId(reelId);
    setAddReelInitialKind(null);
    setAddReelModalOpen(true);
  }, [requireSignIn]);
  const closeAddReelModal = useCallback(() => {
    setAddReelModalOpen(false);
    setAddReelInitialKind(null);
    setEditingReelId(null);
  }, []);

  const openCommentsSheet = useCallback((reelId: string) => setOpenCommentsReelId(reelId), []);
  const closeCommentsSheet = useCallback(() => setOpenCommentsReelId(null), []);

  const value: ReelsContextValue = {
    reels,
    restaurantReels,
    recipeReels,
    loading,
    loadError,
    refreshReels,
    loadMoreReels,
    hasMoreReels,
    postReel,
    toggleLike,
    toggleSave,
    setReelVisibility,
    updateReel,
    deleteReel,
    loadComments,
    addComment,
    deleteComment,
    addReelModalOpen,
    addReelInitialKind,
    editingReelId,
    openAddReelModal,
    openEditReelModal,
    closeAddReelModal,
    consumePendingReelVideo,
    openCommentsReelId,
    openCommentsSheet,
    closeCommentsSheet,
    followingByUser,
    ensureFollowState,
    setFollowState,
    currentUserId: userId,
  };

  return <ReelsContext.Provider value={value}>{children}</ReelsContext.Provider>;
};

export function useReels(): ReelsContextValue {
  const ctx = useContext(ReelsContext);
  if (!ctx) throw new Error('useReels must be used within ReelsProvider');
  return ctx;
}

/** Helpers re-exported for the pages. */
export { readVideoDuration };
