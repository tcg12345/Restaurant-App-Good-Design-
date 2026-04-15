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
  // We deliberately track the map container in STATE (via a callback ref)
  // rather than useRef. The Restaurant Detail page returns a loading
  // spinner while `place` is still being fetched, which means the map
  // <div> is not in the DOM during the loading→loaded transition. With a
  // plain useRef, the effect that depends on `[place]` fires the moment
  // `setPlace` runs but BEFORE `setLoading(false)` — so when the effect
  // runs, the container hasn't been mounted yet, `ref.current` is null,
  // and after the loader unmounts the effect never re-runs (deps didn't
  // change). A callback ref flips a state value on mount, which makes the
  // init effect re-run once the container actually exists.
  const [mapContainerEl, setMapContainerEl] = useState<HTMLDivElement | null>(null);
  const mapContainerRef = useCallback((el: HTMLDivElement | null) => {
    setMapContainerEl(el);
  }, []);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    getPlaceDetails(id)
      .then(setPlace)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!place || !mapContainerEl || !MAPBOX_TOKEN) return;
    // Guard against valid-but-zero coords from a partial response.
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: mapContainerEl,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [place.lng, place.lat],
      zoom: 15,
      interactive: true,
    });
    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');

    new mapboxgl.Marker({ color: '#9f3012' })
      .setLngLat([place.lng, place.lat])
      .addTo(map);

    // A ResizeObserver keeps the map in sync with the container size.
    // This fixes the "blank map" case where the container has zero
    // height/width at construction time (common when Mapbox is created
    // below the fold before the parent layout has fully settled) — Mapbox
    // caches the initial canvas size and will never repaint until told.
    const ro = new ResizeObserver(() => {
      try { map.resize(); } catch {}
    });
    ro.observe(mapContainerEl);
    // Belt-and-braces: one forced resize on the next frame picks up the
    // correct dimensions even in environments where ResizeObserver hasn't
    // fired yet (e.g. very fast initial paint).
    const rafId = requestAnimationFrame(() => {
      try { map.resize(); } catch {}
    });

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // Depend on the container element and the stable coord primitives so
    // the map is (re)created whenever the container mounts/unmounts or
    // the user navigates to a different restaurant.
  }, [mapContainerEl, place?.id, place?.lat, place?.lng]);

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
