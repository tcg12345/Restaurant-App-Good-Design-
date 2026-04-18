import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Star, MapPin, Clock, Phone, Globe,
  ChevronLeft, ChevronRight, ChevronDown, Loader2,
  Navigation, ExternalLink, X, Users, UserCircle, Share2, Heart, Bookmark,
  DollarSign, CalendarDays, Tag, Image, Edit3, MessageCircle, Check, Send, Building2, TrendingUp, TrendingDown, StickyNote,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { scoreColor } from '../lib/score';
import { useRestaurantDetail, formatReviewCount, getTodayHours, getCuisineLabel } from './useRestaurantDetail';
import { useLists } from '../contexts/ListsContext';
import { useChat, type SharedRestaurant } from '../contexts/ChatContext';
import { useAuth } from '../contexts/AuthContext';
import { getProfilesByIds, getCommunityStats, type UserProfile as UP, type DiningType } from '../lib/supabase-community';
import { priceLevelToString } from '../lib/places';
import { Link } from 'react-router-dom';
import { AddHotelDiningModal } from '../components/AddHotelDiningModal';
import { PhotoGallery } from '../components/PhotoGallery';

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

  const { openWishlistModal, isWishlisted, getRating, openAddRestaurantModal, removeFromWishlist } = useLists();
  const { conversations, sendMessage } = useChat();
  const { user } = useAuth();
  // Hours expanded by default — it's the most frequently checked info,
  // so show it open without a tap. Local state so we don't mutate the
  // shared hook default.
  const [hoursOpen, setHoursOpen] = useState(false);
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
    <div className="pb-32 bg-surface min-h-screen">

      {/* ── Hero — full-bleed image. Shorter than before (52vh) because
          the name + metadata moved out of the overlay and down onto
          the page surface. The dark gradient stays at the bottom for
          a gentle fade, but nothing sits on top of it except the
          carousel dots. ── */}
      <div className="relative w-full overflow-hidden" style={{ height: '52vh', maxHeight: '60vh' }}>
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
          <div className="absolute inset-0 w-full h-full bg-muted flex items-center justify-center">
            <MapPin size={64} className="text-on-surface/20" />
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

        {/* Back button */}
        <button
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80 z-10"
        >
          <ArrowLeft size={18} />
        </button>

        {/* Top-right actions — bookmark (wishlist) + share */}
        <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
          <button
            onClick={() => {
              if (!place) return;
              if (isWishlisted(place.id)) {
                removeFromWishlist(place.id);
              } else {
                openWishlistModal({
                  id: place.id, name: place.name,
                  image: place.photoUrl || '',
                  cuisine, price: priceStr,
                  address: place.address,
                });
              }
            }}
            aria-label={place && isWishlisted(place.id) ? 'Remove from wishlist' : 'Save to wishlist'}
            className="p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80"
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
            className="p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80"
          >
            <Share2 size={16} />
          </button>
        </div>
      </div>

      {/* ── Main Content ── */}
      <main className="px-0 pt-5">

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
              <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-on-surface/55 mb-2.5">
                {isHotel ? 'Hotel' : cuisine}
                {!isHotel && priceStr && <> · {priceStr}</>}
              </p>
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <h1 className="font-display text-[40px] font-bold text-on-surface leading-[1] tracking-[-0.01em]">
                    {place.name}
                  </h1>
                  <p className="mt-3 text-[14px] text-on-surface/60 truncate">
                    {place.address}
                  </p>
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
          className="w-full mb-6 rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left active:scale-[0.99] transition-transform"
          style={{ backgroundColor: '#2f3425' }}
        >
          {myRating ? (
            <>
              <div
                className={cn(
                  'flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center',
                  myRating.score >= 8 ? 'bg-[#d4a373]' : myRating.score >= 5 ? 'bg-amber-500' : 'bg-red-400',
                )}
              >
                <span className="text-[15px] font-serif font-bold text-[#2f3425] tabular-nums leading-none">
                  {myRating.score.toFixed(1)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">
                  Your Rating · {visitCount + 1} {visitCount + 1 === 1 ? 'visit' : 'visits'}
                </p>
                {myRating.notes ? (
                  <p className="mt-0.5 text-[14px] italic font-serif text-white/90 line-clamp-1 leading-snug">
                    "{myRating.notes}"
                  </p>
                ) : (
                  <p className="mt-0.5 text-[13px] text-white/60 italic leading-snug">
                    Tap to see your full review
                  </p>
                )}
              </div>
              <ChevronRight size={18} className="text-white/55 flex-shrink-0" />
            </>
          ) : (
            <>
              <div className="flex-shrink-0 w-11 h-11 rounded-full bg-[#d4a373]/90 flex items-center justify-center">
                <Star size={18} className="text-[#2f3425]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">
                  Rate this restaurant
                </p>
                <p className="mt-0.5 text-[14px] font-serif text-white/90 leading-snug">
                  Log your visit and score
                </p>
              </div>
              <ChevronRight size={18} className="text-white/55 flex-shrink-0" />
            </>
          )}
        </button>

        {/* ── Action row — Call, Route, Web, Share.
            Circular outlined icon buttons, Apple-Maps-style. Muted when
            the underlying data isn't available. ── */}
        <div className="grid grid-cols-4 gap-2 mb-8">
          {place.phone ? (
            <a
              href={`tel:${place.phone}`}
              className="flex flex-col items-center gap-2 active:opacity-70 transition-opacity"
            >
              <span className="w-12 h-12 rounded-full border border-on-surface/15 flex items-center justify-center">
                <Phone size={18} className="text-on-surface" />
              </span>
              <span className="text-[11px] font-medium text-on-surface/75">Call</span>
            </a>
          ) : (
            <div className="flex flex-col items-center gap-2 opacity-35">
              <span className="w-12 h-12 rounded-full border border-on-surface/15 flex items-center justify-center">
                <Phone size={18} className="text-on-surface" />
              </span>
              <span className="text-[11px] font-medium text-on-surface">Call</span>
            </div>
          )}
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-2 active:opacity-70 transition-opacity"
          >
            <span className="w-12 h-12 rounded-full border border-on-surface/15 flex items-center justify-center">
              <Navigation size={18} className="text-on-surface" />
            </span>
            <span className="text-[11px] font-medium text-on-surface/75">Route</span>
          </a>
          {place.website ? (
            <a
              href={place.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-2 active:opacity-70 transition-opacity"
            >
              <span className="w-12 h-12 rounded-full border border-on-surface/15 flex items-center justify-center">
                <Globe size={18} className="text-on-surface" />
              </span>
              <span className="text-[11px] font-medium text-on-surface/75">Web</span>
            </a>
          ) : (
            <div className="flex flex-col items-center gap-2 opacity-35">
              <span className="w-12 h-12 rounded-full border border-on-surface/15 flex items-center justify-center">
                <Globe size={18} className="text-on-surface" />
              </span>
              <span className="text-[11px] font-medium text-on-surface">Web</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setSendToChatOpen(true)}
            className="flex flex-col items-center gap-2 active:opacity-70 transition-opacity"
          >
            <span className="w-12 h-12 rounded-full border border-on-surface/15 flex items-center justify-center">
              <Send size={18} className="text-on-surface" />
            </span>
            <span className="text-[11px] font-medium text-on-surface/75">Share</span>
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

          // Shared renderer for a single score box
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
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/50 mb-2">
                  {label}
                </p>
                {score != null ? (
                  <>
                    <p className={cn('text-[28px] font-serif font-bold leading-none tabular-nums', scoreColor(score))}>
                      {score.toFixed(1)}
                    </p>
                    <p className="mt-1.5 text-[11px] text-on-surface/55">
                      {count.toLocaleString()} {countLabel}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[28px] font-serif font-bold leading-none text-on-surface/15 tabular-nums">—</p>
                    <p className="mt-1.5 text-[11px] italic text-on-surface/40 leading-snug">
                      {emptyCopy}
                    </p>
                  </>
                )}
              </>
            );
            const classes = 'rounded-2xl bg-white/60 border border-on-surface/10 px-3 py-3.5 text-left';
            return onClick ? (
              <button type="button" onClick={onClick} className={cn(classes, 'active:scale-[0.98] transition-transform')}>
                {body}
              </button>
            ) : (
              <div className={classes}>{body}</div>
            );
          };

          return (
            <section className="mb-10">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1">
                The Community Says
              </p>
              <h2 className="text-[22px] font-serif font-bold text-on-surface leading-tight mb-4">
                {!hasCommunity && !hasFriends && !hasExperts ? 'No ratings yet' : 'Scores across your network'}
              </h2>

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
                <p className="mt-3 text-[12px] text-on-surface/40">
                  <span className="text-on-surface/50">Google:</span>{' '}
                  <span className="tabular-nums font-medium text-on-surface/60">{place.rating}</span>
                  <span className="ml-1 text-on-surface/35">({formatReviewCount(place.userRatingCount)} reviews)</span>
                </p>
              )}
            </section>
          );
        })()}

        {/* ── Flavor Profile — radar chart on the left, ranked flavor
            list on the right. Top flavors are bold with larger type;
            the rest trail off in a muted line. Hidden entirely for
            cuisines we don't have a profile for. ── */}
        {(() => {
          if (isHotel || !place) return null;
          // Only render when the cuisine maps to a known profile so we
          // don't fabricate taste data for unknown categories.
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
            <section className="mb-10">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1">
                Flavor Profile
              </p>
              <h2 className="text-[22px] font-serif font-bold text-on-surface leading-tight mb-4">
                What people taste here
              </h2>
              <div className="rounded-2xl bg-white/60 border border-on-surface/10 px-4 py-4">
                <div className="flex items-center gap-4">
                  <RadarChart
                    data={flavorData}
                    color="#9f3012"
                    showLabels={false}
                    className="w-32 h-32 flex-shrink-0"
                  />
                  <ul className="flex-1 min-w-0 space-y-1.5">
                    {ranked.map((f) => {
                      const pct = Math.round((f.value / f.fullMark) * 100);
                      const isTop = topFlavorNames.has(f.subject);
                      return (
                        <li
                          key={f.subject}
                          className={cn(
                            'flex items-baseline justify-between gap-2',
                            isTop ? 'text-[14px] font-bold text-on-surface' : 'text-[12px] text-on-surface/55',
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
            are shown directly on the page; "See all" opens the full
            friend ratings bottom sheet. Tapping a card navigates to
            the review detail page. ── */}
        {!isHotel && (() => {
          const hasFriends = friendsStats.ratings.length > 0;
          const topFriends = friendsStats.ratings.slice(0, 3);
          return (
            <section className="mb-10">
              <div className="flex items-end justify-between mb-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1">
                    Your Circle
                  </p>
                  <h2 className="text-[22px] font-serif font-bold text-on-surface leading-tight">
                    {hasFriends
                      ? `${friendsStats.totalRatings} friend${friendsStats.totalRatings === 1 ? '' : 's'} rated here`
                      : 'No friends yet'}
                  </h2>
                </div>
                {hasFriends && friendsStats.ratings.length > topFriends.length && (
                  <button
                    type="button"
                    onClick={() => setShowFriendsDetail(true)}
                    className="text-[13px] font-medium text-accent active:opacity-70 transition-opacity flex-shrink-0"
                  >
                    See all
                  </button>
                )}
              </div>

              {hasFriends ? (
                <div className="space-y-2.5">
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
                        className="w-full rounded-2xl bg-white/60 border border-on-surface/10 px-3.5 py-3 text-left active:scale-[0.99] transition-transform"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-sm font-serif font-bold text-primary">{initial}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-bold text-on-surface truncate">{name}</p>
                            {visitLabel && (
                              <p className="text-[11px] text-on-surface/50">
                                Visited {visitLabel}
                              </p>
                            )}
                          </div>
                          <div className={cn(
                            'flex-shrink-0 w-11 h-7 rounded-md flex items-center justify-center',
                            Number(r.score) >= 8 ? 'bg-secondary' : Number(r.score) >= 5 ? 'bg-amber-600' : 'bg-red-500',
                          )}>
                            <span className="text-[13px] font-bold text-white tabular-nums">
                              {Number(r.score).toFixed(1)}
                            </span>
                          </div>
                        </div>
                        {r.notes && (
                          <p className="mt-2 text-[13px] italic font-serif text-on-surface/70 leading-snug line-clamp-2">
                            "{r.notes}"
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl bg-white/60 border border-on-surface/10 px-4 py-6 text-center">
                  <Users size={20} className="mx-auto text-on-surface/25 mb-2" />
                  <p className="text-[13px] text-on-surface/55">
                    No friends have rated this yet
                  </p>
                  <button
                    type="button"
                    onClick={() => setSendToChatOpen(true)}
                    className="mt-2 text-[12px] font-semibold text-primary active:opacity-70 transition-opacity"
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
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1">
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
              <div className="rounded-2xl bg-white/60 border border-on-surface/10 py-8 text-center">
                <Building2 size={22} className="mx-auto text-on-surface/20 mb-2" />
                <p className="text-[13px] text-on-surface/45">No dining options added yet</p>
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
            <section ref={myRatingRef} className="mb-10 scroll-mt-4">
              <div className="flex items-end justify-between mb-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1">
                    My Rating
                  </p>
                  <h2 className="text-[22px] font-serif font-bold text-on-surface leading-tight">
                    Your take on it
                  </h2>
                </div>
                <button
                  onClick={() => openAt('main')}
                  className="flex items-center gap-1 text-[13px] font-medium text-accent active:opacity-70 transition-opacity flex-shrink-0"
                >
                  <Edit3 size={13} /> Edit
                </button>
              </div>

              <div className="space-y-5">
                {/* Notes */}
                <div>
                  <button
                    onClick={() => openAt('notes')}
                    className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/45 active:opacity-60 transition-opacity"
                  >
                    <StickyNote size={12} />
                    <span>Notes</span>
                    <Edit3 size={10} className="text-on-surface/25 ml-0.5" />
                  </button>
                  {hasNotes ? (
                    <p className="mt-2 text-[16px] leading-relaxed italic text-on-surface/80 font-serif">
                      "{myRating.notes}"
                    </p>
                  ) : (
                    <button
                      onClick={() => openAt('notes')}
                      className="mt-2 text-[13px] italic text-on-surface/30 active:text-on-surface/60 transition-colors"
                    >
                      Add notes…
                    </button>
                  )}
                </div>

                {/* Tags */}
                <div>
                  <button
                    onClick={() => openAt('tags')}
                    className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.15em] text-on-surface/40 active:opacity-60 transition-opacity"
                  >
                    <Tag size={12} />
                    <span>Tags</span>
                    <Edit3 size={10} className="text-on-surface/25 group-hover:text-on-surface/50 ml-0.5 transition-colors" />
                  </button>
                  {hasTags ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {myRating.tags.map((t) => (
                        <span key={t} className="text-xs font-medium px-2.5 py-1 rounded-full bg-primary/8 text-primary/80">
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <button
                      onClick={() => openAt('tags')}
                      className="mt-2 block text-[13px] italic text-on-surface/30 active:text-on-surface/60 transition-colors"
                    >
                      Add tags…
                    </button>
                  )}
                </div>

                {/* Photos */}
                <div>
                  <button
                    onClick={() => openAt('photos')}
                    className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.15em] text-on-surface/40 active:opacity-60 transition-opacity"
                  >
                    <Image size={12} />
                    <span>Photos</span>
                    <Edit3 size={10} className="text-on-surface/25 group-hover:text-on-surface/50 ml-0.5 transition-colors" />
                  </button>
                  {hasPhotos ? (
                    <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory">
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
                      className="mt-2 block text-[13px] italic text-on-surface/30 active:text-on-surface/60 transition-colors"
                    >
                      Add photos…
                    </button>
                  )}
                </div>

                {/* Facts list — each row is its own tappable edit affordance */}
                <ul className="border-t border-on-surface/[0.06] pt-4 space-y-2.5">
                  {/* Score */}
                  <li>
                    <button
                      onClick={() => openAt('main')}
                      className="flex items-center gap-3 w-full text-left text-[13px] active:opacity-60 transition-opacity"
                    >
                      <Star size={14} className="text-on-surface/35 flex-shrink-0" />
                      <span className="text-on-surface/45 w-16 flex-shrink-0">Score</span>
                      <span className="text-on-surface/75 flex-1 tabular-nums">{myRating.score.toFixed(1)} <span className="text-on-surface/35">/ 10</span></span>
                      <Edit3 size={10} className="text-on-surface/20 group-hover:text-on-surface/45 flex-shrink-0 transition-colors" />
                    </button>
                  </li>

                  {/* Would return */}
                  <li>
                    <button
                      onClick={() => openAt('main')}
                      className="flex items-center gap-3 w-full text-left text-[13px] active:opacity-60 transition-opacity"
                    >
                      <Heart size={14} className="text-on-surface/35 flex-shrink-0" />
                      <span className="text-on-surface/45 w-16 flex-shrink-0">Return?</span>
                      <span className="text-on-surface/75 flex-1">{myRating.wouldReturn ? 'Yes' : 'Nah'}</span>
                      <Edit3 size={10} className="text-on-surface/20 group-hover:text-on-surface/45 flex-shrink-0 transition-colors" />
                    </button>
                  </li>

                  {/* Visited date */}
                  <li>
                    <button
                      onClick={() => openAt('date')}
                      className="flex items-center gap-3 w-full text-left text-[13px] active:opacity-60 transition-opacity"
                    >
                      <CalendarDays size={14} className="text-on-surface/35 flex-shrink-0" />
                      <span className="text-on-surface/45 w-16 flex-shrink-0">Visited</span>
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
                        className="flex items-center gap-3 w-full text-left text-[13px] active:opacity-60 transition-opacity"
                      >
                        <DollarSign size={14} className="text-on-surface/35 flex-shrink-0" />
                        <span className="text-on-surface/45 w-16 flex-shrink-0">Price</span>
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
                        className="flex items-start gap-3 w-full text-left text-[13px] active:opacity-60 transition-opacity"
                      >
                        <Users size={14} className="text-on-surface/35 flex-shrink-0 mt-0.5" />
                        <span className="text-on-surface/45 w-16 flex-shrink-0 pt-0.5">With</span>
                        <span className="flex-1">
                          {hasFriends ? (
                            <span className="flex flex-wrap gap-1.5">
                              {myRating.friendIds.map((fid) => (
                                <span key={fid} className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/8 text-primary/80">
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
          // The active rating is the most recent visit, so it leads the
          // timeline. Its trend compares against the newest historical
          // visit below it.
          const curDate = parseDate(myRating.visitDate);
          const prevFromCurrent = visitHistory[0];
          const curTrend: Entry['trend'] = prevFromCurrent
            ? (myRating.score - prevFromCurrent.score > 0.1 ? 'up'
              : myRating.score - prevFromCurrent.score < -0.1 ? 'down' : 'same')
            : null;
          entries.push({
            id: 'current',
            score: myRating.score,
            date: curDate,
            notes: myRating.notes,
            tags: myRating.tags,
            photos: myRating.photos,
            wouldReturn: myRating.wouldReturn,
            trend: curTrend,
            isCurrent: true,
          });
          visitHistory.forEach((v, idx) => {
            const nextOlder = visitHistory[idx + 1];
            const trend: Entry['trend'] = nextOlder
              ? (v.score - nextOlder.score > 0.1 ? 'up'
                : v.score - nextOlder.score < -0.1 ? 'down' : null)
              : null;
            entries.push({
              id: v.id,
              score: v.score,
              date: parseDate(v.visit_date),
              notes: v.notes,
              tags: v.tags,
              photos: v.photos,
              wouldReturn: v.would_return,
              trend,
              isCurrent: false,
            });
          });

          return (
            <section className="mb-10">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1">
                Visit History
              </p>
              <h2 className="text-[22px] font-serif font-bold text-on-surface leading-tight mb-4">
                Your {entries.length} {entries.length === 1 ? 'visit' : 'visits'}
              </h2>

              <ul className="rounded-2xl bg-white/60 border border-on-surface/10 divide-y divide-on-surface/[0.06] overflow-hidden">
                {entries.map((e) => {
                  const isExpanded = expandedVisit === e.id;
                  const month = e.date ? MONTHS[e.date.getMonth()] : '—';
                  const day = e.date ? e.date.getDate() : '';
                  const fullDate = e.date
                    ? e.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'No date';
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => setExpandedVisit(isExpanded ? null : e.id)}
                        className="w-full flex items-stretch text-left active:bg-on-surface/[0.015] transition-colors"
                      >
                        {/* Date badge with score-colored left accent */}
                        <div className={cn(
                          'flex-shrink-0 w-[60px] border-l-[3px] flex flex-col items-center justify-center py-3',
                          scoreBorder(e.score),
                        )}>
                          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface/55 leading-none">
                            {month}
                          </span>
                          <span className="text-[26px] font-serif font-bold text-on-surface leading-none mt-1 tabular-nums">
                            {day}
                          </span>
                        </div>

                        {/* Middle column — notes + date */}
                        <div className="flex-1 min-w-0 px-3 py-3">
                          {e.notes ? (
                            <p className="text-[14px] italic font-serif text-on-surface/80 leading-snug line-clamp-2">
                              "{e.notes}"
                            </p>
                          ) : (
                            <p className="text-[13px] italic text-on-surface/35">No notes</p>
                          )}
                          <p className="mt-1 text-[11px] text-on-surface/45">
                            {fullDate}
                          </p>
                        </div>

                        {/* Score + trend on the right */}
                        <div className="flex-shrink-0 px-3 py-3 flex items-center gap-1.5">
                          {e.trend === 'up' && <TrendingUp size={13} className="text-green-600" />}
                          {e.trend === 'down' && <TrendingDown size={13} className="text-red-500" />}
                          <div className={cn(
                            'w-11 h-7 rounded-md flex items-center justify-center',
                            scoreBadgeBg(e.score),
                          )}>
                            <span className="text-[13px] font-bold text-white tabular-nums">
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
                            <div className="px-4 pb-4 pl-[calc(60px+3px+1rem)] space-y-2.5">
                              {e.tags && e.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {e.tags.map((t) => (
                                    <span key={t} className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-primary/8 text-primary/75">{t}</span>
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
                              {e.wouldReturn !== undefined && (
                                <p className="text-xs font-semibold">
                                  {e.wouldReturn
                                    ? <span className="text-green-600">Would return</span>
                                    : <span className="text-red-500">Wouldn't return</span>}
                                </p>
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
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1">
              Expert Picks
            </p>
            <h2 className="text-[22px] font-serif font-bold text-on-surface leading-tight mb-4">
              {expertRecommendations.length === 1 ? 'An expert weighed in' : `${expertRecommendations.length} experts weighed in`}
            </h2>
            <ul className="rounded-2xl bg-white/60 border border-on-surface/10 divide-y divide-on-surface/[0.06] overflow-hidden">
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

        {/* ── Hours — accordion inside a subtle container.
            The trigger shows today's status (colored dot + Open/Closed)
            and today's hours; expanded state lists every day with the
            current day emphasized. ── */}
        {place.hours.length > 0 && (
          <section className="mb-10">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1">
              Hours
            </p>
            <h2 className="text-[22px] font-serif font-bold text-on-surface leading-tight mb-4">
              When they're open
            </h2>
            <div className="rounded-2xl bg-white/60 border border-on-surface/10 overflow-hidden">
              <button
                onClick={() => setHoursOpen(!hoursOpen)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-on-surface/[0.015] transition-colors"
              >
                <Clock size={16} className="text-on-surface/40 flex-shrink-0" />
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {place.isOpen !== null && (
                    <>
                      <span className={cn('inline-block w-1.5 h-1.5 rounded-full flex-shrink-0', place.isOpen ? 'bg-green-500' : 'bg-red-500')} />
                      <span className={cn(
                        'text-[13px] font-semibold',
                        place.isOpen ? 'text-green-700' : 'text-red-600',
                      )}>
                        {place.isOpen ? 'Open' : 'Closed'}
                      </span>
                    </>
                  )}
                  <span className="text-[13px] text-on-surface/55 truncate">· {getTodayHours(place.hours)}</span>
                </div>
                <ChevronDown size={15} className={cn('text-on-surface/30 flex-shrink-0 transition-transform duration-200', hoursOpen && 'rotate-180')} />
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
                    <div className="px-4 pb-4 pt-1 space-y-2 border-t border-on-surface/[0.06]">
                      {place.hours.map((line, i) => {
                        const [day, ...timeParts] = line.split(': ');
                        const time = timeParts.join(': ');
                        const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                        const isToday = today.startsWith(day.toLowerCase().slice(0, 3));
                        return (
                          <div key={i} className={cn('flex justify-between text-[13px] pt-2', isToday ? 'font-semibold text-on-surface' : 'text-on-surface/50')}>
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
        <section className="mb-10">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1">
            Contact
          </p>
          <h2 className="text-[22px] font-serif font-bold text-on-surface leading-tight mb-4">
            Get in touch
          </h2>
          <ul className="rounded-2xl bg-white/60 border border-on-surface/10 divide-y divide-on-surface/[0.06] overflow-hidden">
            {place.phone && (
              <li>
                <a href={`tel:${place.phone}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-on-surface/[0.015] transition-colors">
                  <Phone size={16} className="text-on-surface/45 flex-shrink-0" />
                  <span className="text-[13px] text-on-surface/75 flex-1 tabular-nums">{place.phone}</span>
                </a>
              </li>
            )}
            {place.website && (
              <li>
                <a href={place.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3.5 active:bg-on-surface/[0.015] transition-colors">
                  <Globe size={16} className="text-on-surface/45 flex-shrink-0" />
                  <span className="text-[13px] text-on-surface/75 flex-1 truncate">{place.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
                  <ExternalLink size={12} className="text-on-surface/30 flex-shrink-0" />
                </a>
              </li>
            )}
            <li>
              <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3.5 active:bg-on-surface/[0.015] transition-colors">
                <MapPin size={16} className="text-on-surface/45 flex-shrink-0" />
                <span className="text-[13px] text-on-surface/75 flex-1">{place.address}</span>
                <Navigation size={13} className="text-primary flex-shrink-0" />
              </a>
            </li>
          </ul>
        </section>

        {/* ── Map — rounded container with caption below. A transparent
            overlay button catches taps and routes to /map with the
            restaurant focused. Inline width/height keep the Mapbox
            canvas full-sized; see Map.tsx for context. ── */}
        <section className="mb-10">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1">
            Location
          </p>
          <h2 className="text-[22px] font-serif font-bold text-on-surface leading-tight mb-4">
            Where to find it
          </h2>
          <div className="rounded-2xl overflow-hidden border border-on-surface/10">
            <div className="relative w-full h-60">
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
                className="absolute inset-0 z-10 active:bg-on-surface/5 transition-colors"
              />
            </div>
            <div className="px-4 py-3 flex items-center justify-between gap-3 bg-white/60 border-t border-on-surface/[0.06]">
              <p className="text-[13px] text-on-surface/55 truncate flex-1">{place.address}</p>
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[12px] font-semibold text-primary flex-shrink-0"
              >
                Open in Maps
                <ExternalLink size={12} />
              </a>
            </div>
          </div>
        </section>
      </main>

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
                        <span className={cn("text-lg font-serif font-bold", scoreColor(Number(r.score)))}>{Number(r.score).toFixed(1)}</span>
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
              <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>
              <div className="flex items-center justify-between px-5 pt-2 pb-3 border-b border-on-surface/6 flex-shrink-0">
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
                    <p className="text-xs text-on-surface/25 mt-1">Start a chat from the Messages page first</p>
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
                          <p className="text-[13px] text-on-surface/35">{conv.participantIds.length} participant{conv.participantIds.length !== 1 ? 's' : ''}</p>
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
