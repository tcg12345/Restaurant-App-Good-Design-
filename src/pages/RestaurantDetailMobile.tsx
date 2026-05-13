import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Star, MapPin, Clock, Phone, Globe,
  ChevronLeft, ChevronRight, ChevronDown, Loader2,
  Navigation, ExternalLink, X, Users, UserCircle, Share2, Bookmark,
  DollarSign, CalendarDays, Tag, Image, Edit3, MessageCircle, Check, Send, Building2, TrendingUp, TrendingDown, StickyNote, Trash2, ImageOff,
  Car, Footprints,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { scoreColor } from '../lib/score';
import { ScoreBadge } from '../components/ScoreBadge';
import { useRestaurantDetail, formatReviewCount, getTodayHours, getCuisineLabel } from './useRestaurantDetail';
import { useLists } from '../contexts/ListsContext';
import { useChat, type SharedRestaurant } from '../contexts/ChatContext';
import { ShareDialog } from '../components/ShareDialog';
import { useAuth } from '../contexts/AuthContext';
import { getProfilesByIds, getCommunityStats, type UserProfile as UP, type DiningType } from '../lib/supabase-community';
import { priceLevelToString } from '../lib/places';
import { loadLastSelectedLocation, isExactAddress } from '../components/HomeLocationBar';
import { haversineDistanceMi, formatDistance } from '../lib/distance';
import { useTravelTimes, formatTravelTime } from '../lib/directions';
import { Link } from 'react-router-dom';
import { AddHotelDiningModal } from '../components/AddHotelDiningModal';
import { PhotoGallery } from '../components/PhotoGallery';
import { RestaurantFeaturedReels } from '../components/RestaurantFeaturedReels';

