import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import { attachMapErrorFallback } from '../lib/map-error';
import { supabaseConfigured } from '../lib/supabase';
import { saveRecentViews } from '../lib/supabase-db';
import { getCommunityStats, getFriendsStats, getCommunityPhotos, getHotelDining, getVisitHistory, getExpertRecommendations, type CommunityStats, type FriendsStats, type CommunityPhoto, type HotelDining, type VisitRecord, type ExpertRecommendation } from '../lib/supabase-community';
import { useAuth } from '../contexts/AuthContext';
import { useLists, readLocalVisitHistory, type LocalVisitRecord } from '../contexts/ListsContext';
// @ts-ignore
import MapboxWorker from 'mapbox-gl/dist/mapbox-gl-csp-worker?worker';
import { getPlaceDetails, resolvePlaceIdByNameCoords, priceLevelToString, CUISINE_TYPES, type PlaceDetails } from '../lib/places';
import { findMichelinMatch, michelinPriceDisplay, isMichelinSyntheticId, parseMichelinSyntheticId, type MichelinInfo } from '../lib/michelin';

// @ts-ignore
mapboxgl.workerClass = MapboxWorker;

const _mb = ['pk.eyJ1IjoidGcxMjM0N', 'TYiLCJhIjoiY21kN3g1Z', 'mJ4MG9iaTJpcHY5ajlld', 'XJ4OCJ9.MotLpY7BXT31', '0zCzDNJWwA'];
export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || _mb.join('');

export function formatReviewCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

export function getCuisineLabel(types: string[]): string {
  for (const t of types) {
    const match = CUISINE_TYPES.find((c) => c.type === t);
    if (match && match.label !== 'All') return match.label;
  }
  if (types.includes('restaurant')) return 'Restaurant';
  if (types.includes('cafe')) return 'Café';
  if (types.includes('bakery')) return 'Bakery';
  return 'Restaurant';
}

export function getTodayHours(hours: string[]): string {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  for (const line of hours) {
    const [day, ...timeParts] = line.split(': ');
    if (today.startsWith(day.toLowerCase().slice(0, 3))) {
      return timeParts.join(': ') || 'Hours not available';
    }
  }
  return 'Hours not available';
}

