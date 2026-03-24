import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TopBar } from '../components/TopBar';
import { RestaurantCard } from '../components/RestaurantCard';
import { RadarChart } from '../components/RadarChart';
import { Search, Filter, Loader2, X, ArrowUpDown, DollarSign, UtensilsCrossed, Check, SlidersHorizontal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { searchNearbyRestaurants, searchPlacesByText, priceLevelToString, CUISINE_TYPES, type PlaceResult } from '../lib/places';

const TASTE_DATA = [
  { subject: 'Umami', value: 120, fullMark: 150 },
  { subject: 'Sweet', value: 98, fullMark: 150 },
  { subject: 'Sour', value: 86, fullMark: 150 },
  { subject: 'Bitter', value: 99, fullMark: 150 },
  { subject: 'Salty', value: 85, fullMark: 150 },
  { subject: 'Spicy', value: 65, fullMark: 150 },
];

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
  const [activeTab, setActiveTab] = useState<'general' | 'circle'>('general');
  const [rawPlaces, setRawPlaces] = useState<PlaceResult[]>([]);
  const [places, setPlaces] = useState<PlaceResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [userLat, setUserLat] = useState(DEFAULT_LAT);
  const [userLng, setUserLng] = useState(DEFAULT_LNG);

  // Filter panel state
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('popularity');
  const [selectedPrice, setSelectedPrice] = useState(0);
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>([]);

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

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setIsLoading(true);
    setActiveFilter(null);
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

        <form
          className="relative mb-4"
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
            placeholder="Search for a flavor, mood, or spot..."
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
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4">
              {places.map((place) => (
                <RestaurantCard
                  key={place.id}
                  {...placeToCardProps(place)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="bg-secondary/10 rounded-[2rem] p-8 mb-12 overflow-hidden relative">
          <div className="relative z-10">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-secondary mb-2">Your Circle's Palate</p>
            <h2 className="text-2xl font-serif font-bold mb-6">The Collective Taste</h2>
            <RadarChart data={TASTE_DATA} color="#5c6144" />
            <p className="text-xs text-on-surface/60 mt-6 leading-relaxed">
              Your circle is currently leaning towards <span className="text-secondary font-bold italic">Umami</span> and <span className="text-secondary font-bold italic">Bitter</span> profiles. Explore spots that match this trend.
            </p>
          </div>
          <div className="absolute top-0 right-0 w-32 h-32 bg-secondary/20 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
        </section>
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
