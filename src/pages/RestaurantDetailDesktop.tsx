import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Star, MapPin, Phone, Globe,
  ChevronLeft, ChevronRight, ChevronDown, Loader2,
  Navigation, ExternalLink, X, Users, UserCircle, Share2, Bookmark,
  Edit3, Send, Building2, TrendingUp, TrendingDown,
  Car, Footprints, Trash2, RotateCw, Award, Plus, Image as ImageIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { ScoreBadge } from '../components/ScoreBadge';
import { useRestaurantDetail, formatReviewCount, getTodayHours, getCuisineLabel } from './useRestaurantDetail';
import { MichelinBadge } from '../components/MichelinBadge';
import { useLists } from '../contexts/ListsContext';
import { type SharedRestaurant } from '../contexts/ChatContext';
import { ShareDialog } from '../components/ShareDialog';
import { useAuth } from '../contexts/AuthContext';
import { getProfilesByIds, type UserProfile as UP } from '../lib/supabase-community';
import { loadLastSelectedLocation, isExactAddress } from '../components/HomeLocationBar';
import { haversineDistanceMi, formatDistance } from '../lib/distance';
import { useTravelTimes, formatTravelTime } from '../lib/directions';
import { PhotoGallery } from '../components/PhotoGallery';
import { RestaurantFeaturedReels } from '../components/RestaurantFeaturedReels';
import { Link } from 'react-router-dom';
import { useBottomSheet } from '../lib/useBottomSheet';
import { RadarChart } from '../components/RadarChart';
import { getFlavorProfile } from '../lib/flavorProfile';
import 'mapbox-gl/dist/mapbox-gl.css';

/** Parse hours array to find next opening time when currently closed */
function getNextOpenTime(hours: string[]): string {
  if (!hours || hours.length === 0) return '';
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const now = new Date();
  const todayIdx = now.getDay();

  for (let offset = 0; offset < 7; offset++) {
    const dayIdx = (todayIdx + offset) % 7;
    const dayName = days[dayIdx];
    const entry = hours.find((h) => h.startsWith(dayName));
    if (!entry) continue;
    if (/closed/i.test(entry)) continue;
    const timePart = entry.split(':').slice(1).join(':').trim();
    const openMatch = timePart.match(/^(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)/i);
    if (!openMatch) continue;
    const openTime = openMatch[1].trim();
    if (offset === 0) return `today at ${openTime}`;
    if (offset === 1) return `tomorrow at ${openTime}`;
    return `${dayName} at ${openTime}`;
  }
  return '';
}

/** Short "last week / last month" style recency label. */
function timeAgo(date: string): string {
  if (!date) return '';
  const d = new Date(date.length === 10 ? `${date}T12:00:00` : date);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return 'today';
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (days < 14) return 'last week';
  if (days < 45) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 75) return 'last month';
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/* ── Small shared styling helpers for the redesign ──────────────────────
   Score colours follow the design-system palette (emerald ≥ 8 / amber 5–7
   / red < 5) — the same tiers the score rings use elsewhere in the app. */
const SCORE_HIGH = '#10b981';
const SCORE_MID = '#f59e0b';
const SCORE_LOW = '#ef4444';
const scoreColor = (s: number) => (s >= 8 ? SCORE_HIGH : s >= 5 ? SCORE_MID : SCORE_LOW);
/** Soft card surface used throughout the page. */
const CARD = 'bg-white border border-on-surface/[0.07] rounded-2xl';
/** Section heading (serif, matches the reference). */
const H2 = 'font-serif font-bold text-[22px] tracking-[-0.02em] text-on-surface';

