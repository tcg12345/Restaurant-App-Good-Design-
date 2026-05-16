import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
// @ts-ignore - Vite worker import for mapbox-gl CSP compatibility
import MapboxWorker from 'mapbox-gl/dist/mapbox-gl-csp-worker?worker';
import 'mapbox-gl/dist/mapbox-gl.css';
import { ArrowLeft, ChevronDown, ChevronUp, Loader2, MapPin } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
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

/**
 * Map view of the city-explore restaurants. Shares the per-city
 * placesPool cache with /location, so opening the map after browsing
 * the list is instant — and the markers / list reflect exactly what's
 * already loaded. When the cache is cold (user reloads directly to
 * /location/map) we run a small fallback fetch so the map isn't empty.
 *
 * The Mapbox map is locked to a bounding box around the selected
 * location so panning out of the area isn't possible — this is a
 * "what's near here" view, not a free browse.
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

const scoreBg = (rating: number): string => {
  if (rating >= 8) return 'bg-emerald-500';
  if (rating >= 5) return 'bg-amber-500';
  return 'bg-red-500';
};

export const LocationMap: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const label = params.get('label') || 'Location';
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);

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

  // Mapbox initialisation. The map sits behind the sticky header + the
  // bottom sheet, filling the viewport. Bounds are locked to the city
  // bbox — panning outside the rectangle is rejected — so this stays a
  // "what's around here" view rather than a free browse.
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
  // Latest coords held in a ref so the mount-only init effect can read
  // current values without taking them as deps. The recentre effect
  // below applies subsequent changes to the live map instance.
  const initialCoordsRef = useRef({ hasCoords, lat, lng });
  initialCoordsRef.current = { hasCoords, lat, lng };

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
      for (const m of Object.values(markersRef.current)) (m as mapboxgl.Marker).remove();
      markersRef.current = {};
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
  }, [hasCoords, lat, lng]);

  // The viewport can change size after mount (mobile keyboard dismiss,
  // bottom-sheet expand, browser-chrome appear) and Mapbox's canvas
  // doesn't auto-resize. Listen on window resize + on sheet toggle so
  // the canvas stays correctly sized.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onResize = () => map.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Sync markers with the current places list. We tear down + rebuild
  // every change rather than diffing because the places list usually
  // either grows (cache top-up) or swaps wholesale (location change),
  // and a simple rebuild is easier to reason about.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const m of Object.values(markersRef.current)) m.remove();
    markersRef.current = {};
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
      `;
      el.textContent = place.rating > 0 ? (place.rating * 2).toFixed(1) : '·';
      el.addEventListener('click', () => {
        setSelectedId(place.id);
        map.flyTo({ center: [place.lng, place.lat], zoom: 14, speed: 0.8 });
      });
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([place.lng, place.lat])
        .addTo(map);
      markersRef.current[place.id] = marker;
    }
  }, [places, mapReady]);

  // Bottom sheet expand/collapse. "peek" shows just the handle + a
  // compact summary; "expanded" reveals the scrolling list of
  // restaurants. Tap the handle (or the summary) to toggle.
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

  // Sort the sheet list by distance from the city centre — that's what
  // people scanning a map are looking for ("show me what's nearest").
  const sortedPlaces = useMemo(() => {
    if (!hasCoords) return places;
    return [...places].sort((a, b) =>
      haversineDistanceMi(lat, lng, a.lat, a.lng)
      - haversineDistanceMi(lat, lng, b.lat, b.lng),
    );
  }, [places, hasCoords, lat, lng]);

  return (
    <div className="fixed inset-0 bg-surface overflow-hidden">
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
                  const cuisine = inferCuisineLabel(place.types);
                  const priceLabel = priceLevelToString(place.priceLevel);
                  const distMi = hasCoords
                    ? haversineDistanceMi(lat, lng, place.lat, place.lng)
                    : 0;
                  const distLabel = hasCoords ? formatDistance(distMi) : '';
                  return (
                    <li key={place.id} className={cn(selectedId === place.id && 'bg-primary/5')}>
                      <Link
                        to={`/restaurant/${place.id}`}
                        className="flex items-start gap-3 py-3 px-1"
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
                        {place.rating > 0 && (
                          <div
                            className={cn(
                              'mt-0.5 w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold tabular-nums flex-shrink-0',
                              scoreBg(place.rating * 2),
                            )}
                          >
                            {(place.rating * 2).toFixed(1)}
                          </div>
                        )}
                      </Link>
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
