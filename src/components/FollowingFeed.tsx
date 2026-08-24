import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search as SearchIcon, X, ChevronDown, Loader2, Users, UserPlus, SlidersHorizontal, ArrowUpDown, Bookmark } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useLists } from '../contexts/ListsContext';
import {
  getAllFollowedRatings,
  getProfilesByIds,
  activityTimestamp,
  isEditedActivity,
  type CommunityRating,
  type UserProfile,
} from '../lib/supabase-community';
import { cn, safeImage } from '../lib/utils';
import { displayCuisine } from '../lib/cuisine';
import { scoreTintStyle } from '../lib/score';
import { GlassChipRow } from '../lib/glass-buttons';
import { CardShell, CardMedia, MetaRow, SaveButton, AddButton, ScoreBadge } from './cards';
import { VerifiedBadge } from './VerifiedBadge';
import { LoadingSkeletonList } from './LoadingSkeleton';
import { extractCityState } from '../lib/places';
import { FilterSheet } from './FilterSheet';
import { FilterSection, PillRow, Pill, Segment, SegmentItem, RangeSlider, FilterDrillSection, HoursFilterSection } from './filterPrimitives';
import { passesHoursFilter, isHoursFilterActive, emptyHoursFilter, type HoursFilter, restaurantLocalNow } from '../lib/hours';
import { useWarmHoursForFilter } from '../lib/useWarmHours';

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
  // days 360-364: months hits 12 but floor(days/365) is still 0
  const years = Math.max(1, Math.floor(days / 365));
  return `${years} year${years === 1 ? '' : 's'} ago`;
};

// Community rating rows sometimes carry junk in `cuisine` — a Places type
// string ("Restaurant", "Food") or a copy of the city/address — which made
// the old meta line read like "New York, NY · $$$$ · New York". Drop those
// so the meta line stays clean; legit cuisines never start with the city.
function cleanCuisine(cuisine: string | undefined | null, city: string): string {
  // The Places-type junk is lib/cuisine's list now, so every surface drops
  // the same strings. The city check stays here — it is this feed's own
  // problem, not a property of the cuisine.
  const c = displayCuisine(cuisine);
  if (!c) return '';
  if (city && c.toLowerCase().startsWith(city.toLowerCase())) return '';
  return c;
}

const SORT_LABELS: Record<SortOption, string> = {
  recent: 'Recent',
  highest: 'Highest Score',
  lowest: 'Lowest Score',
};

/* ── Filter pill — mirrors the Pantry / All Recipes chrome so every list
      surface shares the same "Filters / facet / Sort" pill row. Each pill
      opens the unified filter sheet; active pills tint primary and expose
      an inline ✕ to clear just that facet. ── */
const FilterPill: React.FC<{
  onClick: () => void;
  label: string;
  active?: boolean;
  icon?: React.ReactNode;
  badge?: number;
  onClear?: () => void;
}> = ({ onClick, label, active = false, icon, badge, onClear }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'hit-44-y inline-flex items-center gap-1.5 h-8 px-3 rounded-full transition-colors text-[12px] font-semibold flex-shrink-0',
      active
        ? 'bg-primary/[0.10] text-primary hover:bg-primary/[0.14]'
        : 'bg-on-surface/[0.05] text-on-surface/65 hover:bg-on-surface/[0.08] hover:text-on-surface',
    )}
  >
    {icon}
    <span className="max-w-[130px] truncate">{label}</span>
    {badge !== undefined && (
      <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-primary text-white text-[9px] font-bold">
        {badge}
      </span>
    )}
    {onClear ? (
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); onClear(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onClear(); } }}
        aria-label="Clear"
        className="ml-0.5 text-current/70 hover:text-current"
      >
        <X size={10} />
      </span>
    ) : (
      <ChevronDown size={10} className="opacity-60" />
    )}
  </button>
);

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

