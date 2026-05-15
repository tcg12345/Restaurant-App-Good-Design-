import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { supabaseConfigured } from '../lib/supabase';
import {
  listReels,
  createReel as cloudCreateReel,
  updateReel as cloudUpdateReel,
  setLike as cloudSetLike,
  setSave as cloudSetSave,
  setReelVisibility as cloudSetReelVisibility,
  deleteReel as cloudDeleteReel,
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
  refreshReels: () => Promise<void>;

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
  }) => Promise<Reel | null>;

  toggleLike: (reelId: string) => Promise<void>;
  toggleSave: (reelId: string) => Promise<void>;
  setReelVisibility: (reelId: string, isPublic: boolean) => Promise<boolean>;
  updateReel: (reelId: string, updates: ReelUpdate) => Promise<boolean>;
  deleteReel: (reelId: string) => Promise<boolean>;

  // Comments
  loadComments: (reelId: string) => Promise<ReelComment[]>;
  addComment: (reelId: string, body: string) => Promise<ReelComment | null>;
  deleteComment: (reelId: string, commentId: string) => Promise<boolean>;

  // Modal
  addReelModalOpen: boolean;
  addReelInitialKind: ReelKind | null;
  /** When set, the modal is in edit mode against this reel's id. */
  editingReelId: string | null;
  openAddReelModal: (kind?: ReelKind) => void;
  openEditReelModal: (reelId: string) => void;
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
  const [editingReelId, setEditingReelId] = useState<string | null>(null);
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
    return ok;
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
    setEditingReelId(null);
    setAddReelInitialKind(kind ?? null);
    setAddReelModalOpen(true);
  }, []);
  const openEditReelModal = useCallback((reelId: string) => {
    setEditingReelId(reelId);
    setAddReelInitialKind(null);
    setAddReelModalOpen(true);
  }, []);
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
    refreshReels,
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
