import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import { attachMapErrorFallback } from '../lib/map-error';
import { supabaseConfigured } from '../lib/supabase';
import { saveRecentViews } from '../lib/supabase-db';
import { getCommunityStats, getFriendsStats, getCommunityPhotos, getVisitHistory, getExpertRecommendations, type CommunityStats, type FriendsStats, type CommunityPhoto, type VisitRecord, type ExpertRecommendation } from '../lib/supabase-community';
import { useAuth } from '../contexts/AuthContext';
import { useLists, readLocalVisitHistory, type LocalVisitRecord } from '../contexts/ListsContext';
// @ts-ignore
import MapboxWorker from 'mapbox-gl/dist/mapbox-gl-csp-worker?worker';
import { getPlaceDetails, resolvePlaceIdByNameCoords, priceLevelToString, type PlaceDetails } from '../lib/places';
import { cuisineLabel, type CuisineSource } from '../lib/cuisine';
import { settleRestaurantCuisine } from '../lib/restaurant-cuisine';
import { findMichelinMatch, michelinPriceDisplay, isMichelinSyntheticId, parseMichelinSyntheticId, type MichelinInfo } from '../lib/michelin';

// @ts-ignore
mapboxgl.workerClass = MapboxWorker;

import { MAPBOX_TOKEN } from '../lib/keys';
import { buildDirectionsUrl } from '../lib/directions';
import { useBlobPhotos } from '../lib/useBlobPhotos';

// The base64→blob conversion + cache moved to the shared useBlobPhotos hook
// (src/lib/useBlobPhotos.ts) so RestaurantPanel and any other community-photo
// surface renders reliably on iOS too. Re-exported here for compatibility.
export { dataUrlToBlobUrl } from '../lib/useBlobPhotos';

export function formatReviewCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

/**
 * A place's cuisine label, or '' when we genuinely don't know.
 *
 * Thin wrapper over lib/cuisine so every call site shares one resolution
 * order. Accepts a whole place OR a bare `types` array — passing the place
 * is strictly better, since that's what carries `primaryType` and
 * `primaryTypeDisplayName`.
 *
 * It used to answer 'Restaurant' when it had nothing, which read as a real
 * cuisine everywhere downstream: rural places showed "Restaurant" as their
 * cuisine and saved ratings carried it, which is how profile top lists grew
 * a "Restaurant" category. Unknown is '' now and drops out of the meta
 * lines, which are all built with .filter(Boolean).
 */
