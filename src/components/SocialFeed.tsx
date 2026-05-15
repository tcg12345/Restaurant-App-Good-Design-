import React, { useState, useEffect, useCallback } from 'react';
import { Heart, MessageSquare, Send, ChefHat, UtensilsCrossed, Plus, Star, ChevronDown, BookOpen, Share2, Bookmark, X } from 'lucide-react';
import { ShareRecipeSheet } from './ShareRecipeSheet';
import { ShareDialog } from './ShareDialog';
import { CommentsBody } from '../pages/Reels';
import { RestaurantPanel, type RestaurantPanelSnapshot } from './RestaurantPanel';
import type { SharedRecipe, SharePayload } from '../contexts/ChatContext';
import { usePosts } from '../contexts/PostsContext';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { ScoreBadge } from './ScoreBadge';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useLists } from '../contexts/ListsContext';
import {
  getFriends, getFriendActivity, getProfilesByIds, getLikesForRatings,
  getCommentCounts, toggleLike, addComment, getComments, toggleCommentLike,
  getFriendsPublicHomeMeals, getFollowedExpertIds, getExpertProfiles,
  type CommunityRating, type UserProfile, type ActivityComment, type FriendHomeMeal,
} from '../lib/supabase-community';
import { listPosts, setPostLike, setPostSave, type PostRow, type PostRestaurantSnapshot } from '../lib/supabase-posts';
import { getMealCoverUrl } from '../lib/recipe-display';
import { getReviewSummariesBatch } from '../lib/supabase-home-meal-reviews';
import { EmptyState } from './EmptyState';

/**
 * Photo strip with built-in failure handling — when the image URL 404s or
 * loads zero bytes, the entire strip removes itself from the layout so
 * activity cards without working covers don't show an alt-text placeholder
 * or a broken-image tile.
 */
const ActivityPhoto: React.FC<{
  src?: string | null;
  onClick: () => void;
  aria: string;
}> = ({ src, onClick, aria }) => {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full mb-4 aspect-[16/9] rounded-xl overflow-hidden bg-on-surface/[0.05] group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      aria-label={aria}
    >
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth === 0) setFailed(true);
        }}
        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
        referrerPolicy="no-referrer"
      />
    </button>
  );
};

/**
 * Instagram-style swipeable media carousel for a post's items. Skips
 * video items (videos still live in the dedicated reels viewer for
 * now) and renders only photo items as a horizontal scroll-snap row
 * with dot indicators. Returns null when no usable photos exist so the
 * caller can fall back to a text-only card.
 */
