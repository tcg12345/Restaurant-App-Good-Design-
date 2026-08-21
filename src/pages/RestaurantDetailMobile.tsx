import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Star, MapPin, Clock, Phone, Globe,
  ChevronLeft, ChevronRight, ChevronDown, Loader2,
  Navigation, ExternalLink, X, Users, UserCircle, Share2, Bookmark,
  DollarSign, CalendarDays, Tag, Image, Edit3, Check, Send, Building2, TrendingUp, TrendingDown, StickyNote, Trash2, ImageOff,
  Car, Footprints, Award, Images, Plus,
} from 'lucide-react';
import { cn, parseVisitDate } from '../lib/utils';
import { GlassButton, GlassGroup } from '../lib/glass-buttons';
import { tierOfScore } from '../lib/settleScores';
import { TIER_LABELS } from '../lib/headToHeadRating';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { CuisinePicker, EditableCuisineLine } from '../components/CuisinePicker';
import { scoreColor, scoreChipBg, scoreTintStyle } from '../lib/score';
import { ScoreBadge } from '../components/ScoreBadge';
import { useRestaurantDetail, formatReviewCount, getTodayHours, getCuisineLabel } from './useRestaurantDetail';
import { MichelinBadge } from '../components/MichelinBadge';
import { useLists } from '../contexts/ListsContext';
import { useToast } from '../contexts/ToastContext';
import { useChat, type SharedRestaurant } from '../contexts/ChatContext';
import { ShareDialog } from '../components/ShareDialog';
import { useAuth } from '../contexts/AuthContext';
import { getProfilesByIds, getCommunityStats, type UserProfile as UP } from '../lib/supabase-community';
import { priceLevelToString } from '../lib/places';
import { loadLastSelectedLocation, isExactAddress } from '../components/HomeLocationBar';
import { haversineDistanceMi, formatDistance } from '../lib/distance';
import { useTravelTimes, formatTravelTime } from '../lib/directions';
import { openExternalUrl } from '../lib/external-links';
import { Link } from 'react-router-dom';
import { PhotoGallery } from '../components/PhotoGallery';
import { RestaurantFeaturedReels } from '../components/RestaurantFeaturedReels';
import { YourReviewComments } from '../components/YourReviewComments';
import { useBottomSheet } from '../lib/useBottomSheet';
import { getNextOpenLabel, restaurantLocalNow } from '../lib/hours';
import { LoadingSkeleton, LoadingSkeletonList } from '../components/LoadingSkeleton';

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
    priceStr, cuisine, cuisines, cuisineLine, cuisineCredit, suggestCuisine, mySuggestion, michelin,
    photos, directionsUrl, mapsUrl,
    communityStats, friendsStats, communityPhotos, expertRecommendations,
    showFriendsDetail, setShowFriendsDetail,
    visitHistory, visitCount,
  } = useRestaurantDetail();
  const [cuisinePickerOpen, setCuisinePickerOpen] = useState(false);
  const { showToast } = useToast();

  const { toggleWishlist, isWishlisted, getRating, openAddRestaurantModal, deleteVisit, scoresUnlocked } = useLists();
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

  // Dot taps ride the same slide animation as arrows/swipes (they used to
  // swap instantly). Multi-photo jumps play as ONE slide: the landing photo
  // is loaded into the adjacent track slot for the duration (heroJump).
  const [heroJump, setHeroJump] = useState<number | null>(null);
  const heroSlideTo = (target: number) => {
    if (heroG.current.busy || target === photoIndex || photos.length < 2) return;
    const N = photos.length;
    const forward = (target - photoIndex + N) % N;
    const dir: 1 | -1 = forward <= N - forward ? 1 : -1;
    heroG.current.busy = true;
    setHeroJump(target);
    setHeroAnimating(true);
    setHeroDragX(dir === 1 ? -heroWidth() : heroWidth());
    window.setTimeout(() => {
      setPhotoIndex(target);
      setHeroJump(null);
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
  // Hours start collapsed — the summary row already shows the Open/Closed
  // status and today's hours; expanding reveals the full week.
  const [hoursOpen, setHoursOpen] = useState(false);
  // Earlier visits fold away under the current rating — the summary is
  // always visible now, so there is nothing left to collapse at the top.
  const [earlierVisitsOpen, setEarlierVisitsOpen] = useState(false);
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
  // Profile lookup for the inline friend reviews under "Your Circle"
  // — keyed by user_id so each card can show display name + initial.
  const [friendReviewProfiles, setFriendReviewProfiles] = useState<Record<string, UP>>({});

  useEffect(() => {
    const ids = (Array.from(new Set(friendsStats.ratings.map((r) => r.user_id))).filter(Boolean)) as string[];
    if (ids.length === 0) return;
    getProfilesByIds(ids).then(setFriendReviewProfiles);
  }, [friendsStats.ratings]);

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
    // Skeleton mirroring the page shape (hero, title, meta, review rows)
    // instead of a bare centered spinner that popped into the full page.
    return (
      <div className="min-h-screen bg-surface" aria-busy="true">
        <div className="animate-pulse bg-on-surface/[0.06] w-full" style={{ height: '40vh', maxHeight: '46vh' }} />
        <div className="px-5 pt-6 space-y-3">
          <div className="animate-pulse bg-on-surface/[0.06] rounded h-7 w-3/4" />
          <div className="animate-pulse bg-on-surface/[0.06] rounded h-4 w-1/2" />
          <LoadingSkeleton variant="text" className="pt-4" />
          <LoadingSkeletonList count={3} variant="list-item" className="pt-4" />
        </div>
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
  const chipBg = (s: number) => scoreChipBg(s);
  // Soft-tinted score pill for friend chips in "From your circle" — the
  // token tints, not raw Tailwind greens, so every score on the page speaks
  // the same muted palette.
  const softChip = (s: number) =>
    s >= 8 ? 'bg-score-high-tint text-score-high-ink'
    : s >= 5 ? 'bg-score-mid-tint text-score-mid-ink'
    : 'bg-score-low-tint text-score-low-ink';

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
      ? { score: myRating.score, notes: myRating.notes, tags: myRating.tags, isReview: true }
      : { isReview: false }),
  });

  const wishMeta = { id: place.id, name: place.name, image: place.photoUrl || '', cuisine, price: priceStr, address: place.fullAddress || place.address };
  // Meta for the add/edit-rating modal — mirrors the My Rating section.
  // Used by the title re-rate / "rated" controls.
  const ratingMeta = { id: place.id, name: place.name, image: place.photoUrl || '', cuisine, price: priceStr, address: place.fullAddress || place.address };

  // Sections separate by rhythm, not by rules. There used to be seven
  // full-bleed hairlines, each carrying 28px of margin above and below —
  // the better part of a screen spent drawing lines between things whose
  // eyebrow labels already said where they started.

  return (
    <div className="min-h-screen bg-cream">

      {/* ── Floating top controls — back / bookmark / share. Light glass
          circles so the icons stay legible both over the hero photo and
          on the cream surface once the page scrolls (the thin ring gives
          the white fill an edge on the white page). ── */}
      <div className="sticky top-0 z-50 h-0">
        <div className="absolute top-0 inset-x-0 px-4 pt-safe-4 flex items-center justify-between pointer-events-none">
          <GlassButton
            id="restaurant-back"
            symbol="arrow.left"
            label="Back"
            onClick={() => navigate(-1)}
            className="hit-44 pointer-events-auto w-11 h-11 rounded-full flex items-center justify-center text-ink-2 active:scale-95 transition-transform"
          >
            <ArrowLeft size={18} />
          </GlassButton>
          {/* Save + share share one capsule, the same one-piece-of-glass
              rule as the header pair on Discover: two touching circles read
              as two objects; one surface with two regions reads as the
              single control it is. */}
          <div className="pointer-events-auto">
            <GlassGroup
              id="restaurant-actions"
              className="flex items-center rounded-full"
              itemClassName="relative w-11 h-11 flex items-center justify-center text-ink-2"
              items={[
                {
                  id: 'save',
                  // The saved state is the glyph and its tint, same as the
                  // web button — a filled bookmark in the brand rust.
                  symbol: place && isWishlisted(place.id) ? 'bookmark.fill' : 'bookmark',
                  tint: (place && isWishlisted(place.id) ? 'primary' : 'label') as 'primary' | 'label',
                  label: place && isWishlisted(place.id) ? 'Remove from wishlist' : 'Save to wishlist',
                  onClick: () => { if (place) toggleWishlist(wishMeta); },
                  icon: <Bookmark size={16} className={place && isWishlisted(place.id) ? 'fill-primary text-primary' : ''} />,
                },
                {
                  id: 'share',
                  symbol: 'square.and.arrow.up',
                  label: 'Share',
                  onClick: () => { if (place) setChatShareTarget(buildShareTarget()); },
                  icon: <Share2 size={16} />,
                },
              ]}
            />
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
          {(() => {
            const N = photos.length;
            const prevIdx = (photoIndex - 1 + N) % N;
            const nextIdx = (photoIndex + 1) % N;
            // During a dot-initiated jump the landing photo rides the slot
            // the track is sliding toward, so a >1 jump still animates.
            return heroJump !== null && heroJump !== photoIndex
              ? (heroDragX < 0 ? [prevIdx, photoIndex, heroJump] : [heroJump, photoIndex, nextIdx])
              : [prevIdx, photoIndex, nextIdx];
          })().map((idx, slot) => (
            <button
              key={slot}
              onClick={() => { if (heroG.current.swiped) { heroG.current.swiped = false; return; } setGalleryOpen(true); }}
              // bg placeholder so a slow hero photo doesn't paint as a
              // hard white block while it decodes.
              className="relative w-1/3 h-full cursor-pointer bg-on-surface/5"
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
                      onClick={(e) => { e.stopPropagation(); heroSlideTo(i); }}
                      className="hit-44-y flex-shrink-0 h-full flex items-center justify-center"
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
              <EditableCuisineLine
                cuisine={cuisineLine}
                priceStr={priceStr}
                onEdit={() => setCuisinePickerOpen(true)}
                pending={mySuggestion?.status === 'pending'}
                credit={cuisineCredit}
                // Sentence case at a normal tracking, not wide-tracked caps.
                // "CLASSIC CUISINE · $$$$" set in spaced uppercase shouted
                // over the name it is supposed to introduce.
                className="group/cuisine mb-2 text-on-surface/45 text-[13px] font-medium tracking-normal normal-case"
              />
              <div className="flex items-start justify-between gap-3">
                <h1 className="min-w-0 flex-1 text-on-surface" style={{ fontFamily: '"Newsreader", serif', fontSize: '31px', fontWeight: 600, lineHeight: 1.05, letterSpacing: '-0.01em' }}>
                  {place.name}
                </h1>
                <div className="flex items-center gap-2.5 flex-shrink-0 mt-0.5">
                  {myRating ? (
                    <>
                      {/* Already rated → re-rate (log a new visit) is quiet,
                          and the checkmark says "you've rated this" (tap to
                          view/edit). Wishlist lives in the top bar only. */}
                      <button
                        type="button"
                        onClick={() => openAddRestaurantModal(ratingMeta, 'new-visit')}
                        aria-label="Re-rate"
                        className="hit-44 w-11 h-11 rounded-full bg-cream-2 flex items-center justify-center text-ink-2 active:scale-95 transition-transform"
                      >
                        <Star size={17} />
                      </button>
                      <button
                        type="button"
                        onClick={() => openAddRestaurantModal(ratingMeta)}
                        aria-label="You've rated this — view your rating"
                        className="hit-44 w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center text-primary active:scale-95 transition-transform"
                      >
                        <Check size={18} strokeWidth={2.5} />
                      </button>
                    </>
                  ) : (
                    /* One prominent CTA: rating is the page's main verb, and
                       the bookmark that used to sit beside it duplicated the
                       save in the top bar. Solid brand fill, soft brand
                       shadow — prominent without shouting. */
                    <button
                      type="button"
                      onClick={() => openAddRestaurantModal(wishMeta)}
                      aria-label="Add rating"
                      className="hit-44 w-11 h-11 rounded-full bg-primary text-white flex items-center justify-center shadow-lg shadow-primary/25 active:scale-95 transition-transform"
                    >
                      <Plus size={20} strokeWidth={2.2} />
                    </button>
                  )}
                </div>
              </div>
              {michelin && (
                <div className="mt-3">
                  <MichelinBadge michelin={michelin} size="sm" href={michelin.guideUrl} />
                </div>
              )}

              {/* One status line, one place line. These used to be three
                  stacked rows — address+distance, open/closed, then drive
                  and walk times — which is a lot of grey text under a name
                  for facts that belong together. */}
              {place.isOpen !== null && (
                <div className="mt-3.5 flex items-center gap-2 text-[14px]">
                  <span className={cn('inline-block w-2 h-2 rounded-full flex-shrink-0', place.isOpen ? 'bg-olive' : 'bg-clay')} />
                  {place.isOpen ? (
                    <span className="text-on-surface/65">
                      <span className="font-semibold text-olive">Open</span>
                      {(() => {
                        const line = getTodayHours(place.hours);
                        const close = line.split(/\s*[–-]\s*/)[1];
                        return close ? <span> · closes {close.trim()}</span> : null;
                      })()}
                    </span>
                  ) : (
                    <span className="text-on-surface/65">
                      <span className="font-semibold text-clay">Closed</span>
                      {(() => {
                        const next = getNextOpenLabel(place.hours, restaurantLocalNow(place.lng));
                        return next ? <span> · opens {next}</span> : null;
                      })()}
                    </span>
                  )}
                </div>
              )}

              <div className="mt-2 flex items-center gap-1.5 min-w-0 text-[14px] text-on-surface/60">
                <MapPin size={14} className="text-primary/70 flex-shrink-0" />
                <span className="truncate">{place.address}</span>
                {dist && <><span className="text-on-surface/25 flex-shrink-0">·</span><span className="flex-shrink-0">{dist}</span></>}
                {driveLabel && <><span className="text-on-surface/25 flex-shrink-0">·</span><span className="inline-flex items-center gap-1 flex-shrink-0"><Car size={13} className="text-on-surface/40" />{driveLabel}</span></>}
                {!driveLabel && walkLabel && <><span className="text-on-surface/25 flex-shrink-0">·</span><span className="inline-flex items-center gap-1 flex-shrink-0"><Footprints size={13} className="text-on-surface/40" />{walkLabel}</span></>}
              </div>
            </section>
          );
        })()}

        {/* ── Actions — a fixed row, not a scroller. There were five chips
            in a horizontally-scrolling strip, which hid whichever ones did
            not fit and put Share one tap from the Share already in the
            header. What is left is the three things you leave the app to
            do, plus the Michelin link when there is one. ── */}
        {(() => {
          const actions = [
            { Icon: Phone, label: 'Call', href: place.phone ? `tel:${place.phone}` : null },
            // Route goes through openExternalUrl so native hands off to the
            // Maps app instead of bouncing the tap through Safari.
            { Icon: Navigation, label: 'Route', onClick: directionsUrl ? () => { void openExternalUrl(directionsUrl); } : undefined, href: directionsUrl || null },
            { Icon: Globe, label: 'Website', href: place.website || null, external: true },
            ...(michelin ? [{ Icon: Award, label: 'Michelin', href: michelin.guideUrl, external: true, accent: true }] : []),
          ] as any[];
          const base = 'flex-1 flex flex-col items-center justify-center gap-1.5 py-3 rounded-2xl active:scale-[0.97] transition-transform';
          return (
            <div className="flex gap-2 mt-6">
              {actions.map(({ Icon, label, href, external, onClick, accent }) => {
                const inner = (
                  <>
                    <Icon size={17} className={accent ? 'text-primary' : 'text-ink-2'} />
                    <span style={{ fontSize: '12px', fontWeight: 600 }}>{label}</span>
                  </>
                );
                const cls = cn(base, accent ? 'bg-primary/8 text-primary' : 'bg-cream-2 text-ink-2');
                if (onClick) return <button key={label} type="button" onClick={onClick} className={cls}>{inner}</button>;
                if (!href) return <div key={label} className={cn(base, 'bg-cream-2 text-ink-4 opacity-45')}>{inner}</div>;
                return (
                  <a key={label} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className={cls}>
                    {inner}
                  </a>
                );
              })}
            </div>
          );
        })()}

        {/* ── Ratings — three token-tinted score rings over a quiet Google
            line. No surrounding card. ── */}
        {(() => {
          const expertAvg = expertRecommendations.length > 0
            ? expertRecommendations.reduce((sum, r) => sum + Number(r.rating), 0) / expertRecommendations.length
            : 0;
          const expertCount = expertRecommendations.length;
          const hasCommunity = communityStats.totalRatings > 0;
          const hasFriends = friendsStats.totalRatings > 0;
          const hasExperts = expertCount > 0;
          const hasGoogle = Number(place.rating) > 0 && place.userRatingCount > 0;

          // Token-tinted rings, not glossy discs. The old circles were
          // saturated traffic-light gradients with hard-coded green/red
          // glows — the loudest thing on a page whose palette is warm cream
          // and rust. A soft tint fill, a hairline ring in the tier colour,
          // and the score in the tier's ink reads calmer, and every value
          // comes from the same tokens the rest of the app scores with.
          const Col = ({ label, score, count, countLabel, emptyCopy, onClick }: {
            label: string; score: number | null; count: number; countLabel: string; emptyCopy: string; onClick?: () => void;
          }) => {
            const tint = score != null ? scoreTintStyle(score) : null;
            const body = (
              <>
                {score != null && tint ? (
                  <div
                    className="w-[58px] h-[58px] rounded-full flex items-center justify-center"
                    style={{ background: tint.background, boxShadow: `inset 0 0 0 1.5px ${tint.ring}` }}
                  >
                    <span className="tabular-nums" style={{ color: tint.color, fontSize: '18px', fontWeight: 700, letterSpacing: '0.2px' }}>{score.toFixed(1)}</span>
                  </div>
                ) : (
                  <div className="w-[58px] h-[58px] rounded-full bg-cream-2 flex items-center justify-center" style={{ boxShadow: 'inset 0 0 0 1px var(--color-line)' }}>
                    <span className="text-ink-4" style={{ fontSize: '18px', fontWeight: 600 }}>—</span>
                  </div>
                )}
                <span className="section-eyebrow mt-[11px]" style={{ fontSize: '9px' }}>{label}</span>
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
            <section className="mt-9">
              <p className="section-eyebrow mb-[18px]">Ratings</p>
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
                /* A footnote to the three scores above, not a fourth block:
                   Google's five-point scale is a different measure and reads
                   as one quiet line saying so. */
                <p className="mt-5 flex items-center gap-1.5 text-on-surface/50" style={{ fontSize: '13px' }}>
                  <Star size={13} className="fill-score-mid text-score-mid" />
                  <span className="text-on-surface/75 tabular-nums" style={{ fontWeight: 600 }}>{place.rating}</span>
                  <span>on Google · {formatReviewCount(place.userRatingCount)} reviews</span>
                </p>
              )}
            </section>
          );
        })()}

        {/* ── Your rating — one section for everything you have recorded
            here: the score, what you wrote, and every earlier visit.
            This used to be three. "My rating" was a collapsible holding a
            Score / Price / Visited tri-panel above four editor
            sub-sections; "Visit history" was a timeline that showed the
            same notes, tags, photos and dates again in a different
            layout; the comments sat between them. Two layouts for one set
            of facts is the definition of clutter, so they are one thing
            now — a summary you can read at a glance, an Edit that opens
            the editor that already exists, and the earlier visits folded
            away until you want them. ── */}
        {myRating && place && (() => {
          const meta = { id: place.id, name: place.name, image: place.photoUrl || '', cuisine, price: priceStr, address: place.fullAddress || place.address };
          type RatingPage = 'main' | 'notes' | 'tags' | 'photos' | 'price' | 'date' | 'friends';
          const openAt = (pg: RatingPage) => openAddRestaurantModal(meta, pg);
          const dateLabel = parseVisitDate(myRating.visitDate)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) ?? null;
          const companions = (myRating.friendIds || []).map((fid) => friendNames[fid] || fid.slice(0, 8));
          const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const earlier = [...visitHistory]
            .map((v) => ({ id: v.id, score: v.score, date: parseVisitDate(v.visit_date), notes: v.notes, tags: v.tags, photos: v.photos }))
            .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
          // The facts under the score, joined rather than stacked.
          const facts = [dateLabel && `Visited ${dateLabel}`, myRating.price, companions.length ? `with ${companions.join(', ')}` : null].filter(Boolean);

          return (
            <section ref={myRatingRef} className="mt-9 scroll-mt-4">
              <div className="flex items-center justify-between mb-4">
                <p className="section-eyebrow">Your rating</p>
                <div className="flex items-center gap-4">
                  <button onClick={() => openAddRestaurantModal(meta, 'new-visit')} className="inline-flex items-center gap-1.5 text-primary active:opacity-70 transition-opacity" style={{ fontSize: '13px', fontWeight: 600 }}>
                    <Star size={13} /> Re-rate
                  </button>
                  <button onClick={() => openAt('main')} className="inline-flex items-center gap-1.5 text-ink-3 active:opacity-70 transition-opacity" style={{ fontSize: '13px', fontWeight: 600 }}>
                    <Edit3 size={13} /> Edit
                  </button>
                </div>
              </div>

              {/* Score, then the facts about the visit on one line. */}
              <button onClick={() => openAt('main')} className="flex items-baseline gap-2.5 text-left active:opacity-70 transition-opacity">
                <span className={cn('font-serif', scoreColor(myRating.score))} style={{ fontSize: '34px', fontWeight: 600, lineHeight: 1 }}>
                  {scoresUnlocked ? myRating.score.toFixed(1) : TIER_LABELS[tierOfScore(myRating.score)]}
                </span>
                {scoresUnlocked && <span className="text-ink-4" style={{ fontSize: '14px' }}>/ 10</span>}
              </button>
              {facts.length > 0 && (
                <p className="mt-2 text-ink-3" style={{ fontSize: '13px' }}>{facts.join(' · ')}</p>
              )}

              {/* What you wrote. */}
              {myRating.notes ? (
                <p className="mt-3 italic text-ink-2 font-serif" style={{ fontSize: '16px', lineHeight: 1.55 }}>&ldquo;{myRating.notes}&rdquo;</p>
              ) : (
                <button onClick={() => openAt('notes')} className="mt-3 block italic text-ink-3 active:text-ink-2 transition-colors" style={{ fontSize: '14px' }}>Add notes…</button>
              )}

              {(myRating.tags?.length || 0) > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {myRating.tags.map((t) => (
                    <span key={t} className="text-xs font-medium px-2.5 py-1 rounded-full bg-cream-2 text-ink-2">{t}</span>
                  ))}
                </div>
              )}

              {(myRating.photos?.length || 0) > 0 && (
                <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar -mx-[18px] px-[18px] snap-x snap-mandatory">
                  {myRating.photos.map((ph, i) => (
                    <img key={i} src={ph.url} className="w-24 h-24 rounded-xl object-cover flex-shrink-0 snap-start" referrerPolicy="no-referrer" />
                  ))}
                </div>
              )}

              {/* Earlier visits — the old timeline, folded away. Each row
                  is date, score and the note; tapping opens the rest. */}
              {earlier.length > 0 && (
                <div className="mt-5 pt-4 border-t border-line">
                  <button
                    type="button"
                    onClick={() => setEarlierVisitsOpen(!earlierVisitsOpen)}
                    className="w-full flex items-center justify-between text-left active:opacity-70 transition-opacity"
                  >
                    <span className="text-ink-2" style={{ fontSize: '13px', fontWeight: 600 }}>
                      {earlier.length} earlier {earlier.length === 1 ? 'visit' : 'visits'}
                    </span>
                    <ChevronDown size={15} className={cn('text-ink-3 transition-transform duration-200', earlierVisitsOpen && 'rotate-180')} />
                  </button>
                  <AnimatePresence>
                    {earlierVisitsOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                        <ul className="divide-y divide-line">
                          {earlier.map((e) => {
                            const isExpanded = expandedVisit === e.id;
                            const month = e.date ? MONTHS[e.date.getMonth()].toUpperCase() : '—';
                            const day = e.date ? e.date.getDate() : '';
                            return (
                              <li key={e.id}>
                                <button type="button" onClick={() => setExpandedVisit(isExpanded ? null : e.id)} className="w-full flex items-center gap-3 py-3 text-left active:opacity-70 transition-opacity">
                                  <div className="flex-shrink-0 w-10 flex flex-col items-center">
                                    <span className="text-ink-4 leading-none" style={{ fontSize: '9px', letterSpacing: '0.1em' }}>{month}</span>
                                    <span className="text-ink-2 leading-none mt-1 tabular-nums font-serif" style={{ fontSize: '15px' }}>{day}</span>
                                  </div>
                                  <p className={cn('flex-1 min-w-0 truncate', e.notes ? 'italic text-ink-2 font-serif' : 'text-ink-4')} style={{ fontSize: '13px' }}>
                                    {e.notes ? `“${e.notes}”` : 'No notes'}
                                  </p>
                                  <span className={cn('flex-shrink-0 inline-flex items-center h-7 px-2.5 rounded-lg tabular-nums', softChip(e.score))} style={{ fontSize: '13px', fontWeight: 700 }}>
                                    {e.score.toFixed(1)}
                                  </span>
                                </button>
                                <AnimatePresence>
                                  {isExpanded && (
                                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                                      <div className="pb-3 pl-[52px] space-y-2.5">
                                        {e.tags && e.tags.length > 0 && (
                                          <div className="flex flex-wrap gap-1.5">
                                            {e.tags.map((t) => (<span key={t} className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-cream-2 text-ink-2">{t}</span>))}
                                          </div>
                                        )}
                                        {e.photos && e.photos.length > 0 && (
                                          <div className="flex gap-1.5 overflow-x-auto no-scrollbar snap-x snap-mandatory">
                                            {e.photos.slice(0, 6).map((ph, i) => (<img key={i} src={ph.url} className="w-16 h-16 rounded-lg object-cover flex-shrink-0 snap-start" referrerPolicy="no-referrer" />))}
                                          </div>
                                        )}
                                        {confirmDeleteVisitId === e.id ? (
                                          <div className="flex items-center justify-between gap-2 bg-score-low-tint border border-score-low/25 rounded-lg px-3 py-2">
                                            <p className="text-xs font-medium text-score-low-ink">Delete this visit?</p>
                                            <div className="flex gap-1.5">
                                              <button type="button" onClick={() => setConfirmDeleteVisitId(null)} className="px-2.5 py-1 text-[11px] font-semibold text-ink-2 border border-line rounded-md bg-paper">Cancel</button>
                                              <button type="button" onClick={() => { if (!place) return; deleteVisit(place.id, e.id); setConfirmDeleteVisitId(null); setExpandedVisit(null); }} className="px-2.5 py-1 text-[11px] font-semibold text-white bg-score-low rounded-md">Delete</button>
                                            </div>
                                          </div>
                                        ) : (
                                          <button type="button" onClick={() => setConfirmDeleteVisitId(e.id)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-score-low-ink active:opacity-70 transition-opacity">
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
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </section>
          );
        })()}

        {/* Likes + comments friends left on your rating. */}
        {myRating && place && (
          <YourReviewComments restaurantId={place.id} variant="mobile" className="mt-8" />
        )}

        {/* ── From your circle — one row per friend: monogram avatar, name,
            a one-line taste of their note, their score chip, and a chevron
            into the full review (which owns likes, replies and photos). ── */}
        {(() => {
          const ratings = friendsStats.ratings;
          const hasFriends = ratings.length > 0;
          const SHOWN = 4;
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
              <section className="mt-9">
                <button
                  type="button"
                  onClick={() => (hasFriends || expertRecommendations.length > 0) && navigate(`/restaurant/${place.id}/circle`)}
                  className="w-full flex items-center justify-between mb-4 active:opacity-70 transition-opacity"
                >
                  <span className="section-eyebrow text-primary">From your circle</span>
                  {ratings.length > SHOWN && (
                    <span className="inline-flex items-center gap-1 text-primary" style={{ fontSize: '13px', fontWeight: 600 }}>
                      See all {ratings.length}
                      <ChevronRight size={14} />
                    </span>
                  )}
                </button>

                {hasFriends ? (
                  /* Uniform rows, no accordion: who rated it, their score, and
                     one tap into the full review (where likes + replies live). */
                  <div className="rounded-[16px] bg-paper overflow-hidden" style={{ boxShadow: 'inset 0 0 0 1px var(--color-line)' }}>
                    {ratings.slice(0, SHOWN).map((r, i) => {
                      const name = nameOf(r);
                      const recency = recencyOf(r);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => navigate(`/review/${r.id}`)}
                          className={cn(
                            'w-full flex items-center gap-3 px-3.5 py-3.5 text-left active:bg-on-surface/[0.03] transition-colors',
                            i > 0 && 'border-t border-line',
                          )}
                        >
                          <Avatar name={name} size={42} />
                          <div className="flex-1 min-w-0">
                            <p className="text-on-surface truncate" style={{ fontFamily: '"Newsreader", serif', fontSize: '16.5px', fontWeight: 600, lineHeight: 1.15 }}>
                              {name}
                            </p>
                            <p className="text-on-surface/45 mt-0.5 truncate" style={{ fontSize: '12.5px' }}>
                              {r.notes
                                ? <span className="italic" style={{ fontFamily: '"Newsreader", serif', fontSize: '13.5px' }}>"{r.notes}"</span>
                                : recency ? `Visited ${recency}` : 'Rated this'}
                            </p>
                          </div>
                          <span className={cn('flex-shrink-0 inline-flex items-center h-[30px] px-3 rounded-[9px] tabular-nums', softChip(Number(r.score)))} style={{ fontSize: '14px', fontWeight: 700 }}>
                            {Number(r.score).toFixed(1)}
                          </span>
                          <ChevronRight size={16} className="text-on-surface/25 flex-shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  /* One line, not a bordered box with an icon in it. An empty
                     state should take the room its message needs. */
                  <p className="text-on-surface/45" style={{ fontSize: '13.5px' }}>
                    No friends have rated this yet ·{' '}
                    <button
                      type="button"
                      onClick={() => setChatShareTarget(buildShareTarget())}
                      className="text-primary active:opacity-70 transition-opacity"
                      style={{ fontWeight: 600 }}
                    >
                      Share with a friend
                    </button>
                  </p>
                )}
              </section>
            </>
          );
        })()}

        {/* ── Expert Picks — editorial list of authoritative reviews. ── */}
        {expertRecommendations.length > 0 && (
          <>
            <section className="mt-9">
              <p className="section-eyebrow mb-4">Verified picks</p>
              <ul className="rounded-2xl bg-paper border border-line divide-y divide-line overflow-hidden">
                {expertRecommendations.map((rec) => {
                  const isExpanded = expandedExpertId === rec.id;
                  // The row is a plain div: the profile Link and the expand
                  // toggle are SIBLINGS, not a Link nested inside a button —
                  // that's invalid HTML, and iOS taps could both navigate
                  // and toggle at once.
                  return (
                    <li key={rec.id} className="px-4 py-4">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link to={`/user/${rec.expert_username}`} className="text-[15px] font-serif font-bold text-on-surface hover:text-primary truncate">
                              {rec.expert_name}
                            </Link>
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.15em] text-primary"><VerifiedBadge size={11} inline />Verified</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setExpandedExpertId(isExpanded ? null : rec.id)}
                            aria-expanded={isExpanded}
                            className="block w-full text-left active:opacity-70 transition-opacity"
                          >
                            <p className={cn('text-[13px] mt-1 leading-relaxed text-on-surface/70', isExpanded ? '' : 'line-clamp-2')}>{rec.recommendation_text}</p>
                          </button>
                        </div>
                        <div className={cn('flex-shrink-0 w-11 h-7 rounded-md flex items-center justify-center', chipBg(Number(rec.rating)))}>
                          <span className="text-[13px] font-bold text-white tabular-nums">{Number(rec.rating).toFixed(1)}</span>
                        </div>
                      </div>
                      <AnimatePresence>
                        {isExpanded && rec.highlight_dishes && rec.highlight_dishes.length > 0 && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                            <div className="pt-3">
                              <p className="section-eyebrow mb-2">Highlight dishes</p>
                              <div className="flex flex-wrap gap-1.5">
                                {rec.highlight_dishes.map((dish) => (<span key={dish} className="text-xs font-medium px-2.5 py-1 rounded-full bg-primary/8 text-primary">{dish}</span>))}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}

        {/* ── More from {name} — reels / posts featuring this restaurant. ── */}
        <RestaurantFeaturedReels
          restaurantId={place.id}
          restaurantName={place.name}
          size="md"
          className="mt-9"
        />

        {/* ── Hours — flat accordion with today's status inline. ── */}
        {place.hours.length > 0 && (
          <>
            <section className="mt-9">
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

        {/* Location eyebrow sits inside the padded main; the map below
            breaks out of the page gutter to bleed edge-to-edge. */}
        <p className="section-eyebrow mt-9 mb-3">Location</p>
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
      </section>

      {/* Safe-area spacer — the page used to end flush with the map, which
          put the address pill and Mapbox attribution under the iPhone home
          indicator (the bottom nav is hidden on /restaurant/*). */}
      <div className="bg-surface pb-safe" aria-hidden="true" />

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
                    <div key={r.id} className="bg-paper rounded-xl border border-line p-3">
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

      {/* Correcting the cuisine — the only thing that can write the `user`
          tier of the shared cache, so it's what fixes a wrong label (or the
          app's own guess) for everybody. */}
      <CuisinePicker
        open={cuisinePickerOpen}
        onClose={() => setCuisinePickerOpen(false)}
        onSelect={async (c) => {
          const res = await suggestCuisine(c);
          if (res.ok) showToast('Sent for review', { subtitle: `You suggested ${c} — an admin will take a look` });
          else showToast(res.error || 'Could not send that suggestion');
          return res.ok;
        }}
        current={cuisines}
        restaurantName={place?.name}
        pending={mySuggestion?.status === 'pending' ? mySuggestion.cuisine : undefined}
      />

    </div>
  );
};
