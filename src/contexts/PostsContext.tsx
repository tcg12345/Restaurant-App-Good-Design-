import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { useSignInModal } from './SignInModalContext';
import { supabaseConfigured } from '../lib/supabase';
import {
  listPosts,
  createPost as cloudCreatePost,
  updatePost as cloudUpdatePost,
  updatePostItems as cloudUpdatePostItems,
  setPostLike as cloudSetPostLike,
  setPostSave as cloudSetPostSave,
  setPostVisibility as cloudSetPostVisibility,
  deletePost as cloudDeletePost,
  listPostComments as cloudListPostComments,
  addPostComment as cloudAddPostComment,
  deletePostComment as cloudDeletePostComment,
  readVideoDuration,
  POST_MAX_ITEMS,
  POST_VIDEO_MAX_DURATION_SECONDS,
  type PostRow,
  type PostItemRow,
  type PostMediaType,
  type PostAttachedKind,
  type PostRestaurantSnapshot,
  type PostRecipeSnapshot,
  type PostComment,
  type NewPostItem,
  type PostUpdate,
  type PostItemUpdate,
} from '../lib/supabase-posts';

export type {
  PostRow,
  PostItemRow,
  PostMediaType,
  PostAttachedKind,
  PostRestaurantSnapshot,
  PostRecipeSnapshot,
  PostComment,
  NewPostItem,
};
export { POST_MAX_ITEMS, POST_VIDEO_MAX_DURATION_SECONDS, readVideoDuration };

/* ── UI-shape Post type — mirrors PostRow but with a derived author display. */

export interface Post extends PostRow {
  /** True if the post has at least one restaurant attachment (used for tab filtering). */
  hasRestaurant: boolean;
  /** True if the post has at least one recipe attachment. */
  hasRecipe: boolean;
}

function decoratePost(row: PostRow): Post {
  let hasR = false, hasRec = false;
  for (const it of row.items) {
    if (it.attachedKind === 'restaurant') hasR = true;
    else if (it.attachedKind === 'recipe') hasRec = true;
  }
  return { ...row, hasRestaurant: hasR, hasRecipe: hasRec };
}

interface PostsContextValue {
  posts: Post[];
  loading: boolean;
  /** True when the last feed fetch failed (offline / Supabase error) —
   * lets the page render "couldn't load" + retry instead of a false
   * "nothing here yet" empty state. */
  loadError: boolean;
  refreshPosts: () => Promise<void>;

  createPost: (input: {
    caption: string;
    locationLabel: string;
    audioLabel: string;
    isPublic: boolean;
    items: NewPostItem[];
    onProgress?: (n: number) => void;
  }) => Promise<Post | null>;

  togglePostLike: (postId: string) => Promise<void>;
  togglePostSave: (postId: string) => Promise<void>;
  setPostVisibility: (postId: string, isPublic: boolean) => Promise<boolean>;
  /** Update post-level fields (caption / location / audio) and a batch of
   *  per-item edits (caption / attachment) in one call. */
  updatePost: (postId: string, postUpdates: PostUpdate, itemUpdates: PostItemUpdate[]) => Promise<boolean>;
  deletePost: (postId: string) => Promise<boolean>;

  /** Resolves to null when the fetch failed (vs [] for "no comments"). */
  loadPostComments: (postId: string) => Promise<PostComment[] | null>;
  addPostComment: (postId: string, body: string) => Promise<PostComment | null>;
  deletePostComment: (postId: string, commentId: string) => Promise<boolean>;

  // Modal state
  addPostModalOpen: boolean;
  /** When set, the modal is in edit mode against this post's id. */
  editingPostId: string | null;
  openAddPostModal: () => void;
  openEditPostModal: (postId: string) => void;
  closeAddPostModal: () => void;

  // Comments-sheet state (post)
  openPostCommentsId: string | null;
  openPostCommentsSheet: (postId: string) => void;
  closePostCommentsSheet: () => void;

  // ── Scroll restoration ──
  // Persists the most recently active post in the feed and the active
  // sub-item index *within* each post, so navigating away (e.g. tapping
  // a featured card → back) returns the user to the exact slide they
  // were on. Lives at the provider level so it survives the Reels
  // page's unmount/remount across React Router transitions.
  /** Last post id the viewer was on in the feed; null when the active
   *  feed item was a reel (or before any scrolling). */
  lastActivePostId: string | null;
  setLastActivePostId: (postId: string | null) => void;
  /** Read / write the active sub-item index for a post id. */
  getPostItemIndex: (postId: string) => number;
  setPostItemIndex: (postId: string, idx: number) => void;

