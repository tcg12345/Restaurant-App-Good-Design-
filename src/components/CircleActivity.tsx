import React, { useState, useMemo } from 'react';
import { Search, Star, Bookmark, Users, UserCircle, MapPin, SlidersHorizontal, X, Check, ArrowUpDown, Heart } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { Link } from 'react-router-dom';

/* ── Types ── */

type SourceType = 'friend' | 'expert';
type ListType = 'rated' | 'wishlist';

interface CircleRestaurant {
  id: string;
  name: string;
  image: string;
  cuisine: string;
  price: string;
  address: string;
  rating: number | null;
  listType: ListType;
  source: SourceType;
  sourceName: string;
  sourceImage: string;
  addedAt: string;
}

/* ── Mock Data ── */

const MOCK_CIRCLE_RESTAURANTS: CircleRestaurant[] = [
  { id: 'circle-1', name: "L'Artusi", image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&q=80&w=600', cuisine: 'Italian', price: '$$$', address: '228 W 10th St, New York', rating: 4.8, listType: 'rated', source: 'friend', sourceName: 'Sarah Chen', sourceImage: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200', addedAt: '2 hours ago' },
  { id: 'circle-2', name: 'Sushi Nakazawa', image: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&q=80&w=600', cuisine: 'Japanese', price: '$$$$', address: '23 Commerce St, New York', rating: null, listType: 'wishlist', source: 'friend', sourceName: 'Marcus Rivera', sourceImage: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200', addedAt: '5 hours ago' },
  { id: 'circle-3', name: 'Gramercy Tavern', image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=600', cuisine: 'American', price: '$$$$', address: '42 E 20th St, New York', rating: 4.6, listType: 'rated', source: 'expert', sourceName: 'Chef Antoine', sourceImage: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=200', addedAt: '1 day ago' },
  { id: 'circle-4', name: 'Via Carota', image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&q=80&w=600', cuisine: 'Italian', price: '$$$', address: '51 Grove St, New York', rating: 4.9, listType: 'rated', source: 'friend', sourceName: 'Emily Zhang', sourceImage: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=200', addedAt: '1 day ago' },
  { id: 'circle-5', name: 'Tatiana by Kwame', image: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&q=80&w=600', cuisine: 'Caribbean', price: '$$$', address: 'Lincoln Center, New York', rating: null, listType: 'wishlist', source: 'expert', sourceName: 'Maya Williams', sourceImage: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=200', addedAt: '2 days ago' },
  { id: 'circle-6', name: "Joe's Pizza", image: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&q=80&w=600', cuisine: 'Pizza', price: '$', address: '7 Carmine St, New York', rating: 4.5, listType: 'rated', source: 'friend', sourceName: 'Alex Thompson', sourceImage: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200', addedAt: '2 days ago' },
  { id: 'circle-7', name: 'Le Bernardin', image: 'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&q=80&w=600', cuisine: 'French', price: '$$$$', address: '155 W 51st St, New York', rating: 4.9, listType: 'rated', source: 'expert', sourceName: 'Chef Antoine', sourceImage: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=200', addedAt: '3 days ago' },
  { id: 'circle-8', name: 'Dhamaka', image: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&q=80&w=600', cuisine: 'Indian', price: '$$', address: '119 Delancey St, New York', rating: null, listType: 'wishlist', source: 'friend', sourceName: 'Sarah Chen', sourceImage: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200', addedAt: '3 days ago' },
  { id: 'circle-9', name: 'Atomix', image: 'https://images.unsplash.com/photo-1550966871-3ed3cdb51f3a?auto=format&fit=crop&q=80&w=600', cuisine: 'Korean', price: '$$$$', address: '104 E 30th St, New York', rating: 5.0, listType: 'rated', source: 'expert', sourceName: 'Maya Williams', sourceImage: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=200', addedAt: '4 days ago' },
  { id: 'circle-10', name: 'Los Tacos No. 1', image: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?auto=format&fit=crop&q=80&w=600', cuisine: 'Mexican', price: '$', address: '75 9th Ave, New York', rating: 4.3, listType: 'rated', source: 'friend', sourceName: 'Marcus Rivera', sourceImage: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200', addedAt: '5 days ago' },
  { id: 'circle-11', name: 'Eleven Madison Park', image: 'https://images.unsplash.com/photo-1550966871-3ed3cdb51f3a?auto=format&fit=crop&q=80&w=600', cuisine: 'American', price: '$$$$', address: '11 Madison Ave, New York', rating: null, listType: 'wishlist', source: 'expert', sourceName: 'Chef Antoine', sourceImage: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=200', addedAt: '1 week ago' },
  { id: 'circle-12', name: 'Thai Diner', image: 'https://images.unsplash.com/photo-1562565652-a0d8f0c59eb4?auto=format&fit=crop&q=80&w=600', cuisine: 'Thai', price: '$$', address: '186 Mott St, New York', rating: 4.4, listType: 'rated', source: 'friend', sourceName: 'Emily Zhang', sourceImage: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=200', addedAt: '1 week ago' },
];

/* ── Component ── */

export const CircleActivity: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | SourceType>('all');
  const [listFilter, setListFilter] = useState<'all' | ListType>('all');
  const [cuisineFilter, setCuisineFilter] = useState<string | null>(null);
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'recent' | 'rating' | 'name'>('recent');
  const [showFilters, setShowFilters] = useState(false);
  const [cuisineSearch, setCuisineSearch] = useState('');
  const [citySearch, setCitySearch] = useState('');

  // Extract unique cuisines and cities from data
  const allCuisines = useMemo(() => {
    const set = new Set(MOCK_CIRCLE_RESTAURANTS.map((r) => r.cuisine));
    return Array.from(set).sort();
  }, []);

  const allCities = useMemo(() => {
    const set = new Set<string>();
    MOCK_CIRCLE_RESTAURANTS.forEach((r) => {
      const parts = r.address.split(',').map((s) => s.trim());
      if (parts.length >= 2) set.add(parts[parts.length - 1]);
    });
    return Array.from(set).sort();
  }, []);

  const filteredCuisines = useMemo(() => {
    if (!cuisineSearch.trim()) return allCuisines;
    const q = cuisineSearch.toLowerCase();
    return allCuisines.filter((c) => c.toLowerCase().includes(q));
  }, [allCuisines, cuisineSearch]);

  const filteredCities = useMemo(() => {
    if (!citySearch.trim()) return allCities;
    const q = citySearch.toLowerCase();
    return allCities.filter((c) => c.toLowerCase().includes(q));
  }, [allCities, citySearch]);

  const activeFilterCount = (sourceFilter !== 'all' ? 1 : 0) + (listFilter !== 'all' ? 1 : 0) + (cuisineFilter ? 1 : 0) + (cityFilter ? 1 : 0) + (sortBy !== 'recent' ? 1 : 0);

  const filtered = useMemo(() => {
    let items = MOCK_CIRCLE_RESTAURANTS;
    if (sourceFilter !== 'all') items = items.filter((r) => r.source === sourceFilter);
    if (listFilter !== 'all') items = items.filter((r) => r.listType === listFilter);
    if (cuisineFilter) items = items.filter((r) => r.cuisine === cuisineFilter);
    if (cityFilter) items = items.filter((r) => r.address.includes(cityFilter));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        r.cuisine.toLowerCase().includes(q) ||
        r.sourceName.toLowerCase().includes(q) ||
        r.address.toLowerCase().includes(q)
      );
    }
    const sorted = [...items];
    switch (sortBy) {
      case 'rating': sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)); break;
      case 'name': sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
      default: break;
    }
    return sorted;
  }, [searchQuery, sourceFilter, listFilter, cuisineFilter, cityFilter, sortBy]);

  const handleReset = () => {
    setSourceFilter('all');
    setListFilter('all');
    setCuisineFilter(null);
    setCityFilter(null);
    setSortBy('recent');
    setCuisineSearch('');
    setCitySearch('');
  };

  return (
    <div>
      {/* Search + Filters row */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-3.5 flex items-center text-on-surface/40">
            <Search size={16} />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search restaurants, friends..."
            className="w-full bg-white rounded-xl py-2.5 pl-10 pr-4 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all border border-on-surface/8"
          />
        </div>
        <button
          onClick={() => setShowFilters(true)}
          className={cn(
            "flex items-center gap-1.5 px-3.5 rounded-xl border shadow-sm transition-all flex-shrink-0",
            activeFilterCount > 0
              ? "bg-primary/10 border-primary/20 text-primary"
              : "bg-white border-on-surface/8 text-on-surface/50 hover:border-on-surface/20"
          )}
        >
          <SlidersHorizontal size={15} />
          {activeFilterCount > 0 && (
            <span className="w-4.5 h-4.5 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Active filter chips */}
      {activeFilterCount > 0 && (
        <div className="flex gap-1.5 mb-3 flex-wrap">
          {sourceFilter !== 'all' && (
            <button onClick={() => setSourceFilter('all')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
              {sourceFilter === 'friend' ? 'Friends' : 'Experts'}
              <X size={11} />
            </button>
          )}
          {listFilter !== 'all' && (
            <button onClick={() => setListFilter('all')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
              {listFilter === 'rated' ? 'Rated' : 'Wishlisted'}
              <X size={11} />
            </button>
          )}
          {cuisineFilter && (
            <button onClick={() => setCuisineFilter(null)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
              {cuisineFilter}
              <X size={11} />
            </button>
          )}
          {cityFilter && (
            <button onClick={() => setCityFilter(null)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
              {cityFilter}
              <X size={11} />
            </button>
          )}
          {sortBy !== 'recent' && (
            <button onClick={() => setSortBy('recent')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
              {sortBy === 'rating' ? 'By Rating' : 'A-Z'}
              <X size={11} />
            </button>
          )}
        </div>
      )}

      {/* Result count */}
      <p className="text-on-surface/35 text-[10px] font-bold uppercase tracking-widest mb-3">
        {filtered.length} restaurant{filtered.length !== 1 ? 's' : ''}
      </p>

      {/* Restaurant list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-on-surface/40 text-sm font-medium">No restaurants match your filters</p>
          <p className="text-on-surface/30 text-xs mt-1">Try adjusting your search or filters</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((restaurant) => (
            <Link key={restaurant.id} to={`/restaurant/${restaurant.id}`} className="block">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl border border-on-surface/8 shadow-sm overflow-hidden flex active:scale-[0.98] transition-transform"
              >
                <div className="w-24 sm:w-28 flex-shrink-0">
                  <img src={restaurant.image} alt={restaurant.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </div>
                <div className="flex-1 p-3 sm:p-4 min-w-0 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-serif font-bold text-sm leading-tight line-clamp-1">{restaurant.name}</h3>
                      {restaurant.rating !== null ? (
                        <div className="flex items-center gap-0.5 text-primary flex-shrink-0">
                          <Star size={11} className="fill-primary" />
                          <span className="text-xs font-bold">{restaurant.rating}</span>
                        </div>
                      ) : (
                        <Heart size={13} className="text-red-400 flex-shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-on-surface/40 font-medium uppercase tracking-wider">
                      <span>{restaurant.cuisine}</span>
                      <span>·</span>
                      <span>{restaurant.price}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2 pt-2 border-t border-on-surface/5">
                    <img src={restaurant.sourceImage} alt={restaurant.sourceName}
                      className="w-4.5 h-4.5 rounded-full object-cover" referrerPolicy="no-referrer" />
                    <span className="text-[10px] text-on-surface/40 truncate">
                      <span className="font-semibold text-on-surface/60">{restaurant.sourceName}</span>
                      {' · '}{restaurant.addedAt}
                    </span>
                  </div>
                </div>
              </motion.div>
            </Link>
          ))}
        </div>
      )}

      {/* ── Filter Panel ── */}
      <AnimatePresence>
        {showFilters && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 z-50"
              onClick={() => setShowFilters(false)}
            />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_e, info) => {
                if (info.offset.y > 100 || info.velocity.y > 300) setShowFilters(false);
              }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-3xl shadow-2xl max-h-[75vh] flex flex-col overflow-hidden"
            >
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0 cursor-grab active:cursor-grabbing">
                <div className="w-10 h-1 rounded-full bg-on-surface/15" />
              </div>

              <div className="flex-shrink-0 px-5 pt-2 pb-3 border-b border-on-surface/6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-serif font-bold">Filters</h2>
                  <button onClick={() => setShowFilters(false)}
                    className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center hover:bg-on-surface/10 transition-colors">
                    <X size={16} className="text-on-surface/60" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                {/* Source */}
                <div>
                  <div className="flex items-center gap-2 mb-2.5">
                    <Users size={14} className="text-primary" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface/60">Source</h3>
                  </div>
                  <div className="flex gap-2">
                    {([
                      { value: 'all', label: 'Everyone' },
                      { value: 'friend', label: 'Friends', icon: Users },
                      { value: 'expert', label: 'Experts', icon: UserCircle },
                    ] as const).map((f) => (
                      <button key={f.value} onClick={() => setSourceFilter(f.value as any)}
                        className={cn("flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 text-xs font-bold transition-all",
                          sourceFilter === f.value
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-on-surface/10 text-on-surface/50 hover:border-on-surface/20"
                        )}>
                        {sourceFilter === f.value && <Check size={12} />}
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Type */}
                <div>
                  <div className="flex items-center gap-2 mb-2.5">
                    <Star size={14} className="text-primary" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface/60">Type</h3>
                  </div>
                  <div className="flex gap-2">
                    {([
                      { value: 'all', label: 'All' },
                      { value: 'rated', label: 'Rated' },
                      { value: 'wishlist', label: 'Wishlisted' },
                    ] as const).map((f) => (
                      <button key={f.value} onClick={() => setListFilter(f.value as any)}
                        className={cn("flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 text-xs font-bold transition-all",
                          listFilter === f.value
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-on-surface/10 text-on-surface/50 hover:border-on-surface/20"
                        )}>
                        {listFilter === f.value && <Check size={12} />}
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cuisine */}
                <div>
                  <div className="flex items-center gap-2 mb-2.5">
                    <Star size={14} className="text-primary" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface/60">Cuisine</h3>
                    {cuisineFilter && (
                      <button onClick={() => setCuisineFilter(null)} className="ml-auto text-[10px] text-primary font-semibold">Clear</button>
                    )}
                  </div>
                  <div className="relative mb-2">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                    <input
                      type="text"
                      value={cuisineSearch}
                      onChange={(e) => setCuisineSearch(e.target.value)}
                      placeholder="Search cuisines..."
                      className="w-full bg-on-surface/5 rounded-lg py-2 pl-8 pr-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                    {filteredCuisines.map((cuisine) => (
                      <button key={cuisine} onClick={() => setCuisineFilter(cuisineFilter === cuisine ? null : cuisine)}
                        className={cn("px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border",
                          cuisineFilter === cuisine
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-on-surface/10 text-on-surface/50 hover:border-on-surface/20"
                        )}>
                        {cuisine}
                      </button>
                    ))}
                    {filteredCuisines.length === 0 && (
                      <p className="text-[11px] text-on-surface/30 py-1">No cuisines match</p>
                    )}
                  </div>
                </div>

                {/* City / Location */}
                <div>
                  <div className="flex items-center gap-2 mb-2.5">
                    <MapPin size={14} className="text-primary" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface/60">Location</h3>
                    {cityFilter && (
                      <button onClick={() => setCityFilter(null)} className="ml-auto text-[10px] text-primary font-semibold">Clear</button>
                    )}
                  </div>
                  <div className="relative mb-2">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                    <input
                      type="text"
                      value={citySearch}
                      onChange={(e) => setCitySearch(e.target.value)}
                      placeholder="Search locations..."
                      className="w-full bg-on-surface/5 rounded-lg py-2 pl-8 pr-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                    {filteredCities.map((city) => (
                      <button key={city} onClick={() => setCityFilter(cityFilter === city ? null : city)}
                        className={cn("px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border",
                          cityFilter === city
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-on-surface/10 text-on-surface/50 hover:border-on-surface/20"
                        )}>
                        {city}
                      </button>
                    ))}
                    {filteredCities.length === 0 && (
                      <p className="text-[11px] text-on-surface/30 py-1">No locations match</p>
                    )}
                  </div>
                </div>

                {/* Sort */}
                <div>
                  <div className="flex items-center gap-2 mb-2.5">
                    <ArrowUpDown size={14} className="text-primary" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface/60">Sort By</h3>
                  </div>
                  <div className="flex gap-2">
                    {([
                      { value: 'recent', label: 'Recent' },
                      { value: 'rating', label: 'Highest Rated' },
                      { value: 'name', label: 'A–Z' },
                    ] as const).map((s) => (
                      <button key={s.value} onClick={() => setSortBy(s.value)}
                        className={cn("flex-1 py-2.5 rounded-xl border-2 text-xs font-bold transition-all text-center",
                          sortBy === s.value
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-on-surface/10 text-on-surface/50 hover:border-on-surface/20"
                        )}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex-shrink-0 border-t border-on-surface/6 px-5 py-4 flex gap-3">
                <button onClick={handleReset}
                  className="flex-1 py-3 rounded-2xl border-2 border-on-surface/10 text-sm font-semibold text-on-surface/60 hover:bg-muted transition-colors">
                  Reset
                </button>
                <button onClick={() => setShowFilters(false)}
                  className="flex-[2] py-3 rounded-2xl bg-primary text-white text-sm font-semibold shadow-lg shadow-primary/25">
                  Apply
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
