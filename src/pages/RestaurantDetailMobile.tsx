import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Star, MapPin, Clock, Phone, Globe,
  ChevronLeft, ChevronRight, ChevronDown, Loader2,
  Navigation, ExternalLink, X, Users, UserCircle, Share2, Bookmark,
  DollarSign, CalendarDays, Tag, Image, Edit3, Check, Send, Building2, TrendingUp, TrendingDown, StickyNote, Trash2, ImageOff,
  Car, Footprints, Award, Images, Plus, Utensils,
} from 'lucide-react';
import { cn, parseVisitDate } from '../lib/utils';
import { Collapse } from '../components/Collapse';
import { GlassButton, GlassGroup } from '../lib/glass-buttons';
import { FriendReviewSheet, FriendAvatar } from '../components/FriendReviewSheet';
import { tierOfScore } from '../lib/settleScores';
import { TIER_LABELS } from '../lib/headToHeadRating';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { CuisinePicker, EditableCuisineLine } from '../components/CuisinePicker';
import { scoreColor, scoreChipBg, scoreTint } from '../lib/score';
import { ScoreBadge } from '../components/ScoreBadge';
import { useRestaurantDetail, formatReviewCount, getTodayHours, getCuisineLabel } from './useRestaurantDetail';
import { MichelinBadge } from '../components/MichelinBadge';
import { useLists } from '../contexts/ListsContext';
import { useToast } from '../contexts/ToastContext';
import { useChat, type SharedRestaurant } from '../contexts/ChatContext';
import { ShareDialog } from '../components/ShareDialog';
import { useAuth } from '../contexts/AuthContext';
import { getProfilesByIds, getCommunityStats, type UserProfile as UP, type CommunityRating } from '../lib/supabase-community';
import { priceLevelToString } from '../lib/places';
import { loadLastSelectedLocation, isExactAddress } from '../components/HomeLocationBar';
import { haversineDistanceMi, formatDistance } from '../lib/distance';
import { useTravelTimes, formatTravelTime } from '../lib/directions';
import { openExternalUrl } from '../lib/external-links';
import { Link } from 'react-router-dom';
import { PhotoGallery } from '../components/PhotoGallery';
import { RestaurantFeaturedReels } from '../components/RestaurantFeaturedReels';
import { YourReviewComments } from '../components/YourReviewComments';
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

/* ── Editorial furniture ──────────────────────────────────────────────
   A section opens with a hairline and its name in sentence case. What
   this replaces is the mono all-caps eyebrow — "FROM YOUR CIRCLE" set in
   spaced capitals announced every heading at the same volume as the
   restaurant's own name, and there are six of them down the page. The
   rule does the separating; the heading only has to say what follows. */
const SECTION_TITLE_STYLE: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 700,
  lineHeight: 1.15,
  letterSpacing: '-0.022em',
};

const SectionRule: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn('border-t border-on-surface/[0.14]', className)} aria-hidden />
);

const SectionTitle: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <h2 className={cn('text-on-surface', className)} style={SECTION_TITLE_STYLE}>{children}</h2>
);