  currentUserId: string | null;
}

const PostsContext = createContext<PostsContextValue | null>(null);

export const PostsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { requireSignIn } = useSignInModal();
  const userId = user?.id ?? null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [addPostModalOpen, setAddPostModalOpen] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [openPostCommentsId, setOpenPostCommentsId] = useState<string | null>(null);

  // Scroll-restoration state — kept in a ref since it's read on mount of
  // <PostSlide> via useLayoutEffect; we don't need state-driven re-renders.
  const [lastActivePostId, setLastActivePostId] = useState<string | null>(null);
  const postItemIdxRef = useRef<Record<string, number>>({});
  const getPostItemIndex = useCallback((postId: string): number => {
    return postItemIdxRef.current[postId] ?? 0;
  }, []);
  const setPostItemIndex = useCallback((postId: string, idx: number) => {
    postItemIdxRef.current[postId] = idx;
  }, []);

  const refreshPosts = useCallback(async () => {
    if (!supabaseConfigured) return;
    setLoading(true);
    try {
      const rows = await listPosts({ viewerId: userIdRef.current, limit: 100 });
      if (rows) {
        setPosts(rows.map(decoratePost));
        setLoadError(false);
      } else {
        setLoadError(true);
      }
    } catch (err) {
      console.warn('[Posts] refresh failed:', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshPosts();
  }, [userId, refreshPosts]);

  const createPost = useCallback<PostsContextValue['createPost']>(async (input) => {
    const me = userIdRef.current;
    if (!me) throw new Error('Sign in to post');
    const created = await cloudCreatePost({ userId: me, ...input });
    if (!created) return null;
    const ui = decoratePost(created);
    setPosts((prev) => [ui, ...prev]);
    return ui;
  }, []);

  const togglePostLike = useCallback(async (postId: string) => {
    const me = userIdRef.current;
    if (!me) { requireSignIn('Sign in to like'); return; }
    let nextLiked: boolean | null = null;
    setPosts((prev) => prev.map((p) => {
      if (p.id !== postId) return p;
      nextLiked = !p.liked;
      return { ...p, liked: nextLiked, likesCount: p.likesCount + (nextLiked ? 1 : -1) };
    }));
    if (nextLiked == null) return;
    const ok = await cloudSetPostLike(postId, me, nextLiked);
    if (!ok) {
      setPosts((prev) => prev.map((p) => {
        if (p.id !== postId) return p;
        return { ...p, liked: !nextLiked, likesCount: p.likesCount + (nextLiked ? -1 : 1) };
      }));
    }
  }, []);

  const togglePostSave = useCallback(async (postId: string) => {
    const me = userIdRef.current;
    if (!me) { requireSignIn('Sign in to save'); return; }
    let nextSaved: boolean | null = null;
    setPosts((prev) => prev.map((p) => {
      if (p.id !== postId) return p;
      nextSaved = !p.saved;
      return { ...p, saved: nextSaved, savesCount: p.savesCount + (nextSaved ? 1 : -1) };
    }));
    if (nextSaved == null) return;
    const ok = await cloudSetPostSave(postId, me, nextSaved);
    if (!ok) {
      setPosts((prev) => prev.map((p) => {
        if (p.id !== postId) return p;
        return { ...p, saved: !nextSaved, savesCount: p.savesCount + (nextSaved ? -1 : 1) };
      }));
    }
  }, []);

  const setPostVisibility = useCallback(async (postId: string, isPublic: boolean) => {
    let prevValue: boolean | null = null;
    setPosts((prev) => prev.map((p) => {
      if (p.id !== postId) return p;
      prevValue = p.isPublic;
      return { ...p, isPublic };
    }));
    const ok = await cloudSetPostVisibility(postId, isPublic);
    if (!ok && prevValue != null) {
      setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, isPublic: prevValue! } : p));
    }
    return ok;
  }, []);

  const updatePost = useCallback(async (
    postId: string,
    postUpdates: PostUpdate,
    itemUpdates: PostItemUpdate[],
  ): Promise<boolean> => {
    const [postOk, itemsOk] = await Promise.all([
      cloudUpdatePost(postId, postUpdates),
      cloudUpdatePostItems(itemUpdates),
    ]);
    if (!postOk || !itemsOk) return false;
    // Reflect the patch in local state so the feed updates without a refetch.
    setPosts((prev) => prev.map((p) => {
      if (p.id !== postId) return p;
      const next = { ...p };
      if (postUpdates.caption !== undefined) next.caption = postUpdates.caption;
      if (postUpdates.locationLabel !== undefined) next.locationLabel = postUpdates.locationLabel;
      if (postUpdates.audioLabel !== undefined) next.audioLabel = postUpdates.audioLabel;
      if (itemUpdates.length > 0) {
        const byId = new Map(itemUpdates.map((u) => [u.itemId, u]));
        next.items = p.items.map((it) => {
          const u = byId.get(it.id);
          if (!u) return it;
          const merged = { ...it };
          if (u.caption !== undefined) merged.caption = u.caption;
          if (u.attachedKind !== undefined) merged.attachedKind = u.attachedKind;
          if (u.restaurant !== undefined) merged.restaurant = u.restaurant;
          if (u.recipe !== undefined) merged.recipe = u.recipe;
          return merged;
        });
        // Re-derive hasRestaurant / hasRecipe flags so tab filters stay correct.
        let hasR = false, hasRec = false;
        for (const it of next.items) {
          if (it.attachedKind === 'restaurant') hasR = true;
          else if (it.attachedKind === 'recipe') hasRec = true;
        }
        next.hasRestaurant = hasR;
        next.hasRecipe = hasRec;
      }
      return next;
    }));
    return true;
  }, []);

  const deletePost = useCallback(async (postId: string) => {
    const ok = await cloudDeletePost(postId);
    if (ok) setPosts((prev) => prev.filter((p) => p.id !== postId));
    return ok;
  }, []);

  const loadPostComments = useCallback(async (postId: string): Promise<PostComment[] | null> => {
    return cloudListPostComments(postId);
  }, []);

  const addPostComment = useCallback(async (postId: string, body: string): Promise<PostComment | null> => {
    const me = userIdRef.current;
    if (!me) return null;
    const c = await cloudAddPostComment(postId, me, body);
    if (c) {
      setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, commentsCount: p.commentsCount + 1 } : p));
    }
    return c;
  }, []);

  const deletePostComment = useCallback(async (postId: string, commentId: string): Promise<boolean> => {
    const ok = await cloudDeletePostComment(commentId);
    if (ok) {
      setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, commentsCount: Math.max(0, p.commentsCount - 1) } : p));
    }
    return ok;
  }, []);

  const openAddPostModal = useCallback(() => {
    if (!userIdRef.current) { requireSignIn('Sign in to post'); return; }
    setEditingPostId(null);
    setAddPostModalOpen(true);
  }, [requireSignIn]);
  const openEditPostModal = useCallback((postId: string) => {
    setEditingPostId(postId);
    setAddPostModalOpen(true);
  }, []);
  const closeAddPostModal = useCallback(() => {
    setAddPostModalOpen(false);
    setEditingPostId(null);
  }, []);
  const openPostCommentsSheet = useCallback((postId: string) => setOpenPostCommentsId(postId), []);
  const closePostCommentsSheet = useCallback(() => setOpenPostCommentsId(null), []);

  const value: PostsContextValue = {
    posts,
    loading,
    loadError,
    refreshPosts,
    createPost,
    togglePostLike,
    togglePostSave,
    setPostVisibility,
    updatePost,
    deletePost,
    loadPostComments,
    addPostComment,
    deletePostComment,
    addPostModalOpen,
    editingPostId,
    openAddPostModal,
    openEditPostModal,
    closeAddPostModal,
    openPostCommentsId,
    openPostCommentsSheet,
    closePostCommentsSheet,
    lastActivePostId,
    setLastActivePostId,
    getPostItemIndex,
    setPostItemIndex,
    currentUserId: userId,
  };

  return <PostsContext.Provider value={value}>{children}</PostsContext.Provider>;
};

export function usePosts(): PostsContextValue {
  const ctx = useContext(PostsContext);
  if (!ctx) throw new Error('usePosts must be used within PostsProvider');
  return ctx;
}
