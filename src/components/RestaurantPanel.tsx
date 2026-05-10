/**
 * RestaurantPanel — side panel / bottom sheet that opens when a viewer taps
 * a "featured restaurant" card on a reel or post. Shows the restaurant at a
 * glance without yanking the user out of the feed: community / friends /
 * expert scores, your own rating if you have one, the address, and quick
 * actions to rate, add to a list, or jump to the full detail page.
 *
 * The panel is presentation-only — it pulls everything it needs from
 * ListsContext (your rating, lists membership) and the supabase-community
 * helpers (community / friends / expert ratings). Modals (rate, add-to-list)
 * are opened by toggling state on ListsContext so the page-level mounted
 * modals handle them — no chrome duplicated here.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router-dom';
import { X, MapPin, Star, Heart, Plus, Bookmark, ChevronRight, Pencil, Users, Award, Loader2, ImageOff } from 'lucide-react';
import { cn } from '../lib/utils';
import { scoreColor, scoreBadgeBg } from '../lib/score';
import { useLists } from '../contexts/ListsContext';
import {
  getCommunityStats,
  getFriendsStats,
  getExpertRecommendations,
  getProfilesByIds,
  type CommunityRating,
  type ExpertRecommendation,
  type UserProfile,
} from '../lib/supabase-community';
import type { ReelRestaurantSnapshot } from '../lib/supabase-reels';

/* ── Snapshot the panel accepts ───────────────────────────────────────────
   We accept any object that quacks like a ReelRestaurantSnapshot so reels
   and posts can both open the same panel without conversion. */
export type RestaurantPanelSnapshot = ReelRestaurantSnapshot;

interface RestaurantPanelProps {
  snapshot: RestaurantPanelSnapshot | null;
  onClose: () => void;
  currentUserId: string | null;
  variant: 'panel' | 'sheet';
}

