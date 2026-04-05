import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Star, Heart, Plus, Navigation, SlidersHorizontal, Users, MapPinned, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Layers, X, Box, Square, Loader2, ArrowUpDown, UtensilsCrossed, DollarSign, Check, Building2, Clock, Sparkles, MapPin, ArrowLeft, ChevronsUp } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
// @ts-ignore - Vite worker import for mapbox-gl CSP compatibility
import MapboxWorker from 'mapbox-gl/dist/mapbox-gl-csp-worker?worker';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';
import { useLists } from '../contexts/ListsContext';
import { useAuth } from '../contexts/AuthContext';
import { getUserRatings, getAllFriendRatings, getExpertRatings, getProfilesByIds, publishCommunityRating, type CommunityRating, type UserProfile } from '../lib/supabase-community';
import { searchNearbyRestaurants, searchPlacesByText, searchHotels, priceLevelToString, CUISINE_TYPES, type PlaceResult } from '../lib/places';
import { getCuisineLabel } from './useRestaurantDetail';
import { RestaurantCard } from '../components/RestaurantCard';
import { SocialFeed } from '../components/SocialFeed';

import { supabaseConfigured } from '../lib/supabase';
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

const QUICK_FILTERS = ['Near Me', 'Hotels', 'Italian', 'Fine Dining', 'Sushi', 'Mexican'];

// US state name → abbreviation
const STATE_ABBR: Record<string, string> = {
  'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
  'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
  'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS',
  'Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA',
  'Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT',
  'Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM',
  'New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK',
  'Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
  'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
  'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY',
  'District of Columbia':'DC',
};

// Extract "City, ST" from full or short address
function extractCityState(fullAddress: string, shortAddress: string): string {
  // fullAddress is like "123 Main St, Westport, CT 06880, USA"
  // Try to extract city and state from fullAddress
  const parts = fullAddress.split(',').map((s) => s.trim());
  if (parts.length >= 3) {
    const city = parts[parts.length - 3]; // e.g. "Westport"
    const stateZip = parts[parts.length - 2]; // e.g. "CT 06880"
    const state = stateZip?.replace(/\d+/g, '').trim(); // e.g. "CT"
    if (city && state && state.length <= 3) return `${city}, ${state}`;
    // If state part is longer (like country name), try city only
    if (city) return city;
  }
  // Fallback: use second part of short address
  const shortParts = shortAddress.split(',').map((s) => s.trim());
  if (shortParts.length >= 2) return shortParts.slice(1).join(', ');
  return shortParts[0] || '';
}

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
    image: place.photoUrl || 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&q=80&w=800',
    rating: place.rating,
    price: priceLevelToString(place.priceLevel),
    cuisine: extractCityState(place.fullAddress, place.address),
    address: place.address,
    friendReviews: 0,
    expertReviews: 0,
  };
}

// Module-level cache for tab data (persists across navigations within same session)
const tabDataCache: {
  ts: number;
  userId: string | null;
  myRatings: CommunityRating[];
  friendRatings: CommunityRating[];
  expertRatings: CommunityRating[];
  friendProfiles: Record<string, UserProfile>;
  expertProfiles: Record<string, UserProfile>;
  coordsLookedUp: Record<string, boolean>;
  discoverPlaces: PlaceResult[];
  discoverTs: number;
} = { ts: 0, userId: null, myRatings: [], friendRatings: [], expertRatings: [], friendProfiles: {}, expertProfiles: {}, coordsLookedUp: {}, discoverPlaces: [], discoverTs: 0 };
const TAB_CACHE_TTL = 3 * 60 * 1000; // 3 minutes

