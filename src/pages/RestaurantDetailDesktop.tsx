import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Star, MapPin, Clock, Phone, Globe,
  ChevronLeft, ChevronRight, ChevronDown, Loader2,
  Navigation, ExternalLink, X, Users, UserCircle, Share2, Bookmark,
  DollarSign, CalendarDays, Tag, Image, Edit3, MessageCircle, Check, Send, Building2, TrendingUp, TrendingDown, StickyNote, ImageOff,
  Car, Footprints,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { scoreColor } from '../lib/score';
import { useRestaurantDetail, formatReviewCount, getTodayHours, getCuisineLabel } from './useRestaurantDetail';
import { useLists } from '../contexts/ListsContext';
import { useChat, type SharedRestaurant } from '../contexts/ChatContext';
import { useAuth } from '../contexts/AuthContext';
import { getProfilesByIds, getCommunityStats, type UserProfile as UP, type DiningType } from '../lib/supabase-community';
import { priceLevelToString } from '../lib/places';
import { loadLastSelectedLocation, isExactAddress } from '../components/HomeLocationBar';
import { haversineDistanceMi, formatDistance } from '../lib/distance';
import { useTravelTimes, formatTravelTime } from '../lib/directions';
import { AddHotelDiningModal } from '../components/AddHotelDiningModal';
import { PhotoGallery } from '../components/PhotoGallery';
import { Link } from 'react-router-dom';

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

  // Hours default to open — it's the most frequently checked info. Tracked
  // locally so the shared hook can keep its collapsed default elsewhere.
  const [hoursOpen, setHoursOpen] = useState(false);

  const { toggleWishlist, isWishlisted, getRating, openAddRestaurantModal } = useLists();
  const { conversations, sendMessage } = useChat();
  const { user } = useAuth();
  // Ref on the "My Rating Details" section so the Your Rating summary
  // card above can smooth-scroll down to it when tapped.
  const myRatingRef = useRef<HTMLElement | null>(null);
  const [expandedVisit, setExpandedVisit] = useState<string | null>(null);
  const [friendNames, setFriendNames] = useState<Record<string, string>>({});
  const [sendToChatOpen, setSendToChatOpen] = useState(false);
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
    <div className="pb-16 bg-surface min-h-screen">

      {/* ── Hero — wide cinematic banner ── */}
      <div className="relative w-full aspect-[16/9] max-h-[65vh] overflow-hidden">
        {photos.length > 0 ? (
          <button
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
        ) : (
          <div className="h-full w-full bg-muted flex flex-col items-center justify-center gap-2 text-on-surface/30">
            <ImageOff size={48} />
            <span className="text-xs font-bold uppercase tracking-[0.15em] text-on-surface/40">
              No photos added yet
            </span>
          </div>
        )}

        {/* Gradient — fades into page background */}
        <div
          className="absolute inset-x-0 bottom-0 h-2/5 pointer-events-none"
          style={{ background: 'linear-gradient(to top, #fff8f6 0%, #fff8f6 2%, rgba(255,248,246,0.85) 20%, rgba(255,248,246,0.4) 50%, transparent 100%)' }}
        />

        {/* Carousel arrows */}
        {photos.length > 1 && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setPhotoIndex((i) => (i - 1 + photos.length) % photos.length); }}
              className="absolute left-6 top-1/2 -translate-y-1/2 p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80 hover:bg-black/40 transition-colors z-10"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setPhotoIndex((i) => (i + 1) % photos.length); }}
              className="absolute right-6 top-1/2 -translate-y-1/2 p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80 hover:bg-black/40 transition-colors z-10"
            >
              <ChevronRight size={20} />
            </button>
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
              {photos.map((_, i) => (
                <button
                  key={i}
                  onClick={(e) => { e.stopPropagation(); setPhotoIndex(i); }}
                  className={`h-1.5 rounded-full transition-all ${i === photoIndex ? 'bg-on-surface/70 w-5' : 'bg-on-surface/20 w-1.5'}`}
                />
              ))}
            </div>
          </>
        )}

        {/* Back button */}
        <button
          onClick={() => navigate(-1)}
          className="absolute top-6 left-6 p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80 hover:bg-black/40 transition-colors z-10"
        >
          <ArrowLeft size={20} />
        </button>

        {/* Top-right actions — bookmark (wishlist) + share */}
        <div className="absolute top-6 right-6 flex items-center gap-2 z-10">
          <button
            onClick={() => {
              if (!place) return;
              toggleWishlist({
                id: place.id, name: place.name,
                image: place.photoUrl || '',
                cuisine, price: priceStr,
                address: place.address,
              });
            }}
            aria-label={place && isWishlisted(place.id) ? 'Remove from wishlist' : 'Save to wishlist'}
            className="p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80 hover:bg-black/40 transition-colors"
          >
            <Bookmark size={18} className={place && isWishlisted(place.id) ? 'fill-white text-white' : ''} />
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
            className="p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80 hover:bg-black/40 transition-colors"
          >
            <Share2 size={18} />
          </button>
        </div>
      </div>

      {/* ── Content — centered editorial column ──
          max-w-5xl (1024px) gives a comfortable reading/browsing
          width on 1440px+ monitors while still leaving generous
          whitespace flanking the content. The only elements that
          break out of this column are intentionally full-bleed
          (the hero banner above). Every section below inherits
          this width so nothing sprawls inconsistently. */}
      <main className="px-6 lg:px-8 pt-6 max-w-5xl mx-auto">

        {/* ── Name + metadata — large serif name on the left, prominent
            circular score badge floating on the right. Score shows the
            user's personal rating if present, otherwise the community
            average. ── */}
        {(() => {
          const badgeScore = myRating?.score ?? (communityStats.totalRatings > 0 ? communityStats.avgScore : null);
          const badgeIsPersonal = !!myRating;
          const badgeColor = badgeScore != null
            ? (badgeScore >= 8 ? 'bg-secondary' : badgeScore >= 5 ? 'bg-amber-600' : 'bg-red-500')
            : '';
          return (
            <section className="mb-7">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface/50 mb-2">
                {isHotel ? 'Hotel' : cuisine}
                {!isHotel && priceStr && <> · {priceStr}</>}
              </p>
              <div className="flex items-start gap-6">
                <div className="flex-1 min-w-0">
                  <h1 className="text-4xl lg:text-5xl font-serif font-bold text-on-surface leading-[1.05] tracking-tight">
                    {place.name}
                  </h1>
                  {(() => {
                    const dist = homeLocationForDistance && destForDistance
                      ? formatDistance(haversineDistanceMi(homeLocationForDistance.lat, homeLocationForDistance.lng, destForDistance.lat, destForDistance.lng))
                      : '';
                    return (
                      <p className="mt-3 text-sm text-on-surface/55 flex items-baseline gap-1.5 min-w-0 flex-wrap">
                        <span className="truncate">{place.address}</span>
                        {dist && (
                          <>
                            <span className="text-on-surface/30 flex-shrink-0">·</span>
                            <span className="flex-shrink-0">{dist}</span>
                          </>
                        )}
                        {driveLabel && (
                          <>
                            <span className="text-on-surface/30 flex-shrink-0">·</span>
                            <span className="inline-flex items-center gap-1.5 flex-shrink-0">
                              <Car size={14} className="text-on-surface/45" />
                              {driveLabel}
                            </span>
                          </>
                        )}
                        {walkLabel && (
                          <>
                            <span className="text-on-surface/30 flex-shrink-0">·</span>
                            <span className="inline-flex items-center gap-1.5 flex-shrink-0">
                              <Footprints size={14} className="text-on-surface/45" />
                              {walkLabel}
                            </span>
                          </>
                        )}
                      </p>
                    );
                  })()}
                  {place.isOpen !== null && (
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      <span className={cn('inline-block w-2 h-2 rounded-full', place.isOpen ? 'bg-green-500' : 'bg-red-500')} />
                      {place.isOpen ? (
                        <span className="text-on-surface/70">
                          <span className="font-semibold text-green-700">Open</span>
                          {(() => {
                            const line = getTodayHours(place.hours);
                            const close = line.split(/\s*[–-]\s*/)[1];
                            return close ? <span> · closes {close.trim()}</span> : null;
                          })()}
                        </span>
                      ) : (
                        <span className="text-on-surface/70">
                          <span className="font-semibold text-red-600">Closed</span>
                          {(() => {
                            const next = getNextOpenTime(place.hours);
                            return next ? <span> · opens {next}</span> : null;
                          })()}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {badgeScore != null && (
                  <div
                    className={cn(
                      'flex-shrink-0 w-20 h-20 rounded-full flex items-center justify-center shadow-sm',
                      badgeColor,
                    )}
                    aria-label={badgeIsPersonal ? `Your rating ${badgeScore.toFixed(1)}` : `Community rating ${badgeScore.toFixed(1)}`}
                  >
                    <span className="text-[28px] font-serif font-bold text-white tabular-nums leading-none">
                      {badgeScore.toFixed(1)}
                    </span>
                  </div>
                )}
              </div>
            </section>
          );
        })()}

        {/* ── Your Rating summary card — dark olive card with the user's
            score, visit count and a short notes snippet. Tapping scrolls
            to the full My Rating Details section below. If unrated, the
            same card becomes a warm "Rate this restaurant" call-to-action
            that opens the rating modal. ── */}
        <button
          type="button"
          onClick={() => {
            if (!place) return;
            if (myRating) {
              myRatingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
              openAddRestaurantModal({
                id: place.id, name: place.name,
                image: place.photoUrl || '',
                cuisine, price: priceStr,
                address: place.address,
              });
            }
          }}
          className="w-full mb-8 rounded-2xl px-5 py-4 flex items-center gap-4 text-left hover:brightness-110 transition-all"
          style={{ backgroundColor: '#2f3425' }}
        >
          {myRating ? (
            <>
              <div
                className={cn(
                  'flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center',
                  myRating.score >= 8 ? 'bg-[#d4a373]' : myRating.score >= 5 ? 'bg-amber-500' : 'bg-red-400',
                )}
              >
                <span className="text-base font-serif font-bold text-[#2f3425] tabular-nums leading-none">
                  {myRating.score.toFixed(1)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/55">
                  Your Rating · {visitCount + 1} {visitCount + 1 === 1 ? 'visit' : 'visits'}
                </p>
                {myRating.notes ? (
                  <p className="mt-0.5 text-[15px] italic font-serif text-white/90 truncate leading-snug">
                    "{myRating.notes}"
                  </p>
                ) : (
                  <p className="mt-0.5 text-sm text-white/60 italic leading-snug">
                    Tap to see your full review
                  </p>
                )}
              </div>
              <ChevronRight size={20} className="text-white/55 flex-shrink-0" />
            </>
          ) : (
            <>
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-[#d4a373]/90 flex items-center justify-center">
                <Star size={20} className="text-[#2f3425]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/55">
                  Rate this restaurant
                </p>
                <p className="mt-0.5 text-[15px] font-serif text-white/90 leading-snug">
                  Log your visit and score
                </p>
              </div>
              <ChevronRight size={20} className="text-white/55 flex-shrink-0" />
            </>
          )}
        </button>

        {/* ── Action row — Call, Route, Web, Share.
            Circular outlined icon buttons, Apple-Maps-style. Muted when
            the underlying data isn't available. ── */}
        <div className="grid grid-cols-4 gap-4 mb-10 max-w-md">
          {place.phone ? (
            <a
              href={`tel:${place.phone}`}
              className="flex flex-col items-center gap-2 hover:opacity-70 transition-opacity"
            >
              <span className="w-14 h-14 rounded-full border border-on-surface/15 flex items-center justify-center">
                <Phone size={20} className="text-on-surface" />
              </span>
              <span className="text-xs font-medium text-on-surface/75">Call</span>
            </a>
          ) : (
            <div className="flex flex-col items-center gap-2 opacity-35">
              <span className="w-14 h-14 rounded-full border border-on-surface/15 flex items-center justify-center">
                <Phone size={20} className="text-on-surface" />
              </span>
              <span className="text-xs font-medium text-on-surface">Call</span>
            </div>
          )}
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-2 hover:opacity-70 transition-opacity"
          >
            <span className="w-14 h-14 rounded-full border border-on-surface/15 flex items-center justify-center">
              <Navigation size={20} className="text-on-surface" />
            </span>
            <span className="text-xs font-medium text-on-surface/75">Route</span>
          </a>
          {place.website ? (
            <a
              href={place.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-2 hover:opacity-70 transition-opacity"
            >
              <span className="w-14 h-14 rounded-full border border-on-surface/15 flex items-center justify-center">
                <Globe size={20} className="text-on-surface" />
              </span>
              <span className="text-xs font-medium text-on-surface/75">Web</span>
            </a>
          ) : (
            <div className="flex flex-col items-center gap-2 opacity-35">
              <span className="w-14 h-14 rounded-full border border-on-surface/15 flex items-center justify-center">
                <Globe size={20} className="text-on-surface" />
              </span>
              <span className="text-xs font-medium text-on-surface">Web</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setSendToChatOpen(true)}
            className="flex flex-col items-center gap-2 hover:opacity-70 transition-opacity"
          >
            <span className="w-14 h-14 rounded-full border border-on-surface/15 flex items-center justify-center">
              <Send size={20} className="text-on-surface" />
            </span>
            <span className="text-xs font-medium text-on-surface/75">Share</span>
          </button>
        </div>

        {/* ── The Community Says — three clean score boxes side-by-side:
            EVERYONE, FRIENDS, EXPERTS. Each box has a warm surface,
            subtle border, color-coded serif score, and a rating count.
            Google gets a single muted note below the row, not its own
            box. ── */}
        {(() => {
          const expertAvg = expertRecommendations.length > 0
            ? expertRecommendations.reduce((sum, r) => sum + Number(r.rating), 0) / expertRecommendations.length
            : 0;
          const expertCount = expertRecommendations.length;
          const hasCommunity = communityStats.totalRatings > 0;
          const hasFriends = !isHotel && friendsStats.totalRatings > 0;
          const hasExperts = expertCount > 0;
          const hasGoogle = Number(place.rating) > 0 && place.userRatingCount > 0;

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
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface/50 mb-3">
                  {label}
                </p>
                {score != null ? (
                  <>
                    <p className={cn('text-[44px] font-serif font-bold leading-none tabular-nums', scoreColor(score))}>
                      {score.toFixed(1)}
                    </p>
                    <p className="mt-2 text-sm text-on-surface/55">
                      {count.toLocaleString()} {countLabel}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[44px] font-serif font-bold leading-none text-on-surface/15 tabular-nums">—</p>
                    <p className="mt-2 text-sm italic text-on-surface/40 leading-snug">
                      {emptyCopy}
                    </p>
                  </>
                )}
              </>
            );
            const classes = 'rounded-2xl bg-white/60 border border-on-surface/10 px-5 py-5 text-left';
            return onClick ? (
              <button type="button" onClick={onClick} className={cn(classes, 'hover:bg-white transition-colors')}>
                {body}
              </button>
            ) : (
              <div className={classes}>{body}</div>
            );
          };

          return (
            <section className="mb-12">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1.5">
                The Community Says
              </p>
              <h2 className="text-[28px] font-serif font-bold text-on-surface leading-tight mb-5">
                {!hasCommunity && !hasFriends && !hasExperts ? 'No ratings yet' : 'Scores across your network'}
              </h2>

              <div className={cn('grid gap-4', isHotel ? 'grid-cols-1' : 'grid-cols-3')}>
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
                <p className="mt-4 text-sm text-on-surface/40">
                  <span className="text-on-surface/50">Google:</span>{' '}
                  <span className="tabular-nums font-medium text-on-surface/60">{place.rating}</span>
                  <span className="ml-1 text-on-surface/35">({formatReviewCount(place.userRatingCount)} reviews)</span>
                </p>
              )}
            </section>
          );
        })()}

        {/* ── Flavor Profile — radar chart on the left, ranked flavor
            list on the right. Hidden entirely for cuisines we don't
            have a profile for so we don't fabricate taste data. ── */}
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
            <section className="mb-12">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1.5">
                Flavor Profile
              </p>
              <h2 className="text-[28px] font-serif font-bold text-on-surface leading-tight mb-5">
                What people taste here
              </h2>
              <div className="rounded-2xl bg-white/60 border border-on-surface/10 px-6 py-6">
                <div className="flex items-center gap-8">
                  <RadarChart
                    data={flavorData}
                    color="#9f3012"
                    showLabels={false}
                    className="w-56 h-56 flex-shrink-0"
                  />
                  <ul className="flex-1 min-w-0 space-y-2">
                    {ranked.map((f) => {
                      const pct = Math.round((f.value / f.fullMark) * 100);
                      const isTop = topFlavorNames.has(f.subject);
                      return (
                        <li
                          key={f.subject}
                          className={cn(
                            'flex items-baseline justify-between gap-3',
                            isTop ? 'text-base font-bold text-on-surface' : 'text-sm text-on-surface/55',
                          )}
                        >
                          <span className="truncate">{f.subject}</span>
                          <span className="tabular-nums flex-shrink-0">{pct}%</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </section>
          );
        })()}

        {/* ── Your Circle — inline friend reviews as cards. Up to three
            shown directly on the page; "See all" opens the full friend
            ratings modal. Tapping a card navigates to the review
            detail page. ── */}
        {!isHotel && (() => {
          const hasFriends = friendsStats.ratings.length > 0;
          const topFriends = friendsStats.ratings.slice(0, 3);
          return (
            <section className="mb-12">
              <div className="flex items-end justify-between mb-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1.5">
                    Your Circle
                  </p>
                  <h2 className="text-[28px] font-serif font-bold text-on-surface leading-tight">
                    {hasFriends
                      ? `${friendsStats.totalRatings} friend${friendsStats.totalRatings === 1 ? '' : 's'} rated here`
                      : 'No friends yet'}
                  </h2>
                </div>
                {hasFriends && friendsStats.ratings.length > topFriends.length && (
                  <button
                    type="button"
                    onClick={() => setShowFriendsDetail(true)}
                    className="text-sm font-medium text-accent hover:opacity-70 transition-opacity flex-shrink-0"
                  >
                    See all
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
                        className="rounded-2xl bg-white/60 border border-on-surface/10 px-4 py-4 text-left hover:bg-white transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-base font-serif font-bold text-primary">{initial}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-base font-bold text-on-surface truncate">{name}</p>
                            {visitLabel && (
                              <p className="text-xs text-on-surface/50">
                                Visited {visitLabel}
                              </p>
                            )}
                          </div>
                          <div className={cn(
                            'flex-shrink-0 w-12 h-8 rounded-md flex items-center justify-center',
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
                <div className="rounded-2xl bg-white/60 border border-on-surface/10 px-6 py-8 text-center">
                  <Users size={22} className="mx-auto text-on-surface/25 mb-2" />
                  <p className="text-sm text-on-surface/55">
                    No friends have rated this yet
                  </p>
                  <button
                    type="button"
                    onClick={() => setSendToChatOpen(true)}
                    className="mt-2 text-sm font-semibold text-primary hover:opacity-70 transition-opacity"
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
          <section className="mb-12">
            <div className="flex items-end justify-between mb-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1.5">
                  Hotel Dining
                </p>
                <h2 className="text-[28px] font-serif font-bold text-on-surface leading-tight">
                  Eat and drink on site
                </h2>
              </div>
              {user?.id && (
                <button onClick={() => setAddDiningOpen(true)} className="text-sm font-medium text-accent hover:opacity-70 transition-opacity flex-shrink-0">
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
              <div className="rounded-2xl bg-white/60 border border-on-surface/10 py-10 text-center">
                <Building2 size={24} className="mx-auto text-on-surface/20 mb-2" />
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
                              'flex-shrink-0 w-14 h-9 rounded-md flex items-center justify-center',
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



        {/* ── My Rating Details — quiet editorial summary with ambient
            inline edit affordances. Each subsection heading carries a
            tiny muted pencil that deep-links the add-rating modal
            straight to the matching sub-page. Empty subsections render
            a subtle "Add …" prompt rather than disappearing, so users
            can fill in any field without leaving this section. */}
        {myRating && place && (() => {
          const meta = { id: place.id, name: place.name, image: place.photoUrl || '', cuisine: isHotel ? 'Hotel Breakfast' : cuisine, price: isHotel ? '' : priceStr, address: place.address };
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
            <section ref={myRatingRef} className="mb-12 scroll-mt-4">
              <div className="flex items-end justify-between mb-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1.5">
                    My Rating
                  </p>
                  <h2 className="text-[28px] font-serif font-bold text-on-surface leading-tight">
                    Your take on it
                  </h2>
                </div>
                <button
                  onClick={() => openAt('main')}
                  className="flex items-center gap-1 text-sm font-medium text-accent hover:opacity-70 transition-opacity flex-shrink-0"
                >
                  <Edit3 size={14} /> Edit
                </button>
              </div>

              <div className="space-y-6">
                {/* Notes */}
                <div>
                  <button
                    onClick={() => openAt('notes')}
                    className="group flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-on-surface/45 hover:text-on-surface/60 transition-colors"
                  >
                    <StickyNote size={13} />
                    <span>Notes</span>
                    <Edit3 size={10} className="text-on-surface/25 group-hover:text-on-surface/50 ml-0.5 transition-colors" />
                  </button>
                  {hasNotes ? (
                    <p className="mt-2 text-lg leading-relaxed italic text-on-surface/80 font-serif">
                      "{myRating.notes}"
                    </p>
                  ) : (
                    <button
                      onClick={() => openAt('notes')}
                      className="mt-2 text-sm italic text-on-surface/30 hover:text-on-surface/60 transition-colors"
                    >
                      Add notes…
                    </button>
                  )}
                </div>

                {/* Tags */}
                <div>
                  <button
                    onClick={() => openAt('tags')}
                    className="group flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.15em] text-on-surface/40 hover:text-on-surface/60 transition-colors"
                  >
                    <Tag size={13} />
                    <span>Tags</span>
                    <Edit3 size={10} className="text-on-surface/25 group-hover:text-on-surface/50 ml-0.5 transition-colors" />
                  </button>
                  {hasTags ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {myRating.tags.map((t) => (
                        <span key={t} className="text-xs font-medium px-3 py-1 rounded-full bg-primary/8 text-primary/80">
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <button
                      onClick={() => openAt('tags')}
                      className="mt-2 block text-sm italic text-on-surface/30 hover:text-on-surface/60 transition-colors"
                    >
                      Add tags…
                    </button>
                  )}
                </div>

                {/* Photos */}
                <div>
                  <button
                    onClick={() => openAt('photos')}
                    className="group flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.15em] text-on-surface/40 hover:text-on-surface/60 transition-colors"
                  >
                    <Image size={13} />
                    <span>Photos</span>
                    <Edit3 size={10} className="text-on-surface/25 group-hover:text-on-surface/50 ml-0.5 transition-colors" />
                  </button>
                  {hasPhotos ? (
                    <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory">
                      {myRating.photos.map((p, i) => (
                        <img
                          key={i}
                          src={p.url}
                          className="w-28 h-28 rounded-xl object-cover flex-shrink-0 snap-start"
                          referrerPolicy="no-referrer"
                        />
                      ))}
                    </div>
                  ) : (
                    <button
                      onClick={() => openAt('photos')}
                      className="mt-2 block text-sm italic text-on-surface/30 hover:text-on-surface/60 transition-colors"
                    >
                      Add photos…
                    </button>
                  )}
                </div>

                {/* Facts list — each row is its own tappable edit affordance */}
                <ul className="border-t border-on-surface/[0.06] pt-5 space-y-3">
                  {/* Score */}
                  <li>
                    <button
                      onClick={() => openAt('main')}
                      className="group flex items-center gap-3 w-full text-left text-sm hover:opacity-80 transition-opacity"
                    >
                      <Star size={15} className="text-on-surface/35 flex-shrink-0" />
                      <span className="text-on-surface/45 w-20 flex-shrink-0">Score</span>
                      <span className="text-on-surface/75 flex-1 tabular-nums">{myRating.score.toFixed(1)} <span className="text-on-surface/35">/ 10</span></span>
                      <Edit3 size={10} className="text-on-surface/20 group-hover:text-on-surface/45 flex-shrink-0 transition-colors" />
                    </button>
                  </li>

                  {/* Visited date */}
                  <li>
                    <button
                      onClick={() => openAt('date')}
                      className="group flex items-center gap-3 w-full text-left text-sm hover:opacity-80 transition-opacity"
                    >
                      <CalendarDays size={15} className="text-on-surface/35 flex-shrink-0" />
                      <span className="text-on-surface/45 w-20 flex-shrink-0">Visited</span>
                      <span className={cn("flex-1", hasDate ? "text-on-surface/75" : "text-on-surface/30 italic")}>
                        {hasDate ? dateLabel : 'Add date…'}
                      </span>
                      <Edit3 size={10} className="text-on-surface/20 group-hover:text-on-surface/45 flex-shrink-0 transition-colors" />
                    </button>
                  </li>

                  {/* Price (skip for hotels) */}
                  {!isHotel && (
                    <li>
                      <button
                        onClick={() => openAt('price')}
                        className="group flex items-center gap-3 w-full text-left text-sm hover:opacity-80 transition-opacity"
                      >
                        <DollarSign size={15} className="text-on-surface/35 flex-shrink-0" />
                        <span className="text-on-surface/45 w-20 flex-shrink-0">Price</span>
                        <span className={cn("flex-1", hasPrice ? "text-on-surface/75" : "text-on-surface/30 italic")}>
                          {hasPrice ? myRating.price : 'Add price…'}
                        </span>
                        <Edit3 size={10} className="text-on-surface/20 group-hover:text-on-surface/45 flex-shrink-0 transition-colors" />
                      </button>
                    </li>
                  )}

                  {/* Friends / companions (skip for hotels) */}
                  {!isHotel && (
                    <li>
                      <button
                        onClick={() => openAt('friends')}
                        className="group flex items-start gap-3 w-full text-left text-sm hover:opacity-80 transition-opacity"
                      >
                        <Users size={15} className="text-on-surface/35 flex-shrink-0 mt-0.5" />
                        <span className="text-on-surface/45 w-20 flex-shrink-0 pt-0.5">With</span>
                        <span className="flex-1">
                          {hasFriends ? (
                            <span className="flex flex-wrap gap-1.5">
                              {myRating.friendIds.map((fid) => (
                                <span key={fid} className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-primary/8 text-primary/80">
                                  {friendNames[fid] || fid.slice(0, 8)}
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span className="text-on-surface/30 italic">Add companions…</span>
                          )}
                        </span>
                        <Edit3 size={10} className="text-on-surface/20 group-hover:text-on-surface/45 flex-shrink-0 mt-1 transition-colors" />
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            </section>
          );
        })()}

        {/* ── Visit History Timeline — date-badge style. Each visit
            shows a MAR/4 date stack on the left with a score-colored
            left accent, the user's quoted notes and full date in the
            middle, and a score badge with an optional trend arrow on
            the right. Rows expand inline to reveal tags, photos, and
            would-return. ── */}
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

          // Strictly sort by visit date DESC so the timeline stays
          // chronological even when a user backfills an older visit.
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
            <section className="mb-12">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1.5">
                Visit History
              </p>
              <h2 className="text-[28px] font-serif font-bold text-on-surface leading-tight mb-5">
                Your {entries.length} {entries.length === 1 ? 'visit' : 'visits'}
              </h2>

              <ul className="rounded-2xl bg-white/60 border border-on-surface/10 divide-y divide-on-surface/[0.06] overflow-hidden">
                {entries.map((e) => {
                  const isExpanded = expandedVisit === e.id;
                  const month = e.date ? MONTHS[e.date.getMonth()] : '—';
                  const day = e.date ? e.date.getDate() : '';
                  const fullDate = e.date
                    ? e.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                    : 'No date';
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => setExpandedVisit(isExpanded ? null : e.id)}
                        className="w-full flex items-stretch text-left hover:bg-on-surface/[0.015] transition-colors"
                      >
                        <div className={cn(
                          'flex-shrink-0 w-[72px] border-l-[3px] flex flex-col items-center justify-center py-4',
                          scoreBorder(e.score),
                        )}>
                          <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface/55 leading-none">
                            {month}
                          </span>
                          <span className="text-[32px] font-serif font-bold text-on-surface leading-none mt-1 tabular-nums">
                            {day}
                          </span>
                        </div>

                        <div className="flex-1 min-w-0 px-5 py-4">
                          {e.notes ? (
                            <p className="text-base italic font-serif text-on-surface/80 leading-snug line-clamp-2">
                              "{e.notes}"
                            </p>
                          ) : (
                            <p className="text-sm italic text-on-surface/35">No notes</p>
                          )}
                          <p className="mt-1 text-[12px] text-on-surface/45">
                            {fullDate}
                          </p>
                        </div>

                        <div className="flex-shrink-0 px-5 py-4 flex items-center gap-2">
                          {e.trend === 'up' && <TrendingUp size={15} className="text-green-600" />}
                          {e.trend === 'down' && <TrendingDown size={15} className="text-red-500" />}
                          <div className={cn(
                            'w-14 h-9 rounded-md flex items-center justify-center',
                            scoreBadgeBg(e.score),
                          )}>
                            <span className="text-sm font-bold text-white tabular-nums">
                              {e.score.toFixed(1)}
                            </span>
                          </div>
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
                            <div className="px-5 pb-4 pl-[calc(72px+3px+1.25rem)] space-y-3">
                              {e.tags && e.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {e.tags.map((t) => (
                                    <span key={t} className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-primary/8 text-primary/75">{t}</span>
                                  ))}
                                </div>
                              )}
                              {e.photos && e.photos.length > 0 && (
                                <div className="flex gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory">
                                  {e.photos.slice(0, 8).map((p, i) => (
                                    <img key={i} src={p.url} className="w-24 h-24 rounded-lg object-cover flex-shrink-0 snap-start" referrerPolicy="no-referrer" />
                                  ))}
                                </div>
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
          <section className="mb-12">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1.5">
              Expert Picks
            </p>
            <h2 className="text-[28px] font-serif font-bold text-on-surface leading-tight mb-5">
              {expertRecommendations.length === 1 ? 'An expert weighed in' : `${expertRecommendations.length} experts weighed in`}
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
                            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-amber-600">Expert</span>
                          </div>
                          <p className={cn('text-sm mt-1.5 leading-relaxed text-on-surface/70', isExpanded ? '' : 'line-clamp-2')}>{rec.recommendation_text}</p>
                        </div>
                        <div className={cn(
                          'flex-shrink-0 w-14 h-9 rounded-md flex items-center justify-center',
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
                              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-600/70 mb-2">Highlight Dishes</p>
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

        {/* ── Hours — accordion inside a subtle container. ── */}
        {place.hours.length > 0 && (
          <section className="mb-12">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1.5">
              Hours
            </p>
            <h2 className="text-[28px] font-serif font-bold text-on-surface leading-tight mb-5">
              When they're open
            </h2>
            <div className="rounded-2xl bg-white/60 border border-on-surface/10 overflow-hidden">
              <button
                onClick={() => setHoursOpen(!hoursOpen)}
                className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-on-surface/[0.015] transition-colors"
              >
                <Clock size={18} className="text-on-surface/40 flex-shrink-0" />
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {place.isOpen !== null && (
                    <>
                      <span className={cn('inline-block w-2 h-2 rounded-full flex-shrink-0', place.isOpen ? 'bg-green-500' : 'bg-red-500')} />
                      <span className={cn(
                        'text-sm font-semibold',
                        place.isOpen ? 'text-green-700' : 'text-red-600',
                      )}>
                        {place.isOpen ? 'Open' : 'Closed'}
                      </span>
                    </>
                  )}
                  <span className="text-sm text-on-surface/55 truncate">· {getTodayHours(place.hours)}</span>
                </div>
                <ChevronDown size={16} className={cn('text-on-surface/30 flex-shrink-0 transition-transform duration-200', hoursOpen && 'rotate-180')} />
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
                    <div className="px-5 pb-5 pt-1 space-y-2 border-t border-on-surface/[0.06]">
                      {place.hours.map((line, i) => {
                        const [day, ...timeParts] = line.split(': ');
                        const time = timeParts.join(': ');
                        const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                        const isToday = today.startsWith(day.toLowerCase().slice(0, 3));
                        return (
                          <div key={i} className={cn('flex justify-between text-sm pt-2', isToday ? 'font-semibold text-on-surface' : 'text-on-surface/50')}>
                            <span>{day}</span>
                            <span className="tabular-nums">{time}</span>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>
        )}

        {/* ── Contact & Address — quiet, functional. Muted icon + text
            rows in a subtle container, not competing for attention. ── */}
        <section className="mb-12">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1.5">
            Contact
          </p>
          <h2 className="text-[28px] font-serif font-bold text-on-surface leading-tight mb-5">
            Get in touch
          </h2>
          <ul className="rounded-2xl bg-white/60 border border-on-surface/10 divide-y divide-on-surface/[0.06] overflow-hidden">
            {place.phone && (
              <li>
                <a href={`tel:${place.phone}`} className="flex items-center gap-3 px-5 py-4 hover:bg-on-surface/[0.015] transition-colors">
                  <Phone size={18} className="text-on-surface/45 flex-shrink-0" />
                  <span className="text-sm text-on-surface/75 flex-1 tabular-nums">{place.phone}</span>
                </a>
              </li>
            )}
            {place.website && (
              <li>
                <a href={place.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-5 py-4 hover:bg-on-surface/[0.015] transition-colors">
                  <Globe size={18} className="text-on-surface/45 flex-shrink-0" />
                  <span className="text-sm text-on-surface/75 flex-1 truncate">{place.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
                  <ExternalLink size={13} className="text-on-surface/30 flex-shrink-0" />
                </a>
              </li>
            )}
            <li>
              <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-5 py-4 hover:bg-on-surface/[0.015] transition-colors">
                <MapPin size={18} className="text-on-surface/45 flex-shrink-0" />
                <span className="text-sm text-on-surface/75 flex-1">{place.address}</span>
                <Navigation size={14} className="text-primary flex-shrink-0" />
              </a>
            </li>
          </ul>
        </section>

        {/* ── Map — rounded container with caption below. A transparent
            overlay button catches taps and routes to /map with the
            restaurant focused. Inline width/height keep the Mapbox
            canvas full-sized; see Map.tsx for context. ── */}
        <section className="mb-12">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1.5">
            Location
          </p>
          <h2 className="text-[28px] font-serif font-bold text-on-surface leading-tight mb-5">
            Where to find it
          </h2>
          <div className="rounded-2xl overflow-hidden border border-on-surface/10">
            {/* h-96 (384px) gives a comfortable aspect ratio on desktop
                while staying shorter than the old 448px to leave room
                for other sections in view. */}
            <div className="relative w-full h-96">
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
                      address: place.address,
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
            </div>
            <div className="px-5 py-3 flex items-center justify-between gap-3 bg-white/60 border-t border-on-surface/[0.06]">
              <p className="text-sm text-on-surface/55 truncate flex-1">{place.address}</p>
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm font-semibold text-primary flex-shrink-0"
              >
                Open in Maps
                <ExternalLink size={13} />
              </a>
            </div>
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
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => setShowFriendsDetail(false)} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-3xl max-h-[70vh] flex flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-on-surface/6 flex-shrink-0">
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
                    <div key={r.id} className="bg-white rounded-xl border border-on-surface/8 p-4">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <UserCircle size={16} className="text-primary/50" />
                          </div>
                          <span className="text-sm font-semibold text-on-surface/70">Friend</span>
                        </div>
                        <span className={cn("text-xl font-serif font-bold", scoreColor(Number(r.score)))}>{Number(r.score).toFixed(1)}</span>
                      </div>
                      {r.notes && <p className="text-[13px] text-on-surface/50 italic mt-2 leading-relaxed">"{r.notes}"</p>}
                      {r.tags && r.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {r.tags.map((t) => <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-primary/8 text-primary/60">{t}</span>)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Send to Chat Sheet ── */}
      <AnimatePresence>
        {sendToChatOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[70]" onClick={() => setSendToChatOpen(false)} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-[70] bg-surface rounded-t-3xl flex flex-col overflow-hidden max-h-[60vh]"
            >
              <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-on-surface/6 flex-shrink-0">
                <h3 className="font-serif font-bold text-lg">Send to Chat</h3>
                <button onClick={() => setSendToChatOpen(false)} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center">
                  <X size={16} className="text-on-surface/60" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 pb-5">
                {conversations.length === 0 ? (
                  <div className="text-center py-12">
                    <MessageCircle size={28} className="mx-auto text-on-surface/15 mb-2" />
                    <p className="text-sm text-on-surface/35">No conversations yet</p>
                    <button onClick={() => { setSendToChatOpen(false); navigate('/messages'); }}
                      className="mt-3 text-primary text-xs font-semibold">Go to Messages</button>
                  </div>
                ) : (
                  <div className="space-y-1 pt-2">
                    <div className="flex gap-2 mb-3">
                      <span className="text-xs font-bold uppercase tracking-widest text-on-surface/35 self-center">Sharing:</span>
                      <span className="text-[13px] font-semibold text-on-surface/60 truncate">{place.name}</span>
                      {myRating && <span className="text-xs text-green-500 font-semibold self-center">+ Your Review</span>}
                    </div>
                    {conversations.map((conv) => (
                      <button key={conv.id}
                        onClick={() => {
                          const shared: SharedRestaurant = {
                            restaurantId: place.id,
                            name: place.name,
                            image: place.photoUrl || '',
                            cuisine,
                            price: priceStr,
                            address: place.address,
                            ...(myRating ? {
                              score: myRating.score,
                              notes: myRating.notes,
                              wouldReturn: myRating.wouldReturn,
                              tags: myRating.tags,
                              isReview: true,
                            } : { isReview: false }),
                          };
                          sendMessage(conv.id, '', shared);
                          setChatSent(true);
                          setTimeout(() => { setChatSent(false); setSendToChatOpen(false); }, 1200);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-on-surface/3 transition-colors text-left">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          {conv.isGroup
                            ? <Users size={14} className="text-primary" />
                            : <span className="text-sm font-bold text-primary">{(conv.name || 'C').charAt(0).toUpperCase()}</span>
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-on-surface/70 truncate">{conv.name || 'Direct Message'}</p>
                        </div>
                        <Send size={14} className="text-on-surface/25" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <AnimatePresence>
                {chatSent && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-surface/95 flex flex-col items-center justify-center rounded-t-3xl">
                    <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mb-3">
                      <Check size={28} className="text-green-500" />
                    </div>
                    <p className="text-sm font-semibold text-on-surface/70">Sent!</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </>
        )}
      </AnimatePresence>

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
