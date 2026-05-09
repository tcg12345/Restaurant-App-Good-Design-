import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { supabaseConfigured } from '../lib/supabase';
import {
  listPosts,
  createPost as cloudCreatePost,
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
  deletePost: (postId: string) => Promise<boolean>;

  loadPostComments: (postId: string) => Promise<PostComment[]>;
  addPostComment: (postId: string, body: string) => Promise<PostComment | null>;
  deletePostComment: (postId: string, commentId: string) => Promise<boolean>;

  // Modal state
  addPostModalOpen: boolean;
  openAddPostModal: () => void;
  closeAddPostModal: () => void;

  // Comments-sheet state (post)
  openPostCommentsId: string | null;
  openPostCommentsSheet: (postId: string) => void;
  closePostCommentsSheet: () => void;

  currentUserId: string | null;
}

const PostsContext = createContext<PostsContextValue | null>(null);

export const PostsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [addPostModalOpen, setAddPostModalOpen] = useState(false);
  const [openPostCommentsId, setOpenPostCommentsId] = useState<string | null>(null);

  const refreshPosts = useCallback(async () => {
    if (!supabaseConfigured) return;
    setLoading(true);
    const rows = await listPosts({ viewerId: userIdRef.current, limit: 100 });
    setPosts(rows.map(decoratePost));
    setLoading(false);
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
    if (!me) return;
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
    if (!me) return;
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

  const deletePost = useCallback(async (postId: string) => {
    const ok = await cloudDeletePost(postId);
    if (ok) setPosts((prev) => prev.filter((p) => p.id !== postId));
    return ok;
  }, []);

  const loadPostComments = useCallback(async (postId: string): Promise<PostComment[]> => {
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

  const openAddPostModal = useCallback(() => setAddPostModalOpen(true), []);
  const closeAddPostModal = useCallback(() => setAddPostModalOpen(false), []);
  const openPostCommentsSheet = useCallback((postId: string) => setOpenPostCommentsId(postId), []);
  const closePostCommentsSheet = useCallback(() => setOpenPostCommentsId(null), []);

  const value: PostsContextValue = {
    posts,
    loading,
    refreshPosts,
    createPost,
    togglePostLike,
    togglePostSave,
    setPostVisibility,
    deletePost,
    loadPostComments,
    addPostComment,
    deletePostComment,
    addPostModalOpen,
    openAddPostModal,
    closeAddPostModal,
    openPostCommentsId,
    openPostCommentsSheet,
    closePostCommentsSheet,
    currentUserId: userId,
  };

  return <PostsContext.Provider value={value}>{children}</PostsContext.Provider>;
};

export function usePosts(): PostsContextValue {
  const ctx = useContext(PostsContext);
  if (!ctx) throw new Error('usePosts must be used within PostsProvider');
  return ctx;
}