function formatRelativeDate(iso: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = Math.floor((Date.now() - t) / 86_400_000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ── Score pill (Community / Friends / Experts) ───────────────────────── */

const ScorePill: React.FC<{
  label: string;
  score: number;
  count: number;
  icon: React.ReactNode;
}> = ({ label, score, count, icon }) => {
  const has = count > 0;
  return (
    <div className={cn(
      'flex flex-col gap-1.5 rounded-2xl border px-3 py-3 transition-colors',
      has ? scoreBadgeBg(score) : 'bg-on-surface/[0.03] border-on-surface/[0.07]',
    )}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface/55">
        <span className="opacity-80">{icon}</span>
        {label}
      </div>
      {has ? (
        <div className="flex items-baseline gap-1.5">
          <span className={cn('text-[22px] font-bold tabular-nums leading-none', scoreColor(score))}>
            {score.toFixed(1)}
          </span>
          <span className="text-[11px] text-on-surface/55 tabular-nums">
            · {count}
          </span>
        </div>
      ) : (
        <span className="text-[13px] text-on-surface/40 leading-none mt-1">No ratings</span>
      )}
    </div>
  );
};

/* ── A single review row (friend or expert) ───────────────────────────── */

const ReviewRow: React.FC<{
  initials: string;
  name: string;
  username?: string;
  isExpert?: boolean;
  score: number;
  body: string;
  date: string;
}> = ({ initials, name, username, isExpert, score, body, date }) => (
  <div className="flex items-start gap-3 py-3">
    <div className="w-9 h-9 rounded-full bg-on-surface/10 text-on-surface flex items-center justify-center text-[12px] font-bold flex-shrink-0">
      {initials}
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-[13px] font-bold text-on-surface truncate">{name}</span>
        {isExpert && (
          <span className="inline-flex items-center gap-0.5 px-1 py-px rounded-sm bg-amber-200 text-amber-900 text-[9px] font-bold">
            <Star size={8} className="fill-amber-900" />
            EXPERT
          </span>
        )}
        {username && (
          <span className="text-[11px] text-on-surface/45 truncate">@{username}</span>
        )}
      </div>
      <div className="flex items-baseline gap-2 mt-0.5">
        <span className={cn('text-[14px] font-bold tabular-nums leading-none', scoreColor(score))}>
          {score.toFixed(1)}
        </span>
        <span className="text-[11px] text-on-surface/40">{date}</span>
      </div>
      {body && (
        <p className="text-[13px] text-on-surface/75 leading-snug mt-1 line-clamp-3">
          {body}
        </p>
      )}
    </div>
  </div>
);

/* ── Body (shared between sheet + panel) ──────────────────────────────── */

const RestaurantPanelBody: React.FC<{
  snapshot: RestaurantPanelSnapshot;
  onClose: () => void;
  currentUserId: string | null;
}> = ({ snapshot, onClose, currentUserId }) => {
  const {
    getRating,
    isWishlisted,
    toggleWishlist,
    openRatingModal,
    openAddToListModal,
    getListsForRestaurant,
  } = useLists();

  const myRating = getRating(snapshot.id);
  const wishlisted = isWishlisted(snapshot.id);
  const myLists = useMemo(() => getListsForRestaurant(snapshot.id), [snapshot.id, getListsForRestaurant]);

  const [community, setCommunity] = useState<{ avg: number; count: number; ratings: CommunityRating[] } | null>(null);
  const [friends, setFriends] = useState<{ avg: number; count: number; ratings: CommunityRating[] } | null>(null);
  const [experts, setExperts] = useState<ExpertRecommendation[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);

  // Fetch community / friends / expert data on open. We re-run on
  // restaurant change so reopening for a different place refreshes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCommunity(null);
    setFriends(null);
    setExperts([]);
    setProfiles({});

    const load = async () => {
      const [c, f, e] = await Promise.all([
        getCommunityStats(snapshot.id),
        currentUserId ? getFriendsStats(currentUserId, snapshot.id) : Promise.resolve({ avgScore: 0, totalRatings: 0, ratings: [] }),
        getExpertRecommendations(snapshot.id),
      ]);
      if (cancelled) return;
      setCommunity({ avg: c.avgScore, count: c.totalRatings, ratings: c.ratings });
      setFriends({ avg: f.avgScore, count: f.totalRatings, ratings: f.ratings });
      setExperts(e);
      // Pull profile rows for the friend reviewers so we can render proper
      // display names + avatars instead of opaque user ids.
      const ids = Array.from(new Set(f.ratings.map((r) => r.user_id))).slice(0, 6);
      if (ids.length > 0) {
        const profs = await getProfilesByIds(ids);
        if (!cancelled) setProfiles(profs);
      }
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [snapshot.id, currentUserId]);

  const meta = useMemo(() => ({
    id: snapshot.id,
    name: snapshot.name,
    image: snapshot.image || '',
    cuisine: snapshot.cuisine,
    price: snapshot.price,
    address: snapshot.address,
  }), [snapshot]);

  const onRate = () => openRatingModal(meta);
  const onAddToList = () => openAddToListModal(snapshot.id, meta);
  const onWishlist = () => toggleWishlist(meta);

  const distance = snapshot.distanceMi != null ? `${snapshot.distanceMi.toFixed(1)} mi` : '';

  // Friend review preview — top 3 by score, falling back to date order.
  const topFriendReviews = useMemo(() => {
    if (!friends) return [];
    return [...friends.ratings].slice(0, 3);
  }, [friends]);

  return (
    <>
      {/* Header — hero image, name overlay, close pill */}
      <div className="relative flex-shrink-0">
        <div className="relative h-[148px] w-full bg-on-surface/5 overflow-hidden">
          {snapshot.image ? (
            <img
              src={snapshot.image}
              alt=""
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-clay/30 to-olive/20 flex items-center justify-center text-on-surface/30">
              <ImageOff size={28} />
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/65 via-black/25 to-transparent" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/45 backdrop-blur text-white hover:bg-black/65 flex items-center justify-center transition-colors"
          >
            <X size={16} />
          </button>
          <button
            type="button"
            onClick={onWishlist}
            aria-label={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
            aria-pressed={wishlisted}
            className={cn(
              'absolute top-3 left-3 w-8 h-8 rounded-full backdrop-blur flex items-center justify-center transition-colors',
              wishlisted
                ? 'bg-rose-500/95 text-white hover:bg-rose-600'
                : 'bg-black/45 text-white hover:bg-black/65',
            )}
          >
            <Heart size={16} className={cn(wishlisted && 'fill-white')} />
          </button>
          <div className="absolute inset-x-0 bottom-0 px-4 pb-3 text-white">
            <h2 className="font-serif font-bold text-[20px] leading-tight tracking-tight line-clamp-2 drop-shadow-sm">
              {snapshot.name}
            </h2>
            <p className="text-[12px] text-white/85 mt-0.5 truncate">
              {[snapshot.cuisine, snapshot.price, distance].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-4 pb-5 space-y-5">
        {/* Address row */}
        {snapshot.address && (
          <div className="flex items-start gap-2 text-on-surface/70">
            <MapPin size={14} className="mt-0.5 flex-shrink-0 text-on-surface/55" />
            <p className="text-[13px] leading-snug">{snapshot.address}</p>
          </div>
        )}

        {/* Score grid: Community / Friends / Experts */}
        <div className="grid grid-cols-3 gap-2">
          <ScorePill
            label="Community"
            score={community?.avg ?? 0}
            count={community?.count ?? 0}
            icon={<Users size={11} />}
          />
          <ScorePill
            label="Friends"
            score={friends?.avg ?? 0}
            count={friends?.count ?? 0}
            icon={<Heart size={11} />}
          />
          <ScorePill
            label="Experts"
            score={
              experts.length > 0
                ? experts.reduce((s, e) => s + (e.rating || 0), 0) / experts.length
                : 0
            }
            count={experts.length}
            icon={<Award size={11} />}
          />
        </div>

        {/* Your rating (if any) — or the rate / add-to-list call to action */}
        {myRating ? (
          <div className="rounded-2xl border border-on-surface/[0.08] bg-paper p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface/55">Your rating</span>
              <button
                type="button"
                onClick={onRate}
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-on-surface/70 hover:text-on-surface transition-colors"
              >
                <Pencil size={12} />
                Edit
              </button>
            </div>
            <div className="flex items-baseline gap-2">
              <span className={cn('text-[28px] font-bold tabular-nums leading-none', scoreColor(myRating.score))}>
                {myRating.score.toFixed(1)}
              </span>
              <span className="text-[11px] text-on-surface/45">
                {formatRelativeDate(myRating.visitDate)}
              </span>
            </div>
            {myRating.notes && (
              <p className="text-[13px] text-on-surface/75 leading-snug mt-2 line-clamp-3 whitespace-pre-wrap">
                {myRating.notes}
              </p>
            )}
            {myRating.tags && myRating.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {myRating.tags.slice(0, 6).map((t) => (
                  <span key={t} className="px-2 py-0.5 rounded-full bg-on-surface/[0.06] text-on-surface/75 text-[11px] font-medium">
                    {t}
                  </span>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={onAddToList}
              className="mt-3 w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-full border border-on-surface/[0.12] text-on-surface text-[13px] font-semibold hover:bg-on-surface/[0.04] transition-colors"
            >
              <Bookmark size={14} />
              {myLists.length > 0
                ? `In ${myLists.length} list${myLists.length === 1 ? '' : 's'}`
                : 'Add to list'}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={onRate}
              className="w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-full bg-on-surface text-surface text-[14px] font-bold hover:bg-on-surface/90 transition-colors"
            >
              <Star size={15} className="fill-current" />
              Rate this restaurant
            </button>
            <button
              type="button"
              onClick={onAddToList}
              className="w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-full border border-on-surface/[0.12] text-on-surface text-[13px] font-semibold hover:bg-on-surface/[0.04] transition-colors"
            >
              <Plus size={14} />
              {myLists.length > 0
                ? `In ${myLists.length} list${myLists.length === 1 ? '' : 's'} · Edit`
                : 'Add to a list'}
            </button>
          </div>
        )}

        {/* Friends section */}
        {loading ? (
          <div className="flex items-center justify-center py-6 text-on-surface/45">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : (
          <>
            {topFriendReviews.length > 0 && (
              <section>
                <div className="flex items-baseline justify-between mb-1">
                  <h3 className="font-serif font-bold text-on-surface text-[14px]">From people you follow</h3>
                  {friends && friends.count > topFriendReviews.length && (
                    <span className="text-[11px] text-on-surface/45">{friends.count} total</span>
                  )}
                </div>
                <div className="divide-y divide-on-surface/[0.07]">
                  {topFriendReviews.map((r) => {
                    const p = profiles[r.user_id];
                    const name = p?.display_name || p?.username || 'Friend';
                    const initials = (p?.display_name || p?.username || r.user_id).slice(0, 2).toUpperCase();
                    return (
                      <ReviewRow
                        key={r.id}
                        initials={initials}
                        name={name}
                        username={p?.username}
                        isExpert={p?.is_expert}
                        score={Number(r.score)}
                        body={r.notes}
                        date={formatRelativeDate(r.visit_date || r.created_at)}
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {experts.length > 0 && (
              <section>
                <h3 className="font-serif font-bold text-on-surface text-[14px] mb-1">Expert picks</h3>
                <div className="divide-y divide-on-surface/[0.07]">
                  {experts.slice(0, 3).map((e) => (
                    <ReviewRow
                      key={e.id}
                      initials={(e.expert_name || e.expert_username || 'EX').slice(0, 2).toUpperCase()}
                      name={e.expert_name || 'Expert'}
                      username={e.expert_username}
                      isExpert
                      score={Number(e.rating)}
                      body={e.recommendation_text}
                      date={formatRelativeDate(e.updated_at || e.created_at)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Empty state — no friends, no experts, no community: just nudge
                the user to be the first. */}
            {(friends?.count ?? 0) === 0 && experts.length === 0 && (community?.count ?? 0) === 0 && !myRating && (
              <div className="rounded-2xl bg-on-surface/[0.04] border border-on-surface/[0.06] px-4 py-5 text-center">
                <p className="text-[13px] text-on-surface/65">
                  No reviews yet. Be the first to share what you thought.
                </p>
              </div>
            )}
          </>
        )}

        {/* Full details link */}
        <Link
          to={`/restaurant/${encodeURIComponent(snapshot.id)}`}
          onClick={onClose}
          className="flex items-center justify-between gap-2 px-4 py-3 rounded-2xl border border-on-surface/[0.08] hover:bg-on-surface/[0.04] transition-colors"
        >
          <span className="text-[13px] font-semibold text-on-surface">See full details</span>
          <ChevronRight size={16} className="text-on-surface/45" />
        </Link>
      </div>
    </>
  );
};

/* ── Desktop side panel ───────────────────────────────────────────────── */

export const RestaurantPanel: React.FC<RestaurantPanelProps> = ({ snapshot, onClose, currentUserId, variant }) => {
  if (variant === 'sheet') {
    return (
      <AnimatePresence>
        {snapshot && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-black/55 backdrop-blur-sm flex items-end"
            onClick={onClose}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface w-full rounded-t-3xl flex flex-col"
              style={{ height: '82%' }}
            >
              <div className="pt-2 pb-1 flex justify-center flex-shrink-0">
                <span className="w-10 h-1 rounded-full bg-on-surface/15" />
              </div>
              <RestaurantPanelBody snapshot={snapshot} onClose={onClose} currentUserId={currentUserId} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {snapshot && (
        <motion.div
          key={snapshot.id}
          initial={{ opacity: 0, x: 20, width: 0 }}
          animate={{ opacity: 1, x: 0, width: 380 }}
          exit={{ opacity: 0, x: 20, width: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 280 }}
          className="h-full bg-surface border border-on-surface/[0.08] rounded-[24px] overflow-hidden flex flex-col flex-shrink-0"
        >
          <div className="w-[380px] h-full flex flex-col">
            <RestaurantPanelBody snapshot={snapshot} onClose={onClose} currentUserId={currentUserId} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