export function useRestaurantDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [place, setPlace] = useState<PlaceDetails | null>(null);
  const [michelin, setMichelin] = useState<MichelinInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);

  // Keep a stable ref to the latest place so the callback ref can read it
  // synchronously without closing over a stale value.
  const placeRef = useRef<PlaceDetails | null>(null);
  placeRef.current = place;

  // Holds the teardown closure for the current Mapbox instance so the
  // null-call of the callback ref can clean up without needing access to
  // the variables created in the div-call.
  const mapCleanupRef = useRef<(() => void) | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  // Why a callback ref instead of useRef + useEffect?
  //
  // The page renders a full-screen spinner while `place` is loading, so
  // the map <div> is NOT in the DOM during that window. Once the place
  // arrives and loading clears, the div mounts and the ref fires.
  //
  // A state-based callback ref (our previous approach) hits a React 18
  // StrictMode edge-case: StrictMode calls the ref null→div synchronously
  // during a single commit; React batches those two setState calls so the
  // final value looks unchanged, the useEffect never re-fires after the
  // simulated unmount, and the map is permanently blank in dev.
  //
  // Putting the init code directly inside the callback ref sidesteps
  // batching entirely:
  //   div call  → create map, store cleanup closure in mapCleanupRef
  //   null call → run the stored cleanup closure
  //
  // The div call always happens when loading===false && place!==null (the
  // only conditions that render the container div), so placeRef.current is
  // guaranteed to be non-null at that point.
  const mapContainerRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) {
      // Container unmounting (or StrictMode simulated unmount)
      if (mapCleanupRef.current) {
        mapCleanupRef.current();
        mapCleanupRef.current = null;
      }
      return;
    }

    // Container mounting. Guard against double-init if React calls the
    // ref twice with the same element.
    if (mapRef.current) return;

    const p = placeRef.current;
    if (!p || !MAPBOX_TOKEN) return;
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: el,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [p.lng, p.lat],
      zoom: 15,
      interactive: true,
    });
    attachMapErrorFallback(map, el);
    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
    new mapboxgl.Marker({ color: '#9f3012' }).setLngLat([p.lng, p.lat]).addTo(map);

    // ResizeObserver keeps the canvas in sync with the container size
    // (fixes "blank map" when the section is below the fold at init time).
    const ro = new ResizeObserver(() => { try { map.resize(); } catch {} });
    ro.observe(el);
    // Belt-and-braces one-shot resize on the next frame.
    const rafId = requestAnimationFrame(() => { try { map.resize(); } catch {} });

    // Store the full teardown so the null-call can invoke it.
    mapCleanupRef.current = () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []); // empty deps — all live data is accessed via refs

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    let cancelled = false;
    // A Michelin dataset-sourced row carries a synthetic id (name + coords) — no
    // Google place id. Resolve it to a real place id (text search near the
    // point) before fetching details. Falls back to the dataset name if Google
    // can't find it.
    const load = async () => {
      try {
        let placeId = id;
        if (isMichelinSyntheticId(id)) {
          const parsed = parseMichelinSyntheticId(id);
          const resolved = parsed
            ? await resolvePlaceIdByNameCoords(parsed.name, parsed.lat, parsed.lng)
            : null;
          if (!resolved) {
            throw new Error('Could not find this restaurant on the map.');
          }
          placeId = resolved;
        }
        const details = await getPlaceDetails(placeId);
        if (!cancelled) setPlace(details);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [id]);

  // Michelin Guide overlay: once the place loads, look it up in the bundled
  // 1/2/3-star dataset. Matching is coordinate-primary (lat/lng), with a
  // name-similarity check to confirm and disambiguate; address is only used
  // for the name-only fallback. A match drives the star badge, the "View on
  // Michelin Guide" button, and the cuisine/price overrides below. Only the
  // detail page consults this — search/lists/cards are unaffected.
  useEffect(() => {
    setMichelin(null);
    if (!place?.name) return;
    let cancelled = false;
    findMichelinMatch(place.name, place.lat, place.lng, place.fullAddress || place.address)
      .then((m) => { if (!cancelled) setMichelin(m); })
      .catch(() => { if (!cancelled) setMichelin(null); });
    return () => { cancelled = true; };
  }, [place?.id, place?.name, place?.lat, place?.lng, place?.fullAddress, place?.address]);

  // Track recently viewed restaurants
  useEffect(() => {
    if (!place) return;
    try {
      const key = 'gourmad-recent-views';
      const raw = localStorage.getItem(key);
      const views: any[] = raw ? JSON.parse(raw) : [];
      const entry = {
        id: place.id,
        name: place.name,
        image: place.photoUrl || '',
        rating: place.rating,
        priceLevel: place.priceLevel,
        address: place.address,
        fullAddress: place.fullAddress || place.address,
        types: place.types,
        userRatingCount: place.userRatingCount,
        viewedAt: Date.now(),
      };
      const filtered = views.filter((v: any) => v.id !== place.id);
      const next = [entry, ...filtered].slice(0, 20);
      localStorage.setItem(key, JSON.stringify(next));
      // Sync to Supabase
      if (user?.id && supabaseConfigured) saveRecentViews(user.id, next);
    } catch {}
  }, [place, user]);

  // Community & friends data
  const [communityStats, setCommunityStats] = useState<CommunityStats>({ avgScore: 0, totalRatings: 0, ratings: [] });
  const [friendsStats, setFriendsStats] = useState<FriendsStats>({ avgScore: 0, totalRatings: 0, ratings: [] });
  const [communityPhotos, setCommunityPhotos] = useState<CommunityPhoto[]>([]);
  const [expertRecommendations, setExpertRecommendations] = useState<ExpertRecommendation[]>([]);
  const [showFriendsDetail, setShowFriendsDetail] = useState(false);
  const [hotelDiningOptions, setHotelDiningOptions] = useState<HotelDining[]>([]);
  const [visitHistory, setVisitHistory] = useState<VisitRecord[]>([]);

  // Track the current user's rating for this place so we can re-fetch
  // visit history whenever it changes (e.g. after saving a new visit,
  // the previous rating is pushed into the visit_history table and we
  // need to see it reflected on the page without a hard reload).
  const { ratings, cacheRestaurantMeta } = useLists();

  // Cache the place's lat/lng on the meta so list cards can show distance.
  // Persist the FULL formatted address (rather than the truncated short
  // form) so the city/state extractor always has enough context — short
  // addresses often drop the country and state, which used to make cards
  // display the street name as a fake city. Keyed off place.id so we
  // don't write on every re-render.
  useEffect(() => {
    if (!place?.id || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return;
    cacheRestaurantMeta({
      id: place.id,
      name: place.name,
      image: place.photoUrl || '',
      cuisine: getCuisineLabel(place.types),
      price: priceLevelToString(place.priceLevel),
      address: place.fullAddress || place.address,
      lat: place.lat,
      lng: place.lng,
      addressComponents: place.addressComponents,
    });
  }, [place?.id, place?.lat, place?.lng, place?.addressComponents, cacheRestaurantMeta]);
  const myRatingForPlace = place ? ratings.find((r) => r.restaurantId === place.id) : null;
  // A simple fingerprint that changes whenever the rating for this
  // place is updated. Used as an effect dep below.
  const ratingFingerprint = myRatingForPlace
    ? `${myRatingForPlace.score}|${myRatingForPlace.visitDate}|${myRatingForPlace.notes}|${myRatingForPlace.createdAt ?? ''}`
    : '';

  useEffect(() => {
    if (!place?.id) return;
    // Community data is additive — on a failed fetch the section just keeps
    // its default empty state, but the rejection must be caught so it
    // doesn't surface as an unhandled-promise error.
    const warn = (what: string) => (err: unknown) =>
      console.warn(`[RestaurantDetail] ${what} fetch failed:`, err);
    getCommunityStats(place.id).then(setCommunityStats).catch(warn('community stats'));
    // Cover first (a single row) so the hero paints immediately even when a
    // restaurant has many heavy photos; then the full set fills in behind it
    // for the carousel + gallery. The cover only seeds an empty list so it
    // never clobbers the full result if that arrives first.
    getCommunityPhotos(place.id, 1)
      .then((cover) => setCommunityPhotos((prev) => (prev.length > 0 ? prev : cover)))
      .catch(warn('community cover photo'));
    getCommunityPhotos(place.id).then(setCommunityPhotos).catch(warn('community photos'));
    getExpertRecommendations(place.id).then(setExpertRecommendations).catch(warn('expert recommendations'));

    // Seed visit history from localStorage first so the UI reflects a
    // newly-saved visit immediately (Supabase write is async and may
    // not have completed yet, and the user may not be signed in at
    // all). Then fetch remote and merge, de-duping by id.
    const localRecs = readLocalVisitHistory(place.id);
    const toRecord = (l: LocalVisitRecord): VisitRecord => ({
      id: l.id,
      user_id: user?.id || 'local',
      restaurant_id: l.restaurantId,
      score: l.score,
      notes: l.notes,
      visit_date: l.visit_date,
      tags: l.tags,
      would_return: l.would_return,
      photos: l.photos,
      friend_ids: l.friend_ids,
      created_at: l.created_at,
    });
    const localMapped = localRecs.map(toRecord);
    setVisitHistory(localMapped);

    if (user?.id) {
      getFriendsStats(user.id, place.id).then(setFriendsStats).catch(warn('friends stats'));
      getVisitHistory(user.id, place.id).then((remote) => {
        // Merge by id, then sort newest first by visit_date (fall back
        // to created_at so records without an explicit visit date
        // still land in a stable spot).
        const byId = new Map<string, VisitRecord>();
        for (const r of [...localMapped, ...remote]) {
          byId.set(r.id, r);
        }
        const merged = Array.from(byId.values()).sort((a, b) => {
          const ad = a.visit_date || a.created_at || '';
          const bd = b.visit_date || b.created_at || '';
          return bd.localeCompare(ad);
        });
        setVisitHistory(merged);
      }).catch(warn('visit history'));
    }
    // Fetch hotel dining if this place looks like a hotel
    const isHotel = place.types[0] === 'hotel' || place.types[0] === 'lodging';
    if (isHotel) getHotelDining(place.id).then(setHotelDiningOptions).catch(warn('hotel dining'));
  }, [place?.id, user?.id, ratingFingerprint]);

  // Community-supplied price fallback: when Google has no priceLevel
  // for this place, take the mode of users' rated prices from the
  // already-loaded communityStats.ratings array so the hero still
  // shows a meaningful price tier instead of nothing.
  const communityPrice = useMemo<string>(() => {
    if (!communityStats.ratings || communityStats.ratings.length === 0) return '';
    const tally: Record<string, number> = {};
    for (const r of communityStats.ratings) {
      const p = (r.price || '').trim();
      if (!p) continue;
      tally[p] = (tally[p] || 0) + 1;
    }
    let best = '';
    let bestN = 0;
    for (const [p, n] of Object.entries(tally)) {
      if (n > bestN) { best = p; bestN = n; }
    }
    return best;
  }, [communityStats.ratings]);
  // Michelin data takes priority over Google Places for cuisine + price on the
  // detail page (falls back to Google/community values when there's no match).
  const priceStr = michelin
    ? michelinPriceDisplay(michelin)
    : place
      ? (priceLevelToString(place.priceLevel) || communityPrice || '')
      : '';
  const cuisine = michelin
    ? michelin.cuisine
    : place
      ? getCuisineLabel(place.types)
      : '';

  // Merge Google Places photos with community user-uploaded photos
  const photos = useMemo(() => {
    const googlePhotos = place
      ? place.photoUrls.length > 0 ? place.photoUrls : (place.photoUrl ? [place.photoUrl] : [])
      : [];
    // Show every real photo — only guard against pathologically huge / corrupt
    // rows (the old 500 KB cap silently dropped normal photos, which read as
    // "no photos" on the page).
    const userPhotoUrls = communityPhotos.map((p) => p.url).filter((url) => !!url && url.length < 12_000_000);
    return [...googlePhotos, ...userPhotoUrls];
  }, [place, communityPhotos]);
  const directionsUrl = place
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place.address)}&destination_place_id=${place.id}`
    : '';
  const mapsUrl = place
    ? `https://www.google.com/maps/place/?q=place_id:${place.id}`
    : '';

  return {
    place,
    michelin,
    loading,
    error,
    navigate,
    photoIndex,
    setPhotoIndex,
    hoursOpen,
    setHoursOpen,
    galleryOpen,
    setGalleryOpen,
    mapContainerRef,
    priceStr,
    cuisine,

    photos,
    directionsUrl,
    mapsUrl,

    communityStats,
    friendsStats,
    communityPhotos,
    expertRecommendations,
    showFriendsDetail,
    setShowFriendsDetail,
    hotelDiningOptions,
    refreshHotelDining: () => { if (place?.id) getHotelDining(place.id).then(setHotelDiningOptions); },
    visitHistory,
    visitCount: visitHistory.length,
  };
}
