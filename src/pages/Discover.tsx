import React, { useState, useRef, useCallback, useEffect, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'motion/react';
import { Search, Star, Heart, Plus, Navigation, SlidersHorizontal, Users, MapPinned, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ArrowRight, Layers, X, Box, Square, Loader2, ArrowUpDown, UtensilsCrossed, DollarSign, Check, Building2, Clock, Sparkles, MapPin, ChevronsUp, Eye, Map as MapIcon, ChefHat, BookOpen, ImageOff, RefreshCw, Footprints, Tag, Bookmark, MessageCircle } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import { attachMapErrorFallback } from '../lib/map-error';
// @ts-ignore - Vite worker import for mapbox-gl CSP compatibility
import MapboxWorker from 'mapbox-gl/dist/mapbox-gl-csp-worker?worker';
import { cn, safeImage } from '../lib/utils';
import { scoreColor } from '../lib/score';
import { ScoreRing } from '../components/cards';
import { useSettings } from '../contexts/SettingsContext';
import { useHomeLocation } from '../contexts/HomeLocationContext';
import { useLists } from '../contexts/ListsContext';
import { useAuth } from '../contexts/AuthContext';
import { useRecipes, type Recipe } from '../contexts/RecipesContext';
import { getUserRatings, getAllFriendRatings, getExpertRatings, getProfilesByIds, publishCommunityRating, getFriendsPublicHomeMeals, getFriends, getCoverPhotosBatch, getTagSimilarRestaurants, getFollowedExpertIds, getExpertProfiles, getCommunityPricesForPlaces, type CommunityRating, type UserProfile, type FriendHomeMeal } from '../lib/supabase-community';
import { getGuidesForFeed, type Guide as GuideRow } from '../lib/supabase-guides';
import { GuideCard } from '../components/GuideCard';
import { GuidesBrowser, type BrowseGuide } from '../components/GuidesBrowser';
import { useGuideCreator } from '../contexts/GuideCreatorContext';
import { searchNearbyRestaurants, searchPlacesByText, searchPlacesByTextPaged, searchHotels, priceLevelToString, extractCityState, formatLocationLabel, CUISINE_TYPES, type PlaceResult } from '../lib/places';
import {
  buildTasteProfile,
  buildCandidateQueries,
  scoreCandidates,
  haversineKm,
  type TasteProfile,
  type CandidateSignals,
  type ScoredPlace,
} from '../lib/recommendations';
import { getCuisineLabel } from './useRestaurantDetail';
import { useMichelinIndexReady } from '../lib/useMichelinMatch';
import { findMichelinMatchSync, michelinPriceDisplay, passesMichelinFilter, ensureMichelinIndex, michelinNearbySync, michelinToPlaceResult, isMichelinSyntheticId, michelinBySyntheticId } from '../lib/michelin';
import { MichelinBadge, MichelinMark } from '../components/MichelinBadge';
import { haversineDistanceMi as havMi } from '../lib/distance';
import { MichelinDistinctionFilter } from '../components/MichelinDistinctionFilter';
import { FilterSheet as FilterSheetShell } from '../components/FilterSheet';
import { FilterSection, PillRow, Pill, Segment, SegmentItem, RangeSlider, FilterDropdown, HoursFilterSection } from '../components/filterPrimitives';
import { passesHoursFilter, isHoursFilterActive, emptyHoursFilter, type HoursFilter } from '../lib/hours';
import { geocodePlace } from '../components/HomeLocationBar';
import { useSetAssistantPageContext, type AssistantPageContext } from '../contexts/AssistantContext';
import { RestaurantCard } from '../components/RestaurantCard';
import { RestaurantPanelBody, type RestaurantPanelSnapshot } from '../components/RestaurantPanel';
import { useBottomSheet } from '../lib/useBottomSheet';
import { SocialFeed } from '../components/SocialFeed';
import { TopBar } from '../components/TopBar';
import {
  HomeLocationBar,
  loadLastSelectedLocation,
  saveLastSelectedLocation,
  reverseGeocode,
  getCurrentHomeLocation,
  type HomeLocation,
} from '../components/HomeLocationBar';
import {
  locationKey,
  preferencesHash,
  getHomeRecsCache,
  saveHomeRecsCache,
  type HomeRecCacheEntry,
} from '../lib/supabase-rec-cache';

// Session-scoped in-memory cache — a tap back to a city we already loaded
// this session skips both Google and Supabase.
const sessionRecsCache: Record<string, HomeRecCacheEntry> = {};

// Per-session cache of community cover-photo lookups (restaurant_id → url).
// Avoids re-querying Supabase every time the same restaurant appears across
// the recs row, search, etc.
const sessionCoverPhotoCache: Record<string, string | null> = {};

// Apply community cover photos to a batch of PlaceResult items in-place,
// consulting the session cache first and filling in any misses with a
// single Supabase query. When the current user has uploaded their own
// photo it always wins over anyone else's.
async function applyCoverPhotos(
  places: PlaceResult[],
  currentUserId: string | null,
): Promise<PlaceResult[]> {
  if (places.length === 0) return places;
  const missing: string[] = [];
  for (const p of places) {
    if (sessionCoverPhotoCache[p.id] === undefined) missing.push(p.id);
  }
  if (missing.length > 0) {
    const fresh = await getCoverPhotosBatch(missing, currentUserId);
    for (const id of missing) {
      sessionCoverPhotoCache[id] = fresh[id] || null;
    }
  }
  return places.map((p) => ({
    ...p,
    photoUrl: sessionCoverPhotoCache[p.id] || p.photoUrl || null,
  }));
}

// Fixed recommendation radius (miles). The user-facing chip picker was
// removed to keep the home feed's header minimal; /location still owns a
// slider for users who want tighter or looser geographic scoping. Keeping
// it as a const — rather than state — means buildQueryQueries /
// scoreCandidates / cache keys all read a stable value every render.
const REC_RADIUS_MILES = 8;

const RecRefreshButton: React.FC<{
  onRefresh: () => void;
  refreshing: boolean;
}> = ({ onRefresh, refreshing }) => (
  <button
    type="button"
    onClick={onRefresh}
    disabled={refreshing}
    aria-label="Refresh recommendations"
    title="Refresh recommendations"
    className={cn(
      'flex items-center justify-center w-7 h-7 rounded-full bg-on-surface/[0.04] text-on-surface/60 transition-colors',
      refreshing ? 'cursor-not-allowed opacity-60' : 'hover:bg-on-surface/[0.08] hover:text-on-surface/80',
    )}
  >
    <RefreshCw size={13} className={refreshing ? 'animate-spin' : undefined} />
  </button>
);

// Max age we'll trust a Supabase cache entry before throwing it out and
// building a fresh preference-weighted pool from scratch.
const HOME_RECS_CACHE_TTL = 2 * 24 * 60 * 60 * 1000; // 2 days
// After this age, we keep the cache but slide in one fresh variation query
// so the feed stays alive between full refetches.
const HOME_RECS_TOPUP_AGE = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Fisher-Yates in-place shuffle. Used to reshuffle the cached recommendation
 * pool on every load so the row feels fresh without any API calls.
 */
function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

import { supabase, supabaseConfigured } from '../lib/supabase';
import { saveRecentViews } from '../lib/supabase-db';
import 'mapbox-gl/dist/mapbox-gl.css';

// Fix mapbox-gl worker for Vite production builds
// @ts-ignore
mapboxgl.workerClass = MapboxWorker;

// Token split to avoid secret scanning — Mapbox public tokens are domain-restricted and safe client-side
const _mb = ['pk.eyJ1IjoidGcxMjM0N', 'TYiLCJhIjoiY21kN3g1Z', 'mJ4MG9iaTJpcHY5ajlld', 'XJ4OCJ9.MotLpY7BXT31', '0zCzDNJWwA'];
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || _mb.join('');

const MAP_STYLES = [
  { id: 'light', label: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'dark', label: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'streets', label: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
] as const;

const FILTERS: { icon: any; label: string; active: boolean }[] = [
];

type SortOption = 'popularity' | 'rating' | 'price_low' | 'price_high';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'popularity', label: 'Most Popular' },
  { value: 'rating', label: 'Highest Rated' },
  { value: 'price_low', label: 'Price: Low to High' },
  { value: 'price_high', label: 'Price: High to Low' },
];

const PRICE_LEVELS = [
  { value: 0, label: 'All' },
  { value: 1, label: '$' },
  { value: 2, label: '$$' },
  { value: 3, label: '$$$' },
  { value: 4, label: '$$$$' },
];

// Sentinel "list id" the map's My-Ratings dropdown uses for the Wishlist
// option (so wishlisted-but-unrated places can be plotted as heart pins).
const WISHLIST_LIST_ID = '__wishlist__';

function ratingToPlace(r: CommunityRating): PlaceResult | null {
  if (!r.lat || !r.lng) return null;
  const priceMap: Record<string, number> = { '$': 1, '$$': 2, '$$$': 3, '$$$$': 4 };
  return {
    id: r.restaurant_id,
    name: r.restaurant_name,
    lat: r.lat,
    lng: r.lng,
    rating: Number(r.score) || 0,
    priceLevel: priceMap[r.price] || 0,
    address: r.address || '',
    fullAddress: r.address || '',
    photoUrl: r.photo_url || null,
    types: r.cuisine ? [r.cuisine.toLowerCase().replace(/\s+/g, '_')] : [],
    userRatingCount: 0,
  };
}

function placeToCardProps(place: PlaceResult) {
  return {
    id: place.id,
    name: place.name,
    image: place.photoUrl || '',
    rating: place.rating,
    price: priceLevelToString(place.priceLevel),
    cuisine: extractCityState(place.fullAddress, place.address),
    address: place.fullAddress || place.address,
    lat: place.lat,
    lng: place.lng,
    friendReviews: 0,
    expertReviews: 0,
  };
}

// Module-level cache for tab data (persists across navigations within same session).
// Cache is session-long: once data is loaded for a tab/mode it stays cached until
// the page reloads, so returning to the Map page from another tab never triggers
// an automatic refetch. The userId field guards against showing one user's data
// to another after a sign-out/sign-in.
const tabDataCache: {
  userId: string | null;
  tabDataLoaded: boolean;
  myRatings: CommunityRating[];
  friendRatings: CommunityRating[];
  expertRatings: CommunityRating[];
  friendProfiles: Record<string, UserProfile>;
  expertProfiles: Record<string, UserProfile>;
  coordsLookedUp: Record<string, boolean>;
  discoverPlaces: PlaceResult[];
  discoverLoaded: boolean;
  hotelPlaces: PlaceResult[];
  hotelsLoaded: boolean;
  friendRecipes: FriendHomeMeal[];
  recipeAuthorProfiles: Record<string, UserProfile>;
  friendRecipesLoaded: boolean;
} = { userId: null, tabDataLoaded: false, myRatings: [], friendRatings: [], expertRatings: [], friendProfiles: {}, expertProfiles: {}, coordsLookedUp: {}, discoverPlaces: [], discoverLoaded: false, hotelPlaces: [], hotelsLoaded: false, friendRecipes: [], recipeAuthorProfiles: {}, friendRecipesLoaded: false };

// Module-level cache of Mapbox Directions API results. Keyed by rounded
// origin → destination so the same anchor + restaurant pair only ever
// triggers one driving and one walking request per session.
type RouteLeg = { distanceMeters: number; durationSeconds: number };
const routeCache = new Map<string, RouteLeg | null>();
const routeKey = (profile: 'driving' | 'walking', o: { lat: number; lng: number }, d: { lat: number; lng: number }) =>
  `${profile}:${o.lat.toFixed(4)},${o.lng.toFixed(4)}->${d.lat.toFixed(4)},${d.lng.toFixed(4)}`;
async function fetchMapboxLeg(
  profile: 'driving' | 'walking',
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
  token: string,
): Promise<RouteLeg | null> {
  const key = routeKey(profile, origin, dest);
  if (routeCache.has(key)) return routeCache.get(key) ?? null;
  if (!token) { routeCache.set(key, null); return null; }
  const coords = `${origin.lng},${origin.lat};${dest.lng},${dest.lat}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}?access_token=${token}&overview=false&alternatives=false`;
  try {
    const res = await fetch(url);
    if (!res.ok) { routeCache.set(key, null); return null; }
    const data = await res.json();
    const r = data?.routes?.[0];
    if (!r) { routeCache.set(key, null); return null; }
    const leg: RouteLeg = { distanceMeters: r.distance ?? 0, durationSeconds: r.duration ?? 0 };
    routeCache.set(key, leg);
    return leg;
  } catch {
    routeCache.set(key, null);
    return null;
  }
}

interface DiscoverProps {
  mode?: 'home' | 'map';
}

/** Time-of-day → greeting word. Drives "Good morning, Tyler" etc. */
function getGreetingPart(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

/** Day-of-week label for the hero eyebrow. */
const HERO_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Prominent "See all / Browse all" pill — white surface, primary outline,
 *  primary label, and a filled primary circle with a right arrow. Matches the
 *  redesign reference and is reused across every Discover-home rail/section so
 *  the call-to-action reads the same everywhere. Renders a <Link> when `to` is
 *  given, otherwise a <button> with `onClick`. */
const SeeAllPill: React.FC<{ label: string; to?: string; onClick?: () => void; className?: string }> = ({ label, to, onClick, className }) => {
  const cls = cn(
    'inline-flex flex-shrink-0 items-center gap-2 rounded-full bg-paper border-[1.5px] border-primary pl-4 pr-2 py-[7px] text-[13px] font-bold text-primary shadow-sm transition-colors hover:bg-primary/[0.06] active:scale-[0.98]',
    className,
  );
  const inner = (
    <>
      {label}
      <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-primary text-white">
        <ArrowRight size={13} strokeWidth={2.6} />
      </span>
    </>
  );
  return to
    ? <Link to={to} className={cls}>{inner}</Link>
    : <button type="button" onClick={onClick} className={cls}>{inner}</button>;
};

/** Stable hash → 0-360 hue. Used to derive a consistent gradient color
 *  per restaurant/recipe id so the placeholder image area has visual
 *  variety without needing real photos. */
function hashToHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h * 31) + str.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

