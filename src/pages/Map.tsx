import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Star, Heart, Plus, Navigation, SlidersHorizontal, Users, MapPinned, ChevronDown, ChevronUp, Layers, X, Box, Square, Loader2, ArrowUpDown, UtensilsCrossed, DollarSign, Check, Building2, Clock, Sparkles, MapPin, ArrowLeft, ChevronsUp } from 'lucide-react';
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
  coordsLookedUp: Record<string, boolean>;
  discoverPlaces: PlaceResult[];
  discoverTs: number;
} = { ts: 0, userId: null, myRatings: [], friendRatings: [], expertRatings: [], friendProfiles: {}, coordsLookedUp: {}, discoverPlaces: [], discoverTs: 0 };
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
        getExpertRatings(50),
      ]);
      setMyRatings(myR);
      setFriendRatings(friendR);
      setExpertRatings(expertR);
      let profs: Record<string, UserProfile> = {};
      if (friendR.length > 0) {
        const ids = [...new Set(friendR.map((r) => r.user_id))];
        profs = await getProfilesByIds(ids);
        setFriendProfiles(profs);
      }
      // Update module-level cache
      tabDataCache.ts = Date.now();
      tabDataCache.userId = userId;
      tabDataCache.myRatings = myR;
      tabDataCache.friendRatings = friendR;
      tabDataCache.expertRatings = expertR;
      tabDataCache.friendProfiles = profs;
    })();
  }, [userId, tabDataLoaded]);
  const [mapMode, setMapModeRaw] = useState<'discover' | 'myratings' | 'friends' | 'experts' | 'hotels'>(() => {
    const saved = sessionStorage.getItem('map-mode');
    return (saved === 'myratings' || saved === 'friends' || saved === 'experts' || saved === 'hotels') ? saved : 'discover';
  });
  const setMapMode = (mode: 'discover' | 'myratings' | 'friends' | 'experts' | 'hotels') => {
    setMapModeRaw(mode);
    sessionStorage.setItem('map-mode', mode);
  };
  const [hotelPlaces, setHotelPlaces] = useState<PlaceResult[]>([]);
  const [hotelsLoading, setHotelsLoading] = useState(false);
  const hotelMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const mapModeRef = useRef(mapMode);
  mapModeRef.current = mapMode;
  const [mapModeDropdownOpen, setMapModeDropdownOpen] = useState(false);
  const [friendFilterOpen, setFriendFilterOpen] = useState(false);
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<string>>(new Set());
  const [listFilterOpen, setListFilterOpen] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const myRatingsButtonRef = useRef<HTMLDivElement>(null);
  const friendsButtonRef = useRef<HTMLDivElement>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const [activeStyle, setActiveStyle] = useState<string>('light');
  const [showStylePicker, setShowStylePicker] = useState(false);
  const [is3D, setIs3D] = useState(false);
  const [places, setPlaces] = useState<PlaceResult[]>(() =>
    (Date.now() - tabDataCache.discoverTs) < TAB_CACHE_TTL ? tabDataCache.discoverPlaces : []
  );
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFiltersRaw, setShowFiltersRaw] = useState(false);
  const setShowFilters = useCallback((show: boolean) => {
    setShowFiltersRaw(show);
    setHideBottomNav(show);
  }, [setHideBottomNav]);
  const showFilters = showFiltersRaw;

  // Filter state
  const [sortBy, setSortBy] = useState<SortOption>('popularity');
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>([]);
  const [selectedPrice, setSelectedPrice] = useState(0);

  const [showSearchHere, setShowSearchHere] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<{ [id: string]: mapboxgl.Marker }>({});
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchWrapperRef = useRef<HTMLFormElement>(null);
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMarkerSelectedRef = useRef(false); // tracks if a marker is actively selected (suppresses re-fetch)
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
  const PEEK_HEIGHT = 56;
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

  // Build preference profile from user's ratings
  const userPreferences = useMemo(() => {
    const cuisineCounts: Record<string, number> = {};
    const priceCounts: Record<number, number> = {};
    const topCuisines: string[] = [];
    myLocalRatings.forEach((r) => {
      const weight = r.score >= 7 ? 2 : 1;
      if (r.cuisine) cuisineCounts[r.cuisine] = (cuisineCounts[r.cuisine] || 0) + weight;
      r.tags.forEach((t) => { cuisineCounts[t] = (cuisineCounts[t] || 0) + weight; });
      const priceNum = r.price.length;
      priceCounts[priceNum] = (priceCounts[priceNum] || 0) + weight;
    });
    Object.entries(cuisineCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([c]) => topCuisines.push(c));
    return { cuisineCounts, priceCounts, topCuisines };
  }, [myLocalRatings]);

  // Score-based recommendations from recentViews
  const recentRecommendations = useMemo(() => {
    if (recentViews.length === 0) return [];
    const ratedIds = new Set(myLocalRatings.map((r) => r.restaurantId));
    const candidates = recentViews.filter((v) => !ratedIds.has(v.id));
    const scored = candidates.map((place) => {
      let score = 0;
      (place.types || []).forEach((t: string) => {
        const label = t.replace(/_/g, ' ').replace(/restaurant/g, '').trim();
        Object.entries(userPreferences.cuisineCounts).forEach(([tag, count]) => {
          if (tag.toLowerCase().includes(label) || label.includes(tag.toLowerCase())) score += count * 2;
        });
      });
      if (userPreferences.priceCounts[place.priceLevel]) score += userPreferences.priceCounts[place.priceLevel];
      score += (place.rating || 0) * 0.5;
      score += Math.min((place.userRatingCount || 0) / 500, 2);
      return { ...place, recScore: score };
    });
    scored.sort((a, b) => b.recScore - a.recScore);
    return scored.slice(0, 8);
  }, [recentViews, myLocalRatings, userPreferences]);

  // API-based recommendations
  const [apiRecommendations, setApiRecommendations] = useState<PlaceResult[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const recsFetchedRef = useRef(false);

  const recommendations = useMemo(() => {
    const combined = [...apiRecommendations, ...recentRecommendations];
    const seen = new Set<string>();
    return combined.filter((p) => { if (seen.has(p.id)) return false; seen.add(p.id); return true; }).slice(0, 8);
  }, [apiRecommendations, recentRecommendations]);

  // User's top rated restaurants
  const topRated = useMemo(() => {
    return [...myLocalRatings].filter((r) => r.score >= 7 && r.image).sort((a, b) => b.score - a.score).slice(0, 6);
  }, [myLocalRatings]);

  // Fetch API-based recommendations
  useEffect(() => {
    if (recsFetchedRef.current || myLocalRatings.length === 0) return;
    recsFetchedRef.current = true;
    const ratedIds = new Set(myLocalRatings.map((r) => r.restaurantId));
    const recentIds = new Set(recentViews.map((v) => v.id));
    const topCuisines = userPreferences.topCuisines;
    if (topCuisines.length === 0) return;
    setRecsLoading(true);
    const queries = topCuisines.slice(0, 2).map((cuisine) =>
      searchPlacesByText(`best ${cuisine} restaurants`, 40.735, -73.99).catch(() => [] as PlaceResult[])
    );
    Promise.all(queries).then((results) => {
      const all = results.flat();
      const seen = new Set<string>();
      const fresh = all.filter((p) => { if (seen.has(p.id) || ratedIds.has(p.id) || recentIds.has(p.id)) return false; seen.add(p.id); return true; });
      setApiRecommendations(fresh.slice(0, 8));
      setRecsLoading(false);
    });
  }, [myLocalRatings, userPreferences.topCuisines, recentViews]);

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

  // Create a marker element for a place
  const createMarkerElement = useCallback((place: PlaceResult) => {
    const el = document.createElement('div');
    el.className = 'mapbox-custom-marker';
    el.innerHTML = `
      <div class="marker-pin" data-id="${place.id}" style="
        padding: 10px;
        border-radius: 50%;
        background: white;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transform: scale(0.4);
        transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s ease, color 0.2s ease;
      ">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
          <circle cx="12" cy="10" r="3"/>
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

  // Show popup for a place
  // Use refs for callbacks so DOM event handlers always get the latest
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const openAddRestaurantModalRef = useRef(openAddRestaurantModal);
  openAddRestaurantModalRef.current = openAddRestaurantModal;
  const openWishlistModalRef = useRef(openWishlistModal);
  openWishlistModalRef.current = openWishlistModal;

  const showPopup = useCallback((place: PlaceResult, map: mapboxgl.Map) => {
    if (popupRef.current) popupRef.current.remove();
    const cuisine = getCuisineLabel(place.types);
    const cityState = extractCityState(place.fullAddress, place.address);
    const ratingHtml = place.rating > 0
      ? `<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="#9f3012" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <span style="font-size:12px;font-weight:700;color:#9f3012;">${place.rating.toFixed(1)}</span>
          <span style="font-size:11px;color:#aaa;margin-left:2px;">(${place.userRatingCount})</span>
          ${place.priceLevel > 0 ? `<span style="color:#ccc;margin:0 2px;">·</span><span style="font-size:11px;color:#888;font-weight:600;">${'$'.repeat(place.priceLevel)}</span>` : ''}
        </div>`
      : '';

    const meta = {
      id: place.id, name: place.name,
      image: place.photoUrl || '', cuisine,
      price: priceLevelToString(place.priceLevel),
      address: place.address,
    };

    // Register global callbacks so inline onclick in popup HTML can call them
    const callbackId = `popup_${Date.now()}`;
    (window as any)[`${callbackId}_nav`] = () => {
      popupRef.current?.remove();
      navigateRef.current(`/restaurant/${place.id}`);
      delete (window as any)[`${callbackId}_nav`];
      delete (window as any)[`${callbackId}_rate`];
      delete (window as any)[`${callbackId}_wish`];
    };
    (window as any)[`${callbackId}_rate`] = () => {
      popupRef.current?.remove();
      openAddRestaurantModalRef.current(meta);
      delete (window as any)[`${callbackId}_nav`];
      delete (window as any)[`${callbackId}_rate`];
      delete (window as any)[`${callbackId}_wish`];
    };
    (window as any)[`${callbackId}_wish`] = () => {
      popupRef.current?.remove();
      openWishlistModalRef.current(meta);
      delete (window as any)[`${callbackId}_nav`];
      delete (window as any)[`${callbackId}_rate`];
      delete (window as any)[`${callbackId}_wish`];
    };

    const popup = new mapboxgl.Popup({
      offset: 25,
      closeButton: true,
      closeOnClick: false,
      maxWidth: '240px',
      className: 'restaurant-popup',
    })
      .setLngLat([place.lng, place.lat])
      .setHTML(`
        <div style="font-family:inherit;padding:4px 0;">
          <div onclick="window.${callbackId}_nav()" style="cursor:pointer;">
            ${place.photoUrl ? `<img src="${place.photoUrl}" referrerpolicy="no-referrer" style="width:100%;height:100px;object-fit:cover;border-radius:8px;margin-bottom:8px;" />` : ''}
            <div style="font-size:14px;font-weight:700;margin-bottom:2px;line-height:1.3;">${place.name}</div>
            <div style="font-size:10px;color:#9f3012;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px;">${cuisine}</div>
            ${ratingHtml}
            <div style="font-size:11px;color:#999;">${cityState}</div>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button onclick="event.stopPropagation();window.${callbackId}_rate()" style="width:36px;height:32px;display:flex;align-items:center;justify-content:center;background:#f5f0ee;border:1px solid #e5e0dd;border-radius:8px;cursor:pointer;color:#777;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button onclick="event.stopPropagation();window.${callbackId}_wish()" style="width:36px;height:32px;display:flex;align-items:center;justify-content:center;background:#f5f0ee;border:1px solid #e5e0dd;border-radius:8px;cursor:pointer;color:#777;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            </button>
          </div>
        </div>
      `)
      .addTo(map);

    popup.on('close', () => {
      setSelectedMarker(null);
      isMarkerSelectedRef.current = false;
      popupRef.current = null;
      // Clean up global callbacks
      delete (window as any)[`${callbackId}_nav`];
      delete (window as any)[`${callbackId}_rate`];
      delete (window as any)[`${callbackId}_wish`];
    });

    popupRef.current = popup;
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

  // Text search
  const handleSearch = useCallback(async (query: string) => {
    const map = mapRef.current;
    if (!map || !query.trim()) return;
    setIsSearching(true);
    setSelectedMarker(null);
    setShowSearchHere(false);
    try {
      const center = map.getCenter();
      const results = await searchPlacesByText(query, center.lat, center.lng);
      const filtered = getFilteredPlaces(results, filtersRef.current.sortBy, filtersRef.current.selectedPrice);
      setPlaces(filtered);
      syncMarkers(filtered);

      // Fit map to results
      if (results.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        results.forEach((p) => bounds.extend([p.lng, p.lat]));
        map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 1000 });
      }
    } catch (err) {
      console.error('Text search failed:', err);
    } finally {
      setIsSearching(false);
    }
  }, [syncMarkers, getFilteredPlaces]);

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
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
      isMarkerSelectedRef.current = false;
      setSelectedMarker(null);
    };
    map.on('click', clearPopup);
    map.on('dragstart', clearPopup);

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
      pin.style.background = isSelected ? 'var(--color-primary, #8B4513)' : 'white';
      pin.style.color = isSelected ? 'white' : 'currentColor';
      const svg = pin.querySelector('svg');
      if (svg) {
        svg.setAttribute('stroke', isSelected ? 'white' : 'currentColor');
        svg.setAttribute('fill', isSelected ? 'white' : 'none');
      }
    });
  }, [selectedMarker]);

  // Listen for "open-discover-sheet" events from BottomNav Discover button
  useEffect(() => {
    const handler = () => {
      setSheetState('full');
      setMapMode('discover');
    };
    window.addEventListener('open-discover-sheet', handler);
    return () => window.removeEventListener('open-discover-sheet', handler);
  }, []);

  // Handle ?discover=1 query param (from navigation)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('discover') === '1') {
      setSheetState('full');
      setMapMode('discover');
      window.history.replaceState({}, '', '/');
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
  const showHotelPopup = useCallback((place: PlaceResult, map: mapboxgl.Map) => {
    if (popupRef.current) popupRef.current.remove();
    const cityState = extractCityState(place.fullAddress, place.address);
    const ratingHtml = place.rating > 0
      ? `<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="#0d9488" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <span style="font-size:12px;font-weight:700;color:#0d9488;">${place.rating.toFixed(1)}</span>
          <span style="font-size:11px;color:#aaa;margin-left:2px;">(${place.userRatingCount})</span>
        </div>`
      : '';

    const callbackId = `popup_hotel_${Date.now()}`;
    (window as any)[`${callbackId}_nav`] = () => {
      popupRef.current?.remove();
      navigateRef.current(`/restaurant/${place.id}`);
      delete (window as any)[`${callbackId}_nav`];
    };

    const popup = new mapboxgl.Popup({
      offset: 25, closeButton: true, closeOnClick: false, maxWidth: '240px', className: 'restaurant-popup',
    })
      .setLngLat([place.lng, place.lat])
      .setHTML(`
        <div style="font-family:inherit;padding:4px 0;">
          <div onclick="window.${callbackId}_nav()" style="cursor:pointer;">
            ${place.photoUrl ? `<img src="${place.photoUrl}" referrerpolicy="no-referrer" style="width:100%;height:100px;object-fit:cover;border-radius:8px;margin-bottom:8px;" />` : ''}
            <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0d9488" stroke-width="2"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/></svg>
              <span style="font-size:10px;color:#0d9488;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">Hotel</span>
            </div>
            <div style="font-size:14px;font-weight:700;margin-bottom:2px;line-height:1.3;">${place.name}</div>
            ${ratingHtml}
            <div style="font-size:11px;color:#999;">${cityState}</div>
          </div>
          <button onclick="window.${callbackId}_nav()" style="margin-top:8px;width:100%;padding:8px 0;border-radius:10px;background:#0d9488;color:white;border:none;cursor:pointer;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">View Details</button>
        </div>
      `)
      .addTo(map);

    popup.on('close', () => {
      setSelectedMarker(null);
      isMarkerSelectedRef.current = false;
      popupRef.current = null;
      delete (window as any)[`${callbackId}_nav`];
    });
    popupRef.current = popup;
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

  const activeFilterCount = (selectedCuisines.length > 0 ? 1 : 0) + (selectedPrice > 0 ? 1 : 0) + (sortBy !== 'popularity' ? 1 : 0);

  // Look up missing coordinates for custom tab ratings (background, once per mode)
  useEffect(() => {
    const ratings = mapMode === 'myratings' ? myRatings : mapMode === 'friends' ? friendRatings : mapMode === 'experts' ? expertRatings : [];
    if (ratings.length === 0 || mapMode === 'discover') return;
    if (tabDataCache.coordsLookedUp[mapMode]) return;
    tabDataCache.coordsLookedUp[mapMode] = true;

    const missing = ratings.filter((r) => !r.lat || !r.lng).slice(0, 20);
    if (missing.length === 0) return;

    (async () => {
      for (const r of missing) {
        try {
          const results = await searchPlacesByText(r.restaurant_name + ' ' + (r.address?.split(',').slice(-1)[0]?.trim() || ''), 0, 0);
          if (results[0]?.lat && results[0]?.lng) {
            // Save coords back to DB
            r.lat = results[0].lat;
            r.lng = results[0].lng;
            publishCommunityRating(r.user_id, r.restaurant_id, {
              name: r.restaurant_name, score: Number(r.score), notes: r.notes, cuisine: r.cuisine,
              price: r.price, address: r.address, visitDate: r.visit_date, tags: r.tags,
              wouldReturn: r.would_return, friendIds: r.friend_ids || [],
              photoUrl: r.photo_url || '', lat: results[0].lat, lng: results[0].lng,
            });
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      // Update cache with resolved coords and trigger re-render
      if (mapMode === 'myratings') { tabDataCache.myRatings = [...ratings]; setMyRatings((prev) => [...prev]); }
      else if (mapMode === 'friends') { tabDataCache.friendRatings = [...ratings]; setFriendRatings((prev) => [...prev]); }
      else if (mapMode === 'experts') { tabDataCache.expertRatings = [...ratings]; setExpertRatings((prev) => [...prev]); }
    })();
  }, [mapMode, myRatings, friendRatings]);

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

    // Clear custom markers
    customMarkersRef.current.forEach((m) => m.remove());
    customMarkersRef.current = [];

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

    let ratings = mapMode === 'myratings' ? myRatings : mapMode === 'friends' ? friendRatings : mapMode === 'experts' ? expertRatings : [];
    // Apply friend filter
    if (mapMode === 'friends' && selectedFriendIds.size > 0) {
      ratings = ratings.filter((r) => selectedFriendIds.has(r.user_id));
    }
    // Apply list filter for my ratings
    if (mapMode === 'myratings' && selectedListId) {
      const list = myLists.find((l: any) => l.id === selectedListId);
      if (list) {
        const ids = new Set(list.restaurantIds);
        ratings = ratings.filter((r) => ids.has(r.restaurant_id));
      }
    }
    if (ratings.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    let hasMarkers = false;
    const strokeColor = mapMode === 'friends' ? '#9f3012' : mapMode === 'experts' ? '#d4a017' : '#333';

    for (const r of ratings) {
      if (!r.lat || !r.lng) continue;
      const el = document.createElement('div');
      el.style.cssText = `width:36px;height:36px;border-radius:50%;background:white;box-shadow:0 2px 8px rgba(0,0,0,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;${mapMode === 'experts' ? 'border:2px solid #d4a017;' : ''}`;
      el.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;

      const cbId = `mm_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      const rid = r.restaurant_id;
      const lat = r.lat, lng = r.lng;
      const cityState = (r.address || '').split(',').slice(-2).join(', ').replace(/\d{5}.*/, '').trim().replace(/,\s*$/, '');
      const photoHtml = r.photo_url ? `<img src="${r.photo_url}" referrerpolicy="no-referrer" style="width:100%;height:100px;object-fit:cover;border-radius:8px;margin-bottom:8px;" />` : '';
      const scoreHtml = `<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="#9f3012" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg><span style="font-size:12px;font-weight:700;color:#9f3012;">${Number(r.score).toFixed(1)}</span>${r.price ? `<span style="color:#ccc;margin:0 2px;">·</span><span style="font-size:11px;color:#888;">${r.price}</span>` : ''}</div>`;

      (window as any)[cbId] = () => { navigate(`/restaurant/${rid}`); delete (window as any)[cbId]; };
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
        const popup = new mapboxgl.Popup({ offset: [0, -20], closeButton: true, closeOnClick: false, maxWidth: '220px', className: 'restaurant-popup' })
          .setLngLat([lng, lat])
          .setHTML(`<div style="font-family:inherit;padding:4px 0;cursor:pointer;" onclick="window.${cbId}()">${photoHtml}<div style="font-size:13px;font-weight:700;margin-bottom:2px;">${r.restaurant_name}</div><div style="font-size:10px;color:#9f3012;font-weight:600;text-transform:uppercase;">${r.cuisine}</div>${scoreHtml}<div style="font-size:11px;color:#999;">${cityState}</div></div>`)
          .addTo(map);
        popup.on('close', () => { if (popupRef.current === popup) popupRef.current = null; delete (window as any)[cbId]; });
        popupRef.current = popup;
        isMarkerSelectedRef.current = true;
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map);
      customMarkersRef.current.push(marker);
      bounds.extend([lng, lat]);
      hasMarkers = true;
    }

    if (hasMarkers) map.fitBounds(bounds, { padding: 50, maxZoom: 13 });
  }, [mapMode, myRatings, friendRatings, expertRatings, selectedFriendIds, selectedListId, myLists, navigate]);

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

      {/* Floating Action Buttons */}
      <div className="absolute right-6 top-6 flex flex-col gap-3 z-30">
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

      {/* Filter Panel Overlay */}
      <AnimatePresence>
        {showFilters && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/30 z-50"
              onClick={() => setShowFilters(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="absolute bottom-0 left-0 right-0 z-50 bg-surface rounded-t-[2rem] shadow-2xl max-h-[85vh] overflow-y-auto"
            >
              {/* Header */}
              <div className="sticky top-0 bg-surface z-10 px-6 pt-5 pb-4 border-b border-black/5">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-serif font-bold text-on-surface">Filters</h2>
                  <button
                    onClick={() => setShowFilters(false)}
                    className="w-9 h-9 rounded-full bg-on-surface/5 flex items-center justify-center hover:bg-on-surface/10 transition-colors"
                  >
                    <X size={18} className="text-on-surface/60" />
                  </button>
                </div>
              </div>

              <div className="px-6 py-5 space-y-6">
                {/* Sort By */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <ArrowUpDown size={16} className="text-primary" />
                    <h3 className="text-sm font-bold uppercase tracking-wider text-on-surface/60">Sort By</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setSortBy(opt.value)}
                        className={cn(
                          "flex items-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all",
                          sortBy === opt.value
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-on-surface/10 text-on-surface/60 hover:border-on-surface/20"
                        )}
                      >
                        {sortBy === opt.value && <Check size={14} />}
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Price Range */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <DollarSign size={16} className="text-primary" />
                    <h3 className="text-sm font-bold uppercase tracking-wider text-on-surface/60">Price Range</h3>
                  </div>
                  <div className="flex gap-2">
                    {PRICE_LEVELS.map((p) => (
                      <button
                        key={p.value}
                        onClick={() => setSelectedPrice(p.value)}
                        className={cn(
                          "flex-1 py-3 rounded-xl border-2 text-sm font-bold transition-all",
                          selectedPrice === p.value
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-on-surface/10 text-on-surface/60 hover:border-on-surface/20"
                        )}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cuisine */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <UtensilsCrossed size={16} className="text-primary" />
                    <h3 className="text-sm font-bold uppercase tracking-wider text-on-surface/60">Cuisine</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {CUISINE_TYPES.map((c) => {
                      const isAll = c.type === '';
                      const isActive = isAll ? selectedCuisines.length === 0 : selectedCuisines.includes(c.type);
                      return (
                        <button
                          key={c.type || 'all'}
                          onClick={() => {
                            if (isAll) {
                              setSelectedCuisines([]);
                            } else {
                              setSelectedCuisines((prev) =>
                                prev.includes(c.type)
                                  ? prev.filter((t) => t !== c.type)
                                  : [...prev, c.type]
                              );
                            }
                          }}
                          className={cn(
                            "px-4 py-2 rounded-full border-2 text-xs font-bold uppercase tracking-wider transition-all",
                            isActive
                              ? "border-primary bg-primary/5 text-primary"
                              : "border-on-surface/10 text-on-surface/50 hover:border-on-surface/20"
                          )}
                        >
                          {isActive && !isAll && <Check size={12} className="inline mr-1 -mt-0.5" />}
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Apply / Reset buttons */}
              <div className="sticky bottom-0 bg-surface border-t border-black/5 px-6 py-4 flex gap-3">
                <button
                  onClick={() => {
                    setSortBy('popularity');
                    setSelectedCuisines([]);
                    setSelectedPrice(0);
                  }}
                  className="flex-1 py-3.5 rounded-2xl border-2 border-on-surface/10 text-sm font-semibold text-on-surface/60 hover:bg-muted transition-colors"
                >
                  Reset
                </button>
                <button
                  onClick={() => {
                    setShowFilters(false);
                    fetchNearby(selectedCuisines);
                  }}
                  className="flex-[2] py-3.5 rounded-2xl bg-primary text-white text-sm font-semibold shadow-lg shadow-primary/25 hover:shadow-xl transition-shadow"
                >
                  Apply Filters
                </button>
              </div>
            </motion.div>
          </>
        )}
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
                  <div className={cn("grid gap-3", phoneMode ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4")}>
                    {recommendations.map((place) => {
                      const props = placeToCardProps(place as any);
                      return (
                        <RestaurantCard key={place.id} {...props}
                          isWishlisted={isWishlisted(place.id)}
                          onAdd={() => openAddRestaurantModal({
                            id: place.id, name: place.name, image: props.image,
                            cuisine: props.cuisine, price: props.price, address: (place as any).address,
                          })}
                          onHeart={() => openWishlistModal({
                            id: place.id, name: place.name, image: props.image,
                            cuisine: props.cuisine, price: props.price, address: (place as any).address,
                          })}
                        />
                      );
                    })}
                  </div>
                </section>
              ) : null}

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
                  onClick={() => setShowFilters(true)}
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

                {/* Map mode toggle buttons (dropdowns rendered outside overflow container below) */}
                <div ref={myRatingsButtonRef} className="flex-shrink-0">
                  <button
                    className={cn("flex items-center gap-2 py-3 pl-5 rounded-full border-2 whitespace-nowrap transition-colors",
                      mapMode === 'myratings' ? "bg-primary/10 border-primary/30 text-primary pr-3" : "border-on-surface/10 hover:bg-muted pr-5")}
                  >
                    <span className="flex items-center gap-2"
                      onClick={() => { setMapMode(mapMode === 'myratings' ? 'discover' : 'myratings'); setSelectedListId(null); setListFilterOpen(false); }}>
                      <Star size={16} className={mapMode === 'myratings' ? "text-primary" : "text-on-surface/50"} />
                      <span className="text-xs font-bold uppercase tracking-wider">My Ratings</span>
                    </span>
                    {mapMode === 'myratings' && (
                      <span className="ml-1 pl-1 border-l border-primary/20 cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); setListFilterOpen(!listFilterOpen); setFriendFilterOpen(false); }}>
                        <ChevronDown size={14} className={cn("transition-transform", listFilterOpen && "rotate-180")} />
                      </span>
                    )}
                  </button>
                </div>

                <div ref={friendsButtonRef} className="flex-shrink-0">
                  <button
                    className={cn("flex items-center gap-2 py-3 pl-5 rounded-full border-2 whitespace-nowrap transition-colors",
                      mapMode === 'friends' ? "bg-primary/10 border-primary/30 text-primary pr-3" : "border-on-surface/10 hover:bg-muted pr-5")}
                  >
                    <span className="flex items-center gap-2"
                      onClick={() => { setMapMode(mapMode === 'friends' ? 'discover' : 'friends'); setSelectedFriendIds(new Set()); setFriendFilterOpen(false); }}>
                      <Users size={16} className={mapMode === 'friends' ? "text-primary" : "text-on-surface/50"} />
                      <span className="text-xs font-bold uppercase tracking-wider">Friends{selectedFriendIds.size > 0 ? ` (${selectedFriendIds.size})` : ''}</span>
                    </span>
                    {mapMode === 'friends' && (
                      <span className="ml-1 pl-1 border-l border-primary/20 cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); setFriendFilterOpen(!friendFilterOpen); setListFilterOpen(false); }}>
                        <ChevronDown size={14} className={cn("transition-transform", friendFilterOpen && "rotate-180")} />
                      </span>
                    )}
                  </button>
                </div>

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

          {/* Dropdown panels — rendered outside overflow-x-auto container so they aren't clipped */}
          {listFilterOpen && mapMode === 'myratings' && (
            <>
              <div className="absolute inset-0 z-30" onClick={() => setListFilterOpen(false)} />
              <div className="relative z-[60]">
                <div className="absolute top-0 bg-white rounded-xl shadow-xl border border-on-surface/10 min-w-[11rem] max-h-56 overflow-y-auto"
                  style={{ left: myRatingsButtonRef.current && filterBarRef.current ? myRatingsButtonRef.current.getBoundingClientRect().left - filterBarRef.current.getBoundingClientRect().left : 12 }}>
                  <button onClick={() => { setSelectedListId(null); setListFilterOpen(false); }}
                    className={cn("w-full text-left px-3.5 py-2.5 text-xs font-medium hover:bg-on-surface/5 border-b border-on-surface/5",
                      !selectedListId ? "text-primary bg-primary/5" : "text-on-surface/70")}>All Ratings</button>
                  {myLists.filter((l: any) => l.restaurantIds?.length > 0).map((l: any) => (
                    <button key={l.id} onClick={() => { setSelectedListId(selectedListId === l.id ? null : l.id); setListFilterOpen(false); }}
                      className={cn("w-full text-left px-3.5 py-2.5 text-xs font-medium hover:bg-on-surface/5 flex items-center justify-between",
                        selectedListId === l.id ? "text-primary bg-primary/5" : "text-on-surface/70")}>
                      <span>{l.emoji} {l.name}</span>
                      {selectedListId === l.id && <Check size={14} className="text-primary" />}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {friendFilterOpen && mapMode === 'friends' && (
            <>
              <div className="absolute inset-0 z-30" onClick={() => setFriendFilterOpen(false)} />
              <div className="relative z-[60]">
                <div className="absolute top-0 bg-white rounded-xl shadow-xl border border-on-surface/10 min-w-[11rem] max-h-56 overflow-y-auto"
                  style={{ left: friendsButtonRef.current && filterBarRef.current ? friendsButtonRef.current.getBoundingClientRect().left - filterBarRef.current.getBoundingClientRect().left : 12 }}>
                  <button onClick={() => { setSelectedFriendIds(new Set()); setFriendFilterOpen(false); }}
                    className={cn("w-full text-left px-3.5 py-2.5 text-xs font-medium hover:bg-on-surface/5 border-b border-on-surface/5",
                      selectedFriendIds.size === 0 ? "text-primary bg-primary/5" : "text-on-surface/70")}>All Friends</button>
                  {Object.values(friendProfiles).map((p) => {
                    const sel = selectedFriendIds.has(p.user_id);
                    return (
                      <button key={p.user_id} onClick={() => {
                        setSelectedFriendIds((prev) => { const next = new Set(prev); sel ? next.delete(p.user_id) : next.add(p.user_id); return next; });
                      }}
                        className={cn("w-full text-left px-3.5 py-2.5 text-xs font-medium hover:bg-on-surface/5 flex items-center justify-between",
                          sel ? "text-primary bg-primary/5" : "text-on-surface/70")}>
                        <span>{p.display_name || `@${p.username}`}</span>
                        {sel && <Check size={14} className="text-primary" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Results List */}
        <div className={cn("flex-1 overflow-y-auto no-scrollbar pb-32", phoneMode ? "px-3" : "px-6")}>
          {/* My Ratings tab content */}
          {mapMode === 'myratings' && (() => {
            let filtered = myRatings;
            if (selectedListId) { const list = myLists.find((l: any) => l.id === selectedListId); if (list) { const ids = new Set(list.restaurantIds); filtered = filtered.filter((r) => ids.has(r.restaurant_id)); } }
            return (
            <div className="space-y-3">
              {filtered.length === 0 ? (
                <div className="text-center py-8"><p className="text-sm text-on-surface/40">{selectedListId ? 'No restaurants in this list' : 'No rated restaurants yet'}</p></div>
              ) : filtered.map((r) => (
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
          ); })()}

          {/* Friends tab content */}
          {mapMode === 'friends' && (() => {
            let filtered = friendRatings;
            if (selectedFriendIds.size > 0) filtered = filtered.filter((r) => selectedFriendIds.has(r.user_id));
            return (
            <div className="space-y-3">
              {filtered.length === 0 ? (
                <div className="text-center py-8"><p className="text-sm text-on-surface/40">{selectedFriendIds.size > 0 ? 'No ratings from selected friends' : 'No friend ratings yet'}</p></div>
              ) : filtered.map((r) => {
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
          ); })()}

          {/* Experts tab content */}
          {mapMode === 'experts' && (
            <div className="space-y-3">
              {expertRatings.length === 0 ? (
                <div className="text-center py-8"><p className="text-sm text-on-surface/40">No expert ratings yet</p></div>
              ) : expertRatings.map((r) => (
                <div key={r.id} onClick={() => navigate(`/restaurant/${r.restaurant_id}`)}
                  className="flex gap-3 cursor-pointer rounded-2xl p-2.5 bg-white shadow-sm border border-on-surface/5 hover:shadow-md transition-all">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-serif font-bold text-sm truncate">{r.restaurant_name}</h3>
                    <p className="text-[10px] text-primary/70 font-semibold uppercase tracking-wider mt-0.5">{r.cuisine}</p>
                    <p className="text-[10px] text-on-surface/30 mt-0.5">Expert Pick</p>
                  </div>
                  <span className={cn("text-lg font-serif font-bold self-center", Number(r.score) >= 8 ? 'text-green-600' : Number(r.score) >= 5 ? 'text-yellow-600' : 'text-red-500')}>
                    {Number(r.score).toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Hotels tab content */}
          {mapMode === 'hotels' && (hotelsLoading && hotelPlaces.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="text-teal-600 animate-spin" />
              <span className="ml-3 text-sm text-on-surface/50 font-medium">Searching hotels...</span>
            </div>
          ) : hotelPlaces.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Building2 size={32} className="text-on-surface/20 mb-3" />
              <p className="text-sm text-on-surface/40 font-medium">No hotels found</p>
              <p className="text-xs text-on-surface/30 mt-1">Try moving the map to a different area</p>
            </div>
          ) : (
            <div className="space-y-3">
              {hotelPlaces.map((place) => {
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

                  {/* Nearby Restaurants — prominent, at top */}
                  {isSearching && places.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 size={20} className="text-primary animate-spin" />
                      <span className="ml-2 text-sm text-on-surface/50 font-medium">Finding nearby...</span>
                    </div>
                  ) : places.length > 0 ? (() => {
                    const visiblePlaces = places.slice(0, nearbyShowCount);
                    const hasMore = places.length > nearbyShowCount;
                    return (
                      <section>
                        <div className="flex items-center justify-between mb-3">
                          <h2 className="text-base font-serif font-bold">Nearby Restaurants</h2>
                          <span className="text-on-surface/40 text-[10px] font-bold uppercase tracking-widest">{places.length} found</span>
                        </div>
                        <div className="space-y-3">
                          {visiblePlaces.map((place) => {
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
                        <div className="flex gap-2 mt-3">
                          {nearbyShowCount > NEARBY_INITIAL && (
                            <button
                              onClick={() => setNearbyShowCount(NEARBY_INITIAL)}
                              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-on-surface/8 text-on-surface/50 hover:border-primary/30 hover:text-primary transition-colors"
                            >
                              <ChevronUp size={16} />
                              <span className="text-xs font-bold uppercase tracking-wider">Show Less</span>
                            </button>
                          )}
                          {hasMore && (
                            <button
                              onClick={() => setNearbyShowCount((prev) => prev + NEARBY_INCREMENT)}
                              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-on-surface/8 text-on-surface/50 hover:border-primary/30 hover:text-primary transition-colors"
                            >
                              <ChevronDown size={16} />
                              <span className="text-xs font-bold uppercase tracking-wider">
                                Show More ({Math.min(NEARBY_INCREMENT, places.length - nearbyShowCount)} more)
                              </span>
                            </button>
                          )}
                        </div>
                      </section>
                    );
                  })() : null}

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
                      <div className={cn("grid gap-3", phoneMode ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4")}>
                        {recommendations.map((place) => {
                          const props = placeToCardProps(place as any);
                          return (
                            <RestaurantCard key={place.id} {...props}
                              isWishlisted={isWishlisted(place.id)}
                              onAdd={() => openAddRestaurantModal({
                                id: place.id, name: place.name, image: props.image,
                                cuisine: props.cuisine, price: props.price, address: (place as any).address,
                              })}
                              onHeart={() => openWishlistModal({
                                id: place.id, name: place.name, image: props.image,
                                cuisine: props.cuisine, price: props.price, address: (place as any).address,
                              })}
                            />
                          );
                        })}
                      </div>
                    </section>
                  ) : null}

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
