/**
 * RestaurantPanel — side panel / bottom sheet that opens when a viewer taps
 * a "featured restaurant" card on a reel or post. Shows the restaurant at a
 * glance without yanking the user out of the feed:
 *
 *   - Non-interactive Mapbox hero pinned to the place's lat/lng
 *   - Directions / call / website action row
 *   - Address + thin hours accordion (closed by default)
 *   - Community / friends / expert score chips
 *   - Your-rating block (no card chrome — divider-separated rows, with
 *     an expandable details accordion mirroring the detail page)
 *   - Filler "Featured in" reels strip
 *   - Friend reviews + expert picks
 *   - View full restaurant page primary button
 *
 * The panel is presentation-only — it pulls everything it needs from
 * ListsContext (your rating, lists membership) and the supabase-community
 * helpers (community / friends / expert ratings). Modals (rate, add-to-list)
 * are opened by toggling state on ListsContext so the page-level mounted
 * modals handle them — no chrome duplicated here.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router-dom';
import {
  X, Star, Bookmark, Plus, ArrowUpRight, Pencil, Loader2, ImageOff,
  Navigation, Phone, Globe, ChevronDown, ChevronRight,
} from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import { attachMapErrorFallback } from '../lib/map-error';
import { useBottomSheet } from '../lib/useBottomSheet';
import { useBlobPhotos } from '../lib/useBlobPhotos';
// Required for the Mapbox canvas to actually render — provides the
// .mapboxgl-canvas-container / .mapboxgl-canvas positioning rules. The
// rest of the app already imports this from the detail page; the panel
// is a separate entry point so it has to bring it in too.
import 'mapbox-gl/dist/mapbox-gl.css';
import { cn, parseVisitDate } from '../lib/utils';
import { VerifiedBadge } from './VerifiedBadge';
import { scoreColor, scoreTint } from '../lib/score';
import { GlassButton } from '../lib/glass-buttons';
import { useLists } from '../contexts/ListsContext';
import {
  getCommunityStats,
  getFriendsStats,
  getExpertRecommendations,
  getCommunityPhotos,
  getProfilesByIds,
  type CommunityRating,
  type CommunityPhoto,
  type ExpertRecommendation,
  type UserProfile,
} from '../lib/supabase-community';
import type { ReelRestaurantSnapshot } from '../lib/supabase-reels';
import { getPlaceDetails, resolvePlaceIdByNameCoords, type PlaceDetails } from '../lib/places';
import { isMichelinSyntheticId, parseMichelinSyntheticId } from '../lib/michelin';
import { getTodayHours } from '../pages/useRestaurantDetail';
import { buildDirectionsUrl } from '../lib/directions';
import { openExternalUrl } from '../lib/external-links';
import { MAPBOX_TOKEN } from '../lib/keys';
import { RestaurantFeaturedReels } from './RestaurantFeaturedReels';
import { PhotoGallery } from './PhotoGallery';

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
  const date = parseVisitDate(iso);
  if (!date) return '';
  const d = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatVisitDate(iso: string): string {
  const date = parseVisitDate(iso);
  if (!date) return '';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/* ── The main detail page's section language, sized for the panel: a
   rule opens a section and the title speaks in sentence case — no
   spaced-caps eyebrows, no boxed tiles. ── */

const SECTION_TITLE_STYLE: React.CSSProperties = {
  fontSize: '17px',
  fontWeight: 700,
  lineHeight: 1.15,
  letterSpacing: '-0.022em',
};

const SectionRule: React.FC = () => (
  <div className="border-t border-on-surface/[0.14]" aria-hidden />
);

const SectionTitle: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <h3 className={cn('text-on-surface', className)} style={SECTION_TITLE_STYLE}>{children}</h3>
);

/** A fact with a label column — "TODAY · Open · closes 9:30 PM". */
const MetaRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-baseline gap-4">
    <span
      className="flex-none w-[52px] text-on-surface/40"
      style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}
    >
      {label}
    </span>
    <span className="flex-1 min-w-0" style={{ fontSize: '13.5px' }}>{children}</span>
  </div>
);

/* ── Score disc (Community / Friends / Experts) ───────────────────────── */