/** A fact with a label column — "TODAY  · Open · closes 9:30 PM". */
const MetaRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-baseline gap-4">
    <span
      className="flex-none w-[58px] text-on-surface/40"
      style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}
    >
      {label}
    </span>
    <span className="flex-1 min-w-0" style={{ fontSize: '14px' }}>{children}</span>
  </div>
);

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
  // The friend's review being read — rendered as a sheet over this page
  // rather than as the /review/:id screen the rows used to push.
  const [openReview, setOpenReview] = useState<CommunityRating | null>(null);
  // Your rating folds away; the score rides up next to the heading when
  // it does, so closing the section never hides the answer.
  const [myRatingOpen, setMyRatingOpen] = useState(true);
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
    <div className="min-h-screen bg-cream type-archivo">

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
      <main className="pt-5" style={{ paddingLeft: 22, paddingRight: 22 }}>

        {/* ── Identity — cuisine · price over the name, and the two circles
            that say what you have done about this place. Then the facts as
            a label column: what it is doing today, and where it is. Those
            were three stacked grey lines under the name; a label column
            reads as a record instead of as filler. ── */}
        {(() => {
          const dist = homeLocationForDistance && destForDistance
            ? formatDistance(haversineDistanceMi(homeLocationForDistance.lat, homeLocationForDistance.lng, destForDistance.lat, destForDistance.lng))
            : '';
          const circle = 'hit-44 w-10 h-10 rounded-full border flex items-center justify-center active:opacity-80 transition-opacity';
          const on = 'bg-primary/10 border-primary/35 text-primary';
          const off = 'bg-transparent border-on-surface/20 text-on-surface';
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
                className="group/cuisine mb-3 text-on-surface/45 text-[13.5px] font-medium tracking-normal normal-case"
              />
              <div className="flex items-start justify-between gap-3.5">
                <h1 className="min-w-0 flex-1 text-on-surface" style={{ fontSize: '30px', fontWeight: 700, lineHeight: 1.08, letterSpacing: '-0.035em' }}>
                  {place.name}
                </h1>
                <div className="flex items-center gap-[7px] flex-shrink-0 mt-0.5">
                  {myRating ? (
                    <>
                      {/* Already rated → re-rate (log a new visit) is quiet,
                          and the checkmark says "you've rated this" (tap to
                          view/edit). Wishlist lives in the top bar only. */}
                      <button
                        type="button"
                        onClick={() => openAddRestaurantModal(ratingMeta, 'new-visit')}
                        aria-label="Re-rate"
                        className={cn(circle, off)}
                      >
                        <Star size={17} />
                      </button>
                      <button
                        type="button"
                        onClick={() => openAddRestaurantModal(ratingMeta)}
                        aria-label="You've rated this — view your rating"
                        className={cn(circle, on)}
                      >
                        <Check size={18} strokeWidth={2.2} />
                      </button>
                    </>
                  ) : (
                    /* One CTA: rating is the page's main verb, and the
                       bookmark that used to sit beside it duplicated the
                       save in the top bar. */
                    <button
                      type="button"
                      onClick={() => openAddRestaurantModal(wishMeta)}
                      aria-label="Add rating"
                      className={cn(circle, on)}
                    >
                      <Plus size={19} strokeWidth={2.2} />
                    </button>
                  )}
                </div>
              </div>
              {michelin && (
                <div className="mt-3.5">
                  <MichelinBadge michelin={michelin} size="sm" href={michelin.guideUrl} />
                </div>
              )}

              <div className="mt-5 flex flex-col gap-3">
                {place.isOpen !== null && (
                  <MetaRow label="Today">
                    <span className="flex items-center gap-2">
                      <span className={cn('inline-block w-[7px] h-[7px] rounded-full flex-shrink-0', place.isOpen ? 'bg-olive' : 'bg-clay')} />
                      {place.isOpen ? (
                        <span className="text-on-surface/55">
                          <span className="font-semibold text-olive">Open</span>
                          {(() => {
                            const line = getTodayHours(place.hours);
                            const close = line.split(/\s*[–-]\s*/)[1];
                            return close ? <span> · closes {close.trim()}</span> : null;
                          })()}
                        </span>
                      ) : (
                        <span className="text-on-surface/55">
                          <span className="font-semibold text-clay">Closed</span>
                          {(() => {
                            const next = getNextOpenLabel(place.hours, restaurantLocalNow(place.lng));
                            return next ? <span> · opens {next}</span> : null;
                          })()}
                        </span>
                      )}
                    </span>
                  </MetaRow>
                )}
                <MetaRow label="Where">
                  <span className="flex items-center gap-1.5 min-w-0 text-on-surface/80">
                    <span className="truncate">{place.address}</span>
                    {dist && <><span className="text-on-surface/25 flex-shrink-0">·</span><span className="flex-shrink-0 text-on-surface/55">{dist}</span></>}
                    {driveLabel && <><span className="text-on-surface/25 flex-shrink-0">·</span><span className="inline-flex items-center gap-1 flex-shrink-0 text-on-surface/55"><Car size={13} />{driveLabel}</span></>}
                    {!driveLabel && walkLabel && <><span className="text-on-surface/25 flex-shrink-0">·</span><span className="inline-flex items-center gap-1 flex-shrink-0 text-on-surface/55"><Footprints size={13} />{walkLabel}</span></>}
                  </span>
                </MetaRow>
              </div>
            </section>
          );
        })()}

        {/* ── Quick actions — a pill row. Each of these leaves the app, so
            they read as controls rather than as tiles: icon and word on
            one line, an outline instead of a fill, and the row scrolls
            rather than squeezing four labels into a phone's width. ── */}
        {(() => {
          const actions = [
            { Icon: Phone, label: 'Call', href: place.phone ? `tel:${place.phone}` : null },
            // Route goes through openExternalUrl so native hands off to the
            // Maps app instead of bouncing the tap through Safari.
            { Icon: Navigation, label: 'Route', onClick: directionsUrl ? () => { void openExternalUrl(directionsUrl); } : undefined, href: directionsUrl || null },
            { Icon: Globe, label: 'Website', href: place.website || null, external: true },
            ...(michelin ? [{ Icon: Award, label: 'Michelin', href: michelin.guideUrl, external: true, accent: true }] : []),
          ] as any[];
          const base = 'flex-none inline-flex items-center gap-2 rounded-full border px-4 py-[11px] active:opacity-80 transition-opacity';
          const font = { fontSize: '12.5px', fontWeight: 700 } as React.CSSProperties;
          return (
            <div className="mt-6 -mx-[22px] px-[22px] flex gap-2 overflow-x-auto no-scrollbar">
              {actions.map(({ Icon, label, href, external, onClick, accent }) => {
                const inner = (<><Icon size={15} />{label}</>);
                const cls = cn(base, accent ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-transparent border-on-surface/20 text-on-surface');
                if (onClick) return <button key={label} type="button" onClick={onClick} className={cls} style={font}>{inner}</button>;
                if (!href) return <div key={label} className={cn(base, 'border-on-surface/12 text-on-surface/30')} style={font}>{inner}</div>;
                return (
                  <a key={label} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className={cls} style={font}>
                    {inner}
                  </a>
                );
              })}
            </div>
          );
        })()}

        {/* ── Ratings — everyone, your friends, the experts. Three tinted
            discs, centred over a name and a count. The tint and the ink
            come from the score itself, not from which column it sits in:
            a column can't be "the good one" — only a number can, and the
            same tier palette colours every score on every page. Google's
            five-point average is a different measure, so it sits beside
            the heading as a footnote rather than as a fourth disc
            pretending to be comparable. ── */}
        {(() => {
          const expertAvg = expertRecommendations.length > 0
            ? expertRecommendations.reduce((sum, r) => sum + Number(r.rating), 0) / expertRecommendations.length
            : 0;
          const expertCount = expertRecommendations.length;
          const hasCommunity = communityStats.totalRatings > 0;
          const hasFriends = friendsStats.totalRatings > 0;
          const hasExperts = expertCount > 0;
          const hasGoogle = Number(place.rating) > 0 && place.userRatingCount > 0;

          const Disc = ({ label, score, meta, onClick }: {
            label: string; score: number | null; meta: string; onClick?: () => void;
          }) => {
            const body = (
              <>
                <span
                  className={cn(
                    'w-[72px] h-[72px] rounded-full flex items-center justify-center tabular-nums',
                    score != null ? scoreTint(score) : 'bg-on-surface/[0.06] text-on-surface/30',
                  )}
                  style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-0.01em' }}
                >
                  {score != null ? score.toFixed(1) : '—'}
                </span>
                <span className="mt-3 text-on-surface" style={{ fontSize: '14px', fontWeight: 700 }}>{label}</span>
                <span className={cn('mt-1.5', score != null ? 'text-on-surface/50' : 'text-on-surface/35')} style={{ fontSize: '13px' }}>{meta}</span>
              </>
            );
            const cls = 'flex-1 min-w-0 flex flex-col items-center text-center';
            return onClick
              ? <button type="button" onClick={onClick} className={cn(cls, 'active:opacity-70 transition-opacity')}>{body}</button>
              : <div className={cls}>{body}</div>;
          };

          return (
            <section className="mt-8">
              <SectionRule />
              <div className="pt-3 flex items-center justify-between gap-3">
                <SectionTitle>Ratings</SectionTitle>
                {hasGoogle && (
                  <p className="flex-none flex items-center gap-1.5 text-on-surface/45" style={{ fontSize: '12px' }}>
                    <span className="text-on-surface tabular-nums" style={{ fontWeight: 700 }}>{place.rating}</span>
                    on Google · {formatReviewCount(place.userRatingCount)}
                  </p>
                )}
              </div>
              <div className="mt-6 flex gap-2">
                <Disc
                  label="Everyone"
                  score={hasCommunity ? communityStats.avgScore : null}
                  meta={hasCommunity ? `${communityStats.totalRatings.toLocaleString()} ${communityStats.totalRatings === 1 ? 'rating' : 'ratings'}` : 'Be the first'}
                />
                <Disc
                  label="Friends"
                  score={hasFriends ? friendsStats.avgScore : null}
                  meta={hasFriends ? `${friendsStats.totalRatings} ${friendsStats.totalRatings === 1 ? 'rating' : 'ratings'}` : 'None yet'}
                  onClick={hasFriends ? () => navigate(`/restaurant/${place.id}/circle`) : undefined}
                />
                <Disc
                  label="Experts"
                  score={hasExperts ? expertAvg : null}
                  meta={hasExperts ? `${expertCount} ${expertCount === 1 ? 'pick' : 'picks'}` : 'No picks'}
                />
              </div>
            </section>
          );
        })()}

        {/* ── Your rating — one section for everything you have recorded
            here: the score, what you wrote, the dishes and the date, and
            every earlier visit. This used to be three: "My rating" was a
            collapsible holding a Score / Price / Visited tri-panel above
            four editor sub-sections; "Visit history" was a timeline that
            showed the same notes, tags, photos and dates again in a
            different layout; the comments sat between them. Two layouts
            for one set of facts is the definition of clutter. ── */}
        {place && (() => {
          const meta = { id: place.id, name: place.name, image: place.photoUrl || '', cuisine, price: priceStr, address: place.fullAddress || place.address };
          type RatingPage = 'main' | 'notes' | 'tags' | 'photos' | 'price' | 'date' | 'friends' | 'favorite-dishes';
          const openAt = (pg: RatingPage) => openAddRestaurantModal(meta, pg);
          const dateLabel = myRating ? (parseVisitDate(myRating.visitDate)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) ?? null) : null;
          const companions = ((myRating?.friendIds) || []).map((fid) => friendNames[fid] || fid.slice(0, 8));
          const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const earlier = [...visitHistory]
            .map((v) => ({ id: v.id, score: v.score, date: parseVisitDate(v.visit_date), notes: v.notes, tags: v.tags, photos: v.photos }))
            .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
          // The facts under the score, joined rather than stacked.
          const facts = [dateLabel && `Visited ${dateLabel}`, myRating?.price, companions.length ? `with ${companions.join(', ')}` : null].filter(Boolean);
          const myPhotos = myRating?.photos || [];
          const mineSummary = [
            myPhotos.length ? `${myPhotos.length} ${myPhotos.length === 1 ? 'photo' : 'photos'}` : null,
            myRating?.notes ? 'note' : null,
          ].filter(Boolean).join(' · ');
          const detailRows: { icon: React.ReactNode; label: string; value: string; page: RatingPage }[] = [
            { icon: <Utensils size={16} />, label: 'Favorite dishes', value: (myRating?.favoriteDishes || []).join(', '), page: 'favorite-dishes' },
            { icon: <Tag size={16} />, label: 'Tags', value: (myRating?.tags || []).join(', '), page: 'tags' },
            { icon: <Users size={16} />, label: 'Tag friends', value: companions.join(', '), page: 'friends' },
            { icon: <CalendarDays size={16} />, label: 'Visit date', value: dateLabel ? dateLabel.replace(/, \d{4}$/, '') : '', page: 'date' },
          ];

          return (
            <section ref={myRatingRef} className="mt-8 scroll-mt-4">
              <SectionRule />
              <div className="pt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMyRatingOpen(!myRatingOpen)}
                  className="flex-1 min-w-0 flex items-center gap-2.5 text-left active:opacity-70 transition-opacity"
                >
                  <SectionTitle className="flex-none">Your rating</SectionTitle>
                  {/* The score follows the heading up when the section is
                      folded, so closing it never hides the answer. */}
                  {myRating && !myRatingOpen && (
                    <span
                      className="flex-none rounded-full bg-primary/10 text-primary px-2.5 py-1.5"
                      style={{ fontSize: '12.5px', fontWeight: 700 }}
                    >
                      {scoresUnlocked ? myRating.score.toFixed(1) : TIER_LABELS[tierOfScore(myRating.score)]}
                    </span>
                  )}
                  <ChevronDown size={16} className={cn('flex-none text-on-surface/40 transition-transform duration-200', myRatingOpen && 'rotate-180')} />
                </button>
                {myRating && myRatingOpen && (
                  <div className="flex-none flex gap-[7px]">
                    <button
                      type="button"
                      onClick={() => openAddRestaurantModal(meta, 'new-visit')}
                      className="rounded-full bg-primary/10 text-primary px-3 py-2 active:opacity-75 transition-opacity"
                      style={{ fontSize: '12px', fontWeight: 700 }}
                    >
                      Re-rate
                    </button>
                    <button
                      type="button"
                      onClick={() => openAt('main')}
                      className="rounded-full bg-on-surface/[0.07] text-on-surface px-3 py-2 active:opacity-75 transition-opacity"
                      style={{ fontSize: '12px', fontWeight: 700 }}
                    >
                      Edit
                    </button>
                  </div>
                )}
              </div>

              <Collapse open={myRatingOpen}>
                {myRating ? (
                  <>
                    <div className="pt-[18px]">
                      <button onClick={() => openAt('main')} className="flex items-baseline gap-2 text-left active:opacity-70 transition-opacity">
                        <span className={scoreColor(myRating.score)} style={{ fontSize: '40px', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.045em' }}>
                          {scoresUnlocked ? myRating.score.toFixed(1) : TIER_LABELS[tierOfScore(myRating.score)]}
                        </span>
                        {scoresUnlocked && <span className="text-on-surface/45" style={{ fontSize: '15px' }}>/ 10</span>}
                      </button>
                      {facts.length > 0 && (
                        <p className="mt-3 text-on-surface/50" style={{ fontSize: '13.5px' }}>{facts.join(' · ')}</p>
                      )}
                    </div>

                    {/* Notes and photos — a sub-block opened by a hairline
                        rather than by a heading of its own weight. */}
                    <div className="mt-[22px] pt-[18px] border-t border-on-surface/[0.09]">
                      <div className="flex items-center justify-between gap-3 mb-3.5">
                        <span className="text-on-surface" style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '-0.02em' }}>Your notes &amp; photos</span>
                        {mineSummary && (
                          <span className="flex-none rounded-full bg-on-surface/[0.06] text-on-surface/60 px-2.5 py-1.5" style={{ fontSize: '11.5px', fontWeight: 600 }}>{mineSummary}</span>
                        )}
                      </div>

                      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-[22px] px-[22px] pb-3.5 snap-x">
                        {myPhotos.map((ph, i) => (
                          <img key={i} src={ph.url} alt="" className="flex-none w-[88px] h-[88px] rounded-[20px] object-cover snap-start bg-on-surface/[0.05]" referrerPolicy="no-referrer" />
                        ))}
                        <button
                          type="button"
                          onClick={() => openAt('photos')}
                          className="flex-none w-[88px] h-[88px] rounded-[20px] border border-dashed border-on-surface/25 flex flex-col items-center justify-center gap-1.5 text-on-surface/45 active:bg-on-surface/[0.04] transition-colors"
                          style={{ fontSize: '11px', fontWeight: 700 }}
                        >
                          <Plus size={17} />
                          Add
                        </button>
                      </div>

                      {/* The note reads as the field it is — tapping opens
                          the editor the rest of the app already uses. */}
                      <button
                        type="button"
                        onClick={() => openAt('notes')}
                        className="w-full flex items-center gap-2 rounded-full bg-on-surface/[0.055] pl-4 pr-[5px] py-[5px] text-left active:opacity-75 transition-opacity"
                      >
                        <span className={cn('flex-1 min-w-0 truncate', myRating.notes ? 'text-on-surface' : 'text-on-surface/40')} style={{ fontSize: '14px' }}>
                          {myRating.notes || 'Add notes…'}
                        </span>
                        <span className="flex-none w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                          <Edit3 size={15} />
                        </span>
                      </button>

                      <div className="mt-3">
                        {detailRows.map(({ icon, label, value, page }) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => openAt(page)}
                            className="w-full flex items-center gap-3 py-3.5 text-left border-t border-on-surface/[0.09] active:opacity-60 transition-opacity"
                          >
                            <span className="flex-none text-on-surface/40">{icon}</span>
                            <span className="flex-none text-on-surface" style={{ fontSize: '14px', fontWeight: 500 }}>{label}</span>
                            <span className="flex-1 min-w-0 truncate text-right text-on-surface/45" style={{ fontSize: '13px' }}>{value}</span>
                            <ChevronRight size={14} className="flex-none text-on-surface/25" />
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Earlier visits — the old timeline, folded away. Each
                        row is date, score and the note; tapping opens the
                        rest. */}
                    {earlier.length > 0 && (
                      <div className="mt-5 pt-4 border-t border-on-surface/[0.09]">
                        <button
                          type="button"
                          onClick={() => setEarlierVisitsOpen(!earlierVisitsOpen)}
                          className="w-full flex items-center justify-between text-left active:opacity-70 transition-opacity"
                        >
                          <span className="text-on-surface/70" style={{ fontSize: '13px', fontWeight: 600 }}>
                            {earlier.length} earlier {earlier.length === 1 ? 'visit' : 'visits'}
                          </span>
                          <ChevronDown size={15} className={cn('text-on-surface/40 transition-transform duration-200', earlierVisitsOpen && 'rotate-180')} />
                        </button>
                        <Collapse open={earlierVisitsOpen}>
                          <ul>
                            {earlier.map((e) => {
                              const isExpanded = expandedVisit === e.id;
                              const month = e.date ? MONTHS[e.date.getMonth()].toUpperCase() : '—';
                              const day = e.date ? e.date.getDate() : '';
                              return (
                                <li key={e.id} className="border-t border-on-surface/[0.09]">
                                  <button type="button" onClick={() => setExpandedVisit(isExpanded ? null : e.id)} className="w-full flex items-center gap-3 py-3 text-left active:opacity-70 transition-opacity">
                                    <div className="flex-shrink-0 w-10 flex flex-col items-center">
                                      <span className="text-on-surface/35 leading-none" style={{ fontSize: '9px', letterSpacing: '0.1em' }}>{month}</span>
                                      <span className="text-on-surface/70 leading-none mt-1 tabular-nums" style={{ fontSize: '15px', fontWeight: 700 }}>{day}</span>
                                    </div>
                                    <p className={cn('flex-1 min-w-0 truncate', e.notes ? 'text-on-surface/70' : 'text-on-surface/35')} style={{ fontSize: '13px' }}>
                                      {e.notes || 'No notes'}
                                    </p>
                                    <span className={cn('flex-shrink-0 inline-flex items-center h-7 px-2.5 rounded-full tabular-nums', softChip(e.score))} style={{ fontSize: '13px', fontWeight: 700 }}>
                                      {e.score.toFixed(1)}
                                    </span>
                                  </button>
                                  <Collapse open={isExpanded}>
                                    <div className="pb-3 pl-[52px] space-y-2.5">
                                      {e.tags && e.tags.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5">
                                          {e.tags.map((t) => (<span key={t} className="rounded-full bg-on-surface/[0.06] text-on-surface/60 px-2.5 py-1" style={{ fontSize: '11px', fontWeight: 600 }}>{t}</span>))}
                                        </div>
                                      )}
                                      {e.photos && e.photos.length > 0 && (
                                        <div className="flex gap-1.5 overflow-x-auto no-scrollbar snap-x snap-mandatory">
                                          {e.photos.slice(0, 6).map((ph, i) => (<img key={i} src={ph.url} alt="" className="w-16 h-16 rounded-xl object-cover flex-shrink-0 snap-start" referrerPolicy="no-referrer" />))}
                                        </div>
                                      )}
                                      {confirmDeleteVisitId === e.id ? (
                                        <div className="flex items-center justify-between gap-2 bg-score-low-tint rounded-xl px-3 py-2">
                                          <p className="text-xs font-medium text-score-low-ink">Delete this visit?</p>
                                          <div className="flex gap-1.5">
                                            <button type="button" onClick={() => setConfirmDeleteVisitId(null)} className="px-2.5 py-1 text-[11px] font-semibold text-on-surface/70 rounded-full bg-on-surface/[0.06]">Cancel</button>
                                            <button type="button" onClick={() => { if (!place) return; deleteVisit(place.id, e.id); setConfirmDeleteVisitId(null); setExpandedVisit(null); }} className="px-2.5 py-1 text-[11px] font-semibold text-white bg-score-low rounded-full">Delete</button>
                                          </div>
                                        </div>
                                      ) : (
                                        <button type="button" onClick={() => setConfirmDeleteVisitId(e.id)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-score-low-ink active:opacity-70 transition-opacity">
                                          <Trash2 size={13} /> Delete visit
                                        </button>
                                      )}
                                    </div>
                                  </Collapse>
                                </li>
                              );
                            })}
                          </ul>
                        </Collapse>
                      </div>
                    )}
                  </>
                ) : (
                  /* Nothing recorded yet — say what would go here and give
                     the one button that starts it. */
                  <div className="pt-[18px] flex flex-col items-start gap-2">
                    <p className="text-on-surface" style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.028em', lineHeight: 1.2 }}>
                      You haven&rsquo;t rated this yet
                    </p>
                    <p className="text-on-surface/55" style={{ fontSize: '14px', lineHeight: 1.55 }}>
                      Rate it once you&rsquo;ve been — your score, notes and photos show up here, and your circle sees it too.
                    </p>
                    <button
                      type="button"
                      onClick={() => openAddRestaurantModal(wishMeta)}
                      className="mt-2.5 inline-flex items-center gap-2 rounded-full bg-primary text-white px-5 py-3.5 active:opacity-85 transition-opacity"
                      style={{ fontSize: '13.5px', fontWeight: 700 }}
                    >
                      <Star size={14} />
                      Rate this place
                    </button>
                  </div>
                )}
              </Collapse>
            </section>
          );
        })()}

        {/* Likes + comments friends left on your rating. */}
        {myRating && place && (
          <YourReviewComments restaurantId={place.id} variant="mobile" className="mt-8" />
        )}

        {/* ── From your friends — one row per person: monogram, name, when,
            two lines of what they said, and their score. Unboxed: the rows
            used to sit in a ringed card with a chevron on each, which drew
            a container around three lines of text and then promised a page
            behind every one of them. Tapping opens the review as a sheet
            over this page instead. ── */}
        {(() => {
          const ratings = friendsStats.ratings;
          const SHOWN = 3;
          const nameOf = (r: any) => friendReviewProfiles[r.user_id]?.display_name || 'Friend';
          const recencyOf = (r: any) => (r.visit_date ? timeAgo(r.visit_date) : r.created_at ? timeAgo(r.created_at) : '');

          return (
            <section className="mt-8">
              <SectionRule />
              <div className="pt-3 flex items-center justify-between gap-3">
                <SectionTitle>From your friends</SectionTitle>
                {ratings.length > SHOWN && (
                  <button
                    type="button"
                    onClick={() => navigate(`/restaurant/${place.id}/circle`)}
                    className="flex-none inline-flex items-center gap-1 rounded-full bg-on-surface/[0.06] text-on-surface px-3 py-[7px] active:opacity-70 transition-opacity"
                    style={{ fontSize: '11.5px', fontWeight: 700 }}
                  >
                    See all {ratings.length}
                    <ChevronRight size={12} />
                  </button>
                )}
              </div>

              {ratings.length > 0 ? (
                <div className="pt-1 flex flex-col">
                  {ratings.slice(0, SHOWN).map((r, i) => {
                    const name = nameOf(r);
                    const recency = recencyOf(r);
                    const dishes = (r.tags || []).slice(0, 2);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setOpenReview(r)}
                        className={cn(
                          'flex items-start gap-3.5 py-4 text-left active:opacity-60 transition-opacity',
                          i > 0 && 'border-t border-on-surface/[0.09]',
                        )}
                      >
                        <FriendAvatar name={name} size={40} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="truncate text-on-surface" style={{ fontSize: '15px', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.022em' }}>{name}</span>
                            {recency && <span className="flex-none text-on-surface/45" style={{ fontSize: '12px' }}>{recency}</span>}
                          </div>
                          {r.notes ? (
                            <p className="mt-1.5 text-on-surface/60 line-clamp-2" style={{ fontSize: '13.5px', lineHeight: 1.45 }}>{r.notes}</p>
                          ) : (
                            <p className="mt-1.5 text-on-surface/35" style={{ fontSize: '13.5px' }}>Rated it — no note</p>
                          )}
                          {dishes.length > 0 && (
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                              {dishes.map((d) => (
                                <span key={d} className="rounded-full bg-on-surface/[0.06] text-on-surface/60 px-2.5 py-1.5" style={{ fontSize: '11px', fontWeight: 600 }}>{d}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className={cn('flex-none mt-0.5 rounded-full px-2.5 py-2 tabular-nums', softChip(Number(r.score)))} style={{ fontSize: '14px', fontWeight: 700 }}>
                          {Number(r.score).toFixed(1)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                /* One line, not a bordered box with an icon in it. An empty
                   state should take the room its message needs. */
                <p className="pt-4 text-on-surface/45" style={{ fontSize: '13.5px' }}>
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
          );
        })()}

        {/* ── Verified picks — the experts, as rows on the page. ── */}
        {expertRecommendations.length > 0 && (
          <section className="mt-8">
            <SectionRule />
            <div className="pt-3"><SectionTitle>Verified picks</SectionTitle></div>
            <ul className="pt-2 flex flex-col">
              {expertRecommendations.map((rec, i) => {
                const isExpanded = expandedExpertId === rec.id;
                // The row is a plain li: the profile Link and the expand
                // toggle are SIBLINGS, not a Link nested inside a button —
                // that's invalid HTML, and iOS taps could both navigate
                // and toggle at once.
                return (
                  <li key={rec.id} className={cn('py-4', i > 0 && 'border-t border-on-surface/[0.09]')}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link to={`/user/${rec.expert_username}`} className="truncate text-on-surface" style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '-0.022em' }}>
                            {rec.expert_name}
                          </Link>
                          <span className="inline-flex items-center gap-1 text-primary" style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                            <VerifiedBadge size={11} inline />Verified
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandedExpertId(isExpanded ? null : rec.id)}
                          aria-expanded={isExpanded}
                          className="block w-full text-left active:opacity-70 transition-opacity"
                        >
                          <p className={cn('mt-1.5 text-on-surface/60', isExpanded ? '' : 'line-clamp-2')} style={{ fontSize: '13.5px', lineHeight: 1.45 }}>{rec.recommendation_text}</p>
                        </button>
                      </div>
                      <span className={cn('flex-none mt-0.5 rounded-full px-2.5 py-2 tabular-nums', softChip(Number(rec.rating)))} style={{ fontSize: '14px', fontWeight: 700 }}>
                        {Number(rec.rating).toFixed(1)}
                      </span>
                    </div>
                    <Collapse open={!!(isExpanded && rec.highlight_dishes && rec.highlight_dishes.length > 0)}>
                      <div className="pt-3 flex flex-wrap gap-[7px]">
                        {rec.highlight_dishes.map((dish) => (
                          <span key={dish} className="rounded-full bg-primary/10 text-primary px-3 py-2" style={{ fontSize: '11.5px', fontWeight: 600 }}>{dish}</span>
                        ))}
                      </div>
                    </Collapse>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* ── More from {name} — reels / posts featuring this restaurant.
            The rule rides on the component so it disappears with it when
            there is nothing to show. ── */}
        <RestaurantFeaturedReels
          restaurantId={place.id}
          restaurantName={place.name}
          size="md"
          className="mt-8 pt-3 border-t border-on-surface/[0.14]"
        />

        {/* ── Hours — the week, folded behind today's line. ── */}
        {place.hours.length > 0 && (
          <section className="mt-8">
            <SectionRule />
            <button onClick={() => setHoursOpen(!hoursOpen)} className="w-full pt-3 flex items-center gap-2.5 text-left active:opacity-70 transition-opacity">
              <SectionTitle className="flex-none">Hours</SectionTitle>
              {place.isOpen !== null ? (
                <>
                  <span className={cn('flex-none inline-block w-[7px] h-[7px] rounded-full', place.isOpen ? 'bg-olive' : 'bg-clay')} />
                  <span className={cn('flex-none', place.isOpen ? 'text-olive' : 'text-clay')} style={{ fontSize: '13.5px', fontWeight: 600 }}>
                    {place.isOpen ? 'Open' : 'Closed'}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-on-surface/45" style={{ fontSize: '13.5px' }}>· {getTodayHours(place.hours)}</span>
                </>
              ) : <span className="flex-1" />}
              <ChevronDown size={16} className={cn('flex-none text-on-surface/40 transition-transform duration-200', hoursOpen && 'rotate-180')} />
            </button>
            <Collapse open={hoursOpen}>
              <ul className="pt-3">
                {place.hours.map((line, i) => {
                  const [day, ...timeParts] = line.split(': ');
                  const time = timeParts.join(': ');
                  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                  const isToday = today.startsWith(day.toLowerCase().slice(0, 3));
                  return (
                    <li
                      key={i}
                      className={cn('flex justify-between items-baseline py-3', i > 0 && 'border-t border-on-surface/[0.09]', isToday ? 'text-on-surface' : 'text-on-surface/55')}
                      style={{ fontSize: '15px', fontWeight: isToday ? 600 : 400 }}
                    >
                      <span>{day}</span>
                      <span className="tabular-nums">{time}</span>
                    </li>
                  );
                })}
              </ul>
            </Collapse>
          </section>
        )}

        {/* ── Location — the map is an object on the page, not the page's
            floor. Full-bleed it ran to all four edges and read as the end
            of the document; inset and rounded it is the last item in the
            list, and the section rule above it says so. ── */}
        <section className="mt-8">
          <SectionRule />
          <div className="pt-3"><SectionTitle>Location</SectionTitle></div>
          <div className="relative mt-4 h-[210px] rounded-[24px] overflow-hidden bg-on-surface/[0.05]">
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
              className="absolute top-3 right-3 z-20 inline-flex items-center gap-1.5 rounded-full bg-paper/90 backdrop-blur-md text-primary px-3.5 py-2.5 active:opacity-80 transition-opacity"
              style={{ fontSize: '12.5px', fontWeight: 700 }}
            >
              Open in Maps
              <ExternalLink size={12} />
            </a>
          </div>
        </section>

        {/* Tail clearance — the bottom nav is hidden on /restaurant/*, so
            nothing else keeps the map off the home indicator. */}
        <div style={{ height: 'calc(52px + env(safe-area-inset-bottom, 0px))' }} aria-hidden />
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
      {/* A friend's review, read over the restaurant instead of replacing
          it. The row used to push a whole screen for one paragraph. */}
      <AnimatePresence>
        {openReview && (
          <FriendReviewSheet
            rating={openReview}
            name={friendReviewProfiles[openReview.user_id]?.display_name || 'Friend'}
            username={friendReviewProfiles[openReview.user_id]?.username}
            when={openReview.visit_date ? timeAgo(openReview.visit_date) : openReview.created_at ? timeAgo(openReview.created_at) : ''}
            restaurantName={place.name}
            photos={communityPhotos.filter((p) => p.user_id === openReview.user_id)}
            onClose={() => setOpenReview(null)}
          />
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
