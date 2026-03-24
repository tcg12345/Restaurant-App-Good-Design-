import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TopBar } from '../components/TopBar';
import { RestaurantCard } from '../components/RestaurantCard';
import { CircleActivity } from '../components/CircleActivity';
import { Search, Filter, Loader2, X, ArrowUpDown, DollarSign, UtensilsCrossed, Check, SlidersHorizontal, Bookmark, Star, Heart, Grid, List, ChevronRight, ChevronDown, MapPin } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';
import { searchNearbyRestaurants, searchPlacesByText, priceLevelToString, CUISINE_TYPES, type PlaceResult } from '../lib/places';
import { MAPBOX_TOKEN } from './useRestaurantDetail';
import { SocialFeed } from '../components/SocialFeed';

// Default location (NYC)
const DEFAULT_LAT = 40.735;
const DEFAULT_LNG = -73.99;

const QUICK_FILTERS = ['Near Me', 'Italian', 'Fine Dining', 'Sushi', 'Mexican'];

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

const COLLECTION_NAMES = ['Date Nights', 'Hidden Gems', 'Best Cocktails', 'Quick Bites'];

const RATED_SPOTS = [
  {
    id: '1',
    name: 'Lumière Gastronomie',
    image: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&q=80&w=800',
    rating: 4.9,
    price: '$$$$',
    cuisine: 'Modern French',
  },
  {
    id: '2',
    name: 'The Alchemist Table',
    image: 'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&q=80&w=800',
    rating: 4.7,
    price: '$$$',
    cuisine: 'Molecular',
  },
];

