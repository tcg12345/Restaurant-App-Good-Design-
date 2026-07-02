import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search as SearchIcon, Filter, X, ChevronDown, Loader2, Star, Users, Plus, Bookmark } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useLists } from '../contexts/ListsContext';
import {
  getAllFollowedRatings,
  getProfilesByIds,
  type CommunityRating,
  type UserProfile,
} from '../lib/supabase-community';
import { cn } from '../lib/utils';
import { ScoreBadge } from './RestaurantCard';
import { extractCityState } from '../lib/places';
import { useBottomSheet } from '../lib/useBottomSheet';
import { HoursFilterSection } from './filterPrimitives';
import { passesHoursFilter, isHoursFilterActive, emptyHoursFilter, type HoursFilter } from '../lib/hours';

const CHUNK_SIZE = 15;
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

// Deterministic per-user avatar tint — mirrors SocialFeed/FriendReviewDetail.
const AVATAR_PALETTE = [
  { bg: 'bg-rose-100', text: 'text-rose-700' },
  { bg: 'bg-amber-100', text: 'text-amber-700' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  { bg: 'bg-sky-100', text: 'text-sky-700' },
  { bg: 'bg-violet-100', text: 'text-violet-700' },
  { bg: 'bg-teal-100', text: 'text-teal-700' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700' },
];
const avatarColor = (uid: string) => {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
};
const initialOf = (name: string) => (name || 'U').trim().charAt(0).toUpperCase() || 'U';
const timeAgo = (date: string) => {
  if (!date) return '';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
};

// Module-level cache so re-entering the tab is instant
const feedCache: {
  userId: string | null;
  ratings: CommunityRating[];
  profiles: Record<string, UserProfile>;
  ts: number;
} = { userId: null, ratings: [], profiles: {}, ts: 0 };

// Delegate to the shared extractCityState helper from lib/places so every
// surface in the app (maps, search, detail) and this feed agree on how to
// turn a Google Places formatted address into a short city label. That
// helper handles US addresses, Italian / French / German / Japanese / UK /
// Australian / Canadian formats, trailing province codes, etc.
function extractCity(address: string): string {
  return extractCityState(address || '', address || '');
}

type SortOption = 'recent' | 'highest' | 'lowest';
type RoleFilter = 'all' | 'friends' | 'experts';

export const FollowingFeed: React.FC = () => {
  const { user } = useAuth();
  const { setHideBottomNav } = useSettings();
  const { openAddRestaurantModal, toggleWishlist, isWishlisted, restaurantMeta } = useLists();
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
  const [hoursFilter, setHoursFilter] = useState<HoursFilter>(emptyHoursFilter());
  // Role filter: all followed users / friends only / experts only
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  // Optional per-person picker (user_ids). Empty array = no per-person
  // narrowing applied.
  const [personFilter, setPersonFilter] = useState<string[]>([]);
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

  // Fetch ratings from every user the current user follows — both
  // friends and experts. Profile map includes is_expert so the feed
  // and filter UI can tell them apart.
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
        const followedRatings = await getAllFollowedRatings(user.id);
        const uniqueIds = Array.from(new Set(followedRatings.map((r) => r.user_id)));
        const profileMap = uniqueIds.length ? await getProfilesByIds(uniqueIds) : {};
        if (cancelled) return;
        feedCache.userId = user.id;
        feedCache.ratings = followedRatings;
        feedCache.profiles = profileMap;
        feedCache.ts = Date.now();
        setRatings(followedRatings);
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

  // Apply role + person filters first, then dedupe by restaurant_id
  // so the top-most surviving rating for each restaurant represents
  // the filtered-down feed (not a rating that got filtered out).
  const uniqueRestaurants = useMemo(() => {
    const personSet = new Set(personFilter);
    const seen = new Map<string, CommunityRating>();
    for (const r of ratings) {
      const prof = profiles[r.user_id];
      if (roleFilter === 'friends' && prof?.is_expert) continue;
      if (roleFilter === 'experts' && !prof?.is_expert) continue;
      if (personSet.size > 0 && !personSet.has(r.user_id)) continue;
      if (!seen.has(r.restaurant_id)) seen.set(r.restaurant_id, r);
    }
    return Array.from(seen.values());
  }, [ratings, profiles, roleFilter, personFilter]);

  // Universe of followed people, derived from who's actually in the
  // ratings list we loaded. Sorted alphabetically for the picker.
  const followedPeople = useMemo(() => {
    const ids = Array.from(new Set(ratings.map((r) => r.user_id)));
    return ids
      .map((id) => ({ id, profile: profiles[id] }))
      .filter((p) => !!p.profile)
      .sort((a, b) => {
        const an = (a.profile?.display_name || a.profile?.username || '').toLowerCase();
        const bn = (b.profile?.display_name || b.profile?.username || '').toLowerCase();
        return an.localeCompare(bn);
      });
  }, [ratings, profiles]);

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
    if (isHoursFilterActive(hoursFilter))
      result = result.filter((r) => passesHoursFilter(restaurantMeta[r.restaurant_id]?.hours, hoursFilter));

    if (sortBy === 'highest') {
      result = [...result].sort((a, b) => (b.score || 0) - (a.score || 0));
    } else if (sortBy === 'lowest') {
      result = [...result].sort((a, b) => (a.score || 0) - (b.score || 0));
    }
    // 'recent' uses the natural order (updated_at DESC)

    return result;
  }, [uniqueRestaurants, query, sortBy, scoreRange, priceFilter, cuisineFilter, cityFilter, hoursFilter, restaurantMeta]);

  // Reset infinite scroll window whenever the filtered list shape changes
  useEffect(() => {
    setVisibleCount(CHUNK_SIZE);
  }, [query, sortBy, scoreRange, priceFilter, cuisineFilter, cityFilter, roleFilter, personFilter, ratings.length]);

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
    sortBy !== 'recent' ||
    roleFilter !== 'all' ||
    personFilter.length > 0 ||
    isHoursFilterActive(hoursFilter);
  const activeFilterCount =
    (priceFilter ? 1 : 0) +
    (cuisineFilter.length > 0 ? 1 : 0) +
    (cityFilter.length > 0 ? 1 : 0) +
    (scoreRange[0] > 0 || scoreRange[1] < 10 ? 1 : 0) +
    (sortBy !== 'recent' ? 1 : 0) +
    (roleFilter !== 'all' ? 1 : 0) +
    (personFilter.length > 0 ? 1 : 0) +
    (isHoursFilterActive(hoursFilter) ? 1 : 0);

  const resetFilters = () => {
    setSortBy('recent');
    setScoreRange([0, 10]);
    setPriceFilter(null);
    setCuisineFilter([]);
    setCityFilter([]);
    setHoursFilter(emptyHoursFilter());
    setRoleFilter('all');
    setPersonFilter([]);
  };

  return (
    <div className="space-y-3 max-w-3xl mx-auto">
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
              const reviewer = profile?.display_name || profile?.username || '';
              const meta = {
                id: r.restaurant_id,
                name: r.restaurant_name || '',
                image: r.photo_url || '',
                cuisine: r.cuisine || '',
                price: r.price || '',
                address: r.address || '',
              };
              const metaLine = [r.cuisine, r.price, city].filter(Boolean).join(' · ');
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
                    className="flex items-start gap-4 py-5 sm:py-6 group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
                  >
                    {/* Text column — reviewer header, name, metadata eyebrow */}
                    <div className="flex-1 min-w-0">
                      {/* Reviewer header — avatar + name + rated/expert + time */}
                      {profile && (() => {
                        const color = avatarColor(r.user_id);
                        const initial = initialOf(reviewer);
                        return (
                          <div className="flex items-center gap-2 mb-2">
                            <div className={cn("w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0", color.bg)}>
                              <span className={cn("text-[11px] font-serif font-bold", color.text)}>{initial}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-bold leading-tight truncate">
                                {reviewer}
                              </p>
                              <p className="text-[10px] font-medium uppercase tracking-wider leading-tight mt-0.5 text-on-surface/40">
                                {profile.is_expert
                                  ? <span className="inline-flex items-center gap-0.5 text-amber-600 font-bold"><Star size={9} className="fill-amber-500 text-amber-500" />Expert · {timeAgo(r.created_at)}</span>
                                  : <>Rated · {timeAgo(r.created_at)}</>}
                              </p>
                            </div>
                          </div>
                        );
                      })()}
                      <h4 className="font-serif text-[19px] sm:text-xl font-bold text-on-surface leading-tight line-clamp-2 group-hover:text-primary transition-colors">
                        {r.restaurant_name}
                      </h4>
                      {metaLine && (
                        <p className="mt-1.5 text-[11px] text-on-surface/40 font-semibold uppercase tracking-[0.12em] truncate">
                          {metaLine}
                        </p>
                      )}
                    </div>

                    {/* Right rail — score pill + subtle action icons, aligned to the name */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <ScoreBadge rating={score} size="xs" />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openAddRestaurantModal(meta);
                        }}
                        className="w-8 h-8 flex items-center justify-center rounded-full text-on-surface/35 hover:text-primary hover:bg-on-surface/[0.04] transition-colors"
                        aria-label="Rate"
                      >
                        <Plus size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleWishlist(meta);
                        }}
                        className={cn(
                          'w-8 h-8 flex items-center justify-center rounded-full transition-colors',
                          wishlisted
                            ? 'text-secondary hover:bg-secondary/10'
                            : 'text-on-surface/35 hover:text-secondary hover:bg-on-surface/[0.04]',
                        )}
                        aria-label={wishlisted ? 'In wishlist' : 'Add to wishlist'}
                      >
                        <Bookmark size={16} className={wishlisted ? 'fill-secondary' : ''} />
                      </button>
                    </div>
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
        hoursFilter={hoursFilter}
        onHoursChange={setHoursFilter}
        allCuisines={allCuisines}
        allCities={allCities}
        roleFilter={roleFilter}
        onRoleFilter={setRoleFilter}
        personFilter={personFilter}
        onPersonFilter={setPersonFilter}
        followedPeople={followedPeople}
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
  hoursFilter: HoursFilter;
  onHoursChange: (f: HoursFilter) => void;
  allCuisines: string[];
  allCities: string[];
  roleFilter: RoleFilter;
  onRoleFilter: (v: RoleFilter) => void;
  personFilter: string[];
  onPersonFilter: (v: string[]) => void;
  followedPeople: { id: string; profile?: UserProfile }[];
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
  hoursFilter,
  onHoursChange,
  allCuisines,
  allCities,
  roleFilter,
  onRoleFilter,
  personFilter,
  onPersonFilter,
  followedPeople,
  onReset,
}) => {
  const { phoneMode } = useSettings();
  const [cuisineSearch, setCuisineSearch] = useState('');
  const [citySearch, setCitySearch] = useState('');
  const [personSearch, setPersonSearch] = useState('');
  const [cuisineOpen, setCuisineOpen] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const { dragProps } = useBottomSheet(open, onClose);

  const filteredCuisines = cuisineSearch.trim()
    ? allCuisines.filter((c) => c.toLowerCase().includes(cuisineSearch.toLowerCase()))
    : allCuisines;
  const filteredCities = citySearch.trim()
    ? allCities.filter((c) => c.toLowerCase().includes(citySearch.toLowerCase()))
    : allCities;
  // Role filter narrows the people picker so you can quickly jump
  // into \"experts only\" and only see the experts you follow.
  const visiblePeople = followedPeople
    .filter((p) => {
      if (roleFilter === 'friends' && p.profile?.is_expert) return false;
      if (roleFilter === 'experts' && !p.profile?.is_expert) return false;
      return true;
    })
    .filter((p) => {
      if (!personSearch.trim()) return true;
      const q = personSearch.toLowerCase();
      return (
        (p.profile?.display_name || '').toLowerCase().includes(q) ||
        (p.profile?.username || '').toLowerCase().includes(q)
      );
    });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: phoneMode ? 0.18 : 0.16 }}
          className={cn(
            'fixed inset-0 z-50',
            phoneMode ? 'bg-black/40 backdrop-blur-sm' : 'bg-black/50 backdrop-blur-md',
            !phoneMode && 'flex items-start justify-center pt-[10vh] px-4',
          )}
          onClick={onClose}
        >
          <motion.div
            {...(phoneMode
              ? {
                  initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' },
                  transition: { type: 'spring' as const, damping: 28, stiffness: 300 },
                  ...dragProps,
                }
              : {
                  initial: { opacity: 0, scale: 0.94, y: -12 },
                  animate: { opacity: 1, scale: 1, y: 0 },
                  exit: { opacity: 0, scale: 0.96, y: -8 },
                  transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const },
                })}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className={cn(
              'flex flex-col overflow-hidden bg-surface',
              phoneMode
                ? 'fixed bottom-0 left-0 right-0 rounded-t-3xl h-[85vh]'
                : 'w-full max-w-2xl rounded-[28px] max-h-[80vh] shadow-[0_30px_80px_-16px_rgba(0,0,0,0.42)] ring-1 ring-on-surface/[0.06]',
            )}
          >
            {phoneMode && (
              <div className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing flex-shrink-0">
                <div className="w-10 h-1 rounded-full bg-on-surface/15" />
              </div>
            )}

            <div className={cn(
              'flex items-center justify-between flex-shrink-0',
              phoneMode ? 'px-5 pt-3 pb-3 border-b border-on-surface/[0.06]' : 'px-6 pt-5 pb-4',
            )}>
              <h3 className={cn('font-serif font-bold', phoneMode ? 'text-lg' : 'text-[20px]')}>Filters</h3>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-on-surface/[0.05] flex items-center justify-center hover:bg-on-surface/[0.10] transition-colors"
              >
                <X size={16} className="text-on-surface/60" />
              </button>
            </div>
            {!phoneMode && <div className="border-t border-on-surface/[0.06]" />}

            <div className="flex-1 overflow-y-auto px-5 pt-4 pb-safe-4 space-y-5">
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

              {/* Role — friends / experts / all */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2.5">
                  Who
                </p>
                <div className="flex gap-2">
                  {(
                    [
                      ['all', 'Everyone'],
                      ['friends', 'Friends'],
                      ['experts', 'Experts'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => onRoleFilter(key)}
                      className={cn(
                        'flex-1 py-2 rounded-xl text-xs font-bold transition-all border-2',
                        roleFilter === key
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-on-surface/10 text-on-surface/50 hover:border-on-surface/20',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Specific people picker — expands to a multi-select list
                  narrowed by the role filter above. */}
              <div>
                <button
                  onClick={() => setPeopleOpen(!peopleOpen)}
                  className="flex items-center justify-between w-full mb-2"
                >
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40">
                      Specific people
                    </p>
                    {personFilter.length > 0 && (
                      <span className="text-[10px] font-semibold text-primary">
                        {personFilter.length} selected
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {personFilter.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onPersonFilter([]);
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
                        peopleOpen && 'rotate-180',
                      )}
                    />
                  </div>
                </button>
                <AnimatePresence>
                  {peopleOpen && (
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
                          value={personSearch}
                          onChange={(e) => setPersonSearch(e.target.value)}
                          placeholder="Search people..."
                          className="w-full bg-on-surface/5 rounded-lg py-2 pl-8 pr-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      </div>
                      <div className="max-h-44 overflow-y-auto pb-1 space-y-1">
                        {visiblePeople.map((p) => {
                          const name = p.profile?.display_name || p.profile?.username || 'User';
                          const initial = name.charAt(0).toUpperCase();
                          const selected = personFilter.includes(p.id);
                          const isExpert = !!p.profile?.is_expert;
                          return (
                            <button
                              key={p.id}
                              onClick={() =>
                                onPersonFilter(
                                  selected
                                    ? personFilter.filter((x) => x !== p.id)
                                    : [...personFilter, p.id],
                                )
                              }
                              className={cn(
                                'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors text-left',
                                selected ? 'bg-primary/5' : 'hover:bg-on-surface/[0.03]',
                              )}
                            >
                              <div className="w-7 h-7 rounded-full bg-on-surface/[0.06] flex items-center justify-center flex-shrink-0">
                                <span className="text-[11px] font-serif font-bold text-on-surface/55">{initial}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={cn(
                                  'text-[13px] font-semibold truncate',
                                  selected ? 'text-primary' : 'text-on-surface/80',
                                )}>
                                  {name}
                                </p>
                                <p className="text-[10px] font-medium uppercase tracking-wider text-on-surface/40 truncate">
                                  {isExpert
                                    ? <span className="inline-flex items-center gap-0.5 text-amber-600 font-bold"><Star size={9} className="fill-amber-500 text-amber-500" />Expert</span>
                                    : 'Friend'}
                                </p>
                              </div>
                              {selected && <span className="text-[11px] font-bold text-primary">✓</span>}
                            </button>
                          );
                        })}
                        {visiblePeople.length === 0 && (
                          <p className="text-[11px] text-on-surface/30 py-2 px-2">
                            {followedPeople.length === 0
                              ? "You're not following anyone with ratings yet"
                              : 'No one matches'}
                          </p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
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

              {/* Hours */}
              <HoursFilterSection value={hoursFilter} onChange={onHoursChange} />

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
                className="flex-[2] py-3 rounded-2xl bg-primary text-white text-sm font-semibold shadow-sm hover:bg-primary/90 active:scale-[0.99] transition-all"
              >
                Apply
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