export const RestaurantDetailDesktop: React.FC = () => {
  const {
    place, michelin, loading, error, navigate,
    photoIndex, setPhotoIndex,
    galleryOpen, setGalleryOpen,
    mapContainerRef,
    priceStr, cuisine,
    photos, directionsUrl, mapsUrl,
    communityStats, friendsStats, communityPhotos, expertRecommendations,
    showFriendsDetail, setShowFriendsDetail,
    visitHistory, visitCount,
  } = useRestaurantDetail();

  // Sticky-nav title fade — appears once the editorial hero has scrolled
  // out of view. Threshold matches the rough height of the hero block.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 320);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Resolve the user's anchored origin once per mount. The distance suffix
  // and Mapbox Directions hook below both gate on isExactAddress, so a
  // city-level / unset home renders nothing extra.
  const homeLocationForDistance = React.useMemo(() => {
    const h = loadLastSelectedLocation();
    return isExactAddress(h) ? h : null;
  }, []);
  const destForDistance = place && Number.isFinite(place.lat) && Number.isFinite(place.lng)
    ? { lat: place.lat, lng: place.lng }
    : null;
  const { driveMin, walkMin } = useTravelTimes(homeLocationForDistance, destForDistance);
  const driveLabel = formatTravelTime(driveMin);
  const walkLabel = formatTravelTime(walkMin);

  const [hoursOpen, setHoursOpen] = useState(false);
  const [myRatingOpen, setMyRatingOpen] = useState(true);

  const { toggleWishlist, isWishlisted, getRating, openAddRestaurantModal, deleteVisit } = useLists();
  const [confirmDeleteVisitId, setConfirmDeleteVisitId] = useState<string | null>(null);
  const { dragProps: friendsDetailDragProps } = useBottomSheet(showFriendsDetail, () => setShowFriendsDetail(false));
  const { user } = useAuth();
  const myRatingRef = useRef<HTMLElement | null>(null);
  const [expandedVisit, setExpandedVisit] = useState<string | null>(null);
  const [friendNames, setFriendNames] = useState<Record<string, string>>({});
  const [chatShareTarget, setChatShareTarget] = useState<SharedRestaurant | null>(null);
  const [expandedExpertId, setExpandedExpertId] = useState<string | null>(null);
  const [friendReviewProfiles, setFriendReviewProfiles] = useState<Record<string, UP>>({});
  // Which circle review is expanded (one open at a time, like the reference).
  const [openCircleId, setOpenCircleId] = useState<string | null>(null);

  useEffect(() => {
    const ids = (Array.from(new Set(friendsStats.ratings.map((r) => r.user_id))).filter(Boolean)) as string[];
    if (ids.length === 0) return;
    getProfilesByIds(ids).then(setFriendReviewProfiles);
  }, [friendsStats.ratings]);

  const myRating = place ? getRating(place.id) : undefined;

  useEffect(() => {
    if (!myRating?.friendIds?.length) return;
    getProfilesByIds(myRating.friendIds).then((profiles) => {
      const names: Record<string, string> = {};
      Object.values(profiles).forEach((p) => { names[p.user_id] = p.display_name || `@${p.username}`; });
      setFriendNames(names);
    });
  }, [myRating?.friendIds]);

  // Open the first circle review by default once friends load.
  useEffect(() => {
    if (openCircleId == null && friendsStats.ratings.length > 0) {
      setOpenCircleId(friendsStats.ratings[0].id);
    }
  }, [friendsStats.ratings, openCircleId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 size={40} className="animate-spin text-primary" />
      </div>
    );
  }

  if (error || !place) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-4 px-8">
        <p className="text-on-surface/60 text-center">{error || 'Restaurant not found'}</p>
        <button onClick={() => navigate(-1)} className="text-primary font-medium">Go Back</button>
      </div>
    );
  }

  // Build a SharedRestaurant payload for the share dialog. Used in
  // multiple places so factored out to avoid drift.
  const buildShareTarget = (): SharedRestaurant => ({
    restaurantId: place.id,
    name: place.name,
    image: place.photoUrl || '',
    cuisine,
    price: priceStr,
    address: place.fullAddress || place.address,
    ...(myRating ? {
      score: myRating.score,
      notes: myRating.notes,
      wouldReturn: myRating.wouldReturn,
      tags: myRating.tags,
      isReview: true,
    } : { isReview: false }),
  });

  // Restaurant meta passed to the add/edit rating modal (shared by the hero
  // CTA, the My-rating Re-rate button, and per-field edit deep-links).
  const ratingMeta = {
    id: place.id, name: place.name,
    image: place.photoUrl || '',
    cuisine,
    price: priceStr,
    address: place.fullAddress || place.address,
  };

  const hasPhotos = photos.length > 0;
  const badgeScore = myRating?.score ?? (communityStats.totalRatings > 0 ? communityStats.avgScore : null);
  const badgeIsPersonal = !!myRating;
  const dist = homeLocationForDistance && destForDistance
    ? formatDistance(haversineDistanceMi(homeLocationForDistance.lat, homeLocationForDistance.lng, destForDistance.lat, destForDistance.lng))
    : '';

  /* ── Hero score circle (reuse for photo + editorial heroes) ─────────── */
  const HeroScore: React.FC<{ onPhoto: boolean }> = ({ onPhoto }) =>
    badgeScore == null ? null : (
      <div className="flex flex-col items-center gap-2 flex-shrink-0">
        <div
          className="w-[84px] h-[84px] rounded-full grid place-items-center font-serif font-bold text-[31px] text-white tabular-nums tracking-[-0.02em]"
          style={{
            background: scoreColor(badgeScore),
            boxShadow: `0 10px 26px ${scoreColor(badgeScore)}59, inset 0 0 0 1.5px rgba(255,255,255,0.3)`,
          }}
          aria-label={badgeIsPersonal ? `Your rating ${badgeScore.toFixed(1)}` : `Community rating ${badgeScore.toFixed(1)}`}
        >
          {badgeScore.toFixed(1)}
        </div>
        <div className={cn(
          'text-[11px] font-bold uppercase tracking-[0.12em]',
          onPhoto ? 'text-white/85' : 'text-on-surface/45',
        )}>
          {badgeIsPersonal ? 'Your rating' : `Everyone · ${communityStats.totalRatings}`}
        </div>
      </div>
    );

  /* ── Hero CTA row: Add rating / Re-rate + wishlist heart ────────────── */
  const HeroActions: React.FC<{ onPhoto: boolean }> = ({ onPhoto }) => (
    <div className="flex items-center gap-2.5 mt-5">
      <button
        type="button"
        onClick={() => (myRating
          ? openAddRestaurantModal(ratingMeta, 'new-visit')
          : openAddRestaurantModal(ratingMeta))}
        className="inline-flex items-center gap-2 bg-primary text-white rounded-full pl-4 pr-5 py-2.5 text-sm font-bold hover:-translate-y-px transition-transform"
        style={{ boxShadow: onPhoto ? '0 4px 14px rgba(0,0,0,0.24)' : 'var(--shadow-sm)' }}
      >
        {myRating ? <RotateCw size={16} /> : <Plus size={17} strokeWidth={2.5} />}
        {myRating ? 'Re-rate' : 'Add rating'}
      </button>
      <button
        type="button"
        onClick={() => toggleWishlist({
          id: place.id, name: place.name, image: place.photoUrl || '',
          cuisine, price: priceStr, address: place.fullAddress || place.address,
        })}
        aria-label={isWishlisted(place.id) ? 'Remove from wishlist' : 'Save to wishlist'}
        className={cn(
          'w-11 h-11 rounded-full grid place-items-center transition-colors',
          onPhoto
            ? 'bg-white/16 backdrop-blur-md text-white hover:bg-white/26'
            : 'bg-on-surface/[0.05] text-on-surface hover:bg-on-surface/[0.09]',
          isWishlisted(place.id) && (onPhoto ? '!text-amber-300' : '!text-primary'),
        )}
      >
        <Bookmark size={20} className={isWishlisted(place.id) ? 'fill-current' : ''} />
      </button>
    </div>
  );

  return (
    <div className="bg-surface min-h-screen pb-24">
      {/* ── Sticky header — Back · title-on-scroll · Share / Save / More ── */}
      <header className="sticky top-0 z-50 bg-surface/82 backdrop-blur-xl border-b border-on-surface/[0.06]">
        <div className="max-w-[1200px] mx-auto h-16 px-6 lg:px-10 grid grid-cols-[1fr_auto_1fr] items-center">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="justify-self-start inline-flex items-center gap-1.5 text-[15px] font-bold text-on-surface hover:bg-on-surface/[0.05] rounded-full pl-2 pr-3.5 py-2 transition-colors"
          >
            <ChevronLeft size={20} />
            Back
          </button>
          <div className={cn(
            'justify-self-center font-serif font-bold text-lg tracking-[-0.01em] truncate transition-all duration-200',
            scrolled ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1',
          )}>
            {place.name}
          </div>
          <div className="justify-self-end flex items-center gap-1">
            <button
              type="button"
              onClick={() => setChatShareTarget(buildShareTarget())}
              aria-label="Share"
              className="w-10 h-10 rounded-full grid place-items-center text-on-surface hover:bg-on-surface/[0.05] transition-colors"
            >
              <Share2 size={18} />
            </button>
            <button
              type="button"
              onClick={() => toggleWishlist({
                id: place.id, name: place.name, image: place.photoUrl || '',
                cuisine, price: priceStr, address: place.fullAddress || place.address,
              })}
              aria-label={isWishlisted(place.id) ? 'Remove from wishlist' : 'Save to wishlist'}
              className={cn('w-10 h-10 rounded-full grid place-items-center hover:bg-on-surface/[0.05] transition-colors', isWishlisted(place.id) ? 'text-primary' : 'text-on-surface')}
            >
              <Bookmark size={18} className={isWishlisted(place.id) ? 'fill-current' : ''} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10 pt-8">
        {hasPhotos ? (
          // Photo hero — full-bleed image with overlaid name, score, actions.
          <div className="relative h-[440px] rounded-[26px] overflow-hidden bg-on-surface/[0.06] shadow-sm">
            <img src={photos[photoIndex]} alt={place.name} referrerPolicy="no-referrer" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(14,10,8,0.88) 2%, rgba(14,10,8,0.34) 42%, rgba(14,10,8,0.04) 100%)' }} />

            {photos.length > 0 && (
              <button
                type="button"
                onClick={() => setGalleryOpen(true)}
                className="absolute top-[18px] right-[18px] inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-black/35 backdrop-blur-md text-white text-xs font-bold hover:bg-black/50 transition-colors"
              >
                <ImageIcon size={15} />
                {photos.length} {photos.length === 1 ? 'Photo' : 'Photos'}
              </button>
            )}

            <div className="absolute left-0 right-0 bottom-0 p-[38px_42px] flex items-end justify-between gap-7">
              <div className="min-w-0">
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/82">
                  {cuisine}{priceStr ? ` · ${priceStr}` : ''}
                </div>
                <h1 className="mt-3 font-serif font-bold text-white text-[58px] leading-[0.98] tracking-[-0.03em]">
                  {place.name}
                </h1>
                {michelin && (
                  <div className="mt-4">
                    <MichelinBadge michelin={michelin} size="md" href={michelin.guideUrl} />
                  </div>
                )}
                <HeroActions onPhoto />
              </div>
              <HeroScore onPhoto />
            </div>
          </div>
        ) : (
          // Editorial header — no photo available.
          <>
            <div className="flex items-start justify-between gap-8 pt-1">
              <div className="min-w-0">
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface/55">
                  {cuisine}{priceStr ? ` · ${priceStr}` : ''}
                </div>
                <h1 className="mt-3.5 font-serif font-bold text-on-surface text-[56px] leading-none tracking-[-0.03em]">
                  {place.name}
                </h1>
                {michelin && (
                  <div className="mt-4">
                    <MichelinBadge michelin={michelin} size="md" href={michelin.guideUrl} />
                  </div>
                )}
                <HeroActions onPhoto={false} />
              </div>
              <div className="pt-2"><HeroScore onPhoto={false} /></div>
            </div>
            <div className="h-px bg-on-surface/[0.07] mt-7" />
          </>
        )}

        {/* ── Meta bar — address · distance · travel times · open status ── */}
        <div className="flex items-center flex-wrap gap-x-4 gap-y-3 pt-5 px-1">
          <span className="inline-flex items-center gap-2 text-[14.5px] font-semibold text-on-surface">
            <MapPin size={16} className="text-primary" />
            {place.address}
          </span>
          {dist && (
            <>
              <span className="w-[3px] h-[3px] rounded-full bg-on-surface/40" />
              <span className="text-[14.5px] font-semibold text-on-surface/55">{dist}</span>
            </>
          )}
          {driveLabel && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-on-surface/[0.05] text-[13px] font-semibold text-on-surface/70">
              <Car size={15} /> {driveLabel}
            </span>
          )}
          {walkLabel && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-on-surface/[0.05] text-[13px] font-semibold text-on-surface/70">
              <Footprints size={15} /> {walkLabel}
            </span>
          )}
          {place.isOpen !== null && (
            <span className="ml-auto inline-flex items-center gap-2">
              <span className={cn('w-2 h-2 rounded-full', place.isOpen ? 'bg-green-500' : 'bg-red-500')} />
              <span className={cn('text-sm font-bold', place.isOpen ? 'text-green-700' : 'text-red-600')}>
                {place.isOpen ? 'Open' : 'Closed'}
              </span>
              {place.isOpen ? (() => {
                const close = getTodayHours(place.hours).split(/\s*[–-]\s*/)[1];
                return close ? <span className="text-sm font-medium text-on-surface/55">closes {close.trim()}</span> : null;
              })() : (() => {
                const next = getNextOpenTime(place.hours);
                return next ? <span className="text-sm font-medium text-on-surface/55">opens {next}</span> : null;
              })()}
            </span>
          )}
        </div>
      </div>

      {/* ── Two-column body ── */}
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10 pt-9 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-x-14 gap-y-10 items-start">

        {/* ════════ MAIN ════════ */}
        <main className="min-w-0 flex flex-col gap-11">

          {/* ── Ratings ── */}
          {(() => {
            const expertAvg = expertRecommendations.length > 0
              ? expertRecommendations.reduce((sum, r) => sum + Number(r.rating), 0) / expertRecommendations.length
              : 0;
            const expertCount = expertRecommendations.length;
            const hasCommunity = communityStats.totalRatings > 0;
            const hasFriends = friendsStats.totalRatings > 0;
            const hasExperts = expertCount > 0;
            const hasGoogle = Number(place.rating) > 0 && place.userRatingCount > 0;

            const Cell: React.FC<{ label: string; score: number | null; count: number; countLabel: string; emptyCopy: string; onClick?: () => void; bordered?: boolean }> =
              ({ label, score, count, countLabel, emptyCopy, onClick, bordered }) => {
              const body = (
                <div className={cn('flex flex-col items-center gap-2.5 py-5 px-4', bordered && 'border-l border-on-surface/[0.06]')}>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/40">{label}</div>
                  {score != null ? (
                    <div className="w-[52px] h-[52px] rounded-full grid place-items-center font-serif font-bold text-xl text-white tabular-nums"
                      style={{ background: scoreColor(score), boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.22)' }}>
                      {score.toFixed(1)}
                    </div>
                  ) : (
                    <div className="w-[52px] h-[52px] rounded-full grid place-items-center bg-on-surface/[0.03]" style={{ boxShadow: 'inset 0 0 0 1.5px rgba(30,27,26,0.08)' }}>
                      <div className="w-[18px] h-[2.5px] rounded bg-on-surface/30" />
                    </div>
                  )}
                  <div className={cn('text-[12.5px] text-center', score != null ? 'font-semibold text-on-surface/55' : 'font-serif italic text-on-surface/40')}>
                    {score != null ? `${count.toLocaleString()} ${countLabel}` : emptyCopy}
                  </div>
                </div>
              );
              return onClick ? (
                <button type="button" onClick={onClick} className="transition-colors hover:bg-on-surface/[0.02]">{body}</button>
              ) : <div>{body}</div>;
            };

            return (
              <section>
                <div className={cn(CARD, 'overflow-hidden')}>
                  <div className="grid grid-cols-3">
                    <Cell label="Everyone"
                      score={hasCommunity ? communityStats.avgScore : null}
                      count={communityStats.totalRatings}
                      countLabel={communityStats.totalRatings === 1 ? 'rating' : 'ratings'}
                      emptyCopy="Be the first" />
                    <Cell label="Friends" bordered
                      score={hasFriends ? friendsStats.avgScore : null}
                      count={friendsStats.totalRatings}
                      countLabel={friendsStats.totalRatings === 1 ? 'rating' : 'ratings'}
                      emptyCopy="No friends yet"
                      onClick={hasFriends ? () => setShowFriendsDetail(true) : undefined} />
                    <Cell label="Experts" bordered
                      score={hasExperts ? expertAvg : null}
                      count={expertCount}
                      countLabel={expertCount === 1 ? 'rating' : 'ratings'}
                      emptyCopy="No verified picks" />
                  </div>
                  {hasGoogle && (
                    <div className="flex items-center gap-2.5 px-[18px] py-3.5 border-t border-on-surface/[0.06] bg-on-surface/[0.02]">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-white shadow-sm text-[10px] font-extrabold tracking-[0.16em] text-on-surface/55">GOOGLE</span>
                      <span className="font-bold text-[15px] text-on-surface tabular-nums">{place.rating}</span>
                      <Star size={14} className="fill-amber-500 text-amber-500" />
                      <span className="text-[13.5px] font-semibold text-on-surface/55">{formatReviewCount(place.userRatingCount)} reviews</span>
                    </div>
                  )}
                </div>
              </section>
            );
          })()}

          {/* ── Your circle — friend reviews accordion ── */}
          {(() => {
            const ratings = friendsStats.ratings;
            const hasFriends = ratings.length > 0;
            return (
              <section>
                <div className="flex items-end justify-between gap-4 mb-3.5">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary mb-1.5">From your circle</div>
                    <h2 className={H2}>People you trust</h2>
                  </div>
                  {hasFriends && ratings.length > 1 && (
                    <button type="button" onClick={() => setShowFriendsDetail(true)}
                      className="inline-flex items-center gap-1.5 text-[13px] font-bold text-primary hover:opacity-70 transition-opacity flex-shrink-0">
                      See all {ratings.length}
                      <ChevronRight size={15} />
                    </button>
                  )}
                </div>

                {hasFriends ? (
                  <div className={cn(CARD, 'overflow-hidden')}>
                    {ratings.slice(0, 5).map((r, i) => {
                      const prof = friendReviewProfiles[r.user_id];
                      const name = prof?.display_name || 'Friend';
                      const initial = name.trim().charAt(0).toUpperCase() || 'F';
                      const when = r.visit_date ? timeAgo(r.visit_date) : r.created_at ? timeAgo(r.created_at) : '';
                      const open = openCircleId === r.id;
                      const sc = Number(r.score);
                      return (
                        <div key={r.id} className={cn(i > 0 && 'border-t border-on-surface/[0.06]')}>
                          <button
                            type="button"
                            onClick={() => setOpenCircleId(open ? null : r.id)}
                            className={cn('w-full flex items-center gap-3.5 px-[18px] py-4 text-left transition-colors', open ? 'bg-on-surface/[0.02]' : 'hover:bg-on-surface/[0.015]')}
                          >
                            <div className="w-11 h-11 rounded-full bg-primary/10 grid place-items-center flex-shrink-0">
                              <span className="font-serif font-bold text-primary">{initial}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-serif font-bold text-[16.5px] tracking-[-0.01em] truncate">{name}</div>
                              {when && <div className="text-xs font-medium text-on-surface/55 mt-0.5">Visited {when}</div>}
                            </div>
                            <div className="inline-flex items-center justify-center min-w-[48px] h-8 px-2.5 rounded-[10px] font-serif font-bold text-[15.5px] tabular-nums flex-shrink-0"
                              style={{ background: `${scoreColor(sc)}24`, color: scoreColor(sc), boxShadow: `inset 0 0 0 1px ${scoreColor(sc)}38` }}>
                              {sc.toFixed(1)}
                            </div>
                            <ChevronDown size={16} className={cn('text-on-surface/40 flex-shrink-0 transition-transform', open && 'rotate-180')} />
                          </button>
                          <AnimatePresence initial={false}>
                            {open && (
                              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
                                <div className="px-[18px] pb-5 pt-0.5">
                                  {r.notes && (
                                    <p className="font-serif italic text-[16px] leading-[1.55] text-on-surface/70 text-pretty">"{r.notes}"</p>
                                  )}
                                  {r.tags && r.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-3.5">
                                      {r.tags.map((t) => (
                                        <span key={t} className="inline-flex items-center px-3 py-1 rounded-full border border-on-surface/[0.08] bg-white text-xs font-semibold text-on-surface/70">{t}</span>
                                      ))}
                                    </div>
                                  )}
                                  <div className="flex items-center mt-4 pt-3.5 border-t border-on-surface/[0.06]">
                                    <button type="button" onClick={() => navigate(`/review/${r.id}`)}
                                      className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] font-bold text-primary hover:opacity-70 transition-opacity">
                                      View full review
                                      <ChevronRight size={14} />
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
                ) : (
                  <div className={cn(CARD, 'flex items-center gap-4 px-5 py-5')}>
                    <div className="w-10 h-10 rounded-full bg-on-surface/[0.05] grid place-items-center text-on-surface/55 flex-shrink-0"><Users size={18} /></div>
                    <div className="flex-1 min-w-0">
                      <p className="font-serif italic text-base text-on-surface/55">No friends have rated this yet.</p>
                      <button type="button" onClick={() => setChatShareTarget(buildShareTarget())} className="mt-0.5 text-[13px] font-bold text-primary hover:opacity-70 transition-opacity">Share with a friend →</button>
                    </div>
                  </div>
                )}
              </section>
            );
          })()}

          {/* ── Flavor profile ── */}
          {(() => {
            const knownCuisines = ['italian','french','japanese','sushi','chinese','korean','thai','indian','mexican','mediterranean','american','seafood','steakhouse','pizza','cafe','bakery','vegan','bar & grill','breakfast','caribbean'];
            const hasKnown = place.types.some((t) => knownCuisines.includes(t.toLowerCase().replace(/_/g, ' ').replace('restaurant', '').trim()));
            if (!hasKnown) return null;
            const ranked = [...getFlavorProfile(place.types, place.name)].sort((a, b) => b.value - a.value);
            return (
              <section>
                <div className="flex items-baseline justify-between gap-4 mb-5">
                  <h2 className={H2}>Flavor profile</h2>
                  <span className="text-xs font-semibold text-on-surface/55">From the community</span>
                </div>
                <div className={cn(CARD, 'p-5 flex flex-col gap-3.5')}>
                  {ranked.map((f) => {
                    const pct = Math.round((f.value / f.fullMark) * 100);
                    const muted = pct < 50;
                    return (
                      <div key={f.subject} className="grid grid-cols-[88px_1fr_44px] items-center gap-4">
                        <div className={cn('text-[13px] font-semibold', muted ? 'text-on-surface/55' : 'text-on-surface')}>{f.subject}</div>
                        <div className="relative h-1.5 bg-on-surface/[0.06] rounded-full overflow-hidden">
                          <div className={cn('absolute inset-y-0 left-0 w-full rounded-full origin-left transition-transform duration-700', muted ? 'bg-on-surface/15' : 'bg-primary')} style={{ transform: `scaleX(${pct / 100})` }} />
                        </div>
                        <div className={cn('text-[13px] font-semibold tabular-nums text-right', muted ? 'text-on-surface/55' : 'text-on-surface')}>{pct}%</div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })()}

          {/* ── More from {restaurant} — featured reels rail. Renders its own
              <section> when the place has reels, or nothing at all. ── */}
          <RestaurantFeaturedReels restaurantId={place.id} restaurantName={place.name} size="md" />

          {/* ── My rating ── */}
          {myRating && place && (() => {
            type RatingPage = 'main' | 'notes' | 'tags' | 'photos' | 'price' | 'date' | 'friends';
            const openAt = (pg: RatingPage) => openAddRestaurantModal(ratingMeta, pg);
            const hasNotes = !!myRating.notes;
            const hasTags = (myRating.tags?.length || 0) > 0;
            const hasMyPhotos = (myRating.photos?.length || 0) > 0;
            const hasDate = !!myRating.visitDate;
            const hasPrice = !!myRating.price;
            const hasFriends = (myRating.friendIds?.length || 0) > 0;
            const dateLabel = hasDate ? new Date(myRating.visitDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null;

            const FieldEdit: React.FC<{ onClick: () => void }> = ({ onClick }) => (
              <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-on-surface border border-on-surface/10 hover:bg-on-surface/[0.05] rounded-full px-3 py-1.5 transition-colors flex-shrink-0">
                <Edit3 size={13} className="text-on-surface/70" /> Edit
              </button>
            );
            const Row: React.FC<{ label: string; children: React.ReactNode; edit: () => void; top?: boolean }> = ({ label, children, edit, top }) => (
              <div className={cn('grid grid-cols-[88px_minmax(0,1fr)_auto] items-start gap-5 px-[22px] py-4', !top && 'border-t border-on-surface/[0.06]')}>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/40 pt-1">{label}</div>
                <div className="min-w-0">{children}</div>
                <FieldEdit onClick={edit} />
              </div>
            );

            return (
              <section ref={myRatingRef} className="scroll-mt-24">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <button type="button" onClick={() => setMyRatingOpen((o) => !o)} className="inline-flex items-center gap-2 group" aria-expanded={myRatingOpen}>
                    <h2 className={H2}>My rating</h2>
                    <span className="w-7 h-7 rounded-full bg-on-surface/[0.05] grid place-items-center text-on-surface/55"><ChevronDown size={16} className={cn('transition-transform', myRatingOpen && 'rotate-180')} /></span>
                  </button>
                  <button type="button" onClick={() => openAddRestaurantModal(ratingMeta, 'new-visit')} className="inline-flex items-center gap-1.5 bg-primary text-white text-[13px] font-bold px-4 py-2.5 rounded-full hover:-translate-y-px transition-transform" style={{ boxShadow: 'var(--shadow-primary)' }}>
                    <RotateCw size={14} /> Re-rate
                  </button>
                </div>
                <AnimatePresence initial={false}>
                  {myRatingOpen && (
                    <motion.div key="my-rating" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
                      <div className={cn(CARD, 'overflow-hidden')}>
                        {/* Score + price + visited summary strip */}
                        <div className="flex items-stretch">
                          <div className="flex-1 px-[22px] py-5">
                            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/40">Your score</div>
                            <div className="mt-2 flex items-baseline gap-1.5">
                              <span className="font-serif font-bold text-[38px] leading-none tabular-nums" style={{ color: scoreColor(myRating.score) }}>{myRating.score.toFixed(1)}</span>
                              <span className="text-base font-semibold text-on-surface/40">/ 10</span>
                            </div>
                          </div>
                          {(
                            <div className="flex-1 px-[22px] py-5 border-l border-on-surface/[0.06] flex flex-col justify-center">
                              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/40">Price</div>
                              <div className={cn('mt-2 font-bold text-[22px] tracking-[0.05em]', hasPrice ? 'text-on-surface' : 'text-on-surface/35 italic font-serif text-base')}>{hasPrice ? myRating.price : 'Add…'}</div>
                            </div>
                          )}
                          <div className="flex-1 px-[22px] py-5 border-l border-on-surface/[0.06] flex flex-col justify-center">
                            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/40">Visited</div>
                            <div className={cn('mt-2 text-[15px] font-medium', hasDate ? 'text-on-surface' : 'text-on-surface/35 italic font-serif')}>{hasDate ? dateLabel : 'Add date…'}</div>
                          </div>
                        </div>
                        {/* Field rows */}
                        <div className="border-t border-on-surface/[0.06]">
                          <Row label="Notes" edit={() => openAt('notes')} top>
                            {hasNotes ? <p className="font-serif text-[16px] leading-[1.5] text-on-surface">"{myRating.notes}"</p> : <button type="button" onClick={() => openAt('notes')} className="text-sm font-serif italic text-on-surface/35 hover:text-on-surface/60 text-left">Add notes…</button>}
                          </Row>
                          <Row label="Tags" edit={() => openAt('tags')}>
                            <div className="flex flex-wrap gap-1.5">
                              {hasTags && myRating.tags.map((t) => <span key={t} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-on-surface/[0.05] text-on-surface">{t}</span>)}
                              <button type="button" onClick={() => openAt('tags')} className="text-xs font-semibold px-2.5 py-1 rounded-full border border-dashed border-on-surface/15 text-on-surface/55 hover:border-primary hover:text-primary transition-colors">+ Add tag</button>
                            </div>
                          </Row>
                          <Row label="Photos" edit={() => openAt('photos')}>
                            {hasMyPhotos ? (
                              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                                {myRating.photos.map((p, i) => <img key={i} src={p.url} alt="" referrerPolicy="no-referrer" className="w-[52px] h-[52px] rounded-xl object-cover flex-shrink-0" />)}
                              </div>
                            ) : <button type="button" onClick={() => openAt('photos')} className="text-sm font-serif italic text-on-surface/35 hover:text-on-surface/60 text-left">Add photos…</button>}
                          </Row>
                          {(
                            <Row label="With" edit={() => openAt('friends')}>
                              {hasFriends ? (
                                <span className="flex flex-wrap gap-1.5">{myRating.friendIds.map((fid) => <span key={fid} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/[0.08] text-primary/80">{friendNames[fid] || fid.slice(0, 8)}</span>)}</span>
                              ) : <span className="text-sm font-serif italic text-on-surface/35">Add companions…</span>}
                            </Row>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>
            );
          })()}

          {/* ── Visit history ── */}
          {myRating && visitHistory.length > 0 && place && (() => {
            const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const parseDate = (d?: string | null) => d ? new Date(d.length === 10 ? `${d}T12:00:00` : d) : null;
            type Entry = { id: string; score: number; date: Date | null; notes?: string; tags?: string[]; photos?: { url: string }[]; trend: 'up' | 'down' | null };
            const entries: Entry[] = [
              { id: 'current', score: myRating.score, date: parseDate(myRating.visitDate), notes: myRating.notes, tags: myRating.tags, photos: myRating.photos, trend: null },
              ...visitHistory.map((v) => ({ id: v.id, score: v.score, date: parseDate(v.visit_date), notes: v.notes, tags: v.tags, photos: v.photos, trend: null as 'up' | 'down' | null })),
            ];
            entries.sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));
            for (let i = 0; i < entries.length; i++) {
              const older = entries[i + 1];
              if (!older) { entries[i].trend = null; continue; }
              const diff = entries[i].score - older.score;
              entries[i].trend = diff > 0.1 ? 'up' : diff < -0.1 ? 'down' : null;
            }
            return (
              <section>
                <div className="flex items-baseline justify-between gap-4 mb-4">
                  <h2 className={H2}>Visit history</h2>
                  <span className="text-xs font-semibold text-on-surface/55">{entries.length} {entries.length === 1 ? 'visit' : 'visits'}</span>
                </div>
                <ul className={cn(CARD, 'px-[22px] overflow-hidden')}>
                  {entries.map((e, idx) => {
                    const isExpanded = expandedVisit === e.id;
                    const month = e.date ? MONTHS[e.date.getMonth()].toUpperCase() : '—';
                    const day = e.date ? e.date.getDate() : '';
                    const fullDate = e.date ? e.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Date not recorded';
                    const noDay = !e.date;
                    return (
                      <li key={e.id} className={cn(idx > 0 && 'border-t border-on-surface/[0.06]')}>
                        <button type="button" onClick={() => setExpandedVisit(isExpanded ? null : e.id)} className="w-full grid grid-cols-[56px_minmax(0,1fr)_auto] items-start gap-4 py-[18px] text-left hover:opacity-90 transition-opacity">
                          <div className={cn('text-center pt-0.5', noDay && 'opacity-60')}>
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/55">{month}</div>
                            <div className={cn('font-serif text-[26px] leading-none mt-0.5 tabular-nums tracking-[-0.02em]', noDay ? 'font-normal text-on-surface/40' : 'font-bold text-on-surface')}>{day || '—'}</div>
                          </div>
                          <div className="min-w-0">
                            {e.notes ? <p className="font-serif text-[15px] leading-[1.5] text-on-surface line-clamp-2">{e.notes}</p> : <p className="font-serif italic text-[15px] text-on-surface/55">No notes from this visit.</p>}
                            <p className="mt-1 text-xs font-medium text-on-surface/55">{fullDate}</p>
                          </div>
                          <div className="flex items-center gap-2 pt-1">
                            {e.trend === 'up' && <TrendingUp size={15} className="text-green-600" />}
                            {e.trend === 'down' && <TrendingDown size={15} className="text-red-500" />}
                            <span className="font-serif font-bold text-[20px] tabular-nums tracking-[-0.02em]" style={{ color: scoreColor(e.score) }}>{e.score.toFixed(1)}</span>
                          </div>
                        </button>
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                              <div className="pb-4 pl-[72px] space-y-3">
                                {e.tags && e.tags.length > 0 && <div className="flex flex-wrap gap-1.5">{e.tags.map((t) => <span key={t} className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-primary/[0.08] text-primary/75">{t}</span>)}</div>}
                                {e.photos && e.photos.length > 0 && <div className="flex gap-2 overflow-x-auto no-scrollbar">{e.photos.slice(0, 8).map((p, i) => <img key={i} src={p.url} alt="" referrerPolicy="no-referrer" className="w-24 h-24 rounded-lg object-cover flex-shrink-0" />)}</div>}
                                {confirmDeleteVisitId === e.id ? (
                                  <div className="flex items-center justify-between gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                    <p className="text-xs font-medium text-red-700">Delete this visit?</p>
                                    <div className="flex gap-1.5">
                                      <button type="button" onClick={() => setConfirmDeleteVisitId(null)} className="px-2.5 py-1 text-[11px] font-semibold text-on-surface/70 border border-on-surface/15 rounded-md bg-white hover:bg-on-surface/[0.04]">Cancel</button>
                                      <button type="button" onClick={() => { if (!place) return; deleteVisit(place.id, e.id); setConfirmDeleteVisitId(null); setExpandedVisit(null); }} className="px-2.5 py-1 text-[11px] font-semibold text-white bg-red-500 rounded-md hover:bg-red-600">Delete</button>
                                    </div>
                                  </div>
                                ) : (
                                  <button type="button" onClick={() => setConfirmDeleteVisitId(e.id)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-500 hover:text-red-600 transition-colors"><Trash2 size={13} /> Delete visit</button>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })()}

          {/* ── Expert picks ── */}
          {expertRecommendations.length > 0 && (
            <section>
              <h2 className={cn(H2, 'mb-4')}>Verified picks</h2>
              <ul className={cn(CARD, 'divide-y divide-on-surface/[0.06] overflow-hidden')}>
                {expertRecommendations.map((rec) => {
                  const isExpanded = expandedExpertId === rec.id;
                  const sc = Number(rec.rating);
                  return (
                    <li key={rec.id}>
                      <button onClick={() => setExpandedExpertId(isExpanded ? null : rec.id)} className="w-full px-5 py-5 text-left hover:bg-on-surface/[0.015] transition-colors">
                        <div className="flex items-start gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Link to={`/user/${rec.expert_username}`} onClick={(e) => e.stopPropagation()} className="text-base font-serif font-bold text-on-surface hover:text-primary truncate">{rec.expert_name}</Link>
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.15em] text-primary"><VerifiedBadge size={12} inline />Verified</span>
                            </div>
                            <p className={cn('text-sm mt-1.5 leading-relaxed text-on-surface/70', isExpanded ? '' : 'line-clamp-2')}>{rec.recommendation_text}</p>
                          </div>
                          <div className="flex-shrink-0 w-14 h-9 rounded-md grid place-items-center" style={{ background: scoreColor(sc) }}>
                            <span className="text-sm font-bold text-white tabular-nums">{sc.toFixed(1)}</span>
                          </div>
                        </div>
                        <AnimatePresence>
                          {isExpanded && rec.highlight_dishes && rec.highlight_dishes.length > 0 && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                              <div className="pt-3">
                                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-600/70 mb-2">Highlight dishes</p>
                                <div className="flex flex-wrap gap-1.5">{rec.highlight_dishes.map((dish) => <span key={dish} className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-800">{dish}</span>)}</div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* ── Location ── */}
          <section>
            <h2 className={cn(H2, 'mb-4')}>Location</h2>
            <div className="relative rounded-[24px] overflow-hidden border border-on-surface/[0.08] aspect-[16/9] bg-cream-2 shadow-sm">
              <div ref={mapContainerRef} className="absolute inset-0" style={{ width: '100%', height: '100%' }} />
              <button type="button" onClick={() => navigate('/map', { state: { focus: { id: place.id, name: place.name, lat: place.lat, lng: place.lng, address: place.fullAddress || place.address, fullAddress: place.fullAddress || place.address, photoUrl: place.photoUrl, priceLevel: place.priceLevel, rating: place.rating, types: place.types, userRatingCount: place.userRatingCount } } })} aria-label="Open full map" className="absolute inset-0 z-10 hover:bg-on-surface/5 transition-colors" />
              <div className="absolute left-5 bottom-5 z-20 inline-flex items-center gap-2 px-4 h-11 rounded-full bg-white border border-on-surface/[0.08] shadow-md text-sm font-bold text-on-surface">
                <MapPin size={15} className="text-primary" />
                <span className="truncate max-w-[280px]">{place.address}</span>
              </div>
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="absolute right-5 top-5 z-20 inline-flex items-center gap-2 px-4 h-11 rounded-full bg-white border border-on-surface/[0.08] shadow-md text-sm font-bold text-on-surface">
                Open in Maps
                <ExternalLink size={14} className="text-primary" />
              </a>
            </div>
          </section>
        </main>

        {/* ════════ SIDEBAR ════════ */}
        <aside className="lg:sticky lg:top-[88px] flex flex-col gap-3.5">
          {/* Actions */}
          <div className={cn(CARD, 'p-4')}>
            <div className="flex justify-around">
              {place.phone && (
                <a href={`tel:${place.phone}`} className="flex flex-col items-center gap-2 group">
                  <span className="w-[46px] h-[46px] rounded-full bg-on-surface/[0.05] grid place-items-center text-on-surface group-hover:bg-on-surface/10 transition-colors"><Phone size={19} /></span>
                  <span className="text-[11px] font-semibold text-on-surface/70">Call</span>
                </a>
              )}
              <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-2 group">
                <span className="w-[46px] h-[46px] rounded-full bg-on-surface/[0.05] grid place-items-center text-on-surface group-hover:bg-on-surface/10 transition-colors"><Navigation size={19} /></span>
                <span className="text-[11px] font-semibold text-on-surface/70">Route</span>
              </a>
              {place.website && (
                <a href={place.website} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-2 group">
                  <span className="w-[46px] h-[46px] rounded-full bg-on-surface/[0.05] grid place-items-center text-on-surface group-hover:bg-on-surface/10 transition-colors"><Globe size={19} /></span>
                  <span className="text-[11px] font-semibold text-on-surface/70">Web</span>
                </a>
              )}
              <button type="button" onClick={() => setChatShareTarget(buildShareTarget())} className="flex flex-col items-center gap-2 group">
                <span className="w-[46px] h-[46px] rounded-full bg-on-surface/[0.05] grid place-items-center text-on-surface group-hover:bg-on-surface/10 transition-colors"><Send size={18} /></span>
                <span className="text-[11px] font-semibold text-on-surface/70">Share</span>
              </button>
              {michelin && (
                <a href={michelin.guideUrl} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-2 group">
                  <span className="w-[46px] h-[46px] rounded-full bg-on-surface/[0.05] grid place-items-center text-on-surface group-hover:bg-on-surface/10 transition-colors"><Award size={18} /></span>
                  <span className="text-[11px] font-semibold text-on-surface/70">Guide</span>
                </a>
              )}
            </div>
          </div>

          {/* Hours */}
          {place.hours.length > 0 && (
            <div className={cn(CARD, 'px-5 py-[18px]')}>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/40 mb-3">Hours</div>
              <button type="button" onClick={() => setHoursOpen(!hoursOpen)} className="w-full flex items-center justify-between gap-2.5 text-left">
                <span className="inline-flex items-center gap-2.5 min-w-0">
                  {place.isOpen !== null && <span className={cn('w-2 h-2 rounded-full flex-shrink-0', place.isOpen ? 'bg-green-500' : 'bg-red-500')} />}
                  <span className={cn('text-[14.5px] font-bold', place.isOpen === false ? 'text-red-600' : place.isOpen ? 'text-green-700' : 'text-on-surface')}>{place.isOpen === false ? 'Closed' : place.isOpen ? 'Open' : 'Hours'}</span>
                  <span className="text-sm font-medium text-on-surface/55 truncate">· {getTodayHours(place.hours)}</span>
                </span>
                <ChevronDown size={18} className={cn('text-on-surface/40 flex-shrink-0 transition-transform', hoursOpen && 'rotate-180')} />
              </button>
              <AnimatePresence>
                {hoursOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                    <div className="pt-1">
                      {place.hours.map((line, i) => {
                        const [day, ...timeParts] = line.split(': ');
                        const time = timeParts.join(': ');
                        const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                        const isToday = today.startsWith(day.toLowerCase().slice(0, 3));
                        const isClosed = /closed/i.test(time);
                        return (
                          <div key={i} className={cn('flex items-center justify-between py-2 border-t border-on-surface/[0.06] text-[13px]', isToday ? 'font-bold text-on-surface' : 'font-medium text-on-surface/65', isClosed && !isToday && 'text-on-surface/40')}>
                            <span>{day}</span>
                            <span className={cn('tabular-nums', isClosed && 'text-red-500')}>{time}</span>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Details */}
          <div className={cn(CARD, 'px-5 py-[18px]')}>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/40 mb-1.5">Details</div>
            <div className="flex items-center justify-between py-3 border-t border-on-surface/[0.06]">
              <span className="text-[13.5px] font-semibold text-on-surface/55">Cuisine</span>
              <span className="text-[13.5px] font-bold text-on-surface text-right">{cuisine}</span>
            </div>
            {priceStr && (
              <div className="flex items-center justify-between py-3 border-t border-on-surface/[0.06]">
                <span className="text-[13.5px] font-semibold text-on-surface/55">Price</span>
                <span className="text-sm font-bold text-on-surface tracking-[0.04em]">{priceStr}</span>
              </div>
            )}
            {michelin && (
              <a href={michelin.guideUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between py-3 border-t border-on-surface/[0.06] group">
                <span className="text-[13.5px] font-semibold text-on-surface/55">Michelin</span>
                <span className="inline-flex items-center gap-1.5 text-on-surface group-hover:text-primary transition-colors">
                  <MichelinBadge michelin={michelin} size="sm" />
                  <ExternalLink size={13} className="text-on-surface/40" />
                </span>
              </a>
            )}
          </div>
        </aside>
      </div>

      {/* Photo Gallery Modal */}
      <AnimatePresence>
        {galleryOpen && photos.length > 0 && (
          <PhotoGallery photos={photos} communityPhotos={communityPhotos} name={place.name} initialIndex={photoIndex} onClose={() => setGalleryOpen(false)} />
        )}
      </AnimatePresence>

      {/* Friends ratings detail modal */}
      <AnimatePresence>
        {showFriendsDetail && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => setShowFriendsDetail(false)} />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 28, stiffness: 300 }} {...friendsDetailDragProps} className="fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-3xl max-h-[70vh] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-on-surface/[0.06] flex-shrink-0">
                <div>
                  <h3 className="font-serif font-bold text-lg">Friends' Ratings</h3>
                  <p className="text-xs text-on-surface/40">{place.name}</p>
                </div>
                <button onClick={() => setShowFriendsDetail(false)} className="w-8 h-8 rounded-full bg-on-surface/[0.05] grid place-items-center" aria-label="Close"><X size={16} className="text-on-surface/60" /></button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {friendsStats.ratings.map((r) => (
                  <div key={r.id} className="bg-white rounded-xl border border-on-surface/[0.08] p-4">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 grid place-items-center"><UserCircle size={16} className="text-primary/50" /></div>
                        <span className="text-sm font-semibold text-on-surface/70">{friendReviewProfiles[r.user_id]?.display_name || 'Friend'}</span>
                      </div>
                      <ScoreBadge rating={Number(r.score)} size="sm" />
                    </div>
                    {r.notes && <p className="text-[13px] text-on-surface/50 italic mt-2 leading-relaxed">"{r.notes}"</p>}
                    {r.tags && r.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">{r.tags.map((t) => <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-primary/8 text-primary/60">{t}</span>)}</div>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Unified share dialog */}
      <ShareDialog open={!!chatShareTarget} payload={chatShareTarget ? { sharedRestaurant: chatShareTarget } : null} onClose={() => setChatShareTarget(null)} />

    </div>
  );
};
