import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Star, MapPin, Clock, Phone, Globe,
  ChevronLeft, ChevronRight, ChevronDown, Loader2,
  Navigation, ExternalLink, X, Users, UserCircle, Share2, Bookmark,
  DollarSign, CalendarDays, Tag, Image, Edit3, MessageCircle, Check, Send, Building2, TrendingUp, TrendingDown, StickyNote, Trash2, ImageOff,
  Car, Footprints, Award, Images, Plus, Heart,
} from 'lucide-react';
import { cn, parseVisitDate } from '../lib/utils';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { scoreColor } from '../lib/score';
import { ScoreBadge } from '../components/ScoreBadge';
import { useRestaurantDetail, formatReviewCount, getTodayHours, getCuisineLabel } from './useRestaurantDetail';
import { MichelinBadge } from '../components/MichelinBadge';
import { useLists } from '../contexts/ListsContext';
import { useChat, type SharedRestaurant } from '../contexts/ChatContext';
import { ShareDialog } from '../components/ShareDialog';
import { useAuth } from '../contexts/AuthContext';
import { useSignInModal } from '../contexts/SignInModalContext';
import { getProfilesByIds, getCommunityStats, getLikesForRatings, toggleLike, type UserProfile as UP } from '../lib/supabase-community';
import { priceLevelToString } from '../lib/places';
import { loadLastSelectedLocation, isExactAddress } from '../components/HomeLocationBar';
import { haversineDistanceMi, formatDistance } from '../lib/distance';
import { useTravelTimes, formatTravelTime } from '../lib/directions';
import { openExternalUrl } from '../lib/external-links';
import { Link } from 'react-router-dom';
import { PhotoGallery } from '../components/PhotoGallery';
import { RestaurantFeaturedReels } from '../components/RestaurantFeaturedReels';
import { useBottomSheet } from '../lib/useBottomSheet';
import { getNextOpenLabel, restaurantLocalNow } from '../lib/hours';
import { RadarChart } from '../components/RadarChart';
import { getFlavorProfile } from '../lib/flavorProfile';

