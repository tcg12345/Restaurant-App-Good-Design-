import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Star, MapPin, Phone, Globe,
  ChevronLeft, ChevronRight, ChevronDown, Loader2,
  Navigation, ExternalLink, X, Users, UserCircle, Share2, Bookmark, MoreHorizontal,
  Edit3, Send, Building2, TrendingUp, TrendingDown,
  Car, Footprints, Trash2, RotateCw,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { ScoreBadge } from '../components/ScoreBadge';
import { useRestaurantDetail, formatReviewCount, getTodayHours, getCuisineLabel } from './useRestaurantDetail';
import { useLists } from '../contexts/ListsContext';
import { type SharedRestaurant } from '../contexts/ChatContext';
import { ShareDialog } from '../components/ShareDialog';
import { useAuth } from '../contexts/AuthContext';
import { getProfilesByIds, getCommunityStats, type UserProfile as UP, type DiningType } from '../lib/supabase-community';
import { loadLastSelectedLocation, isExactAddress } from '../components/HomeLocationBar';
import { haversineDistanceMi, formatDistance } from '../lib/distance';
import { useTravelTimes, formatTravelTime } from '../lib/directions';
import { AddHotelDiningModal } from '../components/AddHotelDiningModal';
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

export const RestaurantDetailDesktop: React.FC = () => {
  const {
    place, loading, error, navigate,
    photoIndex, setPhotoIndex,
    galleryOpen, setGalleryOpen,
    mapContainerRef,
    priceStr, cuisine,
    photos, directionsUrl, mapsUrl,
    communityStats, friendsStats, communityPhotos, expertRecommendations,
    showFriendsDetail, setShowFriendsDetail,
    hotelDiningOptions, refreshHotelDining,
    visitHistory, visitCount,
  } = useRestaurantDetail();

  // Sticky-nav title fade — appears once the editorial hero has scrolled
  // out of view. Threshold matches the rough height of the hero block.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 220);
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
  const [diningFilter, setDiningFilter] = useState<DiningType | 'all'>('all');
  const [addDiningOpen, setAddDiningOpen] = useState(false);
  const [diningRatings, setDiningRatings] = useState<Record<string, number>>({});
  const [expandedExpertId, setExpandedExpertId] = useState<string | null>(null);
  const [friendReviewProfiles, setFriendReviewProfiles] = useState<Record<string, UP>>({});

  useEffect(() => {
    const ids = Array.from(new Set(friendsStats.ratings.map((r) => r.user_id))).filter(Boolean);
    if (ids.length === 0) return;
    getProfilesByIds(ids).then(setFriendReviewProfiles);
  }, [friendsStats.ratings]);

  const myRating = place ? getRating(place.id) : undefined;
  const isHotel = place ? (place.types[0] === 'hotel' || place.types[0] === 'lodging' || myRating?.cuisine === 'Hotel Breakfast') : false;

  useEffect(() => {
    if (!myRating?.friendIds?.length) return;
    getProfilesByIds(myRating.friendIds).then((profiles) => {
      const names: Record<string, string> = {};
      Object.values(profiles).forEach((p) => { names[p.user_id] = p.display_name || `@${p.username}`; });
      setFriendNames(names);
    });
  }, [myRating?.friendIds]);

  useEffect(() => {
    if (hotelDiningOptions.length === 0) return;
    (async () => {
      const ratings: Record<string, number> = {};
      for (const d of hotelDiningOptions) {
        const stats = await getCommunityStats(d.restaurant_place_id);
        if (stats.avgScore > 0) ratings[d.restaurant_place_id] = stats.avgScore;
      }
      setDiningRatings(ratings);
    })();
  }, [hotelDiningOptions]);

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

  const hasPhotos = photos.length > 0;
  const badgeScore = myRating?.score ?? (communityStats.totalRatings > 0 ? communityStats.avgScore : null);
  const badgeIsPersonal = !!myRating;

  return (
    <div className="bg-surface min-h-screen pb-24">
      {/* ── Sticky top nav ────────────────────────────────────────────
          Always present at the top. Back chip on the left, restaurant
          name (fades in once you've scrolled past the hero) in the
          center, and share / save / more icon buttons on the right.
          Backdrop-blur keeps content readable behind it as the page
          scrolls. */}
      <div
        className={cn(
          'sticky top-0 z-40 flex items-center px-6 lg:px-8 h-14',
          'bg-surface/80 backdrop-blur-xl',
          'border-b transition-colors',
          scrolled ? 'border-on-surface/[0.08]' : 'border-transparent',
        )}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-on-surface hover:opacity-65 transition-opacity px-1 py-1.5"
        >
          <ChevronLeft size={16} />
          <span>Back</span>
        </button>
        <div
          className={cn(
            'flex-1 text-center font-serif font-bold text-base tracking-tight px-4 truncate transition-opacity duration-200',
            scrolled ? 'opacity-100' : 'opacity-0',
          )}
        >
          {place.name}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setChatShareTarget(buildShareTarget())}
            aria-label="Share"
            className="w-9 h-9 rounded-full grid place-items-center hover:bg-on-surface/[0.06] transition-colors"
          >
            <Share2 size={18} className="text-on-surface" />
          </button>
          <button
            type="button"
            onClick={() => {
              toggleWishlist({
                id: place.id, name: place.name,
                image: place.photoUrl || '',
                cuisine, price: priceStr,
                address: place.fullAddress || place.address,
              });
            }}
            aria-label={isWishlisted(place.id) ? 'Remove from wishlist' : 'Save to wishlist'}
            className={cn(
              'w-9 h-9 rounded-full grid place-items-center hover:bg-on-surface/[0.06] transition-colors',
              isWishlisted(place.id) ? 'text-primary' : 'text-on-surface',
            )}
          >
            <Bookmark size={18} className={isWishlisted(place.id) ? 'fill-current' : ''} />
          </button>
          <button
            type="button"
            aria-label="More"
            className="w-9 h-9 rounded-full grid place-items-center hover:bg-on-surface/[0.06] transition-colors"
          >
            <MoreHorizontal size={18} className="text-on-surface" />
          </button>
        </div>
      </div>

      {/* ── Photo header (dynamic) ─────────────────────────────────────
          Only renders when there's at least one Google or community
          photo to show. With no photos at all the editorial hero
          below carries the page on its own — no empty placeholder. */}
      {hasPhotos && (
        <div className="relative w-full aspect-[16/9] max-h-[60vh] overflow-hidden">
          <button
            type="button"
            onClick={() => setGalleryOpen(true)}
            className="block h-full w-full cursor-pointer absolute inset-0"
          >
            <img
              src={photos[photoIndex]}
              alt={place.name}
              className="h-full w-full object-cover transition-all duration-500"
              referrerPolicy="no-referrer"
            />
          </button>
          <div
            className="absolute inset-x-0 bottom-0 h-1/3 pointer-events-none"
            style={{ background: 'linear-gradient(to top, var(--color-surface) 0%, var(--color-surface) 2%, rgba(0,0,0,0) 100%)' }}
          />
          {photos.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setPhotoIndex((i) => (i - 1 + photos.length) % photos.length); }}
                className="absolute left-6 top-1/2 -translate-y-1/2 p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80 hover:bg-black/40 transition-colors z-10"
                aria-label="Previous photo"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setPhotoIndex((i) => (i + 1) % photos.length); }}
                className="absolute right-6 top-1/2 -translate-y-1/2 p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80 hover:bg-black/40 transition-colors z-10"
                aria-label="Next photo"
              >
                <ChevronRight size={20} />
              </button>
              <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
                {photos.map((_, i) => (
                  <button
                    key={i}
                    onClick={(e) => { e.stopPropagation(); setPhotoIndex(i); }}
                    className={`h-1.5 rounded-full transition-all ${i === photoIndex ? 'bg-white/90 w-5' : 'bg-white/40 w-1.5'}`}
                    aria-label={`Go to photo ${i + 1}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Centered editorial column ───────────────────────────────── */}
      <main className="max-w-4xl mx-auto px-6 lg:px-10">

        {/* ── Hero ── eyebrow, name, address line, open status, score.
            No photo of its own — when photos exist they sit above this
            block in the dedicated photo header. */}
        <section className={cn('pb-9', hasPhotos ? 'pt-7' : 'pt-12')}>
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-on-surface/55 mb-4 flex items-center gap-2.5">
            <span>{isHotel ? 'Hotel' : cuisine}</span>
            {!isHotel && priceStr && (
              <>
                <span className="inline-block w-[3px] h-[3px] rounded-full bg-current opacity-50" />
                <span>{priceStr}</span>
              </>
            )}
          </p>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-8">
            <div className="min-w-0">
              <h1 className="font-serif font-bold text-on-surface text-5xl lg:text-6xl leading-[0.98] tracking-[-0.035em]">
                {place.name}
              </h1>
              {(() => {
                const dist = homeLocationForDistance && destForDistance
                  ? formatDistance(haversineDistanceMi(homeLocationForDistance.lat, homeLocationForDistance.lng, destForDistance.lat, destForDistance.lng))
                  : '';
                return (
                  <p className="mt-5 text-base font-medium text-on-surface/70 flex items-baseline gap-2.5 flex-wrap">
                    <span>{place.address}</span>
                    {dist && (
                      <>
                        <span className="text-on-surface/30">·</span>
                        <span>{dist}</span>
                      </>
                    )}
                    {driveLabel && (
                      <>
                        <span className="text-on-surface/30">·</span>
                        <span className="inline-flex items-center gap-1.5">
                          <Car size={14} className="text-on-surface/45" />
                          {driveLabel}
                        </span>
                      </>
                    )}
                    {walkLabel && (
                      <>
                        <span className="text-on-surface/30">·</span>
                        <span className="inline-flex items-center gap-1.5">
                          <Footprints size={14} className="text-on-surface/45" />
                          {walkLabel}
                        </span>
                      </>
                    )}
                  </p>
                );
              })()}
              {place.isOpen !== null && (
                <div className="mt-3.5 inline-flex items-center gap-2 text-sm font-semibold text-on-surface/70">
                  <span
                    className={cn(
                      'inline-block w-2 h-2 rounded-full',
                      place.isOpen ? 'bg-green-500' : 'bg-red-500',
                    )}
                  />
                  {place.isOpen ? (
                    <>
                      <span className="font-bold text-green-700">Open</span>
                      {(() => {
                        const line = getTodayHours(place.hours);
                        const close = line.split(/\s*[–-]\s*/)[1];
                        return close ? (
                          <span className="text-on-surface/55 font-medium"> · closes {close.trim()}</span>
                        ) : null;
                      })()}
                    </>
                  ) : (
                    <>
                      <span className="font-bold text-red-600">Closed</span>
                      {(() => {
                        const next = getNextOpenTime(place.hours);
                        return next ? (
                          <span className="text-on-surface/55 font-medium"> · opens {next}</span>
                        ) : null;
                      })()}
                    </>
                  )}
                </div>
              )}
            </div>
            {badgeScore != null && (
              <div
                className={cn(
                  'flex-shrink-0 w-[116px] h-[116px] rounded-full grid place-items-center mt-2',
                  badgeScore >= 8 ? 'bg-secondary' : badgeScore >= 5 ? 'bg-amber-600' : 'bg-red-500',
                )}
                style={{ boxShadow: '0 8px 24px rgba(92, 97, 68, 0.25)' }}
                aria-label={badgeIsPersonal ? `Your rating ${badgeScore.toFixed(1)}` : `Community rating ${badgeScore.toFixed(1)}`}
              >
                <span className="text-[36px] font-serif font-bold text-white tabular-nums leading-none tracking-[-0.02em]">
                  {badgeScore.toFixed(1)}
                </span>
              </div>
            )}
          </div>

          {/* ── Your rating banner — dark editorial card. If unrated,
              flips to a warm "Rate this restaurant" CTA. */}
          <button
            type="button"
            onClick={() => {
              if (myRating) {
                myRatingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              } else {
                openAddRestaurantModal({
                  id: place.id, name: place.name,
                  image: place.photoUrl || '',
                  cuisine, price: priceStr,
                  address: place.fullAddress || place.address,
                });
              }
            }}
            className="mt-7 w-full flex items-center gap-4 px-5 py-4 rounded-2xl text-left transition-all hover:-translate-y-px"
            style={{ background: 'var(--color-on-surface)' }}
          >
            {myRating ? (
              <>
                <div
                  className={cn(
                    'flex-shrink-0 w-[52px] h-[52px] rounded-full grid place-items-center',
                    myRating.score >= 8 ? 'bg-accent' : myRating.score >= 5 ? 'bg-amber-500' : 'bg-red-400',
                  )}
                >
                  <span className="text-lg font-serif font-bold tabular-nums leading-none tracking-[-0.02em] text-on-surface">
                    {myRating.score.toFixed(1)}
                  </span>
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/55">
                    Your Rating · {visitCount + 1} {visitCount + 1 === 1 ? 'visit' : 'visits'}
                  </span>
                  <span className="font-serif italic text-base text-white/85 truncate">
                    {myRating.notes ? `"${myRating.notes}"` : 'Tap to see your full review'}
                  </span>
                </div>
                <ChevronRight size={18} className="text-white/55 flex-shrink-0" />
              </>
            ) : (
              <>
                <div className="flex-shrink-0 w-[52px] h-[52px] rounded-full bg-accent/90 grid place-items-center">
                  <Star size={20} className="text-on-surface" />
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/55">
                    Rate this restaurant
                  </span>
                  <span className="font-serif text-base text-white/90">
                    Log your visit and score
                  </span>
                </div>
                <ChevronRight size={18} className="text-white/55 flex-shrink-0" />
              </>
            )}
          </button>

          {/* ── Action icons — outlined circles, Apple-Maps-style ── */}
          <div className="mt-7 flex gap-7 flex-wrap">
            {place.phone ? (
              <a
                href={`tel:${place.phone}`}
                className="flex flex-col items-center gap-2 group"
              >
                <span className="w-[52px] h-[52px] rounded-full border border-on-surface/10 grid place-items-center transition-all group-hover:bg-on-surface/[0.05] group-hover:border-on-surface/20 group-hover:-translate-y-px">
                  <Phone size={20} className="text-on-surface" />
                </span>
                <span className="text-[13px] font-semibold text-on-surface">Call</span>
              </a>
            ) : (
              <div className="flex flex-col items-center gap-2 opacity-35">
                <span className="w-[52px] h-[52px] rounded-full border border-on-surface/10 grid place-items-center">
                  <Phone size={20} className="text-on-surface" />
                </span>
                <span className="text-[13px] font-semibold text-on-surface">Call</span>
              </div>
            )}
            <a
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-2 group"
            >
              <span className="w-[52px] h-[52px] rounded-full border border-on-surface/10 grid place-items-center transition-all group-hover:bg-on-surface/[0.05] group-hover:border-on-surface/20 group-hover:-translate-y-px">
                <Navigation size={20} className="text-on-surface" />
              </span>
              <span className="text-[13px] font-semibold text-on-surface">Route</span>
            </a>
            {place.website ? (
              <a
                href={place.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-2 group"
              >
                <span className="w-[52px] h-[52px] rounded-full border border-on-surface/10 grid place-items-center transition-all group-hover:bg-on-surface/[0.05] group-hover:border-on-surface/20 group-hover:-translate-y-px">
                  <Globe size={20} className="text-on-surface" />
                </span>
                <span className="text-[13px] font-semibold text-on-surface">Web</span>
              </a>
            ) : (
              <div className="flex flex-col items-center gap-2 opacity-35">
                <span className="w-[52px] h-[52px] rounded-full border border-on-surface/10 grid place-items-center">
                  <Globe size={20} className="text-on-surface" />
                </span>
                <span className="text-[13px] font-semibold text-on-surface">Web</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setChatShareTarget(buildShareTarget())}
              className="flex flex-col items-center gap-2 group"
            >
              <span className="w-[52px] h-[52px] rounded-full border border-on-surface/10 grid place-items-center transition-all group-hover:bg-on-surface/[0.05] group-hover:border-on-surface/20 group-hover:-translate-y-px">
                <Send size={20} className="text-on-surface" />
              </span>
              <span className="text-[13px] font-semibold text-on-surface">Share</span>
            </button>
          </div>
        </section>

        {/* ── Ratings — each audience score sits inside its own soft
            circle. Label above, count below. The circle fills with a
            score-coded color when there's data, and falls back to a
            quiet outlined "—" disc for empty states. */}
        {(() => {
          const expertAvg = expertRecommendations.length > 0
            ? expertRecommendations.reduce((sum, r) => sum + Number(r.rating), 0) / expertRecommendations.length
            : 0;
          const expertCount = expertRecommendations.length;
          const hasCommunity = communityStats.totalRatings > 0;
          const hasFriends = !isHotel && friendsStats.totalRatings > 0;
          const hasExperts = expertCount > 0;
          const hasGoogle = Number(place.rating) > 0 && place.userRatingCount > 0;

          type CellProps = {
            label: string;
            score: number | null;
            count: number;
            countLabel: string;
            emptyCopy: string;
            onClick?: () => void;
          };
          const Cell: React.FC<CellProps> = ({ label, score, count, countLabel, emptyCopy, onClick }) => {
            const fillClass = score == null
              ? ''
              : score >= 8 ? 'bg-secondary' : score >= 5 ? 'bg-amber-600' : 'bg-red-500';
            const shadow = score == null
              ? ''
              : score >= 8 ? '0 10px 24px rgba(92, 97, 68, 0.22)'
              : score >= 5 ? '0 10px 24px rgba(217, 119, 6, 0.22)'
              : '0 10px 24px rgba(239, 68, 68, 0.22)';
            const body = (
              <div className="flex flex-col items-center gap-3 py-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface/55">
                  {label}
                </p>
                {score != null ? (
                  <div
                    className={cn(
                      'w-[104px] h-[104px] rounded-full grid place-items-center',
                      fillClass,
                    )}
                    style={{ boxShadow: shadow }}
                  >
                    <span className="font-serif font-bold text-[32px] leading-none tabular-nums tracking-[-0.02em] text-white">
                      {score.toFixed(1)}
                    </span>
                  </div>
                ) : (
                  <div className="w-[104px] h-[104px] rounded-full grid place-items-center border border-on-surface/15 bg-on-surface/[0.02]">
                    <span className="font-serif font-bold text-[30px] leading-none tabular-nums text-on-surface/25">
                      —
                    </span>
                  </div>
                )}
                <p
                  className={cn(
                    'text-[12px] mt-1 text-center',
                    score != null ? 'font-medium text-on-surface/55' : 'italic text-on-surface/45',
                  )}
                >
                  {score != null ? `${count.toLocaleString()} ${countLabel}` : emptyCopy}
                </p>
              </div>
            );
            return onClick ? (
              <button
                type="button"
                onClick={onClick}
                className="w-full transition-transform hover:-translate-y-0.5"
              >
                {body}
              </button>
            ) : (
              <div className="w-full">{body}</div>
            );
          };

          return (
            <section className="py-9">
              <div className="flex items-baseline justify-between gap-4 mb-7">
                <h2 className="font-serif font-bold text-[22px] tracking-[-0.02em] text-on-surface">
                  Ratings
                </h2>
              </div>

              {isHotel ? (
                <div className="flex justify-start">
                  <Cell
                    label="Breakfast"
                    score={hasCommunity ? communityStats.avgScore : null}
                    count={communityStats.totalRatings}
                    countLabel={communityStats.totalRatings === 1 ? 'rating' : 'ratings'}
                    emptyCopy="Be the first"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  <Cell
                    label="Everyone"
                    score={hasCommunity ? communityStats.avgScore : null}
                    count={communityStats.totalRatings}
                    countLabel={communityStats.totalRatings === 1 ? 'rating' : 'ratings'}
                    emptyCopy="Be the first"
                  />
                  <Cell
                    label="Friends"
                    score={hasFriends ? friendsStats.avgScore : null}
                    count={friendsStats.totalRatings}
                    countLabel={friendsStats.totalRatings === 1 ? 'rating' : 'ratings'}
                    emptyCopy="No friends yet"
                    onClick={hasFriends ? () => setShowFriendsDetail(true) : undefined}
                  />
                  <Cell
                    label="Experts"
                    score={hasExperts ? expertAvg : null}
                    count={expertCount}
                    countLabel={expertCount === 1 ? 'rating' : 'ratings'}
                    emptyCopy="No expert picks"
                  />
                </div>
              )}

              {hasGoogle && (
                <div className="mt-7 inline-flex items-center gap-2 text-[13px] font-medium text-on-surface/55">
                  <span
                    className="text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/70 px-2 py-[3px] rounded bg-on-surface/[0.05]"
                  >
                    Google
                  </span>
                  <span>
                    <span className="font-bold text-on-surface tabular-nums">{place.rating}</span>
                    {' · '}{formatReviewCount(place.userRatingCount)} reviews
                  </span>
                </div>
              )}
            </section>
          );
        })()}

        {/* ── Flavor Profile — radar + ranked list. Hidden for cuisines
            we don't have a profile for, so we don't fabricate data. */}
        {(() => {
          if (isHotel) return null;
          const knownCuisines = [
            'italian','french','japanese','sushi','chinese','korean','thai','indian',
            'mexican','mediterranean','american','seafood','steakhouse','pizza','cafe',
            'bakery','vegan','bar & grill','breakfast','caribbean',
          ];
          const hasKnown = place.types.some((t) =>
            knownCuisines.includes(t.toLowerCase().replace(/_/g, ' ').replace('restaurant', '').trim())
          );
          if (!hasKnown) return null;
          const flavorData = getFlavorProfile(place.types, place.name);
          const ranked = [...flavorData].sort((a, b) => b.value - a.value);
          return (
            <section className="py-9">
              <div className="flex items-baseline justify-between gap-4 mb-5">
                <h2 className="font-serif font-bold text-[22px] tracking-[-0.02em] text-on-surface">
                  Flavor profile
                </h2>
                <span className="text-[12px] font-semibold text-on-surface/55 tracking-wide">
                  From your notes
                </span>
              </div>
              <div className="flex flex-col gap-3.5">
                {ranked.map((f) => {
                  const pct = Math.round((f.value / f.fullMark) * 100);
                  const muted = pct < 50;
                  return (
                    <div
                      key={f.subject}
                      className="grid grid-cols-[80px_1fr_44px] items-center gap-4"
                    >
                      <div className={cn('text-[13px] font-semibold', muted ? 'text-on-surface/55' : 'text-on-surface')}>
                        {f.subject}
                      </div>
                      <div className="relative h-1.5 bg-on-surface/[0.06] rounded-full overflow-hidden">
                        <div
                          className={cn(
                            'absolute inset-y-0 left-0 rounded-full transition-transform duration-700 origin-left',
                            muted ? 'bg-on-surface/15' : 'bg-primary',
                          )}
                          style={{ transform: `scaleX(${pct / 100})`, width: '100%' }}
                        />
                      </div>
                      <div className={cn('text-[13px] font-semibold tabular-nums text-right', muted ? 'text-on-surface/55' : 'text-on-surface')}>
                        {pct}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })()}

        {/* ── Your circle — friend reviews. Up to 3 cards inline,
            "See all" for the rest. Empty state matches the design
            sample (icon + italic copy + share CTA). */}
        {!isHotel && (() => {
          const hasFriends = friendsStats.ratings.length > 0;
          const topFriends = friendsStats.ratings.slice(0, 3);
          return (
            <section className="py-9">
              <div className="flex items-baseline justify-between gap-4 mb-5">
                <h2 className="font-serif font-bold text-[22px] tracking-[-0.02em] text-on-surface">
                  Your circle
                </h2>
                {hasFriends && friendsStats.ratings.length > topFriends.length && (
                  <button
                    type="button"
                    onClick={() => setShowFriendsDetail(true)}
                    className="text-[12px] font-semibold text-on-surface/55 hover:text-on-surface inline-flex items-center gap-1 transition-colors"
                  >
                    See all
                    <ChevronRight size={12} />
                  </button>
                )}
              </div>

              {hasFriends ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {topFriends.map((r) => {
                    const prof = friendReviewProfiles[r.user_id];
                    const name = prof?.display_name || 'Friend';
                    const initial = name.trim().charAt(0).toUpperCase() || 'F';
                    const visitLabel = r.visit_date
                      ? timeAgo(r.visit_date)
                      : r.created_at ? timeAgo(r.created_at) : '';
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => navigate(`/review/${r.id}`)}
                        className="rounded-2xl border border-on-surface/10 bg-white/60 px-4 py-4 text-left hover:bg-white transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-full bg-primary/10 grid place-items-center flex-shrink-0">
                            <span className="text-base font-serif font-bold text-primary">{initial}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-base font-bold text-on-surface truncate">{name}</p>
                            {visitLabel && (
                              <p className="text-xs text-on-surface/50">Visited {visitLabel}</p>
                            )}
                          </div>
                          <div className={cn(
                            'flex-shrink-0 w-12 h-8 rounded-md grid place-items-center',
                            Number(r.score) >= 8 ? 'bg-secondary' : Number(r.score) >= 5 ? 'bg-amber-600' : 'bg-red-500',
                          )}>
                            <span className="text-sm font-bold text-white tabular-nums">
                              {Number(r.score).toFixed(1)}
                            </span>
                          </div>
                        </div>
                        {r.notes && (
                          <p className="mt-2.5 text-sm italic font-serif text-on-surface/70 leading-snug line-clamp-2">
                            "{r.notes}"
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-4 py-3">
                  <div className="w-10 h-10 rounded-full bg-on-surface/[0.05] grid place-items-center text-on-surface/55 flex-shrink-0">
                    <Users size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-serif italic text-base text-on-surface/55">
                      No friends have rated this yet.
                    </p>
                    <button
                      type="button"
                      onClick={() => setChatShareTarget(buildShareTarget())}
                      className="mt-0.5 text-[13px] font-bold text-primary hover:opacity-70 transition-opacity"
                    >
                      Share with a friend →
                    </button>
                  </div>
                </div>
              )}
            </section>
          );
        })()}

        {/* ── Hotel Dining — restaurants/bars/room service inside the
            hotel. Kept from previous design; styled to match the new
            section pattern. */}
        {isHotel && (
          <section className="py-9">
            <div className="flex items-baseline justify-between gap-4 mb-5">
              <h2 className="font-serif font-bold text-[22px] tracking-[-0.02em] text-on-surface">
                Hotel dining
              </h2>
              {user?.id && (
                <button
                  type="button"
                  onClick={() => setAddDiningOpen(true)}
                  className="text-[12px] font-semibold text-on-surface/55 hover:text-on-surface transition-colors"
                >
                  + Add
                </button>
              )}
            </div>

            <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-3 -mx-1 px-1">
              {([
                { value: 'all' as const, label: 'All' },
                { value: 'restaurant' as const, label: 'Restaurants' },
                { value: 'breakfast' as const, label: 'Breakfast' },
                { value: 'bar' as const, label: 'Bars' },
                { value: 'room_service' as const, label: 'Room Service' },
                { value: 'pool_bar' as const, label: 'Pool Bar' },
                { value: 'rooftop' as const, label: 'Rooftop' },
              ] as const).map((f) => (
                <button
                  key={f.value}
                  onClick={() => setDiningFilter(f.value)}
                  className={cn(
                    'px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0',
                    diningFilter === f.value ? 'bg-primary text-white' : 'bg-transparent text-on-surface/55 hover:text-on-surface',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {hotelDiningOptions.length === 0 ? (
              <div className="rounded-2xl border border-on-surface/10 bg-white/60 py-10 text-center">
                <Building2 size={24} className="mx-auto text-on-surface/25 mb-2" />
                <p className="text-sm text-on-surface/45">No dining options added yet</p>
              </div>
            ) : (
              <ul className="rounded-2xl bg-white/60 border border-on-surface/10 divide-y divide-on-surface/[0.06] overflow-hidden">
                {hotelDiningOptions
                  .filter((d) => diningFilter === 'all' || d.dining_type === diningFilter)
                  .map((d) => {
                    const score = diningRatings[d.restaurant_place_id];
                    return (
                      <li key={d.id}>
                        <button
                          type="button"
                          onClick={() => navigate(`/restaurant/${d.restaurant_place_id}`)}
                          className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-on-surface/[0.015] transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <h4 className="font-serif font-bold text-base truncate">{d.restaurant_name}</h4>
                            <p className={cn(
                              'mt-0.5 text-[11px] font-bold uppercase tracking-[0.18em]',
                              d.dining_type === 'restaurant' ? 'text-primary/70' :
                              d.dining_type === 'breakfast' ? 'text-amber-600' :
                              d.dining_type === 'bar' ? 'text-violet-600' :
                              d.dining_type === 'rooftop' ? 'text-sky-600' :
                              'text-on-surface/50'
                            )}>
                              {d.dining_type.replace('_', ' ')}
                            </p>
                          </div>
                          {score != null && (
                            <div className={cn(
                              'flex-shrink-0 w-14 h-9 rounded-md grid place-items-center',
                              score >= 8 ? 'bg-secondary' : score >= 5 ? 'bg-amber-600' : 'bg-red-500',
                            )}>
                              <span className="text-sm font-bold text-white tabular-nums">
                                {score.toFixed(1)}
                              </span>
                            </div>
                          )}
                        </button>
                      </li>
                    );
                  })}
              </ul>
            )}
          </section>
        )}

        {/* ── My rating — quiet editable field rows. Re-rate (red pill)
            opens a fresh "Log New Visit" tab; per-row Edit chips deep-
            link straight into the matching sub-page of the modal. */}
        {myRating && place && (() => {
          const meta = {
            id: place.id, name: place.name,
            image: place.photoUrl || '',
            cuisine: isHotel ? 'Hotel Breakfast' : cuisine,
            price: isHotel ? '' : priceStr,
            address: place.fullAddress || place.address,
          };
          type RatingPage = 'main' | 'notes' | 'tags' | 'photos' | 'price' | 'date' | 'friends';
          const openAt = (pg: RatingPage) => openAddRestaurantModal(meta, pg);
          const hasNotes = !!myRating.notes;
          const hasTags = (myRating.tags?.length || 0) > 0;
          const hasPhotos = (myRating.photos?.length || 0) > 0;
          const hasDate = !!myRating.visitDate;
          const hasPrice = !isHotel && !!myRating.price;
          const hasFriends = !isHotel && (myRating.friendIds?.length || 0) > 0;
          const dateLabel = hasDate
            ? new Date(myRating.visitDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            : null;

          const FieldEdit: React.FC<{ onClick: () => void }> = ({ onClick }) => (
            <button
              type="button"
              onClick={onClick}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-on-surface border border-on-surface/10 hover:bg-on-surface/[0.05] hover:border-on-surface/20 rounded-full px-3 py-1.5 transition-colors flex-shrink-0"
            >
              <Edit3 size={13} className="text-on-surface/70" />
              <span>Edit</span>
            </button>
          );
          const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-on-surface/55">
              {children}
            </div>
          );

          return (
            <section ref={myRatingRef} className="py-9 scroll-mt-20">
              <div className="flex items-center justify-between gap-3 mb-5">
                <button
                  type="button"
                  onClick={() => setMyRatingOpen((o) => !o)}
                  className="inline-flex items-center gap-2 group"
                  aria-expanded={myRatingOpen}
                >
                  <h2 className="font-serif font-bold text-[22px] tracking-[-0.02em] text-on-surface">
                    My rating
                  </h2>
                  <ChevronDown
                    size={18}
                    className={cn(
                      'text-on-surface/45 group-hover:text-on-surface/70 transition-transform duration-200',
                      myRatingOpen && 'rotate-180',
                    )}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => openAddRestaurantModal(meta, 'new-visit')}
                  className="inline-flex items-center gap-1.5 bg-primary text-white text-[13px] font-bold px-4 py-2 rounded-full hover:opacity-90 transition-transform hover:-translate-y-px"
                >
                  <RotateCw size={13} />
                  <span>Re-rate</span>
                </button>
              </div>

              <AnimatePresence initial={false}>
                {myRatingOpen && (
                  <motion.div
                    key="my-rating-body"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-col">
                {/* Notes — top row, no top border */}
                <div className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-start gap-5 pt-1 pb-4">
                  <FieldLabel>Notes</FieldLabel>
                  {hasNotes ? (
                    <p className="font-serif text-[17px] leading-[1.5] text-on-surface max-w-[64ch]">
                      "{myRating.notes}"
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openAt('notes')}
                      className="text-sm italic text-on-surface/30 hover:text-on-surface/60 transition-colors text-left"
                    >
                      Add notes…
                    </button>
                  )}
                  <FieldEdit onClick={() => openAt('notes')} />
                </div>

                {/* Tags */}
                <div className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-start gap-5 py-4 border-t border-on-surface/[0.06]">
                  <FieldLabel>Tags</FieldLabel>
                  <div className="flex flex-wrap gap-1.5 pt-px">
                    {hasTags && myRating.tags.map((t) => (
                      <span key={t} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-on-surface/[0.05] text-on-surface">
                        {t}
                      </span>
                    ))}
                    <button
                      type="button"
                      onClick={() => openAt('tags')}
                      className="text-xs font-semibold px-2.5 py-1 rounded-full border border-dashed border-on-surface/15 text-on-surface/55 hover:border-primary hover:text-primary transition-colors"
                    >
                      + Add tag
                    </button>
                  </div>
                  <FieldEdit onClick={() => openAt('tags')} />
                </div>

                {/* Photos — kept; users uploading photos is core. */}
                <div className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-start gap-5 py-4 border-t border-on-surface/[0.06]">
                  <FieldLabel>Photos</FieldLabel>
                  {hasPhotos ? (
                    <div className="flex gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory">
                      {myRating.photos.map((p, i) => (
                        <img
                          key={i}
                          src={p.url}
                          alt=""
                          className="w-24 h-24 rounded-xl object-cover flex-shrink-0 snap-start"
                          referrerPolicy="no-referrer"
                        />
                      ))}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openAt('photos')}
                      className="text-sm italic text-on-surface/30 hover:text-on-surface/60 transition-colors text-left"
                    >
                      Add photos…
                    </button>
                  )}
                  <FieldEdit onClick={() => openAt('photos')} />
                </div>

                {/* Score */}
                <div className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-5 py-4 border-t border-on-surface/[0.06]">
                  <FieldLabel>Score</FieldLabel>
                  <div className="font-serif font-bold text-[22px] tracking-[-0.02em] tabular-nums text-on-surface">
                    {myRating.score.toFixed(1)}
                    <span className="text-on-surface/40 font-normal text-base ml-1">/ 10</span>
                  </div>
                  <FieldEdit onClick={() => openAt('main')} />
                </div>

                {/* Visited */}
                <div className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-5 py-4 border-t border-on-surface/[0.06]">
                  <FieldLabel>Visited</FieldLabel>
                  <div className={cn('text-[15px] font-medium', hasDate ? 'text-on-surface' : 'text-on-surface/40 italic')}>
                    {hasDate ? dateLabel : 'Add date…'}
                  </div>
                  <FieldEdit onClick={() => openAt('date')} />
                </div>

                {/* Price (skip for hotels) */}
                {!isHotel && (
                  <div className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-5 py-4 border-t border-on-surface/[0.06]">
                    <FieldLabel>Price</FieldLabel>
                    <div className={cn('text-[15px] font-medium', hasPrice ? 'text-on-surface' : 'text-on-surface/40 italic')}>
                      {hasPrice ? myRating.price : 'Add price…'}
                    </div>
                    <FieldEdit onClick={() => openAt('price')} />
                  </div>
                )}

                {/* With / companions (skip for hotels) */}
                {!isHotel && (
                  <div className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-start gap-5 py-4 border-t border-on-surface/[0.06]">
                    <FieldLabel>With</FieldLabel>
                    <div className="text-[15px]">
                      {hasFriends ? (
                        <span className="flex flex-wrap gap-1.5">
                          {myRating.friendIds.map((fid) => (
                            <span
                              key={fid}
                              className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/8 text-primary/80"
                            >
                              {friendNames[fid] || fid.slice(0, 8)}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-on-surface/40 italic">Add companions…</span>
                      )}
                    </div>
                    <FieldEdit onClick={() => openAt('friends')} />
                  </div>
                )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          );
        })()}

        {/* ── Visit history — date-stack timeline. Current rating sits
            at the top, then archived visits in DESC date order. Rows
            expand to reveal tags/photos and a two-stage delete. */}
        {myRating && visitHistory.length > 0 && place && (() => {
          const scoreBadgeBg = (s: number) =>
            s >= 8 ? 'bg-secondary' : s >= 5 ? 'bg-amber-600' : 'bg-red-500';
          const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const parseDate = (d?: string | null) => {
            if (!d) return null;
            return new Date(d.length === 10 ? `${d}T12:00:00` : d);
          };

          type Entry = {
            id: string;
            score: number;
            date: Date | null;
            notes?: string;
            tags?: string[];
            photos?: { url: string }[];
            wouldReturn?: boolean;
            trend: 'up' | 'down' | null;
          };

          const entries: Entry[] = [];
          entries.push({
            id: 'current',
            score: myRating.score,
            date: parseDate(myRating.visitDate),
            notes: myRating.notes,
            tags: myRating.tags,
            photos: myRating.photos,
            wouldReturn: myRating.wouldReturn,
            trend: null,
          });
          visitHistory.forEach((v) => {
            entries.push({
              id: v.id,
              score: v.score,
              date: parseDate(v.visit_date),
              notes: v.notes,
              tags: v.tags,
              photos: v.photos,
              wouldReturn: v.would_return,
              trend: null,
            });
          });
          entries.sort((a, b) => {
            const at = a.date ? a.date.getTime() : 0;
            const bt = b.date ? b.date.getTime() : 0;
            return bt - at;
          });
          for (let i = 0; i < entries.length; i++) {
            const older = entries[i + 1];
            if (!older) { entries[i].trend = null; continue; }
            const diff = entries[i].score - older.score;
            entries[i].trend = diff > 0.1 ? 'up' : diff < -0.1 ? 'down' : null;
          }

          return (
            <section className="py-9">
              <div className="flex items-baseline justify-between gap-4 mb-5">
                <h2 className="font-serif font-bold text-[22px] tracking-[-0.02em] text-on-surface">
                  Visit history
                </h2>
                <span className="text-[12px] font-semibold text-on-surface/55 inline-flex items-center gap-1">
                  All {entries.length}
                  <ChevronRight size={12} />
                </span>
              </div>

              <ul className="flex flex-col">
                {entries.map((e, idx) => {
                  const isExpanded = expandedVisit === e.id;
                  const month = e.date ? MONTHS[e.date.getMonth()].toUpperCase() : '—';
                  const day = e.date ? e.date.getDate() : '';
                  const fullDate = e.date
                    ? e.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                    : 'Date not recorded';
                  const noDay = !e.date;
                  return (
                    <li
                      key={e.id}
                      className={cn(idx > 0 && 'border-t border-on-surface/[0.06]')}
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedVisit(isExpanded ? null : e.id)}
                        className="w-full grid grid-cols-[64px_minmax(0,1fr)_auto] items-start gap-[18px] py-[18px] text-left hover:opacity-90 transition-opacity"
                      >
                        <div className={cn(
                          'text-center pt-0.5',
                          noDay && 'opacity-60',
                        )}>
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/55">
                            {month}
                          </div>
                          <div className={cn(
                            'font-serif text-[28px] leading-none mt-0.5 tabular-nums tracking-[-0.02em]',
                            noDay ? 'font-normal text-on-surface/40' : 'font-bold text-on-surface',
                          )}>
                            {day || '—'}
                          </div>
                        </div>

                        <div className="min-w-0">
                          {e.notes ? (
                            <p className="font-serif text-[15px] leading-[1.5] text-on-surface line-clamp-2">
                              {e.notes}
                            </p>
                          ) : (
                            <p className="font-serif italic text-[15px] text-on-surface/55">
                              No notes from this visit.
                            </p>
                          )}
                          <p className="mt-1 text-[12px] font-medium text-on-surface/55">
                            {fullDate}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                          {e.trend === 'up' && <TrendingUp size={15} className="text-green-600" />}
                          {e.trend === 'down' && <TrendingDown size={15} className="text-red-500" />}
                          <span className={cn(
                            'font-serif font-bold text-[20px] tabular-nums tracking-[-0.02em] text-secondary',
                          )}>
                            {e.score.toFixed(1)}
                          </span>
                        </div>
                      </button>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="pb-4 pl-[calc(64px+18px)] space-y-3">
                              {e.tags && e.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {e.tags.map((t) => (
                                    <span key={t} className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-primary/8 text-primary/75">
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {e.photos && e.photos.length > 0 && (
                                <div className="flex gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory">
                                  {e.photos.slice(0, 8).map((p, i) => (
                                    <img
                                      key={i}
                                      src={p.url}
                                      alt=""
                                      className="w-24 h-24 rounded-lg object-cover flex-shrink-0 snap-start"
                                      referrerPolicy="no-referrer"
                                    />
                                  ))}
                                </div>
                              )}

                              {confirmDeleteVisitId === e.id ? (
                                <div className="flex items-center justify-between gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                  <p className="text-xs font-medium text-red-700">Delete this visit?</p>
                                  <div className="flex gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteVisitId(null)}
                                      className="px-2.5 py-1 text-[11px] font-semibold text-on-surface/70 border border-on-surface/15 rounded-md bg-white hover:bg-on-surface/[0.04]"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (!place) return;
                                        deleteVisit(place.id, e.id);
                                        setConfirmDeleteVisitId(null);
                                        setExpandedVisit(null);
                                      }}
                                      className="px-2.5 py-1 text-[11px] font-semibold text-white bg-red-500 rounded-md hover:bg-red-600"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteVisitId(e.id)}
                                  className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-red-500 hover:text-red-600 transition-colors"
                                >
                                  <Trash2 size={13} /> Delete visit
                                </button>
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

        {/* ── Expert picks — kept as editorial list. Hidden when none. */}
        {expertRecommendations.length > 0 && (
          <section className="py-9">
            <h2 className="font-serif font-bold text-[22px] tracking-[-0.02em] text-on-surface mb-5">
              Expert picks
            </h2>
            <ul className="rounded-2xl bg-white/60 border border-on-surface/10 divide-y divide-on-surface/[0.06] overflow-hidden">
              {expertRecommendations.map((rec) => {
                const isExpanded = expandedExpertId === rec.id;
                return (
                  <li key={rec.id}>
                    <button
                      onClick={() => setExpandedExpertId(isExpanded ? null : rec.id)}
                      className="w-full px-5 py-5 text-left hover:bg-on-surface/[0.015] transition-colors"
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link
                              to={`/user/${rec.expert_username}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-base font-serif font-bold text-on-surface hover:text-primary truncate"
                            >
                              {rec.expert_name}
                            </Link>
                            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-amber-600">
                              Expert
                            </span>
                          </div>
                          <p className={cn('text-sm mt-1.5 leading-relaxed text-on-surface/70', isExpanded ? '' : 'line-clamp-2')}>
                            {rec.recommendation_text}
                          </p>
                        </div>
                        <div className={cn(
                          'flex-shrink-0 w-14 h-9 rounded-md grid place-items-center',
                          Number(rec.rating) >= 8 ? 'bg-secondary' : Number(rec.rating) >= 5 ? 'bg-amber-600' : 'bg-red-500',
                        )}>
                          <span className="text-sm font-bold text-white tabular-nums">
                            {Number(rec.rating).toFixed(1)}
                          </span>
                        </div>
                      </div>
                      <AnimatePresence>
                        {isExpanded && rec.highlight_dishes && rec.highlight_dishes.length > 0 && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="pt-3">
                              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-600/70 mb-2">Highlight dishes</p>
                              <div className="flex flex-wrap gap-1.5">
                                {rec.highlight_dishes.map((dish) => (
                                  <span key={dish} className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-800">
                                    {dish}
                                  </span>
                                ))}
                              </div>
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

        {/* ── Featured reels — "More from {restaurant}". Header style
            matches the rest of the page so the existing component's
            internal title stays consistent. */}
        <div className="py-9">
          <RestaurantFeaturedReels
            restaurantId={place.id}
            restaurantName={place.name}
            size="md"
          />
        </div>

        {/* ── Hours — inline open/closed status row that expands to the
            full weekly table. */}
        {place.hours.length > 0 && (
          <section className="py-9">
            <h2 className="font-serif font-bold text-[22px] tracking-[-0.02em] text-on-surface mb-3">
              Hours
            </h2>
            <button
              type="button"
              onClick={() => setHoursOpen(!hoursOpen)}
              className="w-full flex items-center gap-3 py-3.5 text-left"
            >
              {place.isOpen !== null && (
                <span className={cn('inline-block w-1.5 h-1.5 rounded-full flex-shrink-0', place.isOpen ? 'bg-green-500' : 'bg-red-500')} />
              )}
              <span className="flex-1 text-sm font-semibold">
                <span className={cn(place.isOpen === false ? 'text-red-600' : place.isOpen ? 'text-green-700' : 'text-on-surface')}>
                  {place.isOpen === false ? 'Closed' : place.isOpen ? 'Open' : 'Hours'}
                </span>
                <span className="text-on-surface/55 font-medium"> · {getTodayHours(place.hours)}</span>
              </span>
              <ChevronDown
                size={16}
                className={cn('text-on-surface/40 transition-transform duration-200', hoursOpen && 'rotate-180')}
              />
            </button>
            <AnimatePresence>
              {hoursOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="pt-1 pb-3">
                    {place.hours.map((line, i) => {
                      const [day, ...timeParts] = line.split(': ');
                      const time = timeParts.join(': ');
                      const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                      const isToday = today.startsWith(day.toLowerCase().slice(0, 3));
                      const isClosed = /closed/i.test(time);
                      return (
                        <div
                          key={i}
                          className={cn(
                            'flex items-center justify-between py-2 border-t border-on-surface/[0.06] text-sm',
                            isToday ? 'font-bold text-on-surface' : 'font-medium text-on-surface/65',
                            isClosed && !isToday && 'text-on-surface/40',
                          )}
                        >
                          <span>{day}</span>
                          <span className="tabular-nums">{time}</span>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        )}

        {/* ── Contact — quiet hairline rows. ── */}
        <section className="py-9">
          <h2 className="font-serif font-bold text-[22px] tracking-[-0.02em] text-on-surface mb-3">
            Contact
          </h2>
          <ul className="flex flex-col">
            {place.phone && (
              <li>
                <a
                  href={`tel:${place.phone}`}
                  className="flex items-center gap-3.5 py-3.5 hover:opacity-70 transition-opacity"
                >
                  <span className="w-8 h-8 rounded-full bg-on-surface/[0.05] grid place-items-center text-on-surface/70 flex-shrink-0">
                    <Phone size={14} />
                  </span>
                  <span className="flex-1 text-sm font-medium text-on-surface tabular-nums truncate">{place.phone}</span>
                  <ChevronRight size={14} className="text-on-surface/40 flex-shrink-0" />
                </a>
              </li>
            )}
            {place.website && (
              <li className={cn(place.phone && 'border-t border-on-surface/[0.06]')}>
                <a
                  href={place.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3.5 py-3.5 hover:opacity-70 transition-opacity"
                >
                  <span className="w-8 h-8 rounded-full bg-on-surface/[0.05] grid place-items-center text-on-surface/70 flex-shrink-0">
                    <Globe size={14} />
                  </span>
                  <span className="flex-1 text-sm font-medium text-on-surface truncate">
                    {place.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                  </span>
                  <ExternalLink size={14} className="text-on-surface/40 flex-shrink-0" />
                </a>
              </li>
            )}
            <li className={cn((place.phone || place.website) && 'border-t border-on-surface/[0.06]')}>
              <a
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3.5 py-3.5 hover:opacity-70 transition-opacity"
              >
                <span className="w-8 h-8 rounded-full bg-on-surface/[0.05] grid place-items-center text-on-surface/70 flex-shrink-0">
                  <MapPin size={14} />
                </span>
                <span className="flex-1 text-sm font-medium text-on-surface truncate">{place.address}</span>
                <Navigation size={14} className="text-on-surface/40 flex-shrink-0" />
              </a>
            </li>
          </ul>
        </section>

        {/* ── Location — Mapbox map with overlay chip + open-in-maps. */}
        <section className="py-9">
          <h2 className="font-serif font-bold text-[22px] tracking-[-0.02em] text-on-surface mb-5">
            Location
          </h2>
          <div className="relative rounded-2xl overflow-hidden border border-on-surface/10 aspect-[21/9] bg-cream-2">
            <div
              ref={mapContainerRef}
              className="absolute inset-0"
              style={{ width: '100%', height: '100%' }}
            />
            <button
              type="button"
              onClick={() => navigate('/map', {
                state: {
                  focus: {
                    id: place.id,
                    name: place.name,
                    lat: place.lat,
                    lng: place.lng,
                    address: place.fullAddress || place.address,
                    fullAddress: place.fullAddress || place.address,
                    photoUrl: place.photoUrl,
                    priceLevel: place.priceLevel,
                    rating: place.rating,
                    types: place.types,
                    userRatingCount: place.userRatingCount,
                  },
                },
              })}
              aria-label="Open full map"
              className="absolute inset-0 z-10 hover:bg-on-surface/5 transition-colors"
            />
            <div
              className="absolute left-4 bottom-4 z-20 inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[12px] font-semibold text-on-surface"
              style={{
                background: 'rgba(255, 255, 255, 0.92)',
                backdropFilter: 'blur(10px)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              }}
            >
              <MapPin size={12} className="text-primary" />
              <span className="truncate max-w-[260px]">{place.address}</span>
            </div>
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="absolute right-4 top-4 z-20 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-bold text-on-surface"
              style={{
                background: 'rgba(255, 255, 255, 0.92)',
                backdropFilter: 'blur(10px)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              }}
            >
              Open in Maps
              <ExternalLink size={12} />
            </a>
          </div>
        </section>
      </main>

      {/* Photo Gallery Modal */}
      <AnimatePresence>
        {galleryOpen && photos.length > 0 && (
          <PhotoGallery
            photos={photos}
            communityPhotos={communityPhotos}
            name={place.name}
            initialIndex={photoIndex}
            onClose={() => setGalleryOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Friends ratings detail modal */}
      <AnimatePresence>
        {showFriendsDetail && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
              onClick={() => setShowFriendsDetail(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              {...friendsDetailDragProps}
              className="fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-3xl max-h-[70vh] flex flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-on-surface/[0.06] flex-shrink-0">
                <div>
                  <h3 className="font-serif font-bold text-lg">Friends' Ratings</h3>
                  <p className="text-xs text-on-surface/40">{place.name}</p>
                </div>
                <button
                  onClick={() => setShowFriendsDetail(false)}
                  className="w-8 h-8 rounded-full bg-on-surface/[0.05] grid place-items-center"
                  aria-label="Close"
                >
                  <X size={16} className="text-on-surface/60" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {friendsStats.ratings.map((r) => (
                  <div key={r.id} className="bg-white rounded-xl border border-on-surface/[0.08] p-4">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 grid place-items-center">
                          <UserCircle size={16} className="text-primary/50" />
                        </div>
                        <span className="text-sm font-semibold text-on-surface/70">Friend</span>
                      </div>
                      <ScoreBadge rating={Number(r.score)} size="sm" />
                    </div>
                    {r.notes && <p className="text-[13px] text-on-surface/50 italic mt-2 leading-relaxed">"{r.notes}"</p>}
                    {r.tags && r.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {r.tags.map((t) => (
                          <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-primary/8 text-primary/60">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Unified share dialog — friends list, multi-select, auto-creates
          chats. */}
      <ShareDialog
        open={!!chatShareTarget}
        payload={chatShareTarget ? { sharedRestaurant: chatShareTarget } : null}
        onClose={() => setChatShareTarget(null)}
      />

      {/* Add Hotel Dining Modal */}
      {place && isHotel && user?.id && (
        <AddHotelDiningModal
          open={addDiningOpen}
          onClose={() => setAddDiningOpen(false)}
          hotelPlaceId={place.id}
          hotelName={place.name}
          hotelAddress={place.address}
          userId={user.id}
          onSaved={refreshHotelDining}
        />
      )}
    </div>
  );
};