function placeToCardProps(place: PlaceResult) {
  return {
    id: place.id,
    name: place.name,
    image: place.photoUrl || 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&q=80&w=800',
    rating: place.rating,
    price: priceLevelToString(place.priceLevel),
    cuisine: place.address.split(',')[0],
    distance: '',

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

export const Home: React.FC = () => {
  const { phoneMode, setHideBottomNav } = useSettings();
  const [activeTab, setActiveTab] = useState<'general' | 'circle'>('general');
  const [rawPlaces, setRawPlaces] = useState<PlaceResult[]>([]);
  const [places, setPlaces] = useState<PlaceResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [userLat, setUserLat] = useState(DEFAULT_LAT);
  const [userLng, setUserLng] = useState(DEFAULT_LNG);

  // Filter panel state
  const [showFilters, setShowFiltersRaw] = useState(false);
  const setShowFilters = useCallback((show: boolean) => {
    setShowFiltersRaw(show);
    setHideBottomNav(show);
  }, [setHideBottomNav]);
  const [showAllResults, setShowAllResults] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('popularity');
  const [selectedPrice, setSelectedPrice] = useState(0);
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>([]);

  // Location search state
  const [locationQuery, setLocationQuery] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [locationResults, setLocationResults] = useState<{ id: string; name: string; lat: number; lng: number }[]>([]);
  const [showLocationResults, setShowLocationResults] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeFilterCount = (selectedCuisines.length > 0 ? 1 : 0) + (selectedPrice > 0 ? 1 : 0) + (sortBy !== 'popularity' ? 1 : 0);

  // When rawPlaces or filter settings change, recompute displayed places
  useEffect(() => {
    setPlaces(applyLocalFilters(rawPlaces, sortBy, selectedPrice));
  }, [rawPlaces, sortBy, selectedPrice]);

  // Get user location on mount
  useEffect(() => {
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

  // Load nearby restaurants on mount
  useEffect(() => {
    setIsLoading(true);
    searchNearbyRestaurants(userLat, userLng, 2000, selectedCuisines)
      .then(setRawPlaces)
      .catch((err) => console.error('Initial search failed:', err))
      .finally(() => setIsLoading(false));
  }, [userLat, userLng]);

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
      const results = await searchPlacesByText(query, userLat, userLng);
      setRawPlaces(results);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userLat, userLng]);

  // Auto-search after user stops typing for 500ms
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!searchQuery.trim()) return;
    debounceRef.current = setTimeout(() => {
      handleSearch(searchQuery);
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery, handleSearch]);

  const handleFilterClick = useCallback(async (filter: string) => {
    setShowAllResults(false);
    if (activeFilter === filter) {
      // Deselect — reload nearby
      setActiveFilter(null);
      setIsLoading(true);
      try {
        const results = await searchNearbyRestaurants(userLat, userLng, 2000, selectedCuisines);
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
      if (filter === 'Near Me') {
        results = await searchNearbyRestaurants(userLat, userLng, 1000, selectedCuisines);
      } else {
        results = await searchPlacesByText(filter, userLat, userLng);
      }
      setRawPlaces(results);
    } catch (err) {
      console.error('Filter search failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeFilter, userLat, userLng, selectedCuisines]);

  const handleApplyFilters = useCallback(async () => {
    setShowFilters(false);
    setIsLoading(true);
    try {
      const results = await searchNearbyRestaurants(userLat, userLng, 2000, selectedCuisines, selectedPrice);
      setRawPlaces(results);
    } catch (err) {
      console.error('Filter search failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userLat, userLng, selectedCuisines, selectedPrice]);

  return (
    <div className="pb-32">
      <TopBar />

      <main className="px-6">
        <div className="flex items-center gap-6 mb-8 border-b border-muted">
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
            {/* Search bars — desktop: side by side, mobile: stacked */}
            <div className={cn("mb-4", !phoneMode && "flex gap-3")}>
              {/* Restaurant search */}
              <form
                className={cn("relative", phoneMode ? "mb-3" : "flex-[2]")}
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSearch(searchQuery);
                }}
              >
                <div className="absolute inset-y-0 left-4 flex items-center text-on-surface/40">
                  <Search size={20} />
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search restaurant, cuisine, occasion..."
                  className="w-full bg-white rounded-2xl py-4 pl-12 pr-12 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
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
                    "w-full bg-white rounded-2xl py-4 pl-11 pr-10 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all",
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
                      // Reset to default location
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
                  className="relative z-20 bg-white rounded-2xl shadow-lg border border-on-surface/8 mb-4 overflow-hidden"
                >
                  {/* Current Location option */}
                  <button
                    onClick={() => {
                      handleUseCurrentLocation();
                    }}
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

            <div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar mb-6">
              {QUICK_FILTERS.map((filter) => (
                <button
                  key={filter}
                  onClick={() => handleFilterClick(filter)}
                  className={`whitespace-nowrap px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest border transition-all ${
                    activeFilter === filter
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white border-muted hover:border-primary hover:text-primary'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>

            <section className="mb-12">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-serif font-bold">
                  {activeFilter || searchQuery ? 'Results' : 'Curated for You'}
                </h2>
                {places.length > 0 && (
                  <span className="text-on-surface/40 text-xs font-bold uppercase tracking-widest">
                    {places.length} found
                  </span>
                )}
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={24} className="text-primary animate-spin" />
                  <span className="ml-3 text-sm text-on-surface/50 font-medium">Finding restaurants...</span>
                </div>
              ) : places.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-on-surface/40 text-sm font-medium">No restaurants found</p>
                  <p className="text-on-surface/30 text-xs mt-1">Try a different search or filter</p>
                </div>
              ) : (() => {
                // 4 rows: 2 cols on mobile/sm, 4 on lg, 5 on 2xl
                const initialCount = phoneMode ? 8 : 8;
                const visiblePlaces = showAllResults ? places : places.slice(0, initialCount);
                const hasMore = places.length > initialCount;

                return (
                  <>
                    <div className={cn("grid gap-3 sm:gap-4", phoneMode ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5")}>
                      {visiblePlaces.map((place) => (
                        <RestaurantCard
                          key={place.id}
                          {...placeToCardProps(place)}
                        />
                      ))}
                    </div>
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
            </section>

            {/* Collections */}
            <section className="mb-12">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-serif font-bold">Collections</h2>
                <button className="text-primary text-xs font-bold uppercase tracking-widest flex items-center gap-1">
                  New Collection <ChevronRight size={14} />
                </button>
              </div>

              <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
                {COLLECTION_NAMES.map((list) => (
                  <motion.button
                    key={list}
                    whileHover={{ y: -5 }}
                    className="flex-shrink-0 w-40 h-48 rounded-3xl bg-secondary/10 p-6 flex flex-col justify-between group hover:bg-secondary hover:text-white transition-all duration-500"
                  >
                    <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center text-secondary shadow-sm group-hover:text-primary transition-colors">
                      <Bookmark size={20} />
                    </div>
                    <div>
                      <h4 className="font-serif font-bold text-lg mb-1">{list}</h4>
                      <p className="text-[10px] uppercase tracking-widest opacity-60">12 items</p>
                    </div>
                  </motion.button>
                ))}
              </div>
            </section>

            {/* Rated Spots */}
            <section className="mb-12">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-serif font-bold">Rated Spots</h2>
                <div className="flex items-center gap-4 text-on-surface/40">
                  <button className="p-2 hover:text-primary transition-colors">
                    <Grid size={18} />
                  </button>
                  <button className="p-2 hover:text-primary transition-colors">
                    <List size={18} />
                  </button>
                </div>
              </div>

              <div className="space-y-8">
                {RATED_SPOTS.map((item) => (
                  <div key={item.id} className="flex gap-6 group cursor-pointer">
                    <div className="w-32 h-32 rounded-3xl overflow-hidden flex-shrink-0 shadow-lg">
                      <img
                        src={item.image}
                        alt={item.name}
                        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="flex-1 py-2 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <h3 className="font-serif font-bold text-xl">{item.name}</h3>
                          <div className="flex items-center gap-1 text-primary">
                            <Star size={14} className="fill-primary" />
                            <span className="text-sm font-bold">{item.rating}</span>
                          </div>
                        </div>
                        <p className="text-xs text-on-surface/40 font-medium uppercase tracking-wider mb-2">{item.cuisine} · {item.price}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/10 text-secondary font-bold uppercase tracking-wider">Top Rated</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-on-surface/40">
                        <button className="text-[10px] font-bold uppercase tracking-widest hover:text-primary transition-colors">Edit Review</button>
                        <button className="text-[10px] font-bold uppercase tracking-widest hover:text-primary transition-colors">Share</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Social Feed */}
            <SocialFeed />
          </>
        ) : (
          <CircleActivity />
        )}
      </main>

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
              className="fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-[2rem] shadow-2xl max-h-[85vh] flex flex-col"
            >
              {/* Header */}
              <div className="flex-shrink-0 bg-surface z-10 px-6 pt-5 pb-4 border-b border-black/5">
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
              <div className="flex-shrink-0 bg-surface border-t border-black/5 px-6 py-4 flex gap-3">
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
  );
};