/** Short "last week / last month" style recency label. */
function timeAgo(date: string): string {
  const d = parseVisitDate(date);
  if (!d) return '';
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
    priceStr, cuisine, michelin,
    photos, directionsUrl, mapsUrl,
    communityStats, friendsStats, communityPhotos, expertRecommendations,
    showFriendsDetail, setShowFriendsDetail,
    visitHistory, visitCount,
  } = useRestaurantDetail();

  const { toggleWishlist, isWishlisted, getRating, openAddRestaurantModal, deleteVisit } = useLists();
  const { dragProps: friendsDetailDragProps } = useBottomSheet(showFriendsDetail, () => setShowFriendsDetail(false));

  // Swipe the hero to step through photos — a finger-following slide over a
  // 3-photo window (prev / current / next) that snaps on release. The hero
  // gets `touch-action: pan-y` so the browser hands us horizontal drags while
  // keeping vertical scroll for the page; that also stops iOS from turning a
  // horizontal drag into a `touchcancel` mid-gesture.
  const heroRef = useRef<HTMLDivElement>(null);
  const trackTransition = 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)';
  const [heroDragX, setHeroDragX] = useState(0);
  const [heroAnimating, setHeroAnimating] = useState(false);
  const heroG = useRef({ x: 0, y: 0, dragging: false, decided: false, horizontal: false, moved: false, swiped: false, busy: false });

  const heroWidth = () => heroRef.current?.clientWidth || window.innerWidth;

  // Animate one step, then commit the index and reset the offset in the same
  // frame — the slide ends with the next/prev photo already centered, so the
  // reset is visually a no-op.
  const heroSlide = (dir: 1 | -1) => {
    if (heroG.current.busy || photos.length < 2) return;
    heroG.current.busy = true;
    setHeroAnimating(true);
    setHeroDragX(dir === 1 ? -heroWidth() : heroWidth());
    window.setTimeout(() => {
      setPhotoIndex((i) => (dir === 1 ? (i + 1) % photos.length : (i - 1 + photos.length) % photos.length));
      setHeroAnimating(false);
      setHeroDragX(0);
      heroG.current.busy = false;
    }, 320);
  };

  const onHeroTouchStart = (e: React.TouchEvent) => {
    if (heroG.current.busy) return;
    const t = e.touches[0];
    heroG.current = { x: t.clientX, y: t.clientY, dragging: true, decided: false, horizontal: false, moved: false, swiped: false, busy: false };
  };
  const onHeroTouchMove = (e: React.TouchEvent) => {
    const g = heroG.current;
    if (!g.dragging || g.busy || photos.length < 2) return;
    const dx = e.touches[0].clientX - g.x;
    const dy = e.touches[0].clientY - g.y;
    if (!g.decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      g.decided = true;
      g.horizontal = Math.abs(dx) > Math.abs(dy);
    }
    if (!g.horizontal) return; // vertical → let the page scroll
    g.moved = true;
    setHeroDragX(Math.max(-heroWidth(), Math.min(heroWidth(), dx)));
  };
  const onHeroTouchEnd = (e: React.TouchEvent) => {
    const g = heroG.current;
    if (!g.dragging) return;
    g.dragging = false;
    if (g.busy) return;
    g.swiped = g.horizontal && g.moved; // any horizontal drag suppresses the tap-to-open
    if (!g.horizontal || !g.moved) return;
    const dx = e.changedTouches[0].clientX - g.x;
    if (Math.abs(dx) > Math.min(64, heroWidth() * 0.16)) {
      heroSlide(dx < 0 ? 1 : -1);
    } else {
      setHeroAnimating(true);
      setHeroDragX(0);
      window.setTimeout(() => setHeroAnimating(false), 260);
    }
  };

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
  const { requireSignIn } = useSignInModal();
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
  const [expandedExpertId, setExpandedExpertId] = useState<string | null>(null);
  const [expandedFriendId, setExpandedFriendId] = useState<string | null>(null);
  // Profile lookup for the inline friend reviews under "Your Circle"
  // — keyed by user_id so each card can show display name + initial.
  const [friendReviewProfiles, setFriendReviewProfiles] = useState<Record<string, UP>>({});

  useEffect(() => {
    const ids = (Array.from(new Set(friendsStats.ratings.map((r) => r.user_id))).filter(Boolean)) as string[];
    if (ids.length === 0) return;
    getProfilesByIds(ids).then(setFriendReviewProfiles);
  }, [friendsStats.ratings]);

  // Like state for the featured circle review (the visible Like button).
  const [reviewLikes, setReviewLikes] = useState<{ counts: Record<string, number>; mine: Set<string> }>({ counts: {}, mine: new Set() });
  useEffect(() => {
    const ratingIds = friendsStats.ratings.slice(0, 1).map((r) => r.id).filter(Boolean);
    if (!user?.id || ratingIds.length === 0) return;
    let cancelled = false;
    getLikesForRatings(user.id, ratingIds)
      .then(({ likes, userLiked }) => { if (!cancelled) setReviewLikes({ counts: likes, mine: userLiked }); })
      .catch(() => { /* likes are decorative here — ignore load failures */ });
    return () => { cancelled = true; };
  }, [user?.id, friendsStats.ratings]);

  const handleReviewLike = (ratingId: string) => {
    if (!user?.id) { requireSignIn('Sign in to like reviews'); return; }
    const uid = user.id;
    let wasLiked = false;
    setReviewLikes((prev) => {
      const mine = new Set(prev.mine);
      const counts = { ...prev.counts };
      wasLiked = mine.has(ratingId);
      if (wasLiked) mine.delete(ratingId); else mine.add(ratingId);
      counts[ratingId] = Math.max(0, (counts[ratingId] || 0) + (wasLiked ? -1 : 1));
      return { counts, mine };
    });
    void toggleLike(uid, ratingId).then((res) => {
      // Roll back when the write failed or the server didn't actually move
      // — the fire-and-forget version let the heart drift from the DB.
      if (!res.ok || res.liked === wasLiked) {
        setReviewLikes((prev) => {
          const mine = new Set(prev.mine);
          const counts = { ...prev.counts };
          if (wasLiked) mine.add(ratingId); else mine.delete(ratingId);
          counts[ratingId] = Math.max(0, (counts[ratingId] || 0) + (wasLiked ? 1 : -1));
          return { counts, mine };
        });
      }
    });
  };

  const myRating = place ? getRating(place.id) : undefined;

  // Load friend names for the "Went With" section
  useEffect(() => {
    if (!myRating?.friendIds?.length) return;
    getProfilesByIds(myRating.friendIds).then((profiles) => {
      const names: Record<string, string> = {};
      Object.values(profiles).forEach((p) => { names[p.user_id] = p.display_name || `@${p.username}`; });
      setFriendNames(names);
    });
  }, [myRating?.friendIds]);

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

  /* ── Score-color helpers — kept on the app's score thresholds
     (≥8 / ≥5 / <5) so chips and discs stay consistent across the page. ── */
  const chipBg = (s: number) => (s >= 8 ? 'bg-green-600' : s >= 5 ? 'bg-amber-600' : 'bg-red-500');
  // Soft-tinted score pill for friend chips in "From your circle".
  const softChip = (s: number) => (s >= 8 ? 'bg-green-100 text-green-700' : s >= 5 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600');

  // One source of truth for the share payload — used by the top bar,
  // the action chips, and the empty-circle CTA.
  const buildShareTarget = (): SharedRestaurant => ({
    restaurantId: place.id,
    name: place.name,
    image: place.photoUrl || '',
    cuisine,
    price: priceStr,
    address: place.fullAddress || place.address,
    ...(myRating
      ? { score: myRating.score, notes: myRating.notes, wouldReturn: myRating.wouldReturn, tags: myRating.tags, isReview: true }
      : { isReview: false }),
  });

  const wishMeta = { id: place.id, name: place.name, image: place.photoUrl || '', cuisine, price: priceStr, address: place.fullAddress || place.address };
  // Meta for the add/edit-rating modal — mirrors the My Rating section.
  // Used by the title re-rate / "rated" controls.
  const ratingMeta = { id: place.id, name: place.name, image: place.photoUrl || '', cuisine, price: priceStr, address: place.fullAddress || place.address };

  // Full-bleed hairline divider (breaks out of the 18px page gutter).
  // Reused by reference; React lets us share one element instance.
  const sep = <div className="h-px bg-line -mx-[18px] my-7" aria-hidden />;

  return (
    <div className="min-h-screen bg-cream">

      {/* ── Floating top controls — back / bookmark / share. Light glass
          circles so the icons stay legible both over the hero photo and
          on the cream surface once the page scrolls (the thin ring gives
          the white fill an edge on the white page). ── */}
      <div className="sticky top-0 z-50 h-0">
        <div className="absolute top-0 inset-x-0 px-4 pt-safe-4 flex items-center justify-between pointer-events-none">
          <button
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="pointer-events-auto w-[38px] h-[38px] rounded-full bg-paper/90 backdrop-blur-md ring-1 ring-black/5 shadow-[0_2px_10px_rgba(0,0,0,0.12)] flex items-center justify-center text-ink-2 active:scale-95 transition-transform"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="pointer-events-auto flex items-center gap-2.5">
            <button
              onClick={() => { if (place) toggleWishlist(wishMeta); }}
              aria-label={place && isWishlisted(place.id) ? 'Remove from wishlist' : 'Save to wishlist'}
              className="w-[38px] h-[38px] rounded-full bg-paper/90 backdrop-blur-md ring-1 ring-black/5 shadow-[0_2px_10px_rgba(0,0,0,0.12)] flex items-center justify-center text-ink-2 active:scale-95 transition-transform"
            >
              <Bookmark size={16} className={place && isWishlisted(place.id) ? 'fill-primary text-primary' : ''} />
            </button>
            <button
              onClick={() => { if (place) setChatShareTarget(buildShareTarget()); }}
              aria-label="Share"
              className="w-[38px] h-[38px] rounded-full bg-paper/90 backdrop-blur-md ring-1 ring-black/5 shadow-[0_2px_10px_rgba(0,0,0,0.12)] flex items-center justify-center text-ink-2 active:scale-95 transition-transform"
            >
              <Share2 size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Hero — full-bleed photo. Only rendered when the restaurant
          actually has photos; with none we drop straight to the title and
          leave a little clearance for the floating top controls. Tapping
          the hero (or the photo-count pill) opens the full gallery. ── */}
      {photos.length > 0 ? (
      <div
        ref={heroRef}
        className="relative w-full overflow-hidden"
        style={{ height: '40vh', maxHeight: '46vh', touchAction: 'pan-y' }}
        onTouchStart={onHeroTouchStart}
        onTouchMove={onHeroTouchMove}
        onTouchEnd={onHeroTouchEnd}
        onTouchCancel={onHeroTouchEnd}
      >
        {/* Sliding 3-photo window — prev / current / next. The track is 300%
            wide and parked one panel left so the current photo is centred;
            `heroDragX` follows the finger, then snaps via `heroSlide`. */}
        <div
          className="absolute inset-0 z-[1] flex"
          style={{
            width: '300%',
            transform: `translateX(calc(-33.3333% + ${heroDragX}px))`,
            transition: heroAnimating ? trackTransition : 'none',
            willChange: 'transform',
          }}
        >
          {[
            (photoIndex - 1 + photos.length) % photos.length,
            photoIndex,
            (photoIndex + 1) % photos.length,
          ].map((idx, slot) => (
            <button
              key={slot}
              onClick={() => { if (heroG.current.swiped) { heroG.current.swiped = false; return; } setGalleryOpen(true); }}
              className="relative w-1/3 h-full cursor-pointer"
              aria-label="Open photo gallery"
              aria-hidden={slot !== 1}
              tabIndex={slot === 1 ? 0 : -1}
            >
              <img
                src={photos[idx]}
                alt={place.name}
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
                draggable={false}
              />
            </button>
          ))}
        </div>

        {/* Top scrim — keeps the floating glass controls readable on
            bright photos. */}
        <div
          className="absolute inset-x-0 top-0 h-28 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.28), rgba(0,0,0,0))' }}
        />
        {/* Thin fade into the page surface at the bottom */}
        <div
          className="absolute inset-x-0 bottom-0 h-10 pointer-events-none"
          style={{ background: 'linear-gradient(to top, var(--color-cream), transparent)' }}
        />

        {/* Photo-count pill — opens the gallery */}
        {photos.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setGalleryOpen(true); }}
            className="absolute bottom-5 right-4 z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/55 backdrop-blur-md text-white active:opacity-80 transition-opacity"
            style={{ fontSize: 12, fontWeight: 600 }}
          >
            <Images size={13} />
            {photos.length} {photos.length === 1 ? 'Photo' : 'Photos'}
          </button>
        )}

        {/* Position dots — a windowed "carousel" indicator: a fixed row of
            up to 7 dots that slides smoothly so the active dot is always
            lit, with dots scaling down toward either end whenever there are
            more photos beyond the visible window. */}
        {photos.length > 1 && (() => {
          const N = photos.length;
          const SLOT = 13;                 // px of horizontal space per dot
          const WINDOW = Math.min(N, 7);   // dots visible at once
          const half = Math.floor(WINDOW / 2);
          const first = Math.max(0, Math.min(photoIndex - half, N - WINDOW));
          const overflowL = first > 0;
          const overflowR = first + WINDOW < N;
          const baseScale = (i: number) => {
            if (i < first || i > first + WINDOW - 1) return 0;
            if (overflowL && i === first) return 0.45;
            if (overflowR && i === first + WINDOW - 1) return 0.45;
            if (overflowL && i === first + 1) return 0.72;
            if (overflowR && i === first + WINDOW - 2) return 0.72;
            return 1;
          };
          return (
            <div
              className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 overflow-hidden"
              style={{ width: WINDOW * SLOT, height: 14 }}
            >
              <div
                className="flex items-center h-full transition-transform duration-300 ease-out"
                style={{ width: N * SLOT, transform: `translateX(${-first * SLOT}px)` }}
              >
                {photos.map((_, i) => {
                  const scale = i === photoIndex ? 1 : baseScale(i);
                  return (
                    <button
                      key={i}
                      onClick={(e) => { e.stopPropagation(); setPhotoIndex(i); }}
                      className="flex-shrink-0 h-full flex items-center justify-center"
                      style={{ width: SLOT }}
                      aria-label={`Show photo ${i + 1}`}
                      tabIndex={scale === 0 ? -1 : 0}
                    >
                      <span
                        className={cn('block h-1.5 w-1.5 rounded-full transition-all duration-300 ease-out', i === photoIndex ? 'bg-media-white' : 'bg-white/50')}
                        style={{ transform: `scale(${scale})` }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Prev / next arrows — step through photos inline without opening
            the full gallery. */}
        {photos.length > 1 && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); heroSlide(-1); }}
              aria-label="Previous photo"
              className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 text-white/90 flex items-center justify-center active:scale-90 transition-transform drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); heroSlide(1); }}
              aria-label="Next photo"
              className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 text-white/90 flex items-center justify-center active:scale-90 transition-transform drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]"
            >
              <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>
      ) : (
        <div style={{ height: 'calc(env(safe-area-inset-top, 0px) + 60px)' }} aria-hidden />
      )}

      {/* ── Main Content ── */}
      <main className="pt-5" style={{ paddingLeft: 18, paddingRight: 18 }}>

        {/* ── Name + metadata — matches the reference: a sans cuisine/price
            eyebrow, a Newsreader serif name, and a +/♥ control pair (add a
            rating · save). Michelin badge, address, live open status and
            travel times follow. ── */}
        {(() => {
          const dist = homeLocationForDistance && destForDistance
            ? formatDistance(haversineDistanceMi(homeLocationForDistance.lat, homeLocationForDistance.lng, destForDistance.lat, destForDistance.lng))
            : '';
          return (
            <section>
              <p className="uppercase mb-2 text-on-surface/50" style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.12em' }}>
                {cuisine}
                {priceStr && <>{'  ·  '}{priceStr}</>}
              </p>
              <div className="flex items-center justify-between gap-3">
                <h1 className="min-w-0 flex-1 text-on-surface" style={{ fontFamily: '"Newsreader", serif', fontSize: '31px', fontWeight: 600, lineHeight: 1.02, letterSpacing: '-0.01em' }}>
                  {place.name}
                </h1>
                <div className="flex items-center gap-2.5 flex-shrink-0">
                  {myRating ? (
                    <>
                      {/* Already rated → the + becomes a re-rate (log a new
                          visit), and the heart becomes a "rated" checkmark
                          (tap to view/edit your rating). Wishlist still lives
                          in the top bar. */}
                      <button
                        type="button"
                        onClick={() => openAddRestaurantModal(ratingMeta, 'new-visit')}
                        aria-label="Re-rate"
                        className="w-[38px] h-[38px] rounded-full bg-cream-2 flex items-center justify-center text-ink-2 active:scale-95 transition-transform"
                      >
                        <Star size={17} />
                      </button>
                      <button
                        type="button"
                        onClick={() => openAddRestaurantModal(ratingMeta)}
                        aria-label="You've rated this — view your rating"
                        className="w-[38px] h-[38px] rounded-full bg-primary/10 flex items-center justify-center text-primary active:scale-95 transition-transform"
                      >
                        <Check size={18} strokeWidth={2.5} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => openAddRestaurantModal(wishMeta)}
                        aria-label="Add rating"
                        className="w-[38px] h-[38px] rounded-full bg-cream-2 flex items-center justify-center text-ink-2 active:scale-95 transition-transform"
                      >
                        <Plus size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleWishlist(wishMeta)}
                        aria-label={isWishlisted(place.id) ? 'Remove from wishlist' : 'Save to wishlist'}
                        className="w-[38px] h-[38px] rounded-full bg-cream-2 flex items-center justify-center active:scale-95 transition-transform"
                      >
                        <Bookmark size={17} className={isWishlisted(place.id) ? 'fill-primary text-primary' : 'text-ink-2'} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {michelin && (
                <div className="mt-3">
                  <MichelinBadge michelin={michelin} size="sm" href={michelin.guideUrl} />
                </div>
              )}

              {/* Address + distance */}
              <div className="mt-3.5 flex items-baseline gap-1.5 min-w-0 text-[14px] text-on-surface/60">
                <MapPin size={14} className="text-primary/70 flex-shrink-0 translate-y-0.5" />
                <span className="truncate">{place.address}</span>
                {dist && (
                  <>
                    <span className="text-on-surface/25 flex-shrink-0">·</span>
                    <span className="flex-shrink-0">{dist}</span>
                  </>
                )}
              </div>

              {/* Open / closed status */}
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
                        const next = getNextOpenLabel(place.hours, restaurantLocalNow(place.lng));
                        return next ? <span> · opens {next}</span> : null;
                      })()}
                    </span>
                  )}
                </div>
              )}

              {/* Travel times */}
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
            </section>
          );
        })()}

        {/* ── Quick actions — horizontal warm pill row. Disabled chips dim
            when there's no destination (no phone / website). ── */}
        <div className="flex gap-2.5 overflow-x-auto no-scrollbar -mx-[18px] px-[18px] mt-5 py-1">
          {[
            { Icon: Phone, label: 'Call', href: place.phone ? `tel:${place.phone}` : null },
            // Route goes through openExternalUrl so native hands off to the
            // Maps app instead of bouncing the tap through Safari.
            { Icon: Navigation, label: 'Route', href: directionsUrl || null, onClick: directionsUrl ? () => { void openExternalUrl(directionsUrl); } : undefined },
            { Icon: Globe, label: 'Web', href: place.website || null, external: true },
            { Icon: Send, label: 'Share', onClick: () => setChatShareTarget(buildShareTarget()) },
            ...(michelin ? [{ Icon: Award, label: 'Michelin Guide', href: michelin.guideUrl, external: true, accent: true }] : []),
          ].map(({ Icon, label, href, external, onClick, accent }: any) => {
            const inner = (
              <>
                <Icon size={15} className={accent ? 'text-primary' : 'text-ink-3'} />
                <span>{label}</span>
              </>
            );
            const base = 'flex-shrink-0 inline-flex items-center gap-2 px-[15px] py-[9px] rounded-full whitespace-nowrap active:scale-[0.97] transition-transform';
            const cls = cn(base, accent ? 'bg-primary/10 text-primary' : 'bg-cream-2 text-ink-2');
            const style = { fontSize: '13.5px', fontWeight: 500 } as const;
            if (onClick) return <button key={label} type="button" onClick={onClick} className={cls} style={style}>{inner}</button>;
            if (!href) return <div key={label} className={cn(base, 'bg-cream-2 text-ink-4 opacity-50')} style={style}>{inner}</div>;
            return (
              <a key={label} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className={cls} style={style}>
                {inner}
              </a>
            );
          })}
        </div>

        {sep}

        {/* ── Ratings — matches the mobile reference file: three depth-lit
            gradient score circles (disc over label over count) with a
            hairline-separated Google row beneath. No surrounding card. ── */}
        {(() => {
          const expertAvg = expertRecommendations.length > 0
            ? expertRecommendations.reduce((sum, r) => sum + Number(r.rating), 0) / expertRecommendations.length
            : 0;
          const expertCount = expertRecommendations.length;
          const hasCommunity = communityStats.totalRatings > 0;
          const hasFriends = friendsStats.totalRatings > 0;
          const hasExperts = expertCount > 0;
          const hasGoogle = Number(place.rating) > 0 && place.userRatingCount > 0;

          const discGradient = (s: number) =>
            s >= 8 ? 'linear-gradient(145deg,#26AC74,#138257)'
              : s >= 5 ? 'linear-gradient(145deg,#E7A93B,#C9821B)'
                : 'linear-gradient(145deg,#E0584A,#C13B2E)';
          const discShadow = (s: number) =>
            `0 5px 14px ${s >= 8 ? 'rgba(20,135,90,0.32)' : s >= 5 ? 'rgba(201,130,27,0.30)' : 'rgba(193,59,46,0.30)'}, inset 0 1px 0 rgba(255,255,255,0.4), inset 0 0 0 1px rgba(255,255,255,0.08)`;

          const Col = ({ label, score, count, countLabel, emptyCopy, onClick }: {
            label: string; score: number | null; count: number; countLabel: string; emptyCopy: string; onClick?: () => void;
          }) => {
            const body = (
              <>
                {score != null ? (
                  <div className="w-[58px] h-[58px] rounded-full flex items-center justify-center" style={{ background: discGradient(score), boxShadow: discShadow(score) }}>
                    <span className="text-white tabular-nums" style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '0.3px' }}>{score.toFixed(1)}</span>
                  </div>
                ) : (
                  <div className="w-[58px] h-[58px] rounded-full bg-cream-2 flex items-center justify-center" style={{ boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)' }}>
                    <span className="text-ink-4" style={{ fontSize: '18px', fontWeight: 600 }}>—</span>
                  </div>
                )}
                <span className="uppercase text-on-surface/40 mt-[11px]" style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.09em' }}>{label}</span>
                {score != null ? (
                  <span className="text-on-surface mt-1" style={{ fontSize: '13px', fontWeight: 600 }}>{count.toLocaleString()} {countLabel}</span>
                ) : (
                  <span className="italic text-on-surface/40 mt-1" style={{ fontSize: '13px' }}>{emptyCopy}</span>
                )}
              </>
            );
            return onClick ? (
              <button type="button" onClick={onClick} className="flex-1 flex flex-col items-center active:opacity-70 transition-opacity">{body}</button>
            ) : (
              <div className="flex-1 flex flex-col items-center">{body}</div>
            );
          };

          return (
            <section>
              <p className="uppercase text-on-surface/40 mb-[18px]" style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.14em' }}>Ratings</p>
              <div className="flex">
                <Col
                  label="Everyone"
                  score={hasCommunity ? communityStats.avgScore : null}
                  count={communityStats.totalRatings}
                  countLabel={communityStats.totalRatings === 1 ? 'rating' : 'ratings'}
                  emptyCopy="Be the first"
                />
                {(
                  <Col
                    label="Friends"
                    score={hasFriends ? friendsStats.avgScore : null}
                    count={friendsStats.totalRatings}
                    countLabel={friendsStats.totalRatings === 1 ? 'rating' : 'ratings'}
                    emptyCopy="No friends yet"
                    onClick={hasFriends ? () => setShowFriendsDetail(true) : undefined}
                  />
                )}
                {(
                  <Col
                    label="Experts"
                    score={hasExperts ? expertAvg : null}
                    count={expertCount}
                    countLabel={expertCount === 1 ? 'pick' : 'picks'}
                    emptyCopy="No picks"
                  />
                )}
              </div>
              {hasGoogle && (
                <div className="flex items-center gap-2.5 mt-5 pt-[17px] border-t border-line">
                  <span className="inline-flex items-center rounded-[7px] bg-cream-2 text-ink-3" style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.07em', padding: '4px 10px' }}>GOOGLE</span>
                  <span className="text-on-surface tabular-nums" style={{ fontSize: '15px', fontWeight: 700 }}>{place.rating}</span>
                  <Star size={15} className="fill-amber-400 text-amber-400" />
                  <span className="text-on-surface/55" style={{ fontSize: '13px' }}>{formatReviewCount(place.userRatingCount)} reviews</span>
                </div>
              )}
            </section>
          );
        })()}

        {/* ── From your circle — matches the reference: a featured friend
            review (colored avatar, soft-green score chip, italic Newsreader
            quote with an accent rule, optional dish photos, and a
            like/reply/full-review action row), then the rest as compact
            expandable rows. ── */}
        {(() => {
          const ratings = friendsStats.ratings;
          const hasFriends = ratings.length > 0;
          const featured = ratings[0];
          const rest = ratings.slice(1, 4);
          // Deterministic avatar tint per name — echoes the reference's
          // colored monogram avatars.
          const AV = ['#B98A7A', '#6E8B6B', '#9C4A4A', '#7C6BAE', '#5B6B4A', '#A6371D', '#3F6F8F'];
          const colorFor = (s: string) => AV[(s || 'F').charCodeAt(0) % AV.length];
          const nameOf = (r: any) => friendReviewProfiles[r.user_id]?.display_name || 'Friend';
          const recencyOf = (r: any) => (r.visit_date ? timeAgo(r.visit_date) : r.created_at ? timeAgo(r.created_at) : '');

          const Avatar = ({ name, size = 42 }: { name: string; size?: number }) => (
            <div className="rounded-full flex items-center justify-center flex-shrink-0 text-white" style={{ width: size, height: size, background: colorFor(name) }}>
              <span style={{ fontFamily: '"Newsreader", serif', fontSize: size * 0.33, fontWeight: 600, letterSpacing: '0.3px' }}>
                {name.trim().charAt(0).toUpperCase() || 'F'}
              </span>
            </div>
          );

          return (
            <>
              {sep}
              <section>
                <button
                  type="button"
                  onClick={() => (hasFriends || expertRecommendations.length > 0) && navigate(`/restaurant/${place.id}/circle`)}
                  className="w-full flex items-center justify-between mb-4 active:opacity-70 transition-opacity"
                >
                  <span className="uppercase text-primary" style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em' }}>
                    From your circle
                  </span>
                  {hasFriends && (
                    <span className="inline-flex items-center gap-1 text-primary" style={{ fontSize: '13px', fontWeight: 600 }}>
                      See all {ratings.length}
                      <ChevronRight size={14} />
                    </span>
                  )}
                </button>

                {hasFriends ? (
                  <div>
                    {/* Featured review */}
                    {(() => {
                      const name = nameOf(featured);
                      const recency = recencyOf(featured);
                      const dishes = ((featured as any).photos as { url: string }[] | undefined) || [];
                      return (
                        <div>
                          <button
                            type="button"
                            onClick={() => navigate(`/review/${featured.id}`)}
                            className="w-full text-left active:opacity-70 transition-opacity"
                          >
                            <div className="flex items-center gap-3">
                              <Avatar name={name} size={44} />
                              <div className="flex-1 min-w-0">
                                <p className="text-on-surface truncate" style={{ fontFamily: '"Newsreader", serif', fontSize: '17px', fontWeight: 600, lineHeight: 1.1 }}>
                                  {name}
                                </p>
                                {recency && <p className="text-on-surface/45 mt-0.5" style={{ fontSize: '12.5px' }}>Visited {recency}</p>}
                              </div>
                              <span className={cn('flex-shrink-0 inline-flex items-center h-[30px] px-3 rounded-[9px] tabular-nums', softChip(Number(featured.score)))} style={{ fontSize: '14px', fontWeight: 700 }}>
                                {Number(featured.score).toFixed(1)}
                              </span>
                            </div>
                            {featured.notes && (
                              <p
                                className="italic text-on-surface/75 mt-3.5 pl-[15px]"
                                style={{ fontFamily: '"Newsreader", serif', fontSize: '15.5px', lineHeight: 1.55, borderLeft: '2px solid var(--color-accent)' }}
                              >
                                "{featured.notes}"
                              </p>
                            )}
                            {dishes.length > 0 && (
                              <div className="flex gap-2 mt-3.5">
                                {dishes.slice(0, 3).map((p, i) => (
                                  <img key={i} src={p.url} className="flex-1 h-[78px] rounded-[13px] object-cover" referrerPolicy="no-referrer" />
                                ))}
                              </div>
                            )}
                          </button>
                          <div className="flex items-center justify-between mt-3.5">
                            <div className="flex items-center gap-5">
                              <button
                                type="button"
                                onClick={() => handleReviewLike(featured.id)}
                                className={cn(
                                  'inline-flex items-center gap-1.5 active:opacity-60 transition-opacity',
                                  reviewLikes.mine.has(featured.id) ? 'text-red-500' : 'text-on-surface/45',
                                )}
                                style={{ fontSize: '13px', fontWeight: 500 }}
                                aria-label={reviewLikes.mine.has(featured.id) ? 'Unlike review' : 'Like review'}
                              >
                                <Heart size={16} className={reviewLikes.mine.has(featured.id) ? 'fill-red-500' : ''} />
                                {(reviewLikes.counts[featured.id] || 0) > 0 ? reviewLikes.counts[featured.id] : 'Like'}
                              </button>
                              <button type="button" onClick={() => navigate(`/review/${featured.id}`)} className="inline-flex items-center gap-1.5 text-on-surface/45 active:opacity-60 transition-opacity" style={{ fontSize: '13px', fontWeight: 500 }}>
                                <MessageCircle size={16} /> Reply
                              </button>
                            </div>
                            <button type="button" onClick={() => navigate(`/review/${featured.id}`)} className="inline-flex items-center gap-1 text-primary active:opacity-70 transition-opacity" style={{ fontSize: '13px', fontWeight: 600 }}>
                              Full review <ChevronRight size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Remaining friends — compact expandable rows */}
                    {rest.length > 0 && (
                      <div className="mt-1 border-t border-line">
                        {rest.map((r) => {
                          const name = nameOf(r);
                          const recency = recencyOf(r);
                          const isOpen = expandedFriendId === r.id;
                          return (
                            <div key={r.id} className="border-b border-line last:border-b-0 py-3.5">
                              <button
                                type="button"
                                onClick={() => setExpandedFriendId(isOpen ? null : r.id)}
                                className="w-full flex items-center gap-3 text-left active:opacity-70 transition-opacity"
                              >
                                <Avatar name={name} size={40} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-on-surface truncate" style={{ fontFamily: '"Newsreader", serif', fontSize: '16px', fontWeight: 600, lineHeight: 1.1 }}>
                                    {name}
                                  </p>
                                  {recency && <p className="text-on-surface/45 mt-0.5" style={{ fontSize: '12px' }}>Visited {recency}</p>}
                                </div>
                                <span className={cn('flex-shrink-0 inline-flex items-center h-7 px-2.5 rounded-lg tabular-nums', softChip(Number(r.score)))} style={{ fontSize: '13px', fontWeight: 700 }}>
                                  {Number(r.score).toFixed(1)}
                                </span>
                                {r.notes && (
                                  <ChevronDown size={15} className={cn('text-on-surface/30 flex-shrink-0 transition-transform duration-200', isOpen && 'rotate-180')} />
                                )}
                              </button>
                              <AnimatePresence>
                                {isOpen && r.notes && (
                                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                                    <p className="italic text-on-surface/75 mt-2.5 pl-[52px]" style={{ fontFamily: '"Newsreader", serif', fontSize: '14.5px', lineHeight: 1.5 }}>
                                      "{r.notes}"
                                    </p>
                                    <button type="button" onClick={() => navigate(`/review/${r.id}`)} className="mt-2 ml-[52px] inline-flex items-center gap-1 text-primary" style={{ fontSize: '12.5px', fontWeight: 600 }}>
                                      Full review <ChevronRight size={11} />
                                    </button>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-[14px] bg-paper border border-line px-4 py-6 text-center">
                    <Users size={20} className="mx-auto text-on-surface/30 mb-2" />
                    <p className="text-on-surface/55" style={{ fontSize: '13px' }}>No friends have rated this yet</p>
                    <button
                      type="button"
                      onClick={() => setChatShareTarget(buildShareTarget())}
                      className="mt-2 text-primary active:opacity-70 transition-opacity"
                      style={{ fontSize: '12px', fontWeight: 600 }}
                    >
                      Share with a friend
                    </button>
                  </div>
                )}
              </section>
            </>
          );
        })()}

        {/* ── More from {name} — reels / posts featuring this restaurant. ── */}
        <RestaurantFeaturedReels
          restaurantId={place.id}
          restaurantName={place.name}
          size="md"
          className="mt-7"
        />

        {/* ── My Rating — collapsible. Header carries the score chip inline;
            expanded body opens with a Score / Price / Visited tri-panel,
            then editable Notes / Tags / Photos / companions. ── */}
        {myRating && place && (() => {
          const meta = { id: place.id, name: place.name, image: place.photoUrl || '', cuisine, price: priceStr, address: place.fullAddress || place.address };
          type RatingPage = 'main' | 'notes' | 'tags' | 'photos' | 'price' | 'date' | 'friends';
          const openAt = (pg: RatingPage) => openAddRestaurantModal(meta, pg);
          const hasNotes = !!myRating.notes;
          const hasTags = (myRating.tags?.length || 0) > 0;
          const hasPhotos = (myRating.photos?.length || 0) > 0;
          const hasDate = !!myRating.visitDate;
          const hasFriends = (myRating.friendIds?.length || 0) > 0;
          const dateLabel = parseVisitDate(myRating.visitDate)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) ?? null;
          const eyebrowStyle = { fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: '11px', fontWeight: 700, letterSpacing: '0.14em' } as const;
          return (
            <>
              {sep}
              <section ref={myRatingRef} className="scroll-mt-4">
                <button onClick={() => setMyRatingOpen(!myRatingOpen)} className="w-full flex items-center justify-between py-1 text-left active:opacity-70 transition-opacity">
                  <span className="flex items-center gap-3">
                    <span className="section-eyebrow">My rating</span>
                    <span className={cn('inline-flex items-center justify-center h-6 px-2.5 rounded-lg', chipBg(myRating.score))}>
                      <span className="text-white tabular-nums" style={{ fontFamily: '"Fraunces", "Noto Serif", serif', fontSize: '12.5px', fontWeight: 600 }}>
                        {myRating.score.toFixed(1)}
                      </span>
                    </span>
                  </span>
                  <ChevronDown size={16} className={cn('text-ink-3 flex-shrink-0 transition-transform duration-200', myRatingOpen && 'rotate-180')} />
                </button>

                <AnimatePresence>
                  {myRatingOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                      <div className="pt-4">
                        {/* Re-rate / Edit */}
                        <div className="flex items-center justify-end gap-3 mb-4">
                          <button onClick={() => openAddRestaurantModal(meta, 'new-visit')} className="inline-flex items-center gap-1.5 text-white bg-primary active:opacity-90 transition-opacity px-3 py-1.5 rounded-full" style={{ fontSize: '12.5px', fontWeight: 700 }}>
                            <Star size={12} className="fill-white" /> Re-rate
                          </button>
                          <button onClick={() => openAt('main')} className="flex items-center gap-1 text-primary active:opacity-70 transition-opacity" style={{ fontSize: '13px', fontWeight: 600 }}>
                            <Edit3 size={13} /> Edit
                          </button>
                        </div>

                        {/* Tri-panel: Score / Price / Visited */}
                        <div className="flex rounded-2xl overflow-hidden bg-cream-2" style={{ boxShadow: 'inset 0 0 0 1px var(--color-line)' }}>
                          <button onClick={() => openAt('main')} className="flex-1 p-4 text-left active:opacity-70 transition-opacity">
                            <div className="uppercase text-ink-4" style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em' }}>Score</div>
                            <div className="mt-1.5">
                              <span className={cn('font-serif', scoreColor(myRating.score))} style={{ fontSize: '25px', fontWeight: 600 }}>{myRating.score.toFixed(1)}</span>
                              <span className="text-ink-4" style={{ fontSize: '13px' }}> / 10</span>
                            </div>
                          </button>
                          {(
                            <>
                              <div className="w-px bg-line" />
                              <button onClick={() => openAt('price')} className="flex-1 p-4 text-left active:opacity-70 transition-opacity">
                                <div className="uppercase text-ink-4" style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em' }}>Price</div>
                                <div className="mt-1.5 text-ink" style={{ fontSize: '20px', fontWeight: 700 }}>{myRating.price || <span className="text-ink-4 font-serif italic font-normal text-[16px]">Add</span>}</div>
                              </button>
                            </>
                          )}
                          <div className="w-px bg-line" />
                          <button onClick={() => openAt('date')} className="flex-1 p-4 text-left active:opacity-70 transition-opacity">
                            <div className="uppercase text-ink-4" style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em' }}>Visited</div>
                            <div className="mt-1.5 text-ink" style={{ fontSize: '14px', fontWeight: 600 }}>{dateLabel || <span className="text-ink-4 font-serif italic font-normal text-[16px]">Add</span>}</div>
                          </button>
                        </div>

                        <div className="space-y-5 mt-5">
                          {/* Notes */}
                          <div>
                            <button onClick={() => openAt('notes')} className="flex items-center gap-1.5 uppercase text-ink-2 active:opacity-60 transition-opacity" style={eyebrowStyle}>
                              <StickyNote size={13} /><span>Notes</span><Edit3 size={11} className="text-ink-3 ml-0.5" />
                            </button>
                            {hasNotes ? (
                              <p className="mt-2 italic text-ink-2 font-serif" style={{ fontSize: '16px', lineHeight: 1.55 }}>"{myRating.notes}"</p>
                            ) : (
                              <button onClick={() => openAt('notes')} className="mt-2 italic text-ink-3 active:text-ink-2 transition-colors" style={{ fontSize: '14px' }}>Add notes…</button>
                            )}
                          </div>

                          {/* Tags */}
                          <div>
                            <button onClick={() => openAt('tags')} className="flex items-center gap-1.5 uppercase text-ink-2 active:opacity-60 transition-opacity" style={eyebrowStyle}>
                              <Tag size={13} /><span>Tags</span><Edit3 size={11} className="text-ink-3 ml-0.5" />
                            </button>
                            {hasTags ? (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {myRating.tags.map((t) => (
                                  <span key={t} className="text-xs font-medium px-2.5 py-1 rounded-full bg-cream-2 text-ink-2">{t}</span>
                                ))}
                              </div>
                            ) : (
                              <button onClick={() => openAt('tags')} className="mt-2 block italic text-ink-3 active:text-ink-2 transition-colors" style={{ fontSize: '14px' }}>Add tags…</button>
                            )}
                          </div>

                          {/* Photos */}
                          <div>
                            <button onClick={() => openAt('photos')} className="flex items-center gap-1.5 uppercase text-ink-2 active:opacity-60 transition-opacity" style={eyebrowStyle}>
                              <Image size={13} /><span>Photos</span><Edit3 size={11} className="text-ink-3 ml-0.5" />
                            </button>
                            {hasPhotos ? (
                              <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar -mx-[18px] px-[18px] snap-x snap-mandatory">
                                {myRating.photos.map((p, i) => (
                                  <img key={i} src={p.url} className="w-24 h-24 rounded-xl object-cover flex-shrink-0 snap-start" referrerPolicy="no-referrer" />
                                ))}
                              </div>
                            ) : (
                              <button onClick={() => openAt('photos')} className="mt-2 block italic text-ink-3 active:text-ink-2 transition-colors" style={{ fontSize: '14px' }}>Add photos…</button>
                            )}
                          </div>

                          {/* Companions */}
                          {(
                            <div>
                              <button onClick={() => openAt('friends')} className="flex items-center gap-1.5 uppercase text-ink-2 active:opacity-60 transition-opacity" style={eyebrowStyle}>
                                <Users size={13} /><span>With</span><Edit3 size={11} className="text-ink-3 ml-0.5" />
                              </button>
                              {hasFriends ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {myRating.friendIds.map((fid) => (
                                    <span key={fid} className="text-xs font-medium px-2.5 py-1 rounded-full bg-cream-2 text-ink-2">{friendNames[fid] || fid.slice(0, 8)}</span>
                                  ))}
                                </div>
                              ) : (
                                <button onClick={() => openAt('friends')} className="mt-2 block italic text-ink-3 active:text-ink-2 transition-colors" style={{ fontSize: '14px' }}>Add companions…</button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>
            </>
          );
        })()}

        {/* ── Visit History — date-badge timeline with score trend arrows. ── */}
        {myRating && visitHistory.length > 0 && place && (() => {
          const scoreBorder = (s: number) =>
            s >= 8 ? 'border-l-green-500' : s >= 5 ? 'border-l-amber-500' : 'border-l-red-500';
          const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const parseDate = parseVisitDate;

          type Entry = {
            id: string; score: number; date: Date | null; notes?: string; tags?: string[];
            photos?: { url: string }[]; wouldReturn?: boolean; trend: 'up' | 'down' | 'same' | null; isCurrent: boolean;
          };

          const entries: Entry[] = [];
          entries.push({
            id: 'current', score: myRating.score, date: parseDate(myRating.visitDate), notes: myRating.notes,
            tags: myRating.tags, photos: myRating.photos, wouldReturn: myRating.wouldReturn, trend: null, isCurrent: true,
          });
          visitHistory.forEach((v) => {
            entries.push({ id: v.id, score: v.score, date: parseDate(v.visit_date), notes: v.notes, tags: v.tags, photos: v.photos, wouldReturn: v.would_return, trend: null, isCurrent: false });
          });

          entries.sort((a, b) => {
            const at = a.date ? a.date.getTime() : 0;
            const bt = b.date ? b.date.getTime() : 0;
            return bt - at;
          });

          for (let i = 0; i < entries.length; i++) {
            const cur = entries[i];
            const older = entries[i + 1];
            if (!older) { cur.trend = null; continue; }
            const diff = cur.score - older.score;
            cur.trend = diff > 0.1 ? 'up' : diff < -0.1 ? 'down' : cur.isCurrent ? 'same' : null;
          }

          return (
            <section className="mt-7">
              <p className="section-eyebrow mb-4">Visit history</p>
              <ul className="divide-y divide-line">
                {entries.map((e) => {
                  const isExpanded = expandedVisit === e.id;
                  const month = e.date ? MONTHS[e.date.getMonth()].toUpperCase() : '—';
                  const day = e.date ? e.date.getDate() : '';
                  const fullDate = e.date ? e.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No date';
                  return (
                    <li key={e.id}>
                      <button type="button" onClick={() => setExpandedVisit(isExpanded ? null : e.id)} className="w-full flex items-center gap-3 py-3.5 text-left active:opacity-70 transition-opacity">
                        <div className={cn('flex-shrink-0 w-11 h-11 rounded-[10px] bg-cream-2 flex flex-col items-center justify-center border-l-[3px]', scoreBorder(e.score))}>
                          <span className="text-ink-3 leading-none" style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: '9px', letterSpacing: '0.1em' }}>{month}</span>
                          <span className="text-ink leading-none mt-1 tabular-nums" style={{ fontFamily: '"Fraunces", "Noto Serif", serif', fontSize: '16px', fontWeight: 500 }}>{day}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          {e.notes ? (
                            <p className="italic text-ink-2 line-clamp-2" style={{ fontFamily: '"Fraunces", "Noto Serif", serif', fontSize: '12px', lineHeight: 1.4 }}>"{e.notes}"</p>
                          ) : (
                            <p className="italic text-ink-4" style={{ fontSize: '12px' }}>No notes</p>
                          )}
                          <p className="text-ink-3 mt-0.5" style={{ fontSize: '11px' }}>{fullDate}</p>
                        </div>
                        <div className="flex-shrink-0 flex items-center gap-1">
                          <div className={cn('w-11 h-7 rounded-md flex items-center justify-center', chipBg(e.score))}>
                            <span className="text-white tabular-nums" style={{ fontFamily: '"Fraunces", "Noto Serif", serif', fontSize: '13px', fontWeight: 600 }}>{e.score.toFixed(1)}</span>
                          </div>
                          {e.trend === 'up' && <span className="text-olive leading-none" style={{ fontSize: '16px', fontWeight: 700 }}>↑</span>}
                          {e.trend === 'down' && <span className="text-clay leading-none" style={{ fontSize: '16px', fontWeight: 700 }}>↓</span>}
                        </div>
                      </button>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                            <div className="pb-4 pl-[calc(44px+0.75rem)] space-y-2.5">
                              {e.tags && e.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {e.tags.map((t) => (<span key={t} className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-cream-2 text-ink-2">{t}</span>))}
                                </div>
                              )}
                              {e.photos && e.photos.length > 0 && (
                                <div className="flex gap-1.5 overflow-x-auto no-scrollbar snap-x snap-mandatory">
                                  {e.photos.slice(0, 6).map((p, i) => (<img key={i} src={p.url} className="w-16 h-16 rounded-lg object-cover flex-shrink-0 snap-start" referrerPolicy="no-referrer" />))}
                                </div>
                              )}
                              {confirmDeleteVisitId === e.id ? (
                                <div className="flex items-center justify-between gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                  <p className="text-xs font-medium text-red-700">Delete this visit?</p>
                                  <div className="flex gap-1.5">
                                    <button type="button" onClick={() => setConfirmDeleteVisitId(null)} className="px-2.5 py-1 text-[11px] font-semibold text-ink-2 border border-line rounded-md bg-paper">Cancel</button>
                                    <button type="button" onClick={() => { if (!place) return; deleteVisit(place.id, e.id); setConfirmDeleteVisitId(null); setExpandedVisit(null); }} className="px-2.5 py-1 text-[11px] font-semibold text-white bg-red-500 rounded-md">Delete</button>
                                  </div>
                                </div>
                              ) : (
                                <button type="button" onClick={() => setConfirmDeleteVisitId(e.id)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-red-500 active:opacity-70 transition-opacity">
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

        {/* ── Expert Picks — editorial list of authoritative reviews. ── */}
        {expertRecommendations.length > 0 && (
          <>
            {sep}
            <section>
              <p className="section-eyebrow mb-4">Verified Picks</p>
              <ul className="rounded-2xl bg-paper border border-line divide-y divide-line overflow-hidden">
                {expertRecommendations.map((rec) => {
                  const isExpanded = expandedExpertId === rec.id;
                  return (
                    <li key={rec.id}>
                      <button onClick={() => setExpandedExpertId(isExpanded ? null : rec.id)} className="w-full px-4 py-4 text-left active:bg-on-surface/[0.015] transition-colors">
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Link to={`/user/${rec.expert_username}`} onClick={(e) => e.stopPropagation()} className="text-[15px] font-serif font-bold text-on-surface hover:text-primary truncate">
                                {rec.expert_name}
                              </Link>
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.15em] text-primary"><VerifiedBadge size={11} inline />Verified</span>
                            </div>
                            <p className={cn('text-[13px] mt-1 leading-relaxed text-on-surface/70', isExpanded ? '' : 'line-clamp-2')}>{rec.recommendation_text}</p>
                          </div>
                          <div className={cn('flex-shrink-0 w-11 h-7 rounded-md flex items-center justify-center', chipBg(Number(rec.rating)))}>
                            <span className="text-[13px] font-bold text-white tabular-nums">{Number(rec.rating).toFixed(1)}</span>
                          </div>
                        </div>
                        <AnimatePresence>
                          {isExpanded && rec.highlight_dishes && rec.highlight_dishes.length > 0 && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                              <div className="pt-3">
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-600/70 mb-2">Highlight Dishes</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {rec.highlight_dishes.map((dish) => (<span key={dish} className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-800">{dish}</span>))}
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
          </>
        )}

        {/* ── Flavor Profile — collapsible radar + ranked list. ── */}
        {(() => {
          if (!place) return null;
          const knownCuisines = [
            'italian', 'french', 'japanese', 'sushi', 'chinese', 'korean', 'thai', 'indian',
            'mexican', 'mediterranean', 'american', 'seafood', 'steakhouse', 'pizza', 'cafe',
            'bakery', 'vegan', 'bar & grill', 'breakfast', 'caribbean',
          ];
          const hasKnown = place.types.some((t) =>
            knownCuisines.includes(t.toLowerCase().replace(/_/g, ' ').replace('restaurant', '').trim())
          );
          if (!hasKnown) return null;
          const flavorData = getFlavorProfile(place.types, place.name);
          const ranked = [...flavorData].sort((a, b) => b.value - a.value);
          const topFlavorNames = new Set(ranked.slice(0, 3).map((f) => f.subject));
          return (
            <>
              {sep}
              <section>
                <button onClick={() => setFlavorOpen(!flavorOpen)} className="w-full flex items-center justify-between py-1 text-left active:opacity-70 transition-opacity">
                  <span className="section-eyebrow">Flavor profile</span>
                  <ChevronDown size={16} className={cn('text-ink-3 flex-shrink-0 transition-transform duration-200', flavorOpen && 'rotate-180')} />
                </button>
                <AnimatePresence>
                  {flavorOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                      <div className="flex items-center gap-4 pt-3">
                        <RadarChart data={flavorData} color="#e85a2c" showLabels={false} className="w-[104px] h-[104px] flex-shrink-0" />
                        <ul className="flex-1 min-w-0 space-y-1" style={{ fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: '12px', lineHeight: 1.5 }}>
                          {ranked.map((f) => {
                            const pct = Math.round((f.value / f.fullMark) * 100);
                            const isTop = topFlavorNames.has(f.subject);
                            return (
                              <li key={f.subject} className="flex items-baseline gap-1.5">
                                <span className={cn('truncate', isTop ? 'font-semibold text-ink' : 'text-ink-3')}>{f.subject}</span>
                                <span className={cn('tabular-nums flex-shrink-0', isTop ? 'text-ink-2' : 'text-ink-3')}>· {pct}%</span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>
            </>
          );
        })()}

        {/* ── Hours — flat accordion with today's status inline. ── */}
        {place.hours.length > 0 && (
          <>
            {sep}
            <section>
              <button onClick={() => setHoursOpen(!hoursOpen)} className="w-full flex items-center justify-between py-1 text-left active:opacity-70 transition-opacity">
                <span className="flex items-center gap-3 min-w-0">
                  <span className="section-eyebrow flex-shrink-0">Hours</span>
                  {place.isOpen !== null && (
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <span className={cn('inline-block w-1.5 h-1.5 rounded-full flex-shrink-0', place.isOpen ? 'bg-olive' : 'bg-clay')} />
                      <span className={cn('font-semibold flex-shrink-0', place.isOpen ? 'text-olive' : 'text-clay')} style={{ fontSize: '13px' }}>
                        {place.isOpen ? 'Open' : 'Closed'}
                      </span>
                      <span className="text-ink-3 truncate" style={{ fontSize: '13px' }}>· {getTodayHours(place.hours)}</span>
                    </span>
                  )}
                </span>
                <ChevronDown size={16} className={cn('text-ink-3 flex-shrink-0 transition-transform duration-200', hoursOpen && 'rotate-180')} />
              </button>
              <AnimatePresence>
                {hoursOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                    <ul className="pt-2 divide-y divide-line">
                      {place.hours.map((line, i) => {
                        const [day, ...timeParts] = line.split(': ');
                        const time = timeParts.join(': ');
                        const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                        const isToday = today.startsWith(day.toLowerCase().slice(0, 3));
                        return (
                          <li key={i} className={cn('flex justify-between items-baseline py-2.5', isToday ? 'font-semibold text-ink' : 'text-ink-3')} style={{ fontSize: '13px' }}>
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
          </>
        )}

        {sep}

        {/* Location eyebrow sits inside the padded main; the map below
            breaks out of the page gutter to bleed edge-to-edge. */}
        <p className="section-eyebrow mb-3">Location</p>
      </main>

      {/* ── Map — full-bleed canvas flush with the page bottom. ── */}
      <section className="relative w-full h-[210px]">
        <div ref={mapContainerRef} className="absolute inset-0" style={{ width: '100%', height: '100%' }} />
        <button
          type="button"
          onClick={() => navigate('/map', {
            state: {
              focus: {
                id: place.id, name: place.name, lat: place.lat, lng: place.lng,
                address: place.fullAddress || place.address, fullAddress: place.fullAddress || place.address,
                photoUrl: place.photoUrl, priceLevel: place.priceLevel, rating: place.rating,
                types: place.types, userRatingCount: place.userRatingCount,
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
        <div className="absolute bottom-3 left-3 z-20 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-paper border border-line text-ink shadow-sm" style={{ fontSize: '12px', fontWeight: 600 }}>
          <MapPin size={12} className="text-primary" />
          <span className="max-w-[60vw] truncate">{place.address}</span>
        </div>
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
              {...friendsDetailDragProps}
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
                          <span className="text-xs font-semibold text-on-surface/70">{friendReviewProfiles[r.user_id]?.display_name || 'Friend'}</span>
                        </div>
                        <ScoreBadge rating={Number(r.score)} size="sm" />
                      </div>
                      {r.notes && <p className="text-[13px] text-on-surface/50 italic mt-1 leading-relaxed">"{r.notes}"</p>}
                      {r.tags && r.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {r.tags.map((t) => <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-primary/8 text-primary/60">{t}</span>)}
                        </div>
                      )}
                      {r.visit_date && <p className="text-[13px] text-on-surface/30 mt-1.5">{new Date(r.visit_date.length === 10 ? `${r.visit_date}T12:00:00` : r.visit_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>}
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

    </div>
  );
};
