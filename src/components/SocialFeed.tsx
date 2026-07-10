import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Heart, MessageSquare, Send, ChefHat, Plus, Star, ChevronDown, ChevronRight, BookOpen, Share2, Bookmark, X, MapPin } from 'lucide-react';
import { ShareRecipeSheet } from './ShareRecipeSheet';
import { ShareDialog } from './ShareDialog';
import { CommentsBody } from '../pages/Reels';
import { RestaurantPanel, type RestaurantPanelSnapshot } from './RestaurantPanel';
import type { SharedRecipe, SharePayload } from '../contexts/ChatContext';
import { usePosts } from '../contexts/PostsContext';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { ScoreBadge } from './ScoreBadge';
import { ScoreRing } from './cards';
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
import { toggleRecipeLike, getRecipeLikes, getRecipeCommentCounts } from '../lib/supabase-recipes';
import { RecipeCommentThread } from './RecipeCommentThread';
import { useSignInModal } from '../contexts/SignInModalContext';
import { getReviewSummariesBatch } from '../lib/supabase-home-meal-reviews';
import { EmptyState } from './EmptyState';
import { useBottomSheet } from '../lib/useBottomSheet';

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
  /** Absolutely-positioned layer over the photo (e.g. the score ring). */
  overlay?: React.ReactNode;
  /** Phone feed: bleed to the viewport edges, square corners (Instagram). */
  flush?: boolean;
}> = ({ src, onClick, aria, overlay, flush = false }) => {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    // Desktop: cap to the same narrower centered column as post photos
    // (PostMediaCarousel) so recipe/restaurant images don't dominate the
    // card now that the feed list is wider than an instagram column.
    // Phone (flush): full-bleed to the card edges.
    <div className={cn('relative mt-3 mb-3', flush ? '-mx-3' : 'lg:mx-auto lg:max-w-[420px]')}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'block w-full aspect-[4/3] overflow-hidden bg-on-surface/[0.05] group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          !flush && 'rounded-2xl',
        )}
        aria-label={aria}
      >
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth === 0) setFailed(true);
          }}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          referrerPolicy="no-referrer"
        />
      </button>
      {overlay && <div className="pointer-events-none absolute inset-0">{overlay}</div>}
    </div>
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
  items: { id: string; mediaType: 'photo' | 'video'; mediaUrl: string; caption?: string }[];
  /** Phone feed: bleed exactly to the px-3 container edges. */
  flush?: boolean;
}> = ({ items, flush = false }) => {
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
    <div className={cn('relative mt-3 mb-1 select-none lg:mx-auto lg:max-w-[420px] lg:rounded-2xl lg:overflow-hidden', flush ? '-mx-3' : '-mx-4')}>
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide"
        style={{ scrollbarWidth: 'none' }}
      >
        {visible.map((it) => (
          // Plain slide (not a button) so a horizontal swipe scrolls cleanly
          // and a tap never navigates away to the reels viewer.
          <div
            key={it.id}
            className="relative w-full flex-shrink-0 snap-center aspect-square overflow-hidden bg-on-surface/[0.04]"
          >
            <img
              src={it.mediaUrl}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setFailed((prev) => new Set(prev).add(it.id))}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth === 0) setFailed((prev) => new Set(prev).add(it.id));
              }}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
              draggable={false}
            />
            {/* Per-image caption (when the author added one) — overlaid on the
                photo it belongs to so it updates as you swipe. Doesn't capture
                taps, so it never blocks scrolling. */}
            {it.caption?.trim() && (
              <>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/65 via-black/20 to-transparent" />
                <p className={cn(
                  'pointer-events-none absolute inset-x-0 bottom-0 px-4 pt-6 text-white text-[13.5px] font-medium leading-snug line-clamp-3 drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]',
                  visible.length > 1 ? 'pb-7' : 'pb-3.5',
                )}>
                  {it.caption}
                </p>
              </>
            )}
          </div>
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
                'rounded-full transition-all w-1.5 h-1.5',
                i === activeIdx ? 'bg-white' : 'bg-white/50',
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
  suggestedRestaurants?: SuggestedRestaurant[];
}> = ({ userId, friendIds, suggestedRestaurants = [] }) => {
  const [suggested, setSuggested] = useState<UserProfile[]>([]);
  const navigate = useNavigate();
  const { isWishlisted } = useLists();

  useEffect(() => {
    let cancelled = false;
    getExpertProfiles().then((profiles) => {
      if (cancelled) return;
      const filtered = profiles.filter((p) => p.user_id !== userId && !friendIds.has(p.user_id));
      setSuggested(filtered.slice(0, 5));
    });
    return () => { cancelled = true; };
  }, [userId, friendIds]);

  // Build the "why" line for each restaurant card — derived from the
  // viewer's wishlist + the restaurant's metadata so the line feels
  // personal (vs a generic "Trending near you").
  // Cap the rail short enough to fit the viewport without scrolling
  // — the user shouldn't have to scroll a sidebar that's sticky.
  const restaurantCards = suggestedRestaurants.slice(0, 3).map((r) => {
    const reasons: string[] = [];
    if (isWishlisted(r.id)) reasons.push('Saved to your list');
    else if (r.rating && r.rating >= 4.6) reasons.push('Highly rated near you');
    else reasons.push("What's hot in your area");
    const neighborhood = r.address?.split(',').slice(-3, -2)?.[0]?.trim();
    if (neighborhood) reasons.push(neighborhood);
    return { ...r, why: reasons.slice(0, 2).join(' · ') };
  });

  return (
    <aside className="space-y-9">
      {/* People to follow — rendered as editorial cards (matches the
          Gourmet Canvas mock's rail-suggestion pattern). */}
      <section>
        <div className="flex items-center justify-between mb-3.5">
          <h4 className="text-[11px] font-bold uppercase tracking-[0.13em] text-on-surface/65">Suggested for you</h4>
          <Link to="/circle" className="text-[12px] font-semibold text-primary hover:underline underline-offset-2">See all</Link>
        </div>
        {/* Prefer restaurant cards (Gourmet Canvas style) when the parent
            page has supplied them; fall back to people-to-follow when
            there's nothing else to show. */}
        {restaurantCards.length > 0 ? (
          <ul className="space-y-2">
            {restaurantCards.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/restaurant/${r.id}`)}
                  className="w-full text-left block rounded-2xl bg-white border border-on-surface/[0.08] px-3.5 py-3 transition-all hover:-translate-y-px hover:border-on-surface/15 group"
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="min-w-0">
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-primary truncate block">
                        {r.cuisine || 'Restaurant'}
                      </span>
                      <h5 className="mt-0.5 font-serif font-semibold text-[16px] text-on-surface leading-[1.18] tracking-[-0.015em] line-clamp-1 group-hover:text-primary transition-colors">
                        {r.name}
                      </h5>
                      <p className="text-[12px] text-on-surface/55 mt-1 leading-[1.4] line-clamp-2">
                        {r.why}
                      </p>
                    </div>
                    {/* Unified score circle (Google /5 → /10) — no more stars. */}
                    <ScoreRing score={r.rating != null && r.rating > 0 ? r.rating * 2 : undefined} size={38} className="mt-0.5" />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : suggested.length === 0 ? (
          <p className="text-[12.5px] text-on-surface/40">No suggestions right now.</p>
        ) : (
          <ul className="space-y-2">
            {suggested.map((p) => {
              const color = avatarColor(p.user_id);
              const initial = initialOf(p.display_name || p.username);
              return (
                <li key={p.user_id}>
                  <Link
                    to={`/user/${p.username}`}
                    className="block rounded-2xl bg-white border border-on-surface/[0.08] px-3.5 py-3 transition-all hover:-translate-y-px hover:border-on-surface/15 group"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className={cn(
                        'inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.1em]',
                        p.is_expert ? 'text-amber-600' : 'text-primary',
                      )}>
                        {p.is_expert ? (
                          <>
                            <Star size={10} className="fill-amber-500 text-amber-500" />
                            Expert
                          </>
                        ) : 'Friend pick'}
                      </span>
                      <span className="text-[11px] font-bold text-primary group-hover:underline underline-offset-2 flex-shrink-0">
                        Follow
                      </span>
                    </div>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={cn('w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0', color.bg)}>
                        <span className={cn('text-[12px] font-serif font-bold', color.text)}>{initial}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-serif font-semibold text-[15px] text-on-surface leading-[1.2] truncate group-hover:text-primary transition-colors">
                          {p.display_name || p.username}
                        </p>
                        <p className="text-[11.5px] text-on-surface/55 truncate mt-0.5">
                          @{p.username || 'user'}
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Featured guides — slim list rows with a cover icon and a
          serif title, exactly like the mock's rail-guide treatment. */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[11px] font-bold uppercase tracking-[0.13em] text-on-surface/65">Featured guides</h4>
          <Link to="/discover" className="text-[12px] font-semibold text-primary hover:underline underline-offset-2">Browse</Link>
        </div>
        <ul>
          {SUGGESTION_GUIDES.slice(0, 2).map((g) => (
            <li key={g.id}>
              <button
                type="button"
                className="w-full flex items-center gap-3 text-left group py-2 px-2 -mx-2 rounded-xl hover:bg-on-surface/[0.04] transition-colors"
              >
                <div className="w-12 h-12 rounded-xl bg-on-surface flex items-center justify-center flex-shrink-0">
                  <BookOpen size={17} className="text-surface" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-serif font-semibold text-on-surface leading-[1.2] line-clamp-1 group-hover:text-primary transition-colors tracking-[-0.01em]">
                    {g.title}
                  </p>
                  <p className="text-[11.5px] text-on-surface/55 truncate mt-0.5">
                    by {g.author} · {g.spots} spots
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>
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

export interface SuggestedRestaurant {
  id: string;
  name: string;
  cuisine: string;
  rating: number | null;
  address: string;
  price: string;
  photoUrl?: string;
}

interface SocialFeedProps {
  /** Distance-sort anchor. When set, friend activity sorts by proximity. */
  centerLat?: number | null;
  centerLng?: number | null;
  /** Restaurant cards to show in the right rail's "Suggested for you"
   *  section. When empty, the rail falls back to people-to-follow. */
  suggestedRestaurants?: SuggestedRestaurant[];
  /** Feed-only mode: suppress the internal desktop sidebar and the
   *  two-column wrapper so a parent page can own the columns. Also renders
   *  a quiet empty state (instead of nothing) when there's no activity, so
   *  the parent's column never collapses. */
  feedOnly?: boolean;
  /** Optional node interleaved into the feed after `afterIndex` items —
   *  Discover slides its guides rail in here, Instagram-style. */
  inlineSlot?: { afterIndex: number; node: React.ReactNode };
}

export const SocialFeed: React.FC<SocialFeedProps> = ({ centerLat = null, centerLng = null, suggestedRestaurants = [], feedOnly = false, inlineSlot }) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { requireSignIn } = useSignInModal();
  const navigate = useNavigate();
  const { phoneMode, setHideBottomNav } = useSettings();
  const { openAddRestaurantModal, toggleWishlist, isWishlisted, homeMeals: myHomeMeals, addRecipeToCookbook, removeRecipeFromCookbook } = useLists();

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
  const { dragProps: postCommentsDragProps } = useBottomSheet(!!openPostCommentsId, () => setOpenPostCommentsId(null));
  // Ratings authored by experts the user follows. Loaded lazily the first
  // time the Experts filter is opened.
  const [expertActivity, setExpertActivity] = useState<CommunityRating[]>([]);
  const [expertLoading, setExpertLoading] = useState(false);
  const [expertLoaded, setExpertLoaded] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [likes, setLikes] = useState<Record<string, number>>({});
  const [userLiked, setUserLiked] = useState<Set<string>>(new Set());
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});

  // Real likes + comment counts for the cooking-feed recipe cards, backed by
  // recipe_likes / recipe_comments (fetched in loadFeed). Save persists to the
  // user's own cookbook via ListsContext.
  const [mealLikedByMe, setMealLikedByMe] = useState<Set<string>>(new Set());
  const [mealLikeCounts, setMealLikeCounts] = useState<Record<string, number>>({});
  const [mealCommentCounts, setMealCommentCounts] = useState<Record<string, number>>({});
  const [openMealComments, setOpenMealComments] = useState<FriendHomeMeal | null>(null);

  const toggleMealLike = useCallback((mealId: string) => {
    if (!userId) { requireSignIn('Sign in to like'); return; }
    const wasLiked = mealLikedByMe.has(mealId);
    setMealLikedByMe((prev) => { const n = new Set(prev); if (wasLiked) n.delete(mealId); else n.add(mealId); return n; });
    setMealLikeCounts((prev) => ({ ...prev, [mealId]: Math.max(0, (prev[mealId] || 0) + (wasLiked ? -1 : 1)) }));
    void toggleRecipeLike(userId, mealId);
  }, [userId, mealLikedByMe, requireSignIn]);

  const toggleMealSave = useCallback((meal: FriendHomeMeal) => {
    if (!userId) { requireSignIn('Sign in to save'); return; }
    if (myHomeMeals.some((x) => x.id === meal.id)) removeRecipeFromCookbook(meal.id);
    else addRecipeToCookbook(meal);
  }, [userId, myHomeMeals, addRecipeToCookbook, removeRecipeFromCookbook, requireSignIn]);
  const [mealRatingSummaries, setMealRatingSummaries] = useState<Record<string, { average: number; count: number }>>({});
  const [shareRecipeData, setShareRecipeData] = useState<SharedRecipe | null>(null);
  const [loading, setLoading] = useState(true);
  // Hoisted earlier than the header UI so the feedItems merge below can
  // switch its sources based on the current tab. Posts = friends' photo
  // posts; Activity = everything friends (or followed experts) have added:
  // restaurant ratings + home-cooked recipes.
  const [feedTab, setFeedTab] = useState<'posts' | 'activity'>('posts');
  const [activityFilter, setActivityFilter] = useState<'friends' | 'experts'>('friends');

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

  const { dragProps: recipeCommentsDragProps } = useBottomSheet(!!openMealComments, () => setOpenMealComments(null));

  // Hide the bottom nav while any comment popup is open (recipe, post, or the
  // inline restaurant thread) so the sheet reads as a focused overlay.
  useEffect(() => {
    const open = !!openMealComments || !!openPostCommentsId || !!openComments || !!restaurantPanelSnap;
    setHideBottomNav(open);
    return () => setHideBottomNav(false);
  }, [openMealComments, openPostCommentsId, openComments, restaurantPanelSnap, setHideBottomNav]);

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
    // Real likes + comment counts for the cooking-feed recipe cards.
    if (meals.length > 0) {
      const mealIds = meals.map((m) => m.id);
      void Promise.all([getRecipeLikes(userId, mealIds), getRecipeCommentCounts(mealIds)])
        .then(([likeData, commentCounts]) => {
          setMealLikeCounts(likeData.likes);
          setMealLikedByMe(likeData.userLiked);
          setMealCommentCounts(commentCounts);
        });
    }
    // listPosts resolves null when the fetch failed; keep whatever the
    // feed already showed rather than wiping it to a false empty state.
    if (allPosts) setPosts(allPosts.filter((p) => friendIdSet.has(p.userId)));

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

  // Merge and sort feed items by recency. Posts shows friends' photo
  // posts; Activity shows friend ratings + home-cooked recipes, or followed
  // experts' ratings when the Experts filter is on (experts publish via
  // ratings).
  const ratingSource = feedTab === 'activity' ? (activityFilter === 'experts' ? expertActivity : activity) : [];
  const mealSource = feedTab === 'activity' && activityFilter === 'friends' ? homeMeals : [];
  const postSource = feedTab === 'posts' ? posts : [];
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
    // null = fetch failed; CommentsBody shows its retry state for that.
    if (!rows) return null;
    return rows.map((c) => ({ id: c.id, userId: c.userId, body: c.body, createdAt: c.createdAt, parentId: c.parentId, author: c.author }));
  }, [loadPostComments]);
  const addPostCommentAdapter = useCallback(async (postId: string, body: string, parentId?: string | null) => {
    const c = await addPostComment(postId, body, parentId);
    if (!c) return null;
    // Bump the local post's comment count so the badge updates without a refetch.
    setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, commentsCount: p.commentsCount + 1 } : p));
    return { id: c.id, userId: c.userId, body: c.body, createdAt: c.createdAt, parentId: c.parentId, author: c.author };
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

  // Lazy-load expert ratings the first time the Experts filter is opened.
  // Subsequent switches reuse what's already in state.
  useEffect(() => {
    if (feedTab === 'activity' && activityFilter === 'experts' && !expertLoaded && !expertLoading) loadExperts();
  }, [feedTab, activityFilter, expertLoaded, expertLoading, loadExperts]);

  const SectionHeader: React.FC = () => (
    <div className="mb-3">
      {/* One switch, two meanings: Posts = photo posts; Activity = every
          restaurant + recipe your people have added. Desktop keeps the
          header to a single compact row — title + live dot left, slim
          right-aligned tabs — so it doesn't tower over the feed. Phone
          keeps the full-width tab bar (its title lives in the page chrome). */}
      {!phoneMode ? (
        <div className="flex items-center justify-between gap-4 border-b border-on-surface/[0.07] pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="truncate text-[19px] font-bold font-serif tracking-[-0.02em]">From your circle</span>
            <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            <span className="text-[11.5px] font-semibold text-emerald-600 flex-shrink-0">Live</span>
          </div>
          <div className="flex flex-shrink-0 items-center gap-0.5 rounded-full bg-on-surface/[0.045] p-0.5">
            {([['posts', 'Posts'], ['activity', 'Activity']] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFeedTab(key)}
                aria-pressed={feedTab === key}
                className={cn(
                  'rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors whitespace-nowrap',
                  feedTab === key ? 'bg-paper text-on-surface shadow-sm' : 'text-on-surface/55 hover:text-on-surface',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex h-10 rounded-full bg-on-surface/[0.05] p-1">
          {([['posts', 'Posts'], ['activity', 'Activity']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFeedTab(key)}
              aria-pressed={feedTab === key}
              className={cn(
                'flex-1 rounded-full text-[13.5px] font-semibold transition-colors',
                feedTab === key ? 'bg-paper text-on-surface shadow-sm' : 'text-on-surface/55',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {feedTab === 'activity' && (
        <div className="mt-2.5 flex gap-2">
          {([['friends', 'Friends'], ['experts', 'Experts']] as const).map(([key, label]) => {
            const active = activityFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActivityFilter(key)}
                aria-pressed={active}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-semibold transition-colors',
                  active ? 'bg-on-surface text-surface border-on-surface' : 'text-on-surface/60 border-on-surface/15',
                )}
              >
                {key === 'experts' && <Star size={12} className="fill-amber-500 text-amber-500" />}
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <section className="mb-2">
        <div className={cn(
          !phoneMode && !feedOnly && 'xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-14 xl:items-start',
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
          {!phoneMode && !feedOnly && (
            <aside className="hidden xl:block xl:sticky xl:top-4 xl:pt-12 xl:self-start">
              <SuggestionsRail userId={userId} friendIds={friendIds} suggestedRestaurants={suggestedRestaurants} />
            </aside>
          )}
        </div>
      </section>
    );
  }
  // Interleave the optional inline slot (the Discover guides rail) after
  // the requested number of feed items; when the feed is short or empty it
  // lands at the end / above the empty state so it stays reachable.
  type FeedRow = { kind: 'item'; item: FeedItem } | { kind: 'slot' };
  const feedRows: FeedRow[] = feedItems.map((item) => ({ kind: 'item' as const, item }));
  if (inlineSlot) feedRows.splice(Math.min(Math.max(inlineSlot.afterIndex, 0), feedRows.length), 0, { kind: 'slot' });

  return (
    <section className="mb-2">
      <div className={cn(
        !phoneMode && !feedOnly && 'xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-14 xl:items-start',
      )}>
        <div className="xl:min-w-0">
      <SectionHeader />
      {feedTab === 'activity' && activityFilter === 'experts' && expertLoading ? (
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
      ) : feedItems.length === 0 ? (
        <>
          {inlineSlot && (
            <div className="border-b border-on-surface/[0.08] py-4">{inlineSlot.node}</div>
          )}
          {feedTab === 'posts' ? (
            <div className="mt-2 rounded-2xl border border-dashed border-on-surface/15 bg-on-surface/[0.02] py-12 px-6 text-center">
              <p className="text-[14px] font-semibold text-on-surface/55">No photo posts from friends yet</p>
              <p className="mt-1 text-[12.5px] text-on-surface/40">When people you follow share photos, they'll show up here.</p>
              <Link to="/circle" className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline underline-offset-2">
                Find people to follow
              </Link>
            </div>
          ) : activityFilter === 'experts' ? (
            <EmptyState
              icon={<Star size={48} className="fill-amber-400 text-amber-400" />}
              heading="No expert picks yet"
              description="Follow critics, chefs, and writers to see their ratings show up here."
            />
          ) : (
            <div className="mt-2 rounded-2xl border border-dashed border-on-surface/15 bg-on-surface/[0.02] py-12 px-6 text-center">
              <p className="text-[14px] font-semibold text-on-surface/55">No activity from your circle yet</p>
              <p className="mt-1 text-[12.5px] text-on-surface/40">Follow friends and tastemakers to see where they're eating and cooking.</p>
              <Link to="/circle" className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline underline-offset-2">
                Find people to follow
              </Link>
            </div>
          )}
        </>
      ) : (
      <ul>
        {feedRows.map((row) => {
          if (row.kind === 'slot') {
            return (
              <li key="inline-slot" className="border-b border-on-surface/[0.08] py-4">
                {inlineSlot!.node}
              </li>
            );
          }
          const item = row.item;
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
            const recipeMeta = recipe
              ? [
                  ((recipe.prepTime || 0) + (recipe.cookTime || 0)) > 0 ? `${(recipe.prepTime || 0) + (recipe.cookTime || 0)} min` : '',
                  recipe.servings > 0 ? `${recipe.servings} servings` : '',
                  recipe.difficulty,
                ].filter(Boolean).join(' · ')
              : '';
            return (
              <li key={`post-${p.id}`} className={cn('border-b border-on-surface/[0.08] last:border-0', phoneMode ? 'py-4' : 'py-5')}>
                <article>
                  {/* Author header */}
                  <div className="flex items-center gap-3">
                    <Link to={`/user/${authorUsername}`} className="flex-shrink-0">
                      <div className={cn(
                        'w-9 h-9 rounded-full flex items-center justify-center text-white text-[12px] font-bold',
                        author?.avatarColor || 'bg-stone-700',
                      )}>
                        {author?.initials || 'U'}
                      </div>
                    </Link>
                    <div className="flex-1 min-w-0">
                      <Link to={`/user/${authorUsername}`} className="text-[14px] font-bold hover:text-primary block truncate leading-tight">
                        {displayName}
                      </Link>
                      <p className="mt-0.5 text-[12px] text-on-surface/45 leading-tight">Posted · {postTimeAgo}</p>
                    </div>
                  </div>

                  {/* Photo carousel (Instagram-style) — only photos for
                      now per design choice. Videos still play in the
                      dedicated reels viewer. */}
                  <PostMediaCarousel items={p.items} flush={phoneMode} />

                  {/* Action row — directly beneath the image (Instagram-style):
                      like / comment on the left, share + save on the right. */}
                  <div className="flex items-center gap-1 mt-2 -ml-1">
                    <button
                      onClick={() => handleLikePost(p.id, p.liked)}
                      className={cn(
                        'inline-flex items-center gap-1.5 h-9 px-2.5 rounded-full transition-colors',
                        p.liked
                          ? 'text-red-500'
                          : 'text-on-surface/55 hover:text-red-500 hover:bg-on-surface/[0.04]',
                      )}
                    >
                      <Heart size={18} className={p.liked ? 'fill-red-500' : ''} />
                      <span className="text-[12.5px] font-bold tabular-nums">{p.likesCount}</span>
                    </button>
                    <button
                      onClick={() => setOpenPostCommentsId(p.id)}
                      className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-full text-on-surface/55 hover:text-primary hover:bg-on-surface/[0.04] transition-colors"
                      aria-label="View comments"
                    >
                      <MessageSquare size={18} />
                      <span className="text-[12.5px] font-bold tabular-nums">{p.commentsCount}</span>
                    </button>
                    <div className="flex-1" />
                    <button
                      onClick={() => handleSharePost(p)}
                      className="inline-flex items-center justify-center w-9 h-9 rounded-full text-on-surface/55 hover:text-primary hover:bg-on-surface/[0.04] transition-colors"
                      aria-label="Share post"
                    >
                      <Share2 size={18} />
                    </button>
                    <button
                      onClick={() => handleSavePost(p.id, p.saved)}
                      className={cn(
                        'inline-flex items-center justify-center w-9 h-9 rounded-full transition-colors',
                        p.saved
                          ? 'text-primary hover:bg-primary/5'
                          : 'text-on-surface/55 hover:text-primary hover:bg-on-surface/[0.04]',
                      )}
                      aria-label={p.saved ? 'Unsave post' : 'Save post'}
                    >
                      <Bookmark size={18} className={p.saved ? 'fill-primary' : ''} />
                    </button>
                  </div>

                  {/* Title, location, and the featured place / recipe. */}
                  <div className="mt-2">
                    {p.caption && (
                      <h3 className="font-serif font-semibold text-[20px] leading-[1.18] tracking-[-0.015em] text-on-surface line-clamp-4">
                        {p.caption}
                      </h3>
                    )}
                    {p.locationLabel && (
                      <p className="mt-1 flex items-center gap-1 text-[12.5px] text-on-surface/50 font-medium">
                        <MapPin size={13} strokeWidth={2.2} className="-ml-0.5 flex-shrink-0 text-on-surface/40" />
                        <span className="truncate">{p.locationLabel}</span>
                      </p>
                    )}

                    {/* Featured restaurant — name + meta + score, no thumbnail. */}
                    {restaurant && (
                      <button
                        type="button"
                        onClick={() => handleFeaturedPlaceClick(restaurant)}
                        className="mt-3 w-full flex items-center gap-3 rounded-2xl border border-on-surface/[0.07] bg-on-surface/[0.025] px-3.5 py-3 text-left hover:bg-on-surface/[0.05] hover:border-on-surface/[0.12] transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-on-surface/40">Featured place</p>
                          <p className="mt-0.5 font-serif font-bold text-[15.5px] text-on-surface leading-tight truncate">{restaurant.name}</p>
                          <p className="mt-0.5 text-[11.5px] text-on-surface/50 truncate">
                            {[restaurant.cuisine, restaurant.price, restaurant.address].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <ScoreRing score={restaurant.score} size={40} className="flex-shrink-0" />
                      </button>
                    )}

                    {/* Featured recipe — name + meta, no thumbnail. */}
                    {recipe && !restaurant && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); navigate(`/meal/${p.userId}/${recipe.id}`); }}
                        className="mt-3 w-full flex items-center gap-3 rounded-2xl border border-on-surface/[0.07] bg-on-surface/[0.025] px-3.5 py-3 text-left hover:bg-on-surface/[0.05] hover:border-on-surface/[0.12] transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-on-surface/40">Featured recipe</p>
                          <p className="mt-0.5 font-serif font-bold text-[15.5px] text-on-surface leading-tight truncate">{recipe.title}</p>
                          {recipeMeta && <p className="mt-0.5 text-[11.5px] text-on-surface/50 truncate">{recipeMeta}</p>}
                        </div>
                        <ChevronRight size={18} className="flex-shrink-0 text-on-surface/30" />
                      </button>
                    )}
                  </div>
                </article>
              </li>
            );
          }
          if (item.type === 'homeMeal') {
            const m = item.data;
            const mealTimeAgo = timeAgo(new Date(m.createdAt).toISOString());
            const summary = mealRatingSummaries[m.id];
            const liked = mealLikedByMe.has(m.id);
            const saved = myHomeMeals.some((x) => x.id === m.id);
            const likeCount = mealLikeCounts[m.id] || 0;
            const commentCount = mealCommentCounts[m.id] || 0;
            return (
              <li key={`meal-${m.id}`} className={cn('border-b border-on-surface/[0.08] last:border-0', phoneMode ? 'py-4' : 'py-5')}>
                <article>
                  {/* Cook header — chef avatar + name + "Cooked at home · time" */}
                  <div className="flex items-center gap-3">
                    <Link to={`/user/${getUsername(m.userId)}`} className="flex-shrink-0">
                      <div className="w-9 h-9 rounded-full bg-emerald-100 grid place-items-center">
                        <ChefHat size={17} className="text-emerald-700" />
                      </div>
                    </Link>
                    <div className="flex-1 min-w-0">
                      <Link to={`/user/${getUsername(m.userId)}`} className="block truncate text-[14px] font-bold text-on-surface leading-tight hover:text-primary">
                        {getName(m.userId)}
                      </Link>
                      <p className="mt-0.5 text-[12px] leading-tight text-on-surface/45">Cooked at home · {mealTimeAgo}</p>
                    </div>
                  </div>

                  {/* Photo */}
                  <ActivityPhoto
                    flush={phoneMode}
                    src={getMealCoverUrl(m)}
                    onClick={() => openFriendRecipe(m)}
                    aria={`View ${m.name}`}
                  />

                  {/* Caption — meal name + date/dishes + description + tags;
                      community star summary inline (right of the name). */}
                  <button
                    type="button"
                    onClick={() => openFriendRecipe(m)}
                    className="mt-3 block w-full text-left group focus-visible:outline-none"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-serif text-[19px] font-semibold leading-[1.2] tracking-[-0.01em] text-on-surface line-clamp-1 group-hover:text-primary transition-colors">
                          {m.name}
                        </h3>
                        <p className="mt-0.5 text-[12.5px] font-medium text-on-surface/55">
                          {new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          {m.dishes.length > 0 && <>  ·  {m.dishes.length} dish{m.dishes.length !== 1 ? 'es' : ''}</>}
                        </p>
                      </div>
                      {summary && summary.count > 0 && (
                        <div className="flex flex-shrink-0 flex-col items-end gap-0.5 pt-0.5">
                          <div className="flex gap-0.5">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <Star key={n} size={12} className={cn(
                                n <= Math.round(summary.average) ? "text-amber-500 fill-amber-500" : "text-on-surface/15",
                              )} />
                            ))}
                          </div>
                          <span className="text-[12px] font-bold tabular-nums text-on-surface/55">{summary.average.toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                    {m.description && (
                      <p className="mt-2 text-[14px] leading-[1.5] text-on-surface/75 line-clamp-3">{m.description}</p>
                    )}
                    {m.tags.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {m.tags.slice(0, 4).map((t) => (
                          <span key={t} className="rounded-full bg-on-surface/[0.05] px-2.5 py-0.5 text-[11.5px] font-medium text-on-surface/60">{t}</span>
                        ))}
                      </div>
                    )}
                  </button>

                  {/* Action bar — like / comment (left); share / save (right) */}
                  <div className="mt-2.5 flex items-center -ml-2">
                    <button
                      type="button"
                      onClick={() => toggleMealLike(m.id)}
                      className={cn(
                        'inline-flex h-9 items-center gap-1.5 rounded-full px-2 transition-colors',
                        liked ? 'text-red-500' : 'text-on-surface/60 hover:text-red-500 hover:bg-on-surface/[0.04]',
                      )}
                      aria-label={liked ? 'Remove like' : 'Like'}
                    >
                      <Heart size={19} className={liked ? 'fill-red-500' : ''} />
                      {likeCount > 0 && <span className="text-[12.5px] font-semibold tabular-nums">{likeCount}</span>}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenMealComments(m)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full px-2 text-on-surface/60 hover:text-primary hover:bg-on-surface/[0.04] transition-colors"
                      aria-label="Comments"
                    >
                      <MessageSquare size={19} />
                      {commentCount > 0 && <span className="text-[12.5px] font-semibold tabular-nums">{commentCount}</span>}
                    </button>
                    <div className="ml-auto flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setShareRecipeData(buildSharedRecipe(m)); }}
                        className="grid h-9 w-9 place-items-center rounded-full text-on-surface/60 hover:text-primary hover:bg-on-surface/[0.04] transition-colors"
                        aria-label="Share"
                      >
                        <Share2 size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleMealSave(m)}
                        className={cn(
                          'grid h-9 w-9 place-items-center rounded-full transition-colors',
                          saved ? 'text-primary hover:bg-primary/5' : 'text-on-surface/60 hover:text-primary hover:bg-on-surface/[0.04]',
                        )}
                        aria-label={saved ? 'Saved to your recipes' : 'Save to your recipes'}
                      >
                        <Bookmark size={19} className={saved ? 'fill-primary' : ''} />
                      </button>
                    </div>
                  </div>
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
          <li key={r.id} className={cn('border-b border-on-surface/[0.08] last:border-0', phoneMode ? 'py-4' : 'py-5')}>
            <article>
              {/* Header — avatar + name + "Rated · time" */}
              <div className="flex items-center gap-3">
                <Link to={`/user/${getUsername(r.user_id)}`} className="flex-shrink-0">
                  <div className={cn("w-9 h-9 rounded-full flex items-center justify-center", color.bg)}>
                    <span className={cn("text-[13px] font-serif font-bold", color.text)}>{initial}</span>
                  </div>
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 leading-tight">
                    <Link to={`/user/${getUsername(r.user_id)}`} className="truncate text-[14px] font-bold text-on-surface hover:text-primary">
                      {getName(r.user_id)}
                    </Link>
                    {profiles[r.user_id]?.is_expert && (
                      <Star size={11} className="flex-shrink-0 fill-amber-500 text-amber-500" />
                    )}
                  </div>
                  <p className="mt-0.5 text-[12px] leading-tight text-on-surface/45">Rated · {timeAgo(r.created_at)}</p>
                </div>
              </div>

              {/* Photo — score ring overlaid bottom-left when a cover resolves */}
              <ActivityPhoto
                flush={phoneMode}
                src={r.photo_url}
                onClick={() => navigate(`/restaurant/${r.restaurant_id}`)}
                aria={`View ${r.restaurant_name}`}
                overlay={<ScoreRing score={Number(r.score)} size={48} onPhoto className="absolute bottom-3 left-3" />}
              />

              {/* Caption — restaurant name + meta + note. Score sits inline
                  (right of the name) only when there's no photo to host it. */}
              <button
                type="button"
                onClick={() => navigate(`/restaurant/${r.restaurant_id}`)}
                className="mt-3 block w-full text-left group focus-visible:outline-none"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-serif text-[19px] font-semibold leading-[1.2] tracking-[-0.01em] text-on-surface line-clamp-1 group-hover:text-primary transition-colors">
                      {r.restaurant_name}
                    </h3>
                    {(r.cuisine || r.price || r.address) && (
                      <p className="mt-0.5 truncate text-[12.5px] font-medium text-on-surface/55">
                        {[r.cuisine, r.price, r.address?.split(',')[0]?.trim()].filter(Boolean).join('  ·  ')}
                      </p>
                    )}
                  </div>
                  {!r.photo_url && <ScoreRing score={Number(r.score)} size={44} className="mt-0.5 flex-shrink-0" />}
                </div>
                {r.notes && (
                  <p className="mt-2 text-[14px] leading-[1.5] text-on-surface/75 line-clamp-3">{r.notes}</p>
                )}
                {r.tags && r.tags.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {r.tags.slice(0, 4).map((t) => (
                      <span key={t} className="rounded-full bg-on-surface/[0.05] px-2.5 py-0.5 text-[11.5px] font-medium text-on-surface/60">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </button>

              {/* Action bar — like / comment (left); rate (+) / save (right) */}
              <div className="mt-2.5 flex items-center -ml-2">
                <button
                  onClick={() => handleLike(r.id)}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-full px-2 transition-colors",
                    userLiked.has(r.id) ? "text-red-500" : "text-on-surface/60 hover:text-red-500 hover:bg-on-surface/[0.04]",
                  )}
                >
                  <Heart size={20} className={userLiked.has(r.id) ? 'fill-red-500' : ''} />
                  <span className="text-[12.5px] font-semibold tabular-nums">{likes[r.id] || 0}</span>
                </button>
                <button
                  onClick={() => handleOpenComments(r.id)}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-full px-2 transition-colors",
                    openComments === r.id ? "text-primary" : "text-on-surface/60 hover:text-primary hover:bg-on-surface/[0.04]",
                  )}
                >
                  <MessageSquare size={19} />
                  <span className="text-[12.5px] font-semibold tabular-nums">{commentCounts[r.id] || 0}</span>
                </button>
                <div className="ml-auto flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); openAddRestaurantModal(meta); }}
                    className="grid h-9 w-9 place-items-center rounded-full text-on-surface/60 hover:text-primary hover:bg-on-surface/[0.04] transition-colors"
                    aria-label="Rate this restaurant"
                  >
                    <Plus size={19} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleWishlist(meta); }}
                    className={cn(
                      'grid h-9 w-9 place-items-center rounded-full transition-colors',
                      wishlisted ? 'text-primary hover:bg-primary/5' : 'text-on-surface/60 hover:text-primary hover:bg-on-surface/[0.04]',
                    )}
                    aria-label={wishlisted ? 'In wishlist' : 'Add to wishlist'}
                  >
                    <Bookmark size={19} className={wishlisted ? 'fill-primary' : ''} />
                  </button>
                </div>
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
        {!phoneMode && !feedOnly && (
          <aside className="hidden xl:block xl:sticky xl:top-4 xl:pt-12 xl:self-start">
            <SuggestionsRail userId={userId} friendIds={friendIds} suggestedRestaurants={suggestedRestaurants} />
          </aside>
        )}
      </div>

      <ShareRecipeSheet
        open={!!shareRecipeData}
        recipe={shareRecipeData}
        onClose={() => setShareRecipeData(null)}
      />

      {/* Recipe comment thread — bottom sheet opened from a meal card's
          comment button. The full thread also lives on the recipe detail
          page; this is the quick in-feed entry point. */}
      <AnimatePresence>
        {openMealComments && (
          <motion.div
            key="recipe-comments-sheet"
            className="fixed inset-0 z-[200] bg-black/55 backdrop-blur-sm flex items-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpenMealComments(null)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              {...recipeCommentsDragProps}
              onClick={(e) => e.stopPropagation()}
              className="bg-paper w-full rounded-t-3xl flex flex-col"
              style={{ height: '75%' }}
            >
              <div className="pt-2 pb-1 flex justify-center flex-shrink-0">
                <span className="w-10 h-1 rounded-full bg-on-surface/20" />
              </div>
              <div className="flex items-center justify-between px-5 pb-3 border-b border-on-surface/8 flex-shrink-0">
                <div className="min-w-0">
                  <h3 className="font-serif text-[17px] font-bold text-on-surface leading-tight">Comments</h3>
                  <p className="text-[12px] text-on-surface/45 truncate">{openMealComments.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenMealComments(null)}
                  className="grid h-9 w-9 place-items-center rounded-full text-on-surface/50 hover:bg-on-surface/[0.06] flex-shrink-0"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
              <RecipeCommentThread
                targetId={openMealComments.id}
                variant="sheet"
                onCountChange={(n) => setMealCommentCounts((prev) => ({ ...prev, [openMealComments.id]: n }))}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
                {...postCommentsDragProps}
                onClick={(e) => e.stopPropagation()}
                className="bg-white w-full rounded-t-3xl flex flex-col"
                style={{ height: '75%' }}
              >
                <div className="pt-2 pb-1 flex justify-center">
                  <span className="w-10 h-1 rounded-full bg-on-surface/20" />
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
