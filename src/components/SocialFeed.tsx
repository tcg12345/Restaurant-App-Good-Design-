import React, { useState, useEffect, useCallback } from 'react';
import { Heart, MessageSquare, Send, ChefHat, UtensilsCrossed, Plus, Eye, Star, ChevronDown, Sparkles, BookOpen, Clock, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import {
  getFriends, getFriendActivity, getProfilesByIds, getLikesForRatings,
  getCommentCounts, toggleLike, addComment, getComments,
  getFriendsPublicHomeMeals,
  type CommunityRating, type UserProfile, type ActivityComment, type FriendHomeMeal,
} from '../lib/supabase-community';
import { FriendRecipeModal } from './FriendRecipeModal';

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

export const SocialFeed: React.FC = () => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const navigate = useNavigate();
  const { openAddRestaurantModal, openWishlistModal, isWishlisted } = useLists();

  const [activity, setActivity] = useState<CommunityRating[]>([]);
  const [homeMeals, setHomeMeals] = useState<FriendHomeMeal[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [likes, setLikes] = useState<Record<string, number>>({});
  const [userLiked, setUserLiked] = useState<Set<string>>(new Set());
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [openComments, setOpenComments] = useState<string | null>(null);
  const [comments, setComments] = useState<ActivityComment[]>([]);
  const [commentProfiles, setCommentProfiles] = useState<Record<string, UserProfile>>({});
  const [newComment, setNewComment] = useState('');
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [activeFriendRecipe, setActiveFriendRecipe] = useState<FriendHomeMeal | null>(null);

  const loadFeed = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    const friends = await getFriends(userId);
    if (friends.length === 0) { setLoading(false); return; }

    const friendIds = friends.map((f) => f.friend_id);
    const [act, meals] = await Promise.all([
      getFriendActivity(friendIds, 15),
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
    setLoading(false);
  }, [userId]);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  // Merge and sort feed items by time
  const feedItems: FeedItem[] = [
    ...activity.map((r): FeedItem => ({
      type: 'rating', data: r,
      sortTime: r.created_at ? new Date(r.created_at).getTime() : 0,
    })),
    ...homeMeals.map((m): FeedItem => ({
      type: 'homeMeal', data: m,
      sortTime: m.createdAt,
    })),
  ].sort((a, b) => b.sortTime - a.sortTime);

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

  const scoreColor = (s: number) => s >= 8 ? 'text-green-600' : s >= 5 ? 'text-yellow-600' : 'text-red-500';
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
    <div className="flex items-center gap-3 mb-4">
      <div className="relative" ref={feedDropdownRef}>
        <button
          onClick={() => setFeedDropdownOpen((p) => !p)}
          className={cn(
            "flex items-center gap-2 pl-3 pr-2.5 py-1.5 rounded-full border transition-all",
            feedDropdownOpen
              ? "bg-on-surface/5 border-on-surface/15"
              : "bg-white border-on-surface/10 hover:border-on-surface/20"
          )}
        >
          <span className="text-sm font-bold font-serif">{currentOption.label}</span>
          <ChevronDown size={14} className={cn("text-on-surface/40 transition-transform", feedDropdownOpen && "rotate-180")} />
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
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 bg-on-surface/5 px-2 py-0.5 rounded-full">
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
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-on-surface/8 shadow-sm overflow-hidden">
              <div className="px-4 pt-3.5 pb-2.5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-on-surface/5 animate-pulse" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-2.5 w-24 rounded-full bg-on-surface/5 animate-pulse" />
                  <div className="h-2 w-16 rounded-full bg-on-surface/5 animate-pulse" />
                </div>
              </div>
              <div className="px-4 pb-4">
                <div className="flex gap-3">
                  <div className="w-20 h-20 rounded-xl bg-on-surface/5 animate-pulse flex-shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3 w-3/4 rounded-full bg-on-surface/5 animate-pulse" />
                    <div className="h-2.5 w-1/2 rounded-full bg-on-surface/5 animate-pulse" />
                    <div className="h-2 w-full rounded-full bg-on-surface/5 animate-pulse" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }
  if (feedItems.length === 0 && feedMode === 'friends') return null;

  // Recipes-only mode uses its own list rendered from homeMeals.
  const recipesSorted = [...homeMeals].sort((a, b) => b.createdAt - a.createdAt);
  const formatTotalTime = (minutes: number): string => {
    if (!Number.isFinite(minutes) || minutes <= 0) return '';
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const rem = minutes % 60;
    if (rem === 0) return `${h} hr`;
    return `${h} hr ${rem} min`;
  };

  return (
    <section className="mb-8">
      <SectionHeader count={feedMode === 'recipes' ? recipesSorted.length : feedItems.length} />
      {feedMode === 'experts' ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-14 h-14 rounded-full bg-on-surface/5 flex items-center justify-center mb-3">
            <Star size={24} className="text-amber-400 fill-amber-400" />
          </div>
          <p className="text-sm font-semibold text-on-surface/50">Expert Picks</p>
          <p className="text-xs text-on-surface/35 mt-1">Coming soon</p>
        </div>
      ) : feedMode === 'recipes' ? (
        recipesSorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mb-3">
              <ChefHat size={24} className="text-emerald-400" />
            </div>
            <p className="text-sm font-semibold text-on-surface/50">No recipes yet</p>
            <p className="text-xs text-on-surface/35 mt-1 max-w-[240px]">
              When your friends publish a recipe, it will show up here so you can try it and leave a rating.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {recipesSorted.map((m) => {
              const authorName = getName(m.userId);
              const authorInitial = initialOf(authorName);
              const color = avatarColor(m.userId);
              const cover = m.coverPhoto || m.photos?.[0]?.url || '';
              const totalLabel = formatTotalTime((m.prepTime ?? 0) + (m.cookTime ?? 0));
              const ingredientCount = m.ingredients?.length ?? 0;
              const stepCount = m.steps?.length ?? 0;
              return (
                <button
                  key={`recipe-${m.userId}-${m.id}`}
                  onClick={() => setActiveFriendRecipe(m)}
                  className="w-full bg-gradient-to-br from-emerald-50/60 to-white rounded-2xl border border-emerald-200/40 shadow-sm overflow-hidden text-left hover:shadow-md transition-shadow"
                >
                  <div className="px-4 pt-3.5 pb-2.5 flex items-center gap-3">
                    <div className={cn("w-9 h-9 rounded-full ring-2 ring-emerald-200/50 flex items-center justify-center font-bold text-sm", color.bg, color.text)}>
                      {authorInitial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{authorName}</p>
                      <p className="text-[10px] text-emerald-700/80 font-semibold uppercase tracking-wider">published a recipe</p>
                    </div>
                    <span className="text-[10px] text-on-surface/35 font-medium">{timeAgo(new Date(m.createdAt).toISOString())}</span>
                  </div>
                  <div className="px-4 pb-4 flex gap-3 items-stretch">
                    <div className="w-24 h-24 rounded-xl overflow-hidden bg-emerald-100/60 flex-shrink-0 ring-1 ring-emerald-200/40">
                      {cover ? (
                        <img src={cover} alt={m.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ChefHat size={26} className="text-emerald-300" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <h3 className="font-serif font-bold text-base text-on-surface leading-tight truncate">{m.name}</h3>
                      {m.description && (
                        <p className="text-xs text-on-surface/55 mt-1 leading-snug line-clamp-2">{m.description}</p>
                      )}
                      <div className="flex items-center flex-wrap gap-1.5 mt-2">
                        {totalLabel && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700/80 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                            <Clock size={10} /> {totalLabel}
                          </span>
                        )}
                        {m.difficulty && (
                          <span className="text-[10px] font-semibold text-on-surface/50 bg-on-surface/5 px-1.5 py-0.5 rounded-full">{m.difficulty}</span>
                        )}
                        {ingredientCount > 0 && (
                          <span className="text-[10px] text-on-surface/40">{ingredientCount} ingredient{ingredientCount !== 1 ? 's' : ''}</span>
                        )}
                        {stepCount > 0 && (
                          <span className="text-[10px] text-on-surface/40">· {stepCount} step{stepCount !== 1 ? 's' : ''}</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-on-surface/25 self-center flex-shrink-0" />
                  </div>
                </button>
              );
            })}
          </div>
        )
      ) : (
      <div className="space-y-3">
        {feedItems.map((item) => {
          if (item.type === 'homeMeal') {
            const m = item.data;
            const mealTimeAgo = timeAgo(new Date(m.createdAt).toISOString());
            return (
              <div key={`meal-${m.id}`} className="bg-gradient-to-br from-emerald-50/60 to-white rounded-2xl border border-emerald-200/40 shadow-sm overflow-hidden">
                {/* User header */}
                <div className="px-4 pt-3.5 pb-2.5 flex items-center gap-3">
                  <Link to={`/user/${getUsername(m.userId)}`}>
                    <div className="w-9 h-9 rounded-full bg-emerald-100 ring-2 ring-emerald-200/50 flex items-center justify-center">
                      <ChefHat size={17} className="text-emerald-600" />
                    </div>
                  </Link>
                  <div className="flex-1 min-w-0">
                    <Link to={`/user/${getUsername(m.userId)}`} className="text-sm font-semibold hover:text-primary">{getName(m.userId)}</Link>
                    <p className="text-[10px] text-emerald-700/80 font-semibold uppercase tracking-wider">cooked at home</p>
                  </div>
                  <span className="text-[10px] text-on-surface/35 font-medium">{mealTimeAgo}</span>
                </div>

                {/* Meal body */}
                <div className="px-4 pb-3.5">
                  <div className="flex gap-3">
                    {/* Thumbnail */}
                    <div className="w-20 h-20 rounded-xl overflow-hidden bg-emerald-100/60 flex-shrink-0 ring-1 ring-emerald-200/40">
                      {m.photos.length > 0 ? (
                        <img src={m.photos[0].url} alt={m.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ChefHat size={24} className="text-emerald-400" />
                        </div>
                      )}
                    </div>
                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h3 className="font-serif font-bold text-sm truncate leading-tight">{m.name}</h3>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-700/70 bg-emerald-100/70 px-1.5 py-0.5 rounded-full">
                              {new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                            {m.dishes.length > 0 && (
                              <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-700/70 bg-emerald-100/70 px-1.5 py-0.5 rounded-full inline-flex items-center gap-1">
                                <UtensilsCrossed size={9} /> {m.dishes.length} dish{m.dishes.length !== 1 ? 'es' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className={cn("flex-shrink-0 w-10 h-10 rounded-full bg-white ring-2 flex items-center justify-center", m.score >= 8 ? 'ring-green-500/30' : m.score >= 5 ? 'ring-yellow-500/30' : 'ring-red-500/30')}>
                          <span className={cn("text-sm font-serif font-bold", scoreColor(m.score))}>{m.score.toFixed(1)}</span>
                        </div>
                      </div>
                      {m.description && (
                        <div className="mt-2 pl-2.5 border-l-2 border-emerald-300/60">
                          <p className="text-[11px] text-on-surface/55 italic line-clamp-2 leading-snug">{m.description}</p>
                        </div>
                      )}
                      {m.tags.length > 0 && (
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {m.tags.slice(0, 4).map((t) => (
                            <span key={t} className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
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
          <div key={r.id} className="bg-white rounded-2xl border border-on-surface/8 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
            {/* User header */}
            <div className="px-4 pt-3.5 pb-2.5 flex items-center gap-3">
              <Link to={`/user/${getUsername(r.user_id)}`}>
                <div className={cn("w-9 h-9 rounded-full flex items-center justify-center ring-2 ring-white shadow-sm", color.bg)}>
                  <span className={cn("text-sm font-serif font-bold", color.text)}>{initial}</span>
                </div>
              </Link>
              <div className="flex-1 min-w-0">
                <Link to={`/user/${getUsername(r.user_id)}`} className="text-sm font-semibold hover:text-primary">{getName(r.user_id)}</Link>
                <p className="text-[10px] text-on-surface/45 font-medium">
                  {profiles[r.user_id]?.is_expert
                    ? <span className="inline-flex items-center gap-0.5 text-amber-600 font-semibold"><Star size={8} className="fill-amber-500 text-amber-500" />Expert Review</span>
                    : 'rated a restaurant'}
                </p>
              </div>
              <span className="text-[10px] text-on-surface/35 font-medium">{timeAgo(r.created_at)}</span>
            </div>

            {/* Restaurant body — tappable */}
            <button
              type="button"
              onClick={() => navigate(`/restaurant/${r.restaurant_id}`)}
              className="block w-full text-left px-4 pb-3"
            >
              <div className="flex gap-3">
                {/* Thumbnail */}
                <div className="w-20 h-20 rounded-xl overflow-hidden bg-on-surface/5 flex-shrink-0 ring-1 ring-on-surface/5">
                  {r.photo_url ? (
                    <img src={r.photo_url} alt={r.restaurant_name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-on-surface/5 font-serif text-2xl font-bold text-on-surface/20">
                      {initialOf(r.restaurant_name)}
                    </div>
                  )}
                </div>
                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-serif font-bold text-sm leading-tight line-clamp-1">{r.restaurant_name}</h3>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {r.cuisine && (
                          <span className="text-[9px] font-bold uppercase tracking-wider text-on-surface/50 bg-on-surface/5 px-1.5 py-0.5 rounded-full">{r.cuisine}</span>
                        )}
                        {r.price && (
                          <span className="text-[9px] font-bold uppercase tracking-wider text-primary/70 bg-primary/8 px-1.5 py-0.5 rounded-full">{r.price}</span>
                        )}
                      </div>
                    </div>
                    {/* Score orb */}
                    <div className={cn("flex-shrink-0 w-10 h-10 rounded-full bg-white ring-2 flex items-center justify-center", Number(r.score) >= 8 ? 'ring-green-500/30' : Number(r.score) >= 5 ? 'ring-yellow-500/30' : 'ring-red-500/30')}>
                      <span className={cn("text-sm font-serif font-bold", scoreColor(Number(r.score)))}>{Number(r.score).toFixed(1)}</span>
                    </div>
                  </div>
                  {r.notes && (
                    <div className="mt-2 pl-2.5 border-l-2 border-primary/30">
                      <p className="text-[11px] text-on-surface/55 italic line-clamp-2 leading-snug">{r.notes}</p>
                    </div>
                  )}
                  {r.tags && r.tags.length > 0 && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {r.tags.slice(0, 4).map((t) => (
                        <span key={t} className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-primary/8 text-primary/70">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </button>

            {/* Action buttons */}
            <div className="px-4 pb-2.5 flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); openAddRestaurantModal(meta); }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-primary/8 text-primary hover:bg-primary/12 transition-colors text-[11px] font-bold"
              >
                <Plus size={12} /> Rate
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); openWishlistModal(meta); }}
                className={cn(
                  "inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors",
                  wishlisted ? "bg-red-50 text-red-500 hover:bg-red-100" : "bg-on-surface/5 text-on-surface/40 hover:bg-on-surface/10"
                )}
                aria-label={wishlisted ? "In wishlist" : "Add to wishlist"}
              >
                <Heart size={14} className={wishlisted ? 'fill-red-500' : ''} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); navigate(`/review/${r.id}`); }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-on-surface/5 text-on-surface/60 hover:bg-on-surface/10 transition-colors text-[11px] font-bold"
              >
                <Eye size={12} /> See Review
              </button>
            </div>

            {/* Like & Comment */}
            <div className="px-4 pb-3 pt-1 border-t border-on-surface/6 flex items-center gap-5">
              <button onClick={() => handleLike(r.id)} className={cn("flex items-center gap-1.5 transition-colors pt-2", userLiked.has(r.id) ? "text-red-500" : "text-on-surface/35 hover:text-red-500")}>
                <Heart size={16} className={userLiked.has(r.id) ? 'fill-red-500' : ''} />
                <span className="text-[11px] font-semibold">{likes[r.id] || 0}</span>
              </button>
              <button onClick={() => handleOpenComments(r.id)} className={cn("flex items-center gap-1.5 transition-colors pt-2", openComments === r.id ? "text-primary" : "text-on-surface/35 hover:text-primary")}>
                <MessageSquare size={16} />
                <span className="text-[11px] font-semibold">{commentCounts[r.id] || 0}</span>
              </button>
            </div>

            {/* Comments */}
            <AnimatePresence>
              {openComments === r.id && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="border-t border-on-surface/6 px-3.5 py-2.5 space-y-2">
                    {commentsLoading ? (
                      <div className="text-center py-2"><div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" /></div>
                    ) : comments.length === 0 ? (
                      <p className="text-[11px] text-on-surface/30 py-1">No comments yet — be the first!</p>
                    ) : (
                      <div className="space-y-2 max-h-44 overflow-y-auto">
                        {comments.map((c) => {
                          const cColor = avatarColor(c.user_id);
                          const cInitial = initialOf(commentProfiles[c.user_id]?.display_name || 'User');
                          return (
                          <div key={c.id} className="flex gap-2">
                            <div className={cn("w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5", cColor.bg)}>
                              <span className={cn("text-[10px] font-serif font-bold", cColor.text)}>{cInitial}</span>
                            </div>
                            <div className="min-w-0">
                              <p className="text-[11px] leading-relaxed">
                                <Link to={`/user/${commentProfiles[c.user_id]?.username || ''}`} className="font-semibold text-on-surface/70 hover:text-primary">{commentProfiles[c.user_id]?.display_name || 'User'}</Link>{' '}
                                <span className="text-on-surface/50">{c.text}</span>
                              </p>
                              <p className="text-[9px] text-on-surface/25 mt-0.5">{timeAgo(c.created_at)}</p>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <input type="text" value={newComment} onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Write a comment..."
                        className="flex-1 bg-on-surface/5 rounded-xl py-2 px-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary/20"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddComment(r.id)} />
                      <button onClick={() => handleAddComment(r.id)} disabled={!newComment.trim()}
                        className="p-2 text-primary disabled:text-on-surface/15 rounded-xl hover:bg-primary/5 transition-colors">
                        <Send size={14} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          );
        })}
      </div>
      )}

      <FriendRecipeModal
        meal={activeFriendRecipe}
        authorProfile={activeFriendRecipe ? profiles[activeFriendRecipe.userId] ?? null : null}
        currentUserId={userId}
        onClose={() => setActiveFriendRecipe(null)}
      />
    </section>
  );
};
