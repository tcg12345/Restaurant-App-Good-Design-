import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { supabaseConfigured } from '../lib/supabase';
import {
  listReels,
  createReel as cloudCreateReel,
  setLike as cloudSetLike,
  setSave as cloudSetSave,
  deleteReel as cloudDeleteReel,
  listComments as cloudListComments,
  addComment as cloudAddComment,
  deleteComment as cloudDeleteComment,
  readVideoDuration,
  REEL_MAX_DURATION_SECONDS,
  REEL_MAX_BYTES,
  type ReelRow,
  type ReelKind,
  type ReelRestaurantSnapshot,
  type ReelRecipeSnapshot,
  type ReelComment,
} from '../lib/supabase-reels';

export type { ReelKind, ReelRestaurantSnapshot, ReelRecipeSnapshot, ReelComment };
export { REEL_MAX_DURATION_SECONDS, REEL_MAX_BYTES };

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
  bgGradient: string;
  bgLabel?: string;
  caption: string;
  audioLabel: string;
  restaurant?: ReelRestaurantSnapshot;
  recipe?: ReelRecipeSnapshot;
  likes: number;
  comments: number;
  saves: number;
  liked: boolean;
  saved: boolean;
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
    bgGradient: row.bgGradient || DEFAULT_BG,
    caption: row.caption,
    audioLabel: row.audioLabel,
    restaurant: row.restaurant ?? undefined,
    recipe: row.recipe ?? undefined,
    likes: row.likesCount,
    comments: row.commentsCount,
    saves: row.savesCount,
    liked: row.liked,
    saved: row.saved,
    createdAt: row.createdAt ? Date.parse(row.createdAt) : Date.now(),
  };
}

/* ── Context value ──────────────────────────────────────────────────── */

interface ReelsContextValue {
  reels: Reel[];
  restaurantReels: Reel[];
  recipeReels: Reel[];

  loading: boolean;
  refreshReels: () => Promise<void>;

  postReel: (input: {
    file: File;
    kind: ReelKind;
    caption: string;
    audioLabel: string;
    bgGradient: string;
    durationSeconds: number;
    restaurant?: ReelRestaurantSnapshot;
    recipe?: ReelRecipeSnapshot;
    onProgress?: (n: number) => void;
  }) => Promise<Reel | null>;

  toggleLike: (reelId: string) => Promise<void>;
  toggleSave: (reelId: string) => Promise<void>;
  deleteReel: (reelId: string) => Promise<boolean>;

  // Comments
  loadComments: (reelId: string) => Promise<ReelComment[]>;
  addComment: (reelId: string, body: string) => Promise<ReelComment | null>;
  deleteComment: (reelId: string, commentId: string) => Promise<boolean>;

  // Modal
  addReelModalOpen: boolean;
  addReelInitialKind: ReelKind | null;
  openAddReelModal: (kind?: ReelKind) => void;
  closeAddReelModal: () => void;

  // Comments sheet
  openCommentsReelId: string | null;
  openCommentsSheet: (reelId: string) => void;
  closeCommentsSheet: () => void;

  // For owner-only actions
  currentUserId: string | null;
}

const ReelsContext = createContext<ReelsContextValue | null>(null);

/* ── Provider ───────────────────────────────────────────────────────── */

