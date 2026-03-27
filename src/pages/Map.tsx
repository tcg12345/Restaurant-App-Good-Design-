import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Star, Heart, Plus, Navigation, SlidersHorizontal, Bookmark, Users, MapPinned, ChevronDown, Layers, X, Box, Square, Loader2, ArrowUpDown, UtensilsCrossed, DollarSign, Check } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
// @ts-ignore - Vite worker import for mapbox-gl CSP compatibility
import MapboxWorker from 'mapbox-gl/dist/mapbox-gl-csp-worker?worker';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';
import { useLists } from '../contexts/ListsContext';
import { useAuth } from '../contexts/AuthContext';
import { getUserRatings, getAllFriendRatings, getExpertRatings, getProfilesByIds, publishCommunityRating, type CommunityRating, type UserProfile } from '../lib/supabase-community';
import { searchNearbyRestaurants, searchPlacesByText, priceLevelToString, CUISINE_TYPES, type PlaceResult } from '../lib/places';
import { getCuisineLabel } from './useRestaurantDetail';
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

const FILTERS = [
  { icon: Bookmark, label: 'Hitlist', active: false },
  { icon: Users, label: 'Anyone', hasDropdown: true, active: false },
  { icon: MapPinned, label: 'Nearby', active: false },
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

export const Map: React.FC = () => {
  const navigate = useNavigate();
  const { setHideBottomNav, phoneMode } = useSettings();
  const { openAddRestaurantModal, openWishlistModal, isWishlisted, ratings: myLocalRatings } = useLists();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  // Data for My Ratings and Friends tabs
  const [myRatings, setMyRatings] = useState<CommunityRating[]>([]);
  const [friendRatings, setFriendRatings] = useState<CommunityRating[]>([]);
  const [friendProfiles, setFriendProfiles] = useState<Record<string, UserProfile>>({});
  const [expertRatings, setExpertRatings] = useState<CommunityRating[]>([]);
  const [tabDataLoaded, setTabDataLoaded] = useState(false);

  // Load data for non-discover tabs
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
      if (friendR.length > 0) {
        const ids = [...new Set(friendR.map((r) => r.user_id))];
        const profs = await getProfilesByIds(ids);
        setFriendProfiles(profs);
      }
    })();
  }, [userId, tabDataLoaded]);
  const [mapMode, setMapMode] = useState<'discover' | 'myratings' | 'friends' | 'experts'>('discover');
  const mapModeRef = useRef(mapMode);
  mapModeRef.current = mapMode;
  const [mapModeDropdownOpen, setMapModeDropdownOpen] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const [activeStyle, setActiveStyle] = useState<string>('light');
  const [showStylePicker, setShowStylePicker] = useState(false);
  const [is3D, setIs3D] = useState(false);
  const [places, setPlaces] = useState<PlaceResult[]>([]);
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

  // Bottom sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartYRef = useRef(0);
  const dragCurrentYRef = useRef(0);
  const isDraggingRef = useRef(false);
  const PEEK_HEIGHT = 140;
  const SHEET_HEIGHT = typeof window !== 'undefined' ? window.innerHeight * 0.75 : 600;

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
    try {
      const center = map.getCenter();
      const zoom = map.getZoom();
      // Scale radius based on zoom level — use larger radius for better coverage
      const radius = Math.min(50000, Math.max(1000, Math.round(50000 / Math.pow(2, zoom - 10))));
      const cuisineTypes = cuisines ?? filtersRef.current.selectedCuisines;
      const price = filtersRef.current.selectedPrice;
      const results = await searchNearbyRestaurants(center.lat, center.lng, radius, cuisineTypes, price);
      const sorted = getFilteredPlaces(results, filtersRef.current.sortBy, 0); // price already filtered server-side
      setPlaces(sorted);
      syncMarkers(sorted);
    } catch (err) {
      console.error('Places search failed:', err);
    } finally {
      setIsSearching(false);
    }
  }, [syncMarkers, getFilteredPlaces]);

  // Text search
  const handleSearch = useCallback(async (query: string) => {
    const map = mapRef.current;
    if (!map || !query.trim()) return;
    setIsSearching(true);
    setSelectedMarker(null);
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

    // Search nearby restaurants once map loads
    map.on('load', () => {
      fetchNearby();
    });

    // Re-fetch when user moves the map (debounced) — skip if a marker is selected
    map.on('moveend', () => {
      if (mapModeRef.current !== 'discover') return; // Only fetch in discover mode
      if (isMarkerSelectedRef.current) return;
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
      fetchTimeoutRef.current = setTimeout(() => {
        if (!isMarkerSelectedRef.current && mapModeRef.current === 'discover') fetchNearby();

      }, 800);
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

  // Close search input when clicking outside
  useEffect(() => {
    if (!showSearchInput) return;
    const handler = (e: MouseEvent) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target as Node)) {
        setShowSearchInput(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSearchInput]);

  const flyToPlace = useCallback((place: PlaceResult) => {
    setSelectedMarker(place.id);
    isMarkerSelectedRef.current = true;
    mapRef.current?.easeTo({
      center: [place.lng, place.lat],
      duration: 500,
    });
  }, []);

  const activeFilterCount = (selectedCuisines.length > 0 ? 1 : 0) + (selectedPrice > 0 ? 1 : 0) + (sortBy !== 'popularity' ? 1 : 0);

  // Look up missing coordinates for custom tab ratings (background, once per mode)
  const coordsLookedUpMode = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const ratings = mapMode === 'myratings' ? myRatings : mapMode === 'friends' ? friendRatings : mapMode === 'experts' ? expertRatings : [];
    if (ratings.length === 0 || mapMode === 'discover') return;
    if (coordsLookedUpMode.current[mapMode]) return;
    coordsLookedUpMode.current[mapMode] = true;

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
      // Trigger re-render to show new markers
      if (mapMode === 'myratings') setMyRatings((prev) => [...prev]);
      else if (mapMode === 'friends') setFriendRatings((prev) => [...prev]);
      else if (mapMode === 'experts') setExpertRatings((prev) => [...prev]);
    })();
  }, [mapMode, myRatings, friendRatings]);

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

    // Also close any open popups
    if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }

    const ratings = mapMode === 'myratings' ? myRatings : mapMode === 'friends' ? friendRatings : mapMode === 'experts' ? expertRatings : [];
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
  }, [mapMode, myRatings, friendRatings, expertRatings, navigate]);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-muted">
      {/* Real Mapbox Map */}
      <div ref={mapContainerRef} className="absolute inset-0" style={{ width: '100%', height: '100%' }} />

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
              className="absolute right-14 top-0 glass rounded-2xl shadow-2xl border border-white/20 p-2 flex flex-col gap-1 min-w-[140px]"
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

      {/* Bottom Sheet */}
      <motion.div
        ref={sheetRef}
        animate={{ y: sheetOpen ? 0 : SHEET_HEIGHT - PEEK_HEIGHT }}
        initial={{ y: SHEET_HEIGHT - PEEK_HEIGHT }}
        transition={{ type: 'spring', damping: 32, stiffness: 300, mass: 0.8 }}
        style={{ height: SHEET_HEIGHT }}
        className="absolute bottom-0 left-0 right-0 glass rounded-t-[3rem] shadow-[0_-20px_50px_rgba(0,0,0,0.1)] z-40 border-t border-white/40 flex flex-col will-change-transform"
      >
        {/* Handle — only this area is draggable */}
        <div
          className="w-full flex flex-col items-center pt-4 pb-4 cursor-grab active:cursor-grabbing flex-shrink-0"
          style={{ touchAction: 'none' }}
          onClick={() => {
            if (Math.abs(dragCurrentYRef.current) < 5) setSheetOpen(!sheetOpen);
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
            const baseY = sheetOpen ? 0 : SHEET_HEIGHT - PEEK_HEIGHT;
            const clamped = Math.max(0, Math.min(SHEET_HEIGHT - PEEK_HEIGHT, baseY + delta));
            el.style.transform = `translateY(${clamped}px)`;
            el.style.transition = 'none';
          }}
          onTouchEnd={() => {
            if (!isDraggingRef.current) return;
            isDraggingRef.current = false;
            const delta = dragCurrentYRef.current;
            const el = sheetRef.current;
            if (el) {
              el.style.transform = '';
              el.style.transition = '';
            }
            if (sheetOpen) {
              if (delta > 50) setSheetOpen(false);
            } else {
              if (delta < -50) setSheetOpen(true);
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
              const baseY = sheetOpen ? 0 : SHEET_HEIGHT - PEEK_HEIGHT;
              const clamped = Math.max(0, Math.min(SHEET_HEIGHT - PEEK_HEIGHT, baseY + delta));
              el.style.transform = `translateY(${clamped}px)`;
              el.style.transition = 'none';
            };
            const onMouseUp = () => {
              isDraggingRef.current = false;
              const delta = dragCurrentYRef.current;
              const el = sheetRef.current;
              if (el) {
                el.style.transform = '';
                el.style.transition = '';
              }
              if (sheetOpen) {
                if (delta > 50) setSheetOpen(false);
              } else {
                if (delta < -50) setSheetOpen(true);
              }
              window.removeEventListener('mousemove', onMouseMove);
              window.removeEventListener('mouseup', onMouseUp);
            };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
          }}
        >
          <div className="w-12 h-1.5 bg-on-surface/10 rounded-full" />
        </div>

        {/* Search Bar & Filters — only on discover tab */}
        <div className={cn("pb-4 flex-shrink-0", phoneMode ? "px-3" : "px-6")}>
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
                    setShowSearchInput(false);
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
                className="flex items-center gap-3 overflow-x-auto no-scrollbar"
              >
                <button
                  onClick={() => {
                    setShowSearchInput(true);
                    if (!sheetOpen) setSheetOpen(true);
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

                {/* Map mode toggle buttons */}
                <button
                  onClick={() => setMapMode(mapMode === 'myratings' ? 'discover' : 'myratings')}
                  className={cn(
                    "flex items-center gap-2 px-5 py-3 rounded-full border-2 whitespace-nowrap flex-shrink-0 transition-colors",
                    mapMode === 'myratings' ? "bg-primary/10 border-primary/30 text-primary" : "border-on-surface/10 hover:bg-muted"
                  )}
                >
                  <Star size={16} className={mapMode === 'myratings' ? "text-primary" : "text-on-surface/50"} />
                  <span className="text-xs font-bold uppercase tracking-wider">My Ratings</span>
                </button>
                <button
                  onClick={() => setMapMode(mapMode === 'friends' ? 'discover' : 'friends')}
                  className={cn(
                    "flex items-center gap-2 px-5 py-3 rounded-full border-2 whitespace-nowrap flex-shrink-0 transition-colors",
                    mapMode === 'friends' ? "bg-primary/10 border-primary/30 text-primary" : "border-on-surface/10 hover:bg-muted"
                  )}
                >
                  <Users size={16} className={mapMode === 'friends' ? "text-primary" : "text-on-surface/50"} />
                  <span className="text-xs font-bold uppercase tracking-wider">Friends</span>
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Results List */}
        <div className={cn("flex-1 overflow-y-auto no-scrollbar pb-32", phoneMode ? "px-3" : "px-6")}>
          {/* My Ratings tab content */}
          {mapMode === 'myratings' && (
            <div className="space-y-3">
              {myRatings.length === 0 ? (
                <div className="text-center py-8"><p className="text-sm text-on-surface/40">No rated restaurants yet</p></div>
              ) : myRatings.map((r) => (
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
              {friendRatings.length === 0 ? (
                <div className="text-center py-8"><p className="text-sm text-on-surface/40">No friend ratings yet</p></div>
              ) : friendRatings.map((r) => {
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

          {/* Discover tab content (original) */}
          {mapMode === 'discover' && (isSearching && places.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="text-primary animate-spin" />
              <span className="ml-3 text-sm text-on-surface/50 font-medium">Searching restaurants...</span>
            </div>
          ) : places.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MapPinned size={32} className="text-on-surface/20 mb-3" />
              <p className="text-sm text-on-surface/40 font-medium">No restaurants found</p>
              <p className="text-xs text-on-surface/30 mt-1">Try searching or move the map</p>
            </div>
          ) : (
            <div className="space-y-3">
              {places.map((place) => {
                const cityState = extractCityState(place.fullAddress, place.address);
                const cuisine = getCuisineLabel(place.types);
                const wishlisted = isWishlisted(place.id);

                return (
                  <div
                    key={place.id}
                    className={cn(
                      "flex gap-3 group cursor-pointer rounded-2xl p-2.5 bg-white shadow-sm border border-on-surface/5 transition-all hover:shadow-md",
                      selectedMarker === place.id && "ring-2 ring-primary/20"
                    )}
                    onClick={() => navigate(`/restaurant/${place.id}`)}
                  >
                    <div className="w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 bg-muted self-center relative">
                      {place.photoUrl ? (
                        <img src={place.photoUrl} alt={place.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center bg-on-surface/5">
                          <MapPinned size={20} className="text-on-surface/20" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                      <div>
                        <h3 className="font-serif font-bold text-sm leading-snug truncate">{place.name}</h3>
                        <p className="text-[10px] text-primary/70 font-semibold uppercase tracking-wider mt-0.5">{cuisine}</p>
                        {place.rating > 0 && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <Star size={11} className="fill-primary text-primary" />
                            <span className="text-xs font-bold text-primary">{place.rating.toFixed(1)}</span>
                            {place.priceLevel > 0 && (
                              <span className="text-[11px] font-semibold text-on-surface/40 ml-0.5">· {priceLevelToString(place.priceLevel)}</span>
                            )}
                          </div>
                        )}
                        <p className="text-[11px] text-on-surface/40 mt-0.5 truncate">{cityState}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-center justify-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openAddRestaurantModal({
                            id: place.id, name: place.name,
                            image: place.photoUrl || '', cuisine,
                            price: priceLevelToString(place.priceLevel),
                            address: place.address,
                          });
                        }}
                        className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center text-on-surface/40 hover:text-primary hover:bg-primary/10 transition-colors"
                      >
                        <Plus size={15} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openWishlistModal({
                            id: place.id, name: place.name,
                            image: place.photoUrl || '', cuisine,
                            price: priceLevelToString(place.priceLevel),
                            address: place.address,
                          });
                        }}
                        className={cn("w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                          wishlisted ? "bg-red-50 text-red-400" : "bg-on-surface/5 text-on-surface/40 hover:text-red-400 hover:bg-red-50"
                        )}
                      >
                        <Heart size={14} className={wishlisted ? "fill-red-400" : ""} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
};