const ScorePill: React.FC<{
  label: string;
  score: number;
  count: number;
}> = ({ label, score, count }) => {
  const has = count > 0;
  // The tint and the ink come from the score itself, same tier palette
  // as every other surface — a column can't be "the good one".
  const unit = label === 'Experts' ? 'pick' : 'rating';
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center text-center">
      <span
        className={cn(
          'w-[68px] h-[68px] rounded-full flex items-center justify-center tabular-nums',
          has ? scoreTint(score) : 'bg-on-surface/[0.06] text-on-surface/30',
        )}
        style={{ fontSize: '23px', fontWeight: 700, letterSpacing: '-0.01em' }}
      >
        {has ? score.toFixed(1) : '—'}
      </span>
      <span className="mt-2.5 text-on-surface" style={{ fontSize: '13px', fontWeight: 700 }}>{label}</span>
      <span className={cn('mt-1', has ? 'text-on-surface/50' : 'text-on-surface/35')} style={{ fontSize: '11.5px' }}>
        {has ? `${count} ${unit}${count === 1 ? '' : 's'}` : 'None yet'}
      </span>
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
          <span className="inline-flex items-center gap-0.5 px-1 py-px rounded-sm bg-primary/10 text-primary text-[9px] font-bold">
            <VerifiedBadge size={10} />
            VERIFIED
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

/* ── Action button (Directions / Call / Website) ──────────────────────── */

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  href?: string | null;
  external?: boolean;
  /** When set, the tap runs this instead of following href (which stays for
   *  hover/copy-link affordances) — used to route external URLs through
   *  openExternalUrl so native opens the right app, not Safari. */
  onClick?: () => void;
}

const ActionButton: React.FC<ActionButtonProps> = ({ icon, label, href, external, onClick }) => {
  const inner = (
    <>
      {icon}
      <span style={{ fontSize: '12.5px', fontWeight: 700 }}>{label}</span>
    </>
  );
  const cls = 'flex-1 inline-flex items-center justify-center gap-2 rounded-full border border-on-surface/20 text-on-surface px-3 py-[11px] active:opacity-80 transition-opacity';
  const disabledCls = 'flex-1 inline-flex items-center justify-center gap-2 rounded-full border border-on-surface/[0.12] text-on-surface/30 px-3 py-[11px] cursor-not-allowed';
  if (!href) return <div className={disabledCls}>{inner}</div>;
  return (
    <a
      href={href}
      {...(onClick ? { onClick: (e: React.MouseEvent) => { e.preventDefault(); onClick(); } } : {})}
      {...(external && !onClick ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cls}
    >
      {inner}
    </a>
  );
};

/* ── Your Rating expanded details (mirrors detail page layout) ────────── */

/** One recorded fact — the same label-column anatomy the WHERE row uses,
 *  hairline-divided, with the whole row tappable into that section of the
 *  editor. Replaces the mono spaced-caps eyebrows + per-label pencils. */
const RatingDetailRow: React.FC<{
  label: string;
  onEdit: () => void;
  children: React.ReactNode;
}> = ({ label, onEdit, children }) => (
  <button
    type="button"
    onClick={onEdit}
    className="w-full flex items-start gap-4 py-3 text-left active:opacity-70 transition-opacity group"
  >
    <span
      className="flex-none w-[52px] pt-0.5 text-on-surface/40"
      style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}
    >
      {label}
    </span>
    <span className="flex-1 min-w-0">{children}</span>
    <Pencil size={12} className="flex-none mt-1 text-on-surface/25 group-hover:text-on-surface/60 transition-colors" />
  </button>
);

/* ── Body (shared between sheet + panel) ──────────────────────────────── */

