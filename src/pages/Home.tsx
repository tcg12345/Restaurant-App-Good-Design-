import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TopBar } from '../components/TopBar';
import { RestaurantCard } from '../components/RestaurantCard';
import { RadarChart } from '../components/RadarChart';
import { Search, Filter, ChevronRight, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { searchNearbyRestaurants, searchPlacesByText, priceLevelToString, type PlaceResult } from '../lib/places';

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

function placeToCardProps(place: PlaceResult) {
  return {
    id: place.id,
    name: place.name,
    image: place.photoUrl || 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&q=80&w=800',
    rating: place.rating,
    price: priceLevelToString(place.priceLevel),
    cuisine: place.address.split(',')[0],
    distance: '',
    isMichelin: place.rating >= 4.7 && place.userRatingCount > 500,
  };
}

export const Home: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'general' | 'circle'>('general');
  const [places, setPlaces] = useState<PlaceResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [userLat, setUserLat] = useState(DEFAULT_LAT);
  const [userLng, setUserLng] = useState(DEFAULT_LNG);

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
    searchNearbyRestaurants(userLat, userLng)
      .then(setPlaces)
      .catch((err) => console.error('Initial search failed:', err))
      .finally(() => setIsLoading(false));
  }, [userLat, userLng]);

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setIsLoading(true);
    setActiveFilter(null);
    try {
      const results = await searchPlacesByText(query, userLat, userLng);
      setPlaces(results);
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
        const results = await searchNearbyRestaurants(userLat, userLng);
        setPlaces(results);
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
        results = await searchNearbyRestaurants(userLat, userLng, 1000);
      } else {
        results = await searchPlacesByText(filter, userLat, userLng);
      }
      setPlaces(results);
    } catch (err) {
      console.error('Filter search failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeFilter, userLat, userLng]);

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
          className="relative mb-8"
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
          <button type="submit" className="absolute inset-y-0 right-4 flex items-center text-primary">
            <Filter size={20} />
          </button>
        </form>

        <div className="flex gap-3 overflow-x-auto pb-4 no-scrollbar mb-8">
          {QUICK_FILTERS.map((filter) => (
            <button
              key={filter}
              onClick={() => handleFilterClick(filter)}
              className={`whitespace-nowrap px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest border transition-all ${
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
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

    </div>
  );
};