export const Map: React.FC = () => {
  const navigate = useNavigate();
  const { setHideBottomNav, phoneMode } = useSettings();
  const { openAddRestaurantModal, openWishlistModal, isWishlisted, ratings: myLocalRatings, lists: myLists } = useLists();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  // Data for My Ratings and Friends tabs — initialized from cache if fresh
  const cacheHit = userId && tabDataCache.userId === userId && (Date.now() - tabDataCache.ts) < TAB_CACHE_TTL;
  const [myRatings, setMyRatings] = useState<CommunityRating[]>(cacheHit ? tabDataCache.myRatings : []);
  const [friendRatings, setFriendRatings] = useState<CommunityRating[]>(cacheHit ? tabDataCache.friendRatings : []);
  const [friendProfiles, setFriendProfiles] = useState<Record<string, UserProfile>>(cacheHit ? tabDataCache.friendProfiles : {});
  const [expertProfiles, setExpertProfiles] = useState<Record<string, UserProfile>>(cacheHit ? tabDataCache.expertProfiles : {});
  const [expertRatings, setExpertRatings] = useState<CommunityRating[]>(cacheHit ? tabDataCache.expertRatings : []);
  const [tabDataLoaded, setTabDataLoaded] = useState(!!cacheHit);

  // Load data for non-discover tabs (skipped if cache was fresh)
  useEffect(() => {
    if (!userId || tabDataLoaded) return;
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
      // Update module-level cache
      tabDataCache.ts = Date.now();
      tabDataCache.userId = userId;
      tabDataCache.myRatings = myR;
      tabDataCache.friendRatings = friendR;
      tabDataCache.expertRatings = expertR;
      tabDataCache.friendProfiles = profs;
      tabDataCache.expertProfiles = expProfs;
    })();
  }, [userId, tabDataLoaded]);
  const [mapMode, setMapModeRaw] = useState<'discover' | 'myratings' | 'friends' | 'experts' | 'hotels'>(() => {
    const saved = sessionStorage.getItem('map-mode');
    return (saved === 'myratings' || saved === 'friends' || saved === 'experts' || saved === 'hotels') ? saved : 'discover';
  });
  const setMapMode = (mode: 'discover' | 'myratings' | 'friends' | 'experts' | 'hotels') => {
    setMapModeRaw(mode);
    sessionStorage.setItem('map-mode', mode);
    // Reset rating filters when switching modes
    setRatingSortBy('recent');
    setScoreRange([0, 10]);
    setRatingCuisines([]);
    setRatingPrice(null);
    setRatingCities([]);
    setWouldReturnFilter('all');
  };
  const [hotelPlaces, setHotelPlaces] = useState<PlaceResult[]>([]);
  const [hotelsLoading, setHotelsLoading] = useState(false);
  const hotelMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const mapModeRef = useRef(mapMode);
  mapModeRef.current = mapMode;
  const [mapModeDropdownOpen, setMapModeDropdownOpen] = useState(false);
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
  const [activeStyle, setActiveStyle] = useState<string>('light');
  const [showStylePicker, setShowStylePicker] = useState(false);
  const [is3D, setIs3D] = useState(false);
  const [places, setPlaces] = useState<PlaceResult[]>(() =>
    (Date.now() - tabDataCache.discoverTs) < TAB_CACHE_TTL ? tabDataCache.discoverPlaces : []
  );
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSheetOpen, setFilterSheetOpenRaw] = useState(false);
  const setFilterSheetOpen = useCallback((show: boolean) => {
    setFilterSheetOpenRaw(show);
    setHideBottomNav(show);
    if (!show) { setFilterCuisineOpen(false); setFilterCuisineSearch(''); setFilterCityOpen(false); setFilterCitySearch(''); setFilterFriendOpen(false); setFilterFriendSearch(''); }
  }, [setHideBottomNav]);

  // Filter state — discover
  const [sortBy, setSortBy] = useState<SortOption>('popularity');
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>([]);
  const [selectedPrice, setSelectedPrice] = useState(0);
  const [discoverRadius, setDiscoverRadius] = useState(5); // km

  // Filter state — ratings modes (myratings / friends / experts)
  const [ratingSortBy, setRatingSortBy] = useState<'recent' | 'highest' | 'lowest' | 'visited'>('recent');
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 10]);
  const [ratingCuisines, setRatingCuisines] = useState<string[]>([]);
  const [ratingPrice, setRatingPrice] = useState<string | null>(null);
  const [ratingCities, setRatingCities] = useState<string[]>([]);
  const [wouldReturnFilter, setWouldReturnFilter] = useState<'all' | 'yes' | 'no'>('all');

  // Filter state — hotels
  const [hotelStarFilter, setHotelStarFilter] = useState<number>(0); // 0=Any, 3/4/5
  const [hotelPriceFilter, setHotelPriceFilter] = useState(0);
  const [hotelSortBy, setHotelSortBy] = useState<'popularity' | 'rating' | 'price_low'>('popularity');

  // Filter sheet dropdown search state
  const [filterCuisineOpen, setFilterCuisineOpen] = useState(false);
  const [filterCuisineSearch, setFilterCuisineSearch] = useState('');
  const [filterCityOpen, setFilterCityOpen] = useState(false);
  const [filterCitySearch, setFilterCitySearch] = useState('');
  const [filterFriendOpen, setFilterFriendOpen] = useState(false);
  const [filterFriendSearch, setFilterFriendSearch] = useState('');

  const [showSearchHere, setShowSearchHere] = useState(false);

  // Location search
  const [locationSearchOpen, setLocationSearchOpen] = useState(false);
  const [locationQuery, setLocationQuery] = useState('');
  const [locationResults, setLocationResults] = useState<Array<{ id: string; name: string; lat: number; lng: number }>>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationInputRef = useRef<HTMLInputElement>(null);
  const [searchLocationBias, setSearchLocationBias] = useState<{ lat: number; lng: number } | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<{ [id: string]: mapboxgl.Marker }>({});
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchWrapperRef = useRef<HTMLFormElement>(null);
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMarkerSelectedRef = useRef(false); // tracks if a marker is actively selected (suppresses re-fetch)
  const expertOverlayMarkersRef = useRef<mapboxgl.Marker[]>([]); // expert markers shown in discover mode
  const filtersRef = useRef({ sortBy: 'popularity' as SortOption, selectedCuisines: [] as string[], selectedPrice: 0 });

  // Keep ref in sync with state so the moveend callback sees current values
  useEffect(() => {
    filtersRef.current = { sortBy, selectedCuisines, selectedPrice };
  }, [sortBy, selectedCuisines, selectedPrice]);

  // Bottom sheet state — tri-state: peek (collapsed), half (partial), full (full-screen discover)
  const [sheetState, setSheetState] = useState<'peek' | 'half' | 'full'>('peek');
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartYRef = useRef(0);
  const dragCurrentYRef = useRef(0);
  const isDraggingRef = useRef(false);
  const PEEK_HEIGHT = 165;
  const FULL_HEIGHT = typeof window !== 'undefined' ? window.innerHeight : 800;
  const HALF_HEIGHT = typeof window !== 'undefined' ? window.innerHeight * 0.85 : 680;
  const getSheetY = (state: 'peek' | 'half' | 'full') => {
    if (state === 'full') return 0;
    if (state === 'half') return FULL_HEIGHT - HALF_HEIGHT;
    return FULL_HEIGHT - PEEK_HEIGHT;
  };

  // ── Discover feed state ──
  const [discoverSearchActive, setDiscoverSearchActive] = useState(false);
  const NEARBY_INITIAL = 4;
  const NEARBY_INCREMENT = 12;
  const [nearbyShowCount, setNearbyShowCount] = useState(NEARBY_INITIAL);
  const [activeQuickFilter, setActiveQuickFilter] = useState<string | null>(null);
  const preSearchPlacesRef = useRef<PlaceResult[]>([]);

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

  // Build preference profile from user's HIGH-rated restaurants (score >= 7).
  // Recommendations are only curated based on what the user actually loved.
  const userPreferences = useMemo(() => {
    const cuisineScores: Record<string, number> = {};
    const priceCounts: Record<number, number> = {};
    const highRated = myLocalRatings.filter((r) => r.score >= 7);
    highRated.forEach((r) => {
      // Weight by how much above 7 the score is (7→1, 10→4)
      const weight = Math.max(1, r.score - 6);
      if (r.cuisine) cuisineScores[r.cuisine] = (cuisineScores[r.cuisine] || 0) + weight;
      r.tags.forEach((t) => { cuisineScores[t] = (cuisineScores[t] || 0) + weight * 0.5; });
      const priceNum = r.price.length;
      if (priceNum > 0) priceCounts[priceNum] = (priceCounts[priceNum] || 0) + weight;
    });
    const topCuisines = Object.entries(cuisineScores).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);
    // Most common city/state among high-rated restaurants, for location anchoring
    const cityCounts: Record<string, number> = {};
    highRated.forEach((r) => {
      const city = extractCityState(r.address || '', r.address || '');
      if (city) cityCounts[city] = (cityCounts[city] || 0) + 1;
    });
    const topCity = Object.entries(cityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    return { cuisineScores, priceCounts, topCuisines, topCity, highRatedCount: highRated.length };
  }, [myLocalRatings]);

  // API-based curated recommendations (not derived from recently viewed).
  const [apiRecommendations, setApiRecommendations] = useState<PlaceResult[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const recsFetchedRef = useRef(false);

  const recommendations = apiRecommendations;

  // User's top rated restaurants
  const topRated = useMemo(() => {
    return [...myLocalRatings].filter((r) => r.score >= 7 && r.image).sort((a, b) => b.score - a.score).slice(0, 6);
  }, [myLocalRatings]);

  // Fetch curated API recommendations once high-rated restaurants are loaded.
  useEffect(() => {
    if (recsFetchedRef.current) return;
    if (userPreferences.highRatedCount === 0 || userPreferences.topCuisines.length === 0) return;
    recsFetchedRef.current = true;
    const ratedIds = new Set(myLocalRatings.map((r) => r.restaurantId));
    const wishlistedIds = new Set(myLists.flatMap((l) => l.wishlistIds || []));
    const recentIds = new Set(recentViews.map((v) => v.id));
    // Anchor queries to the current map view so recs are near where the user is exploring
    const center = mapRef.current?.getCenter();
    const lat = center?.lat ?? 40.735;
    const lng = center?.lng ?? -73.99;
    setRecsLoading(true);
    const queries = userPreferences.topCuisines.slice(0, 3).map((cuisine) =>
      searchPlacesByText(`best ${cuisine} restaurants`, lat, lng).catch(() => [] as PlaceResult[])
    );
    Promise.all(queries).then((results) => {
      // Interleave results across cuisines for variety
      const interleaved: PlaceResult[] = [];
      const maxLen = Math.max(...results.map((r) => r.length));
      for (let i = 0; i < maxLen; i++) {
        for (const list of results) if (list[i]) interleaved.push(list[i]);
      }
      const seen = new Set<string>();
      const fresh = interleaved.filter((p) => {
        if (seen.has(p.id) || ratedIds.has(p.id) || wishlistedIds.has(p.id) || recentIds.has(p.id)) return false;
        // Only keep well-rated spots (≥4.0) with enough reviews
        if ((p.rating || 0) < 4.0 || (p.userRatingCount || 0) < 30) return false;
        seen.add(p.id);
        return true;
      });
      setApiRecommendations(fresh.slice(0, 8));
      setRecsLoading(false);
    });
  }, [userPreferences.highRatedCount, userPreferences.topCuisines, myLocalRatings, myLists, recentViews]);

  // Quick filter handler for discover search
  const handleQuickFilter = useCallback(async (filter: string) => {
    const map = mapRef.current;
    if (!map) return;
    if (activeQuickFilter === filter) {
      setActiveQuickFilter(null);
      fetchNearbyRef.current?.();
      return;
    }
    setActiveQuickFilter(filter);
    setIsSearching(true);
    setShowSearchHere(false);
    try {
      const center = map.getCenter();
      let results: PlaceResult[];
      if (filter === 'Hotels') {
        setMapMode('hotels');
        results = await searchHotels('hotels', center.lat, center.lng);
        setHotelPlaces(results);
        setIsSearching(false);
        return;
      } else if (filter === 'Near Me') {
        results = await searchNearbyRestaurants(center.lat, center.lng, 1000, [], 0);
      } else {
        results = await searchPlacesByText(filter, center.lat, center.lng);
      }
      setPlaces(results);
      syncMarkersRef.current?.(results);
      if (results.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        results.forEach((p) => bounds.extend([p.lng, p.lat]));
        map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 1000 });
      }
    } catch (err) {
      console.error('Quick filter search failed:', err);
    } finally {
      setIsSearching(false);
    }
  }, [activeQuickFilter]);

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

  // Build a lookup of user's own ratings by restaurant ID
  const userRatingMap = useMemo(() => {
    const lookup: Record<string, number> = {};
    myLocalRatings.forEach((r) => { lookup[r.restaurantId] = Number(r.score) || 0; });
    return lookup;
  }, [myLocalRatings]);

  // Create a marker element for a place — color/size by user rating
  const createMarkerElement = useCallback((place: PlaceResult) => {
    const userScore = userRatingMap[place.id];
    const hasRating = userScore !== undefined;
    // Score color: green >= 8, amber >= 5, red < 5
    let ringColor = 'transparent';
    let dotColor = '';
    let size = 36; // default
    if (hasRating) {
      if (userScore >= 8) { ringColor = '#16a34a'; dotColor = '#16a34a'; size = 42; }
      else if (userScore >= 5) { ringColor = '#d97706'; dotColor = '#d97706'; size = 39; }
      else { ringColor = '#dc2626'; dotColor = '#dc2626'; size = 36; }
    }
    const iconSize = Math.round(size * 0.5);

    const el = document.createElement('div');
    el.className = 'mapbox-custom-marker';
    el.innerHTML = `
      <div class="marker-pin" data-id="${place.id}" style="
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background: white;
        border: ${hasRating ? `2.5px solid ${ringColor}` : '2px solid transparent'};
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transform: scale(0.4);
        transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
      ">
        ${hasRating ? `<span style="font-size:${Math.round(size * 0.30)}px;font-weight:800;color:${dotColor};line-height:1;">${userScore.toFixed(1)}</span>` : `
        <svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>`}
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
  }, [userRatingMap]);

  // Show popup for a place
  // Use refs for callbacks so DOM event handlers always get the latest
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const openAddRestaurantModalRef = useRef(openAddRestaurantModal);
  openAddRestaurantModalRef.current = openAddRestaurantModal;
  const openWishlistModalRef = useRef(openWishlistModal);
  openWishlistModalRef.current = openWishlistModal;

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
      const sorted = getFilteredPlaces(results, filtersRef.current.sortBy, 0); // price already filtered server-side
      setPlaces(sorted);
      syncMarkers(sorted);
      // Add expert overlay markers in the visible area
      setTimeout(() => addExpertOverlayRef.current?.(), 100);
      tabDataCache.discoverPlaces = sorted;
      tabDataCache.discoverTs = Date.now();
    } catch (err) {
      console.error('Places search failed:', err);
    } finally {
      setIsSearching(false);
    }
  }, [syncMarkers, getFilteredPlaces]);

  // Keep refs in sync for use in quick filter handler
  fetchNearbyRef.current = fetchNearby;
  syncMarkersRef.current = syncMarkers;

  // Overlay expert-rated markers on the discover map for the visible area
  const addExpertOverlayMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map || mapModeRef.current !== 'discover') return;
    // Clear previous expert overlay markers
    expertOverlayMarkersRef.current.forEach((m) => m.remove());
    expertOverlayMarkersRef.current = [];

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
      inner.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:white;border:2.5px solid #d4a017;box-shadow:0 2px 10px rgba(0,0,0,0.15);display:flex;align-items:center;justify-content:center;transition:transform 0.2s ease;`;
      inner.innerHTML = `<svg width="${iconSz}" height="${iconSz}" viewBox="0 0 24 24" fill="#d4a017" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
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

  // Text search
  const handleSearch = useCallback(async (query: string) => {
    const map = mapRef.current;
    if (!map || !query.trim()) return;
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
      const filtered = getFilteredPlaces(results, filtersRef.current.sortBy, filtersRef.current.selectedPrice);
      setPlaces(filtered);
      syncMarkers(filtered);

      if (results.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        results.forEach((p) => bounds.extend([p.lng, p.lat]));
        map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 1000 });
      }
      // Add expert overlay markers in the visible area
      setTimeout(() => addExpertOverlayRef.current?.(), 1200);
    } catch (err) {
      console.error('Text search failed:', err);
    } finally {
      setIsSearching(false);
    }
  }, [syncMarkers, getFilteredPlaces, searchLocationBias]);

  // Initialize Mapbox
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !MAPBOX_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-73.99, 40.735],
      zoom: 12.5,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');

    mapRef.current = map;

    // Search nearby restaurants once map loads (skip if cached)
    map.on('load', () => {
      const hasCachedPlaces = tabDataCache.discoverPlaces.length > 0 && (Date.now() - tabDataCache.discoverTs) < TAB_CACHE_TTL;
      if (hasCachedPlaces) {
        syncMarkers(tabDataCache.discoverPlaces);
        setTimeout(() => addExpertOverlayRef.current?.(), 100);
      } else {
        fetchNearby();
      }
    });

    // Show "Search this area" button when user pans the map instead of auto-fetching
    map.on('moveend', () => {
      if (mapModeRef.current !== 'discover' && mapModeRef.current !== 'hotels') return;
      if (isMarkerSelectedRef.current) return;
      // Only show button after initial load (places already populated)
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
      fetchTimeoutRef.current = setTimeout(() => {
        if (!isMarkerSelectedRef.current && (mapModeRef.current === 'discover' || mapModeRef.current === 'hotels')) {
          setShowSearchHere(true);
        }
      }, 400);
    });

    // Click on map background or drag clears popup
    const clearPopup = () => {
      // Skip clearing if a marker was just clicked (set in marker click handlers)
      if (isMarkerSelectedRef.current) {
        isMarkerSelectedRef.current = false;
        return;
      }
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
      setSelectedMarker(null);
      setSelectedPlace(null);
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

    return () => {
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update marker styles when selection changes
  useEffect(() => {
    Object.entries(markersRef.current).forEach(([id, marker]) => {
      const el = marker.getElement();
      const pin = el.querySelector('.marker-pin') as HTMLElement;
      if (!pin) return;
      const isSelected = id === selectedMarker;
      const hasRating = id in userRatingMap;
      if (isSelected) {
        pin.style.background = 'var(--color-primary, #8B4513)';
        pin.style.color = 'white';
        // Override score text color for selected state
        const scoreSpan = pin.querySelector('span');
        if (scoreSpan) scoreSpan.style.color = 'white';
      } else {
        pin.style.background = 'white';
        pin.style.color = 'currentColor';
        // Restore score text color
        if (hasRating) {
          const score = userRatingMap[id];
          const scoreSpan = pin.querySelector('span');
          if (scoreSpan) scoreSpan.style.color = score >= 8 ? '#16a34a' : score >= 5 ? '#d97706' : '#dc2626';
        }
      }
      const svg = pin.querySelector('svg');
      if (svg) {
        svg.setAttribute('stroke', isSelected ? 'white' : 'currentColor');
        svg.setAttribute('fill', isSelected ? 'white' : 'none');
      }
    });
  }, [selectedMarker, userRatingMap]);

  // Dismiss restaurant card when sheet leaves peek state
  useEffect(() => {
    if (sheetState !== 'peek' && selectedPlace) {
      setSelectedPlace(null);
      setSelectedMarker(null);
    }
  }, [sheetState, selectedPlace]);

  // Listen for "open-discover-sheet" events from BottomNav Explore button
  useEffect(() => {
    const handler = () => {
      setSheetState('peek');
      setMapMode('discover');
    };
    window.addEventListener('open-discover-sheet', handler);
    return () => window.removeEventListener('open-discover-sheet', handler);
  }, []);

  // Handle ?discover=1 query param (from navigation)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('discover') === '1') {
      setSheetState('peek');
      setMapMode('discover');
      window.history.replaceState({}, '', '/');
    }
  }, []);

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
    } catch (err) {
      console.error('Hotel search failed:', err);
    } finally {
      setHotelsLoading(false);
    }
  }, []);

  const activeFilterCount = useMemo(() => {
    if (mapMode === 'discover') {
      return (selectedCuisines.length > 0 ? 1 : 0) + (selectedPrice > 0 ? 1 : 0) + (sortBy !== 'popularity' ? 1 : 0) + (discoverRadius !== 5 ? 1 : 0);
    }
    if (mapMode === 'myratings') {
      return (ratingSortBy !== 'recent' ? 1 : 0) + (scoreRange[0] > 0 || scoreRange[1] < 10 ? 1 : 0) + (ratingPrice ? 1 : 0) + (ratingCuisines.length > 0 ? 1 : 0) + (ratingCities.length > 0 ? 1 : 0) + (wouldReturnFilter !== 'all' ? 1 : 0) + (selectedListId ? 1 : 0);
    }
    if (mapMode === 'friends') {
      return (ratingSortBy !== 'recent' ? 1 : 0) + (scoreRange[0] > 0 || scoreRange[1] < 10 ? 1 : 0) + (ratingCuisines.length > 0 ? 1 : 0) + (selectedFriendIds.size > 0 ? 1 : 0);
    }
    if (mapMode === 'experts') {
      return (ratingSortBy !== 'recent' ? 1 : 0) + (scoreRange[0] > 0 || scoreRange[1] < 10 ? 1 : 0) + (ratingCuisines.length > 0 ? 1 : 0);
    }
    if (mapMode === 'hotels') {
      return (hotelStarFilter > 0 ? 1 : 0) + (hotelPriceFilter > 0 ? 1 : 0) + (hotelSortBy !== 'popularity' ? 1 : 0);
    }
    return 0;
  }, [mapMode, selectedCuisines, selectedPrice, sortBy, discoverRadius, ratingSortBy, scoreRange, ratingPrice, ratingCuisines, ratingCities, wouldReturnFilter, selectedListId, selectedFriendIds, hotelStarFilter, hotelPriceFilter, hotelSortBy]);

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
    // Would return (myratings only)
    if (wouldReturnFilter !== 'all') {
      filtered = filtered.filter((r) => wouldReturnFilter === 'yes' ? r.would_return === true : r.would_return === false);
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
  }, [scoreRange, ratingPrice, ratingCuisines, ratingCities, wouldReturnFilter, ratingSortBy]);

  // Filtered ratings for each mode
  const filteredMyRatings = useMemo(() => {
    let base = myRatings;
    if (selectedListId) { const list = myLists.find((l: any) => l.id === selectedListId); if (list) { const ids = new Set(list.restaurantIds); base = base.filter((r) => ids.has(r.restaurant_id)); } }
    return filterRatings(base);
  }, [myRatings, selectedListId, myLists, filterRatings]);

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
    const sorted = [...filtered];
    switch (hotelSortBy) {
      case 'rating': sorted.sort((a, b) => b.rating - a.rating); break;
      case 'price_low': sorted.sort((a, b) => a.priceLevel - b.priceLevel); break;
      case 'popularity': default: sorted.sort((a, b) => b.userRatingCount - a.userRatingCount); break;
    }
    return sorted;
  }, [hotelPlaces, hotelStarFilter, hotelPriceFilter, hotelSortBy]);

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
  // so markers appear instantly when the Experts/Friends tab is opened. Results are
  // persisted back to the database so subsequent loads are already populated.
  useEffect(() => {
    const kind = mapMode === 'experts' ? 'experts' : mapMode === 'friends' ? 'friends' : null;
    if (!kind) return;
    if (tabDataCache.coordsLookedUp[kind]) return;
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

  // Fetch hotels when entering hotels mode
  useEffect(() => {
    if (mapMode === 'hotels' && hotelPlaces.length === 0) fetchHotels();
  }, [mapMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Add/remove hotel markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear previous hotel markers
    hotelMarkersRef.current.forEach((m) => m.remove());
    hotelMarkersRef.current = [];

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

    if (hasMarkers) map.fitBounds(bounds, { padding: 50, maxZoom: 13 });
  }, [mapMode, hotelPlaces, createHotelMarkerElement, showHotelPopup]);

  // Add/remove custom markers for My Ratings and Friends modes
  const customMarkersRef = useRef<mapboxgl.Marker[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear custom markers and expert overlay markers
    customMarkersRef.current.forEach((m) => m.remove());
    customMarkersRef.current = [];
    expertOverlayMarkersRef.current.forEach((m) => m.remove());
    expertOverlayMarkersRef.current = [];

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

      // Friends: warm ring + friend initial; Experts: gold ring + star icon; MyRatings: score-colored with decimal
      let borderStyle = '2px solid transparent';
      let iconHtml = '';
      if (mapMode === 'friends') {
        const profile = friendProfiles[r.user_id];
        const initial = profile?.display_name?.charAt(0)?.toUpperCase() || '?';
        borderStyle = `2.5px solid ${strokeColor}`;
        iconHtml = `<span style="font-size:${Math.round(markerSize * 0.38)}px;font-weight:800;color:${strokeColor};line-height:1;">${initial}</span>`;
      } else if (mapMode === 'experts') {
        borderStyle = `2.5px solid #d4a017`;
        iconHtml = `<svg width="${iconSz}" height="${iconSz}" viewBox="0 0 24 24" fill="#d4a017" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
      } else {
        // myratings: check if wishlisted (no rating) vs rated
        const wishlisted = isWishlisted(r.restaurant_id);
        if (wishlisted && score === 0) {
          // Wishlist item — show heart icon
          borderStyle = `2.5px solid #f87171`;
          iconHtml = `<svg width="${iconSz}" height="${iconSz}" viewBox="0 0 24 24" fill="#f87171" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
        } else {
          // Rated item — score color with decimal
          const sc = score >= 8 ? '#16a34a' : score >= 5 ? '#d97706' : '#dc2626';
          borderStyle = `2.5px solid ${sc}`;
          iconHtml = `<span style="font-size:${Math.round(markerSize * 0.30)}px;font-weight:800;color:${sc};line-height:1;">${score.toFixed(1)}</span>`;
        }
      }

      el.style.cssText = `display:flex;align-items:center;justify-content:center;cursor:pointer;`;
      const inner = document.createElement('div');
      inner.style.cssText = `width:${markerSize}px;height:${markerSize}px;border-radius:50%;background:white;border:${borderStyle};box-shadow:0 2px 10px rgba(0,0,0,0.15);display:flex;align-items:center;justify-content:center;transition:transform 0.2s ease;`;
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

    if (hasMarkers) map.fitBounds(bounds, { padding: 50, maxZoom: 13 });
  }, [mapMode, filteredMyRatings, filteredFriendRatings, filteredExpertRatings, friendProfiles, isWishlisted]);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-muted">
      {/* Real Mapbox Map */}
      <div ref={mapContainerRef} className="absolute inset-0" style={{ width: '100%', height: '100%' }} />

      {/* Search this area button */}
      <AnimatePresence>
        {showSearchHere && (mapMode === 'discover' || mapMode === 'hotels') && (
          <motion.button
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            onClick={() => { setShowSearchHere(false); mapMode === 'hotels' ? fetchHotels() : fetchNearby(); }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-5 py-2.5 bg-white rounded-full shadow-xl border border-on-surface/10 hover:bg-muted transition-colors"
          >
            <Search size={15} className={mapMode === 'hotels' ? "text-teal-600" : "text-primary"} />
            <span className="text-xs font-bold text-on-surface/80">Search this area</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Floating Action Buttons + Location Search */}
      <div className="absolute right-6 top-6 flex flex-col gap-3 z-30 items-end">
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

      {/* Filter Sheet — context-aware per map mode, matching Pantry FilterSheet design */}
      <AnimatePresence>
        {filterSheetOpen && (() => {
          const thumbCls = "absolute inset-x-0 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer";
          const sectionLabel = "text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2.5";
          const sortActive = "bg-primary text-white";
          const sortInactive = "bg-on-surface/5 text-on-surface/50 hover:bg-on-surface/10";
          const sortCls = "px-3.5 py-2 rounded-full text-xs font-semibold transition-all";
          const chipActive = "border-primary bg-primary/10 text-primary";
          const chipInactive = "border-on-surface/10 text-on-surface/50 hover:border-on-surface/20";
          const chipCls = "px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border";

          const handleReset = () => {
            if (mapMode === 'discover') {
              setSortBy('popularity'); setSelectedCuisines([]); setSelectedPrice(0); setDiscoverRadius(5);
            } else if (mapMode === 'hotels') {
              setHotelStarFilter(0); setHotelPriceFilter(0); setHotelSortBy('popularity');
            } else {
              setRatingSortBy('recent'); setScoreRange([0, 10]); setRatingCuisines([]); setRatingPrice(null); setRatingCities([]); setWouldReturnFilter('all');
              if (mapMode === 'friends') setSelectedFriendIds(new Set());
              if (mapMode === 'myratings') setSelectedListId(null);
            }
          };

          const handleApply = () => {
            setFilterSheetOpen(false);
            if (mapMode === 'discover') fetchNearby(selectedCuisines);
          };

          // Score range slider (reused)
          const scoreSlider = (
            <div>
              <p className={sectionLabel}>Score: {scoreRange[0]} &ndash; {scoreRange[1]}</p>
              <div className="relative h-6 flex items-center">
                <div className="absolute inset-x-0 h-1 bg-on-surface/10 rounded-full" />
                <div className="absolute h-1 bg-primary rounded-full" style={{ left: `${scoreRange[0] * 10}%`, right: `${100 - scoreRange[1] * 10}%` }} />
                <input type="range" min={0} max={10} step={0.5} value={scoreRange[0]} onChange={(e) => setScoreRange([Math.min(+e.target.value, scoreRange[1]), scoreRange[1]])} className={thumbCls} />
                <input type="range" min={0} max={10} step={0.5} value={scoreRange[1]} onChange={(e) => setScoreRange([scoreRange[0], Math.max(+e.target.value, scoreRange[0])])} className={thumbCls} />
              </div>
              <div className="flex justify-between mt-1"><span className="text-[10px] text-on-surface/30">0</span><span className="text-[10px] text-on-surface/30">10</span></div>
            </div>
          );

          // Collapsible cuisine dropdown with search (matching Pantry design)
          const cuisineDropdown = (cuisines: string[], selected: string[], setSelected: React.Dispatch<React.SetStateAction<string[]>>) => {
            const filtered = filterCuisineSearch.trim() ? cuisines.filter((c) => c.toLowerCase().includes(filterCuisineSearch.toLowerCase())) : cuisines;
            return (
              <div>
                <button onClick={() => setFilterCuisineOpen(!filterCuisineOpen)} className="flex items-center justify-between w-full mb-2">
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40">Cuisine</p>
                    {selected.length > 0 && <span className="text-[10px] font-semibold text-primary">{selected.join(', ')}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {selected.length > 0 && <button onClick={(e) => { e.stopPropagation(); setSelected([]); }} className="text-[10px] text-primary font-semibold">Clear</button>}
                    <ChevronDown size={14} className={cn("text-on-surface/30 transition-transform", filterCuisineOpen && "rotate-180")} />
                  </div>
                </button>
                <AnimatePresence>
                  {filterCuisineOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="relative mb-2">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                        <input type="text" value={filterCuisineSearch} onChange={(e) => setFilterCuisineSearch(e.target.value)} placeholder="Search cuisines..."
                          className="w-full bg-on-surface/5 rounded-lg py-2 pl-8 pr-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pb-1">
                        {filtered.map((c) => (
                          <button key={c} onClick={() => setSelected((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c])}
                            className={cn(chipCls, selected.includes(c) ? chipActive : chipInactive)}>{c}</button>
                        ))}
                        {filtered.length === 0 && <p className="text-[11px] text-on-surface/30 py-1">No cuisines match</p>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          };

          // Collapsible city dropdown with search (matching Pantry design)
          const cityDropdown = (cities: string[], selected: string[], setSelected: React.Dispatch<React.SetStateAction<string[]>>) => {
            const filtered = filterCitySearch.trim() ? cities.filter((c) => c.toLowerCase().includes(filterCitySearch.toLowerCase())) : cities;
            return (
              <div>
                <button onClick={() => setFilterCityOpen(!filterCityOpen)} className="flex items-center justify-between w-full mb-2">
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40">City / Location</p>
                    {selected.length > 0 && <span className="text-[10px] font-semibold text-primary">{selected.join(', ')}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {selected.length > 0 && <button onClick={(e) => { e.stopPropagation(); setSelected([]); }} className="text-[10px] text-primary font-semibold">Clear</button>}
                    <ChevronDown size={14} className={cn("text-on-surface/30 transition-transform", filterCityOpen && "rotate-180")} />
                  </div>
                </button>
                <AnimatePresence>
                  {filterCityOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="relative mb-2">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                        <input type="text" value={filterCitySearch} onChange={(e) => setFilterCitySearch(e.target.value)} placeholder="Search locations..."
                          className="w-full bg-on-surface/5 rounded-lg py-2 pl-8 pr-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pb-1">
                        {filtered.map((c) => (
                          <button key={c} onClick={() => setSelected((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c])}
                            className={cn(chipCls, selected.includes(c) ? chipActive : chipInactive)}>{c}</button>
                        ))}
                        {filtered.length === 0 && <p className="text-[11px] text-on-surface/30 py-1">No locations match</p>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          };

          // Discover cuisine dropdown (uses CUISINE_TYPES labels)
          const discoverCuisineDropdown = (() => {
            const allLabels = CUISINE_TYPES.filter((c) => c.type !== '').map((c) => c.label);
            const filtered = filterCuisineSearch.trim() ? allLabels.filter((c) => c.toLowerCase().includes(filterCuisineSearch.toLowerCase())) : allLabels;
            const labelToType = Object.fromEntries(CUISINE_TYPES.map((c) => [c.label, c.type]));
            const typeToLabel = Object.fromEntries(CUISINE_TYPES.map((c) => [c.type, c.label]));
            const selectedLabels = selectedCuisines.map((t) => typeToLabel[t] || t);
            return (
              <div>
                <button onClick={() => setFilterCuisineOpen(!filterCuisineOpen)} className="flex items-center justify-between w-full mb-2">
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40">Cuisine</p>
                    {selectedCuisines.length > 0 && <span className="text-[10px] font-semibold text-primary">{selectedLabels.join(', ')}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedCuisines.length > 0 && <button onClick={(e) => { e.stopPropagation(); setSelectedCuisines([]); }} className="text-[10px] text-primary font-semibold">Clear</button>}
                    <ChevronDown size={14} className={cn("text-on-surface/30 transition-transform", filterCuisineOpen && "rotate-180")} />
                  </div>
                </button>
                <AnimatePresence>
                  {filterCuisineOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="relative mb-2">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                        <input type="text" value={filterCuisineSearch} onChange={(e) => setFilterCuisineSearch(e.target.value)} placeholder="Search cuisines..."
                          className="w-full bg-on-surface/5 rounded-lg py-2 pl-8 pr-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pb-1">
                        {filtered.map((label) => {
                          const type = labelToType[label] || '';
                          const isActive = selectedCuisines.includes(type);
                          return (
                            <button key={label} onClick={() => setSelectedCuisines((prev) => prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type])}
                              className={cn(chipCls, isActive ? chipActive : chipInactive)}>{label}</button>
                          );
                        })}
                        {filtered.length === 0 && <p className="text-[11px] text-on-surface/30 py-1">No cuisines match</p>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })();

          // Friend filter dropdown with search
          const friendDropdown = (() => {
            const allFriends = Object.values(friendProfiles);
            const filtered = filterFriendSearch.trim() ? allFriends.filter((p) => (p.display_name || p.username).toLowerCase().includes(filterFriendSearch.toLowerCase())) : allFriends;
            const selectedNames = allFriends.filter((p) => selectedFriendIds.has(p.user_id)).map((p) => p.display_name || `@${p.username}`);
            return (
              <div>
                <button onClick={() => setFilterFriendOpen(!filterFriendOpen)} className="flex items-center justify-between w-full mb-2">
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40">Filter by Friend</p>
                    {selectedFriendIds.size > 0 && <span className="text-[10px] font-semibold text-primary">{selectedNames.join(', ')}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedFriendIds.size > 0 && <button onClick={(e) => { e.stopPropagation(); setSelectedFriendIds(new Set()); }} className="text-[10px] text-primary font-semibold">Clear</button>}
                    <ChevronDown size={14} className={cn("text-on-surface/30 transition-transform", filterFriendOpen && "rotate-180")} />
                  </div>
                </button>
                <AnimatePresence>
                  {filterFriendOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      {allFriends.length > 5 && (
                        <div className="relative mb-2">
                          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                          <input type="text" value={filterFriendSearch} onChange={(e) => setFilterFriendSearch(e.target.value)} placeholder="Search friends..."
                            className="w-full bg-on-surface/5 rounded-lg py-2 pl-8 pr-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pb-1">
                        {filtered.map((p) => {
                          const sel = selectedFriendIds.has(p.user_id);
                          return (
                            <button key={p.user_id} onClick={() => setSelectedFriendIds((prev) => { const next = new Set(prev); sel ? next.delete(p.user_id) : next.add(p.user_id); return next; })}
                              className={cn(chipCls, sel ? chipActive : chipInactive)}>{p.display_name || `@${p.username}`}</button>
                          );
                        })}
                        {filtered.length === 0 && <p className="text-[11px] text-on-surface/30 py-1">No friends match</p>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })();

          return (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => setFilterSheetOpen(false)} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              drag={phoneMode ? 'y' : false} dragConstraints={{ top: 0 }} dragElastic={{ top: 0, bottom: 0.4 }}
              onDragEnd={(_: any, info: any) => { if (info.offset.y > 80 || info.velocity.y > 300) setFilterSheetOpen(false); }}
              className={cn("fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-3xl flex flex-col overflow-hidden",
                phoneMode ? "h-[92vh]" : "max-h-[75vh]")}
            >
              {/* Drag handle */}
              {phoneMode && (
                <div className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing flex-shrink-0">
                  <div className="w-10 h-1 rounded-full bg-on-surface/15" />
                </div>
              )}

              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
                <h3 className="font-serif font-bold text-lg">Filters</h3>
                <button onClick={() => setFilterSheetOpen(false)} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center hover:bg-on-surface/10 transition-colors">
                  <X size={16} className="text-on-surface/60" />
                </button>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

                {/* ─── DISCOVER MODE ─── */}
                {mapMode === 'discover' && (
                  <>
                    <div>
                      <p className={sectionLabel}>Sort by</p>
                      <div className="flex flex-wrap gap-2">
                        {SORT_OPTIONS.map((opt) => (
                          <button key={opt.value} onClick={() => setSortBy(opt.value)}
                            className={cn(sortCls, sortBy === opt.value ? sortActive : sortInactive)}>{opt.label}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className={sectionLabel}>Price Range</p>
                      <div className="flex gap-2">
                        {PRICE_LEVELS.map((p) => (
                          <button key={p.value} onClick={() => setSelectedPrice(p.value)}
                            className={cn("flex-1 py-2 rounded-xl text-xs font-bold transition-all border-2", selectedPrice === p.value ? "border-primary bg-primary/5 text-primary" : chipInactive)}>{p.label}</button>
                        ))}
                      </div>
                    </div>
                    {discoverCuisineDropdown}
                    <div>
                      <p className={sectionLabel}>Radius: {discoverRadius} km</p>
                      <div className="relative h-6 flex items-center">
                        <div className="absolute inset-x-0 h-1 bg-on-surface/10 rounded-full" />
                        <div className="absolute h-1 bg-primary rounded-full" style={{ left: 0, right: `${100 - ((discoverRadius - 0.5) / 19.5) * 100}%` }} />
                        <input type="range" min={0.5} max={20} step={0.5} value={discoverRadius} onChange={(e) => setDiscoverRadius(+e.target.value)}
                          className={thumbCls} />
                      </div>
                      <div className="flex justify-between mt-1"><span className="text-[10px] text-on-surface/30">0.5 km</span><span className="text-[10px] text-on-surface/30">20 km</span></div>
                    </div>
                  </>
                )}

                {/* ─── MY RATINGS MODE ─── */}
                {mapMode === 'myratings' && (
                  <>
                    <div>
                      <p className={sectionLabel}>Sort by</p>
                      <div className="flex flex-wrap gap-2">
                        {([['recent', 'Recent'], ['highest', 'Highest Score'], ['lowest', 'Lowest Score'], ['visited', 'Date Visited']] as const).map(([key, label]) => (
                          <button key={key} onClick={() => setRatingSortBy(key)}
                            className={cn(sortCls, ratingSortBy === key ? sortActive : sortInactive)}>{label}</button>
                        ))}
                      </div>
                    </div>
                    {scoreSlider}
                    <div>
                      <p className={sectionLabel}>Price</p>
                      <div className="flex gap-2">
                        {['$', '$$', '$$$', '$$$$'].map((p) => (
                          <button key={p} onClick={() => setRatingPrice(ratingPrice === p ? null : p)}
                            className={cn("flex-1 py-2 rounded-xl text-xs font-bold transition-all border-2", ratingPrice === p ? "border-primary bg-primary/5 text-primary" : chipInactive)}>{p}</button>
                        ))}
                      </div>
                    </div>
                    {cuisineDropdown(uniqueMyRatingCuisines, ratingCuisines, setRatingCuisines)}
                    {uniqueMyRatingCities.length > 0 && cityDropdown(uniqueMyRatingCities, ratingCities, setRatingCities)}
                    <div>
                      <p className={sectionLabel}>Would Return</p>
                      <div className="flex gap-2">
                        {([['all', 'All'], ['yes', 'Yes'], ['no', 'No']] as const).map(([key, label]) => (
                          <button key={key} onClick={() => setWouldReturnFilter(key)}
                            className={cn("flex-1 py-2 rounded-xl text-xs font-bold transition-all border-2", wouldReturnFilter === key ? "border-primary bg-primary/5 text-primary" : chipInactive)}>{label}</button>
                        ))}
                      </div>
                    </div>
                    {myLists.filter((l: any) => l.restaurantIds?.length > 0).length > 0 && (
                      <div>
                        <p className={sectionLabel}>List</p>
                        <div className="flex flex-wrap gap-1.5">
                          <button onClick={() => setSelectedListId(null)}
                            className={cn(chipCls, !selectedListId ? chipActive : chipInactive)}>All Ratings</button>
                          {myLists.filter((l: any) => l.restaurantIds?.length > 0).map((l: any) => (
                            <button key={l.id} onClick={() => setSelectedListId(selectedListId === l.id ? null : l.id)}
                              className={cn(chipCls, selectedListId === l.id ? chipActive : chipInactive)}>{l.emoji} {l.name}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ─── FRIENDS MODE ─── */}
                {mapMode === 'friends' && (
                  <>
                    {Object.keys(friendProfiles).length > 0 && friendDropdown}
                    <div>
                      <p className={sectionLabel}>Sort by</p>
                      <div className="flex flex-wrap gap-2">
                        {([['recent', 'Recent'], ['highest', 'Highest Score'], ['lowest', 'Lowest Score']] as const).map(([key, label]) => (
                          <button key={key} onClick={() => setRatingSortBy(key)}
                            className={cn(sortCls, ratingSortBy === key ? sortActive : sortInactive)}>{label}</button>
                        ))}
                      </div>
                    </div>
                    {scoreSlider}
                    {cuisineDropdown(uniqueFriendCuisines, ratingCuisines, setRatingCuisines)}
                  </>
                )}

                {/* ─── EXPERTS MODE ─── */}
                {mapMode === 'experts' && (
                  <>
                    <div>
                      <p className={sectionLabel}>Sort by</p>
                      <div className="flex flex-wrap gap-2">
                        {([['recent', 'Recent'], ['highest', 'Highest Score']] as const).map(([key, label]) => (
                          <button key={key} onClick={() => setRatingSortBy(key)}
                            className={cn(sortCls, ratingSortBy === key ? sortActive : sortInactive)}>{label}</button>
                        ))}
                      </div>
                    </div>
                    {scoreSlider}
                    {cuisineDropdown(uniqueExpertCuisines, ratingCuisines, setRatingCuisines)}
                  </>
                )}

                {/* ─── HOTELS MODE ─── */}
                {mapMode === 'hotels' && (
                  <>
                    <div>
                      <p className={sectionLabel}>Hotel Star Rating</p>
                      <div className="flex gap-2">
                        {[{ v: 0, l: 'Any' }, { v: 3, l: '3\u2605+' }, { v: 4, l: '4\u2605+' }, { v: 5, l: '5\u2605' }].map(({ v, l }) => (
                          <button key={v} onClick={() => setHotelStarFilter(v)}
                            className={cn("flex-1 py-2 rounded-xl text-xs font-bold transition-all border-2", hotelStarFilter === v ? "border-teal-600 bg-teal-50 text-teal-700" : chipInactive)}>{l}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className={sectionLabel}>Price Range</p>
                      <div className="flex gap-2">
                        {PRICE_LEVELS.map((p) => (
                          <button key={p.value} onClick={() => setHotelPriceFilter(p.value)}
                            className={cn("flex-1 py-2 rounded-xl text-xs font-bold transition-all border-2", hotelPriceFilter === p.value ? "border-teal-600 bg-teal-50 text-teal-700" : chipInactive)}>{p.label}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className={sectionLabel}>Sort by</p>
                      <div className="flex flex-wrap gap-2">
                        {([['popularity', 'Most Popular'], ['rating', 'Highest Rated'], ['price_low', 'Price: Low to High']] as const).map(([key, label]) => (
                          <button key={key} onClick={() => setHotelSortBy(key as any)}
                            className={cn(sortCls, hotelSortBy === key ? "bg-teal-600 text-white" : sortInactive)}>{label}</button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Footer — Reset + Apply */}
              <div className="flex-shrink-0 border-t border-on-surface/6 px-5 py-4 flex gap-3">
                <button onClick={handleReset}
                  className="flex-1 py-3 rounded-2xl border-2 border-on-surface/10 text-sm font-semibold text-on-surface/60 hover:bg-muted transition-colors">Reset</button>
                <button onClick={handleApply}
                  className="flex-[2] py-3 rounded-2xl bg-primary text-white text-sm font-semibold shadow-lg shadow-primary/25">Apply</button>
              </div>
            </motion.div>
          </>
          );
        })()}
      </AnimatePresence>

      {/* Selected Place Card — above bottom sheet */}
      <AnimatePresence mode="wait">
        {selectedPlace && sheetState === 'peek' && (() => {
          const isRatingsMode = mapMode === 'myratings' || mapMode === 'friends' || mapMode === 'experts';
          const historyIdx = navHistory.indexOf(selectedPlace.id);
          // Arrows can always navigate as long as there's more than one place —
          // history provides proper back-tracking, and forward loops through
          // all loaded places before cycling.
          const hasPrev = historyIdx > 0;
          const hasNext = places.length > 1;
          // Pseudo-index / total for the "1/99" counter.
          const currentIndex = historyIdx >= 0 ? historyIdx : 0;
          const orderedPlaces = places;
          const goTo = (dir: number) => {
            if (places.length < 2) return;
            if (dir === -1) {
              if (historyIdx <= 0) return;
              const prev = places.find((p) => p.id === navHistory[historyIdx - 1]);
              if (!prev) return;
              navClickRef.current = true;
              setNavDirection(-1);
              setSelectedPlace(prev);
              setSelectedMarker(prev.id);
              return;
            }
            // Forward — if we've already gone back and there's forward history,
            // replay it; otherwise pick the next closest unvisited place.
            if (historyIdx >= 0 && historyIdx < navHistory.length - 1) {
              const next = places.find((p) => p.id === navHistory[historyIdx + 1]);
              if (!next) return;
              navClickRef.current = true;
              setNavDirection(1);
              setSelectedPlace(next);
              setSelectedMarker(next.id);
              return;
            }
            const ref = selectedPlace;
            const visited = new Set(navHistory);
            let candidates = places.filter((p) => !visited.has(p.id));
            let newHistory = navHistory;
            if (candidates.length === 0) {
              // All places visited — reset the loop, keeping current as anchor.
              newHistory = [ref.id];
              candidates = places.filter((p) => p.id !== ref.id);
              if (candidates.length === 0) return;
            }
            if (isRatingsMode) {
              candidates.sort(
                (a, b) =>
                  Math.hypot(a.lat - ref.lat, a.lng - ref.lng) -
                  Math.hypot(b.lat - ref.lat, b.lng - ref.lng)
              );
            } else {
              // Non-ratings modes: preserve list order by sorting candidates
              // by their index in `places` starting after current.
              const refIdx = places.findIndex((p) => p.id === ref.id);
              candidates.sort((a, b) => {
                const ai = (places.findIndex((p) => p.id === a.id) - refIdx + places.length) % places.length;
                const bi = (places.findIndex((p) => p.id === b.id) - refIdx + places.length) % places.length;
                return ai - bi;
              });
            }
            const next = candidates[0];
            navClickRef.current = true;
            setNavDirection(1);
            setNavHistory([...newHistory, next.id]);
            setSelectedPlace(next);
            setSelectedMarker(next.id);
          };

          // Mode-specific data lookups
          const myRating = mapMode === 'myratings' ? myRatings.find((r) => r.restaurant_id === selectedPlace.id) : null;
          const friendRating = mapMode === 'friends' ? friendRatings.filter((r) => r.restaurant_id === selectedPlace.id) : [];
          const expertRating = mapMode === 'experts' ? expertRatings.find((r) => r.restaurant_id === selectedPlace.id) : null;
          const discoverScore = mapMode === 'discover' ? userRatingMap[selectedPlace.id] : undefined;
          const cuisine = getCuisineLabel(selectedPlace.types);
          const restData = { id: selectedPlace.id, name: selectedPlace.name, image: selectedPlace.photoUrl || '', cuisine, price: priceLevelToString(selectedPlace.priceLevel), address: selectedPlace.address };

          // Score color helper
          const scoreColor = (s: number) => s >= 8 ? 'text-green-600' : s >= 5 ? 'text-amber-600' : 'text-red-500';

          return (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className={cn("fixed z-40 flex items-center gap-2", phoneMode ? "left-2 right-2" : "left-1/2 -translate-x-1/2 w-full max-w-lg")}
              style={{ bottom: PEEK_HEIGHT + 12 }}
            >
              {/* Left arrow — outside card */}
              <button
                onClick={(e) => { e.stopPropagation(); goTo(-1); }}
                disabled={!hasPrev}
                className={cn("w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 shadow-lg border border-white/30 transition-all",
                  hasPrev ? "bg-white/90 backdrop-blur-sm text-on-surface/60 hover:text-primary" : "bg-white/30 text-on-surface/15 cursor-default")}
              >
                <ChevronLeft size={18} />
              </button>

              {/* Card — drag-to-swipe wrapper with horizontal slide transitions */}
              <div className="flex-1 min-w-0 relative overflow-hidden">
              <AnimatePresence mode="popLayout" custom={navDirection} initial={false}>
              <motion.div
                key={selectedPlace.id}
                custom={navDirection}
                variants={{
                  enter: (d: number) => ({ x: d === 0 ? 0 : d * 320, opacity: d === 0 ? 1 : 0 }),
                  center: { x: 0, opacity: 1 },
                  exit: (d: number) => ({ x: d * -320, opacity: 0 }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: 'spring', damping: 30, stiffness: 320 }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.3}
                dragMomentum={false}
                onDragEnd={(_e: any, info: any) => {
                  if (info.offset.x < -50 && hasNext) goTo(1);
                  else if (info.offset.x > 50 && hasPrev) goTo(-1);
                }}
                style={{ touchAction: 'pan-y' }}
              >
                <div className="flex flex-row overflow-hidden rounded-2xl bg-white/95 backdrop-blur-md shadow-xl border border-white/30 cursor-pointer"
                  onClick={() => { setSelectedPlace(null); setSelectedMarker(null); navigate(`/restaurant/${selectedPlace.id}`); }}
                >
                  {/* Image — full-bleed left, clips to rounded-l-2xl via parent overflow-hidden */}
                  {selectedPlace.photoUrl ? (
                    <img src={selectedPlace.photoUrl} alt={selectedPlace.name}
                      className="w-24 flex-shrink-0 self-stretch object-cover pointer-events-none select-none" draggable={false} referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-24 flex-shrink-0 self-stretch flex items-center justify-center bg-on-surface/5">
                      <MapPinned size={24} className="text-on-surface/15" />
                    </div>
                  )}

                  {/* Content column */}
                  <div className="flex-1 min-w-0 py-2.5 pr-2.5 pl-3 flex flex-col justify-between select-none">
                    {/* Top: name row with dismiss */}
                    <div className="min-w-0">
                      <div className="flex items-start justify-between gap-1">
                        <h3 className="font-serif font-bold text-sm leading-tight truncate">{selectedPlace.name}</h3>
                        <button onClick={(e) => { e.stopPropagation(); setSelectedPlace(null); setSelectedMarker(null); }}
                          className="w-5 h-5 rounded-full bg-on-surface/8 flex items-center justify-center text-on-surface/40 hover:bg-on-surface/15 transition-colors flex-shrink-0 mt-0.5">
                          <X size={10} />
                        </button>
                      </div>
                      <p className="text-[10px] text-primary font-bold uppercase tracking-wider mt-0.5">{cuisine}</p>
                      {mapMode === 'myratings' ? (
                        selectedPlace.priceLevel > 0 && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-[10px] font-semibold text-on-surface/30">{priceLevelToString(selectedPlace.priceLevel)}</span>
                          </div>
                        )
                      ) : selectedPlace.rating > 0 && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Star size={10} className="fill-amber-400 text-amber-400" />
                          <span className="text-[11px] font-bold text-on-surface/70">{selectedPlace.rating.toFixed(1)}</span>
                          <span className="text-[10px] text-on-surface/30">({selectedPlace.userRatingCount})</span>
                          {selectedPlace.priceLevel > 0 && <span className="text-[10px] font-semibold text-on-surface/30 ml-0.5">· {priceLevelToString(selectedPlace.priceLevel)}</span>}
                        </div>
                      )}

                      {/* Mode-specific line */}
                      {mapMode === 'discover' && discoverScore !== undefined && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full mt-0.5">
                          <Star size={8} className="fill-green-600 text-green-600" /> You rated: {discoverScore.toFixed(1)}
                        </span>
                      )}
                      {mapMode === 'myratings' && myRating && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={cn("font-serif font-bold text-sm", scoreColor(Number(myRating.score)))}>{Number(myRating.score).toFixed(1)}<span className="text-[10px] text-on-surface/30 font-normal"> / 10</span></span>
                        </div>
                      )}
                      {mapMode === 'friends' && friendRating.length > 0 && (() => {
                        const first = friendRating[0];
                        const prof = friendProfiles[first.user_id];
                        const initial = prof?.display_name?.charAt(0)?.toUpperCase() || '?';
                        return (
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className={cn("font-serif font-bold text-sm", scoreColor(Number(first.score)))}>{Number(first.score).toFixed(1)}</span>
                            <span className="w-4 h-4 rounded-full bg-primary/15 text-[8px] font-bold text-primary flex items-center justify-center flex-shrink-0">{initial}</span>
                            <span className="text-[10px] text-on-surface/50 truncate">{friendRating.length > 1 ? `+${friendRating.length - 1} friends` : prof?.display_name || 'Friend'}</span>
                          </div>
                        );
                      })()}
                      {mapMode === 'experts' && expertRating && (() => {
                        const expProf = expertProfiles[expertRating.user_id];
                        const expName = expProf?.display_name || 'Expert';
                        return (
                          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                            <span className={cn("font-serif font-bold text-sm", scoreColor(Number(expertRating.score)))}>{Number(expertRating.score).toFixed(1)}</span>
                            <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full whitespace-nowrap">Expert Pick</span>
                            <span className="text-[10px] text-on-surface/50 truncate">by {expName}</span>
                          </div>
                        );
                      })()}
                      {mapMode === 'hotels' && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[11px] text-amber-400 leading-none">
                            {Array.from({ length: 5 }, (_, i) => selectedPlace.rating >= i + 0.75 ? '★' : '☆').join('')}
                          </span>
                          <span className="text-[9px] font-bold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded-full">Hotel</span>
                        </div>
                      )}
                    </div>

                    {/* Bottom row: location, counter, action buttons */}
                    <div className="flex items-end justify-between mt-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="text-[10px] text-on-surface/35 truncate">{extractCityState(selectedPlace.fullAddress, selectedPlace.address)}</p>
                        {currentIndex >= 0 && orderedPlaces.length > 1 && (
                          <span className="text-[10px] text-on-surface/30 flex-shrink-0">{currentIndex + 1}/{orderedPlaces.length}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); openAddRestaurantModal(restData); }}
                          className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface/40 hover:text-primary transition-colors">
                          <Plus size={14} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); openWishlistModal(restData); }}
                          className={cn("w-7 h-7 rounded-full flex items-center justify-center transition-colors", isWishlisted(selectedPlace.id) ? "text-red-400" : "text-on-surface/40 hover:text-red-400")}>
                          <Heart size={13} className={isWishlisted(selectedPlace.id) ? "fill-red-400" : ""} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
              </AnimatePresence>
              </div>

              {/* Right arrow — outside card */}
              <button
                onClick={(e) => { e.stopPropagation(); goTo(1); }}
                disabled={!hasNext}
                className={cn("w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 shadow-lg border border-white/30 transition-all",
                  hasNext ? "bg-white/90 backdrop-blur-sm text-on-surface/60 hover:text-primary" : "bg-white/30 text-on-surface/15 cursor-default")}
              >
                <ChevronRight size={18} />
              </button>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Bottom Sheet — tri-state: peek / half / full */}
      <motion.div
        ref={sheetRef}
        animate={{ y: getSheetY(sheetState) }}
        initial={{ y: getSheetY('peek') }}
        transition={{ type: 'spring', damping: 32, stiffness: 300, mass: 0.8 }}
        style={{ height: FULL_HEIGHT }}
        className={cn(
          "absolute bottom-0 left-0 right-0 shadow-[0_-20px_50px_rgba(0,0,0,0.1)] z-40 border-t border-white/40 flex flex-col will-change-transform",
          sheetState === 'full' ? "glass rounded-t-none" : "glass rounded-t-[3rem]"
        )}
      >
        {/* Handle — only this area is draggable (hidden in full state) */}
        {sheetState !== 'full' && (
        <div
          className="w-full flex flex-col items-center pt-4 pb-4 cursor-grab active:cursor-grabbing flex-shrink-0"
          style={{ touchAction: 'none' }}
          onClick={() => {
            if (Math.abs(dragCurrentYRef.current) < 5) {
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
            const el = sheetRef.current;
            if (!el) return;
            const baseY = getSheetY(sheetState);
            const clamped = Math.max(0, Math.min(FULL_HEIGHT - PEEK_HEIGHT, baseY + delta));
            el.style.transform = `translateY(${clamped}px)`;
            el.style.transition = 'none';
          }}
          onTouchEnd={() => {
            if (!isDraggingRef.current) return;
            isDraggingRef.current = false;
            const delta = dragCurrentYRef.current;
            const el = sheetRef.current;
            if (el) { el.style.transform = ''; el.style.transition = ''; }
            if (sheetState === 'half') {
              if (delta > 60) setSheetState('peek');
              else if (delta < -60) setSheetState('full');
            } else {
              if (delta < -50) setSheetState('half');
            }
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
              const el = sheetRef.current;
              if (!el) return;
              const baseY = getSheetY(sheetState);
              const clamped = Math.max(0, Math.min(FULL_HEIGHT - PEEK_HEIGHT, baseY + delta));
              el.style.transform = `translateY(${clamped}px)`;
              el.style.transition = 'none';
            };
            const onMouseUp = () => {
              isDraggingRef.current = false;
              const delta = dragCurrentYRef.current;
              const el = sheetRef.current;
              if (el) { el.style.transform = ''; el.style.transition = ''; }
              if (sheetState === 'half') {
                if (delta > 60) setSheetState('peek');
                else if (delta < -60) setSheetState('full');
              } else {
                if (delta < -50) setSheetState('half');
              }
              window.removeEventListener('mousemove', onMouseMove);
              window.removeEventListener('mouseup', onMouseUp);
            };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
          }}
        >
          {sheetState === 'half' ? (
            <button
              onClick={(e) => { e.stopPropagation(); setSheetState('full'); }}
              className="w-10 h-10 rounded-full bg-on-surface/5 flex items-center justify-center hover:bg-on-surface/10 transition-colors"
            >
              <ChevronsUp size={20} className="text-on-surface/50" />
            </button>
          ) : (
            <div className="w-12 h-1.5 bg-on-surface/10 rounded-full" />
          )}
        </div>
        )}

        {/* ══════ FULL STATE — full-screen discover page ══════ */}
        {sheetState === 'full' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header with back button + search bar or active search input */}
            <div className={cn("flex items-center gap-3 flex-shrink-0", phoneMode ? "px-3 pt-1 pb-3" : "px-6 pt-2 pb-4")}>
              <button
                onClick={() => {
                  if (discoverSearchActive) {
                    setDiscoverSearchActive(false);
                    setShowSearchInput(false);
                    setSearchQuery('');
                    if (preSearchPlacesRef.current.length > 0) {
                      setPlaces(preSearchPlacesRef.current);
                      syncMarkersRef.current?.(preSearchPlacesRef.current);
                    }
                  } else {
                    setSheetState('half');
                  }
                }}
                className="w-10 h-10 rounded-full bg-on-surface/5 flex items-center justify-center hover:bg-on-surface/10 transition-colors flex-shrink-0"
              >
                <ArrowLeft size={20} className="text-on-surface/60" />
              </button>
              {discoverSearchActive ? (
                <form
                  className="flex-1 relative"
                  onSubmit={(e) => { e.preventDefault(); if (searchQuery.trim()) handleSearch(searchQuery); }}
                >
                  <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/40" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search restaurant, cuisine, occasion..."
                    autoFocus
                    className="w-full bg-white/60 backdrop-blur-sm rounded-full py-3 pl-11 pr-10 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all border border-on-surface/10"
                  />
                  {searchQuery && (
                    <button type="button" onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
                      className="absolute inset-y-0 right-3 flex items-center text-on-surface/30 hover:text-on-surface/60">
                      <X size={16} />
                    </button>
                  )}
                </form>
              ) : (
                <button
                  onClick={() => {
                    preSearchPlacesRef.current = places;
                    setDiscoverSearchActive(true);
                    setShowSearchInput(true);
                    setTimeout(() => searchInputRef.current?.focus(), 100);
                  }}
                  className="flex-1 relative"
                >
                  <div className="absolute inset-y-0 left-4 flex items-center text-on-surface/40">
                    <Search size={18} />
                  </div>
                  <div className="w-full bg-white/60 backdrop-blur-sm rounded-full py-3 pl-11 pr-4 text-sm font-medium text-on-surface/40 text-left border border-on-surface/10">
                    Search restaurant, cuisine, occasion...
                  </div>
                </button>
              )}
            </div>

            {/* Full discover content — scrollable */}
            <div className={cn("flex-1 overflow-y-auto pb-32", phoneMode ? "px-3" : "px-6")}>
              {/* Quick filters */}
              <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar -mx-1 px-1 pt-4">
                {QUICK_FILTERS.map((filter) => (
                  <button
                    key={filter}
                    onClick={() => handleQuickFilter(filter)}
                    className={cn("whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest border transition-all",
                      activeQuickFilter === filter
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white/60 backdrop-blur-sm border-on-surface/10 hover:border-primary hover:text-primary'
                    )}
                  >
                    {filter}
                  </button>
                ))}
              </div>

              {/* Search results in full state */}
              {discoverSearchActive && (
                <div className="mt-4">
                  {isSearching ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 size={24} className="text-primary animate-spin" />
                      <span className="ml-3 text-sm text-on-surface/50 font-medium">Searching restaurants...</span>
                    </div>
                  ) : !searchQuery.trim() ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <Search size={32} className="text-on-surface/15 mb-3" />
                      <p className="text-sm font-medium text-on-surface/40">Discover restaurants</p>
                      <p className="text-xs text-on-surface/30 mt-1">Search by name, cuisine, or use the filters above</p>
                    </div>
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
                                cuisine: props.cuisine, price: props.price, address: place.address,
                              })}
                              onHeart={() => openWishlistModal({
                                id: place.id, name: place.name, image: props.image,
                                cuisine: props.cuisine, price: props.price, address: place.address,
                              })}
                            />
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Feed content — hidden when searching */}
              {!discoverSearchActive && (
              <>
              {/* Recommendations */}
              {recsLoading ? (
                <section className="mt-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles size={15} className="text-primary/60" />
                    <h3 className="text-sm font-bold text-on-surface/60 uppercase tracking-wider">Recommended For You</h3>
                  </div>
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={20} className="text-primary/40 animate-spin" />
                    <span className="ml-2 text-xs text-on-surface/40">Finding recommendations...</span>
                  </div>
                </section>
              ) : recommendations.length > 0 ? (
                <section className="mt-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles size={15} className="text-primary/60" />
                    <h3 className="text-sm font-bold text-on-surface/60 uppercase tracking-wider">Recommended For You</h3>
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar -mx-1 px-1">
                    {recommendations.map((place) => {
                      const cuisine = getCuisineLabel((place as any).types || []);
                      const wishlisted = isWishlisted(place.id);
                      return (
                        <div key={place.id} className={cn("flex-shrink-0 w-44 group cursor-pointer rounded-2xl bg-white shadow-sm border border-on-surface/5 overflow-hidden transition-all hover:shadow-md")} onClick={() => navigate(`/restaurant/${place.id}`)}>
                          <div className="w-full h-32 overflow-hidden relative">
                            {(place as any).photoUrl ? <img src={(place as any).photoUrl} alt={place.name} className="h-full w-full object-cover group-hover:scale-105 transition-transform" referrerPolicy="no-referrer" /> : <div className="h-full w-full flex items-center justify-center bg-on-surface/5"><MapPinned size={24} className="text-on-surface/15" /></div>}
                            <div className="absolute top-1.5 right-1.5 flex gap-1">
                              <button onClick={(e) => { e.stopPropagation(); openAddRestaurantModal({ id: place.id, name: place.name, image: (place as any).photoUrl || '', cuisine, price: priceLevelToString((place as any).priceLevel || 0), address: (place as any).address || '' }); }} className="w-7 h-7 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center text-on-surface/50 hover:text-primary transition-colors"><Plus size={13} /></button>
                              <button onClick={(e) => { e.stopPropagation(); openWishlistModal({ id: place.id, name: place.name, image: (place as any).photoUrl || '', cuisine, price: priceLevelToString((place as any).priceLevel || 0), address: (place as any).address || '' }); }} className={cn("w-7 h-7 rounded-full flex items-center justify-center backdrop-blur-sm transition-colors", wishlisted ? "bg-red-50/80 text-red-400" : "bg-white/80 text-on-surface/50 hover:text-red-400")}><Heart size={12} className={wishlisted ? "fill-red-400" : ""} /></button>
                            </div>
                          </div>
                          <div className="p-2.5">
                            <h3 className="font-serif font-bold text-xs leading-snug truncate">{place.name}</h3>
                            <p className="text-[9px] text-primary/70 font-semibold uppercase tracking-wider mt-0.5">{cuisine}</p>
                            {(place as any).rating > 0 && (
                              <div className="flex items-center gap-1 mt-1">
                                <Star size={10} className="fill-primary text-primary" />
                                <span className="text-[10px] font-bold text-primary">{(place as any).rating.toFixed(1)}</span>
                                {(place as any).priceLevel > 0 && <span className="text-[10px] font-semibold text-on-surface/35 ml-0.5">· {priceLevelToString((place as any).priceLevel)}</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {/* Recent Views */}
              {recentViews.length > 0 && (
                <section className="mt-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock size={15} className="text-on-surface/35" />
                    <h3 className="text-sm font-bold text-on-surface/60 uppercase tracking-wider">Recently Viewed</h3>
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar -mx-1 px-1">
                    {recentViews.slice(0, 8).map((place) => (
                      <div key={place.id} className="flex-shrink-0 w-32 relative group">
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeRecentView(place.id); }}
                          className="absolute top-1 right-1 z-10 w-5 h-5 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={10} className="text-white" />
                        </button>
                        <Link to={`/restaurant/${place.id}`}>
                          <div className="w-32 h-24 rounded-xl overflow-hidden mb-1.5 bg-muted">
                            {((place as any).photoUrl || (place as any).image) ? (
                              <img src={(place as any).photoUrl || (place as any).image} alt={place.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" referrerPolicy="no-referrer" />
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
              )}

              {/* Social Feed */}
              <div className="mt-5">
                <SocialFeed />
              </div>
              </>
              )}
            </div>
          </div>
        )}

        {/* ══════ HALF STATE — filter bar + results ══════ */}
        {sheetState !== 'full' && (
        <>
        {/* Search Bar & Filters — only on discover tab */}
        <div ref={filterBarRef} className={cn("pb-4 flex-shrink-0 relative", phoneMode ? "px-3" : "px-6")}>
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

                {/* Map mode toggle buttons */}
                <button
                  onClick={() => { setMapMode(mapMode === 'myratings' ? 'discover' : 'myratings'); setSelectedListId(null); }}
                  className={cn("flex items-center gap-2 px-5 py-3 rounded-full border-2 whitespace-nowrap flex-shrink-0 transition-colors",
                    mapMode === 'myratings' ? "bg-primary/10 border-primary/30 text-primary" : "border-on-surface/10 hover:bg-muted")}
                >
                  <Star size={16} className={mapMode === 'myratings' ? "text-primary" : "text-on-surface/50"} />
                  <span className="text-xs font-bold uppercase tracking-wider">My Ratings</span>
                </button>

                <button
                  onClick={() => { setMapMode(mapMode === 'friends' ? 'discover' : 'friends'); setSelectedFriendIds(new Set()); }}
                  className={cn("flex items-center gap-2 px-5 py-3 rounded-full border-2 whitespace-nowrap flex-shrink-0 transition-colors",
                    mapMode === 'friends' ? "bg-primary/10 border-primary/30 text-primary" : "border-on-surface/10 hover:bg-muted")}
                >
                  <Users size={16} className={mapMode === 'friends' ? "text-primary" : "text-on-surface/50"} />
                  <span className="text-xs font-bold uppercase tracking-wider">Friends{selectedFriendIds.size > 0 ? ` (${selectedFriendIds.size})` : ''}</span>
                </button>

                <button
                  onClick={() => setMapMode(mapMode === 'experts' ? 'discover' : 'experts')}
                  className={cn(
                    "flex items-center gap-2 px-5 py-3 rounded-full border-2 whitespace-nowrap flex-shrink-0 transition-colors",
                    mapMode === 'experts' ? "bg-primary/10 border-primary/30 text-primary" : "border-on-surface/10 hover:bg-muted"
                  )}
                >
                  <Star size={16} className={mapMode === 'experts' ? "text-primary fill-primary" : "text-on-surface/50"} />
                  <span className="text-xs font-bold uppercase tracking-wider">Experts</span>
                </button>

                <button
                  onClick={() => setMapMode(mapMode === 'hotels' ? 'discover' : 'hotels')}
                  className={cn(
                    "flex items-center gap-2 px-5 py-3 rounded-full border-2 whitespace-nowrap flex-shrink-0 transition-colors",
                    mapMode === 'hotels' ? "bg-teal-600/10 border-teal-600/30 text-teal-700" : "border-on-surface/10 hover:bg-muted"
                  )}
                >
                  <Building2 size={16} className={mapMode === 'hotels' ? "text-teal-600" : "text-on-surface/50"} />
                  <span className="text-xs font-bold uppercase tracking-wider">Hotels</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Friend/list dropdowns removed — all filtering now in filter sheet */}
        </div>

        {/* Results List */}
        <div className={cn("flex-1 overflow-y-auto no-scrollbar pb-32", phoneMode ? "px-3" : "px-6")}>
          {/* My Ratings tab content */}
          {mapMode === 'myratings' && (
            <div className="space-y-3">
              {filteredMyRatings.length === 0 ? (
                <div className="text-center py-8"><p className="text-sm text-on-surface/40">{activeFilterCount > 0 ? 'No results match your filters' : 'No rated restaurants yet'}</p></div>
              ) : filteredMyRatings.map((r) => (
                <div key={r.id} onClick={() => navigate(`/restaurant/${r.restaurant_id}`)}
                  className="flex gap-3 cursor-pointer rounded-2xl p-2.5 bg-white shadow-sm border border-on-surface/5 hover:shadow-md transition-all">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-serif font-bold text-sm truncate">{r.restaurant_name}</h3>
                    <p className="text-[10px] text-primary/70 font-semibold uppercase tracking-wider mt-0.5">{r.cuisine}</p>
                    <p className="text-[11px] text-on-surface/40 mt-0.5">{r.address?.split(',').slice(-1)[0]?.trim()}</p>
                  </div>
                  <span className={cn("text-lg font-serif font-bold self-center", Number(r.score) >= 8 ? 'text-green-600' : Number(r.score) >= 5 ? 'text-yellow-600' : 'text-red-500')}>
                    {Number(r.score).toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Friends tab content */}
          {mapMode === 'friends' && (
            <div className="space-y-3">
              {filteredFriendRatings.length === 0 ? (
                <div className="text-center py-8"><p className="text-sm text-on-surface/40">{activeFilterCount > 0 ? 'No results match your filters' : 'No friend ratings yet'}</p></div>
              ) : filteredFriendRatings.map((r) => {
                const prof = friendProfiles[r.user_id];
                return (
                  <div key={r.id} onClick={() => navigate(`/restaurant/${r.restaurant_id}`)}
                    className="flex gap-3 cursor-pointer rounded-2xl p-2.5 bg-white shadow-sm border border-on-surface/5 hover:shadow-md transition-all">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-serif font-bold text-sm truncate">{r.restaurant_name}</h3>
                      <p className="text-[10px] text-primary/70 font-semibold uppercase tracking-wider mt-0.5">{r.cuisine}</p>
                      <p className="text-[10px] text-on-surface/30 mt-0.5">{prof?.display_name || 'Friend'}</p>
                    </div>
                    <span className={cn("text-lg font-serif font-bold self-center", Number(r.score) >= 8 ? 'text-green-600' : Number(r.score) >= 5 ? 'text-yellow-600' : 'text-red-500')}>
                      {Number(r.score).toFixed(1)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Experts tab content */}
          {mapMode === 'experts' && (
            <div className="space-y-3">
              {filteredExpertRatings.length === 0 ? (
                <div className="text-center py-8"><p className="text-sm text-on-surface/40">{activeFilterCount > 0 ? 'No results match your filters' : 'No expert ratings yet'}</p></div>
              ) : filteredExpertRatings.map((r) => {
                const expProf = expertProfiles[r.user_id];
                const expName = expProf?.display_name || 'Expert';
                return (
                <div key={r.id} onClick={() => navigate(`/restaurant/${r.restaurant_id}`)}
                  className="flex gap-3 cursor-pointer rounded-2xl p-2.5 bg-white shadow-sm border border-on-surface/5 hover:shadow-md transition-all">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-serif font-bold text-sm truncate">{r.restaurant_name}</h3>
                    <p className="text-[10px] text-primary/70 font-semibold uppercase tracking-wider mt-0.5">{r.cuisine}</p>
                    <p className="text-[10px] text-on-surface/30 mt-0.5 truncate">Expert Pick · {expName}</p>
                  </div>
                  <span className={cn("text-lg font-serif font-bold self-center", Number(r.score) >= 8 ? 'text-green-600' : Number(r.score) >= 5 ? 'text-yellow-600' : 'text-red-500')}>
                    {Number(r.score).toFixed(1)}
                  </span>
                </div>
                );
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
            <div className="space-y-3">
              {filteredHotelPlaces.map((place) => {
                const cityState = extractCityState(place.fullAddress, place.address);
                return (
                  <div
                    key={place.id}
                    className={cn(
                      "flex gap-3 group cursor-pointer rounded-2xl p-2.5 bg-white shadow-sm border border-on-surface/5 transition-all hover:shadow-md",
                      selectedMarker === place.id && "ring-2 ring-teal-500/20"
                    )}
                    onClick={() => navigate(`/restaurant/${place.id}`)}
                  >
                    <div className="w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 bg-muted self-center relative">
                      {place.photoUrl ? (
                        <img src={place.photoUrl} alt={place.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center bg-teal-50">
                          <Building2 size={20} className="text-teal-300" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                      <div>
                        <h3 className="font-serif font-bold text-sm leading-snug truncate">{place.name}</h3>
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
                  </div>
                );
              })}
            </div>
          ))}

          {/* Discover tab content — integrated feed + search */}
          {mapMode === 'discover' && (
            <div className="space-y-4">
                  {/* Quick filters */}
                  <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar -mx-1 px-1">
                    {QUICK_FILTERS.map((filter) => (
                      <button
                        key={filter}
                        onClick={() => handleQuickFilter(filter)}
                        className={cn("whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest border transition-all",
                          activeQuickFilter === filter
                            ? 'bg-primary text-white border-primary'
                            : 'bg-white border-muted hover:border-primary hover:text-primary'
                        )}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>

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
                        <div className="space-y-3">
                          {places.map((place) => {
                            const cityState = extractCityState(place.fullAddress, place.address);
                            const cuisine = getCuisineLabel(place.types);
                            const wishlisted = isWishlisted(place.id);
                            return (
                              <div key={place.id} className={cn("flex gap-3 group cursor-pointer rounded-2xl p-2.5 bg-white shadow-sm border border-on-surface/5 transition-all hover:shadow-md", selectedMarker === place.id && "ring-2 ring-primary/20")} onClick={() => navigate(`/restaurant/${place.id}`)}>
                                <div className="w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 bg-muted self-center relative">
                                  {place.photoUrl ? <img src={place.photoUrl} alt={place.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <div className="h-full w-full flex items-center justify-center bg-on-surface/5"><MapPinned size={20} className="text-on-surface/20" /></div>}
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                                  <div>
                                    <h3 className="font-serif font-bold text-sm leading-snug truncate">{place.name}</h3>
                                    <p className="text-[10px] text-primary/70 font-semibold uppercase tracking-wider mt-0.5">{cuisine}</p>
                                    {place.rating > 0 && <div className="flex items-center gap-1 mt-0.5"><Star size={11} className="fill-primary text-primary" /><span className="text-xs font-bold text-primary">{place.rating.toFixed(1)}</span>{place.priceLevel > 0 && <span className="text-[11px] font-semibold text-on-surface/40 ml-0.5">· {priceLevelToString(place.priceLevel)}</span>}</div>}
                                    <p className="text-[11px] text-on-surface/40 mt-0.5 truncate">{cityState}</p>
                                  </div>
                                </div>
                                <div className="flex flex-col items-center justify-center gap-1.5 flex-shrink-0">
                                  <button onClick={(e) => { e.stopPropagation(); openAddRestaurantModal({ id: place.id, name: place.name, image: place.photoUrl || '', cuisine, price: priceLevelToString(place.priceLevel), address: place.address }); }} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center text-on-surface/40 hover:text-primary hover:bg-primary/10 transition-colors"><Plus size={15} /></button>
                                  <button onClick={(e) => { e.stopPropagation(); openWishlistModal({ id: place.id, name: place.name, image: place.photoUrl || '', cuisine, price: priceLevelToString(place.priceLevel), address: place.address }); }} className={cn("w-8 h-8 rounded-full flex items-center justify-center transition-colors", wishlisted ? "bg-red-50 text-red-400" : "bg-on-surface/5 text-on-surface/40 hover:text-red-400 hover:bg-red-50")}><Heart size={14} className={wishlisted ? "fill-red-400" : ""} /></button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )
                  ) : (
                  <>
                  {/* ── Feed mode: Nearby first, then other sections ── */}

                  {/* Nearby Restaurants — horizontal scroll */}
                  {isSearching && places.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 size={20} className="text-primary animate-spin" />
                      <span className="ml-2 text-sm text-on-surface/50 font-medium">Finding nearby...</span>
                    </div>
                  ) : places.length > 0 ? (
                    <section>
                      <div className="flex items-center justify-between mb-3">
                        <h2 className="text-base font-serif font-bold">Nearby Restaurants</h2>
                        <span className="text-on-surface/40 text-[10px] font-bold uppercase tracking-widest">{places.length} found</span>
                      </div>
                      <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar -mx-1 px-1">
                        {places.map((place) => {
                          const cuisine = getCuisineLabel(place.types);
                          const wishlisted = isWishlisted(place.id);
                          return (
                            <div key={place.id} className={cn("flex-shrink-0 w-40 group cursor-pointer rounded-2xl bg-white shadow-sm border border-on-surface/5 overflow-hidden transition-all hover:shadow-md", selectedMarker === place.id && "ring-2 ring-primary/20")} onClick={() => navigate(`/restaurant/${place.id}`)}>
                              <div className="w-full h-28 overflow-hidden relative">
                                {place.photoUrl ? <img src={place.photoUrl} alt={place.name} className="h-full w-full object-cover group-hover:scale-105 transition-transform" referrerPolicy="no-referrer" /> : <div className="h-full w-full flex items-center justify-center bg-on-surface/5"><MapPinned size={24} className="text-on-surface/15" /></div>}
                                <div className="absolute top-1.5 right-1.5 flex gap-1">
                                  <button onClick={(e) => { e.stopPropagation(); openAddRestaurantModal({ id: place.id, name: place.name, image: place.photoUrl || '', cuisine, price: priceLevelToString(place.priceLevel), address: place.address }); }} className="w-7 h-7 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center text-on-surface/50 hover:text-primary transition-colors"><Plus size={13} /></button>
                                  <button onClick={(e) => { e.stopPropagation(); openWishlistModal({ id: place.id, name: place.name, image: place.photoUrl || '', cuisine, price: priceLevelToString(place.priceLevel), address: place.address }); }} className={cn("w-7 h-7 rounded-full flex items-center justify-center backdrop-blur-sm transition-colors", wishlisted ? "bg-red-50/80 text-red-400" : "bg-white/80 text-on-surface/50 hover:text-red-400")}><Heart size={12} className={wishlisted ? "fill-red-400" : ""} /></button>
                                </div>
                              </div>
                              <div className="p-2.5">
                                <h3 className="font-serif font-bold text-xs leading-snug truncate">{place.name}</h3>
                                <p className="text-[9px] text-primary/70 font-semibold uppercase tracking-wider mt-0.5">{cuisine}</p>
                                {place.rating > 0 && (
                                  <div className="flex items-center gap-1 mt-1">
                                    <Star size={10} className="fill-primary text-primary" />
                                    <span className="text-[10px] font-bold text-primary">{place.rating.toFixed(1)}</span>
                                    {place.priceLevel > 0 && <span className="text-[10px] font-semibold text-on-surface/35 ml-0.5">· {priceLevelToString(place.priceLevel)}</span>}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}

                  {/* Recommendations */}
                  {recsLoading ? (
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <Sparkles size={13} className="text-primary/60" />
                        <h3 className="text-xs font-bold text-on-surface/60 uppercase tracking-wider">Recommended For You</h3>
                      </div>
                      <div className="flex items-center justify-center py-6">
                        <Loader2 size={18} className="text-primary/40 animate-spin" />
                        <span className="ml-2 text-xs text-on-surface/40">Finding recommendations...</span>
                      </div>
                    </section>
                  ) : recommendations.length > 0 ? (
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <Sparkles size={13} className="text-primary/60" />
                        <h3 className="text-xs font-bold text-on-surface/60 uppercase tracking-wider">Recommended For You</h3>
                      </div>
                      <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar -mx-1 px-1">
                        {recommendations.map((place) => {
                          const cuisine = getCuisineLabel((place as any).types || []);
                          const wishlisted = isWishlisted(place.id);
                          return (
                            <div key={place.id} className={cn("flex-shrink-0 w-40 group cursor-pointer rounded-2xl bg-white shadow-sm border border-on-surface/5 overflow-hidden transition-all hover:shadow-md")} onClick={() => navigate(`/restaurant/${place.id}`)}>
                              <div className="w-full h-28 overflow-hidden relative">
                                {(place as any).photoUrl ? <img src={(place as any).photoUrl} alt={place.name} className="h-full w-full object-cover group-hover:scale-105 transition-transform" referrerPolicy="no-referrer" /> : <div className="h-full w-full flex items-center justify-center bg-on-surface/5"><MapPinned size={24} className="text-on-surface/15" /></div>}
                                <div className="absolute top-1.5 right-1.5 flex gap-1">
                                  <button onClick={(e) => { e.stopPropagation(); openAddRestaurantModal({ id: place.id, name: place.name, image: (place as any).photoUrl || '', cuisine, price: priceLevelToString((place as any).priceLevel || 0), address: (place as any).address || '' }); }} className="w-7 h-7 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center text-on-surface/50 hover:text-primary transition-colors"><Plus size={13} /></button>
                                  <button onClick={(e) => { e.stopPropagation(); openWishlistModal({ id: place.id, name: place.name, image: (place as any).photoUrl || '', cuisine, price: priceLevelToString((place as any).priceLevel || 0), address: (place as any).address || '' }); }} className={cn("w-7 h-7 rounded-full flex items-center justify-center backdrop-blur-sm transition-colors", wishlisted ? "bg-red-50/80 text-red-400" : "bg-white/80 text-on-surface/50 hover:text-red-400")}><Heart size={12} className={wishlisted ? "fill-red-400" : ""} /></button>
                                </div>
                              </div>
                              <div className="p-2.5">
                                <h3 className="font-serif font-bold text-xs leading-snug truncate">{place.name}</h3>
                                <p className="text-[9px] text-primary/70 font-semibold uppercase tracking-wider mt-0.5">{cuisine}</p>
                                {(place as any).rating > 0 && (
                                  <div className="flex items-center gap-1 mt-1">
                                    <Star size={10} className="fill-primary text-primary" />
                                    <span className="text-[10px] font-bold text-primary">{(place as any).rating.toFixed(1)}</span>
                                    {(place as any).priceLevel > 0 && <span className="text-[10px] font-semibold text-on-surface/35 ml-0.5">· {priceLevelToString((place as any).priceLevel)}</span>}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}

                  {/* Recent Views */}
                  {recentViews.length > 0 && (
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <Clock size={13} className="text-on-surface/35" />
                        <h3 className="text-xs font-bold text-on-surface/60 uppercase tracking-wider">Recently Viewed</h3>
                      </div>
                      <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar -mx-1 px-1">
                        {recentViews.slice(0, 8).map((place) => (
                          <div key={place.id} className="flex-shrink-0 w-28 relative group">
                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeRecentView(place.id); }}
                              className="absolute top-1 right-1 z-10 w-5 h-5 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X size={10} className="text-white" />
                            </button>
                            <Link to={`/restaurant/${place.id}`}>
                              <div className="w-28 h-20 rounded-xl overflow-hidden mb-1.5 bg-muted">
                                {((place as any).photoUrl || (place as any).image) ? (
                                  <img src={(place as any).photoUrl || (place as any).image} alt={place.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" referrerPolicy="no-referrer" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center bg-on-surface/5 text-on-surface/20 font-serif text-xl font-bold">{place.name.charAt(0)}</div>
                                )}
                              </div>
                              <p className="text-[11px] font-semibold truncate leading-tight">{place.name}</p>
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
                  )}

                  {/* Social Feed */}
                  <SocialFeed />
                  </>
                  )}
            </div>
          )}
        </div>
        </>
        )}
      </motion.div>
    </div>
  );
};
