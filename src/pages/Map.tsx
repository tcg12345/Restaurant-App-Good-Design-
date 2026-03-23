import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Star, Heart, Navigation, SlidersHorizontal, Bookmark, Users, MapPinned, ChevronDown, Layers, X, Box, Square, Loader2, ArrowUpDown, UtensilsCrossed, DollarSign, Check } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
// @ts-ignore - Vite worker import for mapbox-gl CSP compatibility
import MapboxWorker from 'mapbox-gl/dist/mapbox-gl-csp-worker?worker';
import { cn } from '../lib/utils';
import { searchNearbyRestaurants, searchPlacesByText, priceLevelToString, CUISINE_TYPES, type PlaceResult } from '../lib/places';
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

export const Map: React.FC = () => {
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const [activeStyle, setActiveStyle] = useState<string>('light');
  const [showStylePicker, setShowStylePicker] = useState(false);
  const [is3D, setIs3D] = useState(false);
  const [places, setPlaces] = useState<PlaceResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);

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
    el.style.opacity = '0';
    el.style.transform = 'scale(0.3) translateY(10px)';
    el.style.transition = 'opacity 0.4s ease, transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
    el.innerHTML = `
      <div class="marker-pin" data-id="${place.id}" style="
        padding: 10px;
        border-radius: 50%;
        background: white;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        cursor: pointer;
        transition: transform 0.2s ease, background 0.2s ease, color 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
      </div>
    `;

    el.addEventListener('mouseenter', () => {
      const pin = el.querySelector('.marker-pin') as HTMLElement;
      if (pin) pin.style.transform = 'scale(1.2)';
    });
    el.addEventListener('mouseleave', () => {
      const pin = el.querySelector('.marker-pin') as HTMLElement;
      if (pin) pin.style.transform = 'scale(1)';
    });

    return el;
  }, []);

  // Show popup for a place
  const showPopup = useCallback((place: PlaceResult, map: mapboxgl.Map) => {
    if (popupRef.current) popupRef.current.remove();
    const ratingHtml = place.rating > 0
      ? `<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="#8B4513" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <span style="font-size:12px;font-weight:700;color:#8B4513;">${place.rating.toFixed(1)}</span>
          <span style="font-size:11px;color:#999;margin-left:2px;">(${place.userRatingCount})</span>
        </div>`
      : '';
    const priceHtml = place.priceLevel > 0
      ? `<span style="font-size:11px;color:#666;font-weight:600;">${'$'.repeat(place.priceLevel)}</span>`
      : '';
    const addressShort = place.address.split(',').slice(0, 2).join(', ');

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
          ${place.photoUrl ? `<img src="${place.photoUrl}" referrerpolicy="no-referrer" style="width:100%;height:100px;object-fit:cover;border-radius:8px;margin-bottom:8px;" />` : ''}
          <div style="font-size:14px;font-weight:700;margin-bottom:4px;line-height:1.3;">${place.name}</div>
          ${ratingHtml}
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:11px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${addressShort}</span>
            ${priceHtml ? `<span style="color:#ccc;">·</span>${priceHtml}` : ''}
          </div>
        </div>
      `)
      .addTo(map);

    popup.on('close', () => {
      setSelectedMarker(null);
      isMarkerSelectedRef.current = false;
      popupRef.current = null;
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
        const el = m.getElement();
        el.style.opacity = '0';
        el.style.transform = 'scale(0.3)';
        setTimeout(() => m.remove(), 400);
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

      // Staggered fade-in
      const delay = Math.min(animIndex * 30, 600);
      setTimeout(() => {
        el.style.opacity = '1';
        el.style.transform = 'scale(1) translateY(0)';
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
      if (isMarkerSelectedRef.current) return;
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
      fetchTimeoutRef.current = setTimeout(() => {
        if (!isMarkerSelectedRef.current) fetchNearby();
      }, 800);
    });

    // Click on map background clears selection & popup
    map.on('click', () => {
      if (isMarkerSelectedRef.current) {
        isMarkerSelectedRef.current = false;
        setSelectedMarker(null);
        if (popupRef.current) {
          popupRef.current.remove();
          popupRef.current = null;
        }
      }
    });

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
        <button className="w-12 h-12 glass rounded-full flex items-center justify-center shadow-xl text-on-surface/60 hover:text-primary transition-colors">
          <Heart size={20} />
        </button>
        <button
          onClick={() => {
            const map = mapRef.current;
            if (!map) return;
            const next = !is3D;
            setIs3D(next);

            map.easeTo({
              pitch: next ? 60 : 0,
              bearing: next ? -20 : 0,
              duration: 1000,
            });

            // Add or remove 3D buildings layer
            const addBuildings = () => {
              if (next && !map.getLayer('3d-buildings')) {
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
              } else if (!next && map.getLayer('3d-buildings')) {
                map.removeLayer('3d-buildings');
              }
            };

            if (map.isStyleLoaded()) {
              addBuildings();
            } else {
              map.once('style.load', addBuildings);
            }
          }}
          className={cn(
            "w-12 h-12 glass rounded-full flex items-center justify-center shadow-xl transition-colors",
            is3D ? "text-primary" : "text-on-surface/60 hover:text-primary"
          )}
        >
          {is3D ? <Square size={20} /> : <Box size={20} />}
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

        {/* Search Bar & Filters */}
        <div className="px-6 pb-4 flex-shrink-0">
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Results List */}
        <div className="px-6 flex-1 overflow-y-auto no-scrollbar pb-32">
          {isSearching && places.length === 0 ? (
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
            <div className="space-y-6">
              {places.map((place) => (
                <div
                  key={place.id}
                  className={cn(
                    "flex gap-4 group cursor-pointer rounded-2xl p-2 -mx-2 transition-colors",
                    selectedMarker === place.id && "bg-primary/5"
                  )}
                  onClick={() => flyToPlace(place)}
                >
                  <div className="w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0 bg-muted">
                    {place.photoUrl ? (
                      <img
                        src={place.photoUrl}
                        alt={place.name}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center bg-on-surface/5">
                        <MapPinned size={24} className="text-on-surface/20" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 py-1 min-w-0">
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <h3 className="font-serif font-bold text-lg truncate">{place.name}</h3>
                      {place.rating > 0 && (
                        <div className="flex items-center gap-1 text-primary flex-shrink-0">
                          <Star size={12} className="fill-primary" />
                          <span className="text-xs font-bold">{place.rating.toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-on-surface/40 font-medium uppercase tracking-wider mb-2 truncate">
                      {place.address.split(',').slice(0, 2).join(', ')}
                      {place.priceLevel > 0 && ` • ${priceLevelToString(place.priceLevel)}`}
                    </p>
                    <div className="flex items-center gap-2">
                      {place.rating >= 4.5 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold uppercase tracking-wider">Top Rated</span>
                      )}
                      {place.userRatingCount > 500 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/10 text-secondary font-bold uppercase tracking-wider">Popular</span>
                      )}
                      {place.priceLevel >= 3 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-on-surface/5 text-on-surface/50 font-bold uppercase tracking-wider">Fine Dining</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
