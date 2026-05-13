import React, { useState, useEffect, useCallback } from 'react';
import { Heart, MessageSquare, Send, ChefHat, UtensilsCrossed, Plus, Star, ChevronDown, BookOpen, Share2 } from 'lucide-react';
import { ShareRecipeSheet } from './ShareRecipeSheet';
import type { SharedRecipe } from '../contexts/ChatContext';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { ScoreBadge } from './ScoreBadge';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useLists } from '../contexts/ListsContext';
import {
  getFriends, getFriendActivity, getProfilesByIds, getLikesForRatings,
  getCommentCounts, toggleLike, addComment, getComments,
  getFriendsPublicHomeMeals,
  type CommunityRating, type UserProfile, type ActivityComment, type FriendHomeMeal,
} from '../lib/supabase-community';
import { getMealCoverUrl } from '../lib/recipe-display';
import { getReviewSummariesBatch } from '../lib/supabase-home-meal-reviews';
import { EmptyState } from './EmptyState';

// Palette used to tint user avatar initials deterministically per user.
const AVATAR_PALETTE = [
  { bg: 'bg-rose-100', text: 'text-rose-700' },
  { bg: 'bg-amber-100', text: 'text-amber-700' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  { bg: 'bg-sky-100', text: 'text-sky-700' },
  { bg: 'bg-violet-100', text: 'text-violet-700' },
  { bg: 'bg-teal-100', text: 'text-teal-700' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700' },
];
const avatarColor = (uid: string) => {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
};
const initialOf = (name: string) => (name || 'U').trim().charAt(0).toUpperCase() || 'U';

type FeedItem =
  | { type: 'rating'; data: CommunityRating; sortTime: number }
  | { type: 'homeMeal'; data: FriendHomeMeal; sortTime: number };

// Great-circle distance between two coords in kilometres (Haversine). Used to
// sort the Friend Activity feed so ratings near the home-page location anchor
// float to the top.
const haversineKm = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};

interface SocialFeedProps {
  /** Distance-sort anchor. When set, friend activity sorts by proximity. */
  centerLat?: number | null;
  centerLng?: number | null;
}

export const SocialFeed: React.FC<SocialFeedProps> = ({ centerLat = null, centerLng = null }) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const navigate = useNavigate();
  const { phoneMode } = useSettings();
  const { openAddRestaurantModal, toggleWishlist, isWishlisted } = useLists();

  const [activity, setActivity] = useState<CommunityRating[]>([]);
  const [homeMeals, setHomeMeals] = useState<FriendHomeMeal[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [likes, setLikes] = useState<Record<string, number>>({});
  const [userLiked, setUserLiked] = useState<Set<string>>(new Set());
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [mealRatingSummaries, setMealRatingSummaries] = useState<Record<string, { average: number; count: number }>>({});
  const [shareRecipeData, setShareRecipeData] = useState<SharedRecipe | null>(null);
  const [loading, setLoading] = useState(true);

  const [openComments, setOpenComments] = useState<string | null>(null);
  const [comments, setComments] = useState<ActivityComment[]>([]);
  const [commentProfiles, setCommentProfiles] = useState<Record<string, UserProfile>>({});
  const [newComment, setNewComment] = useState('');
  const [commentsLoading, setCommentsLoading] = useState(false);
  // Always navigate to the full recipe page — the phone-optimized layout
  // handles the narrow viewport, so we no longer need the bottom-sheet modal.
  const openFriendRecipe = useCallback((m: FriendHomeMeal) => {
    navigate(`/meal/${m.userId}/${m.id}`);
  }, [navigate]);

  const buildSharedRecipe = useCallback((m: FriendHomeMeal): SharedRecipe => {
    const author = profiles[m.userId];
    return {
      mealId: m.id,
      authorId: m.userId,
      authorName: author?.display_name || author?.username || 'A friend',
      name: m.name,
      image: getMealCoverUrl(m),
      description: m.description || undefined,
      tags: m.tags.length > 0 ? m.tags : undefined,
      totalTime: ((m.prepTime ?? 0) + (m.cookTime ?? 0)) || undefined,
      difficulty: m.difficulty || undefined,
      ingredientCount: m.ingredients?.length || undefined,
      stepCount: m.steps?.length || undefined,
    };
  }, [profiles]);

  const loadFeed = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    const friends = await getFriends(userId);
    if (friends.length === 0) { setLoading(false); return; }

    const friendIds = friends.map((f) => f.friend_id);
    const [act, meals] = await Promise.all([
      getFriendActivity(friendIds, 500),
      getFriendsPublicHomeMeals(friendIds),
    ]);
    setActivity(act);
    setHomeMeals(meals);

    // Collect all user IDs from both sources
    const allUserIds = new Set<string>();
    act.forEach((a) => allUserIds.add(a.user_id));
    meals.forEach((m) => allUserIds.add(m.userId));

    if (allUserIds.size > 0) {
      const ratingIds = act.map((a) => a.id).filter(Boolean);
      const [profs, likesData, ccounts] = await Promise.all([
        getProfilesByIds([...allUserIds]),
        ratingIds.length > 0 ? getLikesForRatings(userId, ratingIds) : Promise.resolve({ likes: {} as Record<string, number>, userLiked: new Set<string>() }),
        ratingIds.length > 0 ? getCommentCounts(ratingIds) : Promise.resolve({} as Record<string, number>),
      ]);
      setProfiles(profs);
      setLikes(likesData.likes);
      setUserLiked(likesData.userLiked);
      setCommentCounts(ccounts);
    }
    // Batch-fetch community rating summaries for all home meals so cards
    // can show the 5-star average instead of the author's self-rating.
    // Scan the viewer's friends' meta (plus self) so reviews persisted via
    // the ListsContext fallback are included in the averages.
    if (meals.length > 0) {
      const scanIds = [userId, ...friendIds];
      getReviewSummariesBatch(meals.map((m) => m.id), scanIds)
        .then(setMealRatingSummaries)
        .catch(() => {});
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  // Merge and sort feed items. When a location anchor is provided, sort so
  // ratings nearest that anchor come first (then fall back to recency). Home
  // meals don't have a location so they always sort by time.
  const hasAnchor = centerLat != null && centerLng != null;
  const distanceFor = (r: CommunityRating): number => {
    if (!hasAnchor || r.lat == null || r.lng == null) return Infinity;
    if (Math.abs(r.lat) < 1 && Math.abs(r.lng) < 1) return Infinity;
    return haversineKm(centerLat!, centerLng!, r.lat, r.lng);
  };
  const feedItems: FeedItem[] = [
    ...activity.map((r): FeedItem => ({
      type: 'rating', data: r,
      sortTime: r.created_at ? new Date(r.created_at).getTime() : 0,
    })),
    ...homeMeals.map((m): FeedItem => ({
      type: 'homeMeal', data: m,
      sortTime: m.createdAt,
    })),
  ].sort((a, b) => {
    if (hasAnchor) {
      const da = a.type === 'rating' ? distanceFor(a.data) : Infinity;
      const db = b.type === 'rating' ? distanceFor(b.data) : Infinity;
      if (da !== db) return da - db;
    }
    return b.sortTime - a.sortTime;
  });

  const handleLike = async (ratingId: string) => {
    if (!userId || !ratingId) return;
    const wasLiked = userLiked.has(ratingId);
    setUserLiked((prev) => { const next = new Set(prev); wasLiked ? next.delete(ratingId) : next.add(ratingId); return next; });
    setLikes((prev) => ({ ...prev, [ratingId]: Math.max(0, (prev[ratingId] || 0) + (wasLiked ? -1 : 1)) }));
    await toggleLike(userId, ratingId);
  };

  const handleOpenComments = async (ratingId: string) => {
    if (openComments === ratingId) { setOpenComments(null); return; }
    setOpenComments(ratingId);
    setCommentsLoading(true);
    setNewComment('');
    const cmts = await getComments(ratingId);
    setComments(cmts);
    if (cmts.length > 0) {
      const ids = [...new Set(cmts.map((c) => c.user_id))];
      const profs = await getProfilesByIds(ids);
      setCommentProfiles(profs);
    }
    setCommentsLoading(false);
  };

  const handleAddComment = async (ratingId: string) => {
    if (!userId || !newComment.trim()) return;
    const ok = await addComment(userId, ratingId, newComment.trim());
    if (ok) {
      setNewComment('');
      setCommentCounts((prev) => ({ ...prev, [ratingId]: (prev[ratingId] || 0) + 1 }));
      const cmts = await getComments(ratingId);
      setComments(cmts);
      const ids = [...new Set(cmts.map((c) => c.user_id))];
      setCommentProfiles(await getProfilesByIds(ids));
    }
  };

  const getName = (uid: string) => profiles[uid]?.display_name || 'User';
  const getUsername = (uid: string) => profiles[uid]?.username || '';
  const timeAgo = (date: string) => {
    if (!date) return '';
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? '' : 's'} ago`;
  };

  type FeedMode = 'friends' | 'experts' | 'recipes';
  const FEED_OPTIONS: { value: FeedMode; label: string; icon: React.ReactNode }[] = [
    { value: 'friends', label: 'Friend Activity', icon: <Heart size={12} /> },
    { value: 'experts', label: 'Expert Picks', icon: <Star size={12} className="fill-amber-500 text-amber-500" /> },
    { value: 'recipes', label: 'Recipes', icon: <BookOpen size={12} /> },
  ];
  const [feedMode, setFeedMode] = useState<FeedMode>('friends');
  const [feedDropdownOpen, setFeedDropdownOpen] = useState(false);
  const feedDropdownRef = React.useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!feedDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (feedDropdownRef.current && !feedDropdownRef.current.contains(e.target as Node)) setFeedDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [feedDropdownOpen]);

  const currentOption = FEED_OPTIONS.find((o) => o.value === feedMode)!;

  const SectionHeader: React.FC<{ count?: number }> = ({ count }) => (
    <div className="flex items-center gap-3 mb-2">
      <div className="relative" ref={feedDropdownRef}>
        <button
          onClick={() => setFeedDropdownOpen((p) => !p)}
          className="flex items-center gap-1.5 -ml-1 px-1 py-0.5 transition-colors hover:text-primary"
        >
          <span className="text-[22px] font-bold font-serif">{currentOption.label}</span>
          <ChevronDown size={16} className={cn("text-on-surface/40 transition-transform", feedDropdownOpen && "rotate-180")} />
        </button>
        <AnimatePresence>
          {feedDropdownOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full left-0 mt-1.5 z-50 bg-white rounded-xl shadow-lg border border-on-surface/10 overflow-hidden min-w-[180px]"
            >
              {FEED_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setFeedMode(opt.value); setFeedDropdownOpen(false); }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-sm font-medium transition-colors",
                    feedMode === opt.value
                      ? "bg-primary/5 text-primary font-semibold"
                      : "text-on-surface/70 hover:bg-on-surface/[0.03]"
                  )}
                >
                  <span className="flex-shrink-0">{opt.icon}</span>
                  {opt.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {feedMode === 'friends' && (
        <>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          {typeof count === 'number' && count > 0 && (
            <span className="text-[11px] font-bold uppercase tracking-widest text-on-surface/40 bg-on-surface/5 px-2 py-0.5 rounded-full">
              {count}
            </span>
          )}
        </>
      )}
    </div>
  );

  if (loading) {
    return (
      <section className="mb-8">
        <SectionHeader />
        <ul className={cn(
          'divide-y divide-on-surface/[0.06]',
          !phoneMode && 'xl:grid xl:grid-cols-2 xl:gap-x-10 xl:gap-y-0 xl:divide-y-0',
        )}>
          {[0, 1, 2].map((i) => (
            <li key={i} className={cn('py-5', !phoneMode && 'xl:border-b xl:border-on-surface/[0.06]')}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-on-surface/[0.05] animate-pulse" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-2.5 w-24 rounded-full bg-on-surface/[0.05] animate-pulse" />
                  <div className="h-2 w-16 rounded-full bg-on-surface/[0.05] animate-pulse" />
                </div>
              </div>
              <div className="w-full max-w-md aspect-[16/10] rounded-lg bg-on-surface/[0.05] animate-pulse mb-3" />
              <div className="space-y-2">
                <div className="h-3 w-3/4 rounded-full bg-on-surface/[0.05] animate-pulse" />
                <div className="h-2.5 w-1/2 rounded-full bg-on-surface/[0.05] animate-pulse" />
              </div>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  if (feedItems.length === 0 && feedMode === 'friends') return null;

  // Recipes-only mode uses its own list rendered from homeMeals.
  const recipesSorted = [...homeMeals].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <section className="mb-8">
      <SectionHeader count={feedMode === 'recipes' ? recipesSorted.length : feedItems.length} />
      {feedMode === 'experts' ? (
        <EmptyState
          icon={<Star size={48} className="fill-amber-400 text-amber-400" />}
          heading="Expert Picks"
          description="Coming soon."
        />
      ) : feedMode === 'recipes' ? (
        recipesSorted.length === 0 ? (
          <EmptyState
            icon={<ChefHat size={48} />}
            heading="No recipes yet"
            description="When your friends publish a recipe, it will show up here so you can try it and leave a rating."
          />
        ) : (
          <ul className={cn(
            'divide-y divide-on-surface/[0.06]',
            !phoneMode && 'xl:grid xl:grid-cols-2 xl:gap-x-10 xl:gap-y-0 xl:divide-y-0',
          )}>
            {recipesSorted.map((m) => {
              const mealTimeAgo = timeAgo(new Date(m.createdAt).toISOString());
              const summary = mealRatingSummaries[m.id];
              return (
                <li key={`recipe-${m.userId}-${m.id}`} className={cn('py-5', !phoneMode && 'xl:border-b xl:border-on-surface/[0.06]')}>
                  <div className={cn("flex gap-3", !phoneMode && "md:gap-4")}>
                    {/* Cover thumbnail — on the side */}
                    <button
                      type="button"
                      onClick={() => openFriendRecipe(m)}
                      className={cn(
                        "flex-shrink-0 rounded-xl overflow-hidden bg-on-surface/[0.05] group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                        phoneMode ? "w-24 h-24" : "w-[100px] h-[100px] md:w-[140px] md:h-[140px]",
                      )}
                      aria-label={`View ${m.name}`}
                    >
                      {getMealCoverUrl(m) ? (
                        <img src={getMealCoverUrl(m)} alt={m.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ChefHat size={28} className="text-emerald-400" />
                        </div>
                      )}
                    </button>

                    {/* Content stack */}
                    <div className="flex-1 min-w-0 flex flex-col">
                      {/* User header */}
                      <div className="flex items-center gap-2 mb-2">
                        <Link to={`/user/${getUsername(m.userId)}`} className="flex-shrink-0">
                          <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center">
                            <ChefHat size={12} className="text-emerald-600" />
                          </div>
                        </Link>
                        <div className="flex-1 min-w-0">
                          <Link to={`/user/${getUsername(m.userId)}`} className="text-[12px] font-bold hover:text-primary block truncate leading-tight">{getName(m.userId)}</Link>
                          <p className="text-[10px] text-emerald-700/80 font-bold uppercase tracking-wider leading-tight mt-0.5">Cooked at home · {mealTimeAgo}</p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); setShareRecipeData(buildSharedRecipe(m)); }}
                          className="text-on-surface/35 hover:text-emerald-600 transition-colors p-1 flex-shrink-0"
                          aria-label="Share recipe"
                        >
                          <Share2 size={14} />
                        </button>
                      </div>

                      {/* Tappable meal info */}
                      <button
                        type="button"
                        onClick={() => openFriendRecipe(m)}
                        className="block text-left group focus-visible:outline-none"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-serif font-bold text-[16px] sm:text-[17px] leading-tight flex-1 min-w-0 line-clamp-2 group-hover:text-primary transition-colors">{m.name}</h3>
                          {summary && summary.count > 0 && (
                            <div className="flex-shrink-0 flex flex-col items-end gap-0.5 pt-0.5">
                              <div className="flex gap-0.5">
                                {[1, 2, 3, 4, 5].map((n) => (
                                  <Star key={n} size={12} className={cn(
                                    n <= Math.round(summary.average) ? "text-amber-500 fill-amber-500" : "text-on-surface/15",
                                  )} />
                                ))}
                              </div>
                              <span className="text-sm text-on-surface/50 font-bold tabular-nums">{summary.average.toFixed(1)}</span>
                            </div>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] text-on-surface/50 font-medium uppercase tracking-wider truncate">
                          {new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          {m.dishes.length > 0 && <><span className="text-on-surface/25 mx-1.5">·</span>{m.dishes.length} dish{m.dishes.length !== 1 ? 'es' : ''}</>}
                        </p>
                        {m.tags.length > 0 && (
                          <div className="flex gap-1.5 mt-1.5 flex-wrap">
                            {m.tags.slice(0, 3).map((t) => (
                              <span key={t} className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700/80">{t}</span>
                            ))}
                          </div>
                        )}
                        {m.description && (
                          <p className="mt-2 text-[13px] text-on-surface/60 italic leading-relaxed line-clamp-3">
                            &ldquo;{m.description}&rdquo;
                          </p>
                        )}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : (
      <ul className={cn(
        'divide-y divide-on-surface/10',
        !phoneMode && 'xl:grid xl:grid-cols-2 xl:gap-x-10 xl:gap-y-0 xl:divide-y-0',
      )}>
        {feedItems.map((item) => {
          if (item.type === 'homeMeal') {
            const m = item.data;
            const mealTimeAgo = timeAgo(new Date(m.createdAt).toISOString());
            const summary = mealRatingSummaries[m.id];
            return (
              <li key={`meal-${m.id}`} className={cn('py-5', !phoneMode && 'xl:border-b xl:border-on-surface/[0.06]')}>
                <div className={cn("flex gap-3", !phoneMode && "md:gap-4")}>
                  {/* Cover thumbnail — on the side */}
                  <button
                    type="button"
                    onClick={() => openFriendRecipe(m)}
                    className={cn(
                      "flex-shrink-0 rounded-xl overflow-hidden bg-on-surface/[0.05] group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      phoneMode ? "w-24 h-24" : "w-[100px] h-[100px] md:w-[140px] md:h-[140px]",
                    )}
                    aria-label={`View ${m.name}`}
                  >
                    {getMealCoverUrl(m) ? (
                      <img src={getMealCoverUrl(m)} alt={m.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ChefHat size={28} className="text-emerald-400" />
                      </div>
                    )}
                  </button>

                  {/* Content stack */}
                  <div className="flex-1 min-w-0 flex flex-col">
                    {/* User header */}
                    <div className="flex items-center gap-2 mb-2">
                      <Link to={`/user/${getUsername(m.userId)}`} className="flex-shrink-0">
                        <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center">
                          <ChefHat size={12} className="text-emerald-600" />
                        </div>
                      </Link>
                      <div className="flex-1 min-w-0">
                        <Link to={`/user/${getUsername(m.userId)}`} className="text-[12px] font-bold hover:text-primary block truncate leading-tight">{getName(m.userId)}</Link>
                        <p className="text-[10px] text-emerald-700/80 font-bold uppercase tracking-wider leading-tight mt-0.5">Cooked at home · {mealTimeAgo}</p>
                      </div>
                    </div>

                    {/* Tappable meal info */}
                    <button
                      type="button"
                      onClick={() => openFriendRecipe(m)}
                      className="block text-left group focus-visible:outline-none"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-serif font-bold text-[16px] sm:text-[17px] leading-tight flex-1 min-w-0 line-clamp-2 group-hover:text-primary transition-colors">{m.name}</h3>
                        {summary && summary.count > 0 && (
                          <div className="flex-shrink-0 flex flex-col items-end gap-0.5 pt-0.5">
                            <div className="flex gap-0.5">
                              {[1, 2, 3, 4, 5].map((n) => (
                                <Star key={n} size={12} className={cn(
                                  n <= Math.round(summary.average) ? "text-amber-500 fill-amber-500" : "text-on-surface/15",
                                )} />
                              ))}
                            </div>
                            <span className="text-sm text-on-surface/50 font-bold tabular-nums">{summary.average.toFixed(1)}</span>
                          </div>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-on-surface/50 font-medium uppercase tracking-wider truncate">
                        {new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {m.dishes.length > 0 && <><span className="text-on-surface/25 mx-1.5">·</span>{m.dishes.length} dish{m.dishes.length !== 1 ? 'es' : ''}</>}
                      </p>
                      {m.tags.length > 0 && (
                        <div className="flex gap-1.5 mt-1.5 flex-wrap">
                          {m.tags.slice(0, 3).map((t) => (
                            <span key={t} className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700/80">{t}</span>
                          ))}
                        </div>
                      )}
                      {m.description && (
                        <p className="mt-2 text-[13px] text-on-surface/60 italic leading-relaxed line-clamp-3">
                          &ldquo;{m.description}&rdquo;
                        </p>
                      )}
                    </button>
                  </div>
                </div>
              </li>
            );
          }

          // Restaurant rating card
          const r = item.data as CommunityRating;
          const color = avatarColor(r.user_id);
          const initial = initialOf(getName(r.user_id));
          const wishlisted = isWishlisted(r.restaurant_id);
          const meta = {
            id: r.restaurant_id,
            name: r.restaurant_name,
            image: r.photo_url || '',
            cuisine: r.cuisine || '',
            price: r.price || '',
            address: r.address || '',
          };
          return (
          <li key={r.id} className={cn('py-5', !phoneMode && 'xl:border-b xl:border-on-surface/[0.06]')}>
            {/* Photo + content — no box, full width */}
            <div className={cn("flex", !phoneMode && "md:gap-4")}>
              {/* Photo thumbnail — desktop only (hidden in phone mode) */}
              {!phoneMode && (
                <button
                  type="button"
                  onClick={() => navigate(`/restaurant/${r.restaurant_id}`)}
                  className="hidden md:block flex-shrink-0 w-[140px] aspect-square rounded-xl overflow-hidden bg-on-surface/[0.05] group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  aria-label={`View ${r.restaurant_name}`}
                >
                  {r.photo_url ? (
                    <img src={r.photo_url} alt={r.restaurant_name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center font-serif text-3xl font-bold text-on-surface/20">
                      {initialOf(r.restaurant_name)}
                    </div>
                  )}
                </button>
              )}

              {/* Content stack */}
              <div className="flex-1 min-w-0 flex flex-col">
                {/* Reviewer header */}
                <div className="flex items-center gap-2 mb-2">
                  <Link to={`/user/${getUsername(r.user_id)}`} className="flex-shrink-0">
                    <div className={cn("w-7 h-7 rounded-full flex items-center justify-center", color.bg)}>
                      <span className={cn("text-[11px] font-serif font-bold", color.text)}>{initial}</span>
                    </div>
                  </Link>
                  <div className="flex-1 min-w-0">
                    <Link to={`/user/${getUsername(r.user_id)}`} className="text-[12px] font-bold hover:text-primary block truncate leading-tight">
                      {getName(r.user_id)}
                    </Link>
                    <p className="text-[10px] text-on-surface/40 font-medium uppercase tracking-wider leading-tight mt-0.5">
                      {profiles[r.user_id]?.is_expert
                        ? <span className="inline-flex items-center gap-0.5 text-amber-600 font-bold"><Star size={9} className="fill-amber-500 text-amber-500" />Expert · {timeAgo(r.created_at)}</span>
                        : <>Rated · {timeAgo(r.created_at)}</>}
                    </p>
                  </div>
                </div>

                {/* Tappable restaurant info */}
                <button
                  type="button"
                  onClick={() => navigate(`/restaurant/${r.restaurant_id}`)}
                  className="block text-left group focus-visible:outline-none"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-serif font-bold text-[16px] sm:text-[17px] leading-tight flex-1 min-w-0 line-clamp-2 group-hover:text-primary transition-colors">
                      {r.restaurant_name}
                    </h3>
                    <ScoreBadge rating={Number(r.score)} size="md" />
                  </div>
                  <p className="mt-1 text-[11px] text-on-surface/50 font-medium uppercase tracking-wider truncate">
                    {r.cuisine}{r.price && <span className="text-on-surface/25 mx-1.5">·</span>}{r.price}
                  </p>
                  {r.tags && r.tags.length > 0 && (
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {r.tags.slice(0, 3).map((t) => (
                        <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-primary/8 text-primary/70 font-medium">{t}</span>
                      ))}
                    </div>
                  )}
                  {r.notes && (
                    <p className="mt-2 text-[13px] text-on-surface/60 italic leading-relaxed line-clamp-3">
                      &ldquo;{r.notes}&rdquo;
                    </p>
                  )}
                </button>
              </div>
            </div>

            {/* Actions row */}
            <div className="flex items-center gap-1 mt-3 -ml-2">
              <button
                onClick={() => handleLike(r.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 min-h-[44px] px-2 rounded-full transition-colors",
                  userLiked.has(r.id)
                    ? "text-red-500"
                    : "text-on-surface/50 hover:text-red-500 hover:bg-on-surface/[0.04]"
                )}
              >
                <Heart size={18} className={userLiked.has(r.id) ? 'fill-red-500' : ''} />
                <span className="text-[12px] font-bold">{likes[r.id] || 0}</span>
              </button>
              <button
                onClick={() => handleOpenComments(r.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 min-h-[44px] px-2 rounded-full transition-colors",
                  openComments === r.id
                    ? "text-primary"
                    : "text-on-surface/50 hover:text-primary hover:bg-on-surface/[0.04]"
                )}
              >
                <MessageSquare size={18} />
                <span className="text-[12px] font-bold">{commentCounts[r.id] || 0}</span>
              </button>
              <div className="flex-1" />
              <button
                onClick={(e) => { e.stopPropagation(); openAddRestaurantModal(meta); }}
                className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-full text-[12px] font-bold uppercase tracking-wider text-primary hover:bg-primary/5 transition-colors"
              >
                <Plus size={14} /> Rate
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); toggleWishlist(meta); }}
                className={cn(
                  "inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full transition-colors",
                  wishlisted
                    ? "text-red-500 hover:bg-red-500/5"
                    : "text-on-surface/50 hover:text-red-500 hover:bg-on-surface/[0.04]"
                )}
                aria-label={wishlisted ? "In wishlist" : "Add to wishlist"}
              >
                <Heart size={18} className={wishlisted ? 'fill-red-500' : ''} />
              </button>
            </div>

            {/* Comments */}
            <AnimatePresence>
              {openComments === r.id && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="mt-3 pt-3 border-t border-on-surface/[0.06] space-y-3">
                    {commentsLoading ? (
                      <div className="space-y-2 py-1">
                        <div className="animate-pulse bg-on-surface/[0.06] rounded h-3 w-4/5" />
                        <div className="animate-pulse bg-on-surface/[0.06] rounded h-3 w-3/5" />
                      </div>
                    ) : comments.length === 0 ? (
                      <p className="text-[12px] text-on-surface/40 py-1">No comments yet — be the first!</p>
                    ) : (
                      <div className="space-y-3 max-h-52 overflow-y-auto">
                        {comments.map((c) => {
                          const cColor = avatarColor(c.user_id);
                          const cInitial = initialOf(commentProfiles[c.user_id]?.display_name || 'User');
                          return (
                          <div key={c.id} className="flex gap-2.5">
                            <div className={cn("w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5", cColor.bg)}>
                              <span className={cn("text-[13px] font-serif font-bold", cColor.text)}>{cInitial}</span>
                            </div>
                            <div className="min-w-0">
                              <p className="text-[12px] leading-relaxed">
                                <Link to={`/user/${commentProfiles[c.user_id]?.username || ''}`} className="font-semibold text-on-surface/80 hover:text-primary">{commentProfiles[c.user_id]?.display_name || 'User'}</Link>{' '}
                                <span className="text-on-surface/60">{c.text}</span>
                              </p>
                              <p className="text-[12px] text-on-surface/35 mt-0.5">{timeAgo(c.created_at)}</p>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <input type="text" value={newComment} onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Write a comment..."
                        className="flex-1 bg-on-surface/5 rounded-full min-h-[44px] px-4 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/20"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddComment(r.id)} />
                      <button onClick={() => handleAddComment(r.id)} disabled={!newComment.trim()}
                        className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] text-primary disabled:text-on-surface/15 rounded-full hover:bg-primary/5 transition-colors"
                        aria-label="Post comment">
                        <Send size={18} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </li>
          );
        })}
      </ul>
      )}

      <ShareRecipeSheet
        open={!!shareRecipeData}
        recipe={shareRecipeData}
        onClose={() => setShareRecipeData(null)}
      />
    </section>
  );
};
