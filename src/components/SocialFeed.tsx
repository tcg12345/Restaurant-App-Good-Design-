import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Heart, MessageSquare, Send, ChefHat, Plus, Star, ChevronDown, ChevronRight, BookOpen, Share2, Bookmark, X, MapPin, UtensilsCrossed, Clock, Layers } from 'lucide-react';
import { VerifiedBadge } from './VerifiedBadge';

import { ShareDialog } from './ShareDialog';
import { CommentsBody } from '../pages/Reels';
import type { SharedRecipe, SharePayload } from '../contexts/ChatContext';
import { usePosts } from '../contexts/PostsContext';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { displayCuisine } from '../lib/cuisine';
import { ScoreBadge } from './ScoreBadge';
import { ScoreRing } from './cards';
import { RatingStripCard, ratingStripGridClass } from './RatingStripCard';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useLists } from '../contexts/ListsContext';
import {
  getFriends, getFriendActivity, getProfilesByIds, getLikesForRatings,
  getCommentCounts, toggleLike, addComment, getComments, toggleCommentLike,
  getFriendsPublicHomeMeals, getFollowedExpertIds, getExpertProfiles,
  followPublicAccount, getSuggestedProfiles,
  activityTimestamp, isEditedActivity,
  type CommunityRating, type UserProfile, type ActivityComment, type FriendHomeMeal,
  type SuggestedProfile,
} from '../lib/supabase-community';
import { listPosts, setPostLike, setPostSave, type PostRow, type PostRestaurantSnapshot } from '../lib/supabase-posts';
import { SuggestedPeople } from './SuggestedPeople';
import { mergeFeed, layoutFeed, type FeedEntry } from '../lib/feedEntry';
import { getGuidesForFeed } from '../lib/supabase-guides';
import { getMealCoverUrl } from '../lib/recipe-display';
import { toggleRecipeLike, getRecipeLikes, getRecipeCommentCounts } from '../lib/supabase-recipes';
import { RecipeCommentThread } from './RecipeCommentThread';
import { useSignInModal } from '../contexts/SignInModalContext';
import { getReviewSummariesBatch } from '../lib/supabase-home-meal-reviews';
import { EmptyState } from './EmptyState';
import { useBottomSheet } from '../lib/useBottomSheet';
import { Collapse } from './Collapse';
import { FeedPost } from './feed/FeedPost';

/**
 * The town out of a full postal address.
 *
 * A post's location label is whatever the picker returned — often the
 * street, the postcode, the city and the country. Set beside a timestamp
 * that whole string wraps the author line onto two lines and says nothing
 * the reader wanted. What they want is where it was: the city.
 */
