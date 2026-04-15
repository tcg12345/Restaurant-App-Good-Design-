import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import { supabaseConfigured } from '../lib/supabase';
import { saveRecentViews } from '../lib/supabase-db';
import { getCommunityStats, getFriendsStats, getCommunityPhotos, getHotelDining, getVisitHistory, getExpertRecommendations, type CommunityStats, type FriendsStats, type CommunityPhoto, type HotelDining, type VisitRecord, type ExpertRecommendation } from '../lib/supabase-community';
import { useAuth } from '../contexts/AuthContext';
// @ts-ignore
import MapboxWorker from 'mapbox-gl/dist/mapbox-gl-csp-worker?worker';
import { getPlaceDetails, priceLevelToString, CUISINE_TYPES, type PlaceDetails } from '../lib/places';

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
    getPlaceDetails(id)
      .then(setPlace)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

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

  useEffect(() => {
    if (!place?.id) return;
    getCommunityStats(place.id).then(setCommunityStats);
    getCommunityPhotos(place.id).then(setCommunityPhotos);
    getExpertRecommendations(place.id).then(setExpertRecommendations);
    if (user?.id) {
      getFriendsStats(user.id, place.id).then(setFriendsStats);
      getVisitHistory(user.id, place.id).then(setVisitHistory);
    }
    // Fetch hotel dining if this place looks like a hotel
    const isHotel = place.types[0] === 'hotel' || place.types[0] === 'lodging';
    if (isHotel) getHotelDining(place.id).then(setHotelDiningOptions);
  }, [place?.id, user?.id]);

  const priceStr = place ? priceLevelToString(place.priceLevel) : '';
  const cuisine = place ? getCuisineLabel(place.types) : '';

  // Merge Google Places photos with community user-uploaded photos
  const photos = useMemo(() => {
    const googlePhotos = place
      ? place.photoUrls.length > 0 ? place.photoUrls : (place.photoUrl ? [place.photoUrl] : [])
      : [];
    const userPhotoUrls = communityPhotos.map((p) => p.url).filter((url) => url && url.length < 500000); // Skip oversized base64
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