export const RestaurantPanelBody: React.FC<{
  snapshot: RestaurantPanelSnapshot;
  onClose: () => void;
  currentUserId: string | null;
  /** The sheet host reads the inner scroll position through this to run
   *  drag-anywhere dismissal (see useBottomSheet). */
  scrollElRef?: React.MutableRefObject<HTMLDivElement | null>;
  /** True while the sheet is entering or being dragged — the pinned glass
   *  buttons stand their native mirrors down for those frames (the async
   *  mirror trails a finger-driven transform) and let the web glass look
   *  carry them. */
  glassSuspended?: boolean;
  /** When true the map hero is omitted entirely so the body can be
   *  embedded inside another panel (e.g. the Map page's results sidebar)
   *  that already has its own header. The scroll container and all the
   *  body sections stay identical so the embedded surface reads as
   *  "the same panel, minus the map". */
  noHero?: boolean;
  /** Optional sticky header rendered above the scrollable body when
   *  noHero is true. Used by embedded callers to slot in a back arrow,
   *  wishlist toggle, etc. */
  topChrome?: React.ReactNode;
  /** Optional content rendered at the top of the scrollable body, above
   *  the Directions / Call / Website action row. Lets embedded callers
   *  inject extra sections (e.g. a distance + routing card) without
   *  re-implementing the rest of the body. */
  headSlot?: React.ReactNode;
}> = ({ snapshot, onClose, currentUserId, scrollElRef, glassSuspended, noHero, topChrome, headSlot }) => {
  const {
    getRating,
    isWishlisted,
    toggleWishlist,
    openAddRestaurantModal,
    openAddToListModal,
    getListsForRestaurant,
  } = useLists();

  const myRating = getRating(snapshot.id);
  const wishlisted = isWishlisted(snapshot.id);
  const myLists = useMemo(() => getListsForRestaurant(snapshot.id), [snapshot.id, getListsForRestaurant]);

  // Lazy-fetch real place details (lat/lng, phone, website, hours) for the
  // hero map + action row + hours accordion. Cached server-side via the
  // places.ts in-memory cache so reopening the same place is instant.
  const [details, setDetails] = useState<PlaceDetails | null>(null);
  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    // Michelin dataset rows carry a synthetic id (no Google place id). Resolve
    // it to the real Google place (by name + coords) before fetching details.
    (async () => {
      try {
        let placeId = snapshot.id;
        if (isMichelinSyntheticId(snapshot.id)) {
          const parsed = parseMichelinSyntheticId(snapshot.id);
          const resolved = parsed
            ? await resolvePlaceIdByNameCoords(parsed.name, parsed.lat, parsed.lng)
            : null;
          if (!resolved) return; // fall back to snapshot fields
          placeId = resolved;
        }
        const d = await getPlaceDetails(placeId);
        if (!cancelled) setDetails(d);
      } catch { /* falls back to snapshot fields */ }
    })();
    return () => { cancelled = true; };
  }, [snapshot.id]);

  const [community, setCommunity] = useState<{ avg: number; count: number; ratings: CommunityRating[] } | null>(null);
  const [friends, setFriends] = useState<{ avg: number; count: number; ratings: CommunityRating[] } | null>(null);
  const [experts, setExperts] = useState<ExpertRecommendation[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Bumping re-arms the load effect (the inline retry row).
  const [loadToken, setLoadToken] = useState(0);
  // Community photo gallery — small grid section in the panel, full-screen
  // viewer when a thumb is tapped.
  const [communityPhotos, setCommunityPhotos] = useState<CommunityPhoto[]>([]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryStart, setGalleryStart] = useState(0);
  // iOS WKWebView silently fails to render large base64 data: URLs — the
  // detail page converts them to blob URLs, but this panel (which fronts
  // every reel/post restaurant tap on iOS) rendered them raw, so photo
  // grids came up blank in the app. Shared hook, shared cache.
  const blobSources = useMemo(
    () => [...communityPhotos, ...(myRating?.photos || [])],
    [communityPhotos, myRating],
  );
  const photoBlobMap = useBlobPhotos(blobSources);
  const communityPhotosDisplay = useMemo(
    () => communityPhotos.map((p) => (photoBlobMap[p.url] ? { ...p, url: photoBlobMap[p.url] } : p)),
    [communityPhotos, photoBlobMap],
  );

  useEffect(() => {
    let cancelled = false;
    setCommunityPhotos([]);
    getCommunityPhotos(snapshot.id).then((ps) => {
      if (!cancelled) setCommunityPhotos(ps);
    }).catch(() => { /* keep empty list */ });
    return () => { cancelled = true; };
  }, [snapshot.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
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
      const ids = Array.from(new Set(f.ratings.map((r) => r.user_id))).slice(0, 6);
      if (ids.length > 0) {
        const profs = await getProfilesByIds(ids);
        if (!cancelled) setProfiles(profs);
      }
    };
    // Never leave the spinner up on a failed fetch: the un-caught version
    // kept loading=true forever (permanent spinner) and emitted an
    // unhandled rejection. Failures render an inline retry row instead.
    load()
      .catch((err) => {
        if (cancelled) return;
        console.warn('[RestaurantPanel] load failed:', err);
        setLoadError(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [snapshot.id, currentUserId, loadToken]);

  const meta = useMemo(() => ({
    id: snapshot.id,
    name: snapshot.name,
    image: snapshot.image || '',
    cuisine: snapshot.cuisine,
    price: snapshot.price,
    address: snapshot.address,
  }), [snapshot]);

  const onRate = () => openAddRestaurantModal(meta);
  const onAddToList = () => openAddToListModal(snapshot.id, meta);
  const onWishlist = () => toggleWishlist(meta);
  /** Jump into the unified Add Restaurant modal at a specific page (notes /
   *  tags / photos / etc.) so each "edit" link in the expanded rating
   *  details opens the right step — same pattern as the detail page. */
  const openAt = (page: string) => openAddRestaurantModal(meta, page);

  const distance = snapshot.distanceMi != null ? `${snapshot.distanceMi.toFixed(1)} mi` : '';

  const topFriendReviews = useMemo(() => {
    if (!friends) return [];
    return [...friends.ratings].slice(0, 3);
  }, [friends]);

  /* ── Map: non-interactive Mapbox pinned to the place's lat/lng. The
        container uses key={snapshot.id} so swapping restaurants while
        the panel is open cleanly tears down the old map and inits a
        new one. The callback-ref pattern (mirroring useRestaurantDetail)
        works around a React 18 StrictMode batching pitfall that can
        leave the canvas blank in dev. */
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const mapCleanupRef = useRef<(() => void) | null>(null);
  // getPlaceDetails defaults missing coords to 0/0 (Atlantic Ocean), which
  // Number.isFinite would happily accept — so guard against the literal
  // 0 sentinel too. If both coords are 0 we treat it as no location.
  const lat = details && Number.isFinite(details.lat) && details.lat !== 0 ? details.lat : null;
  const lng = details && Number.isFinite(details.lng) && details.lng !== 0 ? details.lng : null;
  const hasMap = lat != null && lng != null;

  const mapContainerRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) {
      if (mapCleanupRef.current) {
        mapCleanupRef.current();
        mapCleanupRef.current = null;
      }
      return;
    }
    if (mapInstanceRef.current) return;
    if (!MAPBOX_TOKEN || lat == null || lng == null) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: el,
      // Light style — clean gray cartography that the dark title sits on
      // top of comfortably. A CSS filter on the container (see JSX) takes
      // a touch of saturation out so it reads as warm gray rather than
      // bright. interactive: false keeps it a decorative locator map.
      style: 'mapbox://styles/mapbox/light-v11',
      center: [lng, lat],
      // Zoomed out a notch so the surrounding streets are visible, not just
      // the building footprint. ~12.5 shows ~1 mile across.
      zoom: 12.5,
      interactive: false,
      attributionControl: false,
    });
    // Mapbox ToS requires attribution on every map, decorative locators
    // included — keep it, but compact so it stays out of the title's way.
    map.addControl(new mapboxgl.AttributionControl({ compact: true }));
    attachMapErrorFallback(map, el);
    mapInstanceRef.current = map;
    new mapboxgl.Marker({ color: '#9f3012' }).setLngLat([lng, lat]).addTo(map);

    const ro = new ResizeObserver(() => { try { map.resize(); } catch { /* noop */ } });
    ro.observe(el);
    const rafId = requestAnimationFrame(() => { try { map.resize(); } catch { /* noop */ } });

    mapCleanupRef.current = () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [lat, lng]);

  /* ── Hours + contact derived from the details fetch. */
  const phoneHref = details?.phone ? `tel:${details.phone}` : null;
  const websiteHref = details?.website || null;
  const directionsHref = useMemo(() => buildDirectionsUrl({
    // details.id is the RESOLVED Google place id (synthetic Michelin ids
    // are swapped for a real one by the details fetch) — including it pins
    // chain restaurants to this exact branch.
    placeId: details?.id,
    address: details?.fullAddress || details?.address || snapshot.address,
    name: snapshot.name,
    lat,
    lng,
  }), [details, snapshot.address, snapshot.name, lat, lng]);

  const hours = details?.hours || [];
  const [hoursOpen, setHoursOpen] = useState(false);
  const todayHours = useMemo(() => (hours.length > 0 ? getTodayHours(hours) : ''), [hours]);
  const isOpenNow = details?.isOpen ?? null;

  /* ── Your-rating details accordion (mirrors the detail page section). */
  const [myRatingOpen, setMyRatingOpen] = useState(false);
  const hasNotes = !!myRating?.notes;
  const hasTags = !!myRating?.tags && myRating.tags.length > 0;
  const hasPhotos = !!myRating?.photos && myRating.photos.length > 0;
  const hasPrice = !!myRating?.price;

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Creating a Mapbox WebGL context is main-thread work heavy enough to
  // stutter the sheet's entrance — hold the map back until the slide has
  // settled, then fade it in over the cream placeholder.
  const [mediaSettled, setMediaSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMediaSettled(true), 460);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      {/* Embedded callers (noHero) supply their own header chrome — a
          back arrow, wishlist toggle, etc. — pinned above the scroll
          area. The standard panel/sheet renders the map hero instead. */}
      {noHero && topChrome && (
        <div className="flex-shrink-0">{topChrome}</div>
      )}
      {/* The old scroll-driven hero collapse (a height transform racing
          three opacity fades) fought the sheet's own drag and read as a
          glitch. Now the map is an ordinary block at the top of ONE
          scroll container — it scrolls away like content, the way modern
          sheets behave — and only the save/close buttons stay pinned. */}
      <div className="relative flex-1 min-h-0">
        {!noHero && (
          <>
            <GlassButton
              id="panel-close"
              symbol="xmark"
              label="Close"
              suspended={glassSuspended}
              onClick={onClose}
              className="absolute top-3 right-3 w-11 h-11 rounded-full bg-black/55 backdrop-blur text-white ring-1 ring-white/[0.16] hover:bg-black/75 flex items-center justify-center transition-colors z-20"
            >
              <X size={19} />
            </GlassButton>
            <GlassButton
              id="panel-save"
              symbol={wishlisted ? 'bookmark.fill' : 'bookmark'}
              label={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
              pressed={wishlisted}
              suspended={glassSuspended}
              onClick={onWishlist}
              className={cn(
                'absolute top-3 left-3 w-11 h-11 rounded-full backdrop-blur ring-1 ring-white/[0.16] flex items-center justify-center transition-colors z-20',
                wishlisted
                  ? 'bg-primary text-white hover:bg-primary/90 shadow-md shadow-black/20'
                  : 'bg-black/55 text-white hover:bg-black/75',
              )}
            >
              <Bookmark size={19} className={cn(wishlisted && 'fill-white')} />
            </GlassButton>
          </>
        )}

        <div
          ref={(el) => {
            scrollRef.current = el;
            if (scrollElRef) scrollElRef.current = el;
          }}
          // overscroll 'none': the local top-bounce used to fight the
          // drag-anywhere dismissal for the first few pixels.
          className="h-full overflow-y-auto pb-6"
          style={{ overscrollBehavior: 'none' }}
        >
          {!noHero && (
            <div className="relative w-full h-[168px] bg-cream-2 overflow-hidden">
              {hasMap && mediaSettled ? (
                <div
                  key={`${snapshot.id}-${lat}-${lng}`}
                  ref={mapContainerRef}
                  // Inline position/inset: mapbox-gl.css sets `.mapboxgl-map
                  // { position: relative }`, which beats the Tailwind class
                  // and collapsed the container to zero height. The saturate
                  // filter quiets the cartography so it reads as warm gray.
                  className="animate-[fadeIn_0.35s_ease_both]"
                  style={{ position: 'absolute', inset: 0, filter: 'saturate(0.55)' }}
                />
              ) : hasMap ? (
                <div className="absolute inset-0 bg-cream-2" />
              ) : snapshot.image ? (
                <img
                  src={snapshot.image}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-clay/30 to-olive/20 flex items-center justify-center text-on-surface/30">
                  <ImageOff size={28} />
                </div>
              )}
              {/* Soft bottom fade so the map settles into the surface. */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-surface to-transparent" />
            </div>
          )}

          <div className={cn('px-5 space-y-6', noHero ? 'pt-5' : 'pt-4')}>
          {headSlot}
        {/* Identity — the main detail page's lead: the name says it in
            large serif ON the surface, with the cuisine speaking in the
            accent underneath. It used to hide as a caption inside the
            map wash. */}
        {!noHero && (
          <div>
            <h2 className="font-serif font-bold text-on-surface text-[27px] leading-[1.08] tracking-[-0.02em]" style={{ textWrap: 'balance' } as React.CSSProperties}>
              {snapshot.name}
            </h2>
            {(snapshot.cuisine || snapshot.price || distance) && (
              <p className="mt-2 text-[13.5px] truncate">
                {snapshot.cuisine && <span className="font-semibold text-primary">{snapshot.cuisine}</span>}
                {snapshot.cuisine && (snapshot.price || distance) && <span className="text-on-surface/30">  ·  </span>}
                {snapshot.price && <span className="text-on-surface/60">{snapshot.price}</span>}
                {snapshot.price && distance && <span className="text-on-surface/30">  ·  </span>}
                {distance && <span className="text-on-surface/60">{distance}</span>}
              </p>
            )}
          </div>
        )}
        {/* Action row — outlined pills, the detail page's control
            language: each of these leaves the app, so they read as
            controls rather than tiles. */}
        <div className="flex gap-2">
          <ActionButton
            icon={<Navigation size={15} />}
            label="Directions"
            href={directionsHref}
            external
            onClick={directionsHref ? () => { void openExternalUrl(directionsHref); } : undefined}
          />
          <ActionButton
            icon={<Phone size={15} />}
            label="Call"
            href={phoneHref}
          />
          <ActionButton
            icon={<Globe size={15} />}
            label="Website"
            href={websiteHref}
            external
          />
        </div>

        {/* Ratings — three tinted discs over a name and a count, the
            same tier palette every score wears everywhere. */}
        <section>
          <SectionRule />
          <SectionTitle className="pt-3">Ratings</SectionTitle>
          <div className="mt-5 flex gap-2">
          <ScorePill
            label="Community"
            score={community?.avg ?? 0}
            count={community?.count ?? 0}
          />
          <ScorePill
            label="Friends"
            score={friends?.avg ?? 0}
            count={friends?.count ?? 0}
          />
          <ScorePill
            label="Experts"
            score={
              experts.length > 0
                ? experts.reduce((s, e) => s + (e.rating || 0), 0) / experts.length
                : 0
            }
            count={experts.length}
          />
          </div>
        </section>

        {/* Address + thin hours accordion — sits directly below the score
            chips so "where it is / when it's open" is at-a-glance without
            scrolling past the social proof. Hours default closed; today's
            slice is shown on the trigger row. */}
        {snapshot.address && (
          <p className="text-on-surface/80 leading-snug" style={{ fontSize: '13.5px' }}>{snapshot.address}</p>
        )}

        {/* Hours — a real section, not a whisper: the status word leads
            at full size, today's window sits beside it, and the chevron
            opens a proper week table with today emphasized. (The status
            word and a "Closed" hours line used to double up as
            "Closed · Closed".) */}
        {hours.length > 0 && (
          <section>
            <SectionRule />
            <button
              type="button"
              onClick={() => setHoursOpen((o) => !o)}
              aria-expanded={hoursOpen}
              className="w-full pt-3 flex items-center justify-between gap-3 text-left"
            >
              <SectionTitle>Hours</SectionTitle>
              <span className="flex items-center gap-2 min-w-0">
                {isOpenNow !== null && (
                  <>
                    <span className={cn('inline-block w-[7px] h-[7px] rounded-full flex-shrink-0', isOpenNow ? 'bg-olive' : 'bg-clay')} />
                    <span className={cn('font-bold flex-shrink-0', isOpenNow ? 'text-olive' : 'text-clay')} style={{ fontSize: '14px' }}>
                      {isOpenNow ? 'Open' : 'Closed'}
                    </span>
                  </>
                )}
                <ChevronDown size={15} className={cn('text-on-surface/45 flex-shrink-0 transition-transform duration-200', hoursOpen && 'rotate-180')} />
              </span>
            </button>
            {todayHours && todayHours.trim().toLowerCase() !== 'closed' && (
              <p className="mt-2 text-[14px] text-on-surface/70">Today · {todayHours}</p>
            )}
            <AnimatePresence initial={false}>
              {hoursOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <ul className="mt-3 space-y-0.5">
                    {hours.map((line, i) => {
                      const today = new Date().getDay();
                      // Google returns Mon-first; getDay returns Sun=0..Sat=6.
                      const idxMonFirst = (today + 6) % 7;
                      const isToday = i === idxMonFirst;
                      // "Monday: 11:30 AM – 2:00 PM" → two columns.
                      const sep = line.indexOf(': ');
                      const day = sep > 0 ? line.slice(0, sep) : line;
                      const time = sep > 0 ? line.slice(sep + 2) : '';
                      return (
                        <li
                          key={i}
                          className={cn(
                            'flex items-baseline justify-between gap-4 py-[5px]',
                            isToday ? 'text-on-surface' : 'text-on-surface/55',
                          )}
                        >
                          <span style={{ fontSize: '13.5px', fontWeight: isToday ? 700 : 500 }}>{day}</span>
                          <span className="text-right tabular-nums" style={{ fontSize: '13.5px', fontWeight: isToday ? 600 : 400 }}>{time}</span>
                        </li>
                      );
                    })}
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        )}

        {/* Your rating — chrome-free, divider-separated, with an expandable
            details accordion that mirrors the layout of the full detail page. */}
        {myRating ? (
          <section aria-label="Your rating">
            <SectionRule />
            <div className="pt-3 pb-1">
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <SectionTitle>Your rating</SectionTitle>
                <button
                  type="button"
                  onClick={onRate}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-on-surface/65 hover:text-on-surface transition-colors"
                >
                  <Pencil size={12} />
                  Edit
                </button>
              </div>
              {/* The score wears its tier disc beside what you recorded —
                  the naked number floating over whitespace read as a
                  half-empty section. */}
              <div className="flex items-center gap-4">
                <span
                  className={cn('flex-none w-[64px] h-[64px] rounded-full flex items-center justify-center tabular-nums', scoreTint(myRating.score))}
                  style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.01em' }}
                >
                  {myRating.score.toFixed(1)}
                </span>
                <div className="flex-1 min-w-0">
                  {myRating.visitDate && (
                    <p className="text-[12px] text-on-surface/50">Rated {formatRelativeDate(myRating.visitDate)}</p>
                  )}
                  {myRating.notes ? (
                    <p className="font-serif italic text-on-surface/80 text-[14px] leading-snug mt-1 line-clamp-2">
                      "{myRating.notes}"
                    </p>
                  ) : (
                    <p className="text-[13px] text-on-surface/40 italic mt-1">No notes yet</p>
                  )}
                  <button
                    type="button"
                    onClick={() => setMyRatingOpen((o) => !o)}
                    aria-expanded={myRatingOpen}
                    className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-on-surface/60 hover:text-on-surface transition-colors"
                  >
                    {myRatingOpen ? 'Hide details' : 'Show details'}
                    <ChevronDown size={13} className={cn('transition-transform duration-200', myRatingOpen && 'rotate-180')} />
                  </button>
                </div>
              </div>
              {myRating.tags && myRating.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3.5">
                  {myRating.tags.slice(0, 6).map((t) => (
                    <span key={t} className="px-2.5 py-1 rounded-full bg-cream-2 text-on-surface/80 text-[11px] font-medium">
                      {t}
                    </span>
                  ))}
                </div>
              )}

              <AnimatePresence initial={false}>
                {myRatingOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 border-t border-on-surface/[0.08] divide-y divide-on-surface/[0.08]">
                      <RatingDetailRow label="Notes" onEdit={() => openAt('notes')}>
                        {hasNotes ? (
                          <p className="font-serif italic text-on-surface/85 text-[13.5px] leading-relaxed">
                            "{myRating.notes}"
                          </p>
                        ) : (
                          <p className="italic text-on-surface/40 text-[13px]">Add notes…</p>
                        )}
                      </RatingDetailRow>

                      <RatingDetailRow label="Tags" onEdit={() => openAt('tags')}>
                        {hasTags ? (
                          <span className="flex flex-wrap gap-1.5">
                            {myRating.tags.map((t) => (
                              <span key={t} className="px-2.5 py-1 rounded-full bg-cream-2 text-on-surface/80 text-[11px] font-medium">
                                {t}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <p className="italic text-on-surface/40 text-[13px]">Add tags…</p>
                        )}
                      </RatingDetailRow>

                      <RatingDetailRow label="Photos" onEdit={() => openAt('photos')}>
                        {hasPhotos ? (
                          <span className="flex gap-1.5 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
                            {myRating.photos.map((p, i) => (
                              <img
                                key={i}
                                src={photoBlobMap[p.url] ?? p.url}
                                alt=""
                                className="w-14 h-14 rounded-[10px] object-cover flex-shrink-0"
                                referrerPolicy="no-referrer"
                              />
                            ))}
                          </span>
                        ) : (
                          <p className="italic text-on-surface/40 text-[13px]">Add photos…</p>
                        )}
                      </RatingDetailRow>

                      <RatingDetailRow label="Visited" onEdit={() => openAt('date')}>
                        {myRating.visitDate ? (
                          <p className="text-on-surface/85 text-[13.5px]">
                            {formatVisitDate(myRating.visitDate)}
                          </p>
                        ) : (
                          <p className="italic text-on-surface/40 text-[13px]">Add date…</p>
                        )}
                      </RatingDetailRow>

                      <RatingDetailRow label="Price" onEdit={() => openAt('price')}>
                        {hasPrice ? (
                          <p className="text-on-surface/85 text-[13.5px] tabular-nums">{myRating.price}</p>
                        ) : (
                          <p className="italic text-on-surface/40 text-[13px]">Add price…</p>
                        )}
                      </RatingDetailRow>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="button"
                onClick={onAddToList}
                className="mt-4 w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-full bg-on-surface/[0.05] text-on-surface text-[13px] font-semibold hover:bg-on-surface/[0.09] transition-colors"
              >
                <Plus size={14} />
                {myLists.length > 0
                  ? `In ${myLists.length} list${myLists.length === 1 ? '' : 's'}`
                  : 'Add to a list'}
              </button>
            </div>
          </section>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={onRate}
              className="w-full inline-flex items-center justify-center gap-1.5 h-12 rounded-full bg-on-surface text-surface text-[14px] font-bold hover:bg-on-surface/90 transition-colors shadow-sm"
            >
              <Star size={15} className="fill-current" />
              Rate this restaurant
            </button>
            <button
              type="button"
              onClick={onAddToList}
              className="w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-full bg-on-surface/[0.05] text-on-surface text-[13px] font-semibold hover:bg-on-surface/[0.09] transition-colors"
            >
              <Plus size={14} />
              {myLists.length > 0
                ? `In ${myLists.length} list${myLists.length === 1 ? '' : 's'} · Edit`
                : 'Add to a list'}
            </button>
          </div>
        )}

        {/* Photos — small 4-up grid of community photos. Tapping any
            thumbnail (or the count chip) opens the full-screen
            PhotoGallery at that index. Hidden when there are no
            community photos. */}
        {communityPhotosDisplay.length > 0 && (
          <section>
            <SectionRule />
            <button
              type="button"
              onClick={() => { setGalleryStart(0); setGalleryOpen(true); }}
              className="w-full pt-3 flex items-baseline justify-between mb-2.5 text-left"
            >
              <SectionTitle>Photos</SectionTitle>
              <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-on-surface/60 hover:text-on-surface transition-colors">
                See all {communityPhotosDisplay.length}
                <ChevronRight size={13} />
              </span>
            </button>
            <div className="grid grid-cols-4 gap-1.5">
              {communityPhotosDisplay.slice(0, 4).map((p, idx) => {
                const isLast = idx === 3 && communityPhotosDisplay.length > 4;
                const more = communityPhotosDisplay.length - 4;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setGalleryStart(idx); setGalleryOpen(true); }}
                    className="relative aspect-square rounded-xl overflow-hidden bg-on-surface/[0.05] ring-1 ring-on-surface/[0.06] hover:ring-on-surface/[0.14] transition-shadow"
                    aria-label={p.caption || `Photo ${idx + 1} of ${communityPhotosDisplay.length}`}
                  >
                    <img
                      src={p.url}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                    {isLast && (
                      <div className="absolute inset-0 bg-black/55 backdrop-blur-[1px] flex items-center justify-center">
                        <span className="text-white text-[14px] font-bold tabular-nums">+{more}</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Featured-in strip */}
        <RestaurantFeaturedReels
          restaurantId={snapshot.id}
          restaurantName={snapshot.name}
          size="sm"
        />

        {/* Friend + expert reviews */}
        {loading ? (
          <div className="flex items-center justify-center py-6 text-on-surface/45">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6">
            <span className="text-[13px] text-on-surface/55 font-medium">Couldn&rsquo;t load community info</span>
            <button
              type="button"
              onClick={() => setLoadToken((t) => t + 1)}
              className="px-4 py-1.5 rounded-full bg-on-surface/[0.06] hover:bg-on-surface/10 text-xs font-semibold text-on-surface/70 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {topFriendReviews.length > 0 && (
              <section>
                <SectionRule />
                <div className="pt-3 flex items-baseline justify-between mb-1.5">
                  <SectionTitle>From people you follow</SectionTitle>
                  {friends && friends.count > topFriendReviews.length && (
                    <span className="text-[11px] text-on-surface/45">{friends.count} total</span>
                  )}
                </div>
                <div className="divide-y divide-on-surface/[0.06] -mt-1">
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
                        isExpert={p?.is_verified}
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
                <SectionRule />
                <SectionTitle className="pt-3 mb-1.5">Verified picks</SectionTitle>
                <div className="divide-y divide-on-surface/[0.06] -mt-1">
                  {experts.slice(0, 3).map((e) => (
                    <ReviewRow
                      key={e.id}
                      initials={(e.expert_name || e.expert_username || 'EX').slice(0, 2).toUpperCase()}
                      name={e.expert_name || 'Verified user'}
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

            {(friends?.count ?? 0) === 0 && experts.length === 0 && (community?.count ?? 0) === 0 && !myRating && (
              <div className="rounded-2xl bg-on-surface/[0.04] px-4 py-5 text-center">
                <p className="text-[13px] text-on-surface/65 leading-snug">
                  No reviews yet. Be the first to share what you thought.
                </p>
              </div>
            )}
          </>
        )}

        {/* View full restaurant page — primary route to the detail page. */}
        <Link
          to={`/restaurant/${encodeURIComponent(snapshot.id)}`}
          onClick={onClose}
          className="group flex items-center justify-center gap-1.5 w-full h-12 rounded-full bg-primary text-white text-[14px] font-bold hover:bg-primary/90 transition-colors shadow-sm"
        >
          View full restaurant page
          <ArrowUpRight size={16} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
          </div>
        </div>
      </div>

      {/* Full-screen community photo gallery. Portaled to document.body
          so it escapes the panel's transform stacking context — a fixed
          child of a transformed ancestor would otherwise be clipped to
          the 380px panel column. */}
      {galleryOpen && communityPhotosDisplay.length > 0 && createPortal(
        <PhotoGallery
          photos={[]}
          communityPhotos={communityPhotosDisplay}
          name={snapshot.name}
          initialIndex={galleryStart}
          onClose={() => setGalleryOpen(false)}
        />,
        document.body,
      )}
    </>
  );
};

/* ── Desktop side panel + mobile sheet ───────────────────────────────── */

export const RestaurantPanel: React.FC<RestaurantPanelProps> = ({ snapshot, onClose, currentUserId, variant }) => {
  const sheetScrollRef = useRef<HTMLDivElement | null>(null);
  // Native glass stands down while the sheet is entering or under the
  // finger — the async mirror can't track a per-frame transform.
  const [dragging, setDragging] = useState(false);
  const [entered, setEntered] = useState(false);
  const { dragProps, sheetRef } = useBottomSheet(!!snapshot && variant === 'sheet', onClose, sheetScrollRef, setDragging);
  useEffect(() => { if (!snapshot) setEntered(false); }, [snapshot]);
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
              // iOS's own sheet curve — the spring stuttered against the
              // Mapbox init happening mid-entrance.
              transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
              onAnimationComplete={() => setEntered(true)}
              ref={sheetRef as React.RefObject<HTMLDivElement>}
              {...dragProps}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface w-full rounded-t-3xl flex flex-col ring-1 ring-on-surface/[0.16] overflow-hidden relative"
              style={{ height: '92%', willChange: 'transform' }}
            >
              {/* Drag-handle pill — absolute so it overlays the hero map
                  at the top of the sheet rather than sitting on its own
                  white strip above the map. on-surface/30 stays visible
                  against both the light cartography and the cream
                  surface beneath. */}
              <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 z-30">
                <span className="block w-10 h-1 rounded-full bg-on-surface/30" />
              </div>
              <RestaurantPanelBody snapshot={snapshot} onClose={onClose} currentUserId={currentUserId} scrollElRef={sheetScrollRef} glassSuspended={dragging || !entered} />
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
          animate={{ opacity: 1, x: 0, width: 388 }}
          exit={{ opacity: 0, x: 20, width: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 280 }}
          className="h-full bg-surface ring-1 ring-on-surface/[0.16] rounded-[24px] overflow-hidden flex flex-col flex-shrink-0 shadow-md"
        >
          <div className="w-[388px] h-full flex flex-col">
            <RestaurantPanelBody snapshot={snapshot} onClose={onClose} currentUserId={currentUserId} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
