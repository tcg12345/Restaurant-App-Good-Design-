import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import { attachMapErrorFallback } from '../lib/map-error';
// @ts-ignore - Vite worker import for mapbox-gl CSP compatibility
import MapboxWorker from 'mapbox-gl/dist/mapbox-gl-csp-worker?worker';
import 'mapbox-gl/dist/mapbox-gl.css';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Heart, Loader2, MapPin, SlidersHorizontal, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { scoreBadgeBg, scoreColor } from '../lib/score';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useBottomSheet } from '../lib/useBottomSheet';
import { RestaurantPanelBody, type RestaurantPanelSnapshot } from '../components/RestaurantPanel';
import { MichelinBadge } from '../components/MichelinBadge';
import { FilterSheet as FilterSheetShell } from '../components/FilterSheet';
import { FilterSection, PillRow, Pill, Segment, SegmentItem, FilterDropdown, HoursFilterSection } from '../components/filterPrimitives';
import { passesHoursFilter, isHoursFilterActive, emptyHoursFilter, type HoursFilter } from '../lib/hours';
import { MAPBOX_TOKEN } from './useRestaurantDetail';
import {
  HomeLocationBar,
  getCurrentHomeLocation,
  type HomeLocation,
} from '../components/HomeLocationBar';
import {
  cityCacheKey,
  readCachedCity,
  writeCachedCity,
} from '../lib/location-place-cache';
import {
  searchPlacesByTextPaged,
  priceLevelToString,
  CUISINE_TYPES,
  type PlaceResult,
} from '../lib/places';
import { haversineDistanceMi, formatDistance } from '../lib/distance';
import { useMichelinIndexReady } from '../lib/useMichelinMatch';
import { findMichelinMatchSync, michelinPriceDisplay } from '../lib/michelin';

/**
 * Dedicated full-screen map page for the city-explore restaurants
 * (/location/map). Shares the per-city placesPool cache with /location,
 * so opening the map after browsing the list is instant — and the
 * markers / list reflect exactly what's already loaded. When the cache
 * is cold (user reloads directly to /location/map) we run a small
 * fallback fetch so the map isn't empty.
 *
 * Layout adapts to the viewport:
 *  - Desktop: a side panel (city picker + scrollable restaurant list)
 *    next to a full-height map. Selecting a row flies the map to it;
 *    clicking a marker highlights + scrolls its row into view.
 *  - Mobile / phone preview: full-bleed map with a floating top bar
 *    and an expandable bottom sheet — the original design.
 *
 * The page renders as a fixed overlay ABOVE the app shell (z-50): in
 * the desktop sidebar layout the sticky header (z-40) and sidebar
 * otherwise paint over the map and bury its own chrome.
 *
 * The Mapbox map is locked to a bounding box around the selected
 * location so panning out of the area isn't possible — this is a
 * "what's near here" view, not a free browse. The location picker in
 * the header swaps cities without leaving the page.
 */

// CSP worker setup — same line as the home Map page so the production
// build doesn't barf on the worker URL.
mapboxgl.workerClass = MapboxWorker;

const RADIUS_MILES = 8; // matches /location's fetch radius
const RADIUS_DEG_LAT = RADIUS_MILES / 69; // ≈ 0.116°

// Map styles, keyed to the app's light/dark mode so the canvas matches
// the rest of the UI (same pair the home Discover map uses).
const MAP_STYLE_LIGHT = 'mapbox://styles/mapbox/light-v11';
const MAP_STYLE_DARK = 'mapbox://styles/mapbox/dark-v11';

function buildBboxBounds(lat: number, lng: number): mapboxgl.LngLatBoundsLike {
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLat = RADIUS_DEG_LAT;
  const dLng = RADIUS_DEG_LAT / cosLat;
  // Mapbox accepts [[swLng, swLat], [neLng, neLat]].
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat + dLat],
  ];
}

function cityKeyFromLabel(label: string): string {
  const parts = label.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  if (/^\s*\d/.test(parts[0]) && parts.length > 1) return parts[1];
  return parts[0];
}

const GOOGLE_TYPE_TO_CUISINE: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const entry of CUISINE_TYPES) {
    if (entry.type) out[entry.type] = entry.label;
  }
  return out;
})();

function inferCuisineLabel(types: string[]): string {
  for (const t of types) {
    const label = GOOGLE_TYPE_TO_CUISINE[t];
    if (label && label !== 'All') return label;
  }
  return '';
}

// Same quick-cuisine rotation as /location's sticky filter bar, mapped to
// the Google type strings the shared place pool carries.
const QUICK_CUISINES: Array<{ label: string; type: string }> = [
  { label: 'Japanese', type: 'japanese_restaurant' },
  { label: 'Italian', type: 'italian_restaurant' },
  { label: 'French', type: 'french_restaurant' },
  { label: 'Korean', type: 'korean_restaurant' },
  { label: 'American', type: 'american_restaurant' },
];

const PRICE_TIERS = [1, 2, 3, 4] as const;

// Match the shared ScoreBadge palette (soft pastel circle, green/amber/red)
// so the map's score rings read identically to scores everywhere else. The
// ring keeps a neutral "—" placeholder for the many unrated city results.
const scoreBadgeClass = (score: number): string => {
  if (score > 0) return cn(scoreBadgeBg(score), scoreColor(score));
  return 'border-on-surface/15 bg-on-surface/[0.04] text-on-surface/50';
};