/** Parse hours array to find next opening time when currently closed */
function getNextOpenTime(hours: string[]): string {
  if (!hours || hours.length === 0) return '';
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const now = new Date();
  const todayIdx = now.getDay();

  // Look at today first, then upcoming days
  for (let offset = 0; offset < 7; offset++) {
    const dayIdx = (todayIdx + offset) % 7;
    const dayName = days[dayIdx];
    const entry = hours.find((h) => h.startsWith(dayName));
    if (!entry) continue;
    // Skip "Closed" days
    if (/closed/i.test(entry)) continue;
    // Extract opening time — format: "Monday: 11:30 AM – 10:00 PM" or "Monday: 5:00 – 11:00 PM"
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
import { RadarChart } from '../components/RadarChart';
import { getFlavorProfile } from '../lib/flavorProfile';

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
import 'mapbox-gl/dist/mapbox-gl.css';

/* PhotoGallery is now a shared component — see ../components/PhotoGallery.tsx */

export const RestaurantDetailMobile: React.FC = () => {
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

  const { toggleWishlist, isWishlisted, getRating, openAddRestaurantModal, deleteVisit } = useLists();

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
  const [confirmDeleteVisitId, setConfirmDeleteVisitId] = useState<string | null>(null);
  const { conversations, sendMessage } = useChat();
  const { user } = useAuth();
  // Hours expanded by default — it's the most frequently checked info,
  // so show it open without a tap. Local state so we don't mutate the
  // shared hook default.
  const [hoursOpen, setHoursOpen] = useState(false);
  const [flavorOpen, setFlavorOpen] = useState(false);
  const [myRatingOpen, setMyRatingOpen] = useState(false);
  // Ref on the "My Rating Details" section so the Your Rating summary
  // card above can smooth-scroll down to it when tapped.
  const myRatingRef = useRef<HTMLElement | null>(null);
  const [expandedVisit, setExpandedVisit] = useState<string | null>(null);
  const [friendNames, setFriendNames] = useState<Record<string, string>>({});
  // ShareDialog payload — built lazily at click time from `place` + the
  // viewer's rating. The dialog itself owns the friends list /
  // multi-select / auto-create-chat logic.
  const [chatShareTarget, setChatShareTarget] = useState<SharedRestaurant | null>(null);
  const [chatSent, setChatSent] = useState(false);
  const [diningFilter, setDiningFilter] = useState<DiningType | 'all'>('all');
  const [addDiningOpen, setAddDiningOpen] = useState(false);
  const [diningRatings, setDiningRatings] = useState<Record<string, number>>({});
  const [expandedExpertId, setExpandedExpertId] = useState<string | null>(null);
  // Profile lookup for the inline friend reviews under "Your Circle"
  // — keyed by user_id so each card can show display name + initial.
  const [friendReviewProfiles, setFriendReviewProfiles] = useState<Record<string, UP>>({});

  useEffect(() => {
    const ids = Array.from(new Set(friendsStats.ratings.map((r) => r.user_id))).filter(Boolean);
    if (ids.length === 0) return;
    getProfilesByIds(ids).then(setFriendReviewProfiles);
  }, [friendsStats.ratings]);

  const myRating = place ? getRating(place.id) : undefined;
  // Only treat as hotel if the primary type is hotel (types[0]) or the user rated it as Hotel Breakfast
  const isHotel = place ? (place.types[0] === 'hotel' || place.types[0] === 'lodging' || myRating?.cuisine === 'Hotel Breakfast') : false;

  // Load friend names for the "Went With" section
  useEffect(() => {
    if (!myRating?.friendIds?.length) return;
    getProfilesByIds(myRating.friendIds).then((profiles) => {
      const names: Record<string, string> = {};
      Object.values(profiles).forEach((p) => { names[p.user_id] = p.display_name || `@${p.username}`; });
      setFriendNames(names);
    });
  }, [myRating?.friendIds]);

  // Load community ratings for hotel dining options
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

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f7f2ea' }}>

      {/* ── Sticky top bar — back / bookmark / share. Stays pinned to
          the top of the scroll container as the page scrolls past the
          hero. Uses glass pills so the icons stay legible both on top
          of the photo and on the cream surface below. ── */}
      <div className="sticky top-0 z-50 h-0">
        <div className="absolute top-0 inset-x-0 px-4 pt-4 flex items-center justify-between pointer-events-none">
          <button
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="pointer-events-auto p-2 bg-black/30 backdrop-blur-md rounded-full text-white/90 shadow-sm"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              onClick={() => {
                if (!place) return;
                toggleWishlist({
                  id: place.id, name: place.name,
                  image: place.photoUrl || '',
                  cuisine, price: priceStr,
                  address: place.fullAddress || place.address,
                });
              }}
              aria-label={place && isWishlisted(place.id) ? 'Remove from wishlist' : 'Save to wishlist'}
              className="p-2 bg-black/30 backdrop-blur-md rounded-full text-white/90 shadow-sm"
            >
              <Bookmark size={16} className={place && isWishlisted(place.id) ? 'fill-white text-white' : ''} />
            </button>
            <button
              onClick={() => {
                if (navigator.share) {
                  navigator.share({ title: place.name, url: window.location.href });
                } else {
                  navigator.clipboard.writeText(window.location.href);
                }
              }}
              aria-label="Share"
              className="p-2 bg-black/30 backdrop-blur-md rounded-full text-white/90 shadow-sm"
            >
              <Share2 size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Hero — full-bleed image. Shorter than before (52vh) because
          the name + metadata moved out of the overlay and down onto
          the page surface. The dark gradient stays at the bottom for
          a gentle fade. Top-bar controls live outside the hero now so
          they can stick to the top of the scroll container. ── */}
      <div className="relative w-full overflow-hidden" style={{ height: '39vh', maxHeight: '45vh' }}>
        {photos.length > 0 ? (
          <button
            onClick={() => setGalleryOpen(true)}
            className="absolute inset-0 w-full h-full cursor-pointer z-[1]"
          >
            <img
              src={photos[photoIndex]}
              alt={place.name}
              className="h-full w-full object-cover transition-all duration-500"
              referrerPolicy="no-referrer"
            />
          </button>
        ) : (
          <div className="absolute inset-0 w-full h-full bg-muted flex flex-col items-center justify-center gap-2 text-on-surface/30">
            <ImageOff size={40} />
            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface/40">
              No photos added yet
            </span>
          </div>
        )}

        {/* Dark gradient — gentle fade at the bottom */}
        <div
          className="absolute inset-x-0 bottom-0 h-1/3 pointer-events-none"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.15) 55%, transparent 100%)' }}
        />
        {/* Thin fade into page bg */}
        <div
          className="absolute inset-x-0 bottom-0 h-8 pointer-events-none"
          style={{ background: 'linear-gradient(to top, #fff8f6, transparent)' }}
        />

        {/* Carousel arrows */}
        {photos.length > 1 && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setPhotoIndex((i) => (i - 1 + photos.length) % photos.length); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-1.5 bg-black/25 backdrop-blur-sm rounded-full text-white/80 z-10"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setPhotoIndex((i) => (i + 1) % photos.length); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 bg-black/25 backdrop-blur-sm rounded-full text-white/80 z-10"
            >
              <ChevronRight size={18} />
            </button>
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
              {photos.map((_, i) => (
                <button
                  key={i}
                  onClick={(e) => { e.stopPropagation(); setPhotoIndex(i); }}
                  className={`h-1.5 rounded-full transition-all ${i === photoIndex ? 'bg-white w-5' : 'bg-white/40 w-1.5'}`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Main Content ── */}
      <main className="pt-5" style={{ paddingLeft: 18, paddingRight: 18 }}>

        {/* ── Name + metadata — on the warm surface, confident and grounded.
            Large serif name on the left, prominent circular score badge
            floating on the right. The score shows the user's personal
            rating if they have one, otherwise the community average. ── */}
        {(() => {
          const badgeScore = myRating?.score ?? (communityStats.totalRatings > 0 ? communityStats.avgScore : null);
          const badgeIsPersonal = !!myRating;
          const badgeColor = badgeScore != null
            ? (badgeScore >= 8 ? 'bg-secondary' : badgeScore >= 5 ? 'bg-amber-600' : 'bg-red-500')
            : '';
          return (
            <section className="mb-6">
              <p
                className="uppercase mb-3"
                style={{
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  fontSize: '10px',
                  fontWeight: 500,
                  letterSpacing: '1.4px',
                  color: '#6b6359',
                }}
              >
                {isHotel ? 'Hotel' : cuisine}
                {!isHotel && priceStr && <> · {priceStr}</>}
              </p>
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <h1
                    className="text-on-surface leading-[1.05]"
                    style={{
                      fontFamily: '"Fraunces", "Noto Serif", serif',
                      fontSize: '32px',
                      fontWeight: 500,
                      letterSpacing: '-0.6px',
                      fontVariationSettings: '"opsz" 144',
                    }}
                  >
                    {place.name}
                  </h1>
                  {(() => {
                    const dist = homeLocationForDistance && destForDistance
                      ? formatDistance(haversineDistanceMi(homeLocationForDistance.lat, homeLocationForDistance.lng, destForDistance.lat, destForDistance.lng))
                      : '';
                    return (
                      <p className="mt-3 text-[14px] text-on-surface/60 flex items-baseline gap-1.5 min-w-0">
                        <span className="truncate">{place.address}</span>
                        {dist && (
                          <>
                            <span className="text-on-surface/30 flex-shrink-0">·</span>
                            <span className="flex-shrink-0">{dist}</span>
                          </>
                        )}
                      </p>
                    );
                  })()}
                  {place.isOpen !== null && (
                    <div className="mt-2 flex items-center gap-2 text-[14px]">
                      <span className={cn('inline-block w-2 h-2 rounded-full flex-shrink-0', place.isOpen ? 'bg-secondary' : 'bg-red-500')} />
                      {place.isOpen ? (
                        <span className="text-on-surface/65">
                          <span className="font-semibold text-secondary">Open</span>
                          {(() => {
                            const line = getTodayHours(place.hours);
                            const close = line.split(/\s*[–-]\s*/)[1];
                            return close ? <span> · closes {close.trim()}</span> : null;
                          })()}
                        </span>
                      ) : (
                        <span className="text-on-surface/65">
                          <span className="font-semibold text-red-600">Closed</span>
                          {(() => {
                            const next = getNextOpenTime(place.hours);
                            return next ? <span> · opens {next}</span> : null;
                          })()}
                        </span>
                      )}
                    </div>
                  )}
                  {homeLocationForDistance && destForDistance && (driveLabel || walkLabel) && (
                    <div className="mt-2 flex items-center gap-3 text-[13px] text-on-surface/65">
                      {driveLabel && (
                        <span className="inline-flex items-center gap-1.5">
                          <Car size={14} className="text-on-surface/45" />
                          {driveLabel}
                        </span>
                      )}
                      {driveLabel && walkLabel && <span className="text-on-surface/25">·</span>}
                      {walkLabel && (
                        <span className="inline-flex items-center gap-1.5">
                          <Footprints size={14} className="text-on-surface/45" />
                          {walkLabel}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {badgeScore != null && (
                  <div
                    className={cn(
                      'flex-shrink-0 w-[72px] h-[72px] rounded-full flex items-center justify-center shadow-sm',
                      badgeColor,
                    )}
                    aria-label={badgeIsPersonal ? `Your rating ${badgeScore.toFixed(1)}` : `Community rating ${badgeScore.toFixed(1)}`}
                  >
                    <span className="text-[26px] font-serif font-bold text-white tabular-nums leading-none">
                      {badgeScore.toFixed(1)}
                    </span>
                  </div>
                )}
              </div>
            </section>
          );
        })()}

        {/* ── Your Rating callout — near-black card (ink) with a
            persimmon score circle, JetBrains Mono label, and italic
            Fraunces note quote. Tapping opens the rating modal so the
            user can update their current rating or log a new visit
            directly (regardless of whether they've rated yet). ── */}
        <button
          type="button"
          onClick={() => {
            if (!place) return;
            openAddRestaurantModal({
              id: place.id, name: place.name,
              image: place.photoUrl || '',
              cuisine, price: priceStr,
              address: place.fullAddress || place.address,
            });
          }}
          className="w-full mb-5 rounded-[14px] bg-ink text-cream p-4 flex items-center gap-3.5 text-left active:scale-[0.99] transition-transform"
        >
          {myRating ? (
            <>
              <div className="flex-shrink-0 w-[46px] h-[46px] rounded-full bg-persimmon flex items-center justify-center">
                <span
                  className="text-white leading-none"
                  style={{
                    fontFamily: '"Fraunces", "Noto Serif", serif',
                    fontSize: '18px',
                    fontWeight: 600,
                    fontVariationSettings: '"opsz" 144',
                  }}
                >
                  {myRating.score.toFixed(1)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className="uppercase text-white/70"
                  style={{
                    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                    fontSize: '11px',
                    letterSpacing: '0.05em',
                  }}
                >
                  Your rating · {visitCount + 1} {visitCount + 1 === 1 ? 'visit' : 'visits'}
                </p>
                <p
                  className="italic text-white/95 line-clamp-1 mt-0.5"
                  style={{
                    fontFamily: '"Fraunces", "Noto Serif", serif',
                    fontSize: '15px',
                    lineHeight: 1.3,
                  }}
                >
                  "{myRating.notes || 'Tap to update or log a new visit'}"
                </p>
              </div>
              <ChevronRight size={18} className="text-white/55 flex-shrink-0" />
            </>
          ) : (
            <>
              <div className="flex-shrink-0 w-[46px] h-[46px] rounded-full bg-persimmon flex items-center justify-center">
                <Star size={18} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className="uppercase text-white/70"
                  style={{
                    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                    fontSize: '11px',
                    letterSpacing: '0.05em',
                  }}
                >
                  Tap to rate
                </p>
                <p
                  className="italic text-white/95 mt-0.5"
                  style={{
                    fontFamily: '"Fraunces", "Noto Serif", serif',
                    fontSize: '15px',
                    lineHeight: 1.3,
                  }}
                >
                  "Log your visit and score"
                </p>
              </div>
              <ChevronRight size={18} className="text-white/55 flex-shrink-0" />
            </>
          )}
        </button>

        {/* ── Action row — Call, Route, Web, Share. Rounded paper
            cards (not circle outlines) with icon + label stacked. ── */}
        <div className="grid grid-cols-4 gap-2 mb-6">
          {[
            { Icon: Phone, label: 'Call', href: place.phone ? `tel:${place.phone}` : null },
            { Icon: Navigation, label: 'Route', href: directionsUrl, external: true },
            { Icon: Globe, label: 'Web', href: place.website || null, external: true },
            { Icon: Send, label: 'Share', onClick: () => setChatShareTarget({
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
            }) },
          ].map(({ Icon, label, href, external, onClick }) => {
            const inner = (
              <>
                <Icon size={18} />
                <span style={{ fontSize: '11px', fontWeight: 500 }}>{label}</span>
              </>
            );
            const cls = 'flex flex-col items-center justify-center gap-1 py-3 rounded-[12px] bg-paper border border-line text-ink-2 active:opacity-70 transition-opacity';
            const disabledCls = 'flex flex-col items-center justify-center gap-1 py-3 rounded-[12px] bg-paper border border-line text-ink-2 opacity-35';
            if (onClick) return <button key={label} type="button" onClick={onClick} className={cls}>{inner}</button>;
            if (!href) return <div key={label} className={disabledCls}>{inner}</div>;
            return (
              <a key={label} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className={cls}>
                {inner}
              </a>
            );
          })}
        </div>

        {/* ── The Community Says — three clean score boxes side-by-side:
            EVERYONE, FRIENDS, EXPERTS. Paper fill, subtle line border,
            centered Fraunces score in the middle with a JetBrains Mono
            eyebrow above and system-font count below. ── */}
        {(() => {
          const expertAvg = expertRecommendations.length > 0
            ? expertRecommendations.reduce((sum, r) => sum + Number(r.rating), 0) / expertRecommendations.length
            : 0;
          const expertCount = expertRecommendations.length;
          const hasCommunity = communityStats.totalRatings > 0;
          const hasFriends = !isHotel && friendsStats.totalRatings > 0;
          const hasExperts = expertCount > 0;
          const hasGoogle = Number(place.rating) > 0 && place.userRatingCount > 0;

          // System font stack — native Apple/Windows UI face for the
          // count line so it reads as quiet meta-info.
          const systemStack = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

          const Box = ({ label, score, count, countLabel, emptyCopy, onClick }: {
            label: string;
            score: number | null;
            count: number;
            countLabel: string;
            emptyCopy: string;
            onClick?: () => void;
          }) => {
            const body = (
              <>
                <p
                  className="uppercase text-ink-3"
                  style={{
                    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                    fontSize: '10px',
                    letterSpacing: '0.14em',
                  }}
                >
                  {label}
                </p>
                {score != null ? (
                  <>
                    <p
                      className={cn('leading-none tabular-nums mt-1', scoreColor(score))}
                      style={{
                        fontFamily: '"Fraunces", "Noto Serif", serif',
                        fontSize: '26px',
                        fontWeight: 500,
                        letterSpacing: '-0.5px',
                        fontVariationSettings: '"opsz" 144',
                      }}
                    >
                      {score.toFixed(1)}
                    </p>
                    <p
                      className="mt-0.5 text-ink-3"
                      style={{ fontFamily: systemStack, fontSize: '10px' }}
                    >
                      {count.toLocaleString()} {countLabel}
                    </p>
                  </>
                ) : (
                  <>
                    <p
                      className="leading-none tabular-nums mt-1 text-ink-4"
                      style={{
                        fontFamily: '"Fraunces", "Noto Serif", serif',
                        fontSize: '26px',
                        fontWeight: 500,
                        letterSpacing: '-0.5px',
                        fontVariationSettings: '"opsz" 144',
                      }}
                    >
                      —
                    </p>
                    <p
                      className="mt-0.5 italic text-ink-4"
                      style={{ fontFamily: systemStack, fontSize: '10px' }}
                    >
                      {emptyCopy}
                    </p>
                  </>
                )}
              </>
            );
            const classes = 'rounded-[12px] bg-paper border border-line py-3.5 px-2.5 text-center';
            return onClick ? (
              <button type="button" onClick={onClick} className={cn(classes, 'active:scale-[0.98] transition-transform')}>
                {body}
              </button>
            ) : (
              <div className={classes}>{body}</div>
            );
          };

          return (
            <section className="mb-6">
              <p className="section-eyebrow mb-4">Ratings</p>
              <div className={cn('grid gap-2.5', isHotel ? 'grid-cols-1' : 'grid-cols-3')}>
                <Box
                  label={isHotel ? 'Breakfast' : 'Everyone'}
                  score={hasCommunity ? communityStats.avgScore : null}
                  count={communityStats.totalRatings}
                  countLabel={communityStats.totalRatings === 1 ? 'rating' : 'ratings'}
                  emptyCopy="Be the first"
                />
                {!isHotel && (
                  <Box
                    label="Friends"
                    score={hasFriends ? friendsStats.avgScore : null}
                    count={friendsStats.totalRatings}
                    countLabel={friendsStats.totalRatings === 1 ? 'rating' : 'ratings'}
                    emptyCopy="No friends yet"
                    onClick={hasFriends ? () => setShowFriendsDetail(true) : undefined}
                  />
                )}
                {!isHotel && (
                  <Box
                    label="Experts"
                    score={hasExperts ? expertAvg : null}
                    count={expertCount}
                    countLabel={expertCount === 1 ? 'rating' : 'ratings'}
                    emptyCopy="No expert picks"
                  />
                )}
              </div>

              {hasGoogle && (
                <p
                  className="mt-3 text-ink-3"
                  style={{
                    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                    fontSize: '12px',
                  }}
                >
                  <span>Google:</span>{' '}
                  <span className="tabular-nums font-medium text-ink-2">{place.rating}</span>
                  <span className="ml-1 text-ink-4">({formatReviewCount(place.userRatingCount)} reviews)</span>
                </p>
              )}
            </section>
          );
        })()}


        {/* ── Your Circle — inline friend reviews as cards. Up to three
            are shown directly on the page; "See all" opens the full
            friend ratings bottom sheet. Tapping a card navigates to
            the review detail page. ── */}
        {!isHotel && (() => {
          const hasFriends = friendsStats.ratings.length > 0;
          const topFriends = friendsStats.ratings.slice(0, 3);
          const scoreChipBg = (s: number) =>
            s >= 8 ? 'bg-olive' : s >= 5 ? 'bg-amber-600' : 'bg-clay';
          return (
            <section className="mb-6">
              <div className="flex items-end justify-between mb-4">
                <p className="section-eyebrow">Your circle</p>
                {(hasFriends || expertRecommendations.length > 0) && place && (
                  <button
                    type="button"
                    onClick={() => navigate(`/restaurant/${place.id}/circle`)}
                    className="text-persimmon active:opacity-70 transition-opacity flex-shrink-0"
                    style={{ fontSize: '13px', fontWeight: 500 }}
                  >
                    See all
                  </button>
                )}
              </div>

              {hasFriends ? (
                <div className="divide-y divide-line">
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
                        className="w-full py-4 first:pt-0 last:pb-0 text-left active:opacity-70 transition-opacity"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-cream-2 flex items-center justify-center flex-shrink-0">
                            <span
                              className="text-ink"
                              style={{
                                fontFamily: '"Fraunces", "Noto Serif", serif',
                                fontSize: '15px',
                                fontWeight: 600,
                              }}
                            >
                              {initial}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-ink truncate" style={{ fontSize: '14px', fontWeight: 600 }}>
                              {name}
                            </p>
                            {visitLabel && (
                              <p className="text-ink-3" style={{ fontSize: '11px' }}>
                                Visited {visitLabel}
                              </p>
                            )}
                          </div>
                          <div className={cn(
                            'flex-shrink-0 w-11 h-7 rounded-md flex items-center justify-center',
                            scoreChipBg(Number(r.score)),
                          )}>
                            <span
                              className="text-white tabular-nums"
                              style={{
                                fontFamily: '"Fraunces", "Noto Serif", serif',
                                fontSize: '13px',
                                fontWeight: 600,
                              }}
                            >
                              {Number(r.score).toFixed(1)}
                            </span>
                          </div>
                        </div>
                        {r.notes && (
                          <p
                            className="italic text-ink-2 mt-3 line-clamp-2"
                            style={{
                              fontFamily: '"Fraunces", "Noto Serif", serif',
                              fontSize: '14px',
                              lineHeight: 1.45,
                            }}
                          >
                            "{r.notes}"
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[14px] bg-paper border border-line px-4 py-6 text-center">
                  <Users size={20} className="mx-auto text-ink-4 mb-2" />
                  <p className="text-ink-3" style={{ fontSize: '13px' }}>
                    No friends have rated this yet
                  </p>
                  <button
                    type="button"
                    onClick={() => setChatShareTarget({
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
                    })}
                    className="mt-2 text-persimmon active:opacity-70 transition-opacity"
                    style={{ fontSize: '12px', fontWeight: 600 }}
                  >
                    Share with a friend
                  </button>
                </div>
              )}
            </section>
          );
        })()}

        {/* ── Hotel Dining — restaurants/bars/room service inside the
            hotel. Matches the page's section header pattern. ── */}
        {isHotel && (
          <section className="mb-10">
            <div className="flex items-end justify-between mb-4">
              <div>
                <p className="section-eyebrow mb-1">
                  Hotel Dining
                </p>
                <h2 className="text-[22px] font-serif font-bold text-on-surface leading-tight">
                  Eat and drink on site
                </h2>
              </div>
              {user?.id && (
                <button onClick={() => setAddDiningOpen(true)} className="text-[13px] font-medium text-accent active:opacity-70 transition-opacity flex-shrink-0">
                  + Add
                </button>
              )}
            </div>

            <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-3 -mx-1 px-1">
              {([{ value: 'all' as const, label: 'All' }, { value: 'restaurant' as const, label: 'Restaurants' }, { value: 'breakfast' as const, label: 'Breakfast' }, { value: 'bar' as const, label: 'Bars' }, { value: 'room_service' as const, label: 'Room Service' }, { value: 'pool_bar' as const, label: 'Pool Bar' }, { value: 'rooftop' as const, label: 'Rooftop' }] as const).map((f) => (
                <button key={f.value} onClick={() => setDiningFilter(f.value)}
                  className={cn('px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0',
                    diningFilter === f.value ? 'bg-primary text-white' : 'bg-transparent text-on-surface/50 hover:text-on-surface/70'
                  )}>
                  {f.label}
                </button>
              ))}
            </div>

            {hotelDiningOptions.length === 0 ? (
              <div className="rounded-2xl bg-paper border border-line py-8 text-center">
                <Building2 size={22} className="mx-auto text-on-surface/20 mb-2" />
                <p className="text-[13px] text-on-surface/45">No dining options added yet</p>
              </div>
            ) : (
              <ul className="rounded-2xl bg-paper border border-line divide-y divide-line overflow-hidden">
                {hotelDiningOptions
                  .filter((d) => diningFilter === 'all' || d.dining_type === diningFilter)
                  .map((d) => {
                    const score = diningRatings[d.restaurant_place_id];
                    return (
                      <li key={d.id}>
                        <button
                          type="button"
                          onClick={() => navigate(`/restaurant/${d.restaurant_place_id}`)}
                          className="w-full flex items-start justify-between gap-3 px-4 py-3.5 text-left active:bg-on-surface/[0.015] transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <h4 className="font-serif font-bold text-[15px] truncate">{d.restaurant_name}</h4>
                            <p className={cn(
                              'mt-0.5 text-[10px] font-bold uppercase tracking-[0.18em]',
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
                              'flex-shrink-0 w-11 h-7 rounded-md flex items-center justify-center',
                              score >= 8 ? 'bg-secondary' : score >= 5 ? 'bg-amber-600' : 'bg-red-500',
                            )}>
                              <span className="text-[13px] font-bold text-white tabular-nums">
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

        {/* ── My Rating Details — collapsible. Trigger is the MY RATING
            eyebrow row with a chevron; expanded content lists notes,
            tags, photos, and the editable facts (score, return, date,
            price, companions). Each sub-row deep-links into the rating
            modal at the matching sub-page. ── */}
        {myRating && place && (() => {
          const meta = { id: place.id, name: place.name, image: place.photoUrl || '', cuisine: isHotel ? 'Hotel Breakfast' : cuisine, price: isHotel ? '' : priceStr, address: place.fullAddress || place.address };
          type RatingPage = 'main' | 'notes' | 'tags' | 'photos' | 'price' | 'date' | 'friends';
          const openAt = (pg: RatingPage) => openAddRestaurantModal(meta, pg);
          const hasNotes = !!myRating.notes;
          const hasTags = (myRating.tags?.length || 0) > 0;
          const hasPhotos = (myRating.photos?.length || 0) > 0;
          const hasDate = !!myRating.visitDate;
          const hasPrice = !isHotel && !!myRating.price;
          const hasFriends = !isHotel && (myRating.friendIds?.length || 0) > 0;
          const dateLabel = hasDate ? new Date(myRating.visitDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null;
          return (
            <section ref={myRatingRef} className="mb-6 scroll-mt-4">
              <button
                onClick={() => setMyRatingOpen(!myRatingOpen)}
                className="w-full flex items-center justify-between py-2 text-left active:opacity-70 transition-opacity"
              >
                <span className="section-eyebrow">My Rating</span>
                <ChevronDown size={16} className={cn('text-ink-3 flex-shrink-0 transition-transform duration-200', myRatingOpen && 'rotate-180')} />
              </button>

              <AnimatePresence>
                {myRatingOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-3">
                      <div className="flex justify-end mb-3">
                        <button
                          onClick={() => openAt('main')}
                          className="flex items-center gap-1 text-persimmon active:opacity-70 transition-opacity"
                          style={{ fontSize: '13px', fontWeight: 600 }}
                        >
                          <Edit3 size={13} /> Edit
                        </button>
                      </div>

                      <div className="space-y-5">
                        {/* Notes */}
                        <div>
                          <button
                            onClick={() => openAt('notes')}
                            className="flex items-center gap-1.5 uppercase text-ink-2 active:opacity-60 transition-opacity"
                            style={{
                              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                              fontSize: '11px',
                              fontWeight: 700,
                              letterSpacing: '0.14em',
                            }}
                          >
                            <StickyNote size={13} />
                            <span>Notes</span>
                            <Edit3 size={11} className="text-ink-3 ml-0.5" />
                          </button>
                          {hasNotes ? (
                            <p
                              className="mt-2 italic text-ink-2 font-serif"
                              style={{ fontSize: '16px', lineHeight: 1.55 }}
                            >
                              "{myRating.notes}"
                            </p>
                          ) : (
                            <button
                              onClick={() => openAt('notes')}
                              className="mt-2 italic text-ink-3 active:text-ink-2 transition-colors"
                              style={{ fontSize: '14px' }}
                            >
                              Add notes…
                            </button>
                          )}
                        </div>

                        {/* Tags */}
                        <div>
                          <button
                            onClick={() => openAt('tags')}
                            className="flex items-center gap-1.5 uppercase text-ink-2 active:opacity-60 transition-opacity"
                            style={{
                              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                              fontSize: '11px',
                              fontWeight: 700,
                              letterSpacing: '0.14em',
                            }}
                          >
                            <Tag size={13} />
                            <span>Tags</span>
                            <Edit3 size={11} className="text-ink-3 ml-0.5" />
                          </button>
                          {hasTags ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {myRating.tags.map((t) => (
                                <span key={t} className="text-xs font-medium px-2.5 py-1 rounded-full bg-cream-2 text-ink-2">
                                  {t}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <button
                              onClick={() => openAt('tags')}
                              className="mt-2 block italic text-ink-3 active:text-ink-2 transition-colors"
                              style={{ fontSize: '14px' }}
                            >
                              Add tags…
                            </button>
                          )}
                        </div>

                        {/* Photos */}
                        <div>
                          <button
                            onClick={() => openAt('photos')}
                            className="flex items-center gap-1.5 uppercase text-ink-2 active:opacity-60 transition-opacity"
                            style={{
                              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                              fontSize: '11px',
                              fontWeight: 700,
                              letterSpacing: '0.14em',
                            }}
                          >
                            <Image size={13} />
                            <span>Photos</span>
                            <Edit3 size={11} className="text-ink-3 ml-0.5" />
                          </button>
                          {hasPhotos ? (
                            <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar -mx-3 px-3 snap-x snap-mandatory">
                              {myRating.photos.map((p, i) => (
                                <img
                                  key={i}
                                  src={p.url}
                                  className="w-24 h-24 rounded-xl object-cover flex-shrink-0 snap-start"
                                  referrerPolicy="no-referrer"
                                />
                              ))}
                            </div>
                          ) : (
                            <button
                              onClick={() => openAt('photos')}
                              className="mt-2 block italic text-ink-3 active:text-ink-2 transition-colors"
                              style={{ fontSize: '14px' }}
                            >
                              Add photos…
                            </button>
                          )}
                        </div>

                        {/* Visited date — matches the Notes/Tags/Photos layout */}
                        <div>
                          <button
                            onClick={() => openAt('date')}
                            className="flex items-center gap-1.5 uppercase text-ink-2 active:opacity-60 transition-opacity"
                            style={{
                              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                              fontSize: '11px',
                              fontWeight: 700,
                              letterSpacing: '0.14em',
                            }}
                          >
                            <CalendarDays size={13} />
                            <span>Visited</span>
                            <Edit3 size={11} className="text-ink-3 ml-0.5" />
                          </button>
                          {hasDate ? (
                            <p className="mt-2 text-ink font-medium" style={{ fontSize: '14px' }}>
                              {dateLabel}
                            </p>
                          ) : (
                            <button
                              onClick={() => openAt('date')}
                              className="mt-2 block italic text-ink-3 active:text-ink-2 transition-colors"
                              style={{ fontSize: '14px' }}
                            >
                              Add date…
                            </button>
                          )}
                        </div>

                        {/* Price (skip for hotels) */}
                        {!isHotel && (
                          <div>
                            <button
                              onClick={() => openAt('price')}
                              className="flex items-center gap-1.5 uppercase text-ink-2 active:opacity-60 transition-opacity"
                              style={{
                                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                                fontSize: '11px',
                                fontWeight: 700,
                                letterSpacing: '0.14em',
                              }}
                            >
                              <DollarSign size={13} />
                              <span>Price</span>
                              <Edit3 size={11} className="text-ink-3 ml-0.5" />
                            </button>
                            {hasPrice ? (
                              <p className="mt-2 text-ink font-medium tabular-nums" style={{ fontSize: '14px' }}>
                                {myRating.price}
                              </p>
                            ) : (
                              <button
                                onClick={() => openAt('price')}
                                className="mt-2 block italic text-ink-3 active:text-ink-2 transition-colors"
                                style={{ fontSize: '14px' }}
                              >
                                Add price…
                              </button>
                            )}
                          </div>
                        )}

                        {/* Friends / companions (skip for hotels) */}
                        {!isHotel && (
                          <div>
                            <button
                              onClick={() => openAt('friends')}
                              className="flex items-center gap-1.5 uppercase text-ink-2 active:opacity-60 transition-opacity"
                              style={{
                                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                                fontSize: '11px',
                                fontWeight: 700,
                                letterSpacing: '0.14em',
                              }}
                            >
                              <Users size={13} />
                              <span>With</span>
                              <Edit3 size={11} className="text-ink-3 ml-0.5" />
                            </button>
                            {hasFriends ? (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {myRating.friendIds.map((fid) => (
                                  <span key={fid} className="text-xs font-medium px-2.5 py-1 rounded-full bg-cream-2 text-ink-2">
                                    {friendNames[fid] || fid.slice(0, 8)}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <button
                                onClick={() => openAt('friends')}
                                className="mt-2 block italic text-ink-3 active:text-ink-2 transition-colors"
                                style={{ fontSize: '14px' }}
                              >
                                Add companions…
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          );
        })()}

        {/* ── Visit History Timeline — date-badge style.
            Each visit shows a MAR/4 date stack on the left with a
            score-colored left accent, the user's quoted notes and full
            date in the middle, and a score badge with an optional
            trend arrow on the right. Rows expand inline to reveal tags,
            photos, and would-return. ── */}
        {myRating && visitHistory.length > 0 && place && (() => {
          const scoreBadgeBg = (s: number) =>
            s >= 8 ? 'bg-secondary' : s >= 5 ? 'bg-amber-600' : 'bg-red-500';
          const scoreBorder = (s: number) =>
            s >= 8 ? 'border-l-green-500' : s >= 5 ? 'border-l-amber-500' : 'border-l-red-500';
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
            trend: 'up' | 'down' | 'same' | null;
            isCurrent: boolean;
          };

          const entries: Entry[] = [];
          // The active rating is a visit too — push it first, we'll
          // sort everything chronologically afterward so a backfilled
          // visit can legitimately outrank the current one.
          entries.push({
            id: 'current',
            score: myRating.score,
            date: parseDate(myRating.visitDate),
            notes: myRating.notes,
            tags: myRating.tags,
            photos: myRating.photos,
            wouldReturn: myRating.wouldReturn,
            trend: null,
            isCurrent: true,
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
              trend: null, // filled in below after sorting
              isCurrent: false,
            });
          });

          // Strictly sort by visit date DESC so the timeline is always
          // chronological even if a user backfilled an older visit
          // (getVisitHistory returns by created_at, not visit_date).
          entries.sort((a, b) => {
            const at = a.date ? a.date.getTime() : 0;
            const bt = b.date ? b.date.getTime() : 0;
            return bt - at;
          });

          // Recompute the trend now that entries are in chronological
          // order — each entry's trend compares it against the next
          // older one in the list.
          for (let i = 0; i < entries.length; i++) {
            const cur = entries[i];
            const older = entries[i + 1];
            if (!older) { cur.trend = null; continue; }
            const diff = cur.score - older.score;
            cur.trend = diff > 0.1 ? 'up' : diff < -0.1 ? 'down' : cur.isCurrent ? 'same' : null;
          }

          return (
            <section className="mb-6">
              <p className="section-eyebrow mb-4">Visit history</p>

              <ul className="divide-y divide-line">
                {entries.map((e) => {
                  const isExpanded = expandedVisit === e.id;
                  const month = e.date ? MONTHS[e.date.getMonth()].toUpperCase() : '—';
                  const day = e.date ? e.date.getDate() : '';
                  const fullDate = e.date
                    ? e.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'No date';
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => setExpandedVisit(isExpanded ? null : e.id)}
                        className="w-full flex items-center gap-3 py-3.5 text-left active:opacity-70 transition-opacity"
                      >
                        {/* Date badge — cream-2 fill, mono month above Fraunces day */}
                        <div className="flex-shrink-0 w-11 h-11 rounded-[10px] bg-cream-2 flex flex-col items-center justify-center">
                          <span
                            className="text-ink-3 leading-none"
                            style={{
                              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                              fontSize: '9px',
                              letterSpacing: '0.1em',
                            }}
                          >
                            {month}
                          </span>
                          <span
                            className="text-ink leading-none mt-1 tabular-nums"
                            style={{
                              fontFamily: '"Fraunces", "Noto Serif", serif',
                              fontSize: '16px',
                              fontWeight: 500,
                            }}
                          >
                            {day}
                          </span>
                        </div>

                        {/* Middle — italic Fraunces quote + muted date */}
                        <div className="flex-1 min-w-0">
                          {e.notes ? (
                            <p
                              className="italic text-ink-2 line-clamp-2"
                              style={{
                                fontFamily: '"Fraunces", "Noto Serif", serif',
                                fontSize: '12px',
                                lineHeight: 1.4,
                              }}
                            >
                              "{e.notes}"
                            </p>
                          ) : (
                            <p className="italic text-ink-4" style={{ fontSize: '12px' }}>No notes</p>
                          )}
                          <p className="text-ink-3 mt-0.5" style={{ fontSize: '11px' }}>
                            {fullDate}
                          </p>
                        </div>

                        {/* Score chip + optional olive trend arrow */}
                        <div className="flex-shrink-0 flex items-center gap-1">
                          <div className={cn(
                            'w-11 h-7 rounded-md flex items-center justify-center',
                            scoreBadgeBg(e.score),
                          )}>
                            <span
                              className="text-white tabular-nums"
                              style={{
                                fontFamily: '"Fraunces", "Noto Serif", serif',
                                fontSize: '13px',
                                fontWeight: 600,
                              }}
                            >
                              {e.score.toFixed(1)}
                            </span>
                          </div>
                          {e.trend === 'up' && (
                            <span className="text-olive leading-none" style={{ fontSize: '16px', fontWeight: 700 }}>↑</span>
                          )}
                          {e.trend === 'down' && (
                            <span className="text-clay leading-none" style={{ fontSize: '16px', fontWeight: 700 }}>↓</span>
                          )}
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
                            <div className="pb-4 pl-[calc(44px+0.75rem)] space-y-2.5">
                              {e.tags && e.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {e.tags.map((t) => (
                                    <span key={t} className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-cream-2 text-ink-2">{t}</span>
                                  ))}
                                </div>
                              )}
                              {e.photos && e.photos.length > 0 && (
                                <div className="flex gap-1.5 overflow-x-auto no-scrollbar snap-x snap-mandatory">
                                  {e.photos.slice(0, 6).map((p, i) => (
                                    <img key={i} src={p.url} className="w-16 h-16 rounded-lg object-cover flex-shrink-0 snap-start" referrerPolicy="no-referrer" />
                                  ))}
                                </div>
                              )}
                              {/* Delete — two-step confirmation so it's
                                  hard to nuke a visit by accident. */}
                              {confirmDeleteVisitId === e.id ? (
                                <div className="flex items-center justify-between gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                  <p className="text-xs font-medium text-red-700">
                                    Delete this visit?
                                  </p>
                                  <div className="flex gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteVisitId(null)}
                                      className="px-2.5 py-1 text-[11px] font-semibold text-ink-2 border border-line rounded-md bg-paper"
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
                                      className="px-2.5 py-1 text-[11px] font-semibold text-white bg-red-500 rounded-md"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteVisitId(e.id)}
                                  className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-red-500 active:opacity-70 transition-opacity"
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

        {/* ── Expert Picks — editorial list of authoritative reviews.
            Two-line header matches the rest of the page; each row has
            the expert's name, recommendation, and score. Hidden when
            there are no expert ratings. ── */}
        {expertRecommendations.length > 0 && (
          <section className="mb-10">
            <p className="section-eyebrow mb-1">
              Expert Picks
            </p>
            <h2 className="section-title mb-3">
              {expertRecommendations.length === 1 ? 'An expert weighed in' : `${expertRecommendations.length} experts weighed in`}
            </h2>
            <ul className="rounded-2xl bg-paper border border-line divide-y divide-line overflow-hidden">
              {expertRecommendations.map((rec) => {
                const isExpanded = expandedExpertId === rec.id;
                return (
                  <li key={rec.id}>
                    <button
                      onClick={() => setExpandedExpertId(isExpanded ? null : rec.id)}
                      className="w-full px-4 py-4 text-left active:bg-on-surface/[0.015] transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link
                              to={`/user/${rec.expert_username}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-[15px] font-serif font-bold text-on-surface hover:text-primary truncate"
                            >
                              {rec.expert_name}
                            </Link>
                            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-amber-600">Expert</span>
                          </div>
                          <p className={cn('text-[13px] mt-1 leading-relaxed text-on-surface/70', isExpanded ? '' : 'line-clamp-2')}>{rec.recommendation_text}</p>
                        </div>
                        <div className={cn(
                          'flex-shrink-0 w-11 h-7 rounded-md flex items-center justify-center',
                          Number(rec.rating) >= 8 ? 'bg-secondary' : Number(rec.rating) >= 5 ? 'bg-amber-600' : 'bg-red-500',
                        )}>
                          <span className="text-[13px] font-bold text-white tabular-nums">
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
                              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-600/70 mb-2">Highlight Dishes</p>
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

        {/* ── Featured In — horizontal strip of reels/posts that include
            this restaurant. Filler cards for now while reels populate;
            titles interpolate the restaurant name so the section reads
            as authored content rather than chrome. ── */}
        <RestaurantFeaturedReels
          restaurantId={place.id}
          restaurantName={place.name}
          size="md"
          className="mb-10"
        />

        {/* ── Hours — flat accordion on the page surface. Mono eyebrow,
            then a compact trigger row with today's status, expanding
            inline to a full-week list with the current day emphasized.
            No card wrapper — just hairline dividers. ── */}
        {place.hours.length > 0 && (
          <section className="mb-6">
            <p className="section-eyebrow mb-4">
              Hours
            </p>
            <button
              onClick={() => setHoursOpen(!hoursOpen)}
              className="w-full flex items-center gap-3 py-2 text-left active:opacity-70 transition-opacity"
            >
              <Clock size={16} className="text-ink-3 flex-shrink-0" />
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {place.isOpen !== null && (
                  <>
                    <span className={cn('inline-block w-1.5 h-1.5 rounded-full flex-shrink-0', place.isOpen ? 'bg-olive' : 'bg-clay')} />
                    <span
                      className={cn('font-semibold', place.isOpen ? 'text-olive' : 'text-clay')}
                      style={{ fontSize: '13px' }}
                    >
                      {place.isOpen ? 'Open' : 'Closed'}
                    </span>
                  </>
                )}
                <span className="text-ink-3 truncate" style={{ fontSize: '13px' }}>
                  · {getTodayHours(place.hours)}
                </span>
              </div>
              <ChevronDown size={15} className={cn('text-ink-3 flex-shrink-0 transition-transform duration-200', hoursOpen && 'rotate-180')} />
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
                  <ul className="pt-2 divide-y divide-line">
                    {place.hours.map((line, i) => {
                      const [day, ...timeParts] = line.split(': ');
                      const time = timeParts.join(': ');
                      const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                      const isToday = today.startsWith(day.toLowerCase().slice(0, 3));
                      return (
                        <li
                          key={i}
                          className={cn(
                            'flex justify-between items-baseline py-2.5',
                            isToday ? 'font-semibold text-ink' : 'text-ink-3',
                          )}
                          style={{ fontSize: '13px' }}
                        >
                          <span>{day}</span>
                          <span className="tabular-nums">{time}</span>
                        </li>
                      );
                    })}
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        )}

        {/* ── Flavor Profile — flat collapsible on the page surface.
            Trigger is a row with the JetBrains Mono label + chevron,
            matching Hours and My Rating. Hidden entirely for cuisines
            without a defined profile. ── */}
        {(() => {
          if (isHotel || !place) return null;
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
          const topFlavorNames = new Set(ranked.slice(0, 3).map((f) => f.subject));
          return (
            <section className="mb-6">
              <button
                onClick={() => setFlavorOpen(!flavorOpen)}
                className="w-full flex items-center justify-between py-2 text-left active:opacity-70 transition-opacity"
              >
                <span className="section-eyebrow">Flavor profile</span>
                <ChevronDown size={16} className={cn('text-ink-3 flex-shrink-0 transition-transform duration-200', flavorOpen && 'rotate-180')} />
              </button>
              <AnimatePresence>
                {flavorOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-4 pt-3">
                      <RadarChart
                        data={flavorData}
                        color="#e85a2c"
                        showLabels={false}
                        className="w-[104px] h-[104px] flex-shrink-0"
                      />
                      <ul
                        className="flex-1 min-w-0 space-y-1"
                        style={{
                          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                          fontSize: '12px',
                          lineHeight: 1.5,
                        }}
                      >
                        {ranked.map((f) => {
                          const pct = Math.round((f.value / f.fullMark) * 100);
                          const isTop = topFlavorNames.has(f.subject);
                          return (
                            <li key={f.subject} className="flex items-baseline gap-1.5">
                              <span className={cn('truncate', isTop ? 'font-semibold text-ink' : 'text-ink-3')}>
                                {f.subject}
                              </span>
                              <span className={cn('tabular-nums flex-shrink-0', isTop ? 'text-ink-2' : 'text-ink-3')}>
                                · {pct}%
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          );
        })()}

        {/* Location eyebrow sits inside the padded main; the map below
            breaks out of the page gutter to bleed edge-to-edge. */}
        <p className="section-eyebrow mb-3">Location</p>
      </main>

      {/* ── Map — full-bleed canvas flush with the page bottom. Address
          + Open in Maps sit as a compact pill overlay on top-right so
          the canvas itself truly extends to the very edge of the page.
          Inline width/height keep the Mapbox canvas full-sized; see
          Map.tsx for context. ── */}
      <section className="relative w-full h-[210px]">
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
          className="absolute inset-0 z-10 active:bg-on-surface/5 transition-colors"
        />
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute top-3 right-3 z-20 flex items-center gap-1 px-3 py-1.5 rounded-full bg-paper border border-line text-primary shadow-sm active:opacity-80 transition-opacity"
          style={{ fontSize: '12px', fontWeight: 600 }}
        >
          Open in Maps
          <ExternalLink size={12} />
        </a>
      </section>

      {/* Photo Gallery Bottom Sheet */}
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
      {/* Friends ratings detail sheet */}
      <AnimatePresence>
        {showFriendsDetail && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => setShowFriendsDetail(false)} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-3xl max-h-[85vh] flex flex-col overflow-hidden"
            >
              <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>
              <div className="flex items-center justify-between px-5 pt-2 pb-3 border-b border-on-surface/6 flex-shrink-0">
                <div>
                  <h3 className="font-serif font-bold text-lg">Friends' Ratings</h3>
                  <p className="text-xs text-on-surface/40">{place.name}</p>
                </div>
                <button onClick={() => setShowFriendsDetail(false)} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center">
                  <X size={16} className="text-on-surface/60" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {friendsStats.ratings.map((r) => {
                  return (
                    <div key={r.id} className="bg-white rounded-xl border border-on-surface/8 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                            <UserCircle size={14} className="text-primary/50" />
                          </div>
                          <span className="text-xs font-semibold text-on-surface/70">Friend</span>
                        </div>
                        <ScoreBadge rating={Number(r.score)} size="sm" />
                      </div>
                      {r.notes && <p className="text-[13px] text-on-surface/50 italic mt-1 leading-relaxed">"{r.notes}"</p>}
                      {r.tags && r.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {r.tags.map((t) => <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-primary/8 text-primary/60">{t}</span>)}
                        </div>
                      )}
                      {r.visit_date && <p className="text-[13px] text-on-surface/30 mt-1.5">{new Date(r.visit_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Unified share dialog — friends list, multi-select, auto-creates
          chats. Old "Send to Chat" inline sheet replaced by this. */}
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