const PostMediaCarousel: React.FC<{
  items: { id: string; mediaType: 'photo' | 'video'; mediaUrl: string }[];
  onClick?: () => void;
}> = ({ items, onClick }) => {
  const photos = items.filter((it) => it.mediaType === 'photo' && it.mediaUrl);
  const [activeIdx, setActiveIdx] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const trackRef = React.useRef<HTMLDivElement>(null);

  if (photos.length === 0) return null;
  const visible = photos.filter((p) => !failed.has(p.id));
  if (visible.length === 0) return null;

  const handleScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    if (idx !== activeIdx) setActiveIdx(idx);
  };

  return (
    // Mobile/phone-frame: full-bleed photos (instagram-style — match the
    // card edges). Desktop: cap to a narrower centered column so the
    // photos don't dominate the card now that the feed list itself is
    // wider than a typical instagram column.
    <div className="relative -mx-4 mt-3 mb-1 select-none lg:mx-auto lg:max-w-[420px] lg:rounded-2xl lg:overflow-hidden">
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide"
        style={{ scrollbarWidth: 'none' }}
      >
        {visible.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={onClick}
            className="relative w-full flex-shrink-0 snap-center aspect-square overflow-hidden bg-on-surface/[0.04] focus-visible:outline-none"
            aria-label="Open post"
          >
            <img
              src={it.mediaUrl}
              alt=""
              onError={() => setFailed((prev) => new Set(prev).add(it.id))}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth === 0) setFailed((prev) => new Set(prev).add(it.id));
              }}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
              draggable={false}
            />
          </button>
        ))}
      </div>

      {/* Counter badge — only when multi-photo */}
      {visible.length > 1 && (
        <div className="absolute top-2.5 right-2.5 rounded-full bg-black/55 backdrop-blur px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums">
          {activeIdx + 1}/{visible.length}
        </div>
      )}

      {/* Dot indicators */}
      {visible.length > 1 && (
        <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex gap-1">
          {visible.map((_, i) => (
            <span
              key={i}
              className={cn(
                'rounded-full transition-all',
                i === activeIdx ? 'w-1.5 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/50',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Mock guides for the suggestions rail. Curated copy matches the strip on
// the Discover home page so the right column reads as a feature surface
// rather than an empty placeholder.
const SUGGESTION_GUIDES = [
  { id: 'g-paris-bistros', title: 'Classic Paris Bistros', author: 'Camille Durand', spots: 8 },
  { id: 'g-tokyo-ramen', title: 'Tokyo’s Hidden Ramen Gems', author: 'Aiko Tanaka', spots: 11 },
  { id: 'g-nyc-chinese', title: 'Best Chinese Restaurants in NYC', author: 'Jamie Lin', spots: 12 },
];

/**
 * Right-side suggestions rail — Instagram-style. Shows people to follow
 * (experts not yet followed by the viewer) plus a small curated guide
 * list. Rendered only on desktop next to the activity feed; hidden on
 * mobile / phone-frame where vertical space is the constraint.
 */
const SuggestionsRail: React.FC<{
  userId: string | null;
  friendIds: Set<string>;
}> = ({ userId, friendIds }) => {
  const [suggested, setSuggested] = useState<UserProfile[]>([]);

  useEffect(() => {
    let cancelled = false;
    getExpertProfiles().then((profiles) => {
      if (cancelled) return;
      const filtered = profiles.filter((p) => p.user_id !== userId && !friendIds.has(p.user_id));
      setSuggested(filtered.slice(0, 5));
    });
    return () => { cancelled = true; };
  }, [userId, friendIds]);

  return (
    <aside className="space-y-7">
      {/* People to follow */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45">Suggested for you</h4>
          <Link to="/circle" className="text-[11px] font-semibold text-primary hover:text-primary/80">See all</Link>
        </div>
        {suggested.length === 0 ? (
          <p className="text-[12.5px] text-on-surface/40">No suggestions right now.</p>
        ) : (
          <ul className="space-y-3">
            {suggested.map((p) => {
              const color = avatarColor(p.user_id);
              const initial = initialOf(p.display_name || p.username);
              return (
                <li key={p.user_id}>
                  <Link to={`/user/${p.username}`} className="flex items-center gap-3 group">
                    <div className={cn('w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0', color.bg)}>
                      <span className={cn('text-[13px] font-serif font-bold', color.text)}>{initial}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
                        {p.display_name || p.username}
                      </p>
                      <p className="text-[11px] text-on-surface/45 truncate inline-flex items-center gap-1">
                        {p.is_expert && (
                          <span className="inline-flex items-center gap-0.5 text-amber-600 font-semibold">
                            <Star size={9} className="fill-amber-500 text-amber-500" />
                            Expert
                          </span>
                        )}
                        {p.is_expert && p.username && <span className="text-on-surface/20">·</span>}
                        @{p.username || 'user'}
                      </p>
                    </div>
                    <span className="text-[11px] font-bold text-primary hover:text-primary/80 flex-shrink-0">Follow</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Featured guides */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45">Featured guides</h4>
          <Link to="/discover" className="text-[11px] font-semibold text-primary hover:text-primary/80">Browse</Link>
        </div>
        <ul className="space-y-3">
          {SUGGESTION_GUIDES.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                className="w-full flex items-center gap-3 text-left group"
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-stone-700 to-stone-900 flex items-center justify-center flex-shrink-0">
                  <BookOpen size={15} className="text-white/85" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-serif font-bold text-on-surface leading-tight line-clamp-1 group-hover:text-primary transition-colors">
                    {g.title}
                  </p>
                  <p className="text-[11px] text-on-surface/45 truncate mt-0.5">
                    by {g.author} · {g.spots} spots
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-[10px] text-on-surface/30 leading-relaxed">
        Suggestions update based on the people you follow and the cuisines you cook.
      </p>
    </aside>
  );
};

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
  | { type: 'homeMeal'; data: FriendHomeMeal; sortTime: number }
  | { type: 'post'; data: PostRow; sortTime: number };

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

  const { loadPostComments, addPostComment, deletePostComment } = usePosts();
  // Desktop vs phone — drives whether post comments open as a centered
  // modal (wide) or a bottom sheet (narrow), and whether the featured-place
  // card navigates to a detail page or opens an in-feed sheet.
  const [isWideViewport, setIsWideViewport] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsWideViewport(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const isDesktop = isWideViewport && !phoneMode;

  const [activity, setActivity] = useState<CommunityRating[]>([]);
  const [homeMeals, setHomeMeals] = useState<FriendHomeMeal[]>([]);
  const [posts, setPosts] = useState<PostRow[]>([]);
  // Friend IDs are reused by the right-side SuggestionsRail to exclude
  // already-followed accounts from "Suggested for you".
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  // Post-level overlays (open one at a time, controlled by the post card)
  const [openPostCommentsId, setOpenPostCommentsId] = useState<string | null>(null);
  const [restaurantPanelSnap, setRestaurantPanelSnap] = useState<RestaurantPanelSnapshot | null>(null);
  const [sharePayload, setSharePayload] = useState<SharePayload | null>(null);
  // Ratings authored by experts the user follows. Loaded lazily the first
  // time the user switches the feed dropdown to "Expert Picks".
  const [expertActivity, setExpertActivity] = useState<CommunityRating[]>([]);
  const [expertLoading, setExpertLoading] = useState(false);
  const [expertLoaded, setExpertLoaded] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [likes, setLikes] = useState<Record<string, number>>({});
  const [userLiked, setUserLiked] = useState<Set<string>>(new Set());
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [mealRatingSummaries, setMealRatingSummaries] = useState<Record<string, { average: number; count: number }>>({});
  const [shareRecipeData, setShareRecipeData] = useState<SharedRecipe | null>(null);
  const [loading, setLoading] = useState(true);
  // Hoisted earlier than the rest of the feed-mode UI plumbing so the
  // feedItems memo below can switch its source based on the current tab.
  type FeedMode = 'friends' | 'experts' | 'recipes';
  const [feedMode, setFeedMode] = useState<FeedMode>('friends');

  const [openComments, setOpenComments] = useState<string | null>(null);
  const [comments, setComments] = useState<ActivityComment[]>([]);
  const [commentProfiles, setCommentProfiles] = useState<Record<string, UserProfile>>({});
  const [newComment, setNewComment] = useState('');
  const [commentsLoading, setCommentsLoading] = useState(false);
  // Which top-level comment IDs have their reply-thread expanded (YouTube-style).
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  // Which top-level comment ID is currently showing the inline reply input.
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
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

    const friendIdsArr = friends.map((f) => f.friend_id);
    const friendIdSet = new Set(friendIdsArr);
    setFriendIds(friendIdSet);
    const [act, meals, allPosts] = await Promise.all([
      getFriendActivity(friendIdsArr, 500),
      getFriendsPublicHomeMeals(friendIdsArr),
      // Pull the public-post feed and filter to friends only — RLS already
      // limits the row set to public + accepted-followers, so this keeps
      // the Friend Activity feed scoped to people you actually follow.
      listPosts({ viewerId: userId, limit: 100 }),
    ]);
    setActivity(act);
    setHomeMeals(meals);
    setPosts(allPosts.filter((p) => friendIdSet.has(p.userId)));

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
      const scanIds = [userId, ...friendIdsArr];
      getReviewSummariesBatch(meals.map((m) => m.id), scanIds)
        .then(setMealRatingSummaries)
        .catch(() => {});
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  // Lazy-load expert ratings the first time the user opens the Expert
  // Picks tab. Pulls every rating authored by an expert the viewer
  // follows (intersection of followed accounts + is_expert profiles)
  // and reuses the same author-profile lookup as the friend feed.
  const loadExperts = useCallback(async () => {
    if (!userId || expertLoaded) return;
    setExpertLoading(true);
    try {
      const expertIds = await getFollowedExpertIds(userId);
      if (expertIds.size === 0) {
        setExpertActivity([]);
        setExpertLoaded(true);
        return;
      }
      const ratings = await getFriendActivity([...expertIds], 200);
      setExpertActivity(ratings);

      // Author profiles for expert ratings — fold into the same `profiles`
      // map the friend feed already uses so name lookups stay free.
      const newAuthorIds = ratings
        .map((r) => r.user_id)
        .filter((id) => !profiles[id]);
      if (newAuthorIds.length > 0) {
        const profs = await getProfilesByIds([...new Set(newAuthorIds)]);
        setProfiles((prev) => ({ ...prev, ...profs }));
      }

      // Engagement metadata (likes + comment counts) for the new ratings
      // so the action bar can show counts immediately.
      const ratingIds = ratings.map((r) => r.id).filter(Boolean);
      if (ratingIds.length > 0) {
        const [likeData, counts] = await Promise.all([
          getLikesForRatings(userId, ratingIds),
          getCommentCounts(ratingIds),
        ]);
        setLikes((prev) => ({ ...prev, ...likeData.likes }));
        setUserLiked((prev) => {
          const next = new Set(prev);
          likeData.userLiked.forEach((id) => next.add(id));
          return next;
        });
        setCommentCounts((prev) => ({ ...prev, ...counts }));
      }
      setExpertLoaded(true);
    } finally {
      setExpertLoading(false);
    }
  }, [userId, expertLoaded, profiles]);

  // Merge and sort feed items by recency. Newest activity surfaces first
  // regardless of the source kind (rating / home meal / post).
  // Expert Picks mode shows ratings from followed experts only (no
  // home-meal logger entries or posts, since experts publish via
  // ratings). Friend Activity is the existing mix of friend ratings +
  // home meals + posts.
  const ratingSource = feedMode === 'experts' ? expertActivity : activity;
  const mealSource = feedMode === 'experts' ? [] : homeMeals;
  const postSource = feedMode === 'experts' ? [] : posts;
  const feedItems: FeedItem[] = [
    ...ratingSource.map((r): FeedItem => ({
      type: 'rating', data: r,
      sortTime: r.created_at ? new Date(r.created_at).getTime() : 0,
    })),
    ...mealSource.map((m): FeedItem => ({
      type: 'homeMeal', data: m,
      sortTime: m.createdAt,
    })),
    ...postSource.map((p): FeedItem => ({
      type: 'post', data: p,
      sortTime: p.createdAt ? new Date(p.createdAt).getTime() : 0,
    })),
  ].sort((a, b) => b.sortTime - a.sortTime);

  const handleLike = async (ratingId: string) => {
    if (!userId || !ratingId) return;
    const wasLiked = userLiked.has(ratingId);
    setUserLiked((prev) => { const next = new Set(prev); wasLiked ? next.delete(ratingId) : next.add(ratingId); return next; });
    setLikes((prev) => ({ ...prev, [ratingId]: Math.max(0, (prev[ratingId] || 0) + (wasLiked ? -1 : 1)) }));
    await toggleLike(userId, ratingId);
  };

  // Toggle a post like. Mirrors handleLike's optimistic pattern so the
  // heart flips immediately and the server call reconciles in the
  // background.
  const handleLikePost = async (postId: string, currentlyLiked: boolean) => {
    if (!userId) return;
    setPosts((prev) => prev.map((p) => (
      p.id === postId
        ? { ...p, liked: !currentlyLiked, likesCount: Math.max(0, p.likesCount + (currentlyLiked ? -1 : 1)) }
        : p
    )));
    await setPostLike(postId, userId, !currentlyLiked);
  };

  const handleSavePost = async (postId: string, currentlySaved: boolean) => {
    if (!userId) return;
    setPosts((prev) => prev.map((p) => (
      p.id === postId
        ? { ...p, saved: !currentlySaved, savesCount: Math.max(0, p.savesCount + (currentlySaved ? -1 : 1)) }
        : p
    )));
    await setPostSave(postId, userId, !currentlySaved);
  };

  // Open the share dialog with a SharedPost payload mirrored from the
  // Reels page's buildSharedPost helper.
  const handleSharePost = (post: PostRow) => {
    const cover = post.items[0];
    setSharePayload({
      sharedPost: {
        postId: post.id,
        authorId: post.userId,
        authorUsername: post.author?.username || post.userId.slice(0, 8),
        authorDisplayName: post.author?.displayName,
        authorAvatarColor: post.author?.avatarColor || 'bg-stone-700',
        authorInitials: post.author?.initials || post.userId.slice(0, 2).toUpperCase(),
        isExpert: post.author?.isExpert ?? false,
        caption: post.caption,
        locationLabel: post.locationLabel,
        coverUrl: cover?.mediaUrl,
        coverMediaType: cover?.mediaType,
        bgGradient: cover?.bgGradient || 'from-stone-800 to-stone-900',
        itemCount: post.items.length,
      },
    });
  };

  // Featured place — desktop navigates to the full restaurant detail
  // page; phone-frame and mobile open the same in-feed sheet that the
  // reels viewer uses for "Featured place" taps.
  const handleFeaturedPlaceClick = (restaurant: PostRestaurantSnapshot) => {
    if (isDesktop) {
      navigate(`/restaurant/${restaurant.id}`);
    } else {
      setRestaurantPanelSnap(restaurant);
    }
  };

  // Adapters fold PostComment (with extra postId) into the same shape
  // CommentsBody already consumes for reels.
  const loadPostCommentsAdapter = useCallback(async (postId: string) => {
    const rows = await loadPostComments(postId);
    return rows.map((c) => ({ id: c.id, userId: c.userId, body: c.body, createdAt: c.createdAt, author: c.author }));
  }, [loadPostComments]);
  const addPostCommentAdapter = useCallback(async (postId: string, body: string) => {
    const c = await addPostComment(postId, body);
    if (!c) return null;
    // Bump the local post's comment count so the badge updates without a refetch.
    setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, commentsCount: p.commentsCount + 1 } : p));
    return { id: c.id, userId: c.userId, body: c.body, createdAt: c.createdAt, author: c.author };
  }, [addPostComment]);
  const deletePostCommentAdapter = useCallback(async (postId: string, commentId: string) => {
    const ok = await deletePostComment(postId, commentId);
    if (ok) setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, commentsCount: Math.max(0, p.commentsCount - 1) } : p));
    return ok;
  }, [deletePostComment]);

  const handleOpenComments = async (ratingId: string) => {
    if (openComments === ratingId) { setOpenComments(null); return; }
    setOpenComments(ratingId);
    setCommentsLoading(true);
    setNewComment('');
    setReplyingTo(null);
    setReplyText('');
    setExpandedThreads(new Set());
    const cmts = await getComments(ratingId, userId);
    setComments(cmts);
    if (cmts.length > 0) {
      const ids = [...new Set(cmts.map((c) => c.user_id))];
      const profs = await getProfilesByIds(ids);
      setCommentProfiles(profs);
    }
    setCommentsLoading(false);
  };

  // Single shared "refresh comments after a write" routine so handlers stay tiny.
  const refreshComments = async (ratingId: string) => {
    const cmts = await getComments(ratingId, userId);
    setComments(cmts);
    const ids = [...new Set(cmts.map((c) => c.user_id))];
    setCommentProfiles(await getProfilesByIds(ids));
  };

  const handleAddComment = async (ratingId: string) => {
    if (!userId || !newComment.trim()) return;
    const ok = await addComment(userId, ratingId, newComment.trim(), null);
    if (ok) {
      setNewComment('');
      setCommentCounts((prev) => ({ ...prev, [ratingId]: (prev[ratingId] || 0) + 1 }));
      await refreshComments(ratingId);
    }
  };

  const handleAddReply = async (ratingId: string, parentId: string) => {
    if (!userId || !replyText.trim()) return;
    const ok = await addComment(userId, ratingId, replyText.trim(), parentId);
    if (ok) {
      setReplyText('');
      setReplyingTo(null);
      setCommentCounts((prev) => ({ ...prev, [ratingId]: (prev[ratingId] || 0) + 1 }));
      // Expand the parent thread so the new reply is visible immediately.
      setExpandedThreads((prev) => new Set(prev).add(parentId));
      await refreshComments(ratingId);
    }
  };

  // Optimistic comment-like toggle — flips the local state first, then
  // syncs to Supabase. If the server call fails we silently leave the
  // optimistic state in place; the next refresh will reconcile.
  const handleToggleCommentLike = async (commentId: string) => {
    if (!userId) return;
    setComments((prev) => prev.map((c) => {
      if (c.id !== commentId) return c;
      const wasLiked = !!c.liked_by_me;
      return {
        ...c,
        liked_by_me: !wasLiked,
        like_count: Math.max(0, (c.like_count || 0) + (wasLiked ? -1 : 1)),
      };
    }));
    await toggleCommentLike(userId, commentId);
  };

  const toggleThread = (parentId: string) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  };

  const startReply = (parentId: string) => {
    setReplyingTo((cur) => (cur === parentId ? null : parentId));
    setReplyText('');
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

  const FEED_OPTIONS: { value: FeedMode; label: string; icon: React.ReactNode }[] = [
    { value: 'friends', label: 'Friend Activity', icon: <Heart size={12} /> },
    { value: 'experts', label: 'Expert Picks', icon: <Star size={12} className="fill-amber-500 text-amber-500" /> },
    { value: 'recipes', label: 'Recipes', icon: <BookOpen size={12} /> },
  ];
  const [feedDropdownOpen, setFeedDropdownOpen] = useState(false);
  const feedDropdownRef = React.useRef<HTMLDivElement>(null);

  // Lazy-load expert ratings the first time the dropdown switches into the
  // "Expert Picks" tab. Subsequent switches reuse what's already in state.
  useEffect(() => {
    if (feedMode === 'experts' && !expertLoaded && !expertLoading) loadExperts();
  }, [feedMode, expertLoaded, expertLoading, loadExperts]);

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
        <div className={cn(
          !phoneMode && 'xl:grid xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-8 xl:items-start xl:max-w-[1024px] xl:mx-auto',
        )}>
          <div className="xl:min-w-0">
            <SectionHeader />
            <ul>
              {[0, 1, 2].map((i) => (
                <li key={i} className="border-b border-on-surface/[0.08] last:border-0 py-5">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="w-9 h-9 rounded-full bg-on-surface/[0.05] animate-pulse" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-2.5 w-24 rounded-full bg-on-surface/[0.05] animate-pulse" />
                      <div className="h-2 w-16 rounded-full bg-on-surface/[0.05] animate-pulse" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="h-4 w-3/5 rounded-full bg-on-surface/[0.05] animate-pulse" />
                    <div className="h-3 w-2/5 rounded-full bg-on-surface/[0.05] animate-pulse" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          {!phoneMode && (
            <aside className="hidden xl:block xl:sticky xl:top-4 xl:pt-12 xl:self-start xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1">
              <SuggestionsRail userId={userId} friendIds={friendIds} />
            </aside>
          )}
        </div>
      </section>
    );
  }
  if (feedItems.length === 0 && feedMode === 'friends') return null;

  // Recipes-only mode uses its own list rendered from homeMeals.
  const recipesSorted = [...homeMeals].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <section className="mb-8">
      <div className={cn(
        !phoneMode && 'xl:grid xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-8 xl:items-start xl:max-w-[1024px] xl:mx-auto',
      )}>
        <div className="xl:min-w-0">
      <SectionHeader count={feedMode === 'recipes' ? recipesSorted.length : feedItems.length} />
      {feedMode === 'experts' && expertLoading ? (
        <ul>
          {[0, 1, 2].map((i) => (
            <li key={i} className="border-b border-on-surface/[0.08] last:border-0 py-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-9 h-9 rounded-full bg-on-surface/[0.05] animate-pulse" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-2.5 w-24 rounded-full bg-on-surface/[0.05] animate-pulse" />
                  <div className="h-2 w-16 rounded-full bg-on-surface/[0.05] animate-pulse" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-4 w-3/5 rounded-full bg-on-surface/[0.05] animate-pulse" />
                <div className="h-3 w-2/5 rounded-full bg-on-surface/[0.05] animate-pulse" />
              </div>
            </li>
          ))}
        </ul>
      ) : feedMode === 'experts' && feedItems.length === 0 ? (
        <EmptyState
          icon={<Star size={48} className="fill-amber-400 text-amber-400" />}
          heading="No expert picks yet"
          description="Follow critics, chefs, and writers to see their ratings show up here."
        />
      ) : feedMode === 'recipes' ? (
        recipesSorted.length === 0 ? (
          <EmptyState
            icon={<ChefHat size={48} />}
            heading="No recipes yet"
            description="When your friends publish a recipe, it will show up here so you can try it and leave a rating."
          />
        ) : (
          <ul>
            {recipesSorted.map((m) => {
              const mealTimeAgo = timeAgo(new Date(m.createdAt).toISOString());
              const summary = mealRatingSummaries[m.id];
              return (
                <li key={`recipe-${m.userId}-${m.id}`} className="border-b border-on-surface/[0.08] last:border-0 py-5">
                  <article>
                    {/* Hero photo — only when a cover URL actually resolves */}
                    {!phoneMode && (
                      <ActivityPhoto
                        src={getMealCoverUrl(m)}
                        onClick={() => openFriendRecipe(m)}
                        aria={`View ${m.name}`}
                      />
                    )}

                    {/* Cook header + share */}
                    <div className="flex items-center gap-2.5">
                      <Link to={`/user/${getUsername(m.userId)}`} className="flex-shrink-0">
                        <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center">
                          <ChefHat size={14} className="text-emerald-700" />
                        </div>
                      </Link>
                      <div className="flex-1 min-w-0">
                        <Link to={`/user/${getUsername(m.userId)}`} className="text-[13px] font-bold hover:text-primary block truncate leading-tight">
                          {getName(m.userId)}
                        </Link>
                        <p className="text-[11px] text-emerald-700/85 font-semibold leading-tight mt-0.5">
                          Cooked at home <span className="mx-1.5 text-emerald-700/30">·</span>{mealTimeAgo}
                        </p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setShareRecipeData(buildSharedRecipe(m)); }}
                        className="flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-on-surface/45 hover:text-emerald-700 hover:bg-on-surface/[0.04] transition-colors"
                        aria-label="Share recipe"
                      >
                        <Share2 size={16} />
                      </button>
                    </div>

                    {/* Meal block */}
                    <button
                      type="button"
                      onClick={() => openFriendRecipe(m)}
                      className="block w-full text-left mt-2.5 group focus-visible:outline-none"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-serif font-bold text-[19px] leading-[1.15] flex-1 min-w-0 line-clamp-2 group-hover:text-primary transition-colors">{m.name}</h3>
                        {summary && summary.count > 0 && (
                          <div className="flex-shrink-0 flex flex-col items-end gap-0.5 pt-0.5">
                            <div className="flex gap-0.5">
                              {[1, 2, 3, 4, 5].map((n) => (
                                <Star key={n} size={12} className={cn(
                                  n <= Math.round(summary.average) ? "text-amber-500 fill-amber-500" : "text-on-surface/15",
                                )} />
                              ))}
                            </div>
                            <span className="text-[13px] text-on-surface/55 font-bold tabular-nums">{summary.average.toFixed(1)}</span>
                          </div>
                        )}
                      </div>
                      <p className="mt-1.5 text-[11.5px] text-on-surface/50 font-medium uppercase tracking-[0.08em] truncate">
                        {new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {m.dishes.length > 0 && <><span className="text-on-surface/25 mx-1.5">·</span>{m.dishes.length} dish{m.dishes.length !== 1 ? 'es' : ''}</>}
                      </p>
                      {m.description && (
                        <p className="mt-2 text-[14px] text-on-surface/70 italic leading-relaxed line-clamp-3">
                          &ldquo;{m.description}&rdquo;
                        </p>
                      )}
                      {m.tags.length > 0 && (
                        <div className="flex gap-1.5 mt-3 flex-wrap">
                          {m.tags.slice(0, 4).map((t) => (
                            <span key={t} className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700/85">{t}</span>
                          ))}
                        </div>
                      )}
                    </button>
                  </article>
                </li>
              );
            })}
          </ul>
        )
      ) : (
      <ul>
        {feedItems.map((item) => {
          if (item.type === 'post') {
            const p = item.data;
            const author = p.author;
            const displayName = author?.displayName || author?.username || 'A friend';
            const authorUsername = author?.username || '';
            const postTimeAgo = timeAgo(p.createdAt);
            // First attached restaurant/recipe across the post's items —
            // surfaces a small follow-up card so the feed reads like a
            // mini-version of the full reel post, sans the media.
            const attached = p.items.find((it) => it.attachedKind && (it.restaurant || it.recipe));
            const restaurant = attached?.restaurant || null;
            const recipe = attached?.recipe || null;
            const navigateToPost = () => navigate(`/r/post-${p.id}`);
            return (
              <li key={`post-${p.id}`} className="border-b border-on-surface/[0.08] last:border-0 py-5">
                <article>
                  {/* Author header */}
                  <div className="flex items-center gap-2.5">
                    <Link to={`/user/${authorUsername}`} className="flex-shrink-0">
                      <div className={cn(
                        'w-9 h-9 rounded-full flex items-center justify-center text-white text-[12px] font-bold',
                        author?.avatarColor || 'bg-stone-700',
                      )}>
                        {author?.initials || 'U'}
                      </div>
                    </Link>
                    <div className="flex-1 min-w-0">
                      <Link to={`/user/${authorUsername}`} className="text-[13px] font-bold hover:text-primary block truncate leading-tight">
                        {displayName}
                      </Link>
                      <p className="text-[11px] text-on-surface/45 leading-tight mt-0.5 inline-flex items-center gap-1">
                        <span className="inline-flex items-center gap-0.5 text-fuchsia-600 font-semibold">
                          <BookOpen size={9} />Posted
                        </span>
                        <span className="text-on-surface/20 mx-0.5">·</span>
                        {postTimeAgo}
                      </p>
                    </div>
                  </div>

                  {/* Photo carousel (Instagram-style) — only photos for
                      now per design choice. Videos still play in the
                      dedicated reels viewer. */}
                  <PostMediaCarousel items={p.items} onClick={navigateToPost} />

                  {/* Caption + location */}
                  <button
                    type="button"
                    onClick={navigateToPost}
                    className="block w-full text-left mt-3 group focus-visible:outline-none"
                  >
                    {p.caption && (
                      <p className="font-serif text-[18px] leading-[1.25] text-on-surface group-hover:text-primary transition-colors line-clamp-4">
                        {p.caption}
                      </p>
                    )}
                    {p.locationLabel && (
                      <p className="mt-1.5 text-[11.5px] text-on-surface/50 font-medium uppercase tracking-[0.08em] truncate">
                        {p.locationLabel}
                      </p>
                    )}
                  </button>

                  {/* Attached restaurant — its own button so taps open the
                      restaurant detail (sheet on phone / page on desktop)
                      instead of bubbling into the post-view navigation. */}
                  {restaurant && (
                    <button
                      type="button"
                      onClick={() => handleFeaturedPlaceClick(restaurant)}
                      className="block w-full text-left mt-3 rounded-xl border border-on-surface/[0.08] bg-on-surface/[0.02] px-3 py-2.5 hover:border-on-surface/[0.18] hover:bg-on-surface/[0.04] transition-colors"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface/45">
                        Featured place
                      </p>
                      <p className="mt-0.5 font-serif font-bold text-[15px] text-on-surface leading-tight line-clamp-1">
                        {restaurant.name}
                      </p>
                      <p className="mt-0.5 text-[11px] text-on-surface/50 truncate">
                        {[restaurant.cuisine, restaurant.price, restaurant.address].filter(Boolean).join(' · ')}
                      </p>
                    </button>
                  )}

                  {/* Attached recipe — opens the meal page directly. */}
                  {recipe && !restaurant && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); navigate(`/meal/${p.userId}/${recipe.id}`); }}
                      className="block w-full text-left mt-3 rounded-xl border border-on-surface/[0.08] bg-on-surface/[0.02] px-3 py-2.5 hover:border-on-surface/[0.18] hover:bg-on-surface/[0.04] transition-colors"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface/45">
                        Featured recipe
                      </p>
                      <p className="mt-0.5 font-serif font-bold text-[15px] text-on-surface leading-tight line-clamp-1">
                        {recipe.title}
                      </p>
                      {recipe.cuisine && (
                        <p className="mt-0.5 text-[11px] text-on-surface/50 truncate">{recipe.cuisine}</p>
                      )}
                    </button>
                  )}

                  {/* Actions footer — like / comment on the left, save +
                      share on the right (Instagram-style). The comment
                      button opens the inline comments overlay rather than
                      navigating away. */}
                  <div className="flex items-center gap-1 mt-3 pt-2 border-t border-on-surface/[0.05]">
                    <button
                      onClick={() => handleLikePost(p.id, p.liked)}
                      className={cn(
                        'inline-flex items-center gap-1.5 h-9 px-2.5 rounded-full transition-colors',
                        p.liked
                          ? 'text-red-500'
                          : 'text-on-surface/55 hover:text-red-500 hover:bg-on-surface/[0.04]',
                      )}
                    >
                      <Heart size={17} className={p.liked ? 'fill-red-500' : ''} />
                      <span className="text-[12px] font-bold tabular-nums">{p.likesCount}</span>
                    </button>
                    <button
                      onClick={() => setOpenPostCommentsId(p.id)}
                      className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-full text-on-surface/55 hover:text-primary hover:bg-on-surface/[0.04] transition-colors"
                      aria-label="View comments"
                    >
                      <MessageSquare size={17} />
                      <span className="text-[12px] font-bold tabular-nums">{p.commentsCount}</span>
                    </button>
                    <div className="flex-1" />
                    <button
                      onClick={() => handleSharePost(p)}
                      className="inline-flex items-center justify-center w-9 h-9 rounded-full text-on-surface/55 hover:text-primary hover:bg-on-surface/[0.04] transition-colors"
                      aria-label="Share post"
                    >
                      <Share2 size={17} />
                    </button>
                    <button
                      onClick={() => handleSavePost(p.id, p.saved)}
                      className={cn(
                        'inline-flex items-center justify-center w-9 h-9 rounded-full transition-colors',
                        p.saved
                          ? 'text-amber-500 hover:bg-amber-500/5'
                          : 'text-on-surface/55 hover:text-amber-500 hover:bg-on-surface/[0.04]',
                      )}
                      aria-label={p.saved ? 'Unsave post' : 'Save post'}
                    >
                      <Bookmark size={17} className={p.saved ? 'fill-amber-500' : ''} />
                    </button>
                  </div>
                </article>
              </li>
            );
          }
          if (item.type === 'homeMeal') {
            const m = item.data;
            const mealTimeAgo = timeAgo(new Date(m.createdAt).toISOString());
            const summary = mealRatingSummaries[m.id];
            return (
              <li key={`meal-${m.id}`} className="border-b border-on-surface/[0.08] last:border-0 py-5">
                <article>
                  {/* Hero photo — only when a cover URL actually resolves */}
                  {!phoneMode && (
                    <ActivityPhoto
                      src={getMealCoverUrl(m)}
                      onClick={() => openFriendRecipe(m)}
                      aria={`View ${m.name}`}
                    />
                  )}

                  {/* Cook header */}
                  <div className="flex items-center gap-2.5">
                    <Link to={`/user/${getUsername(m.userId)}`} className="flex-shrink-0">
                      <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center">
                        <ChefHat size={14} className="text-emerald-700" />
                      </div>
                    </Link>
                    <div className="flex-1 min-w-0">
                      <Link to={`/user/${getUsername(m.userId)}`} className="text-[13px] font-bold hover:text-primary block truncate leading-tight">
                        {getName(m.userId)}
                      </Link>
                      <p className="text-[11px] text-emerald-700/85 font-semibold leading-tight mt-0.5">
                        Cooked at home <span className="mx-1.5 text-emerald-700/30">·</span>{mealTimeAgo}
                      </p>
                    </div>
                  </div>

                  {/* Meal block */}
                  <button
                    type="button"
                    onClick={() => openFriendRecipe(m)}
                    className="block w-full text-left mt-2.5 group focus-visible:outline-none"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-serif font-bold text-[19px] leading-[1.15] flex-1 min-w-0 line-clamp-2 group-hover:text-primary transition-colors">{m.name}</h3>
                      {summary && summary.count > 0 && (
                        <div className="flex-shrink-0 flex flex-col items-end gap-0.5 pt-0.5">
                          <div className="flex gap-0.5">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <Star key={n} size={12} className={cn(
                                n <= Math.round(summary.average) ? "text-amber-500 fill-amber-500" : "text-on-surface/15",
                              )} />
                            ))}
                          </div>
                          <span className="text-[13px] text-on-surface/55 font-bold tabular-nums">{summary.average.toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                    <p className="mt-1.5 text-[11.5px] text-on-surface/50 font-medium uppercase tracking-[0.08em] truncate">
                      {new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {m.dishes.length > 0 && <><span className="text-on-surface/25 mx-1.5">·</span>{m.dishes.length} dish{m.dishes.length !== 1 ? 'es' : ''}</>}
                    </p>
                    {m.description && (
                      <p className="mt-2 text-[14px] text-on-surface/70 italic leading-relaxed line-clamp-3">
                        &ldquo;{m.description}&rdquo;
                      </p>
                    )}
                    {m.tags.length > 0 && (
                      <div className="flex gap-1.5 mt-3 flex-wrap">
                        {m.tags.slice(0, 4).map((t) => (
                          <span key={t} className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700/85">{t}</span>
                        ))}
                      </div>
                    )}
                  </button>
                </article>
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
          <li key={r.id} className="border-b border-on-surface/[0.08] last:border-0 py-5">
            <article>
              {/* Hero photo (desktop only, and only when the URL resolves) */}
              {!phoneMode && (
                <ActivityPhoto
                  src={r.photo_url}
                  onClick={() => navigate(`/restaurant/${r.restaurant_id}`)}
                  aria={`View ${r.restaurant_name}`}
                />
              )}

              {/* Header row + right rail body — avatar/header is its own row,
                  then the restaurant content sits in a 2-column flex with
                  score / rate / wishlist stacked on the right. */}
              <div className="flex items-center gap-2.5 mb-3">
                <Link to={`/user/${getUsername(r.user_id)}`} className="flex-shrink-0">
                  <div className={cn("w-9 h-9 rounded-full flex items-center justify-center", color.bg)}>
                    <span className={cn("text-[13px] font-serif font-bold", color.text)}>{initial}</span>
                  </div>
                </Link>
                <p className="text-[12.5px] text-on-surface/60 leading-tight flex-1 min-w-0 truncate">
                  <Link to={`/user/${getUsername(r.user_id)}`} className="font-bold text-on-surface hover:text-primary">
                    {getName(r.user_id)}
                  </Link>
                  {profiles[r.user_id]?.is_expert ? (
                    <span className="inline-flex items-center gap-0.5 ml-1.5 text-amber-600 font-semibold">
                      <Star size={9} className="fill-amber-500 text-amber-500" />
                    </span>
                  ) : null}
                  <span className="ml-1.5">rated</span>
                  <span className="mx-1.5 text-on-surface/25">·</span>
                  <span className="text-on-surface/45">{timeAgo(r.created_at)}</span>
                </p>
              </div>

              <div className="flex gap-4">
                {/* Left: content (tappable) */}
                <button
                  type="button"
                  onClick={() => navigate(`/restaurant/${r.restaurant_id}`)}
                  className="block flex-1 min-w-0 text-left group focus-visible:outline-none"
                >
                  <h3 className="font-serif font-bold text-[22px] leading-[1.12] line-clamp-2 text-on-surface group-hover:text-primary transition-colors">
                    {r.restaurant_name}
                  </h3>
                  {(r.cuisine || r.price || r.address) && (
                    <p className="mt-1.5 text-[11.5px] text-on-surface/55 font-medium uppercase tracking-[0.08em] truncate">
                      {[r.cuisine, r.price, r.address?.split(',')[0]?.trim()].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {r.tags && r.tags.length > 0 && (
                    <div className="flex gap-1.5 mt-3 flex-wrap">
                      {r.tags.slice(0, 4).map((t) => (
                        <span key={t} className="text-[12px] px-2.5 py-0.5 rounded-full bg-primary/[0.09] text-primary/80 font-medium">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  {r.notes && (
                    <p className="mt-3 text-[14.5px] text-on-surface/70 italic leading-relaxed line-clamp-3 border-l-2 border-primary/45 pl-3">
                      {r.notes}
                    </p>
                  )}
                </button>

                {/* Right rail: score + rate + wishlist stacked */}
                <div className="flex-shrink-0 flex flex-col items-center gap-3 pt-0.5">
                  <ScoreBadge rating={Number(r.score)} size="xl" />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); openAddRestaurantModal(meta); }}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-full text-on-surface/55 hover:text-primary hover:bg-on-surface/[0.04] transition-colors"
                    aria-label="Rate this restaurant"
                  >
                    <Plus size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleWishlist(meta); }}
                    className={cn(
                      'inline-flex items-center justify-center w-9 h-9 rounded-full transition-colors',
                      wishlisted
                        ? 'text-red-500 hover:bg-red-500/5'
                        : 'text-on-surface/55 hover:text-red-500 hover:bg-on-surface/[0.04]',
                    )}
                    aria-label={wishlisted ? 'In wishlist' : 'Add to wishlist'}
                  >
                    <Heart size={18} className={wishlisted ? 'fill-red-500' : ''} />
                  </button>
                </div>
              </div>

              {/* Bottom row: like + comment counts (flat, no top border) */}
              <div className="flex items-center gap-1 mt-3 -ml-2">
                <button
                  onClick={() => handleLike(r.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 h-9 px-2.5 rounded-full transition-colors",
                    userLiked.has(r.id)
                      ? "text-red-500"
                      : "text-on-surface/55 hover:text-red-500 hover:bg-on-surface/[0.04]"
                  )}
                >
                  <Heart size={17} className={userLiked.has(r.id) ? 'fill-red-500' : ''} />
                  <span className="text-[12px] font-bold tabular-nums">{likes[r.id] || 0}</span>
                </button>
                <button
                  onClick={() => handleOpenComments(r.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 h-9 px-2.5 rounded-full transition-colors",
                    openComments === r.id
                      ? "text-primary"
                      : "text-on-surface/55 hover:text-primary hover:bg-on-surface/[0.04]"
                  )}
                >
                  <MessageSquare size={17} />
                  <span className="text-[12px] font-bold tabular-nums">{commentCounts[r.id] || 0}</span>
                </button>
              </div>

              {/* Comments — nested INSIDE the card as an indented subsection.
                  Replies are collapsed by default behind a YouTube-style
                  "View N replies" toggle on the parent. */}
              <AnimatePresence>
                {openComments === r.id && (() => {
                  const topLevel = comments.filter((c) => !c.parent_id);
                  const repliesByParent: Record<string, ActivityComment[]> = {};
                  comments.forEach((c) => {
                    if (c.parent_id) {
                      (repliesByParent[c.parent_id] ||= []).push(c);
                    }
                  });

                  const renderCommentRow = (c: ActivityComment, isReply: boolean): React.ReactNode => {
                    const cColor = avatarColor(c.user_id);
                    const profile = commentProfiles[c.user_id];
                    const cInitial = initialOf(profile?.display_name || 'User');
                    const replies = !isReply ? (repliesByParent[c.id] || []) : [];
                    const expanded = expandedThreads.has(c.id);
                    const replying = replyingTo === c.id;
                    return (
                      <li key={c.id}>
                        <div className="flex gap-2.5">
                          <Link to={`/user/${profile?.username || ''}`} className="flex-shrink-0">
                            <div className={cn(
                              'rounded-full flex items-center justify-center',
                              isReply ? 'w-6 h-6' : 'w-8 h-8',
                              cColor.bg,
                            )}>
                              <span className={cn('font-serif font-bold', isReply ? 'text-[10px]' : 'text-[12px]', cColor.text)}>{cInitial}</span>
                            </div>
                          </Link>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <Link to={`/user/${profile?.username || ''}`} className="text-[12.5px] font-semibold text-on-surface/85 hover:text-primary leading-tight">
                                {profile?.display_name || 'User'}
                              </Link>
                              <span className="text-[11px] text-on-surface/35 leading-tight">{timeAgo(c.created_at)}</span>
                            </div>
                            <p className="text-[13px] text-on-surface/75 mt-0.5 leading-relaxed whitespace-pre-wrap break-words">
                              {c.text}
                            </p>
                            <div className="flex items-center gap-1 mt-1 -ml-1.5">
                              <button
                                type="button"
                                onClick={() => handleToggleCommentLike(c.id)}
                                className={cn(
                                  'inline-flex items-center gap-1 h-7 px-1.5 rounded-full text-[11.5px] font-semibold transition-colors',
                                  c.liked_by_me
                                    ? 'text-red-500'
                                    : 'text-on-surface/55 hover:text-red-500 hover:bg-on-surface/[0.04]',
                                )}
                                aria-label={c.liked_by_me ? 'Unlike' : 'Like'}
                              >
                                <Heart size={13} className={c.liked_by_me ? 'fill-red-500' : ''} />
                                {(c.like_count || 0) > 0 && <span className="tabular-nums">{c.like_count}</span>}
                              </button>
                              {!isReply && (
                                <button
                                  type="button"
                                  onClick={() => startReply(c.id)}
                                  className={cn(
                                    'h-7 px-2 rounded-full text-[11.5px] font-semibold transition-colors',
                                    replying ? 'text-primary' : 'text-on-surface/55 hover:text-primary hover:bg-on-surface/[0.04]',
                                  )}
                                >
                                  Reply
                                </button>
                              )}
                            </div>

                            {/* Inline reply composer */}
                            {!isReply && replying && (
                              <div className="flex items-center gap-2 mt-2">
                                <input
                                  type="text"
                                  value={replyText}
                                  onChange={(e) => setReplyText(e.target.value)}
                                  placeholder={`Reply to ${profile?.display_name || 'User'}…`}
                                  autoFocus
                                  className="flex-1 bg-on-surface/[0.04] rounded-full h-9 px-3.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-primary/30"
                                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddReply(r.id, c.id); }}
                                />
                                <button
                                  type="button"
                                  onClick={() => handleAddReply(r.id, c.id)}
                                  disabled={!replyText.trim()}
                                  className="inline-flex items-center justify-center w-9 h-9 rounded-full text-primary disabled:text-on-surface/20 hover:bg-primary/5 transition-colors"
                                  aria-label="Post reply"
                                >
                                  <Send size={15} />
                                </button>
                              </div>
                            )}

                            {/* YouTube-style "View N replies" toggle */}
                            {!isReply && replies.length > 0 && (
                              <button
                                type="button"
                                onClick={() => toggleThread(c.id)}
                                className="mt-2 inline-flex items-center gap-1 h-7 pl-1.5 pr-2.5 rounded-full bg-primary/[0.06] hover:bg-primary/[0.12] text-primary text-[11.5px] font-bold transition-colors"
                              >
                                <ChevronDown size={13} className={cn('transition-transform', expanded && 'rotate-180')} />
                                {expanded
                                  ? 'Hide replies'
                                  : `View ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
                              </button>
                            )}

                            {/* Replies thread — indented under the parent */}
                            <AnimatePresence>
                              {!isReply && expanded && replies.length > 0 && (
                                <motion.ul
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden mt-3 space-y-3"
                                >
                                  {replies.map((reply) => renderCommentRow(reply, true))}
                                </motion.ul>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      </li>
                    );
                  };

                  return (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-4 pt-4 pl-8 sm:pl-12 border-t border-on-surface/[0.06]">
                        {/* New top-level comment composer */}
                        <div className="flex items-center gap-2 mb-4">
                          <input
                            type="text"
                            value={newComment}
                            onChange={(e) => setNewComment(e.target.value)}
                            placeholder="Add a comment…"
                            className="flex-1 bg-on-surface/[0.04] rounded-full h-10 px-4 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/30"
                            onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment(r.id); }}
                          />
                          <button
                            type="button"
                            onClick={() => handleAddComment(r.id)}
                            disabled={!newComment.trim()}
                            className="inline-flex items-center justify-center w-10 h-10 rounded-full text-primary disabled:text-on-surface/20 hover:bg-primary/5 transition-colors"
                            aria-label="Post comment"
                          >
                            <Send size={17} />
                          </button>
                        </div>

                        {/* Comments list */}
                        {commentsLoading ? (
                          <div className="space-y-2 py-1">
                            <div className="animate-pulse bg-on-surface/[0.06] rounded h-3 w-4/5" />
                            <div className="animate-pulse bg-on-surface/[0.06] rounded h-3 w-3/5" />
                          </div>
                        ) : topLevel.length === 0 ? (
                          <p className="text-[12.5px] text-on-surface/40 py-1">No comments yet — be the first.</p>
                        ) : (
                          <ul className="space-y-3">
                            {topLevel.map((c) => renderCommentRow(c, false))}
                          </ul>
                        )}
                      </div>
                    </motion.div>
                  );
                })()}
              </AnimatePresence>
            </article>
          </li>
          );
        })}
      </ul>
      )}
        </div>
        {!phoneMode && (
          <aside className="hidden xl:block xl:sticky xl:top-4 xl:pt-12 xl:self-start xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1">
            <SuggestionsRail userId={userId} friendIds={friendIds} />
          </aside>
        )}
      </div>

      <ShareRecipeSheet
        open={!!shareRecipeData}
        recipe={shareRecipeData}
        onClose={() => setShareRecipeData(null)}
      />

      {/* ─── Post comments overlay ─────────────────────────────────────
          Mobile/phone-frame: bottom sheet (Instagram-style). Desktop:
          centered modal dialog. Both wrap the same CommentsBody so the
          composer + list logic is shared with the reels page. */}
      <AnimatePresence>
        {openPostCommentsId && (
          isDesktop ? (
            <motion.div
              key="post-comments-modal"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm flex items-center justify-center px-4"
              onClick={() => setOpenPostCommentsId(null)}
            >
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                transition={{ type: 'spring', damping: 26, stiffness: 280 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-[440px] h-[min(640px,80vh)] bg-surface rounded-2xl shadow-2xl border border-on-surface/[0.08] overflow-hidden flex flex-col"
              >
                <CommentsBody
                  targetId={openPostCommentsId}
                  onClose={() => setOpenPostCommentsId(null)}
                  variant="panel"
                  loadComments={loadPostCommentsAdapter}
                  addComment={addPostCommentAdapter}
                  deleteComment={deletePostCommentAdapter}
                  currentUserId={userId}
                />
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              key="post-comments-sheet"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-end"
              onClick={() => setOpenPostCommentsId(null)}
            >
              <motion.div
                initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white w-full rounded-t-3xl flex flex-col"
                style={{ height: '75%' }}
              >
                <div className="pt-2 pb-1 flex justify-center">
                  <span className="w-10 h-1 rounded-full bg-stone-300" />
                </div>
                <CommentsBody
                  targetId={openPostCommentsId}
                  onClose={() => setOpenPostCommentsId(null)}
                  variant="sheet"
                  loadComments={loadPostCommentsAdapter}
                  addComment={addPostCommentAdapter}
                  deleteComment={deletePostCommentAdapter}
                  currentUserId={userId}
                />
              </motion.div>
            </motion.div>
          )
        )}
      </AnimatePresence>

      {/* Restaurant detail — mobile/phone-frame sheet variant only.
          Desktop taps navigate to the full /restaurant page instead. */}
      {!isDesktop && (
        <RestaurantPanel
          variant="sheet"
          snapshot={restaurantPanelSnap}
          onClose={() => setRestaurantPanelSnap(null)}
          currentUserId={userId}
        />
      )}

      {/* Share dialog */}
      <ShareDialog
        open={!!sharePayload}
        payload={sharePayload}
        onClose={() => setSharePayload(null)}
      />
    </section>
  );
};