export function getCuisineLabel(source: string[] | CuisineSource): string {
  return cuisineLabel(Array.isArray(source) ? { types: source } : source);
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
  /** Cuisine settled through the shared cache (migration 068) — the answer
   *  when Google's payload has none, and the write that gives every other
   *  screen this place's cuisine. '' until it resolves. */
  const [settledCuisine, setSettledCuisine] = useState('');
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
      // Decorative locator only (matches RestaurantPanel): both page
      // variants cover the canvas with a full-bleed "open full map"
      // button, so pan/zoom and a NavigationControl would be dead chrome
      // the user can see but never reach.
      interactive: false,
    });
    attachMapErrorFallback(map, el);
    mapRef.current = map;

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
  // base64 data-URL → blob object-URL map, so the iOS web view can render
  // them (shared hook — see src/lib/useBlobPhotos.ts).
  const photoBlobMap = useBlobPhotos(communityPhotos);
  const [expertRecommendations, setExpertRecommendations] = useState<ExpertRecommendation[]>([]);
  const [showFriendsDetail, setShowFriendsDetail] = useState(false);
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
    if (!place?.id) return;
    let cancelled = false;
    void settleRestaurantCuisine({
      restaurantId: place.id,
      name: place.name,
      michelinCuisine: michelin?.cuisine,
      place,
    }).then((settled) => { if (!cancelled) setSettledCuisine(settled); });
    return () => { cancelled = true; };
  }, [place, michelin]);

  // Michelin names the cuisine outright; otherwise Google's payload, and
  // failing that whatever the shared cache settled on for this place.
  const cuisine = michelin
    ? michelin.cuisine
    : (place ? getCuisineLabel(place) : '') || settledCuisine;

  useEffect(() => {
    if (!place?.id || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return;
    cacheRestaurantMeta({
      id: place.id,
      name: place.name,
      image: place.photoUrl || '',
      cuisine: cuisine || getCuisineLabel(place),
      price: priceLevelToString(place.priceLevel),
      address: place.fullAddress || place.address,
      lat: place.lat,
      lng: place.lng,
      addressComponents: place.addressComponents,
      // The details fetch already carries hours — write them (with a
      // freshness stamp) so cards stop serving a stale cached schedule.
      ...(place.hours != null ? { hours: place.hours, hoursFetchedAt: Date.now() } : {}),
    });
    // `cuisine` is a dep so the cached meta is rewritten once the shared
    // cache settles a place Google had nothing for.
  }, [place?.id, place?.lat, place?.lng, place?.addressComponents, cuisine, cacheRestaurantMeta]);
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

  // Load community photos: the cover first (one tiny row → instant hero), then
  // the full set behind it. getCommunityPhotos returns [] on error/timeout, and
  // a many-photo restaurant's big request is exactly what fails on a cold load
  // — so the original `.then(setCommunityPhotos)` was wiping the cover back out
  // (photos showed nothing on the first visit but were fine on the second, once
  // the response was cached). We only let a non-empty result replace what's
  // shown; the `cancelled` guard stops a stale fetch writing one restaurant's
  // photos onto the next when the user navigates quickly.
  useEffect(() => {
    const id = place?.id;
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const cover = await getCommunityPhotos(id, 1);
        if (cancelled) return;
        if (cover.length > 0) setCommunityPhotos(cover);
        const all = await getCommunityPhotos(id);
        if (cancelled) return;
        // Only a non-empty result replaces what's shown — a failed/timed-out
        // full fetch returns [] and must NOT wipe the cover.
        if (all.length > 0) setCommunityPhotos(all);
      } catch (err) {
        if (!cancelled) console.warn('[RestaurantDetail] community photos fetch failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [place?.id]);

  // Merge Google Places photos with community user-uploaded photos
  const photos = useMemo(() => {
    const googlePhotos = place
      ? place.photoUrls.length > 0 ? place.photoUrls : (place.photoUrl ? [place.photoUrl] : [])
      : [];
    // Prefer the blob URL for base64 photos (iOS render fix); fall back to the
    // raw url. Show every real photo — only guard against pathologically huge
    // / corrupt rows (the old 500 KB cap silently dropped normal photos).
    const userPhotoUrls = communityPhotos
      .map((p) => photoBlobMap[p.url] || p.url)
      .filter((url) => !!url && (url.startsWith('blob:') || url.length < 12_000_000));
    return [...googlePhotos, ...userPhotoUrls];
  }, [place, communityPhotos, photoBlobMap]);

  // Community photos with base64 URLs swapped for their blob equivalents, so
  // the gallery renders reliably on iOS too (same blob URLs the `photos`
  // array uses, so its Google-vs-community split still lines up).
  const communityPhotosDisplay = useMemo(
    () => communityPhotos.map((p) => (photoBlobMap[p.url] ? { ...p, url: photoBlobMap[p.url] } : p)),
    [communityPhotos, photoBlobMap],
  );
  const directionsUrl = place
    ? buildDirectionsUrl({
        placeId: place.id,
        address: place.fullAddress || place.address,
        name: place.name,
        lat: place.lat,
        lng: place.lng,
      }) || ''
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
    communityPhotos: communityPhotosDisplay,
    expertRecommendations,
    showFriendsDetail,
    setShowFriendsDetail,
    visitHistory,
    visitCount: visitHistory.length,
  };
}
