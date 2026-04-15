import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search as SearchIcon, Filter, X, ChevronDown, Loader2, Star, Users, Plus, Heart } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useLists } from '../contexts/ListsContext';
import {
  getAllFriendRatings,
  getProfilesByIds,
  type CommunityRating,
  type UserProfile,
} from '../lib/supabase-community';
import { cn } from '../lib/utils';

const CHUNK_SIZE = 15;
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

// Module-level cache so re-entering the tab is instant
const feedCache: {
  userId: string | null;
  ratings: CommunityRating[];
  profiles: Record<string, UserProfile>;
  ts: number;
} = { userId: null, ratings: [], profiles: {}, ts: 0 };

function extractCity(address: string): string {
  const parts = (address || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const city = parts[parts.length - 3];
    const stateZip = parts[parts.length - 2];
    const state = stateZip?.replace(/\d+/g, '').trim();
    if (city && state && state.length <= 3) return `${city}, ${state}`;
    if (city) return city;
  }
  if (parts.length >= 2) return parts.slice(-2).join(', ');
  return parts[0] || '';
}

type SortOption = 'recent' | 'highest' | 'lowest';

export const FollowingFeed: React.FC = () => {
  const { user } = useAuth();
  const { setHideBottomNav } = useSettings();
  const { openAddRestaurantModal, openWishlistModal, isWishlisted } = useLists();
  const navigate = useNavigate();

  const [ratings, setRatings] = useState<CommunityRating[]>(() =>
    feedCache.userId && feedCache.userId === user?.id ? feedCache.ratings : [],
  );
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>(() =>
    feedCache.userId && feedCache.userId === user?.id ? feedCache.profiles : {},
  );
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(
    !!(feedCache.userId && feedCache.userId === user?.id && feedCache.ratings.length > 0),
  );

  // Search + filters
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 10]);
  const [priceFilter, setPriceFilter] = useState<string | null>(null);
  const [cuisineFilter, setCuisineFilter] = useState<string[]>([]);
  const [cityFilter, setCityFilter] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Infinite scroll chunk pointer
  const [visibleCount, setVisibleCount] = useState(CHUNK_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Hide the bottom nav while the filter sheet is open so the Apply/Reset
  // footer isn't overlapped by the floating nav pill.
  useEffect(() => {
    setHideBottomNav(filtersOpen);
    return () => setHideBottomNav(false);
  }, [filtersOpen, setHideBottomNav]);

  // Fetch friend ratings (no Google API — all data comes from community_ratings rows)
  useEffect(() => {
    if (!user?.id) return;

    const now = Date.now();
    if (
      feedCache.userId === user.id &&
      now - feedCache.ts < CACHE_TTL &&
      feedCache.ratings.length > 0
    ) {
      setRatings(feedCache.ratings);
      setProfiles(feedCache.profiles);
      setFetched(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const friendRatings = await getAllFriendRatings(user.id);
        const uniqueIds = Array.from(new Set(friendRatings.map((r) => r.user_id)));
        const profileMap = uniqueIds.length ? await getProfilesByIds(uniqueIds) : {};
        if (cancelled) return;
        feedCache.userId = user.id;
        feedCache.ratings = friendRatings;
        feedCache.profiles = profileMap;
        feedCache.ts = Date.now();
        setRatings(friendRatings);
        setProfiles(profileMap);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setFetched(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Dedupe by restaurant_id — friend ratings are already sorted by updated_at DESC,
  // so the first occurrence is the most recent rating for each restaurant.
  const uniqueRestaurants = useMemo(() => {
    const seen = new Map<string, CommunityRating>();
    for (const r of ratings) {
      if (!seen.has(r.restaurant_id)) seen.set(r.restaurant_id, r);
    }
    return Array.from(seen.values());
  }, [ratings]);

  // Collect filter option universes
  const { allCuisines, allCities } = useMemo(() => {
    const cs = new Set<string>();
    const ci = new Set<string>();
    for (const r of uniqueRestaurants) {
      if (r.cuisine) cs.add(r.cuisine);
      const c = extractCity(r.address);
      if (c) ci.add(c);
    }
    return {
      allCuisines: Array.from(cs).sort(),
      allCities: Array.from(ci).sort(),
    };
  }, [uniqueRestaurants]);

  // Apply search + filters + sort (entirely client-side, no network calls)
  const filtered = useMemo(() => {
    let result = uniqueRestaurants;

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      result = result.filter(
        (r) =>
          r.restaurant_name?.toLowerCase().includes(q) ||
          r.cuisine?.toLowerCase().includes(q) ||
          r.address?.toLowerCase().includes(q),
      );
    }

    if (scoreRange[0] > 0 || scoreRange[1] < 10) {
      result = result.filter(
        (r) => (r.score || 0) >= scoreRange[0] && (r.score || 0) <= scoreRange[1],
      );
    }
    if (priceFilter) result = result.filter((r) => r.price === priceFilter);
    if (cuisineFilter.length > 0)
      result = result.filter((r) => cuisineFilter.includes(r.cuisine));
    if (cityFilter.length > 0)
      result = result.filter((r) => cityFilter.includes(extractCity(r.address)));

    if (sortBy === 'highest') {
      result = [...result].sort((a, b) => (b.score || 0) - (a.score || 0));
    } else if (sortBy === 'lowest') {
      result = [...result].sort((a, b) => (a.score || 0) - (b.score || 0));
    }
    // 'recent' uses the natural order (updated_at DESC)

    return result;
  }, [uniqueRestaurants, query, sortBy, scoreRange, priceFilter, cuisineFilter, cityFilter]);

  // Reset infinite scroll window whenever the filtered list shape changes
  useEffect(() => {
    setVisibleCount(CHUNK_SIZE);
  }, [query, sortBy, scoreRange, priceFilter, cuisineFilter, cityFilter, ratings.length]);

  // Chunked infinite scroll via IntersectionObserver
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((c) => {
            if (c >= filtered.length) return c;
            return Math.min(c + CHUNK_SIZE, filtered.length);
          });
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [filtered.length]);

  const visible = filtered.slice(0, visibleCount);
  const hasActiveFilters =
    !!priceFilter ||
    cuisineFilter.length > 0 ||
    cityFilter.length > 0 ||
    scoreRange[0] > 0 ||
    scoreRange[1] < 10 ||
    sortBy !== 'recent';
  const activeFilterCount =
    (priceFilter ? 1 : 0) +
    (cuisineFilter.length > 0 ? 1 : 0) +
    (cityFilter.length > 0 ? 1 : 0) +
    (scoreRange[0] > 0 || scoreRange[1] < 10 ? 1 : 0) +
    (sortBy !== 'recent' ? 1 : 0);

  const resetFilters = () => {
    setSortBy('recent');
    setScoreRange([0, 10]);
    setPriceFilter(null);
    setCuisineFilter([]);
    setCityFilter([]);
  };

  return (
    <div className="space-y-3">
      {/* Search + filter row */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <SearchIcon
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface/40"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search followed restaurants..."
            className="w-full bg-on-surface/[0.04] rounded-full py-2.5 pl-10 pr-9 text-sm font-medium focus:outline-none focus:bg-on-surface/[0.06]"
            autoCapitalize="off"
            autoCorrect="off"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/30 hover:text-on-surface/60"
              aria-label="Clear"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          className={cn(
            'relative w-10 h-10 rounded-full flex items-center justify-center transition-colors flex-shrink-0',
            hasActiveFilters
              ? 'bg-primary text-white'
              : 'bg-on-surface/[0.04] text-on-surface/60 hover:bg-on-surface/[0.08]',
          )}
          aria-label="Filters"
        >
          <Filter size={16} />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center border-2 border-surface">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Body */}
      {loading && ratings.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={22} className="text-on-surface/30 animate-spin" />
        </div>
      ) : fetched && ratings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Users size={32} className="text-on-surface/15 mb-3" />
          <p className="text-sm font-medium text-on-surface/50">No picks from people you follow yet</p>
          <p className="text-xs text-on-surface/30 mt-1">
            Follow friends to see the restaurants they love here
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <SearchIcon size={28} className="text-on-surface/15 mb-3" />
          <p className="text-sm font-medium text-on-surface/50">No matches</p>
          <p className="text-xs text-on-surface/30 mt-1">Try clearing search or filters</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between pt-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface/40">
              {filtered.length} {filtered.length === 1 ? 'restaurant' : 'restaurants'}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="text-[10px] font-bold text-primary uppercase tracking-wider"
              >
                Reset
              </button>
            )}
          </div>
          <ul className="divide-y divide-on-surface/[0.06]">
            {visible.map((r) => {
              const profile = profiles[r.user_id];
              const city = extractCity(r.address);
              const score = Number(r.score) || 0;
              const wishlisted = isWishlisted(r.restaurant_id);
              const meta = {
                id: r.restaurant_id,
                name: r.restaurant_name || '',
                image: r.photo_url || '',
                cuisine: r.cuisine || '',
                price: r.price || '',
                address: r.address || '',
              };
              return (
                <li key={r.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/restaurant/${r.restaurant_id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/restaurant/${r.restaurant_id}`);
                      }
                    }}
                    className="block w-full py-5 text-left group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-lg"
                  >
                    {/* Cover image (capped on desktop) */}
                    <div className="w-full max-w-md aspect-[16/10] rounded-lg overflow-hidden bg-on-surface/[0.05] mb-3 relative flex items-center justify-center">
                      <SearchIcon size={32} className="text-on-surface/20" />
                      {r.photo_url && (
                        <img
                          src={r.photo_url}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                          loading="lazy"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      )}
                      {/* Overlaid rate + wishlist actions */}
                      <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 z-10">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openWishlistModal(meta);
                          }}
                          className={cn(
                            'w-9 h-9 rounded-full flex items-center justify-center bg-white/90 backdrop-blur-sm shadow-sm transition-transform duration-150 hover:scale-105 active:scale-95',
                            wishlisted ? 'text-primary' : 'text-on-surface/70 hover:text-primary',
                          )}
                          aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
                        >
                          <Heart size={16} className={cn(wishlisted && 'fill-primary')} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openAddRestaurantModal(meta);
                          }}
                          className="w-9 h-9 rounded-full flex items-center justify-center bg-white/90 backdrop-blur-sm shadow-sm text-primary transition-transform duration-150 hover:scale-105 active:scale-95"
                          aria-label="Add to list"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    </div>
                    {/* Details below image */}
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="font-serif text-[17px] font-bold text-on-surface leading-snug line-clamp-2 flex-1 min-w-0">
                        {r.restaurant_name}
                      </h4>
                      <span className="flex items-center gap-0.5 text-sm font-bold text-primary flex-shrink-0 pt-0.5">
                        <Star size={14} className="fill-primary" />
                        {score.toFixed(1)}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-on-surface/50 font-medium uppercase tracking-wider truncate">
                      {[r.cuisine, r.price, city].filter(Boolean).join(' · ')}
                    </p>
                    {profile && (
                      <p className="text-sm text-on-surface/50 mt-1.5 truncate">
                        via <span className="font-semibold text-on-surface/75">{profile.display_name || profile.username}</span>
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {/* Sentinel for infinite scroll — triggers the next chunk */}
          {visibleCount < filtered.length && (
            <div ref={sentinelRef} className="py-4 flex items-center justify-center">
              <Loader2 size={16} className="text-on-surface/30 animate-spin" />
            </div>
          )}
        </>
      )}

      <FollowingFilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        sortBy={sortBy}
        onSortBy={setSortBy}
        scoreRange={scoreRange}
        onScoreRange={setScoreRange}
        priceFilter={priceFilter}
        onPriceFilter={setPriceFilter}
        cuisineFilter={cuisineFilter}
        onCuisineFilter={setCuisineFilter}
        cityFilter={cityFilter}
        onCityFilter={setCityFilter}
        allCuisines={allCuisines}
        allCities={allCities}
        onReset={resetFilters}
      />
    </div>
  );
};

/* ── Filter sheet ── */
const FollowingFilterSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  sortBy: SortOption;
  onSortBy: (v: SortOption) => void;
  scoreRange: [number, number];
  onScoreRange: (r: [number, number]) => void;
  priceFilter: string | null;
  onPriceFilter: (v: string | null) => void;
  cuisineFilter: string[];
  onCuisineFilter: (v: string[]) => void;
  cityFilter: string[];
  onCityFilter: (v: string[]) => void;
  allCuisines: string[];
  allCities: string[];
  onReset: () => void;
}> = ({
  open,
  onClose,
  sortBy,
  onSortBy,
  scoreRange,
  onScoreRange,
  priceFilter,
  onPriceFilter,
  cuisineFilter,
  onCuisineFilter,
  cityFilter,
  onCityFilter,
  allCuisines,
  allCities,
  onReset,
}) => {
  const { phoneMode } = useSettings();
  const [cuisineSearch, setCuisineSearch] = useState('');
  const [citySearch, setCitySearch] = useState('');
  const [cuisineOpen, setCuisineOpen] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);

  const filteredCuisines = cuisineSearch.trim()
    ? allCuisines.filter((c) => c.toLowerCase().includes(cuisineSearch.toLowerCase()))
    : allCuisines;
  const filteredCities = citySearch.trim()
    ? allCities.filter((c) => c.toLowerCase().includes(citySearch.toLowerCase()))
    : allCities;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            drag={phoneMode ? 'y' : false}
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_: any, info: any) => {
              if (info.offset.y > 80 || info.velocity.y > 300) onClose();
            }}
            className={cn(
              'fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-3xl flex flex-col overflow-hidden',
              phoneMode ? 'h-[85vh]' : 'max-h-[75vh]',
            )}
          >
            {phoneMode && (
              <div className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing flex-shrink-0">
                <div className="w-10 h-1 rounded-full bg-on-surface/15" />
              </div>
            )}

            <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
              <h3 className="font-serif font-bold text-lg">Filters</h3>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center hover:bg-on-surface/10 transition-colors"
              >
                <X size={16} className="text-on-surface/60" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Sort */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2.5">
                  Sort by
                </p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ['recent', 'Recent'],
                      ['highest', 'Highest Score'],
                      ['lowest', 'Lowest Score'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => onSortBy(key)}
                      className={cn(
                        'px-3.5 py-2 rounded-full text-xs font-semibold transition-all',
                        sortBy === key
                          ? 'bg-primary text-white'
                          : 'bg-on-surface/5 text-on-surface/50 hover:bg-on-surface/10',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Score range */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2.5">
                  Score: {scoreRange[0]} – {scoreRange[1]}
                </p>
                <div className="relative h-6 flex items-center">
                  <div className="absolute inset-x-0 h-1 bg-on-surface/10 rounded-full" />
                  <div
                    className="absolute h-1 bg-primary rounded-full"
                    style={{
                      left: `${scoreRange[0] * 10}%`,
                      right: `${100 - scoreRange[1] * 10}%`,
                    }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={1}
                    value={scoreRange[0]}
                    onChange={(e) =>
                      onScoreRange([Math.min(+e.target.value, scoreRange[1]), scoreRange[1]])
                    }
                    className="absolute inset-x-0 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer"
                  />
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={1}
                    value={scoreRange[1]}
                    onChange={(e) =>
                      onScoreRange([scoreRange[0], Math.max(+e.target.value, scoreRange[0])])
                    }
                    className="absolute inset-x-0 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer"
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-on-surface/30">0</span>
                  <span className="text-[10px] text-on-surface/30">10</span>
                </div>
              </div>

              {/* Price */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2.5">
                  Price
                </p>
                <div className="flex gap-2">
                  {['$', '$$', '$$$', '$$$$'].map((p) => (
                    <button
                      key={p}
                      onClick={() => onPriceFilter(priceFilter === p ? null : p)}
                      className={cn(
                        'flex-1 py-2 rounded-xl text-xs font-bold transition-all border-2',
                        priceFilter === p
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-on-surface/10 text-on-surface/50 hover:border-on-surface/20',
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cuisine */}
              <div>
                <button
                  onClick={() => setCuisineOpen(!cuisineOpen)}
                  className="flex items-center justify-between w-full mb-2"
                >
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40">
                      Cuisine
                    </p>
                    {cuisineFilter.length > 0 && (
                      <span className="text-[10px] font-semibold text-primary">
                        {cuisineFilter.join(', ')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {cuisineFilter.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onCuisineFilter([]);
                        }}
                        className="text-[10px] text-primary font-semibold"
                      >
                        Clear
                      </button>
                    )}
                    <ChevronDown
                      size={14}
                      className={cn(
                        'text-on-surface/30 transition-transform',
                        cuisineOpen && 'rotate-180',
                      )}
                    />
                  </div>
                </button>
                <AnimatePresence>
                  {cuisineOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="relative mb-2">
                        <SearchIcon
                          size={13}
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface/30"
                        />
                        <input
                          type="text"
                          value={cuisineSearch}
                          onChange={(e) => setCuisineSearch(e.target.value)}
                          placeholder="Search cuisines..."
                          className="w-full bg-on-surface/5 rounded-lg py-2 pl-8 pr-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pb-1">
                        {filteredCuisines.map((c) => (
                          <button
                            key={c}
                            onClick={() =>
                              onCuisineFilter(
                                cuisineFilter.includes(c)
                                  ? cuisineFilter.filter((x) => x !== c)
                                  : [...cuisineFilter, c],
                              )
                            }
                            className={cn(
                              'px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border',
                              cuisineFilter.includes(c)
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-on-surface/10 text-on-surface/50 hover:border-on-surface/20',
                            )}
                          >
                            {c}
                          </button>
                        ))}
                        {filteredCuisines.length === 0 && (
                          <p className="text-[11px] text-on-surface/30 py-1">No cuisines match</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* City */}
              <div>
                <button
                  onClick={() => setCityOpen(!cityOpen)}
                  className="flex items-center justify-between w-full mb-2"
                >
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40">
                      City / Location
                    </p>
                    {cityFilter.length > 0 && (
                      <span className="text-[10px] font-semibold text-primary">
                        {cityFilter.join(', ')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {cityFilter.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onCityFilter([]);
                        }}
                        className="text-[10px] text-primary font-semibold"
                      >
                        Clear
                      </button>
                    )}
                    <ChevronDown
                      size={14}
                      className={cn(
                        'text-on-surface/30 transition-transform',
                        cityOpen && 'rotate-180',
                      )}
                    />
                  </div>
                </button>
                <AnimatePresence>
                  {cityOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="relative mb-2">
                        <SearchIcon
                          size={13}
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface/30"
                        />
                        <input
                          type="text"
                          value={citySearch}
                          onChange={(e) => setCitySearch(e.target.value)}
                          placeholder="Search locations..."
                          className="w-full bg-on-surface/5 rounded-lg py-2 pl-8 pr-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pb-1">
                        {filteredCities.map((c) => (
                          <button
                            key={c}
                            onClick={() =>
                              onCityFilter(
                                cityFilter.includes(c)
                                  ? cityFilter.filter((x) => x !== c)
                                  : [...cityFilter, c],
                              )
                            }
                            className={cn(
                              'px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border',
                              cityFilter.includes(c)
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-on-surface/10 text-on-surface/50 hover:border-on-surface/20',
                            )}
                          >
                            {c}
                          </button>
                        ))}
                        {filteredCities.length === 0 && (
                          <p className="text-[11px] text-on-surface/30 py-1">No locations match</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="flex-shrink-0 border-t border-on-surface/6 px-5 py-4 flex gap-3">
              <button
                onClick={onReset}
                className="flex-1 py-3 rounded-2xl border-2 border-on-surface/10 text-sm font-semibold text-on-surface/60 hover:bg-muted transition-colors"
              >
                Reset
              </button>
              <button
                onClick={onClose}
                className="flex-[2] py-3 rounded-2xl bg-primary text-white text-sm font-semibold shadow-lg shadow-primary/25"
              >
                Apply
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