export const Discover: React.FC<DiscoverProps> = ({ mode = 'home' }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { setHideBottomNav, phoneMode, darkMode } = useSettings();
  // Michelin dataset readiness. michCuisinePrice() overrides a place's
  // cuisine/price from the Guide data when matched (no marker on cards — that's
  // detail-page only); falls back to the supplied Google-derived values.
  const michelinReady = useMichelinIndexReady();
  const michCuisinePrice = useCallback(
    (place: { name: string; lat?: number; lng?: number; fullAddress?: string; address?: string }, cuisine: string, price: string) => {
      const hit = michelinReady
        ? findMichelinMatchSync(place.name, place.lat, place.lng, place.fullAddress || place.address)
        : null;
      return hit ? { cuisine: hit.cuisine, price: michelinPriceDisplay(hit) } : { cuisine, price };
    },
    [michelinReady],
  );
  // Wide viewport (>= lg): the global DesktopHeader provides the
  // search input + actions, so Discover's own TopBar / inline search
  // bar are redundant and would stack on top of it.
  const [isWideViewport, setIsWideViewport] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsWideViewport(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const usingDesktopHeader = isWideViewport && !phoneMode;

  // Scroll-driven mobile Discover header. The full bar is *scrubbed* to the
  // scroll position — it fades out gradually as you scroll down (speed and
  // direction don't matter), reaching empty by the time the day/location line
  // reaches the top. Past that point a backgroundless "mini" cluster (create /
  // search / chat / circle) slides in on scroll-up. Motion values keep it
  // smooth under the home feed's constant re-renders.
  const homeHeaderRef = useRef<HTMLDivElement>(null);
  const homeScrollRef = useRef<HTMLDivElement>(null);
  const dayLocRef = useRef<HTMLParagraphElement>(null);
  const lastHomeScrollY = useRef(0);
  const miniShownRef = useRef(false);
  const fadeDistRef = useRef(120);
  const [homeHeaderH, setHomeHeaderH] = useState(0);
  const headerOpacity = useMotionValue(1);
  const headerY = useMotionValue(0);
  const miniOpacity = useMotionValue(0);
  const miniY = useMotionValue(-10);
  const headerPE = useTransform(headerOpacity, (o) => (o > 0.4 ? 'auto' : 'none'));
  const miniPE = useTransform(miniOpacity, (o) => (o > 0.5 ? 'auto' : 'none'));

  const handleHomeScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const y = e.currentTarget.scrollTop;
    const prev = lastHomeScrollY.current;
    const fadeDist = Math.max(1, fadeDistRef.current);
    // Full header: opacity tied to scroll position, so it eases away at the
    // same rate however fast you scroll, and eases back in as you return.
    const fo = Math.min(1, Math.max(0, 1 - y / fadeDist));
    headerOpacity.set(fo);
    headerY.set(-(1 - fo) * 10);
    // Mini cluster: only once the full header is gone (past the fade zone),
    // and only when scrolling up.
    const T = { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const };
    if (y <= fadeDist) {
      if (miniShownRef.current) { miniShownRef.current = false; animate(miniOpacity, 0, T); animate(miniY, -10, T); }
    } else {
      const delta = y - prev;
      if (delta > 4 && miniShownRef.current) { miniShownRef.current = false; animate(miniOpacity, 0, T); animate(miniY, -10, T); }
      else if (delta < -4 && !miniShownRef.current) { miniShownRef.current = true; animate(miniOpacity, 1, T); animate(miniY, 0, T); }
    }
    lastHomeScrollY.current = y;
  }, [headerOpacity, headerY, miniOpacity, miniY]);

  // Measure the full header (so the scroll content can clear the absolute
  // overlay) and the fade distance — the scroll offset at which the
  // day/location line reaches the top.
  useLayoutEffect(() => {
    if (!phoneMode) return;
    const measure = () => {
      if (homeHeaderRef.current) setHomeHeaderH(homeHeaderRef.current.offsetHeight);
      const sc = homeScrollRef.current, el = dayLocRef.current;
      if (sc && el) {
        fadeDistRef.current = Math.max(40, el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop);
      } else if (homeHeaderRef.current) {
        fadeDistRef.current = homeHeaderRef.current.offsetHeight + 12;
      }
    };
    measure();
    const raf = requestAnimationFrame(measure); // re-measure after layout settles
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', measure); };
  }, [phoneMode, homeHeaderH]);

  // Map page on desktop replaces the bottom sheet with a resizable left
  // panel that sits between the nav rail and the map. Width is persisted
  // to localStorage so the user's preferred split survives reloads.
  const isDesktopMapMode = mode === 'map' && usingDesktopHeader;

  // Edge-swipe-from-left → /create. Touches that start within ~24px of
  // the page's left edge and move >60px right (more horizontal than
  // vertical) open the Create page so it slides in alongside the App
  // route transition. Mobile-only — the gesture is opt-in via phoneMode
  // so it doesn't fight desktop pointer interactions.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!phoneMode) return;
    const el = rootRef.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let armed = false;
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const rect = el.getBoundingClientRect();
      const localX = t.clientX - rect.left;
      armed = localX <= 24;
      if (armed) {
        startX = t.clientX;
        startY = t.clientY;
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!armed) return;
      armed = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (dx > 60 && Math.abs(dx) > Math.abs(dy)) {
        navigate('/create');
      }
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart, { capture: true } as EventListenerOptions);
      el.removeEventListener('touchend', onTouchEnd, { capture: true } as EventListenerOptions);
    };
  }, [phoneMode, navigate]);
  const MAP_PANEL_MIN = 320;
  const MAP_PANEL_MAX = 600;
  const MAP_PANEL_DEFAULT = 400;
  const [mapPanelWidth, setMapPanelWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return MAP_PANEL_DEFAULT;
    const stored = window.localStorage.getItem('mapPanelWidth');
    const n = stored ? parseInt(stored, 10) : NaN;
    if (!Number.isFinite(n)) return MAP_PANEL_DEFAULT;
    return Math.min(MAP_PANEL_MAX, Math.max(MAP_PANEL_MIN, n));
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('mapPanelWidth', String(mapPanelWidth));
  }, [mapPanelWidth]);
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const startPanelResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = mapPanelWidth;
    setIsResizingPanel(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const next = Math.min(MAP_PANEL_MAX, Math.max(MAP_PANEL_MIN, startWidth + dx));
      setMapPanelWidth(next);
    };
    const onUp = () => {
      setIsResizingPanel(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [mapPanelWidth]);
  const { openAddRestaurantModal, openRatingModal, toggleWishlist, isWishlisted, ratings: myLocalRatings, lists: myLists, wishlist, homeMeals, restaurantMeta } = useLists();
  const {
    friendRecipes: friendPublishedRecipes,
    expertRecipes: expertPublishedRecipes,
    publicRecipes: publicPublishedRecipes,
    fetchFriendRecipes, fetchExpertRecipes, fetchPublicRecipes,
  } = useRecipes();
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;
  const { openGuideCreator } = useGuideCreator();

  // Published guides on Discover. Loaded once per session — there's no
  // pagination yet so we cap to a reasonable rail length.
  const [feedGuides, setFeedGuides] = useState<GuideRow[]>([]);
  // "Browse all" guides popup — search / author-filter over the guide pool.
  const [guidesBrowserOpen, setGuidesBrowserOpen] = useState(false);
  const [feedGuideAuthors, setFeedGuideAuthors] = useState<Record<string, UserProfile>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const gs = await getGuidesForFeed({ limit: 12, excludeUserId: userId || undefined });
      if (cancelled) return;
      setFeedGuides(gs);
      const authorIds = Array.from(new Set(gs.map((g) => g.userId)));
      if (authorIds.length > 0) {
        const profiles = await getProfilesByIds(authorIds);
        if (!cancelled) setFeedGuideAuthors(profiles);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Real guides for the "Browse all" popup — a broader public pool than the
  // rail (includes the caller's own guides; no filler). Fetched once on mount
  // so the popup opens populated.
  const [browseGuides, setBrowseGuides] = useState<BrowseGuide[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const gs = await getGuidesForFeed({ limit: 60 });
      if (cancelled) return;
      const authorIds = Array.from(new Set(gs.map((g) => g.userId)));
      const authors = authorIds.length > 0 ? await getProfilesByIds(authorIds) : {};
      if (cancelled) return;
      const dayMs = 86400000;
      setBrowseGuides(gs.map((g) => {
        const t = Date.parse(g.updatedAt || '');
        const a = authors[g.userId];
        return {
          id: g.id,
          title: g.title.trim() || 'Untitled guide',
          author: a?.display_name || a?.username || 'A local',
          image: g.coverPhoto || '',
          count: g.entries.length,
          daysAgo: Number.isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / dayMs)),
        };
      }));
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Friends list — used by the mobile greeting hero for the "friends added X
  // new spots this week" subtitle and the "Friends Out" stat card avatars.
  const [friendsList, setFriendsList] = useState<UserProfile[]>([]);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const friends = await getFriends(userId);
      const ids = friends.map((f) => f.friend_id).filter(Boolean);
      if (ids.length === 0) { if (!cancelled) setFriendsList([]); return; }
      const profs = await getProfilesByIds(ids);
      if (cancelled) return;
      setFriendsList(Object.values(profs));
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Mobile filter-chips row (All / Recommendations / Recipes / Guides).
  // Filters which of the three top rails render; the Friend Activity
  // feed below the rails is always visible regardless of selection.
  const [discoverChip, setDiscoverChip] = useState<'all' | 'recommendations' | 'recipes' | 'guides'>('all');
  // Drives the headless HomeLocationBar picker from the greeting's
  // neighborhood label — restores the location-switch popup the old
  // mobile header used to expose via the chevron control.
  const [mobileLocationPickerOpen, setMobileLocationPickerOpen] = useState(false);

  // Data for My Ratings and Friends tabs — initialized from cache if it was
  // populated for this user earlier in the session. Cache lives until reload.
  const cacheHit = userId && tabDataCache.userId === userId && tabDataCache.tabDataLoaded;
  const [myRatings, setMyRatings] = useState<CommunityRating[]>(cacheHit ? tabDataCache.myRatings : []);
  const [friendRatings, setFriendRatings] = useState<CommunityRating[]>(cacheHit ? tabDataCache.friendRatings : []);
  const [friendProfiles, setFriendProfiles] = useState<Record<string, UserProfile>>(cacheHit ? tabDataCache.friendProfiles : {});
  const [expertProfiles, setExpertProfiles] = useState<Record<string, UserProfile>>(cacheHit ? tabDataCache.expertProfiles : {});
  const [expertRatings, setExpertRatings] = useState<CommunityRating[]>(cacheHit ? tabDataCache.expertRatings : []);
  const [tabDataLoaded, setTabDataLoaded] = useState(!!cacheHit);
  // True once we've actually finished fetching the user's ratings (or once
  // we know there's no user to fetch for). Used by the focus-deep-link
  // handler to decide which tab to open the incoming restaurant on.
  const [userDataReady, setUserDataReady] = useState<boolean>(() => !!cacheHit || !userId);

  // Load data for non-discover tabs (skipped if cache was fresh)
  useEffect(() => {
    if (!userId) { setUserDataReady(true); return; }
    if (tabDataLoaded) return;
    setTabDataLoaded(true);
    (async () => {
      const [myR, friendR, expertR] = await Promise.all([
        getUserRatings(userId),
        getAllFriendRatings(userId),
        getExpertRatings(200),
      ]);
      setMyRatings(myR);
      setFriendRatings(friendR);
      setExpertRatings(expertR);
      let profs: Record<string, UserProfile> = {};
      let expProfs: Record<string, UserProfile> = {};
      const friendIds = friendR.length > 0 ? [...new Set(friendR.map((r) => r.user_id))] : [];
      const expertIds = expertR.length > 0 ? [...new Set(expertR.map((r) => r.user_id))] : [];
      if (friendIds.length > 0 || expertIds.length > 0) {
        const allIds = [...new Set([...friendIds, ...expertIds])];
        const allProfs = await getProfilesByIds(allIds);
        friendIds.forEach((id) => { if (allProfs[id]) profs[id] = allProfs[id]; });
        expertIds.forEach((id) => { if (allProfs[id]) expProfs[id] = allProfs[id]; });
        setFriendProfiles(profs);
        setExpertProfiles(expProfs);
      }
      // Update module-level cache (kept for the session — no TTL)
      tabDataCache.userId = userId;
      tabDataCache.myRatings = myR;
      tabDataCache.friendRatings = friendR;
      tabDataCache.expertRatings = expertR;
      tabDataCache.friendProfiles = profs;
      tabDataCache.expertProfiles = expProfs;
      tabDataCache.tabDataLoaded = true;
      setUserDataReady(true);
    })();
  }, [userId, tabDataLoaded]);
  // Focus-only mode: when the user arrives via a `state.focus` deep-link
  // from a Restaurant Detail mini-map tap, the Map page shows ONLY that
  // restaurant's marker, centred on the screen. Computed once at mount
  // from the router location so the map-init effect (which has empty
  // deps) can branch on it.
  const [initialFocus] = useState<{
    id: string;
    name: string;
    lat: number;
    lng: number;
    address?: string;
    fullAddress?: string;
    photoUrl?: string | null;
    priceLevel?: number;
    rating?: number;
    types?: string[];
    userRatingCount?: number;
  } | null>(() => {
    if (mode !== 'map') return null;
    const f = (location.state as any)?.focus;
    if (!f || !Number.isFinite(f.lat) || !Number.isFinite(f.lng)) return null;
    return f;
  });
  const [isFocusOnly, setIsFocusOnly] = useState<boolean>(() => initialFocus !== null);
  const isFocusOnlyRef = useRef(isFocusOnly);
  isFocusOnlyRef.current = isFocusOnly;

  const [mapMode, setMapModeRaw] = useState<'discover' | 'myratings' | 'friends' | 'experts' | 'hotels' | 'recipes'>(() => {
    const saved = sessionStorage.getItem('map-mode');
    return (saved === 'myratings' || saved === 'friends' || saved === 'experts' || saved === 'hotels' || saved === 'recipes') ? saved : 'discover';
  });
  const setMapMode = (mode: 'discover' | 'myratings' | 'friends' | 'experts' | 'hotels' | 'recipes') => {
    setMapModeRaw(mode);
    sessionStorage.setItem('map-mode', mode);
    // An explicit tab switch ends any AI-chat map takeover.
    assistantPlotActiveRef.current = false;
    // Any explicit mode change exits focus-only view so the user can see
    // the full set of markers for that mode.
    setIsFocusOnly(false);
    // Reset rating filters when switching modes
    setRatingSortBy('recent');
    setScoreRange([0, 10]);
    setRatingCuisines([]);
    setRatingPrice(null);
    setRatingCities([]);
  };
  const [hotelPlaces, setHotelPlaces] = useState<PlaceResult[]>(() => tabDataCache.hotelPlaces);
  const [hotelsLoading, setHotelsLoading] = useState(false);
  // Recipes mode: friends' public home meals + the meal we're viewing in modal.
  const [friendRecipes, setFriendRecipes] = useState<FriendHomeMeal[]>(() => tabDataCache.friendRecipes);
  const [friendRecipesLoading, setFriendRecipesLoading] = useState(false);
  const [recipeAuthorProfiles, setRecipeAuthorProfiles] = useState<Record<string, UserProfile>>(() => tabDataCache.recipeAuthorProfiles);
  const hotelMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const mapModeRef = useRef(mapMode);
  mapModeRef.current = mapMode;
  const [mapModeDropdownOpen, setMapModeDropdownOpen] = useState(false);
  // The My-Ratings list dropdown lives inside the horizontally-scrolling
  // filter bar (overflow-x clips it), so its menu is portaled to <body> and
  // positioned from the trigger's rect captured here on open.
  const mapDropdownBtnRef = useRef<HTMLButtonElement>(null);
  const [mapDropdownPos, setMapDropdownPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<string>>(new Set());
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(null);
  const [navDirection, setNavDirection] = useState<number>(0);
  // Arrow-navigation history for the place card. Tracks ids of places visited
  // via the ← / → arrows so we can loop through all loaded restaurants without
  // re-visiting and provide a true "back" action.
  const [navHistory, setNavHistory] = useState<string[]>([]);
  const navClickRef = useRef(false);
  // Reset nav history whenever a place is selected outside of the arrow
  // navigation (marker click, direct tap, swipe). Arrow navigation sets
  // navClickRef.current=true just before calling setSelectedPlace so we know
  // to preserve history.
  useEffect(() => {
    if (!selectedPlace) { setNavHistory([]); return; }
    if (navClickRef.current) { navClickRef.current = false; return; }
    setNavHistory([selectedPlace.id]);
  }, [selectedPlace]);
  // Default the map theme to the app's current mode (dark app → dark map).
  // The user can still override via the style picker.
  const [activeStyle, setActiveStyle] = useState<string>(darkMode ? 'dark' : 'light');
  const [showStylePicker, setShowStylePicker] = useState(false);
  const [is3D, setIs3D] = useState(false);
  // Refs so the map-init closure and the dark-mode sync effect read live values
  // without forcing the heavy map effect to re-run.
  const darkModeRef = useRef(darkMode);
  darkModeRef.current = darkMode;
  const activeStyleRef = useRef(activeStyle);
  activeStyleRef.current = activeStyle;
  // Follow the app's dark-mode toggle while the map is open — but only when on a
  // basic light/dark theme, so a manual satellite/streets choice is respected.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cur = activeStyleRef.current;
    if (cur !== 'light' && cur !== 'dark') return;
    const targetId = darkMode ? 'dark' : 'light';
    if (cur === targetId) return;
    const target = MAP_STYLES.find((s) => s.id === targetId);
    if (target) { try { map.setStyle(target.style); } catch { /* style swap best-effort */ } setActiveStyle(targetId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [darkMode]);
  const [places, setPlaces] = useState<PlaceResult[]>(() => tabDataCache.discoverPlaces);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSheetOpen, setFilterSheetOpenRaw] = useState(false);
  const setFilterSheetOpen = useCallback((show: boolean) => {
    setFilterSheetOpenRaw(show);
    setHideBottomNav(show);
  }, [setHideBottomNav]);

  // Filter state — discover
  const [sortBy, setSortBy] = useState<SortOption>('popularity');
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>([]);
  const [selectedPrice, setSelectedPrice] = useState(0);
  const [discoverRadius, setDiscoverRadius] = useState(5); // km
  // Michelin distinction filter (multi-select, OR). Empty = off. Applied
  // client-side to the rendered place list (Discover's cuisine/price filters
  // are server-side, but Michelin matching is local-only).
  const [selectedMichelin, setSelectedMichelin] = useState<string[]>([]);
  const toggleMichelin = useCallback((d: string) => {
    setSelectedMichelin((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }, []);

  // Hero chip filter — narrows the Recommended rail to a single cuisine.
  // `null` = "All". When set, an effect below keeps pulling more recs from
  // the engine until at least RECS_FILTER_MIN match (or the engine is
  // exhausted), so a niche cuisine doesn't render an empty rail.
  const [heroChipCuisine, setHeroChipCuisine] = useState<string | null>(null);

  // Refs for horizontal-scroll arrows on the Discover rails.
  const recRailRef = useRef<HTMLDivElement | null>(null);
  const recipeRailRef = useRef<HTMLDivElement | null>(null);
  const scrollRail = (ref: React.RefObject<HTMLDivElement | null>, dir: 1 | -1) => {
    if (!ref.current) return;
    ref.current.scrollBy({ left: dir * 560, behavior: 'smooth' });
  };

  // Filter state — ratings modes (myratings / friends / experts)
  const [ratingSortBy, setRatingSortBy] = useState<'recent' | 'highest' | 'lowest' | 'visited'>('recent');
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 10]);
  const [ratingCuisines, setRatingCuisines] = useState<string[]>([]);
  const [ratingPrice, setRatingPrice] = useState<string | null>(null);
  const [ratingCities, setRatingCities] = useState<string[]>([]);

  // Shared hours filter (breakfast/lunch/dinner + open now), used by every map mode.
  const [hoursFilter, setHoursFilter] = useState<HoursFilter>(emptyHoursFilter());

  // Filter state — hotels
  const [hotelStarFilter, setHotelStarFilter] = useState<number>(0); // 0=Any, 3/4/5
  const [hotelPriceFilter, setHotelPriceFilter] = useState(0);
  const [hotelSortBy, setHotelSortBy] = useState<'popularity' | 'rating' | 'price_low'>('popularity');

  const [showSearchHere, setShowSearchHere] = useState(false);
  // Dismissible first-time hint that explains the map-mode tabs. State-only —
  // resets on every mount so we don't need to plumb anything into storage.

  // Location search
  const [locationSearchOpen, setLocationSearchOpen] = useState(false);
  const [locationQuery, setLocationQuery] = useState('');
  const [locationResults, setLocationResults] = useState<Array<{ id: string; name: string; lat: number; lng: number }>>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationInputRef = useRef<HTMLInputElement>(null);
  const [searchLocationBias, setSearchLocationBias] = useState<{ lat: number; lng: number } | null>(null);

  // Distance anchor: where every card / detail measures from.
  // - When the user types a location in the location-search box, we lock the
  //   anchor to that point ("typed override").
  // - Otherwise the anchor is wherever the map is currently centred so the
  //   distances stay roughly relevant as the user pans.
  // - The override is cleared when the user (a) types a new location, (b)
  //   hits "Search this area" / fetchNearby, or (c) pans the map farther
  //   than REFERENCE_CLEAR_RADIUS_MILES from the typed point.
  const REFERENCE_CLEAR_RADIUS_MILES = 15;
  const [referenceLocation, setReferenceLocation] = useState<{ lat: number; lng: number; name?: string } | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const referenceLocationRef = useRef(referenceLocation);
  useEffect(() => { referenceLocationRef.current = referenceLocation; }, [referenceLocation]);
  // The point distances are measured from. Falls back to the live map centre.
  const distanceOrigin = useMemo(() => {
    if (referenceLocation) return { lat: referenceLocation.lat, lng: referenceLocation.lng };
    return mapCenter;
  }, [referenceLocation, mapCenter]);

  // Human-readable miles. Tiny distances collapse to "<0.1 mi" so we never
  // render "0.0 mi" for places that share the anchor.
  const formatDistanceMiles = useCallback((km: number): string => {
    const mi = km * 0.621371;
    if (!Number.isFinite(mi)) return '';
    if (mi < 0.1) return '<0.1 mi';
    if (mi < 10) return `${mi.toFixed(1)} mi`;
    return `${Math.round(mi)} mi`;
  }, []);
  const distanceFromAnchor = useCallback((lat?: number | null, lng?: number | null): string | null => {
    if (!distanceOrigin || !Number.isFinite(lat as number) || !Number.isFinite(lng as number)) return null;
    if ((lat as number) === 0 && (lng as number) === 0) return null;
    const km = haversineKm({ lat: lat as number, lng: lng as number }, distanceOrigin);
    return formatDistanceMiles(km);
  }, [distanceOrigin, formatDistanceMiles]);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  // Becomes true once the Mapbox `load` event has fired so consumers (e.g.
  // the focus-deep-link handler) know the map is ready to receive flyTo.
  const [mapReady, setMapReady] = useState(false);
  const markersRef = useRef<{ [id: string]: mapboxgl.Marker }>({});
  // True while the AI chat has taken over the discover map with its own
  // recommended places — suppresses the expert overlay so only those pins
  // show. Reset by any explicit user re-search / area / tab change.
  const assistantPlotActiveRef = useRef(false);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchWrapperRef = useRef<HTMLFormElement>(null);
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMarkerSelectedRef = useRef(false); // tracks if a marker is actively selected (suppresses re-fetch)
  const expertOverlayMarkersRef = useRef<mapboxgl.Marker[]>([]); // expert markers shown in discover mode
  const filtersRef = useRef({ sortBy: 'popularity' as SortOption, selectedCuisines: [] as string[], selectedPrice: 0, selectedMichelin: [] as string[], hoursFilter: emptyHoursFilter() });

  // Keep ref in sync with state so the moveend callback sees current values
  useEffect(() => {
    filtersRef.current = { sortBy, selectedCuisines, selectedPrice, selectedMichelin, hoursFilter };
  }, [sortBy, selectedCuisines, selectedPrice, selectedMichelin, hoursFilter]);
  // Ref so the stable getFilteredPlaces callback can read restaurant hours
  // (from restaurantMeta) without being re-created on every meta update.
  const restaurantMetaRef = useRef(restaurantMeta);
  restaurantMetaRef.current = restaurantMeta;

  // Bottom sheet state — tri-state: peek (collapsed), half (partial), full (full-screen discover)
  // Home mode forces 'full' (no map); Map mode opens at 'peek' (map-forward,
  // with the redesigned header + first results peeking) and cannot reach 'full'.
  const [sheetState, setSheetState] = useState<'peek' | 'half' | 'full'>(mode === 'map' ? 'peek' : 'full');
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartYRef = useRef(0);
  const dragCurrentYRef = useRef(0);
  const isDraggingRef = useRef(false);
  // Peek shows the sheet header (title + search + tabs) plus a glimpse of the
  // first result, matching the reference's map-prominent layout.
  // Collapsed height: just the drag handle + the "Discover" title peeking at the
  // bottom, so the map gets almost the whole screen. Drag up for the list.
  const PEEK_HEIGHT = 104;
  const FULL_HEIGHT = typeof window !== 'undefined' ? window.innerHeight : 800;
  // Safe-area inset at the top (status bar / notch), read once. The map sheet's
  // top edge never rises above this, so it can't slide under the notch.
  const safeTopRef = useRef<number | null>(null);
  if (safeTopRef.current === null) {
    safeTopRef.current = typeof window !== 'undefined'
      ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat-top')) || 0)
      : 0;
  }
  // On the map page the sheet is a true bottom sheet: it expands to ~88% of the
  // screen (its tallest state, 'half') but its top always stays clear of the
  // safe area — it can never reach a full-screen state or slide into the notch.
  // The top edge sits at the larger of 12% of the screen or the safe-area inset
  // plus a small gap. Home has no map underneath, so it keeps the 85% partial.
  const MAP_TOP_INSET = Math.max(FULL_HEIGHT * 0.12, safeTopRef.current + 12);
  const HALF_HEIGHT = mode === 'map' ? (FULL_HEIGHT - MAP_TOP_INSET) : FULL_HEIGHT * 0.85;
  const getSheetY = (state: 'peek' | 'half' | 'full') => {
    let y = state === 'full' ? 0 : state === 'half' ? FULL_HEIGHT - HALF_HEIGHT : FULL_HEIGHT - PEEK_HEIGHT;
    // Hard cap on the map page: the sheet top can never rise above its 'half'
    // position (≈88%, below the safe area), so the map stays visible and the
    // sheet never enters the notch — no matter the state or how far it's dragged.
    if (mode === 'map') y = Math.max(y, FULL_HEIGHT - HALF_HEIGHT);
    return y;
  };

  // Single source of truth for the sheet's vertical position. Driving one motion
  // value (instead of swapping inline transforms) keeps every transition — taps,
  // marker selection, drag-release snap-back, programmatic opens — a smooth
  // spring with no instant jumps.
  const SHEET_SPRING = { type: 'spring' as const, damping: 32, stiffness: 300, mass: 0.8 };
  const sheetY = useMotionValue(getSheetY(mode === 'map' ? 'peek' : 'full'));
  useEffect(() => {
    const controls = animate(sheetY, getSheetY(sheetState), SHEET_SPRING);
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetState, mode, FULL_HEIGHT]);

  // ── Discover feed state ──
  const [discoverSearchActive, setDiscoverSearchActive] = useState(false);
  const NEARBY_INITIAL = 4;
  const NEARBY_INCREMENT = 12;
  const [nearbyShowCount, setNearbyShowCount] = useState(NEARBY_INITIAL);
  const preSearchPlacesRef = useRef<PlaceResult[]>([]);

  // ── Home-page location anchor ──
  // Drives the personalised Recommendations row, the Guides row, and the
  // distance-sort order of the Friend Activity feed. Defaults to the device's
  // current location on every app open (the user's last selection is only a
  // fallback for when geolocation is denied). The in-session choice persists
  // across navigation because it lives in component state.
  // Home location now lives in HomeLocationContext so the sticky
  // DesktopHeader chip can mutate it without prop-drilling through every
  // route. We keep the local `homeLocation` / `setHomeLocation` names so
  // the rest of this huge component reads unchanged.
  const homeLocationCtx = useHomeLocation();
  const homeLocation = homeLocationCtx?.location ?? null;
  const setHomeLocation = useCallback((loc: HomeLocation | null) => {
    if (loc && homeLocationCtx) homeLocationCtx.setLocation(loc);
  }, [homeLocationCtx]);
  // Brief fade overlay applied while the feed refetches after a location swap.
  const [homeLocationRefreshing, setHomeLocationRefreshing] = useState(false);
  // Watch location changes (from this page OR the sticky DesktopHeader chip)
  // and flash the refresh fade so the Recommended rail doesn't pop without
  // any visual cue.
  const lastLocKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!homeLocation) {
      lastLocKeyRef.current = null;
      return;
    }
    const key = `${homeLocation.lat.toFixed(4)},${homeLocation.lng.toFixed(4)}`;
    if (lastLocKeyRef.current && lastLocKeyRef.current !== key) {
      setHomeLocationRefreshing(true);
      const t = window.setTimeout(() => setHomeLocationRefreshing(false), 450);
      return () => window.clearTimeout(t);
    }
    lastLocKeyRef.current = key;
  }, [homeLocation]);

  // Recent views from localStorage
  const [recentViews, setRecentViews] = useState<Array<PlaceResult & { viewedAt: number }>>(() => {
    try {
      const raw = localStorage.getItem('gourmad-recent-views');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  const removeRecentView = useCallback((id: string) => {
    setRecentViews((prev) => {
      const next = prev.filter((v) => v.id !== id);
      localStorage.setItem('gourmad-recent-views', JSON.stringify(next));
      if (userId && supabaseConfigured) saveRecentViews(userId, next);
      return next;
    });
  }, [userId]);

  // Taste profile is centralised in src/lib/recommendations.ts so Map.tsx and
  // anything else that needs preference-weighted picks share the same weighting
  // math (score-centered around 7, wishlist nudges, list-name → tag signals).
  const userPreferences = useMemo<TasteProfile>(
    () => buildTasteProfile(myLocalRatings, wishlist, myLists, recentViews),
    [myLocalRatings, wishlist, myLists, recentViews],
  );

  // Radius scope for the Recommended For You row (miles). Persisted so the
  // user's pick survives reloads and drives both the Google query radius and
  // the post-score distance penalty in scoreCandidates. Now a constant
  // after the chip picker was removed; see REC_RADIUS_MILES above.
  const recRadiusMiles = REC_RADIUS_MILES;

  // Manual refresh for the Recommended For You row. Drops every cache layer
  // for the current location (session + Supabase) so the next fetch goes
  // straight to Google with the picked radius. Resets the dedup/cursor refs
  // so a refetched batch can re-add the same place ids cleanly. The nonce
  // bump is what re-runs the orchestrating effect.
  const refreshRecs = useCallback(() => {
    if (!homeLocation) return;
    const locKey = locationKey(homeLocation.lat, homeLocation.lng);
    delete sessionRecsCache[locKey];
    if (userId && supabaseConfigured) {
      // Fire-and-forget — we don't block the user on a cache delete.
      supabase.from('home_rec_cache')
        .delete().eq('user_id', userId).eq('location_key', locKey)
        .then(undefined, () => { /* ignore */ });
    }
    recsFetchedRef.current = false;
    recsSeenIdsRef.current = new Set();
    recsQueryCursorRef.current = 0;
    recsExhaustedRef.current = false;
    setApiRecommendations([]);
    setRecRefreshNonce((n) => n + 1);
  }, [homeLocation, userId]);

  // Bumped by the refresh button. The orchestrating recs effect lists this in
  // its deps so we get a re-fetch even when nothing else changed (location +
  // radius + prefs all the same), after we've torn down the cached pool.
  const [recRefreshNonce, setRecRefreshNonce] = useState(0);

  // Social signals for scoreCandidates — refetched once per (userId, home city)
  // change and reused across every load-more batch. expertRecRestaurantIds is
  // fetched once from the (small) expert_recommendations table, not per batch.
  const [recSignals, setRecSignals] = useState<CandidateSignals>(() => ({
    expertUserIds: new Set(),
    followedExpertIds: new Set(),
    friendUserIds: new Set(),
    communityByRestaurant: new Map(),
    expertRecRestaurantIds: new Set(),
  }));

  // API-based curated recommendations (not derived from recently viewed).
  const [apiRecommendations, setApiRecommendations] = useState<PlaceResult[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsLoadingMore, setRecsLoadingMore] = useState(false);
  const recsFetchedRef = useRef(false);
  const recsQueryCursorRef = useRef(0);
  const recsExhaustedRef = useRef(false);
  const recsSeenIdsRef = useRef<Set<string>>(new Set());

  const recommendations = apiRecommendations;

  // Community-supplied price fallback: when Google has no priceLevel for
  // a place (parsePriceLevel returns -1, priceLevelToString returns '')
  // we look up the mode of users' rated prices in community_ratings.
  // Batched fetch so the whole rail resolves in one round trip; cache
  // keyed by place id so we never re-fetch a known answer.
  const [communityPrices, setCommunityPrices] = useState<Record<string, string>>({});
  useEffect(() => {
    if (mode !== 'home' || recommendations.length === 0) return;
    const needLookup = recommendations
      .filter((p) => ((p as any).priceLevel ?? -1) < 1)
      .map((p) => p.id)
      .filter((id) => id && !(id in communityPrices));
    if (needLookup.length === 0) return;
    let cancelled = false;
    getCommunityPricesForPlaces(needLookup).then((map) => {
      if (cancelled) return;
      // Mark every id we asked about so we don't refetch ones that
      // came back empty; an empty string entry is a "tried, none found"
      // sentinel that priceLevelToString(...) || communityPrice falsy-
      // checks past naturally.
      setCommunityPrices((prev) => {
        const next = { ...prev };
        for (const id of needLookup) next[id] = map[id] || '';
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [recommendations, mode, communityPrices]);

  // User's top rated restaurants
  const topRated = useMemo(() => {
    return [...myLocalRatings].filter((r) => r.score >= 7 && r.image).sort((a, b) => b.score - a.score).slice(0, 6);
  }, [myLocalRatings]);

  // ── Recipes For You ──
  // Pull the friend / expert / public pools once on sign-in. Each pool is
  // cached on RecipesContext so re-renders don't refetch.
  const recipesFetchedRef = useRef(false);
  useEffect(() => {
    if (!userId || recipesFetchedRef.current) return;
    recipesFetchedRef.current = true;
    fetchFriendRecipes();
    fetchExpertRecipes();
    fetchPublicRecipes();
  }, [userId, fetchFriendRecipes, fetchExpertRecipes, fetchPublicRecipes]);

  // Taste signal from logged Home Cooking meals (cuisine + tags weighted by
  // score), mirroring how restaurant recs derive preferences from ratings.
  const recipePreferences = useMemo(() => {
    const cuisineCounts: Record<string, number> = {};
    const tagCounts: Record<string, number> = {};
    homeMeals.forEach((m) => {
      const w = m.score >= 7 ? 2 : 1;
      if (m.cuisine) {
        const k = m.cuisine.toLowerCase();
        cuisineCounts[k] = (cuisineCounts[k] || 0) + w;
      }
      m.tags.forEach((t) => {
        const k = t.toLowerCase();
        tagCounts[k] = (tagCounts[k] || 0) + w;
      });
    });
    return { cuisineCounts, tagCounts };
  }, [homeMeals]);

  // Score + dedupe across pools. Friend > expert > public on the base; ties
  // break by cuisine + tag overlap with the taste signal. Hides recipes the
  // user has already cooked under the same name.
  const recommendedRecipes = useMemo(() => {
    type Scored = Recipe & { _source: 'friend' | 'expert' | 'public'; _score: number };
    const seen = new Set<string>();
    const cooked = new Set(homeMeals.map((m) => m.name.trim().toLowerCase()));
    const scored: Scored[] = [];

    const consume = (recipes: Recipe[], source: Scored['_source'], baseWeight: number) => {
      for (const r of recipes) {
        if (!r?.id || seen.has(r.id)) continue;
        if (cooked.has(r.title.trim().toLowerCase())) continue;
        seen.add(r.id);
        let s = baseWeight;
        if (r.cuisine) s += (recipePreferences.cuisineCounts[r.cuisine.toLowerCase()] || 0) * 3;
        for (const t of r.tags) s += recipePreferences.tagCounts[t.toLowerCase()] || 0;
        scored.push({ ...r, _source: source, _score: s });
      }
    };

    // Friends post recipes via two paths: the formal /recipes flow
    // (Recipe rows in `recipes`) and the meal logger (HomeMeal rows
    // stored in user_app_data.home_meals). Both count as "friend
    // recipes" for the home rail — adapt the HomeMeal shape into the
    // Recipe contract on the fly so the same scoring works for both.
    // The raw meal id is preserved (no prefix) so the card link can
    // resolve to /recipe/:userId/:id and the unified RecipePage fetches
    // the home meal from user_app_data.home_meals.
    const friendHomeMealsAsRecipes: Recipe[] = (friendRecipes || [])
      .filter((m) => m.isPublic !== false && (m.name || '').trim().length > 0)
      .map((m) => ({
        id: m.id,
        userId: m.userId,
        title: m.name,
        description: m.description || '',
        ingredients: m.ingredients || [],
        steps: (m.steps || []).map((text, i) => ({ order: i, text })),
        prepTimeMinutes: m.prepTime ?? null,
        cookTimeMinutes: m.cookTime ?? null,
        servings: m.servings ?? null,
        difficulty: (m.difficulty?.toLowerCase() ?? 'medium') as 'easy' | 'medium' | 'hard',
        cuisine: m.cuisine || '',
        tags: m.tags || [],
        photos: m.coverPhoto ? [m.coverPhoto] : (m.photos?.map((p) => p.url).filter(Boolean) || []),
        isPublic: true,
        sourceType: 'user',
        linkedRestaurantId: null,
        linkedMealId: null,
        createdAt: new Date(m.createdAt ?? Date.now()).toISOString(),
        updatedAt: new Date(m.createdAt ?? Date.now()).toISOString(),
      }));

    consume(friendPublishedRecipes, 'friend', 8);
    consume(friendHomeMealsAsRecipes, 'friend', 8);
    consume(expertPublishedRecipes, 'expert', 5);
    consume(publicPublishedRecipes, 'public', 1);

    scored.sort((a, b) => b._score - a._score);
    return scored.slice(0, 8);
  }, [friendPublishedRecipes, friendRecipes, expertPublishedRecipes, publicPublishedRecipes, homeMeals, recipePreferences]);

  // Map each city the user eats in to a representative lat/lng, computed as
  // the centroid of that city's high-rated community ratings. Used so that
  // per-city queries pull results from THAT city instead of wherever the
  // Discover map happens to be centered.
  const cityCoordMap = useMemo(() => {
    const acc: Record<string, { lat: number; lng: number; count: number }> = {};
    for (const r of myRatings) {
      if (Number(r.score) < 7) continue;
      if (r.lat == null || r.lng == null) continue;
      if (Math.abs(r.lat) < 1 && Math.abs(r.lng) < 1) continue;
      const city = extractCityState(r.address || '', r.address || '');
      if (!city) continue;
      const cur = acc[city];
      if (!cur) acc[city] = { lat: r.lat, lng: r.lng, count: 1 };
      else {
        cur.lat = (cur.lat * cur.count + r.lat) / (cur.count + 1);
        cur.lng = (cur.lng * cur.count + r.lng) / (cur.count + 1);
        cur.count++;
      }
    }
    const out: Record<string, { lat: number; lng: number }> = {};
    for (const [k, v] of Object.entries(acc)) out[k] = { lat: v.lat, lng: v.lng };
    return out;
  }, [myRatings]);

  // Thin wrapper around buildCandidateQueries — Map passes a city override
  // from the home-location dropdown; the engine treats it as target.label so
  // the queries read "best X in <selected city>" regardless of the user's
  // historical topCities.
  const buildRecQueries = useCallback((cityOverride?: string | null) => {
    const label = cityOverride ?? userPreferences.topCity ?? '';
    // buildCandidateQueries only reads target.label; lat/lng are unused here.
    return buildCandidateQueries(userPreferences, { label, lat: 0, lng: 0 });
  }, [userPreferences]);

  // Fetch a batch of recommendations. Home mode anchors to the selected home
  // location and scopes Google to the picked radius; browse mode still uses
  // the map centre and the original 50 km bias so existing map behaviour is
  // untouched.
  const fetchRecBatch = useCallback(async (queryStrs: string[]) => {
    if (queryStrs.length === 0) return [] as PlaceResult[];
    const ratedIds = new Set(myLocalRatings.map((r) => r.restaurantId));
    const wishlistedIds = new Set(myLists.flatMap((l: any) => l.wishlistIds || []));
    const recentIds = new Set(recentViews.map((v) => v.id));
    let lat: number;
    let lng: number;
    if (mode === 'home' && homeLocation) {
      lat = homeLocation.lat;
      lng = homeLocation.lng;
    } else {
      const center = mapRef.current?.getCenter();
      lat = center?.lat ?? 40.735;
      lng = center?.lng ?? -73.99;
    }
    const radiusMeters = mode === 'home' ? recRadiusMiles * 1609.34 : 50000;
    const locationLabel = mode === 'home' ? homeLocation?.label : undefined;
    const results = await Promise.all(
      queryStrs.map((q) =>
        searchPlacesByText(q, lat, lng, locationLabel, /* useRestriction */ mode === 'home', radiusMeters)
          .catch(() => [] as PlaceResult[])
      ),
    );
    const interleaved: PlaceResult[] = [];
    const maxLen = Math.max(0, ...results.map((r) => r.length));
    for (let i = 0; i < maxLen; i++) {
      for (const list of results) if (list[i]) interleaved.push(list[i]);
    }
    // Dedup + skip things the user has already rated/wishlisted/seen + quality
    // floor. The floor runs BEFORE scoring so scoreCandidates doesn't waste
    // work on places the user wouldn't have ever been shown anyway.
    const fresh = interleaved.filter((p) => {
      if (recsSeenIdsRef.current.has(p.id)) return false;
      if (ratedIds.has(p.id) || wishlistedIds.has(p.id) || recentIds.has(p.id)) return false;
      if ((p.rating || 0) < 4.0 || (p.userRatingCount || 0) < 30) return false;
      recsSeenIdsRef.current.add(p.id);
      return true;
    });
    // Browse mode keeps the old "quality-filtered Google results only" path.
    // Home mode runs the new scorer so taste profile + social signals + the
    // radius-based distance penalty all influence final ordering.
    if (mode !== 'home' || !homeLocation) return fresh;
    const target = { label: homeLocation.label, lat: homeLocation.lat, lng: homeLocation.lng };
    // Hard radius cutoff BEFORE scoring so the scorer never surfaces places
    // the user explicitly scoped away. Google's locationRestriction is
    // usually tight but occasionally leaks — this enforces the chip value.
    const inRadius = fresh.filter((p) =>
      haversineKm({ lat: p.lat, lng: p.lng }, { lat: homeLocation.lat, lng: homeLocation.lng }) <= recRadiusMiles * 1.60934,
    );
    return scoreCandidates(inRadius, userPreferences, recSignals, target, radiusMeters);
  }, [myLocalRatings, myLists, recentViews, mode, homeLocation, recRadiusMiles, userPreferences, recSignals]);

  // Hard radius filter used on cached / previously-stored places, which may
  // have been built under a wider radius. Pass-through in browse mode.
  const filterByRadius = useCallback((places: PlaceResult[]): PlaceResult[] => {
    if (mode !== 'home' || !homeLocation) return places;
    const radiusKm = recRadiusMiles * 1.60934;
    return places.filter((p) =>
      haversineKm({ lat: p.lat, lng: p.lng }, { lat: homeLocation.lat, lng: homeLocation.lng }) <= radiusKm,
    );
  }, [mode, homeLocation, recRadiusMiles]);

  // Refresh scoring signals on home-mode + (userId, home city, top tags)
  // change. Fetches in parallel so one slow endpoint doesn't block the rest.
  // Browse mode skips this entirely — scoreCandidates isn't called there.
  useEffect(() => {
    if (mode !== 'home') return;
    let cancelled = false;
    const city = homeLocation?.label.split(',')[0].trim() || '';
    (async () => {
      const [experts, followed, friendRatings, tagSim, exprecs, exprecRows] = await Promise.all([
        getExpertProfiles().catch(() => []),
        userId ? getFollowedExpertIds(userId).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
        userId ? getAllFriendRatings(userId).catch(() => [] as CommunityRating[]) : Promise.resolve([] as CommunityRating[]),
        userPreferences.topTags.length > 0
          ? getTagSimilarRestaurants(userPreferences.topTags, city || null, userId ?? '', 40).catch(() => [] as CommunityRating[])
          : Promise.resolve([] as CommunityRating[]),
        getExpertRatings(100).catch(() => [] as CommunityRating[]),
        // One-shot fetch of all expert-recommended restaurant ids. Table is
        // expert-only so it's small; keeping this per (userId, city) memo
        // avoids a per-batch round-trip in fetchRecBatch.
        (async () => {
          if (!userId || !supabaseConfigured) return [] as { restaurant_id: string }[];
          try {
            const { data } = await supabase.from('expert_recommendations').select('restaurant_id');
            return (data || []) as { restaurant_id: string }[];
          } catch { return []; }
        })(),
      ]);
      if (cancelled) return;
      const expertUserIds = new Set(experts.map((e: UserProfile) => e.user_id));
      const friendUserIds = new Set(friendRatings.map((r) => r.user_id));
      const communityByRestaurant = new Map<string, CommunityRating[]>();
      for (const row of [...tagSim, ...exprecs, ...friendRatings]) {
        const arr = communityByRestaurant.get(row.restaurant_id);
        if (arr) arr.push(row);
        else communityByRestaurant.set(row.restaurant_id, [row]);
      }
      const expertRecRestaurantIds = new Set(exprecRows.map((r) => r.restaurant_id));
      setRecSignals({
        expertUserIds,
        followedExpertIds: followed,
        friendUserIds,
        communityByRestaurant,
        expertRecRestaurantIds,
      });
    })();
    return () => { cancelled = true; };
  }, [mode, userId, homeLocation?.label, userPreferences.topTags]);

  // Resolve the home-page location on mount. Preferred source is the device's
  // GPS; when permission is denied (or geolocation is unavailable) we fall
  // back to the last explicit selection from localStorage, and then to NYC.
  useEffect(() => {
    if (mode !== 'home' || homeLocation) return;
    let cancelled = false;
    // If the user has already picked (or previously GPS-resolved) a
    // location, restore it on mount and skip the GPS request entirely —
    // otherwise navigating back to the home page would silently overwrite
    // their explicit pick with their current location.
    const last = loadLastSelectedLocation();
    if (last) {
      setHomeLocation(last);
      return;
    }
    const setFromFallback = () => {
      if (cancelled) return;
      setHomeLocation({ label: 'New York, NY', lat: 40.7128, lng: -74.006 });
    };
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (cancelled) return;
          const { latitude: lat, longitude: lng } = pos.coords;
          const label = await reverseGeocode(lat, lng);
          if (cancelled) return;
          const loc = { label, lat, lng };
          setHomeLocation(loc);
          // Persist the GPS-resolved address to the same localStorage slot
          // the picker uses, so other surfaces (restaurant detail distance,
          // map default centre, etc.) can read the precise origin instead
          // of falling back to a stale city-level label.
          saveLastSelectedLocation(loc);
        },
        () => setFromFallback(),
        { maximumAge: 5 * 60 * 1000, timeout: 15000, enableHighAccuracy: true },
      );
    } else {
      setFromFallback();
    }
    return () => {
      cancelled = true;
    };
  }, [mode, homeLocation]);

  // Explicit location pick from the picker — persist so the next denied-perms
  // session can restore it, then trigger a quick fade while recs refetch.
  // Picking the same location you're already on is a no-op so we don't spend
  // API budget on a round-trip that wouldn't change anything.
  const handleHomeLocationChange = useCallback((loc: HomeLocation) => {
    if (homeLocation && locationKey(homeLocation.lat, homeLocation.lng) === locationKey(loc.lat, loc.lng)) {
      // Just update the label in case user picked a more specific spelling,
      // but skip the refetch / fade entirely.
      if (homeLocation.label !== loc.label) {
        setHomeLocation(loc);
        saveLastSelectedLocation(loc);
      }
      return;
    }
    setHomeLocationRefreshing(true);
    setHomeLocation(loc);
    saveLastSelectedLocation(loc);
    // Reset the rec cursor so useEffect below refetches from scratch.
    recsFetchedRef.current = false;
    recsSeenIdsRef.current = new Set();
    recsQueryCursorRef.current = 0;
    recsExhaustedRef.current = false;
    window.setTimeout(() => setHomeLocationRefreshing(false), 450);
  }, [homeLocation]);

  // "Use current location" from the picker — returns a Promise so the picker
  // can show a spinner while it resolves and surface a clear error if the
  // browser denies / can't find a fix (otherwise the button just silently
  // closed and the user had no feedback).
  const handleHomeUseCurrent = useCallback(async (): Promise<void> => {
    const loc = await getCurrentHomeLocation();
    handleHomeLocationChange(loc);
  }, [handleHomeLocationChange]);

  // Initial / location-driven recommendations — personalised if the user has
  // preferences, generic nearby otherwise. In home mode the load flow is:
  //
  //   1. Check the session in-memory cache (instant, zero calls).
  //   2. Check the Supabase `home_rec_cache` row for this location key
  //      (network, but no Places API spend).
  //   3. If the cache is recent AND the user's preferences haven't drifted,
  //      use it as-is.
  //   4. If the cache exists but prefs drifted, keep the cache and add a
  //      single top-up call for the new top cuisine.
  //   5. Otherwise do a full fresh fetch (3 queries) and persist it.
  //
  // Map mode always goes to the live API — it's not the expensive path.

  // Changing the radius chip has to refetch — reset the once-guard so the
  // effect below runs again. Dedup/cursor state is reset inside the effect
  // itself, so we only touch the guard here.
  useEffect(() => {
    if (mode !== 'home') return;
    recsFetchedRef.current = false;
  }, [recRadiusMiles, mode]);

  useEffect(() => {
    if (recsFetchedRef.current) return;
    if (mode === 'home' && !homeLocation) return;
    recsFetchedRef.current = true;
    recsSeenIdsRef.current = new Set();
    recsQueryCursorRef.current = 0;
    recsExhaustedRef.current = false;
    setRecsLoading(true);
    setApiRecommendations([]);

    // In home mode, force the queries to target the selected home city so the
    // API doesn't return NYC results just because the user's historical
    // topCities is "New York, NY".
    const homeCityOverride = mode === 'home' && homeLocation
      ? homeLocation.label.split(',').slice(0, 2).join(', ').trim()
      : null;

    const uid = userId;
    const locKey = mode === 'home' && homeLocation
      ? locationKey(homeLocation.lat, homeLocation.lng)
      : null;
    const prefsHash = preferencesHash(userPreferences.topCuisines, userPreferences.topPrices) + '|r=' + Math.round(recRadiusMiles * 1609.34);

    const applyCachedResults = (entry: HomeRecCacheEntry, prependFresh?: PlaceResult[]) => {
      // Shuffle the cached pool on every load so the user sees different
      // ordering even when nothing new was fetched. Any freshly-fetched
      // top-ups stay at the top (they're the newest / most relevant).
      const shuffledCache = shuffleInPlace([...entry.places]);
      const combined = prependFresh && prependFresh.length > 0
        ? [...prependFresh, ...shuffledCache].filter((p, i, arr) => arr.findIndex((q) => q.id === p.id) === i)
        : shuffledCache;
      // Cached pools may have been built under a wider radius — enforce the
      // current chip value before anything hits the screen.
      const merged = filterByRadius(combined);
      // Seed the dedup set so loadMore doesn't re-surface these.
      for (const p of merged) recsSeenIdsRef.current.add(p.id);
      // Apply community cover photos. This is non-blocking from the user's
      // perspective — we set the recs immediately so the cards render
      // placeholders, then swap in cover photos as soon as Supabase returns.
      setApiRecommendations(merged);
      setRecsLoading(false);
      applyCoverPhotos(merged, uid).then((withCovers) => {
        setApiRecommendations((prev) => {
          // Only overwrite if the set of ids matches — otherwise the user
          // has moved on (changed location, scrolled more queries in).
          if (prev.length !== withCovers.length) return prev;
          return withCovers;
        });
      });
      // Set the cursor past the initial batch so loadMoreRecommendations can
      // continue fetching deeper queries (Tier 3 / 4 / 5) when the user
      // scrolls past the cached pool — that's what keeps the row infinite.
      recsExhaustedRef.current = false;
      recsQueryCursorRef.current = 5;
    };

    const runLiveFetch = async () => {
      let withCovers: PlaceResult[] = [];

      if (userPreferences.highRatedCount > 0 && userPreferences.topCuisines.length > 0) {
        const queries = buildRecQueries(homeCityOverride);
        // Pull a larger initial pool — five queries weighted across the
        // user's top cuisines / prices / cities. Mixing these up means the
        // cached pool covers enough variety that reshuffling on reload
        // actually produces visibly different recs without any more calls.
        const initialBatch = queries.slice(0, 5);
        recsQueryCursorRef.current = initialBatch.length;
        let fresh = await fetchRecBatch(initialBatch);
        // The personalised queries are cuisine-specific ("best $$ Ramen in
        // Austin, TX"); when the user's top cuisines happen to be niche in
        // the newly-selected city, every one of those queries can come back
        // empty and the section silently disappears. First try generic
        // city text queries with the same fetchRecBatch (so the quality
        // filter + scorer still apply).
        if (fresh.length === 0 && homeCityOverride) {
          const fallbackQueries = [
            `best restaurants in ${homeCityOverride}`,
            `popular restaurants in ${homeCityOverride}`,
          ];
          fresh = await fetchRecBatch(fallbackQueries);
          // Advance the cursor past the fallbacks so load-more doesn't
          // immediately re-issue them.
          recsQueryCursorRef.current += fallbackQueries.length;
        }
        // Stamp cover photos onto the results BEFORE caching so returning
        // users get them straight out of cache on the next visit.
        withCovers = await applyCoverPhotos(fresh, uid);
      }

      // Last-resort fallback. Runs if:
      //   (a) the user has no preferences yet, OR
      //   (b) every personalised + generic text query above came back
      //       empty because the quality floor / radius restriction / niche
      //       cuisines dropped everything.
      //
      // This path uses the Places "searchNearby" endpoint (a different
      // Google API from text search), which reliably returns popular
      // restaurants around any lat/lng without needing a well-formed
      // cuisine/city query. It's the safety net that stops the section
      // from ever rendering empty for a valid, non-remote location.
      if (withCovers.length === 0) {
        let fbLat: number;
        let fbLng: number;
        if (mode === 'home' && homeLocation) {
          fbLat = homeLocation.lat;
          fbLng = homeLocation.lng;
        } else {
          const center = mapRef.current?.getCenter();
          fbLat = center?.lat ?? 40.735;
          fbLng = center?.lng ?? -73.99;
        }
        const fbRadius = mode === 'home' ? recRadiusMiles * 1609.34 : 2000;
        const [nearby, best] = await Promise.all([
          searchNearbyRestaurants(fbLat, fbLng, fbRadius).catch(() => [] as PlaceResult[]),
          searchPlacesByText('best restaurants', fbLat, fbLng, homeLocation?.label, mode === 'home', fbRadius).catch(() => [] as PlaceResult[]),
        ]);
        const all = [...nearby, ...best];
        const seenIds = new Set<string>();
        const dedup = all.filter((p) => { if (seenIds.has(p.id)) return false; seenIds.add(p.id); return true; });
        const withinRadius = filterByRadius(dedup);
        withCovers = await applyCoverPhotos(withinRadius.slice(0, 12), uid);
      }

      const shuffled = shuffleInPlace([...withCovers]);
      setApiRecommendations(shuffled);
      setRecsLoading(false);
      if (uid && locKey && homeLocation && withCovers.length > 0) {
        const entry: HomeRecCacheEntry = {
          places: withCovers,
          preferencesHash: prefsHash,
          updatedAt: Date.now(),
        };
        sessionRecsCache[locKey] = entry;
        saveHomeRecsCache(uid, locKey, homeLocation.label, homeLocation.lat, homeLocation.lng, prefsHash, withCovers);
      }
    };

    // Home mode only: try caches before hitting Google.
    if (mode === 'home' && locKey && homeLocation) {
      // 1. Session in-memory cache — instant.
      const sessionHit = sessionRecsCache[locKey];
      if (sessionHit && Date.now() - sessionHit.updatedAt < HOME_RECS_CACHE_TTL) {
        if (sessionHit.preferencesHash === prefsHash || userPreferences.topCuisines.length === 0) {
          applyCachedResults(sessionHit);
          return;
        }
      }
      // 2. Supabase cache — one lightweight query, no Places spend.
      if (uid) {
        (async () => {
          try {
          const cached = await getHomeRecsCache(uid, locKey);
          const fresh = cached && Date.now() - cached.updatedAt < HOME_RECS_CACHE_TTL ? cached : null;
          if (fresh && fresh.places.length > 0) {
            const age = Date.now() - fresh.updatedAt;
            const prefsMatch = fresh.preferencesHash === prefsHash || userPreferences.topCuisines.length === 0;

            if (prefsMatch && age < HOME_RECS_TOPUP_AGE) {
              // Straight cache hit — no Places API spend at all, and the
              // cache is recent enough that we don't even need a variation
              // top-up. Shuffle provides the reload variation.
              sessionRecsCache[locKey] = fresh;
              applyCachedResults(fresh);
              return;
            }

            // Build exactly ONE top-up query so the feed gets fresh blood
            // without blowing the API budget. The query picked rotates via a
            // random index into the user's full rec-query list so the new
            // places surfaced aren't the same ones we fetched initially, and
            // so users with a strong price preference (e.g. $$$$) keep
            // getting high-end picks rather than drifting toward generic.
            const allQueries = buildRecQueries(homeCityOverride);
            // When prefs drifted, force the top-up to target the new top
            // cuisine so the change is immediately visible; otherwise cycle
            // through the tail of the query list we haven't exhausted yet.
            let topUpQuery: string | null = null;
            if (!prefsMatch) {
              const topCuisine = userPreferences.topCuisines[0];
              topUpQuery = topCuisine
                ? `best ${topCuisine} restaurants in ${homeCityOverride || ''}`.trim().replace(/\s+in\s*$/, '')
                : null;
            } else if (allQueries.length > 5) {
              topUpQuery = allQueries[5 + Math.floor(Math.random() * Math.max(1, allQueries.length - 5))];
            } else if (allQueries.length > 0) {
              topUpQuery = allQueries[Math.floor(Math.random() * allQueries.length)];
            }

            const topUpResults = topUpQuery
              ? (await fetchRecBatch([topUpQuery])).filter((p) => !fresh.places.some((q) => q.id === p.id))
              : [];
            const merged: PlaceResult[] = [...topUpResults, ...fresh.places]
              .filter((p, i, arr) => arr.findIndex((q) => q.id === p.id) === i);
            // Only reset the TTL clock when the underlying preferences changed
            // — that's a real refresh. An age-based top-up just adds variety;
            // the 2-day TTL keeps ticking so the pool still expires on time.
            const nextUpdatedAt = prefsMatch ? fresh.updatedAt : Date.now();
            const entry: HomeRecCacheEntry = {
              places: merged,
              preferencesHash: prefsHash,
              updatedAt: nextUpdatedAt,
            };
            sessionRecsCache[locKey] = entry;
            saveHomeRecsCache(
              uid, locKey, homeLocation.label, homeLocation.lat, homeLocation.lng,
              prefsHash, merged, nextUpdatedAt,
            );
            applyCachedResults(entry, topUpResults);
            return;
          }
          // Cache miss or stale — live fetch.
          await runLiveFetch();
          } catch (err) {
            // Never leave the spinner stuck: if any step in the cache-check
            // or fallback live fetch throws (network error, Places auth
            // hiccup, etc.), clear the loading flag and let the UI render
            // the empty state rather than spinning forever.
            console.warn('[Recs] live fetch failed:', err);
            setRecsLoading(false);
          }
        })();
        return;
      }
    }

    // Anonymous home, or map mode — just run the live path. The .catch here
    // mirrors the logged-in path: an unhandled rejection from runLiveFetch
    // otherwise leaves the section stuck on the spinner.
    runLiveFetch().catch((err) => {
      console.warn('[Recs] live fetch failed:', err);
      setRecsLoading(false);
    });
  }, [userPreferences.highRatedCount, userPreferences.topCuisines.length, buildRecQueries, fetchRecBatch, mode, homeLocation, userId, userPreferences.topCuisines, userPreferences.topPrices, recRadiusMiles, recRefreshNonce]);

  // Load more recommendations — called when the horizontal scroll nears the
  // end. Fetches one query at a time so the infinite scroll paces itself
  // into smaller chunks, and writes every batch back into both caches so
  // the user's next reload of this city already has the extended pool.
  const loadMoreRecommendations = useCallback(async () => {
    if (recsLoadingMore || recsExhaustedRef.current) return;
    const homeCityOverride = mode === 'home' && homeLocation
      ? homeLocation.label.split(',').slice(0, 2).join(', ').trim()
      : null;
    const queries = buildRecQueries(homeCityOverride);
    if (recsQueryCursorRef.current >= queries.length) {
      recsExhaustedRef.current = true;
      return;
    }
    setRecsLoadingMore(true);
    const batch = queries.slice(recsQueryCursorRef.current, recsQueryCursorRef.current + 1);
    recsQueryCursorRef.current += batch.length;
    const fresh = await fetchRecBatch(batch);
    if (fresh.length === 0) {
      setRecsLoadingMore(false);
      return;
    }
    const freshWithCovers = await applyCoverPhotos(fresh, userId);
    setApiRecommendations((prev) => [...prev, ...freshWithCovers]);
    // Persist newly-surfaced places into the cache so future reloads of this
    // city get them without another Places call.
    if (mode === 'home' && userId && homeLocation) {
      const locKey = locationKey(homeLocation.lat, homeLocation.lng);
      const prefsHash = preferencesHash(userPreferences.topCuisines, userPreferences.topPrices) + '|r=' + Math.round(recRadiusMiles * 1609.34);
      const existing = sessionRecsCache[locKey]?.places || [];
      const mergedPool = [...existing, ...freshWithCovers]
        .filter((p, i, arr) => arr.findIndex((q) => q.id === p.id) === i);
      sessionRecsCache[locKey] = {
        places: mergedPool,
        preferencesHash: prefsHash,
        updatedAt: sessionRecsCache[locKey]?.updatedAt ?? Date.now(),
      };
      saveHomeRecsCache(
        userId, locKey, homeLocation.label, homeLocation.lat, homeLocation.lng,
        prefsHash, mergedPool, sessionRecsCache[locKey]?.updatedAt,
      );
    }
    setRecsLoadingMore(false);
  }, [recsLoadingMore, buildRecQueries, fetchRecBatch, mode, homeLocation, userId, userPreferences.topCuisines, userPreferences.topPrices, recRadiusMiles]);

  // Try to keep the chip-filtered Recommended rail full enough to show
  // at least RECS_FILTER_MIN matching restaurants. When the user picks
  // a cuisine chip and we have fewer than 10 matches, we pull the next
  // batch from the recommendation engine — and repeat until we either
  // hit the target or the engine reports it's out of queries.
  useEffect(() => {
    if (mode !== 'home' || !heroChipCuisine) return;
    if (recsLoadingMore || recsExhaustedRef.current) return;
    const matches = recommendations.filter(
      (p) => getCuisineLabel((p as any).types || []) === heroChipCuisine,
    ).length;
    const RECS_FILTER_MIN = 10;
    if (matches >= RECS_FILTER_MIN) return;
    loadMoreRecommendations();
  }, [heroChipCuisine, recommendations, recsLoadingMore, mode, loadMoreRecommendations]);

  // Refs for callbacks needed before their definition
  const fetchNearbyRef = useRef<(() => void) | null>(null);
  const syncMarkersRef = useRef<((places: PlaceResult[]) => void) | null>(null);

  // Sort and filter places client-side
  const getFilteredPlaces = useCallback((allPlaces: PlaceResult[], sort: SortOption, price: number): PlaceResult[] => {
    let filtered = allPlaces;

    // Filter by price
    if (price > 0) {
      filtered = filtered.filter((p) => p.priceLevel === price);
    }

    // Filter by Michelin distinction (client-side; read from the ref so this
    // stays a stable callback). No-op until the dataset is loaded.
    const mich = filtersRef.current.selectedMichelin;
    if (mich.length > 0) {
      filtered = filtered.filter((p) =>
        passesMichelinFilter(mich, p.name, p.lat, p.lng, p.fullAddress || p.address));
    }

    // Filter by opening hours (breakfast/lunch/dinner + open now). Hours come
    // from restaurantMeta, read via a ref so this stays a stable callback.
    const hf = filtersRef.current.hoursFilter;
    if (isHoursFilterActive(hf)) {
      filtered = filtered.filter((p) => passesHoursFilter(restaurantMetaRef.current[p.id]?.hours, hf));
    }

    // Sort
    const sorted = [...filtered];
    switch (sort) {
      case 'rating':
        sorted.sort((a, b) => b.rating - a.rating);
        break;
      case 'price_low':
        sorted.sort((a, b) => a.priceLevel - b.priceLevel);
        break;
      case 'price_high':
        sorted.sort((a, b) => b.priceLevel - a.priceLevel);
        break;
      case 'popularity':
      default:
        sorted.sort((a, b) => b.userRatingCount - a.userRatingCount);
        break;
    }

    return sorted;
  }, []);

  // When a Michelin distinction filter is active, Google's popularity search
  // rarely overlaps the Michelin set — so source matching restaurants from the
  // bundled dataset directly and merge them into the result list (deduped by
  // name+proximity). Awaits the dataset load so it works on the first search.
  const mergeMichelinResults = useCallback(async (
    googlePlaces: PlaceResult[],
    centerLat: number,
    centerLng: number,
    radiusMeters: number,
  ): Promise<PlaceResult[]> => {
    const sel = filtersRef.current.selectedMichelin;
    if (sel.length === 0) return googlePlaces;
    await ensureMichelinIndex();
    // Keep only Google places that themselves match (so the list is coherent),
    // then add dataset entries we don't already have.
    const kept = googlePlaces.filter((p) =>
      passesMichelinFilter(sel, p.name, p.lat, p.lng, p.fullAddress || p.address));
    const radiusMi = Math.min(radiusMeters / 1609.34, 31); // cap ~50 km
    const price = filtersRef.current.selectedPrice;
    for (const m of michelinNearbySync(centerLat, centerLng, radiusMi, sel)) {
      if (price > 0 && m.priceTier !== price) continue;
      const dup = kept.some((p) =>
        p.name.toLowerCase() === m.name.toLowerCase()
        && havMi(p.lat, p.lng, m.lat, m.lng) < 0.12);
      if (dup) continue;
      kept.push(michelinToPlaceResult(m));
    }
    return kept;
  }, []);

  // Build a lookup of user's own ratings by restaurant ID
  const userRatingMap = useMemo(() => {
    const lookup: Record<string, number> = {};
    myLocalRatings.forEach((r) => { lookup[r.restaurantId] = Number(r.score) || 0; });
    return lookup;
  }, [myLocalRatings]);
  // Ref so the marker builder (stable callback) can read the latest ratings
  // without being re-created — which would rebuild every marker on each rating.
  const userRatingMapRef = useRef(userRatingMap);
  userRatingMapRef.current = userRatingMap;

  // Create a marker element for a place — a score badge matching the location
  // map: a filled, score-coloured circle with the rating in white. Shows the
  // user's own rating if they've rated it, otherwise the Google rating mapped
  // to the 0–10 scale; unrated places fall back to a neutral pin. The coloured
  // fill reads softly on both light and dark map themes (vs. a stark white pin).
  const createMarkerElement = useCallback((place: PlaceResult) => {
    const userScore = userRatingMapRef.current[place.id] || 0;
    const score = userScore > 0 ? userScore : (place.rating > 0 ? place.rating * 2 : 0);
    const color = score >= 8 ? '#10b981' : score >= 5 ? '#f59e0b' : score > 0 ? '#ef4444' : '#94a3b8';
    const label = score > 0
      ? `<span style="color:#fff;font:700 12px/1 ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums;">${score.toFixed(1)}</span>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;

    const el = document.createElement('div');
    el.className = 'mapbox-custom-marker';
    el.innerHTML = `
      <div class="marker-pin" data-id="${place.id}" data-base-color="${color}" style="
        width: 36px;
        height: 36px;
        border-radius: 9999px;
        background: ${color};
        border: 2px solid #fff;
        box-shadow: 0 2px 6px rgba(0,0,0,0.28);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transform: scale(0.4);
        transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease;
      ">${label}</div>
    `;

    el.addEventListener('mouseenter', () => {
      const pin = el.querySelector('.marker-pin') as HTMLElement;
      if (pin) pin.style.transform = 'scale(1.15)';
    });
    el.addEventListener('mouseleave', () => {
      const pin = el.querySelector('.marker-pin') as HTMLElement;
      if (pin) pin.style.transform = 'scale(1)';
    });

    return el;
  }, []);

  // Show popup for a place
  // Use refs for callbacks so DOM event handlers always get the latest
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const openAddRestaurantModalRef = useRef(openAddRestaurantModal);
  openAddRestaurantModalRef.current = openAddRestaurantModal;
  const toggleWishlistRef = useRef(toggleWishlist);
  toggleWishlistRef.current = toggleWishlist;

  const showPopup = useCallback((place: PlaceResult, _map: mapboxgl.Map) => {
    if (popupRef.current) popupRef.current.remove();
    popupRef.current = null;
    setSelectedPlace(place);
    setSheetState('peek');
  }, []);

  // Sync markers on map when places change — keeps existing markers, animates new ones in
  const syncMarkers = useCallback((newPlaces: PlaceResult[]) => {
    const map = mapRef.current;
    if (!map) return;

    const newIds = new Set(newPlaces.map((p) => p.id));
    const oldIds = new Set(Object.keys(markersRef.current));

    // Fade out and remove markers that are no longer in the set
    Object.entries(markersRef.current).forEach(([id, m]) => {
      if (!newIds.has(id)) {
        const pin = m.getElement().querySelector('.marker-pin') as HTMLElement;
        if (pin) {
          pin.style.opacity = '0';
          pin.style.transform = 'scale(0.4)';
        }
        setTimeout(() => m.remove(), 300);
        delete markersRef.current[id];
      }
    });

    // Add new markers with staggered animation
    let animIndex = 0;
    newPlaces.forEach((place) => {
      if (oldIds.has(place.id)) return; // already on map

      const el = createMarkerElement(place);

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setSelectedMarker(place.id);
        isMarkerSelectedRef.current = true;
        map.easeTo({ center: [place.lng, place.lat], duration: 500 });
        showPopup(place, map);
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([place.lng, place.lat])
        .addTo(map);

      markersRef.current[place.id] = marker;

      // Staggered fade-in on the inner pin (not outer el, which Mapbox controls)
      const delay = Math.min(animIndex * 25, 400);
      setTimeout(() => {
        const pin = el.querySelector('.marker-pin') as HTMLElement;
        if (pin) {
          pin.style.opacity = '1';
          pin.style.transform = 'scale(1)';
        }
      }, delay);
      animIndex++;
    });
  }, [createMarkerElement, showPopup]);

  // Fetch nearby restaurants for the current map center
  const fetchNearby = useCallback(async (cuisines?: string[]) => {
    const map = mapRef.current;
    if (!map) return;
    // Any explicit "search the map" action exits the focus-only view so
    // normal discover behaviour resumes.
    if (isFocusOnlyRef.current) setIsFocusOnly(false);
    // An explicit area re-search ends any AI-chat map takeover.
    assistantPlotActiveRef.current = false;
    // NB: callers that represent an explicit user re-search (the
    // "Search this area" pill, the panel empty-state button, etc.) clear
    // the typed-location distance anchor themselves. fetchNearby itself
    // does NOT clear it, because it's also invoked automatically right
    // after the user picks a location from the location-search dropdown.
    setIsSearching(true);
    setShowSearchHere(false);
    try {
      const center = map.getCenter();
      // Calculate radius from the actual visible map bounds
      const bounds = map.getBounds();
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      // Distance from center to corner in meters (haversine approximation)
      const dlat = (ne.lat - sw.lat) * Math.PI / 180;
      const dlng = (ne.lng - sw.lng) * Math.PI / 180;
      const a = Math.sin(dlat / 4) ** 2 + Math.cos(center.lat * Math.PI / 180) * Math.cos(ne.lat * Math.PI / 180) * Math.sin(dlng / 4) ** 2;
      const halfDiag = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const radius = Math.min(50000, Math.max(500, Math.round(halfDiag)));
      const cuisineTypes = cuisines ?? filtersRef.current.selectedCuisines;
      const price = filtersRef.current.selectedPrice;
      const results = await searchNearbyRestaurants(center.lat, center.lng, radius, cuisineTypes, price);
      let sorted = getFilteredPlaces(results, filtersRef.current.sortBy, 0); // price already filtered server-side
      sorted = await mergeMichelinResults(sorted, center.lat, center.lng, radius);
      setPlaces(sorted);
      syncMarkers(sorted);
      // Add expert overlay markers in the visible area
      setTimeout(() => addExpertOverlayRef.current?.(), 100);
      tabDataCache.discoverPlaces = sorted;
      tabDataCache.discoverLoaded = true;
    } catch (err) {
      console.error('Places search failed:', err);
    } finally {
      setIsSearching(false);
    }
  }, [syncMarkers, getFilteredPlaces, mergeMichelinResults]);

  // Keep refs in sync for use in quick filter handler
  fetchNearbyRef.current = fetchNearby;
  syncMarkersRef.current = syncMarkers;

  // Overlay expert-rated markers on the discover map for the visible area
  const addExpertOverlayMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map || mapModeRef.current !== 'discover') return;
    if (isFocusOnlyRef.current) return; // no overlay when showing only a single focus marker
    // Clear previous expert overlay markers
    expertOverlayMarkersRef.current.forEach((m) => m.remove());
    expertOverlayMarkersRef.current = [];

    // When the AI chat has plotted its own recommendations, show ONLY those
    // pins — no expert overlay stars layered on top.
    if (assistantPlotActiveRef.current) return;

    if (expertRatings.length === 0) return;

    const bounds = map.getBounds();
    const discoverIds = new Set(Object.keys(markersRef.current));

    const visibleExperts = expertRatings.filter((r) => {
      if (!r.lat || !r.lng) return false;
      if (Math.abs(r.lat) < 1 && Math.abs(r.lng) < 1) return false; // skip corrupted coords
      if (discoverIds.has(r.restaurant_id)) return false; // already shown as discover marker
      return bounds.contains([r.lng, r.lat]);
    });

    for (const r of visibleExperts) {
      const score = Number(r.score) || 0;
      const size = score >= 8 ? 40 : score >= 5 ? 36 : 32;
      const iconSz = Math.round(size * 0.42);
      const el = document.createElement('div');
      el.style.cssText = `display:flex;align-items:center;justify-content:center;cursor:pointer;`;
      const inner = document.createElement('div');
      inner.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:#d4a017;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.28);display:flex;align-items:center;justify-content:center;transition:transform 0.2s ease;`;
      inner.innerHTML = `<svg width="${iconSz}" height="${iconSz}" viewBox="0 0 24 24" fill="#fff" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
      el.appendChild(inner);
      el.addEventListener('mouseenter', () => { inner.style.transform = 'scale(1.15)'; });
      el.addEventListener('mouseleave', () => { inner.style.transform = 'scale(1)'; });

      const place = ratingToPlace(r);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
        if (place) {
          setSelectedPlace(place);
          setSelectedMarker(place.id);
          setSheetState('peek');
        }
        isMarkerSelectedRef.current = true;
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([r.lng!, r.lat!]).addTo(map);
      expertOverlayMarkersRef.current.push(marker);
    }
  }, [expertRatings]);
  const addExpertOverlayRef = useRef<() => void>(addExpertOverlayMarkers);
  addExpertOverlayRef.current = addExpertOverlayMarkers;

  // Refresh the Discover expert overlay whenever expert ratings update (e.g.
  // after background geocoding fills in coordinates) so newly-geocoded
  // expert reviews show up as markers in the current view immediately.
  useEffect(() => {
    if (mapMode !== 'discover') return;
    addExpertOverlayRef.current?.();
  }, [mapMode, expertRatings]);

  // Keep the expert overlay in sync as the user pans/zooms or as discover
  // search results come in (so experts outside the initial viewport appear as
  // soon as that area is visible and experts already covered by a discover
  // marker are hidden).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapMode !== 'discover') return;
    const handler = () => addExpertOverlayRef.current?.();
    map.on('moveend', handler);
    return () => { map.off('moveend', handler); };
  }, [mapMode]);

  // Text search
  const handleSearch = useCallback(async (query: string) => {
    const map = mapRef.current;
    if (!map || !query.trim()) return;
    if (isFocusOnlyRef.current) setIsFocusOnly(false);
    // An explicit text search ends any AI-chat map takeover.
    assistantPlotActiveRef.current = false;
    setIsSearching(true);
    setSelectedMarker(null);
    setShowSearchHere(false);
    try {
      // Use location bias if a location was searched, otherwise use map center
      const searchCenter = searchLocationBias || map.getCenter();
      const lat = 'lat' in searchCenter ? searchCenter.lat : searchCenter.lat;
      const lng = 'lng' in searchCenter ? searchCenter.lng : searchCenter.lng;
      // Calculate search radius from map bounds for tighter results
      const mapBounds = map.getBounds();
      const nw = mapBounds.getNorthWest();
      const se = mapBounds.getSouthEast();
      const dlat = (nw.lat - se.lat) * Math.PI / 180;
      const dlng = (nw.lng - se.lng) * Math.PI / 180;
      const a = Math.sin(dlat/2)**2 + Math.cos(nw.lat*Math.PI/180)*Math.cos(se.lat*Math.PI/180)*Math.sin(dlng/2)**2;
      const searchRadius = Math.max(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) / 2, 2000);
      const useRestriction = !!searchLocationBias;
      const results = await searchPlacesByText(query, lat, lng, searchRadius, useRestriction);
      let filtered = getFilteredPlaces(results, filtersRef.current.sortBy, filtersRef.current.selectedPrice);
      filtered = await mergeMichelinResults(filtered, lat, lng, searchRadius);
      setPlaces(filtered);
      syncMarkers(filtered);

      if (filtered.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        filtered.forEach((p) => bounds.extend([p.lng, p.lat]));
        map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 1000 });
      }
      // Add expert overlay markers in the visible area
      setTimeout(() => addExpertOverlayRef.current?.(), 1200);
    } catch (err) {
      console.error('Text search failed:', err);
    } finally {
      setIsSearching(false);
    }
  }, [syncMarkers, getFilteredPlaces, searchLocationBias, mergeMichelinResults]);

  // ── AI chat → map integration (only when mounted as the /map page) ──────
  // Discover is the app's real map surface (route /map). It publishes its
  // pool + city + a city-search callback + a "plot these" callback to the
  // global assistant so the chat can drive the map: ask for "the best
  // mediterranean spots in Boston" and the chat searches Boston, then hands
  // the picks back here to swap the list + markers and fly there.

  // Current discover pool as ScoredPlace[] (the chat's on-screen context).
  const assistantVisible = useMemo<ScoredPlace[]>(
    () => places.map((p) => ({ ...p, recScore: p.rating > 0 ? p.rating * 2 : 0, sources: ['google'] as ScoredPlace['sources'] })),
    [places],
  );
  const assistantCityLabel = referenceLocation?.name || homeLocation?.label || '';
  const assistantShortCity = (assistantCityLabel.split(',')[0] || '').trim();

  // Bound to the chat's search_restaurants tool. Geocodes the target city
  // (when different from the page's) and runs a Google text search there so
  // the results carry real coordinates — the chat stores them and can then
  // recommend (and plot) them. Mirrors LocationPage.handleChatSearch.
  const handleAssistantSearch = useCallback(async (query: string, city?: string): Promise<ScoredPlace[]> => {
    const q = query.trim();
    if (!q) return [];
    try {
      const price = filtersRef.current.selectedPrice;
      const priceLevels = price > 0 ? [price] : undefined;
      const targetCity = city?.trim();
      const isOtherCity = !!targetCity && targetCity.toLowerCase() !== assistantShortCity.toLowerCase();
      let anchor: { lat: number; lng: number; radiusMeters: number } | null = null;
      if (isOtherCity) {
        try {
          const geocoded = await geocodePlace(targetCity!);
          if (geocoded) anchor = { lat: geocoded.lat, lng: geocoded.lng, radiusMeters: 19312 };
        } catch { /* fall through to current map center */ }
      }
      if (!anchor) {
        const c = mapRef.current?.getCenter();
        const base = referenceLocationRef.current || (c ? { lat: c.lat, lng: c.lng } : null);
        if (!base) return [];
        anchor = { lat: base.lat, lng: base.lng, radiusMeters: 16000 };
      }
      const finalQuery = isOtherCity ? `${q} in ${targetCity}` : q;
      const res = await searchPlacesByTextPaged(finalQuery, {
        lat: anchor.lat,
        lng: anchor.lng,
        radiusMeters: anchor.radiusMeters,
        useRestriction: true,
        priceLevels,
      });
      return res.places.map<ScoredPlace>((p) => ({
        ...p,
        recScore: p.rating > 0 ? p.rating * 2 : 0,
        sources: ['google'],
      }));
    } catch (err) {
      console.error('[Discover] handleAssistantSearch error:', err);
      return [];
    }
  }, [assistantShortCity]);

  // Bound to the chat's onAssistantPlaces. The assistant just recommended a
  // set of restaurants — take over the discover overlay with exactly those
  // (list + markers) and fly to frame them.
  const handleAssistantPlaces = useCallback((incoming: ScoredPlace[]) => {
    const valid = (incoming || []).filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (valid.length === 0) return;
    const plain: PlaceResult[] = valid.map((p) => ({ ...p }));
    assistantPlotActiveRef.current = true;
    // The assistant plots into the discover overlay; make sure we're on it.
    if (mapModeRef.current !== 'discover') {
      setMapModeRaw('discover');
      sessionStorage.setItem('map-mode', 'discover');
    }
    setIsFocusOnly(false);
    setShowSearchHere(false);
    setSelectedPlace(null);
    setSelectedMarker(null);
    setReferenceLocation(null);
    setPlaces(plain);
    tabDataCache.discoverPlaces = plain;
    syncMarkers(plain);
    // Drop any expert overlay stars so only the recommended pins show.
    expertOverlayMarkersRef.current.forEach((m) => m.remove());
    expertOverlayMarkersRef.current = [];
    const map = mapRef.current;
    if (!map) return;
    map.setMaxBounds(null as unknown as mapboxgl.LngLatBoundsLike);
    if (valid.length === 1) {
      map.flyTo({ center: [valid[0].lng, valid[0].lat], zoom: 14, duration: 900 });
    } else {
      const bounds = new mapboxgl.LngLatBounds();
      for (const p of valid) bounds.extend([p.lng, p.lat]);
      map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 900 });
    }
  }, [syncMarkers]);

  // Publish the page context to the global assistant — only on the map page.
  const assistantPageContext = useMemo<AssistantPageContext | null>(() => {
    if (mode !== 'map') return null;
    return {
      visible: assistantVisible,
      restaurantMeta,
      cityDisplay: assistantCityLabel || 'your area',
      shortCityName: assistantShortCity || 'your area',
      filters: {
        cuisines: selectedCuisines.length > 0 ? selectedCuisines : undefined,
        price: selectedPrice > 0 ? selectedPrice : undefined,
        sort: sortBy !== 'popularity' ? sortBy : undefined,
        radius: discoverRadius,
      },
      origin: referenceLocation
        ? { lat: referenceLocation.lat, lng: referenceLocation.lng }
        : (mapCenter || null),
      onSearchRestaurants: handleAssistantSearch,
      onAssistantPlaces: handleAssistantPlaces,
    };
  }, [mode, assistantVisible, restaurantMeta, assistantCityLabel, assistantShortCity, selectedCuisines, selectedPrice, sortBy, discoverRadius, referenceLocation, mapCenter, handleAssistantSearch, handleAssistantPlaces]);
  useSetAssistantPageContext(assistantPageContext);

  // Initialize Mapbox — skip entirely when running as the Home page (no map)
  useEffect(() => {
    if (mode === 'home') return;
    if (!mapContainerRef.current || mapRef.current || !MAPBOX_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    // Focus-only deep-link: open the map already centred on the target
    // restaurant so no camera animation is needed.
    const focusOnlyInit = isFocusOnlyRef.current && initialFocus;
    // Default the camera to the location the user picked on the home page
    // (persisted to localStorage by HomeLocationBar) so the Map tab opens
    // wherever they were last browsing instead of always snapping to NYC.
    const savedHome = focusOnlyInit ? null : loadLastSelectedLocation();
    const initialCenter: [number, number] = focusOnlyInit
      ? [initialFocus.lng, initialFocus.lat]
      : savedHome
        ? [savedHome.lng, savedHome.lat]
        : [-73.99, 40.735];
    const initialZoom = focusOnlyInit ? 15 : 12.5;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      // Match the app theme on first load (dark app → dark map).
      style: darkModeRef.current ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11',
      center: initialCenter,
      zoom: initialZoom,
      attributionControl: false,
    });
    attachMapErrorFallback(map, mapContainerRef.current);

    mapRef.current = map;

    // Search nearby restaurants once map loads (skip if cached, or if
    // we're in focus-only mode — in which case we only show a single
    // marker for the restaurant the user came from).
    map.on('load', () => {
      setMapReady(true);
      // Seed the map-centre state so distance calculations work before the
      // user pans for the first time.
      const c0 = map.getCenter();
      setMapCenter({ lat: c0.lat, lng: c0.lng });
      if (isFocusOnlyRef.current && initialFocus) {
        // Build a PlaceResult from the focus payload so the bottom sheet
        // card has all the info it needs.
        const place: PlaceResult = {
          id: initialFocus.id,
          name: initialFocus.name,
          lat: initialFocus.lat,
          lng: initialFocus.lng,
          rating: initialFocus.rating ?? 0,
          priceLevel: initialFocus.priceLevel ?? 0,
          address: initialFocus.address ?? '',
          fullAddress: initialFocus.fullAddress ?? initialFocus.address ?? '',
          photoUrl: initialFocus.photoUrl ?? null,
          types: initialFocus.types ?? [],
          userRatingCount: initialFocus.userRatingCount ?? 0,
        };
        // Render exactly one discover-style pin for the focused restaurant.
        syncMarkers([place]);
        // Pre-select it so the sheet opens on the card.
        isMarkerSelectedRef.current = true;
        setSelectedPlace(place);
        setSelectedMarker(place.id);
        setSheetState('peek');
        return;
      }
      // Session cache: if we've already loaded discover places earlier in
      // this session, just paint the markers — don't fire a fresh API call
      // when the user returns to the Map page from another tab.
      if (tabDataCache.discoverLoaded) {
        syncMarkers(tabDataCache.discoverPlaces);
        setTimeout(() => addExpertOverlayRef.current?.(), 100);
      } else {
        fetchNearby();
      }
    });

    // Show "Search this area" button immediately on pan-end — no debounce,
    // we want the pill visible the moment the user stops dragging.
    map.on('moveend', (e) => {
      // Mapbox fires `moveend` for both human gestures (drag, wheel-zoom,
      // pinch) and programmatic camera moves (easeTo / flyTo / fitBounds).
      // Everything below should only fire on real human moves —
      // otherwise clicking a marker (which programmatically re-centres
      // the map) would collapse the anchor onto the marker and pop the
      // "Search this area" pill. Mapbox helps us tell them apart:
      // `originalEvent` is the underlying DOM event on user moves, and
      // is null/undefined on programmatic ones.
      const userInitiated = !!(e as { originalEvent?: unknown })?.originalEvent;
      if (!userInitiated) return;
      const c = map.getCenter();
      setMapCenter({ lat: c.lat, lng: c.lng });
      const ref = referenceLocationRef.current;
      if (ref) {
        const dKm = haversineKm({ lat: c.lat, lng: c.lng }, { lat: ref.lat, lng: ref.lng });
        if (dKm > REFERENCE_CLEAR_RADIUS_MILES * 1.60934) {
          setReferenceLocation(null);
        }
      }
      if (isFocusOnlyRef.current) return; // no fresh searches in focus-only view
      if (mapModeRef.current !== 'discover' && mapModeRef.current !== 'hotels') return;
      if (fetchTimeoutRef.current) { clearTimeout(fetchTimeoutRef.current); fetchTimeoutRef.current = null; }
      setShowSearchHere(true);
    });

    // Click on the map background clears the selection. Marker click
    // handlers call e.stopPropagation(), so a real marker hit never
    // reaches this listener — meaning any click that does reach it
    // genuinely came from empty map and should dismiss the detail
    // panel on the first try.
    const clearPopup = () => {
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
      setSelectedMarker(null);
      setSelectedPlace(null);
      isMarkerSelectedRef.current = false;
    };
    const clearOnDrag = () => {
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
      isMarkerSelectedRef.current = false;
      setSelectedMarker(null);
      setSelectedPlace(null);
    };
    map.on('click', clearPopup);
    map.on('dragstart', clearOnDrag);

    // The desktop sidebar expands on hover and collapses on leave, which
    // changes the map container's width. Mapbox doesn't track container
    // size on its own, so watch the container and trigger a resize on
    // every change — otherwise the canvas keeps its previous size and
    // leaves a blank strip where the sidebar used to be.
    const container = mapContainerRef.current;
    const ro = new ResizeObserver(() => { mapRef.current?.resize(); });
    ro.observe(container);
    const onWindowResize = () => { mapRef.current?.resize(); };
    window.addEventListener('resize', onWindowResize);

    return () => {
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
      ro.disconnect();
      window.removeEventListener('resize', onWindowResize);
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update marker styles when selection changes. We have three different
  // marker pools (discover places by id, ratings markers in a flat array,
  // hotels), and each has its own visual language; the discover marker
  // swaps to a filled primary pin while the ratings markers keep their
  // score-coloured ring but get an extra primary glow + slight scale so
  // the picked one is obviously the active one. The map's z-index is
  // bumped too so the selected pin draws above its neighbours.
  useEffect(() => {
    // Discover-mode pin markers (id-keyed map)
    Object.entries(markersRef.current).forEach(([id, marker]) => {
      const el = marker.getElement();
      const pin = el.querySelector('.marker-pin') as HTMLElement;
      if (!pin) return;
      const isSelected = id === selectedMarker;
      // Selected → brand primary; otherwise restore the marker's own score
      // colour. Content (white score / pin glyph) stays white in both states.
      pin.style.background = isSelected
        ? 'var(--color-primary, #9f3012)'
        : (pin.dataset.baseColor || '#94a3b8');
      el.style.zIndex = isSelected ? '5' : '';
    });
    // Ratings markers (myratings / friends / experts) — flat array, each
    // marker carries data-place-id. The hover handlers on these markers
    // mutate `transform` on mouseenter/leave, so the selection state
    // sticks to box-shadow + z-index (which the hover code never touches)
    // — that way the picked marker stays visually called-out even after
    // the cursor leaves it.
    customMarkersRef.current.forEach((marker) => {
      const el = marker.getElement();
      const id = el.dataset.placeId;
      const inner = el.querySelector('.marker-pin') as HTMLElement | null;
      if (!inner) return;
      const isSelected = !!id && id === selectedMarker;
      inner.style.boxShadow = isSelected
        ? '0 0 0 5px rgba(159, 48, 18, 0.22), 0 6px 16px rgba(0,0,0,0.28)'
        : '0 2px 10px rgba(0,0,0,0.15)';
      el.style.zIndex = isSelected ? '10' : '';
    });
  }, [selectedMarker]);

  // Dismiss restaurant card when sheet leaves peek state
  useEffect(() => {
    if (sheetState !== 'peek' && selectedPlace) {
      setSelectedPlace(null);
      setSelectedMarker(null);
    }
  }, [sheetState, selectedPlace]);

  // Listen for "open-discover-sheet" events from BottomNav Explore button
  useEffect(() => {
    if (mode === 'map') return;
    const handler = () => {
      setSheetState('full');
      setMapMode('discover');
    };
    window.addEventListener('open-discover-sheet', handler);
    return () => window.removeEventListener('open-discover-sheet', handler);
  }, [mode]);

  // Handle ?discover=1 query param (from navigation)
  useEffect(() => {
    if (mode === 'map') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('discover') === '1') {
      setSheetState('full');
      setMapMode('discover');
      window.history.replaceState({}, '', '/');
    }
  }, [mode]);

  // ── Focus deep-link cleanup: the `state.focus` payload was consumed at
  // mount time (see `initialFocus` above and the map-init `load` handler
  // that renders the single marker). All we do here is drop the payload
  // from history once the map is ready, so a hard refresh or back-nav
  // doesn't re-trigger focus-only view after the user has explicitly
  // left it.
  const handledFocusStateRef = useRef(false);
  useEffect(() => {
    if (mode !== 'map') return;
    if (handledFocusStateRef.current) return;
    if (!mapReady) return;
    if (!(location.state as any)?.focus) return;
    handledFocusStateRef.current = true;
    navigate(location.pathname, { replace: true, state: null });
  }, [mode, location.state, location.pathname, mapReady, navigate]);

  // Deep-link from the Pantry: `navigate('/map', { state: { listView: { id } } })`
  // opens the map in My-Ratings mode pre-filtered to that list (id may be a
  // list id, the wishlist sentinel, or null for all ratings). Gated on
  // mapReady — like the focus handler above — so the selection is applied only
  // after the page-transition + map load settle. Applying it during mount
  // stalls framer-motion's mode="wait" exit/enter and leaves the previous page
  // on screen. Consumed once per mount.
  const handledListViewRef = useRef(false);
  useEffect(() => {
    if (mode !== 'map' || handledListViewRef.current || !mapReady) return;
    const lv = (location.state as any)?.listView;
    if (!lv) return;
    handledListViewRef.current = true;
    setSelectedListId(lv.id ?? null);
    setMapMode('myratings');
  }, [mode, location.state, mapReady]);

  // Location geocoding (debounced)
  useEffect(() => {
    if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
    if (!locationQuery.trim()) { setLocationResults([]); return; }
    setLocationLoading(true);
    locationDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(locationQuery)}.json?access_token=${MAPBOX_TOKEN}&types=place,locality,neighborhood,address,poi&limit=5`
        );
        const data = await res.json();
        setLocationResults((data.features || []).map((f: any) => ({
          id: f.id, name: f.place_name, lat: f.center[1], lng: f.center[0],
        })));
      } catch { setLocationResults([]); }
      finally { setLocationLoading(false); }
    }, 300);
    return () => { if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current); };
  }, [locationQuery]);

  const handleSelectLocation = useCallback((name: string, lat: number, lng: number) => {
    setLocationQuery('');
    setLocationResults([]);
    setLocationSearchOpen(false);
    setSearchLocationBias({ lat, lng });
    // Lock the distance anchor to the typed location so card distances are
    // measured from where the user actually searched, not the map centre.
    // Also seed mapCenter to the same point so that — should the anchor
    // ever be cleared later — the fallback already reflects the area the
    // user is exploring.
    setReferenceLocation({ lat, lng, name });
    setMapCenter({ lat, lng });
    const map = mapRef.current;
    if (map) {
      map.flyTo({ center: [lng, lat], zoom: 14, duration: 1500 });
      setTimeout(() => {
        fetchNearbyRef.current?.();
      }, 1600);
    }
  }, []);

  // Auto-search as user types (debounced)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!searchQuery.trim() || !discoverSearchActive) return;
    searchDebounceRef.current = setTimeout(() => {
      handleSearch(searchQuery);
    }, 500);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchQuery, discoverSearchActive, handleSearch]);

  const flyToPlace = useCallback((place: PlaceResult) => {
    setSelectedMarker(place.id);
    isMarkerSelectedRef.current = true;
    mapRef.current?.easeTo({
      center: [place.lng, place.lat],
      duration: 500,
    });
  }, []);

  // Create a hotel marker element (distinct Building2 icon, teal color)
  const createHotelMarkerElement = useCallback((place: PlaceResult) => {
    const el = document.createElement('div');
    el.className = 'mapbox-custom-marker';
    el.innerHTML = `
      <div class="marker-pin" data-id="${place.id}" style="
        padding: 10px;
        border-radius: 50%;
        background: #0d9488;
        box-shadow: 0 4px 20px rgba(13,148,136,0.3);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transform: scale(0.4);
        transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s ease;
      ">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/>
          <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>
          <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/>
          <path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>
        </svg>
      </div>
    `;
    el.addEventListener('mouseenter', () => {
      const pin = el.querySelector('.marker-pin') as HTMLElement;
      if (pin) pin.style.transform = 'scale(1.15)';
    });
    el.addEventListener('mouseleave', () => {
      const pin = el.querySelector('.marker-pin') as HTMLElement;
      if (pin) pin.style.transform = 'scale(1)';
    });
    return el;
  }, []);

  // Show popup for a hotel
  const showHotelPopup = useCallback((place: PlaceResult, _map: mapboxgl.Map) => {
    if (popupRef.current) popupRef.current.remove();
    popupRef.current = null;
    setSelectedPlace(place);
    setSheetState('peek');
  }, []);

  // Fetch hotels near current map center
  const fetchHotels = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    setHotelsLoading(true);
    try {
      const center = map.getCenter();
      const results = await searchHotels('hotels', center.lat, center.lng);
      setHotelPlaces(results);
      tabDataCache.hotelPlaces = results;
      tabDataCache.hotelsLoaded = true;
    } catch (err) {
      console.error('Hotel search failed:', err);
    } finally {
      setHotelsLoading(false);
    }
  }, []);

  const activeFilterCount = useMemo(() => {
    if (mapMode === 'discover') {
      return (selectedCuisines.length > 0 ? 1 : 0) + (selectedPrice > 0 ? 1 : 0) + (sortBy !== 'popularity' ? 1 : 0) + (selectedMichelin.length > 0 ? 1 : 0) + (isHoursFilterActive(hoursFilter) ? 1 : 0);
    }
    if (mapMode === 'myratings') {
      return (ratingSortBy !== 'recent' ? 1 : 0) + (scoreRange[0] > 0 || scoreRange[1] < 10 ? 1 : 0) + (ratingPrice ? 1 : 0) + (ratingCuisines.length > 0 ? 1 : 0) + (ratingCities.length > 0 ? 1 : 0) + (selectedListId ? 1 : 0) + (selectedMichelin.length > 0 ? 1 : 0) + (isHoursFilterActive(hoursFilter) ? 1 : 0);
    }
    if (mapMode === 'friends') {
      return (ratingSortBy !== 'recent' ? 1 : 0) + (scoreRange[0] > 0 || scoreRange[1] < 10 ? 1 : 0) + (ratingCuisines.length > 0 ? 1 : 0) + (selectedFriendIds.size > 0 ? 1 : 0) + (isHoursFilterActive(hoursFilter) ? 1 : 0);
    }
    if (mapMode === 'experts') {
      return (ratingSortBy !== 'recent' ? 1 : 0) + (scoreRange[0] > 0 || scoreRange[1] < 10 ? 1 : 0) + (ratingCuisines.length > 0 ? 1 : 0) + (isHoursFilterActive(hoursFilter) ? 1 : 0);
    }
    if (mapMode === 'hotels') {
      return (hotelStarFilter > 0 ? 1 : 0) + (hotelPriceFilter > 0 ? 1 : 0) + (hotelSortBy !== 'popularity' ? 1 : 0) + (isHoursFilterActive(hoursFilter) ? 1 : 0);
    }
    return 0;
  }, [mapMode, selectedCuisines, selectedPrice, sortBy, discoverRadius, ratingSortBy, scoreRange, ratingPrice, ratingCuisines, ratingCities, selectedListId, selectedFriendIds, hotelStarFilter, hotelPriceFilter, hotelSortBy, selectedMichelin, hoursFilter]);

  // Helper: filter and sort a CommunityRating array by the active rating-mode filters
  const filterRatings = useCallback((ratings: CommunityRating[]): CommunityRating[] => {
    let filtered = ratings;
    // Score range
    if (scoreRange[0] > 0 || scoreRange[1] < 10) {
      filtered = filtered.filter((r) => { const s = Number(r.score) || 0; return s >= scoreRange[0] && s <= scoreRange[1]; });
    }
    // Price
    if (ratingPrice) {
      filtered = filtered.filter((r) => r.price === ratingPrice);
    }
    // Cuisine
    if (ratingCuisines.length > 0) {
      const cuisSet = new Set(ratingCuisines.map((c) => c.toLowerCase()));
      filtered = filtered.filter((r) => r.cuisine && cuisSet.has(r.cuisine.toLowerCase()));
    }
    // City (myratings only)
    if (ratingCities.length > 0) {
      const citySet = new Set(ratingCities);
      filtered = filtered.filter((r) => {
        const city = extractCityState(r.address || '', r.address || '');
        return citySet.has(city);
      });
    }
    // Michelin distinction
    if (selectedMichelin.length > 0) {
      filtered = filtered.filter((r) =>
        passesMichelinFilter(selectedMichelin, r.restaurant_name, r.lat ?? undefined, r.lng ?? undefined, r.address));
    }
    // Opening hours (breakfast/lunch/dinner + open now)
    if (isHoursFilterActive(hoursFilter)) {
      filtered = filtered.filter((r) => passesHoursFilter(restaurantMeta[r.restaurant_id]?.hours, hoursFilter));
    }
    // Sort
    const sorted = [...filtered];
    switch (ratingSortBy) {
      case 'highest': sorted.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)); break;
      case 'lowest': sorted.sort((a, b) => (Number(a.score) || 0) - (Number(b.score) || 0)); break;
      case 'visited': sorted.sort((a, b) => (b.visit_date || '').localeCompare(a.visit_date || '')); break;
      case 'recent': default: sorted.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')); break;
    }
    return sorted;
  }, [scoreRange, ratingPrice, ratingCuisines, ratingCities, ratingSortBy, selectedMichelin, michelinReady, hoursFilter, restaurantMeta]);

  // Wishlist items reshaped as score-0, rating-shaped objects so the existing
  // My-Ratings markers (heart pins) and list rows can plot them. Coordinates
  // come from the lazily-populated restaurantMeta cache plus the geocode
  // backfill below.
  const [wishlistGeo, setWishlistGeo] = useState<Record<string, { lat: number; lng: number }>>({});
  const wishlistRatings = useMemo<CommunityRating[]>(() => {
    return wishlist.map((w) => {
      const meta = restaurantMeta[w.restaurantId];
      const geo = wishlistGeo[w.restaurantId];
      return {
        id: `wish-${w.restaurantId}`,
        user_id: userId || '',
        restaurant_id: w.restaurantId,
        restaurant_name: w.name,
        score: 0,
        price: w.price || '',
        cuisine: w.cuisine || '',
        address: w.address || '',
        photo_url: w.image || null,
        notes: w.notes || '',
        lat: meta?.lat ?? geo?.lat,
        lng: meta?.lng ?? geo?.lng,
        created_at: new Date(w.addedAt || Date.now()).toISOString(),
      } as unknown as CommunityRating;
    });
  }, [wishlist, restaurantMeta, wishlistGeo, userId]);

  // Filtered ratings for each mode. selectedListId picks what "My places"
  // shows: null = all rated; the wishlist sentinel = every wishlist item; a
  // real list id = that list's rated + wishlisted restaurants.
  const filteredMyRatings = useMemo(() => {
    let base: CommunityRating[];
    if (selectedListId === WISHLIST_LIST_ID) {
      base = wishlistRatings;
    } else if (selectedListId) {
      const list = myLists.find((l: any) => l.id === selectedListId);
      if (list) {
        const ratedIds = new Set(list.restaurantIds || []);
        const wishIds = new Set(list.wishlistIds || []);
        base = [
          ...myRatings.filter((r) => ratedIds.has(r.restaurant_id)),
          ...wishlistRatings.filter((r) => wishIds.has(r.restaurant_id)),
        ];
      } else {
        base = myRatings;
      }
    } else {
      base = myRatings;
    }
    return filterRatings(base);
  }, [myRatings, wishlistRatings, selectedListId, myLists, filterRatings]);

  // Backfill coordinates for wishlist items the current view needs but that
  // restaurantMeta doesn't have yet (mirrors the ratings geocode below). Each
  // id is tried at most once per session.
  const wishlistGeoTriedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (mapMode !== 'myratings') return;
    const list = selectedListId && selectedListId !== WISHLIST_LIST_ID ? myLists.find((l: any) => l.id === selectedListId) : null;
    const showsWishlist = selectedListId === WISHLIST_LIST_ID || !!(list && (list.wishlistIds?.length || 0) > 0);
    if (!showsWishlist) return;
    const missing = wishlistRatings.filter((r) => (!r.lat || !r.lng) && r.address && !wishlistGeoTriedRef.current.has(r.restaurant_id));
    if (missing.length === 0) return;
    missing.forEach((r) => wishlistGeoTriedRef.current.add(r.restaurant_id));
    let cancelled = false;
    (async () => {
      for (const r of missing) {
        if (cancelled) break;
        try {
          const query = `${r.restaurant_name} ${r.address || ''}`.trim();
          const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&types=poi,address&limit=1`);
          const data = await res.json();
          const f = data.features?.[0];
          if (f?.center) {
            const [lng, lat] = f.center;
            setWishlistGeo((prev) => ({ ...prev, [r.restaurant_id]: { lat, lng } }));
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    })();
    return () => { cancelled = true; };
  }, [mapMode, selectedListId, wishlistRatings, myLists]);

  const filteredFriendRatings = useMemo(() => {
    let base = friendRatings;
    if (selectedFriendIds.size > 0) base = base.filter((r) => selectedFriendIds.has(r.user_id));
    return filterRatings(base);
  }, [friendRatings, selectedFriendIds, filterRatings]);

  const filteredExpertRatings = useMemo(() => filterRatings(expertRatings), [expertRatings, filterRatings]);

  const filteredHotelPlaces = useMemo(() => {
    let filtered = hotelPlaces;
    if (hotelStarFilter > 0) {
      const minRating = hotelStarFilter === 3 ? 3.5 : hotelStarFilter === 4 ? 4.0 : 4.5;
      filtered = filtered.filter((p) => p.rating >= minRating);
    }
    if (hotelPriceFilter > 0) filtered = filtered.filter((p) => p.priceLevel === hotelPriceFilter);
    if (isHoursFilterActive(hoursFilter)) {
      filtered = filtered.filter((p) => passesHoursFilter(restaurantMeta[p.id]?.hours, hoursFilter));
    }
    const sorted = [...filtered];
    switch (hotelSortBy) {
      case 'rating': sorted.sort((a, b) => b.rating - a.rating); break;
      case 'price_low': sorted.sort((a, b) => a.priceLevel - b.priceLevel); break;
      case 'popularity': default: sorted.sort((a, b) => b.userRatingCount - a.userRatingCount); break;
    }
    return sorted;
  }, [hotelPlaces, hotelStarFilter, hotelPriceFilter, hotelSortBy, hoursFilter, restaurantMeta]);

  // Extract unique cuisines and cities from ratings for filter pills
  const uniqueMyRatingCuisines = useMemo(() => [...new Set(myRatings.map((r) => r.cuisine).filter(Boolean))].sort(), [myRatings]);
  const uniqueFriendCuisines = useMemo(() => [...new Set(friendRatings.map((r) => r.cuisine).filter(Boolean))].sort(), [friendRatings]);
  const uniqueExpertCuisines = useMemo(() => [...new Set(expertRatings.map((r) => r.cuisine).filter(Boolean))].sort(), [expertRatings]);
  const uniqueMyRatingCities = useMemo(() => [...new Set(myRatings.map((r) => extractCityState(r.address || '', r.address || '')).filter(Boolean))].sort(), [myRatings]);

  // Background geocode missing coordinates for the CURRENT USER's own ratings only.
  // Expert/friend ratings without coords are simply skipped (not geocoded) to avoid
  // slow sequential API calls that block marker rendering.
  useEffect(() => {
    if (mapMode !== 'myratings' || myRatings.length === 0) return;
    if (tabDataCache.coordsLookedUp['myratings']) return;
    tabDataCache.coordsLookedUp['myratings'] = true;

    const missing = myRatings.filter((r) => !r.lat || !r.lng || (Math.abs(r.lat) < 1 && Math.abs(r.lng) < 1));
    if (missing.length === 0) return;

    (async () => {
      for (const r of missing) {
        try {
          const query = `${r.restaurant_name} ${r.address || ''}`.trim();
          const res = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&types=poi,address&limit=1`
          );
          const data = await res.json();
          const feature = data.features?.[0];
          if (feature?.center) {
            const [lng, lat] = feature.center;
            r.lat = lat;
            r.lng = lng;
            publishCommunityRating(r.user_id, r.restaurant_id, {
              name: r.restaurant_name, score: Number(r.score), notes: r.notes, cuisine: r.cuisine,
              price: r.price, address: r.address, visitDate: r.visit_date, tags: r.tags,
              wouldReturn: r.would_return, friendIds: r.friend_ids || [],
              photoUrl: r.photo_url || '', lat, lng,
            });
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      tabDataCache.myRatings = [...myRatings];
      setMyRatings((prev) => [...prev]);
    })();
  }, [mapMode, myRatings]);

  // Background geocode missing coordinates for expert and friend ratings in PARALLEL
  // so markers appear instantly when the Experts/Friends tab is opened and so the
  // expert overlay on the Discover map is populated. Results are persisted back to
  // the database so subsequent loads are already populated.
  // Expert ratings are geocoded eagerly (discover overlay needs their coords).
  // Friend ratings are geocoded only when the Friends tab is first opened.
  useEffect(() => {
    const kind = expertRatings.length > 0 && !tabDataCache.coordsLookedUp['experts']
      ? 'experts'
      : mapMode === 'friends' && friendRatings.length > 0 && !tabDataCache.coordsLookedUp['friends']
      ? 'friends'
      : null;
    if (!kind) return;
    const source = kind === 'experts' ? expertRatings : friendRatings;
    if (source.length === 0) return;
    tabDataCache.coordsLookedUp[kind] = true;

    const missing = source.filter((r) => !r.lat || !r.lng || (Math.abs(r.lat) < 1 && Math.abs(r.lng) < 1));
    if (missing.length === 0) return;

    const setter = kind === 'experts' ? setExpertRatings : setFriendRatings;

    (async () => {
      const CONCURRENCY = 10;
      let updatedSinceFlush = 0;
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      const scheduleFlush = () => {
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
          flushTimer = null;
          updatedSinceFlush = 0;
          setter((prev) => [...prev]);
        }, 200);
      };

      const geocodeOne = async (r: CommunityRating) => {
        try {
          const query = `${r.restaurant_name} ${r.address || ''}`.trim();
          const res = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&types=poi,address&limit=1`
          );
          const data = await res.json();
          const feature = data.features?.[0];
          if (feature?.center) {
            const [lng, lat] = feature.center;
            r.lat = lat;
            r.lng = lng;
            updatedSinceFlush++;
            scheduleFlush();
            // Persist so subsequent loads don't need to geocode again.
            publishCommunityRating(r.user_id, r.restaurant_id, {
              name: r.restaurant_name, score: Number(r.score), notes: r.notes, cuisine: r.cuisine,
              price: r.price, address: r.address, visitDate: r.visit_date, tags: r.tags,
              wouldReturn: r.would_return, friendIds: r.friend_ids || [],
              photoUrl: r.photo_url || '', lat, lng,
            });
          }
        } catch {}
      };

      // Run with bounded concurrency.
      let idx = 0;
      const workers = Array.from({ length: Math.min(CONCURRENCY, missing.length) }, async () => {
        while (idx < missing.length) {
          const i = idx++;
          await geocodeOne(missing[i]);
        }
      });
      await Promise.all(workers);
      if (flushTimer) clearTimeout(flushTimer);
      if (kind === 'experts') tabDataCache.expertRatings = [...source];
      else tabDataCache.friendRatings = [...source];
      setter((prev) => [...prev]);
    })();
  }, [mapMode, expertRatings, friendRatings]);

  // Fetch hotels when entering hotels mode — but only the first time in
  // this session. Returning to the tab after navigating away reuses the
  // cached results and skips the API call entirely.
  useEffect(() => {
    if (isFocusOnly) return; // focus-only view never pulls extra markers
    if (mapMode === 'hotels' && !tabDataCache.hotelsLoaded) fetchHotels();
  }, [mapMode, isFocusOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch friends' public home meals — eagerly, not gated by the map's
  // recipes tab, because the home page "Recipes for you" rail also pulls
  // from this pool (home-cooked entries posted via the meal logger are a
  // valid source of friend recipes alongside the formal `recipes` table).
  // Loads lazily the first time per session; subsequent visits reuse the
  // cached list rather than re-firing the API call.
  useEffect(() => {
    if (!userId) return;
    if (tabDataCache.friendRecipesLoaded) return;
    let cancelled = false;
    setFriendRecipesLoading(true);
    (async () => {
      try {
        const friends = await getFriends(userId);
        const friendIds = friends.map((f) => f.friend_id);
        if (friendIds.length === 0) {
          if (!cancelled) setFriendRecipes([]);
          tabDataCache.friendRecipes = [];
          tabDataCache.recipeAuthorProfiles = {};
          tabDataCache.friendRecipesLoaded = true;
          return;
        }
        const meals = await getFriendsPublicHomeMeals(friendIds);
        if (cancelled) return;
        meals.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        setFriendRecipes(meals);
        tabDataCache.friendRecipes = meals;
        // Pull author profiles so we can show names on cards.
        const uniqueAuthors = Array.from(new Set(meals.map((m) => m.userId)));
        let profiles: Record<string, UserProfile> = {};
        if (uniqueAuthors.length > 0) {
          profiles = await getProfilesByIds(uniqueAuthors);
          if (cancelled) return;
          setRecipeAuthorProfiles(profiles);
        }
        tabDataCache.recipeAuthorProfiles = profiles;
        tabDataCache.friendRecipesLoaded = true;
      } catch (err) {
        console.warn('[Map] friend recipes fetch failed:', err);
      } finally {
        if (!cancelled) setFriendRecipesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Add/remove hotel markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear previous hotel markers
    hotelMarkersRef.current.forEach((m) => m.remove());
    hotelMarkersRef.current = [];

    if (isFocusOnly) return; // focus-only view only shows the focus marker
    if (mapMode !== 'hotels' || hotelPlaces.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    let hasMarkers = false;
    let animIndex = 0;

    for (const place of hotelPlaces) {
      const el = createHotelMarkerElement(place);

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setSelectedMarker(place.id);
        isMarkerSelectedRef.current = true;
        map.easeTo({ center: [place.lng, place.lat], duration: 500 });
        showHotelPopup(place, map);
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([place.lng, place.lat])
        .addTo(map);

      hotelMarkersRef.current.push(marker);
      bounds.extend([place.lng, place.lat]);
      hasMarkers = true;

      // Staggered fade-in
      const delay = Math.min(animIndex * 25, 400);
      setTimeout(() => {
        const pin = el.querySelector('.marker-pin') as HTMLElement;
        if (pin) { pin.style.opacity = '1'; pin.style.transform = 'scale(1)'; }
      }, delay);
      animIndex++;
    }

    if (hasMarkers) {
      map.fitBounds(bounds, { padding: 50, maxZoom: 13 });
    }
  }, [mapMode, hotelPlaces, createHotelMarkerElement, showHotelPopup, isFocusOnly]);

  // Add/remove custom markers for My Ratings and Friends modes
  const customMarkersRef = useRef<mapboxgl.Marker[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear custom markers. Clear expert overlay markers only when leaving
    // discover mode — a dedicated effect manages the overlay in discover.
    customMarkersRef.current.forEach((m) => m.remove());
    customMarkersRef.current = [];
    if (mapMode !== 'discover') {
      expertOverlayMarkersRef.current.forEach((m) => m.remove());
      expertOverlayMarkersRef.current = [];
    }

    // Focus-only view: the single focus marker was added by the map-init
    // load handler using syncMarkers, so leave it alone and skip all the
    // ratings/hotels rendering below.
    if (isFocusOnly) return;

    // Hide/show discover markers based on mode
    Object.values(markersRef.current).forEach((marker) => {
      try {
        const el = marker.getElement();
        if (el) el.style.display = mapMode === 'discover' ? '' : 'none';
      } catch {}
    });

    // Hide hotel markers when not in hotels mode (their own effect manages visibility)
    if (mapMode !== 'hotels') {
      hotelMarkersRef.current.forEach((m) => { try { m.getElement().style.display = 'none'; } catch {} });
    } else {
      hotelMarkersRef.current.forEach((m) => { try { m.getElement().style.display = ''; } catch {} });
    }

    // Also close any open popups
    if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }

    const ratings = mapMode === 'myratings' ? filteredMyRatings : mapMode === 'friends' ? filteredFriendRatings : mapMode === 'experts' ? filteredExpertRatings : [];
    if (ratings.length === 0) return;

    // Convert ratings to PlaceResult[] for the card/swipe system
    const ratingPlaces = ratings.map(ratingToPlace).filter(Boolean) as PlaceResult[];
    setPlaces(ratingPlaces);

    const bounds = new mapboxgl.LngLatBounds();
    let hasMarkers = false;
    const strokeColor = mapMode === 'friends' ? '#9f3012' : mapMode === 'experts' ? '#d4a017' : '#333';

    for (const r of ratings) {
      if (!r.lat || !r.lng) continue;
      // Size hierarchy based on score
      const score = Number(r.score) || 0;
      const markerSize = score >= 8 ? 42 : score >= 5 ? 38 : 34;
      const iconSz = Math.round(markerSize * 0.42);
      const el = document.createElement('div');

      // Filled, score/identity-coloured circle with white content + a thin white
      // border — matches the location map's score pins and reads softly on both
      // light and dark map themes (vs. the old stark-white circles).
      let fillColor = '#94a3b8';
      let iconHtml = '';
      if (mapMode === 'friends') {
        const profile = friendProfiles[r.user_id];
        const initial = profile?.display_name?.charAt(0)?.toUpperCase() || '?';
        fillColor = strokeColor;
        iconHtml = `<span style="font-size:${Math.round(markerSize * 0.38)}px;font-weight:800;color:#fff;line-height:1;">${initial}</span>`;
      } else if (mapMode === 'experts') {
        fillColor = '#d4a017';
        iconHtml = `<svg width="${iconSz}" height="${iconSz}" viewBox="0 0 24 24" fill="#fff" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
      } else {
        // myratings: check if wishlisted (no rating) vs rated
        const wishlisted = isWishlisted(r.restaurant_id);
        if (wishlisted && score === 0) {
          // Wishlist item — heart
          fillColor = '#f87171';
          iconHtml = `<svg width="${iconSz}" height="${iconSz}" viewBox="0 0 24 24" fill="#fff" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
        } else {
          // Rated item — score color with the rating in white
          fillColor = score >= 8 ? '#10b981' : score >= 5 ? '#f59e0b' : '#ef4444';
          iconHtml = `<span style="font-size:${Math.round(markerSize * 0.32)}px;font-weight:800;color:#fff;line-height:1;font-variant-numeric:tabular-nums;">${score.toFixed(1)}</span>`;
        }
      }

      el.style.cssText = `display:flex;align-items:center;justify-content:center;cursor:pointer;`;
      el.dataset.placeId = r.restaurant_id;
      const inner = document.createElement('div');
      inner.className = 'marker-pin';
      inner.dataset.placeId = r.restaurant_id;
      inner.style.cssText = `width:${markerSize}px;height:${markerSize}px;border-radius:50%;background:${fillColor};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.28);display:flex;align-items:center;justify-content:center;transition:transform 0.2s ease, box-shadow 0.2s ease;`;
      inner.innerHTML = iconHtml;
      el.appendChild(inner);
      el.addEventListener('mouseenter', () => { inner.style.transform = 'scale(1.15)'; });
      el.addEventListener('mouseleave', () => { inner.style.transform = 'scale(1)'; });

      const place = ratingToPlace(r);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
        if (place) {
          setSelectedPlace(place);
          setSelectedMarker(place.id);
          setSheetState('peek');
          map.easeTo({ center: [place.lng, place.lat], duration: 500 });
        }
        isMarkerSelectedRef.current = true;
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([r.lng, r.lat]).addTo(map);
      customMarkersRef.current.push(marker);
      bounds.extend([r.lng, r.lat]);
      hasMarkers = true;
    }

    if (hasMarkers) {
      map.fitBounds(bounds, { padding: 50, maxZoom: 13 });
    }
  }, [mapMode, filteredMyRatings, filteredFriendRatings, filteredExpertRatings, friendProfiles, isWishlisted, isFocusOnly]);

  // ── Desktop map panel: helpers, derived data, and JSX ──
  // The panel replaces the bottom-sheet pop-up on wide viewports. It owns
  // the same modes as the sheet but renders everything in a single-column
  // list with no thumbnail slots, instead emphasising name + meta + score.
  // Marker clicks select an inline "detail" view rather than spawning a
  // floating card over the map.
  const PANEL_MODE_TABS: Array<{
    id: 'discover' | 'myratings' | 'friends' | 'experts';
    label: string;
    icon: typeof Star;
  }> = [
    { id: 'discover', label: 'Discover', icon: Sparkles },
    { id: 'myratings', label: 'My Ratings', icon: Star },
    { id: 'friends', label: 'Friends', icon: Users },
    { id: 'experts', label: 'Experts', icon: Star },
  ];
  const activePanelMode = PANEL_MODE_TABS.find((t) => t.id === mapMode) ?? PANEL_MODE_TABS[0];
  // Panel/header title — in My-Ratings mode it reflects the chosen list or
  // wishlist rather than a flat "My Ratings".
  const panelTitle = mapMode === 'myratings'
    ? (selectedListId === WISHLIST_LIST_ID
        ? 'Wishlist'
        : selectedListId
          ? (myLists.find((l: any) => l.id === selectedListId)?.name || 'List')
          : 'My Ratings')
    : activePanelMode.label;

  // Score → green/amber/red colour bucket used by every list card.
  const scoreColors = (s: number) => s >= 8
    ? { bg: 'bg-green-50', border: 'border-green-100', text: 'text-green-700', tint: 'text-green-700/60' }
    : s >= 5
      ? { bg: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-700', tint: 'text-amber-700/60' }
      : { bg: 'bg-red-50', border: 'border-red-100', text: 'text-red-600', tint: 'text-red-600/60' };

  // Optional client-side name filter applied on top of every mode list so
  // the search input feels alive across tabs (the discover-mode API search
  // still runs independently via the existing handleSearch effect).
  const panelTextQ = searchQuery.trim().toLowerCase();
  const matchesPanelQ = useCallback((name: string) => !panelTextQ || name.toLowerCase().includes(panelTextQ), [panelTextQ]);

  const panelMyRatings = useMemo(() => filteredMyRatings.filter((r) => matchesPanelQ(r.restaurant_name)), [filteredMyRatings, matchesPanelQ]);
  const panelFriendRatings = useMemo(() => filteredFriendRatings.filter((r) => matchesPanelQ(r.restaurant_name)), [filteredFriendRatings, matchesPanelQ]);
  const panelExpertRatings = useMemo(() => filteredExpertRatings.filter((r) => matchesPanelQ(r.restaurant_name)), [filteredExpertRatings, matchesPanelQ]);
  const panelHotelPlaces = useMemo(() => filteredHotelPlaces.filter((p) => matchesPanelQ(p.name)), [filteredHotelPlaces, matchesPanelQ]);
  const panelDiscoverPlaces = useMemo(() => places.filter((p) => matchesPanelQ(p.name)), [places, matchesPanelQ]);
  const panelRecipes = useMemo(() => friendRecipes.filter((m) => matchesPanelQ(m.name || '')), [friendRecipes, matchesPanelQ]);

  const panelResultCount =
    mapMode === 'discover' ? panelDiscoverPlaces.length
    : mapMode === 'myratings' ? panelMyRatings.length
    : mapMode === 'friends' ? panelFriendRatings.length
    : mapMode === 'experts' ? panelExpertRatings.length
    : mapMode === 'hotels' ? panelHotelPlaces.length
    : mapMode === 'recipes' ? panelRecipes.length
    : 0;

  // Click handler shared by every list row: pan the map, light up the
  // marker, and switch the panel to the inline detail view.
  const focusPanelPlace = useCallback((place: PlaceResult) => {
    isMarkerSelectedRef.current = true;
    setSelectedPlace(place);
    setSelectedMarker(place.id);
    setSheetState('peek');
    const map = mapRef.current;
    if (map) {
      // Zoom into the place so the marker is the obvious centre of
      // attention. Only zoom IN — if the user is already closer than
      // street level we keep their current zoom rather than yanking
      // them back out.
      const targetZoom = Math.max(map.getZoom(), 15.5);
      map.easeTo({ center: [place.lng, place.lat], zoom: targetZoom, duration: 700 });
    }
  }, []);
  const focusPanelRating = useCallback((r: CommunityRating) => {
    const place = ratingToPlace(r);
    if (!place) return;
    focusPanelPlace(place);
  }, [focusPanelPlace]);

  // Clear the inline detail and return the panel body to the list.
  const closePanelDetail = useCallback(() => {
    setSelectedPlace(null);
    setSelectedMarker(null);
    isMarkerSelectedRef.current = false;
  }, []);

  // Drag-to-dismiss for the mobile detail sheet (swipe down to close).
  // Drag only fires from the handle (startDetailDrag) so the body scrolls.
  const detailSheetOpen = !!selectedPlace && mode === 'map' && !isDesktopMapMode;
  const { dragProps: detailDragProps, startDrag: startDetailDrag } = useBottomSheet(detailSheetOpen, closePanelDetail);

  // Solid tier-coloured score disc (green ≥8 / amber 5–7 / red <5) — the
  // bolder score treatment used on the mobile map list rows per the design
  // reference. White score, filled circle.
  const mapScoreCircle = (s?: number) => {
    if (s == null || s <= 0) return null;
    const bg = s >= 8 ? '#10b981' : s >= 5 ? '#f59e0b' : '#ef4444';
    return (
      <div
        className="grid flex-shrink-0 place-items-center rounded-full font-serif font-bold tabular-nums text-white"
        style={{ width: 38, height: 38, background: bg, fontSize: 14 }}
        aria-label={`Score ${s.toFixed(1)}`}
      >
        {s.toFixed(1)}
      </div>
    );
  };

  // Map list row (design reference) — used on both the mobile bottom sheet
  // and the desktop sidebar. When the place has a photo it shows a rounded
  // thumbnail with the heart / ＋ overlaid on it; otherwise there's no
  // thumbnail and the heart / ＋ sit inline as outlined circles before the
  // score. A solid score disc always sits on the right.
  const renderMapRow = (opts: {
    key: string;
    onClick: () => void;
    selected: boolean;
    image?: string;
    name: string;
    cuisine?: string;
    price?: string;
    city?: string;
    lat?: number | null;
    lng?: number | null;
    score?: number;
    extra?: React.ReactNode;
    restData: { id: string; name: string; image: string; cuisine: string; price: string; address: string; lat?: number; lng?: number };
    michHit?: React.ComponentProps<typeof MichelinMark>['michelin'] | null;
  }) => {
    const { key, onClick, selected, image, name, cuisine, price, city, lat, lng, score, extra, restData, michHit } = opts;
    // Route through safeImage so billed Google Places photo URLs are never
    // fetched — those coerce to '' and the row falls back to the no-photo
    // (inline actions) variant. Real uploads (community / base64) still show.
    const safe = safeImage(image);
    const hasImage = !!safe;
    const fav = isWishlisted(restData.id);
    const dist = distanceFromAnchor(lat, lng);
    const metaText = [cuisine, price].filter(Boolean).join('  ·  ');
    const infoText = [dist, city].filter(Boolean).join('  ·  ');
    const onHeart = (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); toggleWishlist(restData); };
    const onAdd = (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); openAddRestaurantModal(restData); };
    return (
      <div
        key={key}
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
        className={cn(
          'flex items-center gap-3.5 py-4 cursor-pointer outline-none transition-colors active:bg-on-surface/[0.03]',
          // Mobile sheet supplies its own px-3; the desktop sidebar panel has
          // none, so the row carries its own horizontal padding there.
          phoneMode ? '' : 'px-4 hover:bg-on-surface/[0.025]',
          selected && 'bg-primary/[0.05]',
        )}
      >
        {hasImage && (
          <div className="relative h-[84px] w-[84px] flex-shrink-0 overflow-hidden rounded-2xl bg-on-surface/[0.05]">
            <img src={safe} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            <div className="absolute left-1.5 top-1.5 flex gap-1">
              <button type="button" onClick={onHeart} aria-label={fav ? 'In wishlist' : 'Add to wishlist'}
                className="grid h-7 w-7 place-items-center rounded-full bg-white/95 shadow-sm backdrop-blur-sm transition-transform active:scale-90">
                <Heart size={13} className={fav ? 'fill-primary text-primary' : 'text-on-surface/75'} />
              </button>
              <button type="button" onClick={onAdd} aria-label="Add to list"
                className="grid h-7 w-7 place-items-center rounded-full bg-white/95 shadow-sm backdrop-blur-sm transition-transform active:scale-90">
                <Plus size={14} className="text-on-surface/75" />
              </button>
            </div>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-[17px] font-bold leading-[1.18] tracking-tight text-on-surface">{name}</h3>
          {(metaText || michHit) && (
            <div className="mt-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-on-surface/45">
              {metaText && <span className="truncate">{metaText}</span>}
              {michHit && <MichelinMark michelin={michHit} size={11} />}
            </div>
          )}
          {(infoText || extra) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] font-medium text-on-surface/55">
              {dist && <MapPin size={12} className="flex-shrink-0 text-on-surface/40" />}
              {infoText && <span className="truncate">{infoText}</span>}
              {extra}
            </div>
          )}
        </div>
        {!hasImage && (
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <button type="button" onClick={onHeart} aria-label={fav ? 'In wishlist' : 'Add to wishlist'}
              className="grid h-8 w-8 place-items-center rounded-full border border-on-surface/15 transition-colors active:bg-on-surface/[0.05]">
              <Heart size={15} className={fav ? 'fill-primary text-primary' : 'text-on-surface/70'} />
            </button>
            <button type="button" onClick={onAdd} aria-label="Add to list"
              className="grid h-8 w-8 place-items-center rounded-full border border-on-surface/15 transition-colors active:bg-on-surface/[0.05]">
              <Plus size={16} className="text-on-surface/70" />
            </button>
          </div>
        )}
        {mapScoreCircle(score)}
      </div>
    );
  };

  const panelEmptyMessage = (() => {
    if (mapMode === 'myratings') return activeFilterCount > 0 || panelTextQ ? 'No ratings match these filters.' : 'No rated restaurants yet.';
    if (mapMode === 'friends') return activeFilterCount > 0 || panelTextQ ? 'No friend ratings match these filters.' : 'No friend ratings yet.';
    if (mapMode === 'experts') return activeFilterCount > 0 || panelTextQ ? 'No expert ratings match these filters.' : 'No expert ratings yet.';
    if (mapMode === 'hotels') return hotelsLoading ? 'Searching hotels…' : (activeFilterCount > 0 || panelTextQ ? 'No hotels match these filters.' : 'No hotels in this area yet.');
    if (mapMode === 'recipes') return friendRecipesLoading ? 'Loading recipes…' : 'No recipes from friends yet.';
    return isSearching ? 'Searching…' : (panelTextQ ? 'No restaurants match your search.' : 'Pan the map and hit "Search this area".');
  })();

  // Cards: plain text rows separated by hairline dividers. Hover reveals
  // a Rate + Wishlist button pair anchored to the bottom-right corner.
  const renderRatingCard = (r: CommunityRating, opts: { extra?: React.ReactNode } = {}) => {
    const s = Number(r.score) || 0;
    const city = extractCityState(r.address || '', r.address || '');
    const selected = selectedMarker === r.restaurant_id;
    const restData = { id: r.restaurant_id, name: r.restaurant_name, image: r.photo_url || '', cuisine: r.cuisine || '', price: r.price || '', address: r.address || '', lat: r.lat ?? undefined, lng: r.lng ?? undefined };
    return renderMapRow({
      key: r.id, onClick: () => focusPanelRating(r), selected,
      image: r.photo_url || undefined, name: r.restaurant_name,
      cuisine: r.cuisine || undefined, price: r.price || undefined, city,
      lat: r.lat, lng: r.lng, score: s, extra: opts.extra, restData,
    });
  };

  const renderPlaceCard = (p: PlaceResult) => {
    const { cuisine, price } = michCuisinePrice(p, getCuisineLabel(p.types), p.priceLevel > 0 ? priceLevelToString(p.priceLevel) : '');
    const city = extractCityState(p.fullAddress || '', p.address || '');
    // Only resolve (and show) the Michelin distinction while a Michelin filter is active.
    const michHit = selectedMichelin.length > 0 && michelinReady
      ? findMichelinMatchSync(p.name, p.lat, p.lng, p.fullAddress || p.address)
      : null;
    const myScore = userRatingMap[p.id];
    const expertR = expertRatings.find((r) => r.restaurant_id === p.id);
    const friendCount = friendRatings.filter((r) => r.restaurant_id === p.id).length;
    const selected = selectedMarker === p.id;
    const restData = { id: p.id, name: p.name, image: p.photoUrl || '', cuisine, price, address: p.fullAddress || p.address, lat: p.lat, lng: p.lng };
    const extra = (myScore !== undefined || expertR || friendCount > 0) ? (
      <span className="inline-flex items-center gap-x-2 gap-y-0.5 flex-wrap">
        {myScore !== undefined && (
          <span className="inline-flex items-center gap-1 font-semibold text-on-surface/65">
            <Star size={10} className="fill-on-surface/65 text-on-surface/65" /> You rated {myScore.toFixed(1)}
          </span>
        )}
        {expertR && (
          <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
            <Star size={10} className="fill-amber-500 text-amber-500" /> Expert pick
          </span>
        )}
        {friendCount > 0 && (
          <span className="inline-flex items-center gap-1 font-semibold text-on-surface/65">
            <Users size={10} /> {friendCount} friend{friendCount === 1 ? '' : 's'}
          </span>
        )}
      </span>
    ) : undefined;
    return renderMapRow({
      key: p.id, onClick: () => focusPanelPlace(p), selected,
      image: p.photoUrl || undefined, name: p.name,
      cuisine, price, city, lat: p.lat, lng: p.lng,
      score: p.rating && p.rating > 0 ? Math.min(10, p.rating > 5 ? p.rating : p.rating * 2) : undefined,
      extra, restData, michHit,
    });
  };

  const renderHotelCard = (p: PlaceResult) => {
    const city = extractCityState(p.fullAddress || '', p.address || '');
    const price = p.priceLevel > 0 ? priceLevelToString(p.priceLevel) : '';
    const selected = selectedMarker === p.id;
    const restData = { id: p.id, name: p.name, image: p.photoUrl || '', cuisine: 'Hotel', price, address: p.fullAddress || p.address, lat: p.lat, lng: p.lng };
    return renderMapRow({
      key: p.id, onClick: () => focusPanelPlace(p), selected,
      image: p.photoUrl || undefined, name: p.name,
      cuisine: 'Hotel', price, city, lat: p.lat, lng: p.lng,
      score: p.rating && p.rating > 0 ? Math.min(10, p.rating > 5 ? p.rating : p.rating * 2) : undefined,
      extra: p.userRatingCount > 0 ? <span>{p.userRatingCount.toLocaleString()} reviews</span> : undefined,
      restData,
    });
  };

  const renderRecipeCard = (m: FriendHomeMeal) => {
    const author = recipeAuthorProfiles[m.userId];
    const authorName = author?.display_name || author?.username || 'A friend';
    return (
      <div
        key={m.id}
        role="button"
        tabIndex={0}
        onClick={() => navigate(`/meal/${m.userId}/${m.id}`)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/meal/${m.userId}/${m.id}`); } }}
        className="cursor-pointer px-4 py-4 transition-colors hover:bg-on-surface/[0.025] outline-none focus-visible:bg-on-surface/[0.04]"
      >
        <h3 className="font-serif font-bold text-[15.5px] leading-tight text-on-surface truncate">{m.name || 'Untitled meal'}</h3>
        <div className="flex flex-wrap items-center gap-x-1.5 mt-1 text-[12.5px] text-on-surface/55">
          <span>by {authorName}</span>
          {(m.prepTime || m.cookTime) && (
            <>
              <span className="text-on-surface/25">·</span>
              <span className="inline-flex items-center gap-1"><Clock size={10.5} /> {((m.prepTime || 0) + (m.cookTime || 0))} min</span>
            </>
          )}
          {m.difficulty && (
            <>
              <span className="text-on-surface/25">·</span>
              <span className="capitalize text-on-surface/50">{m.difficulty}</span>
            </>
          )}
        </div>
      </div>
    );
  };

  // Driving + walking legs for the detail view. Fetched lazily from the
  // Mapbox Directions API the first time a particular origin → place pair
  // is opened, then served from the module-level cache for the rest of
  // the session. The cache is keyed by rounded coords so different
  // markers in the same building don't each trigger their own request.
  const [routeLegs, setRouteLegs] = useState<{ driving: RouteLeg | null; walking: RouteLeg | null; loading: boolean } | null>(null);
  useEffect(() => {
    if (!isDesktopMapMode || !selectedPlace || !distanceOrigin || !MAPBOX_TOKEN) { setRouteLegs(null); return; }
    if (!Number.isFinite(selectedPlace.lat) || !Number.isFinite(selectedPlace.lng)) { setRouteLegs(null); return; }
    const origin = { lat: distanceOrigin.lat, lng: distanceOrigin.lng };
    const dest = { lat: selectedPlace.lat, lng: selectedPlace.lng };
    const dKey = routeKey('driving', origin, dest);
    const wKey = routeKey('walking', origin, dest);
    if (routeCache.has(dKey) && routeCache.has(wKey)) {
      setRouteLegs({ driving: routeCache.get(dKey) ?? null, walking: routeCache.get(wKey) ?? null, loading: false });
      return;
    }
    let cancelled = false;
    setRouteLegs({ driving: null, walking: null, loading: true });
    Promise.all([
      fetchMapboxLeg('driving', origin, dest, MAPBOX_TOKEN),
      fetchMapboxLeg('walking', origin, dest, MAPBOX_TOKEN),
    ]).then(([driving, walking]) => {
      if (cancelled) return;
      setRouteLegs({ driving, walking, loading: false });
    });
    return () => { cancelled = true; };
  }, [isDesktopMapMode, selectedPlace, distanceOrigin]);

  // Pretty "12 min" / "1 h 5 min" formatter for route durations.
  const formatRouteDuration = (seconds: number): string => {
    const m = Math.max(1, Math.round(seconds / 60));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem === 0 ? `${h} h` : `${h} h ${rem} min`;
  };

  // Inline detail view shown when a marker / list row is selected.
  // Inline detail view shown when a marker / list row is selected. The
  // map-page detail reuses the same RestaurantPanelBody that powers the
  // reel-tap restaurant pop-up, just with the map hero stripped out
  // (noHero) so it composes cleanly inside the results panel. The map
  // page's distance + driving + walking strip is injected as the
  // headSlot so it sits above the popup's standard action row.
  const renderPanelDetail = (place: PlaceResult) => {
    const { cuisine, price } = michCuisinePrice(place, getCuisineLabel(place.types), place.priceLevel > 0 ? priceLevelToString(place.priceLevel) : '');
    // Michelin distinction for the badge: dataset-sourced rows carry a synthetic
    // id (look up directly); real Google places match by name + coords.
    const michelin = michelinReady
      ? (isMichelinSyntheticId(place.id)
          ? michelinBySyntheticId(place.id)
          : findMichelinMatchSync(place.name, place.lat, place.lng, place.fullAddress || place.address))
      : null;
    const fav = isWishlisted(place.id);
    const restData = {
      id: place.id,
      name: place.name,
      image: place.photoUrl || '',
      cuisine,
      price,
      address: place.fullAddress || place.address || '',
      lat: place.lat ?? undefined,
      lng: place.lng ?? undefined,
    };
    const distMi = distanceOrigin && Number.isFinite(place.lat) && Number.isFinite(place.lng) && !(place.lat === 0 && place.lng === 0)
      ? haversineKm({ lat: place.lat, lng: place.lng }, distanceOrigin) * 0.621371
      : undefined;
    const snapshot: RestaurantPanelSnapshot = {
      id: place.id,
      name: place.name,
      cuisine,
      price,
      address: place.fullAddress || place.address || '',
      image: place.photoUrl || undefined,
      score: place.rating > 0 ? place.rating : undefined,
      distanceMi: distMi,
    };

    // Distance + driving + walking durations. Rendered as inline meta on
    // the title row rather than as a separate card so the top of the
    // panel reads as one tight header block.
    const dist = distanceFromAnchor(place.lat, place.lng);
    const driving = routeLegs?.driving;
    const walking = routeLegs?.walking;
    const routesLoading = routeLegs?.loading;

    const topChrome = (
      <div className="px-5 pt-4 pb-4">
        {/* Back arrow + wishlist heart. Heart is a soft circle that stays
            visible whether or not the place is saved (the fill carries
            the state). */}
        <div className="flex items-center justify-between gap-3">
          {isDesktopMapMode ? (
            <button
              type="button"
              onClick={closePanelDetail}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-on-surface/55 hover:text-on-surface transition-colors -ml-1 px-1 py-1 rounded-md"
            >
              <ChevronLeft size={14} />
              Back to {panelTitle}
            </button>
          ) : (
            <button
              type="button"
              onClick={closePanelDetail}
              aria-label="Close"
              className="w-9 h-9 -ml-1 rounded-full border border-on-surface/10 flex items-center justify-center text-on-surface/70 hover:bg-on-surface/[0.04] transition-colors"
            >
              <X size={16} />
            </button>
          )}
          <button
            type="button"
            onClick={() => toggleWishlist(restData)}
            aria-label={fav ? 'Remove from wishlist' : 'Save to wishlist'}
            aria-pressed={fav}
            className={cn(
              "w-9 h-9 rounded-full border flex items-center justify-center transition-colors flex-shrink-0",
              fav ? "border-red-200 bg-red-50/70 text-red-500" : "border-on-surface/10 hover:bg-on-surface/[0.04] text-on-surface/70",
            )}
            title={fav ? 'Saved' : 'Save'}
          >
            <Heart size={15} className={fav ? "fill-current" : ""} />
          </button>
        </div>

        {/* Single header block: name + a flowing meta row that carries
            cuisine, price, distance and the two route durations. */}
        <h1 className="font-serif font-bold text-[24px] leading-[1.15] tracking-tight text-on-surface mt-3">
          {place.name}
        </h1>
        {michelin && (
          <div className="mt-2">
            <MichelinBadge michelin={michelin} size="sm" href={michelin.guideUrl} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[12.5px] text-on-surface/65">
          {cuisine && <span className="font-semibold text-primary tracking-tight">{cuisine}</span>}
          {cuisine && price && <span className="text-on-surface/25">·</span>}
          {price && <span className="font-semibold tabular-nums">{price}</span>}
          {dist && (
            <>
              {(cuisine || price) && <span className="text-on-surface/25">·</span>}
              <span className="inline-flex items-center gap-1 tabular-nums">
                <MapPin size={11} className="text-on-surface/45" />
                {dist}
              </span>
            </>
          )}
          {driving && (
            <>
              <span className="text-on-surface/25">·</span>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Navigation size={11} className="text-on-surface/45" />
                {formatRouteDuration(driving.durationSeconds)} drive
              </span>
            </>
          )}
          {walking && (
            <>
              <span className="text-on-surface/25">·</span>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Footprints size={11} className="text-on-surface/45" />
                {formatRouteDuration(walking.durationSeconds)} walk
              </span>
            </>
          )}
          {routesLoading && !driving && !walking && (
            <>
              <span className="text-on-surface/25">·</span>
              <span className="inline-flex items-center gap-1 text-on-surface/45">
                <Loader2 size={11} className="animate-spin" />
              </span>
            </>
          )}
        </div>
      </div>
    );

    return (
      <div className="h-full flex flex-col">
        <RestaurantPanelBody
          snapshot={snapshot}
          onClose={closePanelDetail}
          currentUserId={userId}
          noHero
          topChrome={topChrome}
        />
      </div>
    );
  };

  const desktopPanel = isDesktopMapMode ? (
    <motion.aside
      initial={false}
      animate={{ width: mapPanelWidth }}
      transition={isResizingPanel ? { duration: 0 } : { type: 'spring', damping: 30, stiffness: 260, mass: 0.7 }}
      style={{ width: mapPanelWidth }}
      className="relative flex-shrink-0 h-screen bg-surface flex flex-col z-20"
      aria-label="Map results panel"
    >
      {/* === HEADER === */}
      {/* When a place is selected the title row + mode tabs + separator
          collapse so only the search bar remains. The detail view's
          own top chrome (back arrow, name, meta row) takes their place
          and everything beneath shifts up smoothly. */}
      <div className="flex-shrink-0">
        <AnimatePresence initial={false}>
          {!selectedPlace && (
            <motion.div
              key="panel-title-row"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
              className="overflow-hidden"
            >
              <div className="px-5 pt-5 pb-2 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="font-serif font-bold text-[20px] text-on-surface leading-tight truncate">
                    {panelTitle}
                  </h2>
                  <p className="text-[11.5px] font-medium text-on-surface/45 mt-0.5 tabular-nums">
                    {panelResultCount === 0 ? 'No results' : `${panelResultCount} ${panelResultCount === 1 ? 'result' : 'results'}`}
                    {activeFilterCount > 0 && <span> · {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}</span>}
                    {referenceLocation?.name && (
                      <span className="ml-1.5 inline-flex items-center gap-1 px-1.5 py-px rounded-md bg-primary/[0.08] text-primary text-[10px] font-bold uppercase tracking-wider align-middle">
                        <MapPin size={9} /> {referenceLocation.name.split(',')[0]}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFilterSheetOpen(true)}
                  className="relative w-10 h-10 rounded-full border border-on-surface/10 flex items-center justify-center flex-shrink-0 hover:bg-on-surface/[0.04] hover:border-on-surface/15 transition-colors"
                  aria-label="Filters"
                  title="Filters"
                >
                  <SlidersHorizontal size={15} className="text-on-surface/65" />
                  {activeFilterCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-surface">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Search bar — always visible. Its top padding animates so that
            with the title collapsed it lifts itself off the top edge of
            the panel by a comfortable amount. */}
        <motion.div
          className="px-5 pb-3"
          animate={{ paddingTop: selectedPlace ? 16 : 8 }}
          transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
        >
          <div className="relative">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface/40 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => {
                if (mapMode === 'discover') {
                  preSearchPlacesRef.current = places;
                  setDiscoverSearchActive(true);
                }
              }}
              placeholder={mapMode === 'discover' ? 'Search this area…' : 'Filter results…'}
              className="w-full pl-9 pr-9 py-2.5 rounded-full border border-on-surface/10 bg-on-surface/[0.025] text-[13px] font-medium placeholder:text-on-surface/35 focus:outline-none focus:border-primary/40 focus:bg-surface focus:ring-2 focus:ring-primary/10 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  if (mapMode === 'discover' && discoverSearchActive) {
                    setDiscoverSearchActive(false);
                    if (preSearchPlacesRef.current.length > 0) {
                      setPlaces(preSearchPlacesRef.current);
                      syncMarkersRef.current?.(preSearchPlacesRef.current);
                    }
                  }
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-on-surface/[0.08] flex items-center justify-center hover:bg-on-surface/[0.15] transition-colors"
                aria-label="Clear search"
              >
                <X size={11} className="text-on-surface/55" />
              </button>
            )}
          </div>
        </motion.div>

        <AnimatePresence initial={false}>
          {!selectedPlace && (
            <motion.div
              key="panel-mode-tabs"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
              className="overflow-hidden"
            >
              <div className="px-5 pb-4">
                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1">
                  {PANEL_MODE_TABS.map((m) => {
                    const active = mapMode === m.id;
                    const Icon = m.icon;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => { setMapMode(m.id); closePanelDetail(); }}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-bold transition-all whitespace-nowrap flex-shrink-0",
                          active
                            ? "bg-on-surface text-surface shadow-sm shadow-on-surface/15"
                            : "bg-on-surface/[0.04] text-on-surface/60 hover:bg-on-surface/[0.08] hover:text-on-surface/85",
                        )}
                      >
                        <Icon size={12.5} className={(m.id === 'experts' && active) ? "fill-current" : ""} />
                        <span>{m.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="h-px bg-gradient-to-r from-transparent via-on-surface/[0.07] to-transparent" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* === BODY === */}
      {/* List mode scrolls the outer wrapper; detail mode lets the
          embedded RestaurantPanelBody own its own scroll so the
          collapsible "Your rating" / hours / photos sections feel
          like the reel popup. */}
      <div className={cn("flex-1 min-h-0", !selectedPlace && "overflow-y-auto overscroll-contain")}>
        <AnimatePresence mode="wait" initial={false}>
          {selectedPlace ? (
            <motion.div
              key="detail"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="h-full flex flex-col"
            >
              {renderPanelDetail(selectedPlace)}
            </motion.div>
          ) : (
            <motion.div
              key={`list-${mapMode}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="pt-1 pb-10"
            >
              {panelResultCount === 0 ? (
                <div className="px-4 py-14 text-center">
                  <p className="text-[13px] text-on-surface/45 leading-snug">{panelEmptyMessage}</p>
                  {mapMode === 'discover' && !panelTextQ && !isSearching && (
                    <button
                      type="button"
                      onClick={() => { setReferenceLocation(null); fetchNearby(); }}
                      className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-primary hover:text-primary/80 transition-colors"
                    >
                      <RefreshCw size={12} /> Search this area
                    </button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-on-surface/[0.06]">
                  {mapMode === 'myratings' && panelMyRatings.map((r) => renderRatingCard(r))}
                  {mapMode === 'friends' && panelFriendRatings.map((r) => {
                    const prof = friendProfiles[r.user_id];
                    const name = prof?.display_name || 'Friend';
                    const initial = name.charAt(0).toUpperCase();
                    return renderRatingCard(r, {
                      extra: (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span className="w-4 h-4 rounded-full bg-primary/10 text-[8.5px] font-bold text-primary flex items-center justify-center flex-shrink-0">{initial}</span>
                          <span className="text-[11.5px] text-on-surface/55 truncate">{name}</span>
                        </div>
                      ),
                    });
                  })}
                  {mapMode === 'experts' && panelExpertRatings.map((r) => {
                    const expProf = expertProfiles[r.user_id];
                    const expName = expProf?.display_name || 'Expert';
                    return renderRatingCard(r, {
                      extra: (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <Star size={10} className="fill-amber-500 text-amber-500 flex-shrink-0" />
                          <span className="text-[11.5px] font-semibold text-amber-700 truncate">{expName}</span>
                        </div>
                      ),
                    });
                  })}
                  {mapMode === 'hotels' && panelHotelPlaces.map((p) => renderHotelCard(p))}
                  {mapMode === 'discover' && panelDiscoverPlaces.map((p) => renderPlaceCard(p))}
                  {mapMode === 'recipes' && panelRecipes.map((m) => renderRecipeCard(m))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* === Resize handle (right edge) === */}
      <button
        type="button"
        onPointerDown={startPanelResize}
        aria-label="Resize results panel"
        title="Drag to resize"
        className="group absolute top-0 right-0 h-full w-2 cursor-col-resize z-30 flex items-center justify-center"
        style={{ touchAction: 'none' }}
      >
        <span
          className={cn(
            "block w-px h-full bg-on-surface/[0.07] transition-colors",
            "group-hover:bg-primary/40",
            isResizingPanel && "bg-primary/70",
          )}
        />
        <span
          className={cn(
            "absolute h-14 w-1 rounded-full bg-on-surface/15 transition-all duration-200",
            "group-hover:bg-primary/60 group-hover:h-20 group-hover:w-1.5",
            isResizingPanel && "bg-primary h-24 w-1.5 shadow-lg shadow-primary/30",
          )}
        />
      </button>
    </motion.aside>
  ) : null;

  // Mobile Discover header content — shared by the in-flow (tablet) header and
  // the phone scroll-driven overlay.
  const mobileHeaderNode = (
    <>
      <TopBar
        title="Home"
        centerLogo={phoneMode}
        leftAction={phoneMode ? (
          <button
            type="button"
            onClick={() => navigate('/create')}
            aria-label="Create"
            className="w-10 h-10 rounded-full bg-on-surface/5 hover:bg-on-surface/10 flex items-center justify-center text-on-surface/80 transition-colors"
          >
            <Plus size={20} />
          </button>
        ) : undefined}
      />
      <div className={cn("flex items-center gap-3 flex-shrink-0", phoneMode ? "px-3 pt-2 pb-2" : "px-6 pt-2 pb-3")}>
        <button
          type="button"
          onClick={() => navigate('/search/main')}
          className="flex-1 relative"
          aria-label="Open search"
        >
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/40" />
          <div className="w-full bg-on-surface/[0.04] rounded-full py-3 pl-11 pr-10 text-sm font-medium text-on-surface/40 text-left">
            Search restaurants, cuisines...
          </div>
        </button>
      </div>
    </>
  );

  // The immersed mini cluster — only the key actions, on frosted circles with
  // no header bar, that slides back in on scroll-up.
  const miniIconBtn = "w-10 h-10 rounded-full bg-surface/65 backdrop-blur-md shadow-[0_2px_8px_rgba(0,0,0,0.12)] flex items-center justify-center text-on-surface/85 active:scale-90 transition-transform";
  const miniHeaderNode = (
    <div className="flex items-center justify-between px-3 pt-safe-3 pb-2">
      <button type="button" onClick={() => navigate('/create')} aria-label="Create" className={miniIconBtn}>
        <Plus size={20} />
      </button>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => navigate('/search/main')} aria-label="Search" className={miniIconBtn}>
          <Search size={20} />
        </button>
        <button type="button" onClick={() => navigate('/messages')} aria-label="Messages" className={miniIconBtn}>
          <MessageCircle size={20} />
        </button>
        <button type="button" onClick={() => navigate('/circle')} aria-label="Your Circle" className={miniIconBtn}>
          <Heart size={20} />
        </button>
      </div>
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative h-screen w-full overflow-hidden bg-muted",
        // Desktop map mode lays out as a horizontal flex row so the new
        // results sidebar takes the left strip and the map fills the rest.
        isDesktopMapMode && "flex",
      )}
    >
      {/* Desktop map results sidebar — draggable width, replaces the
          bottom sheet pop-up on wide viewports. */}
      {desktopPanel}
      {/* On desktop the map + floating chrome live inside an inner
          flex-1 column so they sit beside the sidebar; on mobile the
          inner div collapses (`display:contents`) so absolute children
          still position against the page wrapper as before. */}
      <div className={isDesktopMapMode ? "relative flex-1 min-w-0 h-full overflow-hidden" : "contents"}>
      {/* Real Mapbox Map — rendered only when this is the Map page */}
      {mode !== 'home' && (
        <div ref={mapContainerRef} className="absolute inset-0" style={{ width: '100%', height: '100%' }} />
      )}

      {/* Map page (mobile): no top bar, no nav bar — just a back arrow on
          the left, vertically aligned with the centered "Search this area"
          pill. Clears the iPhone status-bar safe area. */}
      {mode === 'map' && !usingDesktopHeader && (
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="absolute top-[calc(env(safe-area-inset-top)+0.625rem)] left-4 z-40 w-11 h-11 rounded-full bg-white shadow-md border border-on-surface/[0.06] flex items-center justify-center text-on-surface active:scale-95 transition-transform"
        >
          <ChevronLeft size={20} />
        </button>
      )}

      {/* Search this area button — floating pill, appears instantly on pan-end */}
      <AnimatePresence>
        {showSearchHere && (mapMode === 'discover' || mapMode === 'hotels') && (
          <motion.button
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ type: 'spring', damping: 26, stiffness: 380 }}
            onClick={() => { setShowSearchHere(false); setReferenceLocation(null); mapMode === 'hotels' ? fetchHotels() : fetchNearby(); }}
            className="absolute top-[calc(env(safe-area-inset-top)+0.625rem)] left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-white shadow-md rounded-full px-4 py-2.5 text-sm font-semibold text-on-surface hover:shadow-lg transition-shadow"
          >
            <Search size={15} className={mapMode === 'hotels' ? "text-teal-600" : "text-primary"} />
            Search this area
          </motion.button>
        )}
      </AnimatePresence>

      {/* Floating Action Buttons + Location Search — only on the Map page.
          Positioned to clear the iOS status-bar / Dynamic Island safe area
          and sit just below the back-arrow / search-this-area row. */}
      {mode !== 'home' && (
      <div className="absolute right-6 top-[calc(env(safe-area-inset-top)+4rem)] flex flex-col gap-3 z-30 items-end">
        {/* Location Search */}
        <AnimatePresence>
          {locationSearchOpen ? (
            <motion.div
              initial={{ width: 40, opacity: 0.8 }}
              animate={{ width: phoneMode ? 260 : 320, opacity: 1 }}
              exit={{ width: 40, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-white rounded-2xl shadow-xl border border-on-surface/10 overflow-hidden"
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <MapPin size={16} className="text-primary flex-shrink-0" />
                <input
                  ref={locationInputRef}
                  type="text"
                  value={locationQuery}
                  onChange={(e) => setLocationQuery(e.target.value)}
                  placeholder="Search location..."
                  autoFocus
                  className="flex-1 text-sm font-medium bg-transparent outline-none placeholder:text-on-surface/30"
                />
                <button onClick={() => { setLocationSearchOpen(false); setLocationQuery(''); setLocationResults([]); }}
                  className="w-7 h-7 rounded-full bg-on-surface/5 flex items-center justify-center flex-shrink-0 hover:bg-on-surface/10 transition-colors">
                  <X size={14} className="text-on-surface/40" />
                </button>
              </div>
              {(locationResults.length > 0 || locationLoading) && (
                <div className="border-t border-on-surface/6 max-h-48 overflow-y-auto">
                  {locationLoading && locationResults.length === 0 ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 size={16} className="text-primary animate-spin" />
                    </div>
                  ) : (
                    locationResults.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => handleSelectLocation(r.name, r.lat, r.lng)}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-on-surface/3 transition-colors text-left"
                      >
                        <MapPin size={13} className="text-on-surface/30 flex-shrink-0" />
                        <span className="text-xs text-on-surface/70 truncate">{r.name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={() => { setLocationSearchOpen(true); setTimeout(() => locationInputRef.current?.focus(), 100); }}
              className="w-12 h-12 glass rounded-full flex items-center justify-center shadow-xl text-on-surface/60 hover:text-primary transition-colors"
            >
              <MapPin size={18} />
            </motion.button>
          )}
        </AnimatePresence>
        <button
          onClick={() => {
            if (navigator.geolocation) {
              navigator.geolocation.getCurrentPosition((pos) => {
                const lngLat: [number, number] = [pos.coords.longitude, pos.coords.latitude];

                // Create or update user location marker
                if (userMarkerRef.current) {
                  userMarkerRef.current.setLngLat(lngLat);
                } else if (mapRef.current) {
                  const el = document.createElement('div');
                  el.innerHTML = `
                    <div style="position:relative;width:20px;height:20px;">
                      <div style="position:absolute;inset:0;border-radius:50%;background:rgba(59,130,246,0.25);animation:user-pulse 2s ease-out infinite;"></div>
                      <div style="position:absolute;inset:4px;border-radius:50%;background:#3B82F6;border:2.5px solid white;box-shadow:0 2px 8px rgba(59,130,246,0.5);"></div>
                    </div>
                  `;
                  userMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
                    .setLngLat(lngLat)
                    .addTo(mapRef.current);
                }

                mapRef.current?.flyTo({
                  center: lngLat,
                  zoom: 14,
                  duration: 1500,
                });
              });
            }
          }}
          className="w-12 h-12 glass rounded-full flex items-center justify-center shadow-xl text-on-surface/60 hover:text-primary transition-colors"
        >
          <Navigation size={20} />
        </button>
        <div className="relative">
          <button
            onClick={() => setShowStylePicker(!showStylePicker)}
            className={cn(
              "w-12 h-12 glass rounded-full flex items-center justify-center shadow-xl transition-colors",
              showStylePicker ? "text-primary" : "text-on-surface/60 hover:text-primary"
            )}
          >
            {showStylePicker ? <X size={20} /> : <Layers size={20} />}
          </button>
          {showStylePicker && (
            <motion.div
              initial={{ opacity: 0, scale: 0.85, x: 10 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="absolute right-0 top-14 glass rounded-2xl shadow-2xl border border-white/20 p-2 flex flex-col gap-1 min-w-[140px]"
            >
              {MAP_STYLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    if (mapRef.current && s.id !== activeStyle) {
                      mapRef.current.setStyle(s.style);
                      setActiveStyle(s.id);
                      // Re-add 3D buildings after style loads if 3D is active
                      if (is3D) {
                        mapRef.current.once('style.load', () => {
                          const map = mapRef.current;
                          if (!map || map.getLayer('3d-buildings')) return;
                          const layers = map.getStyle().layers || [];
                          const labelLayer = layers.find((l: any) => l.type === 'symbol' && l.layout?.['text-field']);
                          map.addLayer({
                            id: '3d-buildings',
                            source: 'composite',
                            'source-layer': 'building',
                            filter: ['==', 'extrude', 'true'],
                            type: 'fill-extrusion',
                            minzoom: 12,
                            paint: {
                              'fill-extrusion-color': '#c4b5a2',
                              'fill-extrusion-height': ['get', 'height'],
                              'fill-extrusion-base': ['get', 'min_height'],
                              'fill-extrusion-opacity': 0.7,
                            },
                          }, labelLayer?.id);
                        });
                      }
                    }
                    setShowStylePicker(false);
                  }}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 rounded-xl text-left transition-colors whitespace-nowrap",
                    activeStyle === s.id
                      ? "bg-primary/10 text-primary"
                      : "text-on-surface/70 hover:bg-on-surface/5"
                  )}
                >
                  <span className={cn(
                    "w-2 h-2 rounded-full flex-shrink-0",
                    activeStyle === s.id ? "bg-primary" : "bg-on-surface/20"
                  )} />
                  <span className="text-xs font-bold uppercase tracking-wider">{s.label}</span>
                </button>
              ))}
            </motion.div>
          )}
        </div>
      </div>
      )}

      {/* Filter Sheet — shared design (matches the Location page), context-aware per map mode */}
      <FilterSheetShell
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="Filters"
        onReset={() => {
          setHoursFilter(emptyHoursFilter());
          if (mapMode === 'discover') {
            setSortBy('popularity'); setSelectedCuisines([]); setSelectedPrice(0); setDiscoverRadius(5); setSelectedMichelin([]);
          } else if (mapMode === 'hotels') {
            setHotelStarFilter(0); setHotelPriceFilter(0); setHotelSortBy('popularity');
          } else {
            setRatingSortBy('recent'); setScoreRange([0, 10]); setRatingCuisines([]); setRatingPrice(null); setRatingCities([]); setSelectedMichelin([]);
            if (mapMode === 'friends') setSelectedFriendIds(new Set());
            if (mapMode === 'myratings') setSelectedListId(null);
          }
        }}
        onApply={() => {
          setFilterSheetOpen(false);
          if (mapMode === 'discover') fetchNearby(selectedCuisines);
        }}
      >
        {/* ─── DISCOVER ─── */}
        {mapMode === 'discover' && (
          <>
            <FilterSection label="Sort by">
              <PillRow>
                {SORT_OPTIONS.map((opt) => (
                  <Pill key={opt.value} active={sortBy === opt.value} onClick={() => setSortBy(opt.value)}>{opt.label}</Pill>
                ))}
              </PillRow>
            </FilterSection>
            <FilterSection label="Price">
              <Segment>
                {PRICE_LEVELS.map((p) => (
                  <SegmentItem key={p.value} active={selectedPrice === p.value} onClick={() => setSelectedPrice(p.value)}>{p.label}</SegmentItem>
                ))}
              </Segment>
            </FilterSection>
            <HoursFilterSection value={hoursFilter} onChange={setHoursFilter} />
            <FilterSection label="Michelin" sub="Show only restaurants in the Michelin Guide.">
              <MichelinDistinctionFilter selected={selectedMichelin} onToggle={toggleMichelin} />
            </FilterSection>
            <FilterSection label="Cuisine">
              <FilterDropdown
                options={CUISINE_TYPES.filter((c) => c.type !== '').map((c) => ({ value: c.type, label: c.label }))}
                selected={selectedCuisines}
                onToggle={(t) => setSelectedCuisines((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])}
                placeholder="All cuisines"
                searchPlaceholder="Search cuisines"
              />
            </FilterSection>
          </>
        )}

        {/* ─── MY RATINGS ─── */}
        {mapMode === 'myratings' && (
          <>
            <FilterSection label="Sort by">
              <PillRow>
                {([['recent', 'Recent'], ['highest', 'Highest Score'], ['lowest', 'Lowest Score'], ['visited', 'Date Visited']] as const).map(([key, label]) => (
                  <Pill key={key} active={ratingSortBy === key} onClick={() => setRatingSortBy(key)}>{label}</Pill>
                ))}
              </PillRow>
            </FilterSection>
            <FilterSection label="Score" value={`${scoreRange[0]} – ${scoreRange[1]}`} isSet={scoreRange[0] > 0 || scoreRange[1] < 10}>
              <RangeSlider min={0} max={10} step={0.5} value={scoreRange} onChange={setScoreRange} ariaLabelMin="Minimum score" ariaLabelMax="Maximum score" />
              <div className="fs-slider-range"><span>0</span><span>10</span></div>
            </FilterSection>
            <FilterSection label="Price">
              <Segment>
                <SegmentItem active={ratingPrice === null} onClick={() => setRatingPrice(null)}>Any</SegmentItem>
                {['$', '$$', '$$$', '$$$$'].map((p) => (
                  <SegmentItem key={p} active={ratingPrice === p} onClick={() => setRatingPrice(ratingPrice === p ? null : p)}>{p}</SegmentItem>
                ))}
              </Segment>
            </FilterSection>
            <HoursFilterSection value={hoursFilter} onChange={setHoursFilter} />
            <FilterSection label="Michelin" sub="Show only restaurants in the Michelin Guide.">
              <MichelinDistinctionFilter selected={selectedMichelin} onToggle={toggleMichelin} />
            </FilterSection>
            <FilterSection label="Cuisine">
              <FilterDropdown
                options={uniqueMyRatingCuisines.map((c) => ({ value: c, label: c }))}
                selected={ratingCuisines}
                onToggle={(v) => setRatingCuisines((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])}
                placeholder="All cuisines"
                searchPlaceholder="Search cuisines"
              />
            </FilterSection>
            {uniqueMyRatingCities.length > 0 && (
              <FilterSection label="City / Location">
                <FilterDropdown
                  options={uniqueMyRatingCities.map((c) => ({ value: c, label: c }))}
                  selected={ratingCities}
                  onToggle={(v) => setRatingCities((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])}
                  placeholder="All locations"
                  searchPlaceholder="Search locations"
                />
              </FilterSection>
            )}
            {myLists.filter((l: any) => l.restaurantIds?.length > 0).length > 0 && (
              <FilterSection label="List">
                <PillRow>
                  <Pill active={!selectedListId} onClick={() => setSelectedListId(null)}>All Ratings</Pill>
                  {myLists.filter((l: any) => l.restaurantIds?.length > 0).map((l: any) => (
                    <Pill key={l.id} active={selectedListId === l.id} onClick={() => setSelectedListId(selectedListId === l.id ? null : l.id)}>{l.emoji} {l.name}</Pill>
                  ))}
                </PillRow>
              </FilterSection>
            )}
          </>
        )}

        {/* ─── FRIENDS ─── */}
        {mapMode === 'friends' && (
          <>
            {Object.keys(friendProfiles).length > 0 && (
              <FilterSection label="Filter by friend">
                <FilterDropdown
                  options={Object.values(friendProfiles).map((p: UserProfile) => ({ value: p.user_id, label: p.display_name || `@${p.username}` }))}
                  selected={Array.from(selectedFriendIds)}
                  onToggle={(id) => setSelectedFriendIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; })}
                  searchable={Object.keys(friendProfiles).length > 5}
                  placeholder="All friends"
                  searchPlaceholder="Search friends"
                />
              </FilterSection>
            )}
            <FilterSection label="Sort by">
              <PillRow>
                {([['recent', 'Recent'], ['highest', 'Highest Score'], ['lowest', 'Lowest Score']] as const).map(([key, label]) => (
                  <Pill key={key} active={ratingSortBy === key} onClick={() => setRatingSortBy(key)}>{label}</Pill>
                ))}
              </PillRow>
            </FilterSection>
            <FilterSection label="Score" value={`${scoreRange[0]} – ${scoreRange[1]}`} isSet={scoreRange[0] > 0 || scoreRange[1] < 10}>
              <RangeSlider min={0} max={10} step={0.5} value={scoreRange} onChange={setScoreRange} ariaLabelMin="Minimum score" ariaLabelMax="Maximum score" />
              <div className="fs-slider-range"><span>0</span><span>10</span></div>
            </FilterSection>
            <FilterSection label="Cuisine">
              <FilterDropdown
                options={uniqueFriendCuisines.map((c) => ({ value: c, label: c }))}
                selected={ratingCuisines}
                onToggle={(v) => setRatingCuisines((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])}
                placeholder="All cuisines"
                searchPlaceholder="Search cuisines"
              />
            </FilterSection>
            <HoursFilterSection value={hoursFilter} onChange={setHoursFilter} />
          </>
        )}

        {/* ─── EXPERTS ─── */}
        {mapMode === 'experts' && (
          <>
            <FilterSection label="Sort by">
              <PillRow>
                {([['recent', 'Recent'], ['highest', 'Highest Score']] as const).map(([key, label]) => (
                  <Pill key={key} active={ratingSortBy === key} onClick={() => setRatingSortBy(key)}>{label}</Pill>
                ))}
              </PillRow>
            </FilterSection>
            <FilterSection label="Score" value={`${scoreRange[0]} – ${scoreRange[1]}`} isSet={scoreRange[0] > 0 || scoreRange[1] < 10}>
              <RangeSlider min={0} max={10} step={0.5} value={scoreRange} onChange={setScoreRange} ariaLabelMin="Minimum score" ariaLabelMax="Maximum score" />
              <div className="fs-slider-range"><span>0</span><span>10</span></div>
            </FilterSection>
            <FilterSection label="Cuisine">
              <FilterDropdown
                options={uniqueExpertCuisines.map((c) => ({ value: c, label: c }))}
                selected={ratingCuisines}
                onToggle={(v) => setRatingCuisines((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])}
                placeholder="All cuisines"
                searchPlaceholder="Search cuisines"
              />
            </FilterSection>
          </>
        )}

        {/* ─── HOTELS ─── */}
        {mapMode === 'hotels' && (
          <>
            <FilterSection label="Hotel star rating">
              <Segment tone="teal">
                {[{ v: 0, l: 'Any' }, { v: 3, l: '3★+' }, { v: 4, l: '4★+' }, { v: 5, l: '5★' }].map(({ v, l }) => (
                  <SegmentItem key={v} active={hotelStarFilter === v} onClick={() => setHotelStarFilter(v)}>{l}</SegmentItem>
                ))}
              </Segment>
            </FilterSection>
            <FilterSection label="Price">
              <Segment tone="teal">
                {PRICE_LEVELS.map((p) => (
                  <SegmentItem key={p.value} active={hotelPriceFilter === p.value} onClick={() => setHotelPriceFilter(p.value)}>{p.label}</SegmentItem>
                ))}
              </Segment>
            </FilterSection>
            <FilterSection label="Sort by">
              <PillRow>
                {([['popularity', 'Most Popular'], ['rating', 'Highest Rated'], ['price_low', 'Price: Low to High']] as const).map(([key, label]) => (
                  <Pill key={key} tone="teal" active={hotelSortBy === key} onClick={() => setHotelSortBy(key as any)}>{label}</Pill>
                ))}
              </PillRow>
            </FilterSection>
          </>
        )}
      </FilterSheetShell>

      {/* Selected place detail — mobile slide-up sheet that reuses the very
          same RestaurantPanel detail the desktop map shows on marker tap, so
          tapping a marker or a result card opens this panel instead of
          navigating to the full restaurant page. */}
      <AnimatePresence>
        {selectedPlace && mode === 'map' && !isDesktopMapMode && (
          <motion.div
            key="map-detail-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 z-[60] bg-black/45 backdrop-blur-sm"
            onClick={closePanelDetail}
          />
        )}
        {selectedPlace && mode === 'map' && !isDesktopMapMode && (
          <motion.div
            key="map-detail-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320, mass: 0.9 }}
            {...detailDragProps}
            className="absolute left-0 right-0 bottom-0 z-[61] bg-surface rounded-t-[1.75rem] overflow-hidden flex flex-col ring-1 ring-on-surface/[0.08] shadow-[0_-20px_60px_rgba(0,0,0,0.22)]"
            style={{ height: '92%' }}
          >
            {/* Grab strip — swipe down anywhere on it to dismiss the sheet. */}
            <div
              className="flex justify-center pt-2.5 pb-1.5 flex-shrink-0 cursor-grab active:cursor-grabbing"
              style={{ touchAction: 'none' }}
              onPointerDown={startDetailDrag}
            >
              <div className="w-10 h-1.5 rounded-full bg-on-surface/15" />
            </div>
            <div className="flex-1 min-h-0">
              {renderPanelDetail(selectedPlace)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Sheet — tri-state: peek / half / full. Desktop map mode
          replaces this with the left-side panel rendered above; on every
          other surface (home page on any width, map page on phone / phone
          frame preview) the bottom sheet still owns the chrome. */}
      {!isDesktopMapMode && (
      <motion.div
        ref={sheetRef}
        style={{ y: sheetY, height: FULL_HEIGHT }}
        className={cn(
          // NB: the white top hairline (frosted-glass edge) is applied only to
          // the glass sheet states below — NOT the home full state. On the home
          // page the sheet is full-height bg-surface, so a `border-white/40`
          // there rendered as a stray grayish line across the very top in dark
          // mode (only `bg-white`, not `border-white`, is remapped to the dark
          // paper token).
          "absolute bottom-0 left-0 right-0 shadow-[0_-20px_50px_rgba(0,0,0,0.1)] z-40 flex flex-col will-change-transform",
          sheetState === 'full'
            ? (mode === 'home' ? "bg-surface rounded-t-none" : "glass rounded-t-none border-t border-white/40")
            : "glass rounded-t-[3rem] border-t border-white/40"
        )}
      >
        {/* Handle — only this area is draggable (hidden in full state) */}
        {sheetState !== 'full' && (
        <div
          className="w-full flex flex-col items-center pt-4 pb-4 cursor-grab active:cursor-grabbing flex-shrink-0"
          style={{ touchAction: 'none' }}
          onClick={() => {
            if (Math.abs(dragCurrentYRef.current) < 5) {
              // In map mode the sheet is always half or peek (never full)
              setSheetState(sheetState === 'peek' ? 'half' : 'peek');
            }
          }}
          onTouchStart={(e) => {
            dragStartYRef.current = e.touches[0].clientY;
            dragCurrentYRef.current = 0;
            isDraggingRef.current = true;
          }}
          onTouchMove={(e) => {
            if (!isDraggingRef.current) return;
            const delta = e.touches[0].clientY - dragStartYRef.current;
            dragCurrentYRef.current = delta;
            const baseY = getSheetY(sheetState);
            const minY = mode === 'map' ? getSheetY('half') : 0;
            const clamped = Math.max(minY, Math.min(FULL_HEIGHT - PEEK_HEIGHT, baseY + delta));
            sheetY.set(clamped);
          }}
          onTouchEnd={() => {
            if (!isDraggingRef.current) return;
            isDraggingRef.current = false;
            const delta = dragCurrentYRef.current;
            let next = sheetState;
            if (sheetState === 'half') {
              if (delta > 60) next = 'peek';
              else if (delta < -60 && mode !== 'map') {
                if (!searchQuery.trim()) { setDiscoverSearchActive(false); setShowSearchInput(false); }
                next = 'full';
              }
            } else {
              if (delta < -50) next = 'half';
            }
            setSheetState(next);
            // Spring from the dragged position to the resolved snap (also covers
            // the "no state change" case, which the state effect wouldn't fire).
            animate(sheetY, getSheetY(next), SHEET_SPRING);
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            dragStartYRef.current = e.clientY;
            dragCurrentYRef.current = 0;
            isDraggingRef.current = true;
            const onMouseMove = (ev: MouseEvent) => {
              if (!isDraggingRef.current) return;
              const delta = ev.clientY - dragStartYRef.current;
              dragCurrentYRef.current = delta;
              const baseY = getSheetY(sheetState);
              const minY = mode === 'map' ? getSheetY('half') : 0;
              const clamped = Math.max(minY, Math.min(FULL_HEIGHT - PEEK_HEIGHT, baseY + delta));
              sheetY.set(clamped);
            };
            const onMouseUp = () => {
              isDraggingRef.current = false;
              const delta = dragCurrentYRef.current;
              let next = sheetState;
              if (sheetState === 'half') {
                if (delta > 60) next = 'peek';
                else if (delta < -60 && mode !== 'map') {
                  if (!searchQuery.trim()) { setDiscoverSearchActive(false); setShowSearchInput(false); }
                  next = 'full';
                }
              } else {
                if (delta < -50) next = 'half';
              }
              setSheetState(next);
              animate(sheetY, getSheetY(next), SHEET_SPRING);
              window.removeEventListener('mousemove', onMouseMove);
              window.removeEventListener('mouseup', onMouseUp);
            };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
          }}
        >
          {sheetState === 'half' && mode !== 'map' ? (
            <button
              onClick={(e) => { e.stopPropagation(); if (!searchQuery.trim()) { setDiscoverSearchActive(false); setShowSearchInput(false); } setSheetState('full'); }}
              className="w-10 h-10 rounded-full bg-on-surface/5 flex items-center justify-center hover:bg-on-surface/10 transition-colors"
            >
              <ChevronsUp size={20} className="text-on-surface/50" />
            </button>
          ) : (
            <div className="w-12 h-1.5 bg-on-surface/10 rounded-full" />
          )}
        </div>
        )}

        {/* ══════ FULL STATE — full-screen discover page (Home) ══════ */}
        {sheetState === 'full' && (
          <div className="flex-1 flex flex-col overflow-hidden relative">
            {/* Header. On desktop the global DesktopHeader owns it. On narrow
                non-phone it sits statically in flow. On phone it becomes a
                scroll-driven overlay: the full bar at the top, and an immersed
                mini cluster that returns on scroll-up. */}
            {!usingDesktopHeader && !phoneMode && mobileHeaderNode}

            {phoneMode && (
              <>
                <motion.div
                  ref={homeHeaderRef}
                  className="absolute top-0 inset-x-0 z-40"
                  style={{ opacity: headerOpacity, y: headerY, pointerEvents: headerPE }}
                >
                  {mobileHeaderNode}
                </motion.div>
                <motion.div
                  className="absolute top-0 inset-x-0 z-50"
                  style={{ opacity: miniOpacity, y: miniY, pointerEvents: miniPE }}
                >
                  {miniHeaderNode}
                </motion.div>
              </>
            )}

            {/* Full discover content — scrollable */}
            <div
              ref={homeScrollRef}
              onScroll={phoneMode ? handleHomeScroll : undefined}
              className={cn("flex-1 overflow-y-auto overflow-x-hidden overscroll-x-none pb-32", phoneMode ? "px-3" : "px-6")}
              style={phoneMode ? { paddingTop: homeHeaderH } : undefined}
            >

              {/* Search results in full state */}
              {discoverSearchActive && (
                <div className="mt-4">
                  {isSearching ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 size={24} className="text-primary animate-spin" />
                      <span className="ml-3 text-sm text-on-surface/50 font-medium">Searching restaurants...</span>
                    </div>
                  ) : !searchQuery.trim() ? (
                    recentViews.length > 0 ? (
                      <section className="pt-2">
                        <div className="flex items-center gap-2 mb-3">
                          <Clock size={15} className="text-on-surface/35" />
                          <h3 className="text-sm font-bold text-on-surface/60 uppercase tracking-wider">Recently Viewed</h3>
                        </div>
                        <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar -mx-1 px-1 snap-x snap-mandatory">
                          {recentViews.slice(0, 8).map((place) => (
                            <div key={place.id} className="flex-shrink-0 w-32 relative group snap-start">
                              <button
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeRecentView(place.id); }}
                                className="absolute top-1 right-1 z-10 w-5 h-5 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X size={10} className="text-white" />
                              </button>
                              <Link to={`/restaurant/${place.id}`}>
                                <div className="w-32 h-24 rounded-xl overflow-hidden mb-1.5 bg-muted">
                                  {place.image ? (
                                    <img src={place.image} alt={place.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" referrerPolicy="no-referrer" />
                                  ) : (place as any).photoUrl ? (
                                    <img src={(place as any).photoUrl} alt={place.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" referrerPolicy="no-referrer" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-on-surface/5 text-on-surface/20 font-serif text-xl font-bold">{place.name.charAt(0)}</div>
                                  )}
                                </div>
                                <p className="text-xs font-semibold truncate leading-tight">{place.name}</p>
                                {place.rating > 0 && (
                                  <div className="flex items-center gap-0.5 mt-0.5">
                                    <Star size={10} className="fill-primary text-primary" />
                                    <span className="text-[10px] font-bold text-primary">{place.rating.toFixed(1)}</span>
                                  </div>
                                )}
                              </Link>
                            </div>
                          ))}
                        </div>
                      </section>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <Search size={32} className="text-on-surface/15 mb-3" />
                        <p className="text-sm font-medium text-on-surface/40">Search restaurants</p>
                        <p className="text-xs text-on-surface/30 mt-1">Type a name, cuisine, or occasion</p>
                      </div>
                    )
                  ) : places.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <MapPinned size={32} className="text-on-surface/20 mb-3" />
                      <p className="text-sm text-on-surface/40 font-medium">No results found</p>
                      <p className="text-xs text-on-surface/30 mt-1">Try a different search</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-serif font-bold">Results</h2>
                        <span className="text-on-surface/40 text-xs font-bold uppercase tracking-widest">{places.length} found</span>
                      </div>
                      <div className={cn("grid gap-3", phoneMode ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4")}>
                        {places.map((place) => {
                          const props = placeToCardProps(place);
                          return (
                            <RestaurantCard key={place.id} {...props}
                              isWishlisted={isWishlisted(place.id)}
                              onAdd={() => openAddRestaurantModal({
                                id: place.id, name: place.name, image: props.image,
                                cuisine: props.cuisine, price: props.price, address: place.fullAddress || place.address,
                              })}
                              onHeart={() => toggleWishlist({
                                id: place.id, name: place.name, image: props.image,
                                cuisine: props.cuisine, price: props.price, address: place.fullAddress || place.address,
                              })}
                            />
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Feed content — hidden when searching.
                  Desktop renders a personalized greeting hero with a
                  featured restaurant card alongside; phone shows the
                  compact stacked "DINING IN" block. */}
              {!discoverSearchActive && mode === 'home' && usingDesktopHeader && (() => {
                const greetingPart = getGreetingPart();
                const dayName = HERO_DAY_NAMES[new Date().getDay()];
                const neighborhood = homeLocation?.label?.split(',')[0]?.trim() || '';
                const firstName = (profile?.display_name || profile?.username || (user?.email || '').split('@')[0] || 'there')
                  .split(' ')[0]
                  .split('@')[0];
                // Spare editorial greeting — eyebrow (day · neighborhood) + serif
                // greeting. The page leads straight into Recommended below; the
                // stats and Editor's Pick were intentionally removed to declutter.
                return (
                  <section className="pt-8 pb-1">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
                      {dayName}{neighborhood && (
                        <>
                          <span className="text-on-surface/25 font-bold"> · </span>
                          <button
                            type="button"
                            onClick={() =>
                              navigate(
                                `/location?label=${encodeURIComponent(homeLocation!.label)}&lat=${homeLocation!.lat}&lng=${homeLocation!.lng}`,
                              )
                            }
                            className="hover:underline underline-offset-4"
                          >
                            {neighborhood}
                          </button>
                        </>
                      )}
                    </p>
                    <h1 className="mt-3 font-serif font-semibold text-on-surface text-[44px] xl:text-[52px] leading-[1.0] tracking-[-0.03em]">
                      Good {greetingPart},{' '}
                      <span className="font-serif italic font-medium text-primary">{firstName}</span>
                    </h1>
                  </section>
                );
              })()}
              {!discoverSearchActive && mode === 'home' && !usingDesktopHeader && (() => {
                const greetingPart = getGreetingPart();
                const dayName = HERO_DAY_NAMES[new Date().getDay()];
                const neighborhood = homeLocation?.label?.split(',')[0]?.trim() || '';
                const firstName = (profile?.display_name || profile?.username || (user?.email || '').split('@')[0] || 'there')
                  .split(' ')[0]
                  .split('@')[0];
                // Spare greeting on mobile too — eyebrow + serif greeting, then
                // the section chips. The Open Now / Friends Out / Tonight cards
                // were intentionally removed to declutter the header.
                return (
                  <>
                    <section className="mt-3">
                      <p ref={dayLocRef} className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary flex items-center gap-1">
                        <span>{dayName}</span>
                        <span className="text-on-surface/30 font-bold">·</span>
                        <button
                          type="button"
                          onClick={() => setMobileLocationPickerOpen(true)}
                          className="inline-flex items-center gap-1 hover:underline underline-offset-4"
                        >
                          {neighborhood || 'Pick a location'}
                          <ChevronDown size={11} strokeWidth={2.5} className="text-primary/70" />
                        </button>
                      </p>
                      <h1 className="mt-2 font-serif font-semibold text-on-surface text-[32px] leading-[1.05] tracking-[-0.02em]">
                        Good {greetingPart},{' '}
                        <span className="font-serif italic font-medium text-primary">{firstName}</span>
                      </h1>
                    </section>

                    {/* Filter chips row — picking a chip narrows the feed
                        below to that single section. */}
                    <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar -mx-3 px-3 py-1 snap-x">
                      {[
                        { key: 'all' as const, label: 'All', icon: null },
                        { key: 'recommendations' as const, label: 'Recommendations', icon: <MapPin size={14} /> },
                        { key: 'recipes' as const, label: 'Recipes', icon: <ChefHat size={14} /> },
                        { key: 'guides' as const, label: 'Guides', icon: <BookOpen size={14} /> },
                      ].map((c) => {
                        const active = discoverChip === c.key;
                        return (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => setDiscoverChip(c.key)}
                            className={cn(
                              'flex-shrink-0 inline-flex items-center gap-1.5 h-[40px] px-4 rounded-full text-[14px] font-medium border transition-colors',
                              active
                                ? 'bg-on-surface text-surface border-on-surface'
                                : 'bg-white text-on-surface/75 border-on-surface/10 hover:border-on-surface/25 hover:text-on-surface',
                            )}
                          >
                            {c.icon}
                            {c.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Headless picker — the trigger lives on the
                        greeting's "{neighborhood} ▾" button above. */}
                    <HomeLocationBar
                      variant="headless"
                      location={homeLocation}
                      onChange={handleHomeLocationChange}
                      onUseCurrent={handleHomeUseCurrent}
                      open={mobileLocationPickerOpen}
                      onOpenChange={setMobileLocationPickerOpen}
                    />
                  </>
                );
              })()}
              {!discoverSearchActive && (
              <div
                className={cn(
                  'transition-opacity duration-300',
                  homeLocationRefreshing ? 'opacity-40' : 'opacity-100',
                )}
              >
              {/* Recommendations */}
              {(discoverChip === 'all' || discoverChip === 'recommendations') && (
              recsLoading ? (
                <section className={cn(usingDesktopHeader ? 'mt-3' : 'mt-4')}>
                  <div className="flex items-end justify-between gap-4 mb-3">
                    <div className="min-w-0">
                      <h2 className={cn(
                        'font-serif font-bold text-on-surface leading-[1.05] tracking-[-0.02em]',
                        usingDesktopHeader ? 'text-[24px]' : 'text-[22px]',
                      )}>
                        Recommended
                      </h2>
                    </div>
                  </div>
                  <div className="flex items-center justify-center py-10">
                    <Loader2 size={18} className="text-primary/40 animate-spin" />
                    <span className="ml-2 text-xs text-on-surface/40">Finding picks near you…</span>
                  </div>
                </section>
              ) : recommendations.length > 0 ? (
                <section className={cn(usingDesktopHeader ? 'mt-5' : 'mt-5')}>
                  <div className="flex items-end justify-between gap-4 mb-3">
                    <div className="min-w-0">
                      {(() => {
                        const filteredCount = heroChipCuisine
                          ? recommendations.filter((p) => getCuisineLabel((p as any).types || []) === heroChipCuisine).length
                          : recommendations.length;
                        return (
                          <>
                            <h2 className={cn(
                              'font-serif font-semibold text-on-surface leading-[1.1] tracking-[-0.02em] flex items-baseline gap-2.5',
                              usingDesktopHeader ? 'text-[24px]' : 'text-[22px]',
                            )}>
                              Recommended
                              {filteredCount > 0 && (
                                <span className="text-[14px] font-medium text-on-surface/45 tracking-normal">
                                  {filteredCount}
                                </span>
                              )}
                            </h2>
                            <p className="mt-1 text-[13px] text-on-surface/55">
                              {heroChipCuisine
                                ? `${heroChipCuisine} spots${homeLocation ? ` near ${homeLocation.label.split(',')[0].trim()}` : ' near you'}`
                                : `Based on your saves${usingDesktopHeader && homeLocation ? ` and what's hot in ${homeLocation.label.split(',')[0].trim()}` : ''}`}
                            </p>
                          </>
                        );
                      })()}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {usingDesktopHeader && (
                        <div className="hidden md:flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => scrollRail(recRailRef, -1)}
                            className="w-8 h-8 rounded-full bg-white border border-on-surface/[0.08] text-on-surface/65 hover:text-on-surface hover:border-on-surface/30 transition-colors flex items-center justify-center"
                            aria-label="Scroll left"
                          >
                            <ChevronLeft size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => scrollRail(recRailRef, 1)}
                            className="w-8 h-8 rounded-full bg-white border border-on-surface/[0.08] text-on-surface/65 hover:text-on-surface hover:border-on-surface/30 transition-colors flex items-center justify-center"
                            aria-label="Scroll right"
                          >
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      )}
                      {homeLocation && (
                        <SeeAllPill
                          label="See all"
                          onClick={() =>
                            navigate(
                              `/location?label=${encodeURIComponent(homeLocation.label)}&lat=${homeLocation.lat}&lng=${homeLocation.lng}`,
                            )
                          }
                        />
                      )}
                    </div>
                  </div>
                  <div
                    ref={recRailRef}
                    className={cn(
                      "flex gap-3 overflow-x-auto pb-3 no-scrollbar scroll-smooth",
                      phoneMode ? "-mx-3 pl-3 pr-0" : "-mx-1 px-1",
                    )}
                    onScroll={(e) => {
                      if (recommendations.length >= 30) return;
                      const el = e.currentTarget;
                      if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 300) loadMoreRecommendations();
                    }}
                  >
                    {(heroChipCuisine
                      ? recommendations.filter((p) => getCuisineLabel((p as any).types || []) === heroChipCuisine)
                      : recommendations
                    ).slice(0, 30).map((place) => {
                      const cuisine = getCuisineLabel((place as any).types || []);
                      const wishlisted = isWishlisted(place.id);
                      const photoUrl = (place as any).photoUrl as string | undefined;
                      const rating = (place as any).rating as number | undefined;
                      // Google price first; if it's unknown, fall back to
                      // the mode of community-supplied prices for this
                      // place id, then blank.
                      const price = priceLevelToString((place as any).priceLevel ?? -1)
                        || communityPrices[place.id]
                        || '';
                      const fullAddress = (place as any).address as string || '';
                      const street = fullAddress.split(',')[0]?.trim() || '';
                      const recMeta = {
                        id: place.id,
                        name: place.name,
                        image: photoUrl || '',
                        cuisine,
                        price,
                        address: fullAddress,
                      };
                      // Convert Google /5 to a /10 score so the circle matches
                      // the rest of the app (which scores out of 10). One score
                      // language across the page — the green ScoreRing.
                      const score10 = rating && rating > 0 ? rating * 2 : undefined;
                      return (
                        <div
                          key={place.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => navigate(`/restaurant/${place.id}`)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/restaurant/${place.id}`); } }}
                          className={cn(
                            // self-start so a short (photoless) card keeps its
                            // natural height instead of stretching to match a
                            // taller photo card in the same rail.
                            'flex-shrink-0 self-start snap-start text-left group cursor-pointer',
                            'w-[240px]',
                          )}
                        >
                          {/* Unified card: photo (or editorial monogram tile)
                              with the hero score overlaid bottom-right and a
                              heart top-right (the "+ add to list" surfaces on
                              hover, desktop only). Below: serif name + one calm
                              cuisine · $ · distance line. The outer element is a
                              role="button" div so the inner heart/add buttons
                              nest validly. */}
                          {(() => {
                            const distanceLabel = distanceFromAnchor(
                              (place as any).lat,
                              (place as any).lng,
                            );
                            const metaLine = [cuisine, price, distanceLabel].filter(Boolean).join('  ·  ');
                            return (
                              photoUrl ? (
                              <article className="card-surface card-surface-hover">
                                {/* Cover photo */}
                                <div className="relative aspect-[4/3] overflow-hidden bg-on-surface/[0.04]">
                                  <img
                                    src={photoUrl}
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                                    referrerPolicy="no-referrer"
                                  />
                                  {/* Depth — subtle radial highlight + shadow so the
                                      cover reads as finished, not flat. */}
                                  <div
                                    className="absolute inset-0 pointer-events-none"
                                    style={{
                                      backgroundImage:
                                        'radial-gradient(circle at 25% 25%, rgba(255,255,255,0.16), transparent 45%), radial-gradient(circle at 75% 80%, rgba(0,0,0,0.18), transparent 50%)',
                                    }}
                                  />
                                  <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleWishlist(recMeta); }}
                                      className={cn(
                                        'w-8 h-8 rounded-full grid place-items-center bg-white/90 backdrop-blur-sm shadow-sm text-on-surface transition-transform hover:scale-[1.06]',
                                        wishlisted && 'text-primary',
                                      )}
                                      aria-label={wishlisted ? 'In wishlist' : 'Add to wishlist'}
                                    >
                                      <Heart size={14} className={wishlisted ? 'fill-current' : ''} />
                                    </button>
                                    {usingDesktopHeader && (
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); openAddRestaurantModal(recMeta); }}
                                        className="w-8 h-8 rounded-full grid place-items-center bg-white/90 backdrop-blur-sm shadow-sm text-on-surface transition-transform hover:scale-[1.06]"
                                        aria-label="Add to list"
                                      >
                                        <Plus size={14} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {/* Body: serif name + one muted meta line, with
                                    the score ring to the right (below the photo). */}
                                <div className="flex items-start justify-between gap-2.5 px-3.5 pt-3 pb-3.5">
                                  <div className="min-w-0 flex-1">
                                    <h3 className="font-serif font-semibold text-on-surface text-[17px] leading-[1.15] tracking-[-0.018em] line-clamp-1">
                                      {place.name}
                                    </h3>
                                    {metaLine && (
                                      <p className="mt-1 text-[12.5px] font-medium text-on-surface/55 truncate">
                                        {metaLine}
                                      </p>
                                    )}
                                  </div>
                                  <ScoreRing score={score10} size={44} className="mt-0.5 flex-shrink-0" />
                                </div>
                              </article>
                              ) : (
                              /* No photo — a compact, image-free info card. No
                                 gradient placeholder: everything sits on two tight
                                 rows. Top: a cuisine · price eyebrow with the
                                 wishlist heart + rate (＋). Bottom: the serif name
                                 beside the score ring. Sits at its short natural
                                 height in the rail. */
                              <article className="card-surface card-surface-hover p-3.5">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.13em] text-on-surface/40">
                                    {[cuisine, price].filter(Boolean).join(' · ') || 'Restaurant'}
                                  </p>
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleWishlist(recMeta); }}
                                      className={cn(
                                        'w-7 h-7 rounded-full grid place-items-center bg-on-surface/[0.05] hover:bg-on-surface/[0.09] text-on-surface/70 transition-colors',
                                        wishlisted && 'text-primary',
                                      )}
                                      aria-label={wishlisted ? 'In wishlist' : 'Add to wishlist'}
                                    >
                                      <Heart size={13} className={wishlisted ? 'fill-current' : ''} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); openAddRestaurantModal(recMeta); }}
                                      className="w-7 h-7 rounded-full grid place-items-center bg-on-surface/[0.05] hover:bg-on-surface/[0.09] text-on-surface/70 transition-colors"
                                      aria-label="Rate"
                                    >
                                      <Plus size={14} />
                                    </button>
                                  </div>
                                </div>
                                <div className="mt-2.5 flex items-end justify-between gap-3">
                                  <h3 className="min-w-0 font-serif font-semibold text-on-surface text-[15.5px] leading-[1.22] tracking-[-0.01em] line-clamp-2">
                                    {place.name}
                                  </h3>
                                  <ScoreRing score={score10} size={40} className="flex-shrink-0" />
                                </div>
                              </article>
                              )
                            );
                          })()}
                        </div>
                      );
                    })}
                    {/* When the chip filter narrows the rail to zero
                        matches AND we've already pulled everything we
                        can from the engine, show a quiet placeholder
                        so the rail isn't blank. */}
                    {heroChipCuisine &&
                      recommendations.filter((p) => getCuisineLabel((p as any).types || []) === heroChipCuisine).length === 0 &&
                      !recsLoadingMore && (
                        <div className={cn(
                          'flex-shrink-0 snap-start',
                          'w-[240px]',
                        )}>
                          <div className="aspect-[4/3] rounded-2xl border border-dashed border-on-surface/15 bg-on-surface/[0.03] flex items-center justify-center px-4 text-center">
                            <p className="text-[12px] text-on-surface/55">
                              No {heroChipCuisine} spots found near you yet.
                            </p>
                          </div>
                        </div>
                      )}
                    {recsLoadingMore && (
                      <div className={cn(
                        'flex-shrink-0 flex items-center justify-center',
                        'w-[240px]',
                      )}>
                        <Loader2 size={18} className="text-primary/40 animate-spin" />
                      </div>
                    )}
                    {/* View-all end card — takes the user to the full
                        location page so they can browse beyond the
                        first 30 recommendations. */}
                    {homeLocation && (
                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            `/location?label=${encodeURIComponent(homeLocation.label)}&lat=${homeLocation.lat}&lng=${homeLocation.lng}`,
                          )
                        }
                        className={cn(
                          'flex-shrink-0 snap-start text-left group',
                          'w-[240px]',
                        )}
                      >
                        <div className="h-full rounded-2xl border border-dashed border-on-surface/15 bg-on-surface/[0.03] group-hover:bg-on-surface/[0.06] group-hover:border-primary/40 transition-colors flex flex-col items-center justify-center text-center px-4 py-2">
                          <span className="w-11 h-11 rounded-full bg-primary/10 text-primary grid place-items-center transition-colors group-hover:bg-primary/15">
                            <ArrowRight size={20} strokeWidth={2} />
                          </span>
                          <span className="mt-2 font-serif font-semibold text-[15px] text-on-surface leading-[1.15]">
                            View all
                          </span>
                          <span className="mt-0.5 text-[11px] text-on-surface/55 line-clamp-1 leading-tight">
                            in {homeLocation.label.split(',')[0]}
                          </span>
                        </div>
                      </button>
                    )}
                  </div>
                </section>
              ) : mode === 'home' && homeLocation ? (
                // Empty state. Most common cause: the user switched to a
                // city for the first time and the personalised queries
                // came back narrower than the radius allows. We keep the
                // header visible so the radius picker stays reachable —
                // bumping the chip is usually the fix.
                <section className={cn(usingDesktopHeader ? 'mt-5' : 'mt-4')}>
                  <div className="flex items-end justify-between gap-4 mb-3">
                    <div className="min-w-0">
                      <h2 className={cn(
                        'font-serif font-bold text-on-surface leading-[1.05] tracking-[-0.02em]',
                        usingDesktopHeader ? 'text-[24px]' : 'text-[22px]',
                      )}>
                        Recommended
                      </h2>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-dashed border-on-surface/15 bg-on-surface/[0.02] py-10 px-6 text-center">
                    <p className="text-sm text-on-surface/55 font-semibold">No recommendations in this area yet</p>
                    <p className="text-xs text-on-surface/40 mt-1">Try a wider radius or a different location.</p>
                  </div>
                </section>
              ) : null
              )}

              {/* ── Desktop lower zone — friend activity (left) + Recipes &
                  Featured guides as compact lists (right). Replaces the flat
                  stack of rails on wide screens. Mobile keeps the stacked
                  rails below. ── */}
              {usingDesktopHeader && (
                <section className="mt-9 grid grid-cols-[minmax(0,1fr)_320px] gap-8 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-12 items-start">
                  {/* Left — friend activity feed */}
                  <div className="min-w-0">
                    <SocialFeed
                      feedOnly
                      centerLat={homeLocation?.lat ?? null}
                      centerLng={homeLocation?.lng ?? null}
                      suggestedRestaurants={[]}
                    />
                  </div>

                  {/* Right — Recipes for you + Featured guides. Always beside
                      the feed in desktop mode (≥1024px), never stacked below. */}
                  <div className="space-y-9">
                    {/* Recipes for you */}
                    <div>
                      <div className="flex items-end justify-between gap-3 mb-1.5">
                        <h2 className="font-serif font-semibold text-on-surface text-[20px] leading-[1.1] tracking-[-0.02em]">Recipes for you</h2>
                        <SeeAllPill label="See all" to="/recipes-for-you" />
                      </div>
                      {recommendedRecipes.length === 0 ? (
                        <p className="text-[13px] text-on-surface/45 py-3">No recipes yet.</p>
                      ) : (
                        <div className="divide-y divide-on-surface/[0.06]">
                          {recommendedRecipes.slice(0, 5).map((r) => {
                            const cover = r.photos?.[0];
                            const authorProfile =
                              r._source === 'friend'
                                ? (friendProfiles[r.userId] || recipeAuthorProfiles[r.userId])
                                : r._source === 'expert'
                                  ? (expertProfiles[r.userId] || recipeAuthorProfiles[r.userId])
                                  : undefined;
                            const authorName = authorProfile?.display_name
                              || authorProfile?.username
                              || (r._source === 'expert' ? 'Chef' : r._source === 'public' ? 'Community' : 'Friend');
                            const totalMin = (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0);
                            const timeLabel = totalMin > 0
                              ? totalMin >= 60
                                ? `${Math.floor(totalMin / 60)}h${totalMin % 60 ? ` ${totalMin % 60}m` : ''}`
                                : `${totalMin}m`
                              : '';
                            const metaLine = [r.cuisine, timeLabel].filter(Boolean).join('  ·  ');
                            return (
                              <Link key={r.id} to={`/recipe/${r.userId}/${r.id}`} className="group flex items-center gap-3 py-3">
                                <div className="w-[52px] h-[52px] rounded-xl overflow-hidden flex-shrink-0 bg-on-surface/[0.04]">
                                  {cover ? (
                                    <img src={cover} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-on-surface/[0.06] to-on-surface/[0.02]">
                                      <ChefHat size={20} className="text-on-surface/25" strokeWidth={1.5} />
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary truncate">{authorName}</p>
                                  <h4 className="font-serif font-semibold text-on-surface text-[15px] leading-[1.2] tracking-[-0.01em] line-clamp-1 group-hover:text-primary transition-colors">{r.title}</h4>
                                  {metaLine && <p className="mt-0.5 text-[12px] text-on-surface/55 truncate">{metaLine}</p>}
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Featured guides */}
                    <div>
                      <div className="flex items-end justify-between gap-3 mb-1.5">
                        <h2 className="font-serif font-semibold text-on-surface text-[20px] leading-[1.1] tracking-[-0.02em]">Featured guides</h2>
                        <SeeAllPill label="Browse all" onClick={() => setGuidesBrowserOpen(true)} />
                      </div>
                      <div className="divide-y divide-on-surface/[0.06]">
                        {feedGuides.slice(0, 4).map((g) => {
                          const author = feedGuideAuthors[g.userId];
                          const authorName = author?.display_name || author?.username || 'someone';
                          return (
                            <Link key={g.id} to={`/guides/${g.id}`} className="group flex items-center gap-3 py-3">
                              <div className="w-12 h-12 rounded-xl bg-on-surface flex items-center justify-center flex-shrink-0 overflow-hidden">
                                {g.coverPhoto ? (
                                  <img src={g.coverPhoto} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                ) : (
                                  <BookOpen size={18} className="text-surface" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <h4 className="font-serif font-semibold text-on-surface text-[15px] leading-[1.2] tracking-[-0.01em] line-clamp-1 group-hover:text-primary transition-colors">{g.title}</h4>
                                <p className="mt-0.5 text-[12px] text-on-surface/55 truncate">by {authorName} · {g.entries.length} {g.type === 'recipes' ? 'recipes' : 'spots'}</p>
                              </div>
                              <ChevronRight size={16} className="text-on-surface/30 flex-shrink-0" />
                            </Link>
                          );
                        })}
                        {/* Create a guide */}
                        <button type="button" onClick={() => openGuideCreator()} className="group w-full flex items-center gap-3 py-3 text-left">
                          <div className="w-12 h-12 rounded-xl border-[1.5px] border-dashed border-primary/30 bg-primary/[0.05] flex items-center justify-center flex-shrink-0 text-primary group-hover:border-primary group-hover:bg-primary/[0.08] transition-colors">
                            <Plus size={18} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className="font-serif font-semibold text-on-surface text-[15px] leading-[1.2] tracking-[-0.01em]">Create a guide</h4>
                            <p className="mt-0.5 text-[12px] text-on-surface/55 truncate">Bundle restaurants or recipes into a list.</p>
                          </div>
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* Recipes For You — friend / expert / public recipes ranked by
                  source + cuisine/tag overlap with the user's logged Home
                  Cooking meals. Mobile-only rail; on desktop these live in the
                  two-column lower zone's right column. */}
              {!usingDesktopHeader && (discoverChip === 'all' || discoverChip === 'recipes') && (
              <section className={cn(usingDesktopHeader ? 'mt-5' : 'mt-6')}>
                <div className="flex items-end justify-between gap-4 mb-3">
                  <div className="min-w-0">
                    <h2 className={cn(
                      'font-serif font-semibold text-on-surface leading-[1.1] tracking-[-0.02em] flex items-baseline gap-2.5',
                      usingDesktopHeader ? 'text-[24px]' : 'text-[22px]',
                    )}>
                      Recipes for you
                      {recommendedRecipes.length > 0 && (
                        <span className="text-[14px] font-medium text-on-surface/45 tracking-normal">
                          {recommendedRecipes.length}
                        </span>
                      )}
                    </h2>
                    <p className="mt-1 text-[13px] text-on-surface/55">
                      {(() => {
                        const r = recommendedRecipes[0];
                        if (!r) return 'From friends and chefs you follow';
                        const profile =
                          r._source === 'friend'
                            ? (friendProfiles[r.userId] || recipeAuthorProfiles[r.userId])
                            : r._source === 'expert'
                              ? (expertProfiles[r.userId] || recipeAuthorProfiles[r.userId])
                              : undefined;
                        const fullName = profile?.display_name || profile?.username || '';
                        const firstName = fullName.replace('@', '').trim().split(' ')[0];
                        return firstName
                          ? `From ${firstName} and saved chefs`
                          : 'From friends and chefs you follow';
                      })()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {usingDesktopHeader && recommendedRecipes.length > 0 && (
                      <div className="hidden md:flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => scrollRail(recipeRailRef, -1)}
                          className="w-8 h-8 rounded-full bg-white border border-on-surface/[0.08] text-on-surface/65 hover:text-on-surface hover:border-on-surface/30 transition-colors flex items-center justify-center"
                          aria-label="Scroll left"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => scrollRail(recipeRailRef, 1)}
                          className="w-8 h-8 rounded-full bg-white border border-on-surface/[0.08] text-on-surface/65 hover:text-on-surface hover:border-on-surface/30 transition-colors flex items-center justify-center"
                          aria-label="Scroll right"
                        >
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    )}
                    <SeeAllPill label="See all" to="/recipes-for-you" />
                  </div>
                </div>
                {recommendedRecipes.length === 0 ? (
                  <div className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="font-serif italic text-[15px] text-on-surface/65">
                        No recipes from your circle yet.
                      </p>
                      <Link
                        to="/recipes-for-you"
                        className="mt-1 inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:opacity-70 transition-opacity"
                      >
                        Explore the community
                        <ChevronRight size={12} strokeWidth={2.5} />
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div
                    ref={recipeRailRef}
                    className={cn(
                      "flex gap-3 overflow-x-auto pb-3 no-scrollbar scroll-smooth",
                      phoneMode ? "-mx-3 pl-3 pr-0" : "-mx-1 px-1",
                    )}
                  >
                    {recommendedRecipes.map((r) => {
                      const cover = r.photos?.[0];
                      const authorProfile =
                        r._source === 'friend'
                          ? (friendProfiles[r.userId] || recipeAuthorProfiles[r.userId])
                          : r._source === 'expert'
                            ? (expertProfiles[r.userId] || recipeAuthorProfiles[r.userId])
                            : undefined;
                      const authorName = authorProfile?.display_name
                        || (authorProfile?.username ? authorProfile.username : '')
                        || (r._source === 'expert' ? 'Chef' : r._source === 'public' ? 'Community' : 'Friend');
                      const authorInitial = authorName.replace('@', '').trim().charAt(0).toUpperCase() || 'F';
                      const totalMin = (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0);
                      const timeLabel = totalMin > 0
                        ? totalMin >= 60
                          ? `${Math.floor(totalMin / 60)}h${totalMin % 60 ? ` ${totalMin % 60}m` : ''}`
                          : `${totalMin}m`
                        : '';
                      const authorHue = hashToHue(r.userId || authorName);
                      // Pseudo-stable save count, seeded from the id so the
                      // footer feels lived-in even without a real saves table.
                      const tagCount = (r.tags?.length ?? 0);
                      const seed = (r.id || r.title).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
                      const saveCount = 6 + (seed % 40);
                      return (
                        <Link
                          key={r.id}
                          to={`/recipe/${r.userId}/${r.id}`}
                          className={cn(
                            'flex-shrink-0 snap-start group',
                            usingDesktopHeader ? 'w-[224px]' : 'w-[200px]',
                          )}
                        >
                          {/* Image cover with author pill; serif title + one
                              calm cuisine · time line. Calm ChefHat tile when
                              there's no photo (not a flat gradient). */}
                          <article className="card-surface card-surface-hover">
                            <div className="relative aspect-[4/3] overflow-hidden bg-on-surface/[0.04]">
                              {cover ? (
                                <img
                                  src={cover}
                                  alt=""
                                  loading="lazy"
                                  decoding="async"
                                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-on-surface/[0.06] to-on-surface/[0.02]">
                                  <ChefHat size={34} className="text-on-surface/20" strokeWidth={1.5} />
                                </div>
                              )}
                              <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full bg-white/90 backdrop-blur-sm shadow-sm text-[11px] font-semibold text-on-surface max-w-[150px]">
                                <span
                                  className="w-[18px] h-[18px] rounded-full grid place-items-center text-white text-[9px] font-bold flex-shrink-0"
                                  style={{ background: `hsl(${authorHue} 50% 45%)` }}
                                >
                                  {authorInitial}
                                </span>
                                <span className="truncate">{authorName}</span>
                              </span>
                            </div>
                            <div className="px-3.5 pt-3 pb-3.5">
                              <h3 className="font-serif font-semibold text-on-surface text-[16px] leading-[1.18] tracking-[-0.018em] line-clamp-2 group-hover:text-primary transition-colors">
                                {r.title}
                              </h3>
                              {(r.cuisine || timeLabel) && (
                                <p className="mt-1 text-[12.5px] text-on-surface/55 font-medium truncate">
                                  {[r.cuisine, timeLabel].filter(Boolean).join('  ·  ')}
                                </p>
                              )}
                            </div>
                          </article>
                        </Link>
                      );
                    })}
                    {/* Trailing "View all" card — jumps to the full recipe library. */}
                    <Link
                      to="/recipes-for-you"
                      className={cn('flex-shrink-0 snap-start group', usingDesktopHeader ? 'w-[150px]' : 'w-[136px]')}
                      aria-label="View all recipes"
                    >
                      <div className="h-full min-h-[140px] rounded-2xl border border-dashed border-on-surface/15 bg-on-surface/[0.03] flex flex-col items-center justify-center gap-2.5 text-center px-4 py-7 transition-colors group-hover:border-primary/40 group-hover:bg-on-surface/[0.06]">
                        <span className="w-11 h-11 rounded-full bg-primary/10 text-primary grid place-items-center transition-colors group-hover:bg-primary/15">
                          <ArrowRight size={20} strokeWidth={2} />
                        </span>
                        <span className="font-serif font-semibold text-on-surface text-[15px] leading-[1.15]">View all recipes</span>
                      </div>
                    </Link>
                  </div>
                )}
              </section>
              )}

              {/* Guides — curated lists from friends and tastemakers.
                  Matches the editorial card vocabulary: square gradient
                  cover cards (or real cover photos when present) +
                  serif title + author chip. */}
              {!usingDesktopHeader && (discoverChip === 'all' || discoverChip === 'guides') && (
              <section className={cn(usingDesktopHeader ? 'mt-5' : 'mt-6')}>
                <div className="flex items-end justify-between gap-4 mb-3">
                  <div className="min-w-0">
                    <h2 className={cn(
                      'font-serif font-semibold text-on-surface leading-[1.1] tracking-[-0.02em]',
                      usingDesktopHeader ? 'text-[24px]' : 'text-[22px]',
                    )}>
                      Guides
                    </h2>
                    {usingDesktopHeader && (
                      <p className="mt-1 text-[13px] text-on-surface/55">
                        Curated lists from friends and tastemakers
                      </p>
                    )}
                  </div>
                  <SeeAllPill label="Browse all" onClick={() => setGuidesBrowserOpen(true)} />
                </div>
                <div className={cn(
                  "flex gap-3 overflow-x-auto pb-3 no-scrollbar scroll-smooth",
                  phoneMode ? "-mx-3 pl-3 pr-0" : "-mx-1 px-1",
                )}>
                  {/* Empty state only — when there are no guides yet, lead
                      with an inviting descriptive tile so the row isn't bare. */}
                  {feedGuides.length === 0 && (
                  <button
                    type="button"
                    onClick={() => openGuideCreator()}
                    className={cn(
                      'flex-shrink-0 snap-start text-left group',
                      usingDesktopHeader ? 'w-[200px]' : 'w-[160px]',
                    )}
                  >
                    <div className="aspect-square rounded-2xl border-[1.5px] border-dashed border-primary/30 bg-primary/[0.05] p-4 flex flex-col justify-between transition-colors group-hover:border-primary group-hover:bg-primary/[0.08]">
                      <div className="w-10 h-10 rounded-2xl bg-white shadow-sm grid place-items-center text-primary">
                        <Plus size={18} />
                      </div>
                      <div>
                        <h3 className="font-serif font-semibold text-[17px] text-on-surface tracking-[-0.015em] leading-tight">
                          Create a guide
                        </h3>
                        <p className="mt-1 text-[12px] text-on-surface/65 leading-[1.4]">
                          Bundle restaurants or recipes into a shareable list.
                        </p>
                      </div>
                    </div>
                  </button>
                  )}
                  {feedGuides.map((g) => {
                    const author = feedGuideAuthors[g.userId];
                    const authorName = author?.display_name || author?.username || 'someone';
                    const authorInitial = authorName.charAt(0).toUpperCase();
                    const authorHue = hashToHue(g.userId || authorName);
                    return (
                      <Link
                        key={g.id}
                        to={`/guides/${g.id}`}
                        className={cn(
                          'flex-shrink-0 snap-start group',
                          usingDesktopHeader ? 'w-[200px]' : 'w-[160px]',
                        )}
                      >
                        <article className="card-surface card-surface-hover flex flex-col">
                          <div className="relative aspect-[1/0.85] overflow-hidden bg-on-surface/[0.04]">
                            {g.coverPhoto ? (
                              <img
                                src={g.coverPhoto}
                                alt=""
                                className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-on-surface/[0.06] to-on-surface/[0.02]">
                                <BookOpen size={30} className="text-on-surface/20" strokeWidth={1.5} />
                              </div>
                            )}
                            <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full bg-white/90 backdrop-blur-sm shadow-sm text-[10px] font-bold uppercase tracking-[0.08em] text-on-surface">
                              <BookOpen size={11} className="text-primary" />
                              Guide · {g.entries.length} {g.type === 'recipes' ? 'recipes' : 'spots'}
                            </span>
                          </div>
                          <div className="px-3.5 pt-3 pb-3.5">
                            <h3 className="font-serif font-semibold text-on-surface text-[15px] tracking-[-0.01em] leading-[1.25] line-clamp-2">
                              {g.title}
                            </h3>
                            <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-on-surface/55">
                              <span
                                className="w-[18px] h-[18px] rounded-full grid place-items-center text-white text-[9px] font-bold"
                                style={{ background: `hsl(${authorHue} 50% 45%)` }}
                              >
                                {authorInitial}
                              </span>
                              <span>by {authorName}</span>
                            </div>
                          </div>
                        </article>
                      </Link>
                    );
                  })}
                  {/* Minimalist create-a-guide tile — sits at the end of the
                      row and stretches to match the guide cards' height. */}
                  {feedGuides.length > 0 && (
                  <button
                    type="button"
                    onClick={() => openGuideCreator()}
                    className={cn(
                      'flex-shrink-0 snap-start group',
                      usingDesktopHeader ? 'w-[200px]' : 'w-[160px]',
                    )}
                  >
                    <div className="h-full min-h-[140px] rounded-2xl border border-dashed border-on-surface/15 bg-on-surface/[0.03] flex flex-col items-center justify-center gap-2.5 px-4 py-7 text-center transition-colors group-hover:border-primary/40 group-hover:bg-on-surface/[0.06]">
                      <span className="w-11 h-11 rounded-full bg-primary/10 text-primary grid place-items-center transition-colors group-hover:bg-primary/15">
                        <Plus size={20} strokeWidth={2} />
                      </span>
                      <span className="font-serif font-semibold text-[15px] text-on-surface leading-[1.15]">
                        Create a guide
                      </span>
                    </div>
                  </button>
                  )}
                </div>
              </section>
              )}

              {/* Social Feed — mobile only; on desktop the friend feed is the
                  left column of the two-column lower zone above. */}
              {!usingDesktopHeader && (
                <div className="mt-5">
                  <SocialFeed
                    centerLat={mode === 'home' ? homeLocation?.lat ?? null : null}
                    centerLng={mode === 'home' ? homeLocation?.lng ?? null : null}
                    suggestedRestaurants={mode === 'home' ? recommendations.slice(0, 6).map((p) => ({
                      id: p.id,
                      name: p.name,
                      cuisine: getCuisineLabel((p as any).types || []),
                      rating: (p as any).rating ?? null,
                      address: (p as any).address || '',
                      price: priceLevelToString((p as any).priceLevel ?? -1) || communityPrices[p.id] || '',
                      photoUrl: (p as any).photoUrl,
                    })) : []}
                  />
                </div>
              )}
              </div>
              )}
            </div>

            {/* Floating map button — only if this instance actually has a map */}
            {mode !== 'home' && (
              <button
                onClick={() => setSheetState('peek')}
                className="absolute bottom-6 right-4 z-10 w-14 h-14 rounded-full bg-primary text-white shadow-xl shadow-primary/30 flex items-center justify-center hover:bg-primary/90 transition-all active:scale-95 ring-4 ring-white"
              >
                <MapIcon size={22} />
              </button>
            )}
          </div>
        )}

        {/* ══════ HALF STATE — filter bar + results ══════ */}
        {sheetState !== 'full' && (
        <>
        {/* Search Bar & Filters — only on discover tab */}
        <div ref={filterBarRef} className={cn("pb-4 flex-shrink-0 relative", phoneMode ? "px-3" : "px-6")}>
          {/* Sheet title — "Discover / N results", matching the reference. */}
          <div className="flex items-baseline gap-2.5 pb-3">
            <h2 className="font-serif font-bold text-[26px] leading-none tracking-tight">{panelTitle}</h2>
            <span className="text-[13px] font-semibold text-on-surface/45">{panelResultCount} result{panelResultCount === 1 ? '' : 's'}</span>
          </div>
          <AnimatePresence mode="wait">
            {showSearchInput ? (
              <motion.form
                ref={searchWrapperRef}
                key="search-input"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (searchQuery.trim()) {
                    handleSearch(searchQuery);
                  }
                }}
              >
                <div className="flex-1 relative">
                  <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/40" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search restaurants..."
                    autoFocus
                    className="w-full pl-11 pr-4 py-3 rounded-full border-2 border-on-surface/10 bg-surface text-on-surface text-sm font-medium focus:outline-none focus:border-primary/40 transition-colors"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowSearchInput(false);
                    setSearchQuery('');
                    setDiscoverSearchActive(false);
                    // Restore pre-search places and markers
                    if (preSearchPlacesRef.current.length > 0) {
                      setPlaces(preSearchPlacesRef.current);
                      syncMarkersRef.current?.(preSearchPlacesRef.current);
                    }
                  }}
                  className="w-12 h-12 rounded-full border-2 border-on-surface/10 flex items-center justify-center flex-shrink-0 hover:bg-muted transition-colors"
                >
                  <X size={18} className="text-on-surface/70" />
                </button>
              </motion.form>
            ) : (
              <motion.div
                key="filters"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-3 overflow-x-auto scrollbar-hide"
              >
                <button
                  onClick={() => {
                    preSearchPlacesRef.current = places;
                    setShowSearchInput(true);
                    setDiscoverSearchActive(true);
                    if (sheetState === 'peek') setSheetState('half');
                    setTimeout(() => searchInputRef.current?.focus(), 100);
                  }}
                  className="w-12 h-12 rounded-full border-2 border-on-surface/10 flex items-center justify-center flex-shrink-0 hover:bg-muted transition-colors"
                >
                  <Search size={20} className="text-on-surface/70" />
                </button>
                <button
                  onClick={() => setFilterSheetOpen(true)}
                  className={cn(
                    "relative w-12 h-12 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                    activeFilterCount > 0
                      ? "border-primary bg-primary/5"
                      : "border-on-surface/10 hover:bg-muted"
                  )}
                >
                  {isSearching ? (
                    <Loader2 size={18} className="text-on-surface/70 animate-spin" />
                  ) : (
                    <SlidersHorizontal size={18} className={activeFilterCount > 0 ? "text-primary" : "text-on-surface/70"} />
                  )}
                  {activeFilterCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
                {FILTERS.map((filter) => (
                  <button
                    key={filter.label}
                    className={cn(
                      "flex items-center gap-2 px-5 py-3 rounded-full border-2 border-on-surface/10 whitespace-nowrap flex-shrink-0 transition-colors hover:bg-muted",
                      filter.active && "bg-primary/10 border-primary/30 text-primary"
                    )}
                  >
                    <filter.icon size={16} className={filter.active ? "text-primary" : "text-on-surface/50"} />
                    <span className="text-xs font-bold uppercase tracking-wider">{filter.label}</span>
                    {filter.hasDropdown && <ChevronDown size={14} className="text-on-surface/40" />}
                  </button>
                ))}

                {/* Map mode toggle buttons — active state is a filled pill so
                    the selected tab is obvious against the map background. The
                    first is a dropdown: pick My Ratings, any restaurant list,
                    or the Wishlist to plot on the map. */}
                <div className="relative flex-shrink-0">
                  <button
                    ref={mapDropdownBtnRef}
                    onClick={() => {
                      const willOpen = mapMode !== 'myratings' ? true : !mapModeDropdownOpen;
                      if (mapMode !== 'myratings') { setMapMode('myratings'); setSelectedListId(null); }
                      if (willOpen && mapDropdownBtnRef.current) {
                        const r = mapDropdownBtnRef.current.getBoundingClientRect();
                        const left = Math.min(Math.max(8, r.left), window.innerWidth - 238);
                        // The filter bar usually sits near the bottom of the
                        // map, so open the menu upward when the trigger is in
                        // the lower half — otherwise it'd render off-screen.
                        const openUp = r.top > window.innerHeight * 0.5;
                        setMapDropdownPos(openUp
                          ? { left, bottom: Math.round(window.innerHeight - r.top + 8) }
                          : { left, top: Math.round(r.bottom + 8) });
                      }
                      setMapModeDropdownOpen(willOpen);
                    }}
                    className={cn("flex items-center gap-2 px-5 py-3 rounded-full border-2 whitespace-nowrap transition-colors",
                      mapMode === 'myratings' ? "bg-primary border-primary text-white shadow-sm shadow-primary/20" : "border-on-surface/10 hover:bg-muted")}
                  >
                    {selectedListId === WISHLIST_LIST_ID
                      ? <Heart size={16} className={mapMode === 'myratings' ? "text-white fill-white" : "text-on-surface/50"} />
                      : <Star size={16} className={mapMode === 'myratings' ? "text-white" : "text-on-surface/50"} />}
                    <span className="text-xs font-bold uppercase tracking-wider max-w-[150px] truncate">
                      {mapMode !== 'myratings' || !selectedListId ? 'My Ratings'
                        : selectedListId === WISHLIST_LIST_ID ? 'Wishlist'
                        : (myLists.find((l: any) => l.id === selectedListId)?.name || 'List')}
                    </span>
                    <ChevronDown size={14} className={cn('transition-transform flex-shrink-0', mapMode === 'myratings' ? 'text-white/80' : 'text-on-surface/40', mapModeDropdownOpen && 'rotate-180')} />
                  </button>
                  {mapModeDropdownOpen && mapMode === 'myratings' && mapDropdownPos && createPortal(
                      <>
                        <div className="fixed inset-0 z-[120]" onClick={() => setMapModeDropdownOpen(false)} />
                        <motion.div
                          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.14 }}
                          style={{ position: 'fixed', left: mapDropdownPos.left, ...(mapDropdownPos.top != null ? { top: mapDropdownPos.top } : { bottom: mapDropdownPos.bottom }) }}
                          className="z-[121] w-[230px] max-h-[340px] overflow-y-auto no-scrollbar rounded-2xl bg-paper border border-on-surface/10 shadow-xl py-1.5"
                        >
                          {([
                            { id: null as string | null, label: 'My Ratings', icon: 'star' as const, emoji: null as string | null },
                            ...myLists.filter((l: any) => l.type !== 'home-cooking' && ((l.restaurantIds?.length || 0) + (l.wishlistIds?.length || 0)) > 0).map((l: any) => ({ id: l.id as string | null, label: l.name as string, icon: 'emoji' as const, emoji: l.emoji as string | null })),
                            { id: WISHLIST_LIST_ID as string | null, label: 'Wishlist', icon: 'heart' as const, emoji: null as string | null },
                          ]).map((opt) => {
                            const active = (selectedListId || null) === opt.id;
                            return (
                              <button
                                key={opt.id ?? 'all'}
                                type="button"
                                onClick={() => { setSelectedListId(opt.id); setMapModeDropdownOpen(false); }}
                                className={cn('w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors', active ? 'bg-primary/[0.07]' : 'hover:bg-on-surface/[0.04]')}
                              >
                                <span className="w-[16px] flex-shrink-0 flex items-center justify-center">
                                  {opt.icon === 'star' && <Star size={15} className={active ? 'text-primary' : 'text-on-surface/45'} />}
                                  {opt.icon === 'heart' && <Heart size={15} className={active ? 'text-primary fill-primary' : 'text-on-surface/45'} />}
                                  {opt.icon === 'emoji' && <span className="text-[14px] leading-none">{opt.emoji}</span>}
                                </span>
                                <span className={cn('text-[13.5px] font-semibold truncate flex-1', active ? 'text-primary' : 'text-on-surface')}>{opt.label}</span>
                                {active && <Check size={15} className="text-primary flex-shrink-0" />}
                              </button>
                            );
                          })}
                        </motion.div>
                      </>,
                      document.body
                    )}
                </div>

                <button
                  onClick={() => { setMapMode(mapMode === 'friends' ? 'discover' : 'friends'); setSelectedFriendIds(new Set()); }}
                  className={cn("flex items-center gap-2 px-5 py-3 rounded-full border-2 whitespace-nowrap flex-shrink-0 transition-colors",
                    mapMode === 'friends' ? "bg-primary border-primary text-white shadow-sm shadow-primary/20" : "border-on-surface/10 hover:bg-muted")}
                >
                  <Users size={16} className={mapMode === 'friends' ? "text-white" : "text-on-surface/50"} />
                  <span className="text-xs font-bold uppercase tracking-wider">Friends{selectedFriendIds.size > 0 ? ` (${selectedFriendIds.size})` : ''}</span>
                </button>

                <button
                  onClick={() => setMapMode(mapMode === 'experts' ? 'discover' : 'experts')}
                  className={cn(
                    "flex items-center gap-2 px-5 py-3 rounded-full border-2 whitespace-nowrap flex-shrink-0 transition-colors",
                    mapMode === 'experts' ? "bg-primary border-primary text-white shadow-sm shadow-primary/20" : "border-on-surface/10 hover:bg-muted"
                  )}
                >
                  <Star size={16} className={mapMode === 'experts' ? "text-white fill-white" : "text-on-surface/50"} />
                  <span className="text-xs font-bold uppercase tracking-wider">Experts</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Friend/list dropdowns removed — all filtering now in filter sheet */}
        </div>

        {/* Results List */}
        <div className={cn("flex-1 overflow-y-auto overflow-x-hidden overscroll-x-none no-scrollbar pb-32", phoneMode ? "px-3" : "px-6")}>
          {/* My Ratings tab content */}
          {mapMode === 'myratings' && (
            <div className="divide-y divide-on-surface/[0.06]">
              {filteredMyRatings.length === 0 ? (
                <div className="text-center py-8"><p className="text-sm text-on-surface/40">{activeFilterCount > 0 ? 'No results match your filters' : 'No rated restaurants yet'}</p></div>
              ) : filteredMyRatings.map((r) => renderRatingCard(r))}
            </div>
          )}

          {/* Friends tab content */}
          {mapMode === 'friends' && (
            <div className="divide-y divide-on-surface/[0.06]">
              {filteredFriendRatings.length === 0 ? (
                <div className="text-center py-8"><p className="text-sm text-on-surface/40">{activeFilterCount > 0 ? 'No results match your filters' : 'No friend ratings yet'}</p></div>
              ) : filteredFriendRatings.map((r) => {
                const prof = friendProfiles[r.user_id];
                const name = prof?.display_name || 'Friend';
                const initial = name.charAt(0).toUpperCase();
                return renderRatingCard(r, {
                  extra: (
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <span className="w-4 h-4 rounded-full bg-primary/10 text-[8.5px] font-bold text-primary flex items-center justify-center flex-shrink-0">{initial}</span>
                      <span className="text-on-surface/55 truncate">{name}</span>
                    </span>
                  ),
                });
              })}
            </div>
          )}

          {/* Experts tab content */}
          {mapMode === 'experts' && (
            <div className="divide-y divide-on-surface/[0.06]">
              {filteredExpertRatings.length === 0 ? (
                <div className="text-center py-8"><p className="text-sm text-on-surface/40">{activeFilterCount > 0 ? 'No results match your filters' : 'No expert ratings yet'}</p></div>
              ) : filteredExpertRatings.map((r) => {
                const expProf = expertProfiles[r.user_id];
                const expName = expProf?.display_name || 'Expert';
                return renderRatingCard(r, {
                  extra: (
                    <span className="inline-flex items-center gap-1 min-w-0">
                      <Star size={11} className="fill-amber-500 text-amber-500 flex-shrink-0" />
                      <span className="font-semibold text-amber-700 truncate">{expName}</span>
                    </span>
                  ),
                });
              })}
            </div>
          )}

          {/* Hotels tab content */}
          {mapMode === 'hotels' && (hotelsLoading && hotelPlaces.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="text-teal-600 animate-spin" />
              <span className="ml-3 text-sm text-on-surface/50 font-medium">Searching hotels...</span>
            </div>
          ) : filteredHotelPlaces.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Building2 size={32} className="text-on-surface/20 mb-3" />
              <p className="text-sm text-on-surface/40 font-medium">{activeFilterCount > 0 ? 'No hotels match your filters' : 'No hotels found'}</p>
              <p className="text-xs text-on-surface/30 mt-1">{activeFilterCount > 0 ? 'Try adjusting your filters' : 'Try moving the map to a different area'}</p>
            </div>
          ) : (
            <div className="divide-y divide-on-surface/[0.06]">
              {filteredHotelPlaces.map((place) => {
                const cityState = formatLocationLabel(place.addressComponents, place.fullAddress || place.address);
                return (
                  <div
                    key={place.id}
                    className={cn(
                      "flex gap-3 group cursor-pointer py-3 hover:bg-on-surface/[0.02] transition-colors",
                      selectedMarker === place.id && "bg-teal-500/5"
                    )}
                    onClick={() => focusPanelPlace(place)}
                  >
                    <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-muted self-center relative">
                      {place.photoUrl ? (
                        <img src={place.photoUrl} alt={place.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center bg-teal-50">
                          <Building2 size={20} className="text-teal-300" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <h3 className="font-serif font-bold text-[14px] leading-snug truncate">{place.name}</h3>
                      <p className="text-[10px] text-teal-700 font-semibold uppercase tracking-wider mt-0.5">Hotel</p>
                      {place.rating > 0 && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Star size={11} className="fill-teal-600 text-teal-600" />
                          <span className="text-xs font-bold text-teal-700">{place.rating.toFixed(1)}</span>
                          <span className="text-[11px] text-on-surface/40 ml-0.5">({place.userRatingCount})</span>
                        </div>
                      )}
                      <p className="text-[11px] text-on-surface/40 mt-0.5 truncate">{cityState}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {/* Recipes tab content — friends' public home meals */}
          {mapMode === 'recipes' && (
            friendRecipesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="text-emerald-600 animate-spin" />
                <span className="ml-3 text-sm text-on-surface/50 font-medium">Loading recipes...</span>
              </div>
            ) : friendRecipes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <ChefHat size={32} className="text-on-surface/20 mb-3" />
                <p className="text-sm text-on-surface/50 font-medium mb-1">No recipes from friends yet</p>
                <p className="text-xs text-on-surface/40 max-w-[240px]">
                  Recipes your friends share publicly will appear here. Add friends or follow someone to discover theirs.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-on-surface/[0.06]">
                {friendRecipes.map((meal) => {
                  const profile = recipeAuthorProfiles[meal.userId];
                  const authorName = profile?.display_name || profile?.username || 'Friend';
                  const authorInitial = (authorName || '?').charAt(0).toUpperCase();
                  const cover = meal.coverPhoto || meal.photos?.[0]?.url || '';
                  const totalMinutes = (meal.prepTime ?? 0) + (meal.cookTime ?? 0);
                  const totalLabel = totalMinutes > 0
                    ? (totalMinutes < 60 ? `${totalMinutes} min` : totalMinutes % 60 === 0 ? `${Math.floor(totalMinutes / 60)} hr` : `${Math.floor(totalMinutes / 60)} hr ${totalMinutes % 60} min`)
                    : '';
                  return (
                    <button
                      key={`${meal.userId}-${meal.id}`}
                      onClick={() => navigate(`/meal/${meal.userId}/${meal.id}`)}
                      className="w-full flex gap-3 cursor-pointer py-3 hover:bg-on-surface/[0.02] transition-colors group text-left"
                    >
                      <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-emerald-50 self-center">
                        {cover ? (
                          <img src={cover} alt={meal.name} loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-emerald-300">
                            <ChefHat size={22} />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <h3 className="font-serif font-bold text-[14px] leading-snug truncate">{meal.name}</h3>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {totalLabel && (
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700/80">{totalLabel}</span>
                          )}
                          {totalLabel && meal.difficulty && <span className="text-on-surface/20">·</span>}
                          {meal.difficulty && (
                            <span className="text-[10px] font-semibold text-on-surface/50">{meal.difficulty}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="w-4 h-4 rounded-full bg-emerald-100 text-[8px] font-bold text-emerald-700 flex items-center justify-center flex-shrink-0">
                            {authorInitial}
                          </span>
                          <span className="text-[11px] text-on-surface/40 truncate">{authorName}</span>
                        </div>
                      </div>
                      <div className="self-center flex-shrink-0">
                        <ChevronRight size={16} className="text-on-surface/25" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          )}

          {/* Discover tab content — integrated feed + search */}
          {mapMode === 'discover' && (
            <div className="space-y-4">
                  {/* ── Search mode content ── */}
                  {discoverSearchActive ? (
                    isSearching ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 size={24} className="text-primary animate-spin" />
                        <span className="ml-3 text-sm text-on-surface/50 font-medium">Searching restaurants...</span>
                      </div>
                    ) : !searchQuery.trim() ? (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <Search size={32} className="text-on-surface/15 mb-3" />
                        <p className="text-sm font-medium text-on-surface/40">Search restaurants</p>
                        <p className="text-xs text-on-surface/30 mt-1">Type a name, cuisine, or occasion</p>
                      </div>
                    ) : places.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <MapPinned size={32} className="text-on-surface/20 mb-3" />
                        <p className="text-sm text-on-surface/40 font-medium">No results found</p>
                        <p className="text-xs text-on-surface/30 mt-1">Try a different search</p>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between pt-2">
                          <h2 className="text-sm font-serif font-bold">Results</h2>
                          <span className="text-on-surface/40 text-[10px] font-bold uppercase tracking-widest">{places.length} found</span>
                        </div>
                        <div className="divide-y divide-on-surface/[0.06]">
                          {places.map((place) => renderPlaceCard(place))}
                        </div>
                      </>
                    )
                  ) : (
                  <>
                  {/* ── Feed mode: Recommendations first, then Nearby ── */}


                  {/* Nearby Restaurants — vertical list */}
                  {isSearching && places.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 size={20} className="text-primary animate-spin" />
                      <span className="ml-2 text-sm text-on-surface/50 font-medium">Finding nearby...</span>
                    </div>
                  ) : places.length > 0 ? (
                    <section className="mt-5">
                      <div className="flex items-center justify-between mb-3">
                        <h2 className="text-base font-serif font-bold">Nearby Restaurants</h2>
                        <span className="text-on-surface/40 text-[10px] font-bold uppercase tracking-widest">{places.length} found</span>
                      </div>
                      <div className="divide-y divide-on-surface/[0.06]">
                        {places.map((place) => renderPlaceCard(place))}
                      </div>
                    </section>
                  ) : null}
                  </>
                  )}
            </div>
          )}
        </div>
        </>
        )}
      </motion.div>
      )}

      </div>{/* inner map-area wrapper (contents on mobile, flex-1 on desktop) */}

      <GuidesBrowser
        open={guidesBrowserOpen}
        onClose={() => setGuidesBrowserOpen(false)}
        realGuides={browseGuides}
        onOpenGuide={(id) => navigate(`/guides/${id}`)}
        isMobile={!usingDesktopHeader}
      />
    </div>
  );
};