// Marker pin background colour, mapped to the same green/amber/red scale
// the row score badges use so the map reads at a glance.
function markerColor(googleRating: number): string {
  // Google's 0–5 scale → the app's 0–10 scale = rating × 2.
  const score = googleRating * 2;
  if (score >= 8) return '#10b981'; // emerald-500
  if (score >= 5) return '#f59e0b'; // amber-500
  if (score > 0) return '#ef4444';  // red-500
  return '#6b7280';                  // gray-500 for unrated
}

export const LocationMap: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { phoneMode, darkMode } = useSettings();
  const { user } = useAuth();
  const { isWishlisted, toggleWishlist, restaurantMeta } = useLists();
  // Michelin dataset readiness — list rows override cuisine/price for
  // matched starred/Bib restaurants once it's loaded.
  const michelinReady = useMichelinIndexReady();
  const label = params.get('label') || 'Location';
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);

  // Same breakpoint the /location list page uses for its layout branch.
  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsNarrowViewport(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const isMobile = phoneMode || isNarrowViewport;

  const cityKey = useMemo(() => cityKeyFromLabel(label), [label]);
  const cityDisplay = useMemo(() => {
    const parts = label.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return 'Location';
    if (/^\s*\d/.test(parts[0]) && parts.length > 1) return parts.slice(1).join(', ');
    return label;
  }, [label]);

  // Pull from the same cache the list view writes to. We don't use the
  // price filter from the list — show every place we know about so the
  // map stays comprehensive — so use a price=0 cache key.
  const cacheKey = useMemo(
    () => (hasCoords ? cityCacheKey(lat, lng, cityKey, 0) : null),
    [hasCoords, lat, lng, cityKey],
  );

  const [places, setPlaces] = useState<PlaceResult[]>([]);
  const [hydrating, setHydrating] = useState(true);

  // In-page filters — same semantics as /location's sticky bar: cuisine
  // matches when any of the place's Google types is selected; price
  // matches the exact tier; min score gates on the 0–10 display scale.
  // Filters shrink what's shown (list + markers) from the pool we
  // already have; they never refetch. The quick chips and the Filters
  // sheet drive the same state, so they always agree.
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>([]);
  const [selectedPrice, setSelectedPrice] = useState(0);
  const [minScore, setMinScore] = useState(0);
  const [hoursFilter, setHoursFilter] = useState<HoursFilter>(emptyHoursFilter());
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  // Mobile header drives the location picker through HomeLocationBar's
  // headless/controlled mode so we can render our own compact pill trigger
  // (matching the back arrow) instead of its stacked "Dining in / label" block.
  const [locPickerOpen, setLocPickerOpen] = useState(false);
  const toggleCuisine = useCallback((type: string) => {
    setSelectedCuisines((prev) =>
      prev.includes(type) ? prev.filter((x) => x !== type) : [...prev, type],
    );
  }, []);
  const filtersActive = selectedCuisines.length > 0 || selectedPrice > 0 || minScore > 0;
  const activeFilterCount =
    selectedCuisines.length + (selectedPrice > 0 ? 1 : 0) + (minScore > 0 ? 1 : 0) + (isHoursFilterActive(hoursFilter) ? 1 : 0);
  const clearFilters = useCallback(() => {
    setSelectedCuisines([]);
    setSelectedPrice(0);
    setMinScore(0);
    setHoursFilter(emptyHoursFilter());
  }, []);

  const filteredPlaces = useMemo(() => {
    const hoursActive = isHoursFilterActive(hoursFilter);
    if (!filtersActive && !hoursActive) return places;
    const cuisineSet = new Set(selectedCuisines);
    const result = filtersActive
      ? places.filter((p) => {
          if (selectedPrice > 0 && p.priceLevel !== selectedPrice) return false;
          if (minScore > 0 && p.rating * 2 < minScore) return false;
          if (cuisineSet.size > 0) {
            let hit = false;
            for (const t of p.types) if (cuisineSet.has(t)) { hit = true; break; }
            if (!hit) return false;
          }
          return true;
        })
      : places;
    const out = hoursActive
      ? result.filter((p) => passesHoursFilter(restaurantMeta[p.id]?.hours, hoursFilter))
      : result;
    return out;
  }, [places, filtersActive, selectedCuisines, selectedPrice, minScore, hoursFilter, restaurantMeta]);

  // Hydrate from cache, then run a fallback fetch only when nothing's
  // there. This keeps the common "open list → tap map" flow cost-free.
  useEffect(() => {
    if (!hasCoords || !cacheKey) {
      setHydrating(false);
      return;
    }
    let cancelled = false;
    const cached = readCachedCity(cacheKey);
    if (cached && cached.placesPool.length > 0) {
      setPlaces(cached.placesPool);
      setHydrating(false);
      return;
    }
    setHydrating(true);
    (async () => {
      // Fallback fetch — three generic queries to seed the map. We
      // don't paginate here: the goal is to render markers fast, and
      // /location's load-more flow will keep enriching the cache for
      // the next visit.
      const queries = [
        `best restaurants in ${cityKey || 'the area'}`,
        `popular restaurants in ${cityKey || 'the area'}`,
        'best restaurants',
      ];
      const results = await Promise.all(
        queries.map((q) =>
          searchPlacesByTextPaged(q, {
            lat,
            lng,
            radiusMeters: 12875,
            useRestriction: true,
          }).catch(() => ({ places: [], nextPageToken: null as string | null })),
        ),
      );
      if (cancelled) return;
      const merged: PlaceResult[] = [];
      const seen = new Set<string>();
      for (const r of results) {
        for (const p of r.places) {
          if (seen.has(p.id)) continue;
          seen.add(p.id);
          merged.push(p);
        }
      }
      setPlaces(merged);
      setHydrating(false);
      // Persist into the shared cache so the list view's next read
      // benefits too.
      if (merged.length > 0) {
        writeCachedCity(cacheKey, {
          placesPool: merged,
          cursors: queries.map((q) => ({ query: q })),
          seenIds: Array.from(seen),
          exhausted: false,
          cuisinesKey: '',
        });
      }
    })();
    return () => { cancelled = true; };
  }, [hasCoords, cacheKey, lat, lng, cityKey]);

  // Mapbox initialisation. The map fills its pane (full viewport on
  // mobile; the right pane next to the list panel on desktop). Bounds
  // are locked to the city bbox — panning outside the rectangle is
  // rejected — so this stays a "what's around here" view rather than a
  // free browse.
  //
  // The init effect runs ONCE on mount (intentionally empty deps). An
  // earlier version listed [hasCoords, lat, lng] there; that tore the
  // map down and rebuilt it on every location change, so picking a new
  // city in the picker briefly emptied the canvas and sometimes left
  // it blank entirely. Recentring + bounds updates live in their own
  // effect below.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Record<string, mapboxgl.Marker>>({});
  const [mapReady, setMapReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Desktop list rows, keyed by place id, so a marker click can scroll
  // its row into view.
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({});
  // Latest coords held in a ref so the mount-only init effect can read
  // current values without taking them as deps. The recentre effect
  // below applies subsequent changes to the live map instance.
  const initialCoordsRef = useRef({ hasCoords, lat, lng });
  initialCoordsRef.current = { hasCoords, lat, lng };
  // Latest dark-mode flag in a ref so the mount-only init effect reads the
  // current value without taking it as a dependency (which would tear down
  // and rebuild the whole map on every theme toggle).
  const darkModeRef = useRef(darkMode);
  darkModeRef.current = darkMode;

  const clearMarkers = useCallback(() => {
    for (const m of Object.values(markersRef.current) as mapboxgl.Marker[]) m.remove();
    markersRef.current = {};
  }, []);

  useEffect(() => {
    if (!containerRef.current || !MAPBOX_TOKEN) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const initial = initialCoordsRef.current;
    // When we mount without coords (user landed on /location/map directly,
    // no URL params), drop a sensible default so the map still renders;
    // the recentre effect will fly to the real centre as soon as the
    // user picks one.
    const center: [number, number] = initial.hasCoords
      ? [initial.lng, initial.lat]
      : [-73.99, 40.74];
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: darkModeRef.current ? MAP_STYLE_DARK : MAP_STYLE_LIGHT,
      center,
      zoom: 12,
      attributionControl: false,
      maxBounds: initial.hasCoords ? buildBboxBounds(initial.lat, initial.lng) : undefined,
    });
    attachMapErrorFallback(map, containerRef.current);
    mapRef.current = map;
    map.on('load', () => {
      setMapReady(true);
      // Force a resize once load fires. Without this, mounting inside a
      // `fixed inset-0` parent that hadn't laid out yet can leave the
      // canvas at half height and the user sees "the map didn't load".
      map.resize();
    });
    // The container often reaches its final height AFTER the map has
    // already measured itself (the `fixed inset-0` overlay lays out a
    // frame or two later, and on iOS the safe-area insets resolve late).
    // When that happens the canvas stays stuck at its initial half-height
    // and the bottom of the map is blank white. A ResizeObserver re-syncs
    // the canvas to the container every time the box settles, which fixes
    // the partial-load reliably regardless of timing.
    let rafId = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => mapRef.current?.resize());
    });
    ro.observe(containerRef.current);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      clearMarkers();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow the app's light/dark mode — swap the Mapbox style when the
  // user toggles the theme. DOM markers survive a setStyle (Mapbox only
  // rebuilds the GL layers, not the marker overlay) so we don't need to
  // re-add them. Guarded so it never runs on the very first render (the
  // init effect already picks the right style from darkModeRef).
  const didInitStyleRef = useRef(false);
  useEffect(() => {
    if (!didInitStyleRef.current) {
      didInitStyleRef.current = true;
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    try {
      map.setStyle(darkMode ? MAP_STYLE_DARK : MAP_STYLE_LIGHT);
    } catch {
      /* style swap is best-effort */
    }
  }, [darkMode]);

  // Re-bound + re-centre on location change. We clear maxBounds before
  // moving the camera and re-apply afterwards because a flyTo whose
  // path passes through "outside the new bounds" can be cancelled
  // mid-flight by Mapbox; leaving bounds open during the jump avoids
  // that. Using jumpTo (instant) over flyTo (animated) on big city
  // changes also dodges the brief blank-tile state that animated pans
  // across hundreds of miles can leave on slow connections.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasCoords) return;
    map.setMaxBounds(null as unknown as mapboxgl.LngLatBoundsLike);
    map.jumpTo({ center: [lng, lat], zoom: 12 });
    map.setMaxBounds(buildBboxBounds(lat, lng));
    // The container may have changed size (e.g. user landed here from
    // the list and the sheet was at a different height); a resize on
    // every recentre keeps the canvas crisp.
    map.resize();
    setSelectedId(null);
    setDetailPlace(null);
  }, [hasCoords, lat, lng]);

  // The viewport can change size after mount (mobile keyboard dismiss,
  // bottom-sheet expand, browser-chrome appear, desktop↔mobile layout
  // swap) and Mapbox's canvas doesn't auto-resize.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onResize = () => map.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const id = requestAnimationFrame(() => map.resize());
    return () => cancelAnimationFrame(id);
  }, [isMobile]);

  // Inline restaurant detail — tapping a marker or a list row swaps the
  // side panel (desktop) / opens a slide-up sheet (mobile) showing the
  // same RestaurantPanelBody the main map page uses, instead of
  // navigating away to the full restaurant route.
  const [detailPlace, setDetailPlace] = useState<PlaceResult | null>(null);
  const closeDetail = useCallback(() => setDetailPlace(null), []);
  const { dragProps: detailDragProps, startDrag: startDetailDrag } =
    useBottomSheet(!!detailPlace && isMobile, closeDetail);

  const selectPlace = useCallback((place: PlaceResult, fly: boolean) => {
    setSelectedId(place.id);
    setDetailPlace(place);
    if (fly && mapRef.current) {
      mapRef.current.flyTo({ center: [place.lng, place.lat], zoom: 14, speed: 0.9 });
    }
  }, []);

  // Sync markers with the current places list. We tear down + rebuild
  // every change rather than diffing because the places list usually
  // either grows (cache top-up) or swaps wholesale (location change),
  // and a simple rebuild is easier to reason about.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    clearMarkers();
    for (const place of filteredPlaces) {
      if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) continue;
      // Two-element marker. Mapbox positions the OUTER wrapper by writing
      // `transform: translate(x, y)` to it on every frame of a pan/zoom,
      // so the wrapper must carry no transform transition — otherwise the
      // browser animates each translate step and the markers visibly lag
      // and float behind the map instead of staying pinned. The scale /
      // shadow animation lives on the INNER pill, where it's independent
      // of positioning.
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'width:36px;height:36px;line-height:0;';
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'location-map-marker';
      el.style.cssText = `
        width: 36px;
        height: 36px;
        border-radius: 9999px;
        display: flex;
        align-items: center;
        justify-content: center;
        font: 700 12px/1 ui-sans-serif, system-ui, sans-serif;
        color: white;
        background-color: ${markerColor(place.rating)};
        box-shadow: 0 2px 6px rgba(0,0,0,0.25);
        border: 2px solid white;
        cursor: pointer;
        font-variant-numeric: tabular-nums;
        transition: transform .18s ease, box-shadow .18s ease;
      `;
      el.textContent = place.rating > 0 ? (place.rating * 2).toFixed(1) : '·';
      el.addEventListener('click', () => {
        selectPlace(place, true);
        // Bring the matching desktop row into view.
        rowRefs.current[place.id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      wrapper.appendChild(el);
      const marker = new mapboxgl.Marker({ element: wrapper, anchor: 'center' })
        .setLngLat([place.lng, place.lat])
        .addTo(map);
      markersRef.current[place.id] = marker;
    }
  }, [filteredPlaces, mapReady, clearMarkers, selectPlace]);

  // Highlight the selected marker (scale + ring) without rebuilding the
  // whole marker set. We touch only the inner pill — never the wrapper's
  // transform — so the live Mapbox positioning is left alone.
  useEffect(() => {
    for (const [id, marker] of Object.entries(markersRef.current) as Array<[string, mapboxgl.Marker]>) {
      const wrapper = marker.getElement();
      const el = wrapper.firstElementChild as HTMLElement | null;
      if (!el) continue;
      const selected = id === selectedId;
      el.style.transform = selected ? 'scale(1.22)' : 'scale(1)';
      el.style.boxShadow = selected
        ? '0 0 0 3px rgba(28,24,22,0.85), 0 4px 12px rgba(0,0,0,0.3)'
        : '0 2px 6px rgba(0,0,0,0.25)';
      wrapper.style.zIndex = selected ? '5' : '1';
    }
  }, [selectedId, filteredPlaces, mapReady]);

  // Bottom sheet expand/collapse (mobile). "peek" shows just the handle
  // + a compact summary; "expanded" reveals the scrolling list.
  const [sheetExpanded, setSheetExpanded] = useState(false);

  // Resize the canvas after the sheet toggles. Without this Mapbox keeps
  // drawing at the previous container height, so the visible region
  // doesn't actually change when the user expands the sheet.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Defer one frame so the sheet's height transition has actually
    // started laying out the new size before Mapbox samples.
    const id = requestAnimationFrame(() => map.resize());
    return () => cancelAnimationFrame(id);
  }, [sheetExpanded]);

  const currentLocation: HomeLocation | null = hasCoords
    ? { label: cityDisplay, lat, lng }
    : null;

  const handleLocationChange = useCallback((loc: HomeLocation) => {
    navigate(
      `/location/map?label=${encodeURIComponent(loc.label)}&lat=${loc.lat}&lng=${loc.lng}`,
      { replace: true },
    );
  }, [navigate]);

  const handleUseCurrent = useCallback(async (): Promise<void> => {
    const loc = await getCurrentHomeLocation();
    handleLocationChange(loc);
  }, [handleLocationChange]);

  // Sort the list by distance from the city centre — that's what people
  // scanning a map are looking for ("show me what's nearest").
  const sortedPlaces = useMemo(() => {
    if (!hasCoords) return filteredPlaces;
    return [...filteredPlaces].sort((a, b) =>
      haversineDistanceMi(lat, lng, a.lat, a.lng)
      - haversineDistanceMi(lat, lng, b.lat, b.lng),
    );
  }, [filteredPlaces, hasCoords, lat, lng]);

  // Cuisine + price chips, shared by the desktop panel and the mobile
  // floating strip — only the container styling differs per surface.
  const renderFilterChips = (overlay: boolean, includeFiltersButton = true) => {
    const base = overlay
      ? 'flex-shrink-0 inline-flex items-center h-8 px-3.5 rounded-full text-[12.5px] font-semibold whitespace-nowrap transition-colors bg-white/95 shadow-sm text-on-surface/70'
      : 'flex-shrink-0 inline-flex items-center h-8 px-3.5 rounded-full text-[12.5px] font-semibold whitespace-nowrap transition-colors bg-on-surface/[0.05] hover:bg-on-surface/[0.09] text-on-surface/70';
    const active = overlay
      ? 'flex-shrink-0 inline-flex items-center h-8 px-3.5 rounded-full text-[12.5px] font-semibold whitespace-nowrap transition-colors bg-on-surface text-surface shadow-sm'
      : 'flex-shrink-0 inline-flex items-center h-8 px-3.5 rounded-full text-[12.5px] font-semibold whitespace-nowrap transition-colors bg-on-surface text-surface';
    return (
      <>
        <button
          type="button"
          onClick={clearFilters}
          className={!filtersActive ? active : base}
        >
          All
        </button>
        {QUICK_CUISINES.map((c) => (
          <button
            key={c.type}
            type="button"
            onClick={() => toggleCuisine(c.type)}
            className={selectedCuisines.includes(c.type) ? active : base}
          >
            {c.label}
          </button>
        ))}
        <span className={cn('flex-shrink-0 w-px h-4 self-center', overlay ? 'bg-on-surface/20' : 'bg-on-surface/15')} />
        {PRICE_TIERS.map((tier) => (
          <button
            key={tier}
            type="button"
            onClick={() => setSelectedPrice((p) => (p === tier ? 0 : tier))}
            aria-label={`Price ${'$'.repeat(tier)}`}
            className={selectedPrice === tier ? active : base}
          >
            {'$'.repeat(tier)}
          </button>
        ))}
        {includeFiltersButton && (
          <>
            <span className={cn('flex-shrink-0 w-px h-4 self-center', overlay ? 'bg-on-surface/20' : 'bg-on-surface/15')} />
            {/* Full Filters sheet — same popup chrome as the rest of the app. */}
            <button
              type="button"
              onClick={() => setFilterSheetOpen(true)}
              aria-label="Open filters"
              className={cn(base, 'gap-1.5')}
            >
              <SlidersHorizontal size={13} className="opacity-80" />
              Filters
              {activeFilterCount > 0 && (
                <span className="inline-grid place-items-center min-w-[17px] h-[17px] px-1 rounded-full bg-primary text-white text-[10.5px] font-bold">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </>
        )}
      </>
    );
  };

  // One row of restaurant facts, shared by the desktop panel and the
  // mobile sheet so the two layouts stay in lockstep.
  const placeFacts = useCallback((place: PlaceResult) => {
    const mich = michelinReady
      ? findMichelinMatchSync(place.name, place.lat, place.lng, place.fullAddress || place.address)
      : null;
    const cuisine = mich ? mich.cuisine : inferCuisineLabel(place.types);
    const priceLabel = mich ? michelinPriceDisplay(mich) : priceLevelToString(place.priceLevel);
    const distLabel = hasCoords
      ? formatDistance(haversineDistanceMi(lat, lng, place.lat, place.lng))
      : '';
    const score = place.rating > 0 ? place.rating * 2 : 0;
    return { cuisine, priceLabel, distLabel, score };
  }, [michelinReady, hasCoords, lat, lng]);

  // Inline restaurant detail — the same RestaurantPanelBody the main map
  // page embeds on marker tap (noHero so it composes inside our own
  // chrome). Desktop swaps the side panel content; mobile slides it up
  // as a sheet over the map.
  const renderDetail = (place: PlaceResult) => {
    const { cuisine, priceLabel, distLabel } = placeFacts(place);
    const mich = michelinReady
      ? findMichelinMatchSync(place.name, place.lat, place.lng, place.fullAddress || place.address)
      : null;
    const fav = isWishlisted(place.id);
    const snapshot: RestaurantPanelSnapshot = {
      id: place.id,
      name: place.name,
      cuisine,
      price: priceLabel,
      address: place.fullAddress || place.address || '',
      image: place.photoUrl || undefined,
      score: place.rating > 0 ? place.rating : undefined,
      distanceMi: hasCoords ? haversineDistanceMi(lat, lng, place.lat, place.lng) : undefined,
    };
    const topChrome = (
      <div className="px-5 pt-4 pb-4">
        <div className="flex items-center justify-between gap-3">
          {isMobile ? (
            <button
              type="button"
              onClick={closeDetail}
              aria-label="Close"
              className="w-9 h-9 -ml-1 rounded-full border border-on-surface/10 flex items-center justify-center text-on-surface/70 hover:bg-on-surface/[0.04] transition-colors"
            >
              <X size={16} />
            </button>
          ) : (
            <button
              type="button"
              onClick={closeDetail}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-on-surface/55 hover:text-on-surface transition-colors -ml-1 px-1 py-1 rounded-md"
            >
              <ChevronLeft size={14} />
              Back to list
            </button>
          )}
          <button
            type="button"
            onClick={() => toggleWishlist({
              id: place.id,
              name: place.name,
              image: place.photoUrl || '',
              cuisine,
              price: priceLabel,
              address: place.fullAddress || place.address || '',
              lat: Number.isFinite(place.lat) ? place.lat : undefined,
              lng: Number.isFinite(place.lng) ? place.lng : undefined,
            })}
            aria-label={fav ? 'Remove from wishlist' : 'Save to wishlist'}
            aria-pressed={fav}
            className={cn(
              'w-9 h-9 rounded-full border flex items-center justify-center transition-colors flex-shrink-0',
              fav ? 'border-red-200 bg-red-50/70 text-red-500' : 'border-on-surface/10 hover:bg-on-surface/[0.04] text-on-surface/70',
            )}
            title={fav ? 'Saved' : 'Save'}
          >
            <Heart size={15} className={fav ? 'fill-current' : ''} />
          </button>
        </div>

        <h1 className="font-serif font-bold text-[24px] leading-[1.15] tracking-tight text-on-surface mt-3">
          {place.name}
        </h1>
        {mich && (
          <div className="mt-2">
            <MichelinBadge michelin={mich} size="sm" href={mich.guideUrl} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[12.5px] text-on-surface/65">
          {cuisine && <span className="font-semibold text-primary tracking-tight">{cuisine}</span>}
          {cuisine && priceLabel && <span className="text-on-surface/25">·</span>}
          {priceLabel && <span className="font-semibold tabular-nums">{priceLabel}</span>}
          {distLabel && (
            <>
              {(cuisine || priceLabel) && <span className="text-on-surface/25">·</span>}
              <span className="inline-flex items-center gap-1 tabular-nums">
                <MapPin size={11} className="text-on-surface/45" />
                {distLabel}
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
          onClose={closeDetail}
          currentUserId={user?.id ?? null}
          noHero
          topChrome={topChrome}
        />
      </div>
    );
  };

  // Full Filters popup — shared FilterSheet chrome (same as Discover,
  // Pantry, wishlist…). Drives the very same state as the quick chips.
  const filterSheetNode = (
    <FilterSheetShell
      open={filterSheetOpen}
      onClose={() => setFilterSheetOpen(false)}
      title="Filters"
      subtitle={activeFilterCount > 0 ? `${activeFilterCount} active` : undefined}
      onReset={clearFilters}
    >
      <FilterSection label="Price">
        <Segment>
          <SegmentItem active={selectedPrice === 0} onClick={() => setSelectedPrice(0)}>Any</SegmentItem>
          {PRICE_TIERS.map((tier) => (
            <SegmentItem
              key={tier}
              active={selectedPrice === tier}
              onClick={() => setSelectedPrice((p) => (p === tier ? 0 : tier))}
            >
              {'$'.repeat(tier)}
            </SegmentItem>
          ))}
        </Segment>
      </FilterSection>
      <HoursFilterSection value={hoursFilter} onChange={setHoursFilter} />
      <FilterSection label="Minimum score" sub="Google rating mapped to the app's 0–10 scale.">
        <PillRow>
          {([[0, 'Any'], [7, '7+'], [8, '8+'], [9, '9+']] as const).map(([v, l]) => (
            <Pill key={v} active={minScore === v} onClick={() => setMinScore(v)}>{l}</Pill>
          ))}
        </PillRow>
      </FilterSection>
      <FilterSection label="Cuisine">
        <FilterDropdown
          options={CUISINE_TYPES.filter((c) => c.type !== '').map((c) => ({ value: c.type, label: c.label }))}
          selected={selectedCuisines}
          onToggle={toggleCuisine}
          placeholder="All cuisines"
          searchPlaceholder="Search cuisines"
        />
      </FilterSection>
    </FilterSheetShell>
  );

  /* ── Desktop split layout ─────────────────────────────────────────── */
  if (!isMobile) {
    return (
      <div className="fixed inset-0 z-50 bg-surface overflow-hidden flex">
        {/* Side panel — list chrome, or the inline restaurant detail when
            a marker / row is selected (same swap the main map page does). */}
        <aside className="w-[400px] max-w-[42vw] h-full flex flex-col flex-shrink-0 border-r border-on-surface/[0.08] bg-surface">
          {detailPlace ? renderDetail(detailPlace) : (
          <>
          <div className="px-5 pt-5 pb-4 border-b border-on-surface/[0.06]">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="flex-shrink-0 w-9 h-9 -ml-1 flex items-center justify-center rounded-full bg-on-surface/[0.05] hover:bg-on-surface/[0.1] text-on-surface/70 hover:text-on-surface transition-colors"
                aria-label="Back"
              >
                <ArrowLeft size={18} />
              </button>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">Map view</p>
                <h1 className="font-serif font-semibold text-[22px] leading-tight text-on-surface truncate">
                  {cityDisplay}
                </h1>
              </div>
            </div>
            {/* City picker — swap locations without leaving the map. */}
            <div className="mt-3 px-3 py-2 rounded-2xl bg-on-surface/[0.04]">
              <HomeLocationBar
                location={currentLocation}
                onChange={handleLocationChange}
                onUseCurrent={handleUseCurrent}
              />
            </div>
            {/* Cuisine + price filters — trim the list and the markers. */}
            <div className="mt-3 flex gap-1.5 overflow-x-auto no-scrollbar -mx-5 px-5">
              {renderFilterChips(false)}
            </div>
            <p className="mt-3 text-[11.5px] font-semibold uppercase tracking-wider text-on-surface/45 flex items-center gap-1.5">
              <MapPin size={12} className="text-primary/70" />
              {hydrating && places.length === 0
                ? 'Loading nearby spots…'
                : `${sortedPlaces.length} ${sortedPlaces.length === 1 ? 'place' : 'places'} · nearest first`}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain">
            {hydrating && places.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-16 text-on-surface/50 text-sm font-medium">
                <Loader2 size={15} className="animate-spin" />
                Finding restaurants…
              </div>
            ) : sortedPlaces.length === 0 ? (
              <div className="px-6 py-16 text-center text-on-surface/45 text-sm">
                {filtersActive && places.length > 0 ? (
                  <>
                    Nothing matches these filters.
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="block mx-auto mt-3 px-4 h-9 rounded-full bg-on-surface/[0.06] hover:bg-on-surface/[0.1] text-on-surface/75 text-[12.5px] font-semibold transition-colors"
                    >
                      Clear filters
                    </button>
                  </>
                ) : (
                  <>No restaurants in {cityDisplay} yet.</>
                )}
              </div>
            ) : (
              <ul className="px-3 py-3 space-y-1">
                {sortedPlaces.map((place) => {
                  const { cuisine, priceLabel, distLabel, score } = placeFacts(place);
                  const selected = selectedId === place.id;
                  return (
                    <li key={place.id} ref={(el) => { rowRefs.current[place.id] = el; }}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => selectPlace(place, true)}
                        onKeyDown={(e) => { if (e.key === 'Enter') selectPlace(place, true); }}
                        className={cn(
                          'group flex items-center gap-3 px-3 py-3 rounded-2xl cursor-pointer transition-colors',
                          selected ? 'bg-on-surface/[0.06]' : 'hover:bg-on-surface/[0.035]',
                        )}
                      >
                        <div
                          className={cn(
                            'w-11 h-11 rounded-full border grid place-items-center font-serif font-bold text-[13.5px] tabular-nums flex-shrink-0',
                            scoreBadgeClass(score),
                          )}
                        >
                          {score > 0 ? score.toFixed(1) : '—'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-serif text-[15.5px] font-bold text-on-surface leading-snug line-clamp-1">
                            {place.name}
                          </h3>
                          <p className="mt-0.5 text-[12.5px] text-on-surface/55 font-medium flex items-center min-w-0">
                            <span className="truncate">
                              {cuisine || 'Restaurant'}
                              {priceLabel && <span className="text-on-surface/25 mx-1.5">·</span>}
                              {priceLabel}
                            </span>
                            {distLabel && (
                              <span className="flex-shrink-0 whitespace-nowrap">
                                <span className="text-on-surface/25 mx-1.5">·</span>
                                {distLabel}
                              </span>
                            )}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); navigate(`/restaurant/${place.id}`); }}
                          aria-label={`Open ${place.name}`}
                          className={cn(
                            'w-8 h-8 rounded-full grid place-items-center text-on-surface/40 hover:text-on-surface hover:bg-on-surface/[0.07] transition-all flex-shrink-0',
                            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                          )}
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          </>
          )}
        </aside>

        {/* Map pane */}
        <div className="relative flex-1 h-full min-w-0">
          <div ref={containerRef} className="absolute inset-0" style={{ position: 'absolute', inset: 0 }} />
          {hydrating && places.length === 0 && (
            <div className="absolute top-5 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full bg-white/95 shadow-md flex items-center gap-2 text-on-surface/60 text-xs font-semibold">
              <Loader2 size={14} className="animate-spin" />
              Loading restaurants in {cityDisplay}…
            </div>
          )}
        </div>

        {filterSheetNode}
      </div>
    );
  }

  /* ── Mobile layout — full-bleed map + floating bar + bottom sheet ── */
  return (
    <div className="fixed inset-0 z-50 bg-surface overflow-hidden">
      {/* Map container — fills the viewport beneath the floating UI */}
      <div ref={containerRef} className="absolute inset-0" style={{ position: 'absolute', inset: 0 }} />

      {/* Top bar — fully transparent (no gradient, no blur) so the map
          shows through to the very top. The controls float over it as
          individual pills: back arrow, a compact location pill that matches
          the arrow, and the Filters trigger pulled up beside them. */}
      <div className="absolute top-0 inset-x-0 z-20 px-3 pt-safe-4 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex-shrink-0 w-10 h-10 -ml-1 flex items-center justify-center rounded-full bg-white/95 shadow-sm text-on-surface/70 hover:text-on-surface"
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
          {/* Compact location pill — hugs its label (no "Dining in" eyebrow,
              no full-width stretch). Opens the picker via the headless
              HomeLocationBar rendered below. */}
          <button
            type="button"
            onClick={() => setLocPickerOpen(true)}
            className="flex-shrink-0 inline-flex items-center gap-1.5 h-10 pl-3 pr-3.5 rounded-full bg-white/95 shadow-sm text-on-surface min-w-0 max-w-[58%]"
            aria-label="Change location"
          >
            <MapPin size={15} className="text-on-surface/55 flex-shrink-0" />
            <span className="font-serif font-bold text-[15px] leading-none truncate">{cityDisplay}</span>
            <ChevronDown size={15} className="text-on-surface/45 flex-shrink-0" />
          </button>
          {/* Filters — moved up from the row below, sits to the right. */}
          <button
            type="button"
            onClick={() => setFilterSheetOpen(true)}
            aria-label="Filters"
            className="flex-shrink-0 ml-auto inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full bg-white/95 shadow-sm text-on-surface/75 text-[13px] font-semibold"
          >
            <SlidersHorizontal size={15} className="opacity-75" />
            Filters
            {activeFilterCount > 0 && (
              <span className="inline-grid place-items-center min-w-[17px] h-[17px] px-1 rounded-full bg-primary text-white text-[10.5px] font-bold">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
        {/* Cuisine + price chips — the Filters button now lives on the row
            above, so it's omitted here. */}
        <div className="mt-2 flex gap-1.5 overflow-x-auto no-scrollbar -mx-3 px-3">
          {renderFilterChips(true, false)}
        </div>
        {/* Headless location picker — driven by the compact pill above. */}
        <HomeLocationBar
          variant="headless"
          location={currentLocation}
          onChange={handleLocationChange}
          onUseCurrent={handleUseCurrent}
          open={locPickerOpen}
          onOpenChange={setLocPickerOpen}
        />
      </div>

      {/* Empty / loading state — overlay near the top once the bar has
          its own breathing room. We only show this when we genuinely
          have nothing to render so the map's own tiles can dominate. */}
      {hydrating && places.length === 0 && (
        <div className="absolute top-28 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full bg-white/95 shadow-md flex items-center gap-2 text-on-surface/60 text-xs font-semibold">
          <Loader2 size={14} className="animate-spin" />
          Loading restaurants in {cityDisplay}…
        </div>
      )}
      {!hydrating && places.length === 0 && (
        <div className="absolute top-28 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full bg-white/95 shadow-md text-on-surface/60 text-xs font-semibold">
          No restaurants in {cityDisplay} yet.
        </div>
      )}

      {/* Bottom sheet — peek shows a one-line summary; expanded reveals
          the full scrolling list. CSS transition on max-height gives the
          slide a smooth feel without dragging Framer's height-animation
          edge cases (vh strings, auto-detect) into the picture. */}
      <div
        className={cn(
          'absolute bottom-0 inset-x-0 z-20 bg-surface rounded-t-3xl shadow-[0_-8px_24px_rgba(0,0,0,0.08)] overflow-hidden transition-[max-height] duration-300 ease-out',
          sheetExpanded ? 'max-h-[70vh]' : 'max-h-[64px]',
        )}
      >
        <button
          type="button"
          onClick={() => setSheetExpanded((v) => !v)}
          className="w-full flex flex-col items-center pt-2 pb-1"
          aria-label={sheetExpanded ? 'Collapse list' : 'Expand list'}
        >
          <div className="w-10 h-1 rounded-full bg-on-surface/15" />
          <div className="mt-2 flex items-center justify-between w-full px-5">
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-primary/70" />
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface/60">
                {sortedPlaces.length} {sortedPlaces.length === 1 ? 'place' : 'places'} in {cityDisplay}
              </span>
            </div>
            {sheetExpanded ? (
              <ChevronDown size={16} className="text-on-surface/45" />
            ) : (
              <ChevronUp size={16} className="text-on-surface/45" />
            )}
          </div>
        </button>

        <AnimatePresence initial={false}>
          {sheetExpanded && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="overflow-y-auto px-4 pb-6"
              style={{ maxHeight: 'calc(70vh - 60px)' }}
            >
              {sortedPlaces.length === 0 && filtersActive && places.length > 0 && (
                <div className="py-8 text-center text-on-surface/45 text-sm">
                  Nothing matches these filters.
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="block mx-auto mt-3 px-4 h-9 rounded-full bg-on-surface/[0.06] text-on-surface/75 text-[12.5px] font-semibold"
                  >
                    Clear filters
                  </button>
                </div>
              )}
              <ul className="divide-y divide-on-surface/[0.06]">
                {sortedPlaces.map((place) => {
                  const { cuisine, priceLabel, distLabel, score } = placeFacts(place);
                  return (
                    <li key={place.id} className={cn(selectedId === place.id && 'bg-primary/5')}>
                      <button
                        type="button"
                        onClick={() => selectPlace(place, false)}
                        className="w-full flex items-start gap-3 py-3 px-1 text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <h3 className="font-serif text-[15px] font-bold text-on-surface line-clamp-1">
                            {place.name}
                          </h3>
                          <p className="mt-0.5 text-[12.5px] text-on-surface/55 font-medium truncate">
                            {cuisine || 'Restaurant'}
                            {priceLabel && <span className="text-on-surface/25 mx-1.5">·</span>}
                            {priceLabel}
                            {distLabel && <span className="text-on-surface/25 mx-1.5">·</span>}
                            {distLabel}
                          </p>
                        </div>
                        {score > 0 && (
                          <div
                            className={cn(
                              'mt-0.5 w-9 h-9 rounded-full border grid place-items-center text-xs font-bold tabular-nums flex-shrink-0',
                              scoreBadgeClass(score),
                            )}
                          >
                            {score.toFixed(1)}
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Selected place detail — slide-up sheet reusing the same
          RestaurantPanelBody the desktop panel embeds, so tapping a
          marker or a sheet row opens this instead of navigating away. */}
      <AnimatePresence>
        {detailPlace && (
          <motion.div
            key="loc-map-detail-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 z-[60] bg-black/45 backdrop-blur-sm"
            onClick={closeDetail}
          />
        )}
        {detailPlace && (
          <motion.div
            key="loc-map-detail-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320, mass: 0.9 }}
            {...detailDragProps}
            className="absolute left-0 right-0 bottom-0 z-[61] bg-surface rounded-t-[1.75rem] overflow-hidden flex flex-col ring-1 ring-on-surface/[0.08] shadow-[0_-20px_60px_rgba(0,0,0,0.22)]"
            style={{ height: '92%' }}
          >
            {/* Grab strip — swipe down anywhere on it to dismiss. */}
            <div
              className="flex justify-center pt-2.5 pb-1.5 flex-shrink-0 cursor-grab active:cursor-grabbing"
              style={{ touchAction: 'none' }}
              onPointerDown={startDetailDrag}
            >
              <div className="w-10 h-1.5 rounded-full bg-on-surface/15" />
            </div>
            <div className="flex-1 min-h-0">
              {renderDetail(detailPlace)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {filterSheetNode}
    </div>
  );
};
