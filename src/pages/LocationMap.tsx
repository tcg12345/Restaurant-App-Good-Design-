import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
// @ts-ignore - Vite worker import for mapbox-gl CSP compatibility
import MapboxWorker from 'mapbox-gl/dist/mapbox-gl-csp-worker?worker';
import 'mapbox-gl/dist/mapbox-gl.css';
import { ArrowLeft, ChevronDown, ChevronRight, ChevronUp, Loader2, MapPin } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';
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

const scoreBadgeClass = (score: number): string => {
  if (score >= 8) return 'border-emerald-600/50 bg-emerald-600/10 text-emerald-700';
  if (score >= 5) return 'border-amber-500/50 bg-amber-500/10 text-amber-700';
  if (score > 0) return 'border-red-500/50 bg-red-500/10 text-red-600';
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
  const { phoneMode } = useSettings();
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
      style: 'mapbox://styles/mapbox/light-v11',
      center,
      zoom: 12,
      attributionControl: false,
      maxBounds: initial.hasCoords ? buildBboxBounds(initial.lat, initial.lng) : undefined,
    });
    mapRef.current = map;
    map.on('load', () => {
      setMapReady(true);
      // Force a resize once load fires. Without this, mounting inside a
      // `fixed inset-0` parent that hadn't laid out yet can leave the
      // canvas at half height and the user sees "the map didn't load".
      map.resize();
    });
    return () => {
      clearMarkers();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const selectPlace = useCallback((place: PlaceResult, fly: boolean) => {
    setSelectedId(place.id);
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
    for (const place of places) {
      if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) continue;
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
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([place.lng, place.lat])
        .addTo(map);
      markersRef.current[place.id] = marker;
    }
  }, [places, mapReady, clearMarkers, selectPlace]);

  // Highlight the selected marker (scale + ring) without rebuilding the
  // whole marker set.
  useEffect(() => {
    for (const [id, marker] of Object.entries(markersRef.current) as Array<[string, mapboxgl.Marker]>) {
      const el = marker.getElement();
      const selected = id === selectedId;
      el.style.transform = `${el.style.transform.replace(/ scale\([^)]*\)/, '')}${selected ? ' scale(1.22)' : ''}`;
      el.style.boxShadow = selected
        ? '0 0 0 3px rgba(28,24,22,0.85), 0 4px 12px rgba(0,0,0,0.3)'
        : '0 2px 6px rgba(0,0,0,0.25)';
      el.style.zIndex = selected ? '5' : '1';
    }
  }, [selectedId, places, mapReady]);

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
    if (!hasCoords) return places;
    return [...places].sort((a, b) =>
      haversineDistanceMi(lat, lng, a.lat, a.lng)
      - haversineDistanceMi(lat, lng, b.lat, b.lng),
    );
  }, [places, hasCoords, lat, lng]);

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

  /* ── Desktop split layout ─────────────────────────────────────────── */
  if (!isMobile) {
    return (
      <div className="fixed inset-0 z-50 bg-surface overflow-hidden flex">
        {/* Side panel — chrome + scrollable restaurant list */}
        <aside className="w-[400px] max-w-[42vw] h-full flex flex-col flex-shrink-0 border-r border-on-surface/[0.08] bg-surface">
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
            <p className="mt-3 text-[11.5px] font-semibold uppercase tracking-wider text-on-surface/45 flex items-center gap-1.5">
              <MapPin size={12} className="text-primary/70" />
              {hydrating && sortedPlaces.length === 0
                ? 'Loading nearby spots…'
                : `${sortedPlaces.length} ${sortedPlaces.length === 1 ? 'place' : 'places'} · nearest first`}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain">
            {hydrating && sortedPlaces.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-16 text-on-surface/50 text-sm font-medium">
                <Loader2 size={15} className="animate-spin" />
                Finding restaurants…
              </div>
            ) : sortedPlaces.length === 0 ? (
              <div className="px-6 py-16 text-center text-on-surface/45 text-sm">
                No restaurants in {cityDisplay} yet.
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
                            'w-11 h-11 rounded-full border-2 grid place-items-center font-serif font-bold text-[13.5px] tabular-nums flex-shrink-0',
                            scoreBadgeClass(score),
                          )}
                        >
                          {score > 0 ? score.toFixed(1) : '—'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-serif text-[15.5px] font-bold text-on-surface leading-snug line-clamp-1">
                            {place.name}
                          </h3>
                          <p className="mt-0.5 text-[11px] text-on-surface/55 font-semibold uppercase tracking-wider flex items-center min-w-0">
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
        </aside>

        {/* Map pane */}
        <div className="relative flex-1 h-full min-w-0">
          <div ref={containerRef} className="absolute inset-0" />
          {hydrating && places.length === 0 && (
            <div className="absolute top-5 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full bg-white/95 shadow-md flex items-center gap-2 text-on-surface/60 text-xs font-semibold">
              <Loader2 size={14} className="animate-spin" />
              Loading restaurants in {cityDisplay}…
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── Mobile layout — full-bleed map + floating bar + bottom sheet ── */
  return (
    <div className="fixed inset-0 z-50 bg-surface overflow-hidden">
      {/* Map container — fills the viewport beneath the floating UI */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Sticky top bar — back to /location on the left, location picker
          centred so the user can swap cities without leaving the map. */}
      <div className="absolute top-0 inset-x-0 z-20 px-3 pt-safe-4 pb-3 bg-gradient-to-b from-surface/95 via-surface/85 to-transparent backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex-shrink-0 w-10 h-10 -ml-1 flex items-center justify-center rounded-full bg-white/95 shadow-sm text-on-surface/70 hover:text-on-surface"
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 min-w-0 px-3 py-2 rounded-2xl bg-white/95 shadow-sm">
            <HomeLocationBar
              location={currentLocation}
              onChange={handleLocationChange}
              onUseCurrent={handleUseCurrent}
            />
          </div>
        </div>
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
              <ul className="divide-y divide-on-surface/[0.06]">
                {sortedPlaces.map((place) => {
                  const { cuisine, priceLabel, distLabel, score } = placeFacts(place);
                  return (
                    <li key={place.id} className={cn(selectedId === place.id && 'bg-primary/5')}>
                      <button
                        type="button"
                        onClick={() => navigate(`/restaurant/${place.id}`)}
                        className="w-full flex items-start gap-3 py-3 px-1 text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <h3 className="font-serif text-[15px] font-bold text-on-surface line-clamp-1">
                            {place.name}
                          </h3>
                          <p className="mt-0.5 text-[11px] text-on-surface/55 font-medium uppercase tracking-wider truncate">
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
                              'mt-0.5 w-9 h-9 rounded-full border-2 grid place-items-center text-xs font-bold tabular-nums flex-shrink-0',
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
    </div>
  );
};