export const FollowingFeed: React.FC<{
  /** Hosted inside the phone search page: the page owns the search field
   *  (its text arrives via `query`) and this component renders its filter
   *  row as floating glass in the page's chrome position. Standalone
   *  (desktop) keeps its own field and web pills. */
  variant?: 'searchTab';
  query?: string;
  onClearQuery?: () => void;
}> = ({ variant, query: externalQuery, onClearQuery }) => {
  const searchTab = variant === 'searchTab';
  const { user } = useAuth();
  const { phoneMode, setHideBottomNav } = useSettings();
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

  // Search + filters. Hosted in the search tab the query comes from the
  // page's shared glass field; standalone it's this component's own input.
  const [internalQuery, setInternalQuery] = useState('');
  const query = searchTab ? (externalQuery ?? '') : internalQuery;
  const clearQuery = () => { setInternalQuery(''); onClearQuery?.(); };
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 10]);
  const [priceFilter, setPriceFilter] = useState<string | null>(null);
  const [cuisineFilter, setCuisineFilter] = useState<string[]>([]);
  const [cityFilter, setCityFilter] = useState<string[]>([]);
  const [hoursFilter, setHoursFilter] = useState<HoursFilter>(emptyHoursFilter());
  // Role filter: all followed users / friends only / verified only
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
      if (roleFilter === 'friends' && prof?.is_verified) continue;
      if (roleFilter === 'experts' && !prof?.is_verified) continue;
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
      // Evaluate "open now" at the restaurant's approximate local time,
      // not the device clock — remote-city hours were off by the tz delta.
      result = result.filter((r) => passesHoursFilter(restaurantMeta[r.restaurant_id]?.hours, hoursFilter, restaurantLocalNow(restaurantMeta[r.restaurant_id]?.lng)));

    if (sortBy === 'highest') {
      result = [...result].sort((a, b) => (b.score || 0) - (a.score || 0));
    } else if (sortBy === 'lowest') {
      result = [...result].sort((a, b) => (a.score || 0) - (b.score || 0));
    }
    // 'recent' uses the natural order (updated_at DESC)

    return result;
  }, [uniqueRestaurants, query, sortBy, scoreRange, priceFilter, cuisineFilter, cityFilter, hoursFilter, restaurantMeta]);

  // Backfill hours for the feed's restaurants while the hours filter is
  // active — the filter reads cached meta, which is empty for places the
  // viewer never opened, and unknown hours are never hidden.
  const hoursWarmIds = useMemo(
    () => (isHoursFilterActive(hoursFilter) ? uniqueRestaurants.map((r) => r.restaurant_id) : []),
    [hoursFilter, uniqueRestaurants],
  );
  useWarmHoursForFilter(hoursWarmIds, isHoursFilterActive(hoursFilter));

  // Reset infinite scroll window whenever the filtered list shape changes
  useEffect(() => {
    setVisibleCount(CHUNK_SIZE);
  }, [query, sortBy, scoreRange, priceFilter, cuisineFilter, cityFilter, roleFilter, personFilter, ratings.length]);

  // Chunked infinite scroll via IntersectionObserver. Keyed on visibleCount
  // too: after a full load the sentinel unmounts, and a filter change that
  // keeps filtered.length identical resets visibleCount and REMOUNTS a new
  // sentinel node — without the dep the old observer still watches the
  // detached node and the list stalls at the first chunk.
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
  }, [filtered.length, visibleCount]);

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

  // "Who" pill — reflects the person picker first, then the role toggle.
  const whoActive = personFilter.length > 0 || roleFilter !== 'all';
  const whoLabel =
    personFilter.length === 1
      ? (profiles[personFilter[0]]?.display_name || profiles[personFilter[0]]?.username || '1 person')
      : personFilter.length > 1 ? `People (${personFilter.length})`
      : roleFilter === 'friends' ? 'Friends'
      : roleFilter === 'experts' ? 'Verified'
      : 'Who';
  // Distinct reviewers behind the current result set — feeds the count line
  // so the page says whose picks it's showing.
  const reviewerCount = useMemo(
    () => new Set(filtered.map((r) => r.user_id)).size,
    [filtered],
  );

  return (
    <div className="space-y-3 max-w-3xl mx-auto">
      {/* Search — standalone only; hosted in the search tab the page's
          shared glass field IS the search bar. */}
      {!searchTab && (
        <div className="w-full relative">
          <SearchIcon
            size={18}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/40 pointer-events-none"
          />
          <input
            type="text"
            value={internalQuery}
            onChange={(e) => setInternalQuery(e.target.value)}
            placeholder="Search followed restaurants..."
            className="w-full bg-on-surface/[0.04] hover:bg-on-surface/[0.07] border border-on-surface/[0.06] rounded-full py-3 pl-11 pr-10 text-base font-medium text-on-surface placeholder:text-on-surface/40 focus:outline-none focus:bg-on-surface/[0.06] transition-colors"
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Search followed restaurants"
          />
          {internalQuery && (
            <button
              type="button"
              onClick={() => setInternalQuery('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface/30 hover:text-on-surface/60"
              aria-label="Clear"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {searchTab ? (
        /* Glass chips in the page's chrome position — the same geometry as
           the Discover tab's row, so flipping the pill swaps the chips'
           contents without moving them. Fixed: the page chrome floats; the
           list scrolls beneath it. */
        <div className="fixed inset-x-0 z-30 px-3.5" style={{ top: 'calc(env(safe-area-inset-top) + 130px)' }}>
          <GlassChipRow
            id="follow-chips"
            className="flex gap-2.5 overflow-x-auto scrollbar-hide -mx-3.5 px-3.5 pb-1"
            items={[
              {
                id: 'filters',
                symbol: 'line.3.horizontal.decrease',
                title: '',
                prominent: activeFilterCount > 0,
                label: activeFilterCount > 0 ? `Filters (${activeFilterCount} active)` : 'Filters',
                icon: <SlidersHorizontal size={14} strokeWidth={2.2} />,
                onClick: () => setFiltersOpen(true),
              },
              {
                id: 'who',
                symbol: 'person.2',
                title: whoLabel,
                prominent: whoActive,
                icon: <Users size={13} strokeWidth={2.2} />,
                onClick: () => setFiltersOpen(true),
              },
              {
                id: 'cuisine',
                title: cuisineFilter.length > 0 ? `Cuisine (${cuisineFilter.length})` : 'Cuisine',
                prominent: cuisineFilter.length > 0,
                onClick: () => setFiltersOpen(true),
              },
              {
                id: 'price',
                title: priceFilter ?? 'Price',
                prominent: !!priceFilter,
                onClick: () => setFiltersOpen(true),
              },
              {
                id: 'sort',
                symbol: 'arrow.up.arrow.down',
                title: sortBy !== 'recent' ? SORT_LABELS[sortBy] : 'Sort',
                prominent: sortBy !== 'recent',
                icon: <ArrowUpDown size={13} strokeWidth={2.2} />,
                onClick: () => setFiltersOpen(true),
              },
              ...(hasActiveFilters ? [{
                id: 'clear',
                symbol: 'xmark',
                title: 'Clear',
                label: 'Clear all filters',
                icon: <X size={13} strokeWidth={2.2} />,
                onClick: resetFilters,
              }] : []),
            ]}
          />
        </div>
      ) : (
        /* Filter pill row — mirrors the Pantry / All Recipes chrome so every
           filterable list shares the same affordance. Each pill opens the
           unified filter sheet; active pills show their value + inline clear.
           Geometry matters here: the pills' 44px hit overlays overflow their
           32px boxes, and an overflow-x-auto row computes overflow-y to auto
           — without the explicit h-11 + overflow-y-hidden the whole row could
           be dragged vertically by a few pixels. City lives in the sheet
           only; five pills keep the row scannable. */
        <div
          className={cn('flex items-center gap-2 h-11 overflow-x-auto overflow-y-hidden scrollbar-hide overscroll-x-contain', phoneMode && '-mx-4 px-4')}
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <FilterPill onClick={() => setFiltersOpen(true)}
            icon={<SlidersHorizontal size={12} />} label="Filters"
            active={activeFilterCount > 0}
            badge={activeFilterCount > 0 ? activeFilterCount : undefined} />
          <FilterPill onClick={() => setFiltersOpen(true)}
            icon={<Users size={11} />}
            label={whoLabel}
            active={whoActive}
            onClear={whoActive ? () => { setRoleFilter('all'); setPersonFilter([]); } : undefined} />
          <FilterPill onClick={() => setFiltersOpen(true)}
            label={cuisineFilter.length > 0 ? `Cuisine (${cuisineFilter.length})` : 'Cuisine'}
            active={cuisineFilter.length > 0}
            onClear={cuisineFilter.length > 0 ? () => setCuisineFilter([]) : undefined} />
          <FilterPill onClick={() => setFiltersOpen(true)}
            label={priceFilter ?? 'Price'}
            active={!!priceFilter}
            onClear={priceFilter ? () => setPriceFilter(null) : undefined} />
          <FilterPill onClick={() => setFiltersOpen(true)}
            icon={<ArrowUpDown size={11} />}
            label={sortBy !== 'recent' ? SORT_LABELS[sortBy] : 'Sort'}
            active={sortBy !== 'recent'}
            onClear={sortBy !== 'recent' ? () => setSortBy('recent') : undefined} />
          {hasActiveFilters && (
            <button onClick={resetFilters}
              className="hit-44-y flex items-center gap-1 px-3 h-8 rounded-full text-xs font-semibold text-red-400 hover:text-red-500 transition-all flex-shrink-0">
              <X size={10} /><span>Clear</span>
            </button>
          )}
        </div>
      )}

      {/* Body */}
      {loading && ratings.length === 0 ? (
        <LoadingSkeletonList count={6} variant="list-item" />
      ) : fetched && ratings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/[0.08] grid place-items-center mb-4">
            <Users size={26} className="text-primary/70" />
          </div>
          <p className="font-serif text-lg font-bold text-on-surface">See where friends eat</p>
          <p className="mt-1.5 max-w-[280px] text-[13px] leading-relaxed text-on-surface/50">
            Restaurants rated by the friends and experts you follow show up here, ready to save or try.
          </p>
          <button
            type="button"
            onClick={() => navigate('/search/main')}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-xs font-semibold rounded-xl hover:bg-primary/90 transition-colors"
          >
            <UserPlus size={14} />Find people to follow
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <SearchIcon size={28} className="text-on-surface/15 mb-3" />
          <p className="text-sm font-medium text-on-surface/50">No matches</p>
          <p className="text-xs text-on-surface/30 mt-1">Try a different search or clear your filters</p>
          {(hasActiveFilters || !!query) && (
            <button
              type="button"
              onClick={() => { clearQuery(); resetFilters(); }}
              className="mt-4 px-4 py-2 rounded-full bg-on-surface/[0.05] text-xs font-semibold text-on-surface/70 hover:bg-on-surface/[0.09] transition-colors"
            >
              Clear search & filters
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Count line — doubles as the page's purpose statement. */}
          <p className="pt-1 text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface/40">
            {filtered.length} {filtered.length === 1 ? 'restaurant' : 'restaurants'}
            <span className="mx-1.5 text-on-surface/20">·</span>
            from {reviewerCount} {reviewerCount === 1 ? 'person' : 'people'} you follow
          </p>
          {/* Rows — built from the unified card kit (thumbnail / name / meta /
              score + save + add), hairline-divided on phone, boxed on desktop,
              with a compact "who rated it" attribution line. */}
          <ul className={phoneMode ? 'divide-y divide-on-surface/[0.06]' : 'space-y-2.5'}>
            {visible.map((r) => {
              const profile = profiles[r.user_id];
              const city = extractCity(r.address);
              const cuisine = cleanCuisine(r.cuisine, city);
              const score = Number(r.score) || 0;
              const wishlisted = isWishlisted(r.restaurant_id);
              const reviewer = profile?.display_name || profile?.username || '';
              const color = avatarColor(r.user_id);
              const meta = {
                id: r.restaurant_id,
                name: r.restaurant_name || '',
                image: r.photo_url || '',
                cuisine: r.cuisine || '',
                price: r.price || '',
                address: r.address || '',
              };
              if (phoneMode) {
                /* Phone: the map sheet's row anatomy — score disc leading,
                   name over one facts line, thumb trailing — with the
                   attribution line this feed exists for underneath. */
                const tint = score > 0 ? scoreTintStyle(score) : null;
                const safe = safeImage(r.photo_url);
                const facts = [cuisine, r.price, city].filter(Boolean).join('  ·  ');
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
                      aria-label={`View ${r.restaurant_name}`}
                      className="flex items-center gap-3.5 py-[14px] cursor-pointer outline-none transition-colors active:bg-on-surface/[0.03] focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      {tint ? (
                        <span
                          className="grid place-items-center rounded-full font-serif font-bold tabular-nums flex-shrink-0"
                          style={{
                            width: 40, height: 40, fontSize: 14, letterSpacing: '-0.02em',
                            color: tint.color, background: tint.background, border: `1.5px solid ${tint.ring}`,
                          }}
                          aria-label={`Score ${score.toFixed(1)}`}
                        >
                          {score.toFixed(1)}
                        </span>
                      ) : (
                        <span className="grid place-items-center rounded-full border-[1.5px] border-on-surface/[0.12] text-on-surface/25 flex-shrink-0" style={{ width: 40, height: 40 }} aria-hidden>
                          <Bookmark size={15} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="font-serif text-[16px] font-bold leading-[1.22] tracking-[-0.012em] text-on-surface truncate">{r.restaurant_name}</h3>
                        {facts && (
                          <p className="mt-[4px] truncate text-[12.5px] font-medium text-on-surface/55">{facts}</p>
                        )}
                        {/* Attribution — the point of this feed: who rated it, when. */}
                        {profile && (
                          <div className="mt-[5px] flex min-w-0 items-center gap-1.5">
                            <span className={cn('grid h-[15px] w-[15px] flex-shrink-0 place-items-center rounded-full', color.bg)}>
                              <span className={cn('text-[8px] font-serif font-bold leading-none', color.text)}>{initialOf(reviewer)}</span>
                            </span>
                            <p className="truncate text-[11.5px] font-medium text-on-surface/40">
                              <span className="font-semibold text-on-surface/60">{reviewer}</span>
                              {profile.is_verified && (
                                <VerifiedBadge size={12} inline className="ml-1" />
                              )}
                              <span className="mx-1 text-on-surface/25">·</span>
                              {timeAgo(activityTimestamp(r))}{isEditedActivity(r) ? ' · edited' : ''}
                              {r.rating_method === 'slider' ? ' · self-scored' : ''}
                            </p>
                          </div>
                        )}
                      </div>
                      {safe && (
                        <div className="h-[52px] w-[52px] flex-shrink-0 overflow-hidden rounded-[12px] bg-on-surface/[0.05]">
                          <img src={safe} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleWishlist(meta); }}
                        aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
                        className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-on-surface/45 transition-colors active:bg-on-surface/[0.06] active:scale-95"
                      >
                        <Bookmark size={16} className={cn(wishlisted && 'fill-primary text-primary')} />
                      </button>
                    </div>
                  </li>
                );
              }
              return (
                <li key={r.id}>
                  <CardShell
                    as="div"
                    surface="boxed"
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/restaurant/${r.restaurant_id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/restaurant/${r.restaurant_id}`);
                      }
                    }}
                    aria-label={`View ${r.restaurant_name}`}
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <div className="flex items-center gap-4 px-4 py-3.5">
                      <CardMedia
                        src={r.photo_url}
                        alt={r.restaurant_name || ''}
                        aspect="thumb"
                        rounded="xl"
                        className="h-16 w-16 flex-shrink-0"
                        imgClassName="group-hover:scale-[1.04]"
                        zoomOnHover
                        placeholderSize="sm"
                      />
                      <div className="flex min-w-0 flex-1 flex-col justify-center">
                        <h3 className="truncate font-serif font-bold leading-tight group-hover:text-primary transition-colors text-[16px]">
                          {r.restaurant_name}
                        </h3>
                        <MetaRow items={[cuisine, r.price, city]} className="mt-1" />
                        {/* Attribution — the point of this feed: who rated it, when. */}
                        {profile && (
                          <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
                            <span className={cn('grid h-[16px] w-[16px] flex-shrink-0 place-items-center rounded-full', color.bg)}>
                              <span className={cn('text-[8.5px] font-serif font-bold leading-none', color.text)}>{initialOf(reviewer)}</span>
                            </span>
                            <p className="truncate text-[11.5px] font-medium text-on-surface/40">
                              <span className="font-semibold text-on-surface/60">{reviewer}</span>
                              {profile.is_verified && (
                                <VerifiedBadge size={12} inline className="ml-1" />
                              )}
                              <span className="mx-1 text-on-surface/25">·</span>
                              {timeAgo(activityTimestamp(r))}{isEditedActivity(r) ? ' · edited' : ''}
                              {r.rating_method === 'slider' ? ' · self-scored' : ''}
                            </p>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <ScoreBadge rating={score} size="md" />
                        <SaveButton filled={wishlisted} onClick={() => toggleWishlist(meta)} />
                        <AddButton onClick={() => openAddRestaurantModal(meta)} />
                      </div>
                    </div>
                  </CardShell>
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
  // The shared FilterSheet shell — the same chrome as the Discover tab's
  // filter popup (glass ✕ left, glass "Clear all" right, full-width
  // Apply). The shell portals itself to body, clear of this component's
  // low-z page layer.
  return (
    <FilterSheet
      open={open}
      onClose={onClose}
      onReset={onReset}
      title="Filters"
      glassChrome
      zIndex={70}
    >
      {/* The same primitives the Discover sheet is built from — the
          shell's unlayered button reset strips raw utility styling, and
          matching the map tab's sheet is the point anyway. */}
      <FilterSection label="Sort by">
        <PillRow>
          {([['recent', 'Recent'], ['highest', 'Highest Score'], ['lowest', 'Lowest Score']] as const).map(([key, label]) => (
            <Pill key={key} active={sortBy === key} onClick={() => onSortBy(key)}>{label}</Pill>
          ))}
        </PillRow>
      </FilterSection>
      <FilterSection label="Who">
        <Segment>
          {([['all', 'Everyone'], ['friends', 'Friends'], ['experts', 'Verified']] as const).map(([key, label]) => (
            <SegmentItem key={key} active={roleFilter === key} onClick={() => onRoleFilter(key)}>{label}</SegmentItem>
          ))}
        </Segment>
      </FilterSection>
      <FilterDrillSection
        id="people"
        label="People"
        options={followedPeople.map((p) => ({
          value: p.id,
          label: p.profile?.display_name || p.profile?.username || 'Unknown',
        }))}
        selected={personFilter}
        onToggle={(v) => onPersonFilter(
          personFilter.includes(v) ? personFilter.filter((x) => x !== v) : [...personFilter, v],
        )}
        emptyLabel="Everyone you follow"
        searchPlaceholder="Search people"
      />
      <FilterSection label="Score" value={`${scoreRange[0]} – ${scoreRange[1]}`} isSet={scoreRange[0] > 0 || scoreRange[1] < 10}>
        <RangeSlider min={0} max={10} step={0.5} value={scoreRange} onChange={onScoreRange} ariaLabelMin="Minimum score" ariaLabelMax="Maximum score" />
        <div className="fs-slider-range"><span>0</span><span>10</span></div>
      </FilterSection>
      <FilterSection label="Price">
        <Segment>
          <SegmentItem active={priceFilter === null} onClick={() => onPriceFilter(null)}>Any</SegmentItem>
          {['$', '$$', '$$$', '$$$$'].map((p) => (
            <SegmentItem key={p} active={priceFilter === p} onClick={() => onPriceFilter(priceFilter === p ? null : p)}>{p}</SegmentItem>
          ))}
        </Segment>
      </FilterSection>
      <HoursFilterSection value={hoursFilter} onChange={onHoursChange} />
      <FilterDrillSection
        id="cuisine"
        label="Cuisine"
        options={allCuisines.map((c) => ({ value: c, label: c }))}
        selected={cuisineFilter}
        onToggle={(v) => onCuisineFilter(
          cuisineFilter.includes(v) ? cuisineFilter.filter((x) => x !== v) : [...cuisineFilter, v],
        )}
        emptyLabel="Any"
        searchPlaceholder="Search cuisines"
      />
      {allCities.length > 0 && (
        <FilterDrillSection
          id="city"
          label="City / Location"
          options={allCities.map((c) => ({ value: c, label: c }))}
          selected={cityFilter}
          onToggle={(v) => onCityFilter(
            cityFilter.includes(v) ? cityFilter.filter((x) => x !== v) : [...cityFilter, v],
          )}
          emptyLabel="Any"
          searchPlaceholder="Search locations"
        />
      )}
    </FilterSheet>
  );
};