function shortPlace(label?: string | null): string {
  const parts = (label || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  const pick = parts.length >= 3 ? parts[parts.length - 2] : parts[0];
  return pick.replace(/^\d{3,6}\s+/, '');
}

/**
 * A written note, split into the sentence that leads and the rest.
 *
 * Every post in the feed wants a headline and a body, but a rating carries
 * one free-text field. Setting the whole of it at headline size shouts a
 * paragraph; setting all of it at body size leaves the post with no voice.
 * The first sentence is almost always the verdict — that becomes the
 * headline, and what follows becomes the body. A note with no sentence
 * break is a headline if it is short enough to read as one, and body copy
 * if it isn't.
 */
function splitNote(text?: string | null): { title?: string; body?: string } {
  const t = (text || '').trim();
  if (!t) return {};
  const end = t.search(/[.!?](\s|$)/);
  if (end > 0 && end < 100) {
    const title = t.slice(0, end + 1).trim();
    const body = t.slice(end + 1).trim();
    return body ? { title, body } : { title };
  }
  return t.length <= 100 ? { title: t } : { body: t };
}

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
                // bg-media-white: dots sit over the photo — the paper remap
                // turned the ACTIVE dot near-black in dark mode, darker
                // than its untouched bg-white/50 siblings.
                i === activeIdx ? 'bg-media-white' : 'bg-white/50',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/** Featured guides for the suggestions rail — real published + public
 *  community guides with their real authors. */
interface RailGuide { id: string; title: string; author: string; spots: number; isRecipes: boolean }

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
  const [railGuides, setRailGuides] = useState<RailGuide[]>([]);
  const navigate = useNavigate();
  const { isWishlisted } = useLists();

  // Follow directly from the rail card. The card itself is a profile
  // <Link>, so the button must cancel both the router navigation
  // (stopPropagation) and the anchor's native activation (preventDefault).
  // Suggested profiles are experts (public accounts), so the follow is
  // immediate — no request/approval leg.
  const [followPending, setFollowPending] = useState<Set<string>>(new Set());
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const followSuggested = useCallback(async (target: UserProfile, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!userId || followPending.has(target.user_id) || followedIds.has(target.user_id)) return;
    setFollowPending((prev) => new Set(prev).add(target.user_id));
    const ok = await followPublicAccount(userId, target.user_id);
    setFollowPending((prev) => { const next = new Set(prev); next.delete(target.user_id); return next; });
    if (ok) setFollowedIds((prev) => new Set(prev).add(target.user_id));
  }, [userId, followPending, followedIds]);

  // Was getExpertProfiles() — verified accounts only, of which a young
  // platform has none, so this rail rendered empty for every user on every
  // visit. Same source as the mobile rail now: public profiles ranked by
  // what they've published, with verification as a boost not a gate.
  useEffect(() => {
    let cancelled = false;
    getSuggestedProfiles({
      viewerId: userId,
      excludeUserIds: [...friendIds],
      limit: 5,
    }).then((profiles) => {
      if (cancelled) return;
      setSuggested(profiles);
    });
    return () => { cancelled = true; };
  }, [userId, friendIds]);

  // Real featured guides: newest published + public community guides.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const guides = await getGuidesForFeed({ limit: 4, excludeUserId: userId || undefined });
      if (cancelled || guides.length === 0) return;
      const authorIds = Array.from(new Set(guides.map((g) => g.userId)));
      const profiles = await getProfilesByIds(authorIds);
      if (cancelled) return;
      setRailGuides(guides.map((g) => ({
        id: g.id,
        title: g.title,
        author: profiles[g.userId]?.display_name || profiles[g.userId]?.username || 'Community member',
        spots: g.entries.length,
        isRecipes: g.type === 'recipes',
      })));
    })();
    return () => { cancelled = true; };
  }, [userId]);

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
                        {displayCuisine(r.cuisine)}
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
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">
                        {p.is_verified ? (
                          <>
                            <VerifiedBadge size={11} />
                            Verified
                          </>
                        ) : 'Friend pick'}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => { void followSuggested(p, e); }}
                        disabled={!userId || followPending.has(p.user_id) || followedIds.has(p.user_id)}
                        className="hit-44 text-[11px] font-bold text-primary hover:underline underline-offset-2 flex-shrink-0 disabled:opacity-60 disabled:no-underline"
                      >
                        {followedIds.has(p.user_id) ? 'Following' : 'Follow'}
                      </button>
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

      {/* Featured guides — real published community guides. Hidden
          entirely until at least one exists. */}
      {railGuides.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[11px] font-bold uppercase tracking-[0.13em] text-on-surface/65">Featured guides</h4>
            <Link to="/discover" className="text-[12px] font-semibold text-primary hover:underline underline-offset-2">Browse</Link>
          </div>
          <ul>
            {railGuides.slice(0, 3).map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/guides/${g.id}`)}
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
                      by {g.author} · {g.spots} {g.isRecipes ? 'recipes' : 'spots'}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
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
  /** Lifts the who-am-I-looking-at control out of the feed and into the
   *  page header, where the design puts it. When supplied the feed stops
   *  drawing its own filter row. */
  filter?: FeedFilter;
  onFilterChange?: (f: FeedFilter) => void;
}

/** Who the feed is showing. 'recipes' narrows to what people cooked. */
export type FeedFilter = 'friends' | 'experts' | 'recipes';

export const SocialFeed: React.FC<SocialFeedProps> = ({ centerLat = null, centerLng = null, suggestedRestaurants = [], feedOnly = false, inlineSlot, filter, onFilterChange }) => {
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
  // What a viewer with an empty circle sees instead of a dead end: people
  // worth following, and the posts the wider community has made public.
  // Loaded lazily — an account with a populated feed never pays for them.
  const [suggestedPeople, setSuggestedPeople] = useState<SuggestedProfile[]>([]);
  const [suggestedPosts, setSuggestedPosts] = useState<PostRow[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const suggestReqRef = useRef(0);
  /**
   * Sticky once the viewer follows someone from the rail.
   *
   * Following is the one action that makes `showSuggestions` false, so
   * gating the rail on that alone would delete it under the user's finger
   * the instant they used it — and someone setting up a new account wants
   * to follow several people, not one. The rail stays for the rest of the
   * session; their circle's content fills in underneath it.
   */
  const [followedFromRail, setFollowedFromRail] = useState(false);
  // Post-level overlays (open one at a time, controlled by the post card)
  const [openPostCommentsId, setOpenPostCommentsId] = useState<string | null>(null);
  const [sharePayload, setSharePayload] = useState<SharePayload | null>(null);
  const postCommentsScrollRef = useRef<HTMLDivElement | null>(null);
  const { dragProps: postCommentsDragProps, sheetRef: postCommentsSheetRef } = useBottomSheet(!!openPostCommentsId, () => setOpenPostCommentsId(null), postCommentsScrollRef);
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
    void toggleRecipeLike(userId, mealId).then((ok) => {
      if (ok) return;
      setMealLikedByMe((prev) => { const n = new Set(prev); if (wasLiked) n.add(mealId); else n.delete(mealId); return n; });
      setMealLikeCounts((prev) => ({ ...prev, [mealId]: Math.max(0, (prev[mealId] || 0) + (wasLiked ? 1 : -1)) }));
    });
  }, [userId, mealLikedByMe, requireSignIn]);

  const toggleMealSave = useCallback((meal: FriendHomeMeal) => {
    if (!userId) { requireSignIn('Sign in to save'); return; }
    if (myHomeMeals.some((x) => x.id === meal.id)) removeRecipeFromCookbook(meal.id);
    else addRecipeToCookbook(meal);
  }, [userId, myHomeMeals, addRecipeToCookbook, removeRecipeFromCookbook, requireSignIn]);
  const [mealRatingSummaries, setMealRatingSummaries] = useState<Record<string, { average: number; count: number }>>({});
  const [shareRecipeData, setShareRecipeData] = useState<SharedRecipe | null>(null);
  const [loading, setLoading] = useState(true);
  // ONE stream. There used to be a Posts / Activity tab pair here, and it
  // was the root of the "why do I see two entries for one meal / which one
  // is the rating?" confusion beta testers hit: posts and ratings could
  // never appear together, so the same dinner showed up in two places
  // depending on which tab you were standing in. The only switch left is a
  // WHO filter — your circle, or the verified people you follow.
  const [ownFilter, setOwnFilter] = useState<FeedFilter>('friends');
  // Controlled when the page owns the chips, uncontrolled otherwise.
  const activityFilter = filter ?? ownFilter;
  const setActivityFilter = onFilterChange ?? setOwnFilter;

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

  const recipeCommentsScrollRef = useRef<HTMLDivElement | null>(null);
  const { dragProps: recipeCommentsDragProps, sheetRef: recipeCommentsSheetRef } = useBottomSheet(!!openMealComments, () => setOpenMealComments(null), recipeCommentsScrollRef);

  // Hide the bottom nav while any comment popup is open (recipe, post, or the
  // inline restaurant thread) so the sheet reads as a focused overlay.
  useEffect(() => {
    const open = !!openMealComments || !!openPostCommentsId || !!openComments;
    setHideBottomNav(open);
    return () => setHideBottomNav(false);
  }, [openMealComments, openPostCommentsId, openComments, setHideBottomNav]);

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

  // Monotonic load sequence: a user switch or fast remount starts a new
  // load, and any still-in-flight older load must not overwrite the newer
  // state with its stale response.
  const loadSeqRef = useRef(0);

  const loadFeed = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    const fresh = () => loadSeqRef.current === seq;
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    const friends = await getFriends(userId);
    if (!fresh()) return;
    if (friends.length === 0) {
      // CLEAR rather than early-return with stale state — after unfollowing
      // everyone (or on a fresh account) the feed must show empty, not the
      // previous session's items.
      setFriendIds(new Set());
      setActivity([]);
      setHomeMeals([]);
      setPosts([]);
      setLoading(false);
      return;
    }

    const friendIdsArr = friends.map((f) => f.friend_id);
    const friendIdSet = new Set(friendIdsArr);
    setFriendIds(friendIdSet);
    const [act, meals, friendPosts] = await Promise.all([
      getFriendActivity(friendIdsArr, 500),
      getFriendsPublicHomeMeals(friendIdsArr),
      // Filter to friends SERVER-SIDE. The old global fetch (limit 100)
      // + client filter silently dropped friends' posts once the platform
      // had more than 100 recent public posts — the limit now applies to
      // the friend set itself.
      listPosts({ viewerId: userId, limit: 100, userIds: friendIdsArr }),
    ]);
    if (!fresh()) return;
    setActivity(act);
    setHomeMeals(meals);
    // Real likes + comment counts for the cooking-feed recipe cards.
    if (meals.length > 0) {
      const mealIds = meals.map((m) => m.id);
      void Promise.all([getRecipeLikes(userId, mealIds), getRecipeCommentCounts(mealIds)])
        .then(([likeData, commentCounts]) => {
          if (!fresh()) return;
          setMealLikeCounts(likeData.likes);
          setMealLikedByMe(likeData.userLiked);
          setMealCommentCounts(commentCounts);
        });
    }
    // listPosts resolves null when the fetch failed; keep whatever the
    // feed already showed rather than wiping it to a false empty state.
    if (friendPosts) setPosts(friendPosts);

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
      if (!fresh()) return;
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
        .then((s) => { if (fresh()) setMealRatingSummaries(s); })
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

  // One merged, time-sorted stream. lib/feedEntry owns the rules — a rating
  // shared as a post appears once (never as both), imported ratings stay
  // out, ordering is deterministic — and is unit-tested there. The verified
  // filter narrows to followed experts, who publish via ratings.
  const ratingSource = activityFilter === 'experts' ? expertActivity : activityFilter === 'recipes' ? [] : activity;
  const mealSource = activityFilter === 'experts' ? [] : homeMeals;
  const postSource = activityFilter === 'friends' ? posts : activityFilter === 'recipes'
    ? posts.filter((p) => p.items.some((it) => it.recipe))
    : [];
  const circleEntries = mergeFeed({
    posts: postSource,
    ratings: ratingSource,
    homeMeals: mealSource,
  });
  /**
   * A brand-new account follows nobody, so the circle feed is empty and the
   * home page is a sentence with nowhere to go. When that happens, fall back
   * to what the wider community has published publicly — labelled as such,
   * never passed off as your circle.
   *
   * Derived from `circleEntries`, NOT from the entries actually rendered:
   * reading it off the rendered feed would make it flip false the moment the
   * suggestions arrived, and the fallback would tear itself down.
   */
  const showSuggestions = activityFilter === 'friends' && !loading && circleEntries.length === 0;
  const feedEntries = showSuggestions && suggestedPosts.length > 0
    ? mergeFeed({ posts: suggestedPosts })
    : circleEntries;
  const toFeedItem = (e: FeedEntry): FeedItem => (
    e.kind === 'post' ? { type: 'post', data: e.source.post!, sortTime: e.sortTime }
    : e.kind === 'rating' ? { type: 'rating', data: e.source.rating!, sortTime: e.sortTime }
    : { type: 'homeMeal', data: e.source.homeMeal!, sortTime: e.sortTime }
  );
  const feedItems: FeedItem[] = feedEntries.map(toFeedItem);

  const handleLike = async (ratingId: string) => {
    if (!userId || !ratingId) return;
    const wasLiked = userLiked.has(ratingId);
    setUserLiked((prev) => { const next = new Set(prev); wasLiked ? next.delete(ratingId) : next.add(ratingId); return next; });
    setLikes((prev) => ({ ...prev, [ratingId]: Math.max(0, (prev[ratingId] || 0) + (wasLiked ? -1 : 1)) }));
    const res = await toggleLike(userId, ratingId);
    // Reconcile to the server's actual resulting state: roll back on a
    // failed write (offline / RLS) AND when the server ended up where we
    // started (e.g. a concurrent duplicate insert) — either way the
    // optimistic flip didn't stick.
    if (!res.ok || res.liked === wasLiked) {
      setUserLiked((prev) => { const next = new Set(prev); wasLiked ? next.add(ratingId) : next.delete(ratingId); return next; });
      setLikes((prev) => ({ ...prev, [ratingId]: Math.max(0, (prev[ratingId] || 0) + (wasLiked ? 1 : -1)) }));
    }
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
    const ok = await setPostLike(postId, userId, !currentlyLiked);
    if (!ok) {
      setPosts((prev) => prev.map((p) => (
        p.id === postId
          ? { ...p, liked: currentlyLiked, likesCount: Math.max(0, p.likesCount + (currentlyLiked ? 1 : -1)) }
          : p
      )));
    }
  };

  const handleSavePost = async (postId: string, currentlySaved: boolean) => {
    if (!userId) return;
    setPosts((prev) => prev.map((p) => (
      p.id === postId
        ? { ...p, saved: !currentlySaved, savesCount: Math.max(0, p.savesCount + (currentlySaved ? -1 : 1)) }
        : p
    )));
    const ok = await setPostSave(postId, userId, !currentlySaved);
    if (!ok) {
      setPosts((prev) => prev.map((p) => (
        p.id === postId
          ? { ...p, saved: currentlySaved, savesCount: Math.max(0, p.savesCount + (currentlySaved ? 1 : -1)) }
          : p
      )));
    }
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

  // Featured place — every layout opens the full restaurant detail page,
  // matching the activity tab's rows (swipe-back returns to the feed).
  // The old in-feed sheet made restaurant taps behave differently between
  // the two tabs.
  const handleFeaturedPlaceClick = (restaurant: PostRestaurantSnapshot) => {
    navigate(`/restaurant/${restaurant.id}`);
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
  const deletePostCommentAdapter = useCallback(async (postId: string, commentId: string, removedCount = 1) => {
    const ok = await deletePostComment(postId, commentId, removedCount);
    // Deleting a parent cascades to its replies, so drop the badge by the
    // full removed count, not just 1.
    if (ok) setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, commentsCount: Math.max(0, p.commentsCount - removedCount) } : p));
    return ok;
  }, [deletePostComment]);

  // Monotonic token so a slow fetch for a previously opened thread can't
  // overwrite the comments of the one currently open (shared state).
  const commentsReqRef = useRef(0);
  const handleOpenComments = async (ratingId: string) => {
    if (openComments === ratingId) { commentsReqRef.current++; setOpenComments(null); return; }
    const req = ++commentsReqRef.current;
    setOpenComments(ratingId);
    setCommentsLoading(true);
    setNewComment('');
    setReplyingTo(null);
    setReplyText('');
    setExpandedThreads(new Set());
    const cmts = await getComments(ratingId, userId);
    if (commentsReqRef.current !== req) return;
    setComments(cmts);
    if (cmts.length > 0) {
      const ids = [...new Set(cmts.map((c) => c.user_id))];
      const profs = await getProfilesByIds(ids);
      if (commentsReqRef.current !== req) return;
      setCommentProfiles(profs);
    }
    setCommentsLoading(false);
  };

  // Single shared "refresh comments after a write" routine so handlers stay tiny.
  const refreshComments = async (ratingId: string) => {
    const req = ++commentsReqRef.current;
    const cmts = await getComments(ratingId, userId);
    if (commentsReqRef.current !== req) return;
    setComments(cmts);
    const ids = [...new Set(cmts.map((c) => c.user_id))];
    const profs = await getProfilesByIds(ids);
    if (commentsReqRef.current !== req) return;
    setCommentProfiles(profs);
  };

  // One in-flight guard shared by both composer paths — Enter fires per
  // keypress, so double-Enter (or Enter + Send tap) during the awaited
  // insert used to post the same comment twice.
  const commentSubmittingRef = useRef(false);
  const [commentSubmitting, setCommentSubmitting] = useState(false);

  const handleAddComment = async (ratingId: string) => {
    const text = newComment.trim();
    if (!userId || !text || commentSubmittingRef.current) return;
    commentSubmittingRef.current = true;
    setCommentSubmitting(true);
    // Clear optimistically so the box feels instant; restore on failure.
    setNewComment('');
    try {
      const ok = await addComment(userId, ratingId, text, null);
      if (ok) {
        setCommentCounts((prev) => ({ ...prev, [ratingId]: (prev[ratingId] || 0) + 1 }));
        await refreshComments(ratingId);
      } else {
        setNewComment(text);
      }
    } finally {
      commentSubmittingRef.current = false;
      setCommentSubmitting(false);
    }
  };

  const handleAddReply = async (ratingId: string, parentId: string) => {
    const text = replyText.trim();
    if (!userId || !text || commentSubmittingRef.current) return;
    commentSubmittingRef.current = true;
    setCommentSubmitting(true);
    setReplyText('');
    try {
      const ok = await addComment(userId, ratingId, text, parentId);
      if (ok) {
        setReplyingTo(null);
        setCommentCounts((prev) => ({ ...prev, [ratingId]: (prev[ratingId] || 0) + 1 }));
        // Expand the parent thread so the new reply is visible immediately.
        setExpandedThreads((prev) => new Set(prev).add(parentId));
        await refreshComments(ratingId);
      } else {
        setReplyText(text);
      }
    } finally {
      commentSubmittingRef.current = false;
      setCommentSubmitting(false);
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
    // days 360-364: months hits 12 but floor(days/365) is still 0
    const years = Math.max(1, Math.floor(days / 365));
    return `${years} year${years === 1 ? '' : 's'} ago`;
  };

  // Lazy-load expert ratings the first time the Experts filter is opened.
  // Subsequent switches reuse what's already in state.
  useEffect(() => {
    if (activityFilter === 'experts' && !expertLoaded && !expertLoading) loadExperts();
  }, [activityFilter, expertLoaded, expertLoading, loadExperts]);

  // Fill an empty circle. Runs only once the circle feed has resolved to
  // genuinely empty, so a populated account never issues either query.
  useEffect(() => {
    if (!showSuggestions) return;
    const seq = ++suggestReqRef.current;
    setSuggestLoading(true);
    (async () => {
      const [people, publicPosts] = await Promise.all([
        getSuggestedProfiles({ viewerId: userId, limit: 12 }),
        // No `userIds` — the global window, which RLS already scopes to
        // public posts (plus the viewer's own and their followed accounts').
        listPosts({ viewerId: userId, limit: 12 }),
      ]);
      if (seq !== suggestReqRef.current) return;
      setSuggestedPeople(people);
      // Your own posts aren't a suggestion, and seeing them here would read
      // as the app mistaking you for the community.
      setSuggestedPosts((publicPosts || []).filter((p) => p.userId !== userId));
      setSuggestLoading(false);
    })();
  }, [showSuggestions, userId]);

  // Header for the single stream. The only control is WHO you're looking
  // at — your circle or the verified people you follow. Desktop keeps it to
  // one compact row (title + live dot left, filter right); phone shows the
  // filter alone, since the page chrome already carries the title.
  const CircleFilter: React.FC<{ full?: boolean }> = ({ full }) => (
    <div className={cn('flex items-center gap-0.5 rounded-full bg-on-surface/[0.045] p-0.5', full ? 'w-full' : 'flex-shrink-0')}>
      {([['friends', 'Your circle'], ['experts', 'Verified']] as const).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => setActivityFilter(key)}
          aria-pressed={activityFilter === key}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 rounded-full py-1.5 text-[12.5px] font-semibold transition-colors whitespace-nowrap',
            full ? 'flex-1 h-9 text-[13.5px]' : 'px-3.5',
            activityFilter === key ? 'bg-paper text-on-surface shadow-sm' : 'text-on-surface/55 hover:text-on-surface',
          )}
        >
          {key === 'experts' && <VerifiedBadge size={13} />}
          {label}
        </button>
      ))}
    </div>
  );

  /**
   * A run of ratings nobody photographed.
   *
   * At full width these were near-identical rows — a name, a score, and
   * nothing to look at — and three of them in a row pushed the photos
   * everyone came for off the screen. They still belong in the feed, just
   * not at that size: same ingredients as the full card (who, where,
   * score) in a square tile you scan rather than read. layoutFeed
   * guarantees one run per heading, so this always carries the label.
   * Geometry lives in RatingStripCard.
   */
  const RatingStrip: React.FC<{ entries: FeedEntry[] }> = ({ entries }) => {
    const scores = entries.map((e) => Number(e.source.rating?.score)).filter((n) => Number.isFinite(n) && n > 0);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    return (
    <div>
      <div className="px-5 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-on-surface" style={{ fontSize: '18px', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.022em' }}>
            Also rated this week
          </h2>
          <p className="mt-1.5 text-on-surface/45" style={{ fontSize: '12.5px', lineHeight: 1.35 }}>
            {entries.length} more from your circle{avg > 0 && ` · avg ${avg.toFixed(1)}`}
          </p>
        </div>
      </div>
      <ul className={cn(ratingStripGridClass(phoneMode), 'mt-4 px-5')}>
        {entries.map((e) => {
          const r = e.source.rating!;
          const color = avatarColor(e.authorId);
          const name = getName(e.authorId);
          const place = e.restaurant?.name || r.restaurant_name;
          return (
            <li key={e.key} className="snap-start min-w-0">
              <RatingStripCard
                name={name}
                initial={initialOf(name)}
                avatarBg={color.bg}
                avatarText={color.text}
                when={timeAgo(activityTimestamp(r))}
                place={place}
                meta={[r.cuisine, r.price, r.address?.split(',')[0]?.trim()].filter(Boolean).join(' · ')}
                score={Number(r.score)}
                photo={r.photo_url}
                liked={userLiked.has(r.id)}
                likeCount={likes[r.id] || 0}
                commentCount={commentCounts[r.id] || 0}
                onOpen={() => navigate(`/restaurant/${r.restaurant_id}`)}
                onLike={() => handleLike(r.id)}
                onComment={() => handleOpenComments(r.id)}
              />
            </li>
          );
        })}
      </ul>
    </div>
    );
  };

  const SectionHeader: React.FC = () => (filter !== undefined ? null : (
    <div className="mb-3">
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
          <CircleFilter />
        </div>
      ) : (
        <CircleFilter full />
      )}
    </div>
  ));

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
  type FeedRow = { kind: 'item'; item: FeedItem } | { kind: 'strip'; entries: FeedEntry[] } | { kind: 'slot' };
  const feedRows: FeedRow[] = layoutFeed(feedEntries, {
    // Verified stays full-width: those users publish by rating, almost
    // always without photos, so stripping them would leave a wall of
    // tiles with no full cards to break it up.
    enabled: activityFilter === 'friends',
  }).map((row): FeedRow => (
    row.kind === 'full'
      ? { kind: 'item', item: toFeedItem(row.entry) }
      : { kind: 'strip', entries: row.entries }
  ));
  if (inlineSlot) feedRows.splice(Math.min(Math.max(inlineSlot.afterIndex, 0), feedRows.length), 0, { kind: 'slot' });

  return (
    <section className="mb-2">
      <div className={cn(
        !phoneMode && !feedOnly && 'xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-14 xl:items-start',
      )}>
        <div className="xl:min-w-0">
      <SectionHeader />
      {(showSuggestions || followedFromRail) && (
        <div className="pt-5 pb-1">
          <SuggestedPeople
            people={suggestedPeople}
            userId={userId}
            onRequireSignIn={requireSignIn}
            onFollowed={() => { setFollowedFromRail(true); loadFeed(); }}
            loading={suggestLoading && suggestedPeople.length === 0}
          />
        </div>
      )}
      {activityFilter === 'experts' && expertLoading ? (
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
            <div className="pt-6">
              {inlineSlot.node}
              <div className="mx-5 mt-[26px] border-t border-on-surface/[0.14]" aria-hidden />
            </div>
          )}
          {activityFilter === 'experts' ? (
            <EmptyState
              icon={<VerifiedBadge size={48} />}
              heading="No picks from verified users yet"
              description="Follow verified critics, chefs, and writers to see their ratings show up here."
            />
          ) : (
            <div className="px-5 pt-8 flex flex-col items-start gap-2.5">
              <p className="text-on-surface" style={{ fontSize: '16px', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.028em' }}>
                {showSuggestions ? 'Your feed starts here' : 'Nothing from your circle yet'}
              </p>
              <p className="text-on-surface/45 max-w-[280px]" style={{ fontSize: '13.5px', lineHeight: 1.5 }}>
                {showSuggestions
                  ? 'Follow a few people above and their ratings, posts and cooking show up here.'
                  : "Follow friends and tastemakers to see where they're eating and cooking."}
              </p>
              <Link to="/circle" className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline underline-offset-2">
                Find people to follow
              </Link>
            </div>
          )}
        </>
      ) : (
      <>
      {/* Borrowed posts must never read as your circle's. The heading is the
          whole difference between "the community is worth a look" and "these
          are the people you follow". */}
      {showSuggestions && (
        <div className="px-5 pt-7 pb-1">
          <h2 className="text-on-surface" style={{ fontSize: '18px', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.022em' }}>
            From the community
          </h2>
          <p className="mt-1.5 text-on-surface/45" style={{ fontSize: '12.5px', lineHeight: 1.35 }}>
            Public posts from people across Gourmet Canvas.
          </p>
        </div>
      )}
      <ul>
        {feedRows.map((row, rowIndex) => {
          if (row.kind === 'slot') {
            return (
              <li key="inline-slot" className="pt-6">
                {inlineSlot!.node}
                <div className="mx-5 mt-[26px] border-t border-on-surface/[0.14]" aria-hidden />
              </li>
            );
          }
          if (row.kind === 'strip') {
            // One row per run — layoutFeed merges adjacent strips, so this
            // never renders two bordered "Also rated" blocks in a stack.
            return (
              <li key={`strip-${row.entries[0]?.key ?? 'empty'}`} className="pt-6">
                <RatingStrip entries={row.entries} />
                <div className="mx-5 mt-[26px] border-t border-on-surface/[0.14]" aria-hidden />
              </li>
            );
          }
          const item = row.item;
          if (item.type === 'post') {
            const p = item.data;
            const author = p.author;
            const displayName = author?.displayName || author?.username || 'A friend';
            const authorUsername = author?.username || '';
            // First attached restaurant/recipe across the post's items —
            // this is what the post is *about*, and it rides the same
            // attachment slot every other kind of post uses.
            const attached = p.items.find((it) => it.attachedKind && (it.restaurant || it.recipe));
            const restaurant = attached?.restaurant || null;
            const recipe = attached?.recipe || null;
            const recipeFacts = recipe
              ? ([
                  ((recipe.prepTime || 0) + (recipe.cookTime || 0)) > 0
                    ? { icon: <Clock size={13} />, value: `${(recipe.prepTime || 0) + (recipe.cookTime || 0)} min` } : null,
                  recipe.servings > 0
                    ? { icon: <Layers size={13} />, value: `${recipe.servings} servings` } : null,
                  recipe.difficulty
                    ? { icon: <UtensilsCrossed size={13} />, value: recipe.difficulty } : null,
                ].filter(Boolean) as { icon: React.ReactNode; value: string }[])
              : [];
            const photos = p.items
              .filter((it) => it.mediaType === 'photo' && it.mediaUrl)
              .map((it) => ({ id: it.id, url: it.mediaUrl, caption: it.caption?.trim() || undefined }));
            return (
              <li key={`post-${p.id}`}>
                <FeedPost
                  authorName={displayName}
                  authorInitial={author?.initials || 'U'}
                  authorHref={`/user/${authorUsername}`}
                  avatarClass={author?.avatarColor || 'bg-stone-700'}
                  kind={recipe ? 'Cooked' : 'Dined'}
                  when={[timeAgo(p.createdAt), shortPlace(p.locationLabel)].filter(Boolean).join(' · ')}
                  media={photos}
                  mediaHeight={recipe ? 268 : 300}
                  like={{ count: p.likesCount, liked: p.liked, onToggle: () => handleLikePost(p.id, p.liked) }}
                  comment={{ count: p.commentsCount, onOpen: () => setOpenPostCommentsId(p.id) }}
                  onShare={() => handleSharePost(p)}
                  save={{ saved: p.saved, onToggle: () => handleSavePost(p.id, p.saved), label: p.saved ? 'Unsave post' : 'Save post' }}
                  title={p.caption || undefined}
                  place={restaurant ? {
                    name: restaurant.name,
                    meta: [restaurant.cuisine, restaurant.price, restaurant.address?.split(',')[0]?.trim()].filter(Boolean).join(' · '),
                    score: restaurant.score,
                    onOpen: () => handleFeaturedPlaceClick(restaurant),
                  } : undefined}
                  recipe={recipe && !restaurant && recipeFacts.length > 0 ? {
                    facts: recipeFacts,
                    actionLabel: 'Cook it',
                    onAction: () => navigate(`/meal/${p.userId}/${recipe.id}`),
                  } : undefined}
                />
              </li>
            );
          }
          if (item.type === 'homeMeal') {
            const m = item.data;
            const mealTimeAgo = timeAgo(new Date(m.createdAt).toISOString());
            const summary = mealRatingSummaries[m.id];
            const liked = mealLikedByMe.has(m.id);
            const saved = myHomeMeals.some((x) => x.id === m.id);
            const cover = getMealCoverUrl(m);
            const cookName = getName(m.userId);
            const facts = [
              m.dishes.length > 0
                ? { icon: <UtensilsCrossed size={13} />, value: `${m.dishes.length} dish${m.dishes.length !== 1 ? 'es' : ''}` }
                : null,
              summary && summary.count > 0
                ? { icon: <Star size={13} />, value: `${summary.average.toFixed(1)} from ${summary.count}` }
                : null,
            ].filter(Boolean) as { icon: React.ReactNode; value: string }[];
            return (
              <li key={`meal-${m.id}`}>
                <FeedPost
                  authorName={cookName}
                  authorInitial={initialOf(cookName)}
                  authorHref={`/user/${getUsername(m.userId)}`}
                  avatarClass="bg-olive/[0.14] text-olive"
                  kind="Cooked"
                  when={`${new Date(m.date.length === 10 ? `${m.date}T12:00:00` : m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · at home`}
                  media={cover ? [{ id: m.id, url: cover }] : []}
                  mediaHeight={268}
                  onMediaClick={() => openFriendRecipe(m)}
                  like={{ count: mealLikeCounts[m.id] || 0, liked, onToggle: () => toggleMealLike(m.id) }}
                  comment={{ count: mealCommentCounts[m.id] || 0, onOpen: () => setOpenMealComments(m) }}
                  onShare={() => setShareRecipeData(buildSharedRecipe(m))}
                  save={{ saved, onToggle: () => toggleMealSave(m), label: saved ? 'Saved to your recipes' : 'Save to your recipes' }}
                  title={m.name}
                  onTitleClick={() => openFriendRecipe(m)}
                  body={m.description || undefined}
                  tags={m.tags.length > 0 ? m.tags : undefined}
                  recipe={facts.length > 0 ? { facts, actionLabel: 'Open recipe', onAction: () => openFriendRecipe(m) } : undefined}
                />
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
          const note = splitNote(r.notes);
          return (
          <li key={r.id}>
            <FeedPost
              authorName={getName(r.user_id)}
              authorInitial={initial}
              authorHref={`/user/${getUsername(r.user_id)}`}
              avatarClass={color.bg + ' ' + color.text}
              badge={profiles[r.user_id]?.is_verified ? <VerifiedBadge size={13} /> : undefined}
              kind="Rated"
              when={[
                timeAgo(activityTimestamp(r)),
                isEditedActivity(r) ? 'edited' : '',
                r.rating_method === 'slider' ? 'self-scored' : '',
              ].filter(Boolean).join(' · ')}
              media={r.photo_url ? [{ id: r.id, url: r.photo_url }] : []}
              mediaHeight={300}
              onMediaClick={() => navigate(`/restaurant/${r.restaurant_id}`)}
              like={{ count: likes[r.id] || 0, liked: userLiked.has(r.id), onToggle: () => handleLike(r.id) }}
              comment={{ count: commentCounts[r.id] || 0, onOpen: () => handleOpenComments(r.id) }}
              save={{ saved: wishlisted, onToggle: () => toggleWishlist(meta), label: wishlisted ? 'In wishlist' : 'Add to wishlist' }}
              extraAction={(
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); openAddRestaurantModal(meta); }}
                  className="w-9 h-9 rounded-full bg-on-surface/[0.06] text-on-surface flex items-center justify-center active:opacity-75 transition-opacity"
                  aria-label="Rate this restaurant"
                >
                  <Plus size={15} />
                </button>
              )}
              title={note.title}
              body={note.body}
              tags={r.tags || undefined}
              onTitleClick={() => navigate(`/restaurant/${r.restaurant_id}`)}
              place={{
                name: r.restaurant_name,
                meta: [r.cuisine, r.price, r.address?.split(',')[0]?.trim()].filter(Boolean).join(' · '),
                score: Number(r.score),
                onOpen: () => navigate(`/restaurant/${r.restaurant_id}`),
              }}
            >

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
                                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleAddReply(r.id, c.id); }}
                                />
                                <button
                                  type="button"
                                  onClick={() => handleAddReply(r.id, c.id)}
                                  disabled={!replyText.trim() || commentSubmitting}
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
                            {/* The <ul> stays a <ul> — Collapse's own wrapper is a
                                div, and a div between a list and its items is
                                invalid markup a screen reader will not read as a
                                list. */}
                            <Collapse open={!isReply && expanded && replies.length > 0} className="mt-3">
                              <ul className="space-y-3">
                                {replies.map((reply) => renderCommentRow(reply, true))}
                              </ul>
                            </Collapse>
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
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleAddComment(r.id); }}
                          />
                          <button
                            type="button"
                            onClick={() => handleAddComment(r.id)}
                            disabled={!newComment.trim() || commentSubmitting}
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
            </FeedPost>
          </li>
          );
        })}
      </ul>
      </>
      )}

      {/* The end of the feed says so, and offers the one thing that makes
          it longer. Running out of posts used to just stop. */}
      {feedItems.length > 0 && (
        <div className="px-5 pt-[26px] flex flex-col items-start gap-2.5">
          <p className="text-on-surface" style={{ fontSize: '16px', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.028em' }}>
            {activityFilter === 'experts' ? "That's everything from verified users"
              : showSuggestions ? 'Follow people to make this feed your own'
              : "That's everything from your circle"}
          </p>
          <p className="text-on-surface/45 max-w-[280px]" style={{ fontSize: '13.5px', lineHeight: 1.5, textWrap: 'pretty' } as React.CSSProperties}>
            Follow a few more people, or switch to Verified to see critics and chefs.
          </p>
          <Link
            to="/circle"
            className="mt-1 inline-flex items-center gap-[7px] rounded-full border border-on-surface/20 text-on-surface px-[15px] py-[11px] active:opacity-75 transition-opacity"
            style={{ fontSize: '12.5px', fontWeight: 700 }}
          >
            Find people to follow
            <ChevronRight size={12} />
          </Link>
        </div>
      )}
        </div>
        {!phoneMode && !feedOnly && (
          <aside className="hidden xl:block xl:sticky xl:top-4 xl:pt-12 xl:self-start">
            <SuggestionsRail userId={userId} friendIds={friendIds} suggestedRestaurants={suggestedRestaurants} />
          </aside>
        )}
      </div>

      <ShareDialog
        open={!!shareRecipeData}
        payload={shareRecipeData ? { sharedRecipe: shareRecipeData } : null}
        onClose={() => setShareRecipeData(null)}
      />

      {/* Recipe comment thread — bottom sheet opened from a meal card's
          comment button. The full thread also lives on the recipe detail
          page; this is the quick in-feed entry point.
          Portaled to body: on the phone home layout this feed lives inside
          Discover's draggable results sheet, whose will-change-transform
          creates a stacking context that clamps an in-place overlay below
          the app's other floating chrome (the z-45 assistant FAB). */}
      {createPortal(<AnimatePresence>
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
              ref={recipeCommentsSheetRef as React.RefObject<HTMLDivElement>}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
              {...recipeCommentsDragProps}
              onClick={(e) => e.stopPropagation()}
              className="bg-paper w-full rounded-t-3xl flex flex-col"
              style={{ height: '75%', paddingBottom: 'var(--kb-height, 0px)' }}
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
                scrollRef={recipeCommentsScrollRef}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}

      {/* ─── Post comments overlay ─────────────────────────────────────
          Mobile/phone-frame: bottom sheet (Instagram-style). Desktop:
          centered modal dialog. Both wrap the same CommentsBody so the
          composer + list logic is shared with the reels page.
          Portaled to body for the same stacking-context reason as the
          recipe sheet above. */}
      {createPortal(<AnimatePresence>
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
                ref={postCommentsSheetRef as React.RefObject<HTMLDivElement>}
                initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
                {...postCommentsDragProps}
                onClick={(e) => e.stopPropagation()}
                className="bg-surface w-full rounded-t-[24px] flex flex-col"
                style={{ height: '78%', paddingBottom: 'var(--kb-height, 0px)' }}
              >
                <div className="pt-2.5 pb-1 flex justify-center">
                  <span className="w-9 h-1 rounded-full bg-on-surface/15" />
                </div>
                <CommentsBody
                  targetId={openPostCommentsId}
                  onClose={() => setOpenPostCommentsId(null)}
                  variant="sheet"
                  loadComments={loadPostCommentsAdapter}
                  addComment={addPostCommentAdapter}
                  deleteComment={deletePostCommentAdapter}
                  currentUserId={userId}
                  scrollRef={postCommentsScrollRef}
                />
              </motion.div>
            </motion.div>
          )
        )}
      </AnimatePresence>, document.body)}

      {/* Share dialog */}
      <ShareDialog
        open={!!sharePayload}
        payload={sharePayload}
        onClose={() => setSharePayload(null)}
      />
    </section>
  );
};