export const ReelsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const [reels, setReels] = useState<Reel[]>([]);
  const [loading, setLoading] = useState(false);

  const [addReelModalOpen, setAddReelModalOpen] = useState(false);
  const [addReelInitialKind, setAddReelInitialKind] = useState<ReelKind | null>(null);
  const [openCommentsReelId, setOpenCommentsReelId] = useState<string | null>(null);

  const refreshReels = useCallback(async () => {
    if (!supabaseConfigured) return;
    setLoading(true);
    const rows = await listReels({ viewerId: userIdRef.current, limit: 100 });
    setReels(rows.map(rowToUi));
    setLoading(false);
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

  const postReel = useCallback<ReelsContextValue['postReel']>(async (input) => {
    const me = userIdRef.current;
    if (!me) throw new Error('Sign in to post reels');
    const created = await cloudCreateReel({ userId: me, ...input });
    if (!created) return null;
    const ui = rowToUi(created);
    setReels((prev) => [ui, ...prev]);
    return ui;
  }, []);

  const toggleLike = useCallback(async (reelId: string) => {
    const me = userIdRef.current;
    if (!me) return;
    let nextLiked: boolean | null = null;
    setReels((prev) => prev.map((r) => {
      if (r.id !== reelId) return r;
      nextLiked = !r.liked;
      return { ...r, liked: nextLiked, likes: r.likes + (nextLiked ? 1 : -1) };
    }));
    if (nextLiked == null) return;
    const ok = await cloudSetLike(reelId, me, nextLiked);
    if (!ok) {
      // Roll back optimistic update.
      setReels((prev) => prev.map((r) => {
        if (r.id !== reelId) return r;
        return { ...r, liked: !nextLiked, likes: r.likes + (nextLiked ? -1 : 1) };
      }));
    }
  }, []);

  const toggleSave = useCallback(async (reelId: string) => {
    const me = userIdRef.current;
    if (!me) return;
    let nextSaved: boolean | null = null;
    setReels((prev) => prev.map((r) => {
      if (r.id !== reelId) return r;
      nextSaved = !r.saved;
      return { ...r, saved: nextSaved, saves: r.saves + (nextSaved ? 1 : -1) };
    }));
    if (nextSaved == null) return;
    const ok = await cloudSetSave(reelId, me, nextSaved);
    if (!ok) {
      setReels((prev) => prev.map((r) => {
        if (r.id !== reelId) return r;
        return { ...r, saved: !nextSaved, saves: r.saves + (nextSaved ? -1 : 1) };
      }));
    }
  }, []);

  const deleteReel = useCallback(async (reelId: string) => {
    const ok = await cloudDeleteReel(reelId);
    if (ok) setReels((prev) => prev.filter((r) => r.id !== reelId));
    return ok;
  }, []);

  /* ── Comments ──────────────────────────────────────────────────── */

  const loadComments = useCallback(async (reelId: string): Promise<ReelComment[]> => {
    return cloudListComments(reelId);
  }, []);

  const addComment = useCallback(async (reelId: string, body: string): Promise<ReelComment | null> => {
    const me = userIdRef.current;
    if (!me) return null;
    const c = await cloudAddComment(reelId, me, body);
    if (c) {
      // Bump the comment count on the reel so the rail updates.
      setReels((prev) => prev.map((r) => r.id === reelId ? { ...r, comments: r.comments + 1 } : r));
    }
    return c;
  }, []);

  const deleteComment = useCallback(async (reelId: string, commentId: string): Promise<boolean> => {
    const ok = await cloudDeleteComment(commentId);
    if (ok) {
      setReels((prev) => prev.map((r) => r.id === reelId ? { ...r, comments: Math.max(0, r.comments - 1) } : r));
    }
    return ok;
  }, []);

  /* ── Modals ────────────────────────────────────────────────────── */

  const openAddReelModal = useCallback((kind?: ReelKind) => {
    setAddReelInitialKind(kind ?? null);
    setAddReelModalOpen(true);
  }, []);
  const closeAddReelModal = useCallback(() => {
    setAddReelModalOpen(false);
    setAddReelInitialKind(null);
  }, []);

  const openCommentsSheet = useCallback((reelId: string) => setOpenCommentsReelId(reelId), []);
  const closeCommentsSheet = useCallback(() => setOpenCommentsReelId(null), []);

  const value: ReelsContextValue = {
    reels,
    restaurantReels,
    recipeReels,
    loading,
    refreshReels,
    postReel,
    toggleLike,
    toggleSave,
    deleteReel,
    loadComments,
    addComment,
    deleteComment,
    addReelModalOpen,
    addReelInitialKind,
    openAddReelModal,
    closeAddReelModal,
    openCommentsReelId,
    openCommentsSheet,
    closeCommentsSheet,
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
