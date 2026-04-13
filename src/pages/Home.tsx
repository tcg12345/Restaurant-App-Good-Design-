import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { TopBar } from '../components/TopBar';
import { RestaurantCard } from '../components/RestaurantCard';
import { CircleActivity } from '../components/CircleActivity';
import { Search, Loader2, X, ArrowUpDown, DollarSign, UtensilsCrossed, Check, SlidersHorizontal, Bookmark, Star, Heart, Grid, List, ChevronRight, ChevronDown, MapPin, ArrowLeft, Clock, Sparkles, Building2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';
import { searchNearbyRestaurants, searchPlacesByText, searchHotels, priceLevelToString, extractCityState, CUISINE_TYPES, type PlaceResult } from '../lib/places';
import { useLists } from '../contexts/ListsContext';
import { useAuth } from '../contexts/AuthContext';
import { supabaseConfigured } from '../lib/supabase';
import { saveRecentViews } from '../lib/supabase-db';
import { MAPBOX_TOKEN } from './useRestaurantDetail';
import { Link } from 'react-router-dom';
import { SocialFeed } from '../components/SocialFeed';

// Default location (NYC)
const DEFAULT_LAT = 40.735;
const DEFAULT_LNG = -73.99;

const QUICK_FILTERS = ['Near Me', 'Hotels', 'Italian', 'Fine Dining', 'Sushi', 'Mexican'];

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


// Mock data removed — using real ratings from context

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

function applyLocalFilters(allPlaces: PlaceResult[], sort: SortOption, price: number): PlaceResult[] {
  let filtered = allPlaces;
  if (price > 0) {
    filtered = filtered.filter((p) => p.priceLevel === price);
  }
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
}

const SEARCH_STATE_KEY = 'search-page-state';

function saveSearchState(state: any) {
  try { sessionStorage.setItem(SEARCH_STATE_KEY, JSON.stringify(state)); } catch {}
}

function loadSearchState(): any | null {
  try {
    const raw = sessionStorage.getItem(SEARCH_STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function clearSearchState() {
  try { sessionStorage.removeItem(SEARCH_STATE_KEY); } catch {}
}

export const Home: React.FC = () => {
  const { phoneMode, setHideBottomNav } = useSettings();
  const { openAddRestaurantModal, openWishlistModal, isWishlisted, ratings } = useLists();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'general' | 'circle'>('general');

  // Recent views from localStorage (stateful so we can remove items)
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
      if (user?.id && supabaseConfigured) saveRecentViews(user.id, next);
      return next;
    });
  }, [user]);

  // Build preference profile from user's ratings
  const userPreferences = useMemo(() => {
    const cuisineCounts: Record<string, number> = {};
    const priceCounts: Record<number, number> = {};
    const topCuisines: string[] = [];

    ratings.forEach((r) => {
      const weight = r.score >= 7 ? 2 : 1;
      if (r.cuisine) {
        cuisineCounts[r.cuisine] = (cuisineCounts[r.cuisine] || 0) + weight;
      }
      r.tags.forEach((t) => { cuisineCounts[t] = (cuisineCounts[t] || 0) + weight; });
      const priceNum = r.price.length;
      priceCounts[priceNum] = (priceCounts[priceNum] || 0) + weight;
    });

    // Get top 3 cuisines by weighted count
    const sorted = Object.entries(cuisineCounts).sort((a, b) => b[1] - a[1]);
    sorted.slice(0, 3).forEach(([cuisine]) => topCuisines.push(cuisine));

    return { cuisineCounts, priceCounts, topCuisines };
  }, [ratings]);

  // Score-based recommendations from recentViews
  const recentRecommendations = useMemo(() => {
    if (recentViews.length === 0) return [];
    const ratedIds = new Set(ratings.map((r) => r.restaurantId));
    const candidates = recentViews.filter((v) => !ratedIds.has(v.id));

    const scored = candidates.map((place) => {
      let score = 0;
      (place.types || []).forEach((t: string) => {
        const label = t.replace(/_/g, ' ').replace(/restaurant/g, '').trim();
        Object.entries(userPreferences.cuisineCounts).forEach(([tag, count]) => {
          if (tag.toLowerCase().includes(label) || label.includes(tag.toLowerCase())) {
            score += count * 2;
          }
        });
      });
      if (userPreferences.priceCounts[place.priceLevel]) score += userPreferences.priceCounts[place.priceLevel];
      score += (place.rating || 0) * 0.5;
      score += Math.min((place.userRatingCount || 0) / 500, 2);
      return { ...place, recScore: score };
    });

    scored.sort((a, b) => b.recScore - a.recScore);
    return scored.slice(0, 8);
  }, [recentViews, ratings, userPreferences]);

  // Fetch API-based recommendations using user's top cuisines (effect moved after userLat/userLng declarations below)
  const [apiRecommendations, setApiRecommendations] = useState<PlaceResult[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const recsFetchedRef = useRef(false);

  // Combine recommendations: API-based first, then scored recent views
  const recommendations = useMemo(() => {
    const combined = [...apiRecommendations, ...recentRecommendations];
    const seen = new Set<string>();
    return combined.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    }).slice(0, 8);
  }, [apiRecommendations, recentRecommendations]);

  // User's top rated restaurants (for when there's no other content)
  const topRated = useMemo(() => {
    return [...ratings]
      .filter((r) => r.score >= 7 && r.image)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [ratings]);

  // Restore saved search state on mount (survives navigation to detail page and back)
  const savedState = useRef(loadSearchState());
  const ss = savedState.current;

  const [rawPlaces, setRawPlaces] = useState<PlaceResult[]>(ss?.rawPlaces || []);
  const [places, setPlaces] = useState<PlaceResult[]>(ss?.places || []);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState(ss?.searchQuery || '');
  const [activeFilter, setActiveFilter] = useState<string | null>(ss?.activeFilter || null);
  const [hotelIds, setHotelIds] = useState<Set<string>>(new Set(ss?.hotelIds || []));
  const [userLat, setUserLat] = useState(ss?.userLat || DEFAULT_LAT);
  const [userLng, setUserLng] = useState(ss?.userLng || DEFAULT_LNG);

  // Search page state
  const [searchActive, setSearchActive] = useState(!!ss);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filter panel state
  const [showFilters, setShowFiltersRaw] = useState(false);
  const setShowFilters = useCallback((show: boolean) => {
    setShowFiltersRaw(show);
    setHideBottomNav(show);
  }, [setHideBottomNav]);
  const [showAllResults, setShowAllResults] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<SortOption>(ss?.sortBy || 'popularity');
  const [selectedPrice, setSelectedPrice] = useState(ss?.selectedPrice || 0);
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>(ss?.selectedCuisines || []);

  // Location search state
  const [locationQuery, setLocationQuery] = useState('');
  const [locationLabel, setLocationLabel] = useState(ss?.locationLabel || '');
  const [locationResults, setLocationResults] = useState<{ id: string; name: string; lat: number; lng: number }[]>([]);
  const [showLocationResults, setShowLocationResults] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch API-based recommendations using user's top cuisines (or generic nearby if no ratings)
  useEffect(() => {
    if (recsFetchedRef.current) return;
    recsFetchedRef.current = true;

    const ratedIds = new Set(ratings.map((r) => r.restaurantId));
    const recentIds = new Set(recentViews.map((v) => v.id));
    const topCuisines = userPreferences.topCuisines;

    setRecsLoading(true);

    const queries = topCuisines.length > 0
      ? topCuisines.slice(0, 2).map((cuisine) =>
          searchPlacesByText(`best ${cuisine} restaurants`, userLat, userLng)
            .catch(() => [] as PlaceResult[])
        )
      : [
          searchNearbyRestaurants(userLat, userLng).catch(() => [] as PlaceResult[]),
          searchPlacesByText('best restaurants', userLat, userLng).catch(() => [] as PlaceResult[]),
        ];

    Promise.all(queries).then((results) => {
      const all = results.flat();
      const seen = new Set<string>();
      const fresh = all.filter((p) => {
        if (seen.has(p.id) || ratedIds.has(p.id) || recentIds.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
      setApiRecommendations(fresh.slice(0, 8));
      setRecsLoading(false);
    });
  }, [ratings, userPreferences.topCuisines, userLat, userLng, recentViews]);

  // Save search state to sessionStorage whenever search is active (so it persists across navigation)
  useEffect(() => {
    if (!searchActive) return;
    saveSearchState({
      searchQuery, rawPlaces, places, activeFilter, userLat, userLng,
      sortBy, selectedPrice, selectedCuisines, locationLabel,
      hotelIds: [...hotelIds],
    });
  }, [searchActive, searchQuery, rawPlaces, places, activeFilter, userLat, userLng, sortBy, selectedPrice, selectedCuisines, locationLabel, hotelIds]);

  const activeFilterCount = (selectedCuisines.length > 0 ? 1 : 0) + (selectedPrice > 0 ? 1 : 0) + (sortBy !== 'popularity' ? 1 : 0);

  // When rawPlaces or filter settings change, recompute displayed places
  useEffect(() => {
    setPlaces(applyLocalFilters(rawPlaces, sortBy, selectedPrice));
  }, [rawPlaces, sortBy, selectedPrice]);

  // Get user location on mount (skip if we restored a custom location from saved state)
  useEffect(() => {
    if (ss?.locationLabel) return; // restored state has a custom location — don't override
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLat(pos.coords.latitude);
          setUserLng(pos.coords.longitude);
        },
        () => {} // silently fall back to default
      );
    }
  }, []);

  // Auto-focus the search input when search page opens
  useEffect(() => {
    if (searchActive && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [searchActive]);

  // Location geocoding
  useEffect(() => {
    if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
    if (!locationQuery.trim()) {
      setLocationResults([]);
      return;
    }
    setLocationLoading(true);
    locationDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(locationQuery)}.json?access_token=${MAPBOX_TOKEN}&types=place,locality,neighborhood,address&limit=5`
        );
        const data = await res.json();
        const items = (data.features || []).map((f: any) => ({
          id: f.id,
          name: f.place_name,
          lat: f.center[1],
          lng: f.center[0],
        }));
        setLocationResults(items);
      } catch {
        setLocationResults([]);
      } finally {
        setLocationLoading(false);
      }
    }, 300);
    return () => { if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current); };
  }, [locationQuery]);

  const handleSelectLocation = useCallback((name: string, lat: number, lng: number) => {
    setUserLat(lat);
    setUserLng(lng);
    setLocationLabel(name);
    setLocationQuery('');
    setShowLocationResults(false);
    setLocationResults([]);
  }, []);

  const handleUseCurrentLocation = useCallback(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        handleSelectLocation('Current Location', pos.coords.latitude, pos.coords.longitude);
      });
    }
  }, [handleSelectLocation]);

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setIsLoading(true);
    setActiveFilter(null);
    setShowAllResults(false);
    try {
      const isHotelQuery = /hotel/i.test(query);
      if (isHotelQuery) {
        // Prioritize hotel results, then regular results
        const [hotelResults, textResults] = await Promise.all([
          searchHotels(query, userLat, userLng),
          searchPlacesByText(query, userLat, userLng, locationLabel || undefined),
        ]);
        const hIds = new Set(hotelResults.map((p) => p.id));
        setHotelIds(hIds);
        // Merge: hotels first, then non-duplicate regular results
        const seen = new Set(hotelResults.map((p) => p.id));
        const extra = textResults.filter((p) => !seen.has(p.id));
        setRawPlaces([...hotelResults, ...extra]);
      } else {
        setHotelIds(new Set());
        const results = await searchPlacesByText(query, userLat, userLng, locationLabel || undefined);
        setRawPlaces(results);
      }
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userLat, userLng, locationLabel]);

  // Auto-search after user stops typing for 500ms
  // Skip the first trigger if we restored saved state (results are already loaded)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipInitialSearch = useRef(!!ss);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!searchQuery.trim() || !searchActive) return;
    if (skipInitialSearch.current) {
      skipInitialSearch.current = false;
      return;
    }
    debounceRef.current = setTimeout(() => {
      handleSearch(searchQuery);
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery, handleSearch, searchActive]);

  const handleFilterClick = useCallback(async (filter: string) => {
    setShowAllResults(false);
    if (activeFilter === filter) {
      setActiveFilter(null);
      setHotelIds(new Set());
      setIsLoading(true);
      try {
        const results = await searchNearbyRestaurants(userLat, userLng, 2000, selectedCuisines, 0, locationLabel || undefined);
        setRawPlaces(results);
      } catch (err) {
        console.error('Nearby search failed:', err);
      } finally {
        setIsLoading(false);
      }
      return;
    }
    setActiveFilter(filter);
    setIsLoading(true);
    try {
      let results: PlaceResult[];
      if (filter === 'Hotels') {
        results = await searchHotels('hotels', userLat, userLng);
        setHotelIds(new Set(results.map((p) => p.id)));
      } else if (filter === 'Near Me') {
        setHotelIds(new Set());
        results = await searchNearbyRestaurants(userLat, userLng, 1000, selectedCuisines, 0, locationLabel || undefined);
      } else {
        setHotelIds(new Set());
        results = await searchPlacesByText(filter, userLat, userLng, locationLabel || undefined);
      }
      setRawPlaces(results);
    } catch (err) {
      console.error('Filter search failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeFilter, userLat, userLng, selectedCuisines, locationLabel]);

  const handleApplyFilters = useCallback(async () => {
    setShowFilters(false);
    setIsLoading(true);
    try {
      const results = await searchNearbyRestaurants(userLat, userLng, 2000, selectedCuisines, selectedPrice, locationLabel || undefined);
      setRawPlaces(results);
    } catch (err) {
      console.error('Filter search failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userLat, userLng, selectedCuisines, selectedPrice, locationLabel]);

  const handleBackFromSearch = () => {
    setSearchActive(false);
    setSearchQuery('');
    setRawPlaces([]);
    setPlaces([]);
    setActiveFilter(null);
    setShowAllResults(false);
    setShowLocationResults(false);
    setHotelIds(new Set());
    clearSearchState();
  };

  // Remove a single cuisine chip and re-fetch server-side results
  const handleRemoveCuisine = useCallback(async (type: string) => {
    const next = selectedCuisines.filter((c) => c !== type);
    setSelectedCuisines(next);
    setIsLoading(true);
    try {
      const results = await searchNearbyRestaurants(userLat, userLng, 2000, next, selectedPrice, locationLabel || undefined);
      setRawPlaces(results);
    } catch (err) {
      console.error('Filter search failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedCuisines, userLat, userLng, selectedPrice, locationLabel]);

  const handleClearAllFilters = useCallback(() => {
    setSortBy('popularity');
    setSelectedPrice(0);
    setSelectedCuisines([]);
    if (activeFilter) {
      handleFilterClick(activeFilter);
    }
  }, [activeFilter, handleFilterClick]);

  // Build dismissible filter chips (quick filter + cuisines + price + sort)
  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string; onClear: () => void }[] = [];
    if (activeFilter) {
      chips.push({
        key: `quick:${activeFilter}`,
        label: activeFilter,
        onClear: () => handleFilterClick(activeFilter),
      });
    }
    for (const type of selectedCuisines) {
      const cuisine = CUISINE_TYPES.find((c) => c.type === type);
      chips.push({
        key: `cuisine:${type}`,
        label: cuisine?.label || type,
        onClear: () => handleRemoveCuisine(type),
      });
    }
    if (selectedPrice > 0) {
      const priceLabel = PRICE_LEVELS.find((p) => p.value === selectedPrice)?.label;
      chips.push({
        key: `price:${selectedPrice}`,
        label: priceLabel || `$${selectedPrice}`,
        onClear: () => setSelectedPrice(0),
      });
    }
    if (sortBy !== 'popularity') {
      const sortLabel = SORT_OPTIONS.find((o) => o.value === sortBy)?.label;
      chips.push({
        key: `sort:${sortBy}`,
        label: sortLabel || sortBy,
        onClear: () => setSortBy('popularity'),
      });
    }
    return chips;
  }, [activeFilter, selectedCuisines, selectedPrice, sortBy, handleFilterClick, handleRemoveCuisine]);

  return (
    <>
      {/* ═══════════════════════════════════════════
          MAIN FEED PAGE
          ═══════════════════════════════════════════ */}
      <div className="pb-32">
        <TopBar />

        <main className="px-3">
          <div className="flex items-center justify-center gap-6 mb-8 border-b border-muted">
            <button
              onClick={() => setActiveTab('general')}
              className={`pb-4 text-sm font-bold uppercase tracking-widest transition-all relative ${
                activeTab === 'general' ? 'text-primary' : 'text-on-surface/40'
              }`}
            >
              General Search
              {activeTab === 'general' && (
                <motion.div layoutId="tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('circle')}
              className={`pb-4 text-sm font-bold uppercase tracking-widest transition-all relative ${
                activeTab === 'circle' ? 'text-primary' : 'text-on-surface/40'
              }`}
            >
              Circle Activity
              {activeTab === 'circle' && (
                <motion.div layoutId="tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          </div>

          {activeTab === 'general' ? (
            <>
              {/* Fake search bar — tapping opens the search page */}
              <button
                onClick={() => setSearchActive(true)}
                className="w-full relative mb-8"
              >
                <div className="absolute inset-y-0 left-4 flex items-center text-on-surface/40">
                  <Search size={18} />
                </div>
                <div className="w-full bg-on-surface/[0.04] rounded-full py-3.5 pl-11 pr-4 text-sm font-medium text-on-surface/40 text-left">
                  Search restaurant, cuisine, occasion...
                </div>
              </button>

              {/* Your Top Rated */}
              {ratings.length > 0 && (
                <section className="mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-serif font-bold">Your Top Rated</h2>
                    <Link to="/pantry" className="text-xs font-semibold text-primary">See All</Link>
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-2 -mx-3 px-3 scrollbar-hide snap-x snap-mandatory">
                    {[...ratings].sort((a, b) => b.score - a.score).slice(0, 8).map((r) => (
                      <Link
                        key={r.restaurantId}
                        to={`/restaurant/${r.restaurantId}`}
                        className="flex-shrink-0 snap-start group"
                      >
                        <div className="relative w-44 aspect-[3/4] rounded-2xl overflow-hidden bg-muted">
                          {r.image ? (
                            <img
                              src={r.image}
                              alt={r.name}
                              className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center bg-on-surface/5 text-on-surface/20 font-serif text-5xl font-bold">
                              {r.name.charAt(0)}
                            </div>
                          )}
                          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />
                          <div className="absolute inset-x-0 bottom-0 p-3">
                            <p className="text-white text-sm font-bold leading-tight drop-shadow-sm line-clamp-2">{r.name}</p>
                            <div className="flex items-center gap-1 mt-1">
                              <Star size={11} className="fill-white text-white" />
                              <span className="text-white/95 text-[11px] font-semibold">{r.score.toFixed(1)}</span>
                              <span className="text-white/60 text-[11px]">/ 10</span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {/* Friend Activity Feed */}
              <SocialFeed />
            </>
          ) : (
            <CircleActivity />
          )}
        </main>
      </div>

      {/* ═══════════════════════════════════════════
          SEARCH PAGE — slides up as bottom sheet
          ═══════════════════════════════════════════ */}
      <AnimatePresence>
        {searchActive && (
          <motion.div
            key="search-overlay"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed inset-0 z-40 bg-surface overflow-y-auto"
          >
            <div className="pb-32 min-h-full">
              <div className="px-3 pt-4">
                {/* Phone: back arrow on its own row above search bars */}
                {phoneMode && (
                  <button
                    onClick={handleBackFromSearch}
                    className="mb-2 p-1 text-on-surface/50 hover:text-on-surface transition-colors"
                  >
                    <ArrowLeft size={22} />
                  </button>
                )}

                {/* Desktop: back arrow inline with search bars */}
                <div className={cn(phoneMode ? "" : "flex items-start gap-3 mb-3")}>
                  {!phoneMode && (
                    <button
                      onClick={handleBackFromSearch}
                      className="mt-3 p-1 text-on-surface/50 hover:text-on-surface transition-colors flex-shrink-0"
                    >
                      <ArrowLeft size={22} />
                    </button>
                  )}

                  <div className={cn(phoneMode ? "" : "flex-1 flex gap-3")}>
                    {/* Restaurant search */}
                    <form
                      className={cn("relative", phoneMode ? "mb-2.5" : "flex-[2]")}
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSearch(searchQuery);
                      }}
                    >
                      <div className="absolute inset-y-0 left-4 flex items-center text-on-surface/40">
                        <Search size={20} />
                      </div>
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search restaurant, cuisine, occasion..."
                        className="w-full bg-on-surface/[0.04] rounded-full py-3.5 pl-12 pr-12 text-sm font-medium focus:outline-none focus:bg-on-surface/[0.06] transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowFilters(true)}
                        className="absolute inset-y-0 right-4 flex items-center text-primary"
                      >
                        <div className="relative">
                          <SlidersHorizontal size={20} />
                          {activeFilterCount > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center">
                              {activeFilterCount}
                            </span>
                          )}
                        </div>
                      </button>
                    </form>

                    {/* Location search */}
                    <div className={cn("relative", phoneMode ? "" : "flex-1")}>
                      <div className="absolute inset-y-0 left-4 flex items-center text-on-surface/40">
                        <MapPin size={18} />
                      </div>
                      <input
                        type="text"
                        value={locationQuery}
                        onChange={(e) => {
                          setLocationQuery(e.target.value);
                          setShowLocationResults(true);
                        }}
                        onFocus={() => { if (locationQuery.trim()) setShowLocationResults(true); }}
                        placeholder={locationLabel || 'Location...'}
                        className={cn(
                          "w-full bg-on-surface/[0.04] rounded-full py-3.5 pl-11 pr-10 text-sm font-medium focus:outline-none focus:bg-on-surface/[0.06] transition-all",
                          locationLabel && !locationQuery && "placeholder:text-on-surface/70"
                        )}
                      />
                      {(locationQuery || locationLabel) && (
                        <button
                          type="button"
                          onClick={() => {
                            setLocationQuery('');
                            setLocationLabel('');
                            setShowLocationResults(false);
                            setLocationResults([]);
                            if (navigator.geolocation) {
                              navigator.geolocation.getCurrentPosition(
                                (pos) => { setUserLat(pos.coords.latitude); setUserLng(pos.coords.longitude); },
                                () => { setUserLat(DEFAULT_LAT); setUserLng(DEFAULT_LNG); }
                              );
                            }
                          }}
                          className="absolute inset-y-0 right-3 flex items-center text-on-surface/30 hover:text-on-surface/60 transition-colors"
                        >
                          <X size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Location search results dropdown */}
                <AnimatePresence>
                  {showLocationResults && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowLocationResults(false)} />
                      <motion.div
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        transition={{ duration: 0.15 }}
                        className={cn("relative z-20 bg-white rounded-2xl shadow-lg border border-on-surface/8 mb-3 overflow-hidden", !phoneMode && "ml-9")}
                      >
                        <button
                          onClick={handleUseCurrentLocation}
                          className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-on-surface/[0.03] transition-colors border-b border-on-surface/6"
                        >
                          <MapPin size={18} className="text-on-surface/30 flex-shrink-0" />
                          <span className="text-sm font-semibold text-on-surface">Current Location</span>
                        </button>
                        {locationLoading && locationQuery.trim() && (
                          <div className="flex items-center gap-3 px-5 py-4">
                            <Loader2 size={16} className="text-on-surface/30 animate-spin" />
                            <span className="text-sm text-on-surface/40">Searching...</span>
                          </div>
                        )}
                        {!locationLoading && locationResults.map((loc) => (
                          <button
                            key={loc.id}
                            onClick={() => handleSelectLocation(loc.name, loc.lat, loc.lng)}
                            className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-on-surface/[0.03] transition-colors border-b border-on-surface/6 last:border-b-0"
                          >
                            <MapPin size={18} className="text-on-surface/25 flex-shrink-0" />
                            <span className="text-sm font-medium text-on-surface">{loc.name}</span>
                          </button>
                        ))}
                        {!locationLoading && locationQuery.trim() && locationResults.length === 0 && (
                          <div className="px-5 py-4 text-sm text-on-surface/40">No locations found</div>
                        )}
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>

                {/* Quick filters */}
                <div className={cn("flex gap-2 overflow-x-auto pb-3 no-scrollbar mb-3 mt-3", !phoneMode && "ml-9")}>
                  {QUICK_FILTERS.map((filter) => (
                    <button
                      key={filter}
                      onClick={() => handleFilterClick(filter)}
                      className={cn(
                        "whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-colors",
                        activeFilter === filter
                          ? 'bg-primary text-white border border-primary'
                          : 'bg-transparent border border-on-surface/10 text-on-surface/70 hover:border-on-surface/25',
                      )}
                    >
                      {filter}
                    </button>
                  ))}
                </div>

                {/* Active filter chips — show what's filtered, each dismissible */}
                {activeFilterChips.length > 0 && (
                  <div className={cn("flex flex-wrap gap-2 mb-4", !phoneMode && "ml-9")}>
                    {activeFilterChips.map((chip) => (
                      <button
                        key={chip.key}
                        onClick={chip.onClear}
                        className="group inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/15 transition-colors"
                        aria-label={`Clear ${chip.label} filter`}
                      >
                        <span>{chip.label}</span>
                        <span className="w-4 h-4 rounded-full bg-primary/20 group-hover:bg-primary/30 flex items-center justify-center transition-colors">
                          <X size={10} strokeWidth={3} />
                        </span>
                      </button>
                    ))}
                    {activeFilterChips.length > 1 && (
                      <button
                        onClick={handleClearAllFilters}
                        className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold text-on-surface/50 hover:text-on-surface/80 transition-colors"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                )}

                {/* Results */}
                <div className={cn(!phoneMode && "ml-9")}>
                  {isLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 size={24} className={cn("animate-spin", activeFilter === 'Hotels' ? "text-teal-600" : "text-primary")} />
                      <span className="ml-3 text-sm text-on-surface/50 font-medium">{activeFilter === 'Hotels' ? 'Finding hotels...' : 'Finding restaurants...'}</span>
                    </div>
                  ) : places.length === 0 && (searchQuery.trim() || activeFilter) ? (
                    <div className="text-center py-16">
                      {activeFilter === 'Hotels' ? <Building2 size={32} className="mx-auto text-on-surface/15 mb-3" /> : null}
                      <p className="text-on-surface/40 text-sm font-medium">{activeFilter === 'Hotels' ? 'No hotels found' : 'No restaurants found'}</p>
                      <p className="text-on-surface/30 text-xs mt-1">Try a different search or filter</p>
                    </div>
                  ) : places.length === 0 ? (
                    <div className="space-y-8">
                      {/* Recommendations */}
                      {recsLoading ? (
                        <section>
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
                        <section>
                          <div className="flex items-center gap-2 mb-3">
                            <Sparkles size={15} className="text-primary/60" />
                            <h3 className="text-sm font-bold text-on-surface/60 uppercase tracking-wider">Recommended For You</h3>
                          </div>
                          <div className={cn("grid gap-x-3 gap-y-6", phoneMode ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4")}>
                            {recommendations.map((place) => {
                              const props = placeToCardProps(place as any);
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
                        </section>
                      ) : null}

                      {/* Your Top Rated — shown when user has ratings */}
                      {topRated.length > 0 && (
                        <section>
                          <div className="flex items-center gap-2 mb-3">
                            <Star size={15} className="text-primary/60 fill-primary/60" />
                            <h3 className="text-sm font-bold text-on-surface/60 uppercase tracking-wider">Your Top Rated</h3>
                          </div>
                          <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar -mx-1 px-1 snap-x snap-mandatory">
                            {topRated.map((r) => (
                              <Link
                                key={r.restaurantId}
                                to={`/restaurant/${r.restaurantId}`}
                                className="flex-shrink-0 snap-start group"
                              >
                                <div className="relative w-44 aspect-[3/4] rounded-2xl overflow-hidden bg-muted">
                                  {r.image ? (
                                    <img
                                      src={r.image}
                                      alt={r.name}
                                      className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                      referrerPolicy="no-referrer"
                                    />
                                  ) : (
                                    <div className="absolute inset-0 flex items-center justify-center bg-on-surface/5 text-on-surface/20 font-serif text-5xl font-bold">
                                      {r.name.charAt(0)}
                                    </div>
                                  )}
                                  <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />
                                  <div className="absolute inset-x-0 bottom-0 p-3">
                                    <p className="text-white text-sm font-bold leading-tight drop-shadow-sm line-clamp-2">{r.name}</p>
                                    <div className="flex items-center gap-1 mt-1">
                                      <Star size={11} className="fill-white text-white" />
                                      <span className="text-white/95 text-[11px] font-semibold">{r.score.toFixed(1)}</span>
                                      <span className="text-white/60 text-[11px]">/ 10</span>
                                    </div>
                                  </div>
                                </div>
                              </Link>
                            ))}
                          </div>
                        </section>
                      )}

                      {/* Empty state — only if nothing at all to show */}
                      {recommendations.length === 0 && topRated.length === 0 && !recsLoading && (
                        <div className="text-center py-16">
                          <Search size={32} className="mx-auto text-on-surface/15 mb-3" />
                          <p className="text-sm font-medium text-on-surface/40">Discover restaurants</p>
                          <p className="text-xs text-on-surface/30 mt-1">Search by name, cuisine, or use the filters above</p>
                        </div>
                      )}
                    </div>
                  ) : (() => {
                    const initialCount = phoneMode ? 8 : 8;
                    const visiblePlaces = showAllResults ? places : places.slice(0, initialCount);
                    const hasMore = places.length > initialCount;
                    return (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <h2 className="text-lg font-serif font-bold">Results</h2>
                          <div className="flex items-center gap-3">
                            <span className="text-on-surface/40 text-xs font-bold uppercase tracking-widest">
                              {places.length} found
                            </span>
                            <div className="flex items-center gap-0.5 rounded-full bg-on-surface/[0.04] p-0.5">
                              <button
                                onClick={() => setViewMode('grid')}
                                aria-label="Grid view"
                                aria-pressed={viewMode === 'grid'}
                                className={cn(
                                  "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                                  viewMode === 'grid'
                                    ? "bg-white text-primary shadow-sm"
                                    : "text-on-surface/40 hover:text-on-surface/60",
                                )}
                              >
                                <Grid size={14} />
                              </button>
                              <button
                                onClick={() => setViewMode('list')}
                                aria-label="List view"
                                aria-pressed={viewMode === 'list'}
                                className={cn(
                                  "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                                  viewMode === 'list'
                                    ? "bg-white text-primary shadow-sm"
                                    : "text-on-surface/40 hover:text-on-surface/60",
                                )}
                              >
                                <List size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                        {viewMode === 'grid' ? (
                          <div className={cn("grid gap-x-3 sm:gap-x-4 gap-y-6 sm:gap-y-7", phoneMode ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5")}>
                            {visiblePlaces.map((place) => {
                              const props = placeToCardProps(place);
                              const placeIsHotel = hotelIds.has(place.id) || place.types?.includes('hotel') || place.types?.includes('lodging');
                              return (
                                <RestaurantCard
                                  key={place.id}
                                  {...props}
                                  isHotel={placeIsHotel}
                                  isWishlisted={isWishlisted(place.id)}
                                  onAdd={() => openAddRestaurantModal({
                                    id: place.id,
                                    name: place.name,
                                    image: props.image,
                                    cuisine: props.cuisine,
                                    price: props.price,
                                    address: place.address,
                                  })}
                                  onHeart={() => openWishlistModal({
                                    id: place.id,
                                    name: place.name,
                                    image: props.image,
                                    cuisine: props.cuisine,
                                    price: props.price,
                                    address: place.address,
                                  })}
                                />
                              );
                            })}
                          </div>
                        ) : (
                          <div className="divide-y divide-on-surface/[0.06] border-y border-on-surface/[0.06]">
                            {visiblePlaces.map((place) => {
                              const props = placeToCardProps(place);
                              const placeIsHotel = hotelIds.has(place.id) || place.types?.includes('hotel') || place.types?.includes('lodging');
                              const wishlisted = isWishlisted(place.id);
                              return (
                                <Link
                                  key={place.id}
                                  to={`/restaurant/${place.id}`}
                                  className="flex items-center gap-4 py-4 group"
                                >
                                  <div className="relative w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 bg-on-surface/[0.05]">
                                    <img
                                      src={props.image}
                                      alt={place.name}
                                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                      referrerPolicy="no-referrer"
                                    />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2">
                                      <h3 className="font-serif text-[17px] font-bold text-on-surface line-clamp-1 leading-tight">
                                        {place.name}
                                      </h3>
                                      <div className={cn("flex items-center gap-0.5 flex-shrink-0 pt-0.5", placeIsHotel ? "text-teal-600" : "text-primary")}>
                                        <Star size={13} className={cn(placeIsHotel ? "fill-teal-600" : "fill-primary")} />
                                        <span className="text-sm font-bold">{props.rating}</span>
                                      </div>
                                    </div>
                                    <p className="mt-1 text-[11px] text-on-surface/50 font-medium uppercase tracking-wider truncate">
                                      {props.cuisine}
                                      {props.price && <span className="text-on-surface/25 mx-1.5">·</span>}
                                      {props.price}
                                    </p>
                                  </div>
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      openWishlistModal({
                                        id: place.id,
                                        name: place.name,
                                        image: props.image,
                                        cuisine: props.cuisine,
                                        price: props.price,
                                        address: place.address,
                                      });
                                    }}
                                    aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
                                    className={cn(
                                      "flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full transition-colors",
                                      wishlisted ? "text-red-500" : "text-on-surface/30 hover:text-on-surface/60",
                                    )}
                                  >
                                    <Heart size={18} className={cn(wishlisted && "fill-red-500")} />
                                  </button>
                                </Link>
                              );
                            })}
                          </div>
                        )}
                        {hasMore && (
                          <button
                            onClick={() => setShowAllResults(!showAllResults)}
                            className="w-full flex flex-col items-center gap-1 mt-4 py-3 text-on-surface/40 hover:text-primary transition-colors"
                          >
                            <span className="text-xs font-bold uppercase tracking-wider">
                              {showAllResults ? 'Show less' : `Show all ${places.length} results`}
                            </span>
                            <ChevronDown size={20} className={cn("transition-transform", showAllResults && "rotate-180")} />
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Filter Panel */}
              <AnimatePresence>
                {showFilters && (
                  <>
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 bg-black/30 z-50"
                      onClick={() => setShowFilters(false)}
                    />
                    <motion.div
                      initial={{ y: '100%' }}
                      animate={{ y: 0 }}
                      exit={{ y: '100%' }}
                      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                      drag="y"
                      dragConstraints={{ top: 0, bottom: 0 }}
                      dragElastic={{ top: 0, bottom: 0.6 }}
                      onDragEnd={(_e, info) => {
                        if (info.offset.y > 100 || info.velocity.y > 300) setShowFilters(false);
                      }}
                      className="fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-3xl shadow-2xl max-h-[85vh] flex flex-col overflow-hidden"
                    >
                      {/* Drag handle */}
                      <div className="flex justify-center pt-3 pb-1 flex-shrink-0 cursor-grab active:cursor-grabbing">
                        <div className="w-10 h-1 rounded-full bg-on-surface/15" />
                      </div>
                      <div className="flex-shrink-0 bg-surface z-10 px-6 pt-2 pb-4 border-b border-black/5">
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
                      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
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
                      <div className="flex-shrink-0 bg-surface border-t border-black/5 px-6 py-4 flex gap-3">
                        <button
                          onClick={() => { setSortBy('popularity'); setSelectedCuisines([]); setSelectedPrice(0); }}
                          className="flex-1 py-3.5 rounded-2xl border-2 border-on-surface/10 text-sm font-semibold text-on-surface/60 hover:bg-muted transition-colors"
                        >
                          Reset
                        </button>
                        <button
                          onClick={handleApplyFilters}
                          className="flex-[2] py-3.5 rounded-2xl bg-primary text-white text-sm font-semibold shadow-lg shadow-primary/25 hover:shadow-xl transition-shadow"
                        >
                          Apply Filters
                        </button>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
