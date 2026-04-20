import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Car,
  Check,
  Footprints,
  Loader2,
  Map as MapIcon,
  MapPin,
  Search,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import {
  searchPlacesByTextPaged,
  priceLevelToString,
  CUISINE_TYPES,
  type PlaceResult,
} from '../lib/places';
import {
  buildTasteProfile,
  haversineKm,
  scoreCandidates,
  type CandidateSignals,
  type ScoredPlace,
} from '../lib/recommendations';
import {
  getAllFriendRatings,
  getExpertProfiles,
  getExpertRatings,
  getFollowedExpertIds,
  getRatingsByUserIds,
  type CommunityRating,
} from '../lib/supabase-community';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { haversineDistanceMi, formatDistance } from '../lib/distance';
import { formatTravelTime, useTravelTimes } from '../lib/directions';
import {
  HomeLocationBar,
  isExactAddress,
  loadLastSelectedLocation,
  reverseGeocode,
  type HomeLocation,
} from '../components/HomeLocationBar';

/* ── Placeholder guides (non-functional) ─────────────────────────────────────
   Same visual language as the Home page's horizontal guide scroller. Content
   is static until the guide feature is wired up for real.
   ──────────────────────────────────────────────────────────────────────── */
type Guide = {
  id: string;
  title: string;
  author: string;
  image: string;
  count: number;
};

const PLACEHOLDER_GUIDES: Guide[] = [
  {
    id: 'g-local-pasta',
    title: 'A Pasta Crawl Through the City',
    author: 'Jamie Lin',
    image: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&q=80&w=800',
    count: 9,
  },
  {
    id: 'g-local-date-night',
    title: 'Where the Locals Take a Date',
    author: 'Camille Durand',
    image: 'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&q=80&w=800',
    count: 12,
  },
  {
    id: 'g-local-hidden-gems',
    title: 'Hidden Gems Worth the Detour',
    author: 'Marco Rossi',
    image: 'https://images.unsplash.com/photo-1526318896980-cf78c088247c?auto=format&fit=crop&q=80&w=800',
    count: 8,
  },
  {
    id: 'g-local-brunch',
    title: 'A Proper Brunch Itinerary',
    author: 'Aiko Tanaka',
    image: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&q=80&w=800',
    count: 7,
  },
  {
    id: 'g-local-fine-dining',
    title: 'Tasting-Menu Temples',
    author: 'Diego Ramirez',
    image: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&q=80&w=800',
    count: 10,
  },
];

/* ── City-key helper ─────────────────────────────────────────────────────────
   The URL label may be a plain city ("Los Angeles, CA") or a street address
   ("123 Main St, Los Angeles, CA"). Either way we pull out the primary city
   token so we can name queries with it and key the cache.

   We deliberately DON'T filter results by strict city-name match: many
   major cities (LA, NYC, SF) have popular restaurants in adjacent
   municipalities (West Hollywood, Beverly Hills, Brooklyn, Oakland) that
   a naive equals-match would drop. The radius filter in fetchBatch is
   the authoritative "inside this city" test.
   ──────────────────────────────────────────────────────────────────────── */
function cityKeyFromLabel(label: string): string {
  const parts = label.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  // Leading digit → full street address; skip the street and use the next piece.
  if (/^\s*\d/.test(parts[0]) && parts.length > 1) return parts[1];
  return parts[0];
}

/* Map Google Places types → human-readable cuisine label ("Italian", "Sushi").
   Duplicated lightly from recommendations.ts so the row can render without
   cross-importing the recommendation engine's internals. Falls back to ''
   (renders as "Restaurant") when no known cuisine type is present. */
const GOOGLE_TYPE_TO_CUISINE: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const entry of CUISINE_TYPES) {
    if (entry.type) out[entry.type] = entry.label;
  }
  return out;
})();

function inferCuisineLabel(types: string[]): string {
  for (const t of types) {
    const label = GOOGLE_TYPE_TO_CUISINE[t];
    if (label && label !== 'All') return label;
  }
  return '';
}

/* ── Query rotation ──────────────────────────────────────────────────────────
   Google Places' text search caps at ~20 hits per call, so "infinite scroll"
   is really a rotation through a widening set of queries until we've drained
   every reasonable angle on the city. We seed a generic set and blend in the
   user's top cuisines so the pool slants toward things they're likely to
   enjoy while still covering the city broadly.
   ──────────────────────────────────────────────────────────────────────── */
const GENERIC_SEEDS: string[] = [
  'best restaurants in {city}',
  'popular restaurants in {city}',
  'top rated restaurants in {city}',
  'trending restaurants in {city}',
  'highly rated restaurants in {city}',
  'must try restaurants in {city}',
  'best dinner in {city}',
  'best lunch in {city}',
  'hidden gem restaurants in {city}',
  'neighborhood restaurants in {city}',
  'local favorites restaurants in {city}',
  'fine dining {city}',
  'casual dining {city}',
  'date night restaurants in {city}',
];

function buildQueryPool(cityKey: string, topCuisines: string[]): string[] {
  const city = cityKey || 'the area';
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (q: string) => {
    const key = q.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(q);
  };
  // Interleave personalised cuisine picks with generic seeds so the very first
  // batch already leans toward the user's taste.
  const cuisineQueries = topCuisines.flatMap((c) => [
    `best ${c} restaurants in ${city}`,
    `top rated ${c} restaurants in ${city}`,
  ]);
  const generic = GENERIC_SEEDS.map((s) => s.replace('{city}', city));
  const longest = Math.max(cuisineQueries.length, generic.length);
  for (let i = 0; i < longest; i++) {
    if (cuisineQueries[i]) push(cuisineQueries[i]);
    if (generic[i]) push(generic[i]);
  }
  return out;
}

/* Variant used when the user is typing in the search box. We shape the
   queries around their input so Google biases toward matches on a
   restaurant's name / type / description; the radius still keeps
   results inside the selected city. */
function buildSearchQueryPool(term: string, cityKey: string): string[] {
  const city = cityKey || 'the area';
  const q = term.trim();
  if (!q) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (s: string) => {
    const key = s.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };
  push(`${q} in ${city}`);
  push(`${q} restaurants in ${city}`);
  push(`best ${q} in ${city}`);
  push(`top rated ${q} in ${city}`);
  return out;
}

type SortOption = 'recommended' | 'rating' | 'popularity' | 'distance';

const SORT_LABELS: Record<SortOption, string> = {
  recommended: 'Recommended',
  rating: 'Highest Rated',
  popularity: 'Most Popular',
  distance: 'Closest First',
};

const INITIAL_BATCH_SIZE = 4;  // queries pulled in parallel on first load
const LOAD_MORE_BATCH_SIZE = 3; // queries pulled per infinite-scroll page

/* ── Query cursor ────────────────────────────────────────────────────────────
   Each query in the pool is paginated independently via Google's
   `nextPageToken`. A single query ("best restaurants in NYC") can yield
   dozens of pages — this per-query cursor is what lets infinite scroll go
   deep into one query instead of only rotating across different queries.
   ──────────────────────────────────────────────────────────────────────── */
interface QueryCursor {
  query: string;
  /** Token supplied by the previous response; undefined before the first
   *  fetch, and undefined again once the server returns no next page. */
  pageToken?: string;
  /** True when the server has told us there are no more pages for this
   *  query. We keep drained cursors in the list so the sort stays stable;
   *  fetchBatch just skips them. */
  drained?: boolean;
}

/* ── Cache ───────────────────────────────────────────────────────────────────
   Each city the user visits is memoised so that bouncing between two cities
   (or reloading the tab) doesn't re-spend Google Places calls. The cache is
   module-level (instant during a session) with a localStorage mirror so it
   survives refreshes inside the TTL window. The cache key includes the
   price filter so each price tier gets its own persisted pool (switching
   between $ and $$$$ doesn't invalidate either).
   ──────────────────────────────────────────────────────────────────────── */
interface CachedCityData {
  placesPool: PlaceResult[];
  cursors: QueryCursor[];
  seenIds: string[];
  exhausted: boolean;
  /** Hash of the user's top cuisines at cache time. When it changes we
   *  invalidate the cursors / seen set but keep already-fetched restaurants
   *  (they're still valid, just ranked differently next time). */
  cuisinesKey: string;
  updatedAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
// Bumped to v2 when the schema switched from {queryPool, queryCursor} to
// {cursors}. Old v1 entries in localStorage are orphaned; the browser
// eventually evicts them.
const CACHE_STORAGE_KEY = 'gourmad-location-page-cache-v2';
const MAX_CACHED_CITIES = 24; // doubled from v1 since price tiers get their own slots

function cityCacheKey(lat: number, lng: number, cityKey: string, priceLevel: number): string {
  return `${cityKey.toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}|p=${priceLevel}`;
}

function cuisinesKeyOf(topCuisines: string[]): string {
  return topCuisines.slice(0, 5).join('|');
}

type CacheMap = Record<string, CachedCityData>;

// Hydrated lazily on first read. Null sentinel means "not yet loaded".
let memoryCache: CacheMap | null = null;

function loadCache(): CacheMap {
  if (memoryCache) return memoryCache;
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    memoryCache = raw ? (JSON.parse(raw) as CacheMap) : {};
  } catch {
    memoryCache = {};
  }
  return memoryCache;
}

function persistCache(cache: CacheMap) {
  // Keep only the most-recent N entries so storage doesn't grow unboundedly.
  const entries = Object.entries(cache)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, MAX_CACHED_CITIES);
  const pruned: CacheMap = {};
  for (const [k, v] of entries) pruned[k] = v;
  memoryCache = pruned;
  try {
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    /* quota exceeded / storage disabled — in-memory copy still works. */
  }
}

function readCachedCity(key: string): CachedCityData | null {
  const cache = loadCache();
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > CACHE_TTL_MS) {
    delete cache[key];
    persistCache(cache);
    return null;
  }
  return entry;
}

function writeCachedCity(key: string, data: Omit<CachedCityData, 'updatedAt'>) {
  const cache = loadCache();
  cache[key] = { ...data, updatedAt: Date.now() };
  persistCache(cache);
}

/* ── Page ────────────────────────────────────────────────────────────────── */
export const LocationPage: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const label = params.get('label') || 'Location';
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);

  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { ratings, wishlist, lists } = useLists();

  const cityKey = useMemo(() => cityKeyFromLabel(label), [label]);
  const cityDisplay = useMemo(() => {
    // Strip a leading street address if we have one, so the title reads
    // "Los Angeles, CA" not "123 Main St, Los Angeles, CA".
    const parts = label.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return 'Location';
    if (/^\s*\d/.test(parts[0]) && parts.length > 1) return parts.slice(1).join(', ');
    return label;
  }, [label]);

  // User's taste profile, reused to score every batch we fetch. `recentViews`
  // isn't available here (it lives in Map.tsx state), which is fine: it only
  // affects a skip-set, and the cost of occasionally re-showing a recent view
  // on this page is negligible.
  const profile = useMemo(
    () => buildTasteProfile(ratings, wishlist, lists, []),
    [ratings, wishlist, lists],
  );

  // Social scoring signals, fetched once per (user, city). These feed
  // scoreCandidates so friend/expert activity can lift a restaurant even
  // when the Google-level signals are thin.
  const [signals, setSignals] = useState<CandidateSignals>(() => ({
    expertUserIds: new Set<string>(),
    followedExpertIds: new Set<string>(),
    friendUserIds: new Set<string>(),
    communityByRestaurant: new Map<string, CommunityRating[]>(),
    expertRecRestaurantIds: new Set<string>(),
  }));

  // Used for the "Friend rated" / "Expert pick" pill on each card. Built from
  // the same community rows that power `signals`, but kept as a separate
  // lookup so the render path doesn't have to re-walk the Map each frame.
  const [friendRestaurantIds, setFriendRestaurantIds] = useState<Set<string>>(new Set());
  const [expertRestaurantIds, setExpertRestaurantIds] = useState<Set<string>>(new Set());
  // Count of DISTINCT friends / experts who rated each restaurant. The row
  // uses these to upgrade the "Friend rated" pill to "3 friends rated" when
  // the signal is backed by multiple people — a stronger visual cue than a
  // plain badge.
  const [friendCounts, setFriendCounts] = useState<Map<string, number>>(new Map());
  const [expertCounts, setExpertCounts] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [expertProfiles, followedIds, friendRows, topExpertRows, expertRecRows] = await Promise.all([
        getExpertProfiles().catch(() => []),
        userId ? getFollowedExpertIds(userId).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
        userId ? getAllFriendRatings(userId).catch(() => [] as CommunityRating[]) : Promise.resolve([] as CommunityRating[]),
        // A generous global recency slice covers "experts I don't follow
        // but who rate a lot". It's paired below with an uncapped per-user
        // fetch for the experts the user DOES follow, so older ratings
        // from those specific users can't fall off the 500-row cliff.
        getExpertRatings(500).catch(() => [] as CommunityRating[]),
        (async () => {
          if (!supabaseConfigured) return [] as { restaurant_id: string }[];
          try {
            const { data } = await supabase.from('expert_recommendations').select('restaurant_id');
            return (data || []) as { restaurant_id: string }[];
          } catch {
            return [] as { restaurant_id: string }[];
          }
        })(),
      ]);
      if (cancelled) return;

      // Now that we know which experts the user follows, fetch EVERY
      // rating those experts have authored (no limit). Without this pass,
      // a user who follows a prolific expert with hundreds of ratings
      // could have most of them cut off by the top-500 recency slice.
      const followedExpertIdList = Array.from(followedIds);
      const followedRows = followedExpertIdList.length > 0
        ? await getRatingsByUserIds(followedExpertIdList).catch(() => [] as CommunityRating[])
        : [];
      if (cancelled) return;

      const expertUserIds = new Set(expertProfiles.map((e) => e.user_id));
      const friendUserIds = new Set(friendRows.map((r) => r.user_id));
      const communityByRestaurant = new Map<string, CommunityRating[]>();
      const friendSet = new Set<string>();
      const expertSet = new Set<string>();
      // Per-restaurant sets of DISTINCT user ids so the row-card "N friends
      // rated" count can't double up when the same person rated twice.
      const friendUsersByRestaurant = new Map<string, Set<string>>();
      const expertUsersByRestaurant = new Map<string, Set<string>>();
      const seenRatingIds = new Set<string>();
      const ingest = (rows: CommunityRating[]) => {
        for (const row of rows) {
          // Dedup by rating id — topExpertRows and followedRows overlap
          // on ratings from followed experts that made the global slice.
          if (seenRatingIds.has(row.id)) continue;
          seenRatingIds.add(row.id);
          const arr = communityByRestaurant.get(row.restaurant_id);
          if (arr) arr.push(row);
          else communityByRestaurant.set(row.restaurant_id, [row]);
          if (friendUserIds.has(row.user_id)) {
            friendSet.add(row.restaurant_id);
            let set = friendUsersByRestaurant.get(row.restaurant_id);
            if (!set) { set = new Set(); friendUsersByRestaurant.set(row.restaurant_id, set); }
            set.add(row.user_id);
          }
          if (expertUserIds.has(row.user_id)) {
            expertSet.add(row.restaurant_id);
            let set = expertUsersByRestaurant.get(row.restaurant_id);
            if (!set) { set = new Set(); expertUsersByRestaurant.set(row.restaurant_id, set); }
            set.add(row.user_id);
          }
        }
      };
      ingest(friendRows);
      ingest(topExpertRows);
      ingest(followedRows);
      const expertRecIds = new Set<string>(expertRecRows.map((r) => r.restaurant_id));
      for (const id of expertRecIds) expertSet.add(id);

      const friendCountMap = new Map<string, number>();
      for (const [id, set] of friendUsersByRestaurant) friendCountMap.set(id, set.size);
      const expertCountMap = new Map<string, number>();
      for (const [id, set] of expertUsersByRestaurant) expertCountMap.set(id, set.size);

      setSignals({
        expertUserIds,
        followedExpertIds: followedIds,
        friendUserIds,
        communityByRestaurant,
        expertRecRestaurantIds: expertRecIds,
      });
      setFriendRestaurantIds(friendSet);
      setExpertRestaurantIds(expertSet);
      setFriendCounts(friendCountMap);
      setExpertCounts(expertCountMap);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // The sorted, deduplicated pool of places we've pulled for this city.
  // `placesPool` is the raw accumulated list; `ranked` is the same list after
  // scoring + sorting. We re-score whenever the pool or signals change so
  // newly-loaded friend/expert activity can bubble existing rows upward.
  const [placesPool, setPlacesPool] = useState<PlaceResult[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  // Per-query cursors. Each entry carries its own pageToken so load-more
  // drives each query through ALL its pages before we call the pool
  // exhausted — that's how a single "$$$$ New York" run now yields
  // hundreds of results instead of the ~20 a single page returns.
  const cursorsRef = useRef<QueryCursor[]>([]);

  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  // ── Search & filters ──────────────────────────────────────────────────
  // Typing drives `searchQuery` on every keystroke; `debouncedSearch` is
  // what actually reshapes the query pool, so the user isn't hammering
  // Google for every letter. An empty debounced value means "default
  // pool + cache" — any non-empty value bypasses the cache and drives a
  // targeted fetch.
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Filters apply client-side to the ranked array — they don't gate which
  // places we fetch, only which we show. This keeps infinite scroll
  // feeling live: as more pages come in, matching results trickle in.
  // (Price is the exception: it flows to the server via priceLevels so
  //  we get more matching results per page.)
  const [selectedPrice, setSelectedPrice] = useState(0);
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>('recommended');
  // 0 = Any. Value is in miles; anything > 0 narrows the list to places
  // whose haversine distance from the city centre is ≤ this chip. The
  // values mirror the Home-feed "Recommended For You" radius picker so
  // the mental model stays consistent.
  const [selectedRadius, setSelectedRadius] = useState(0);
  // Walk- / drive-time caps in minutes. 0 = Any. Only usable when the
  // user's saved home is a precise street address — otherwise there's no
  // routable origin and Mapbox Directions can't compute a real travel
  // time, so the UI hides the controls.
  const [selectedWalkMin, setSelectedWalkMin] = useState(0);
  const [selectedDriveMin, setSelectedDriveMin] = useState(0);
  // When on, the list is narrowed to restaurants someone in the user's
  // circle (friends / followed experts) has rated ≥8. We load both signal
  // sets up-front in the useEffect above, so this is a cheap client-side
  // intersection with no extra network work.
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [expertsOnly, setExpertsOnly] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const activeFilterCount =
    (selectedPrice > 0 ? 1 : 0) +
    selectedCuisines.length +
    (sortBy !== 'recommended' ? 1 : 0) +
    (selectedRadius > 0 ? 1 : 0) +
    (selectedWalkMin > 0 ? 1 : 0) +
    (selectedDriveMin > 0 ? 1 : 0) +
    (friendsOnly ? 1 : 0) +
    (expertsOnly ? 1 : 0);

  // User's saved home, read once and kept stable across re-renders. When
  // this is a precise street address (leading-digit heuristic), the rows'
  // distance + drive/walk times are computed from home rather than the
  // city centre — and the walk / drive filters in the sheet become
  // available. City-level saved locations can't anchor a routable origin,
  // so the filters stay hidden.
  const savedHome = useMemo(() => loadLastSelectedLocation(), []);
  const exactHomeOrigin = useMemo(
    () => (isExactAddress(savedHome) ? savedHome : null),
    [savedHome],
  );

  // ~12.5 mi — tuned for sprawling cities (LA, Houston) where a tight
  // radius would drop popular picks in adjacent municipalities. Smaller
  // cities still work because Google's text-search already biases toward
  // the query city; the radius is just a safety cutoff.
  const radiusMeters = 20000;
  const currentCuisinesKey = useMemo(
    () => cuisinesKeyOf(profile.topCuisines),
    [profile.topCuisines],
  );
  // A stable per-(city, coords, price-tier) cache identifier. Null when we
  // don't have the coords needed to look anything up. Including the price
  // tier means switching between $ and $$$$ just looks up a different
  // cache entry — neither invalidates the other.
  const activeCacheKey = useMemo(
    () => (hasCoords ? cityCacheKey(lat, lng, cityKey, selectedPrice) : null),
    [hasCoords, lat, lng, cityKey, selectedPrice],
  );

  const fetchBatch = useCallback(async (batchSize: number): Promise<PlaceResult[]> => {
    if (!hasCoords) return [];
    // Pick the first N cursors that still have pages to fetch. Drained
    // cursors stay in the list so the serialized cache shape stays stable
    // across reloads; we just skip them here.
    const candidates: QueryCursor[] = [];
    for (const c of cursorsRef.current) {
      if (c.drained) continue;
      candidates.push(c);
      if (candidates.length >= batchSize) break;
    }
    if (candidates.length === 0) {
      setExhausted(true);
      return [];
    }
    const priceLevels = selectedPrice > 0 ? [selectedPrice] : undefined;
    const results = await Promise.all(
      candidates.map(async (cur) => {
        const res = await searchPlacesByTextPaged(cur.query, {
          lat,
          lng,
          radiusMeters,
          useRestriction: true,
          priceLevels,
          pageToken: cur.pageToken,
        });
        cur.pageToken = res.nextPageToken || undefined;
        if (!res.nextPageToken) cur.drained = true;
        return res.places;
      }),
    );

    const radiusKm = radiusMeters / 1000;
    const fresh: PlaceResult[] = [];
    // Interleave results page-by-page so no single query dominates the
    // top of the list, and apply the radius safety cutoff.
    const maxLen = Math.max(0, ...results.map((r) => r.length));
    for (let i = 0; i < maxLen; i++) {
      for (const list of results) {
        const p = list[i];
        if (!p) continue;
        if (seenIdsRef.current.has(p.id)) continue;
        if (
          haversineKm({ lat: p.lat, lng: p.lng }, { lat, lng }) > radiusKm * 1.2
        ) continue;
        seenIdsRef.current.add(p.id);
        fresh.push(p);
      }
    }
    if (cursorsRef.current.every((c) => c.drained)) setExhausted(true);
    return fresh;
  }, [hasCoords, lat, lng, radiusMeters, selectedPrice]);

  // Kick off the initial batch whenever the location or search term
  // changes. The default-browse path looks at the cache: a fresh hit with
  // the same taste profile restores everything synchronously, so
  // revisiting a city is instant and costs nothing. When taste has
  // shifted we keep the cached places (still valid restaurants) but
  // reset the query-pool cursor so follow-on loads can surface
  // newly-interesting picks. In search mode the cache is bypassed and
  // the pool is replaced by search-shaped queries.
  useEffect(() => {
    if (!hasCoords || !activeCacheKey) {
      setInitialLoading(false);
      return;
    }
    let cancelled = false;

    // ── Search path ───────────────────────────────────────────────────
    // Any typed search bypasses the per-city cache entirely: caching
    // every free-form query would bloat storage fast, and a miss here
    // still only costs 2–3 Google calls.
    if (debouncedSearch) {
      setPlacesPool([]);
      seenIdsRef.current = new Set();
      cursorsRef.current = buildSearchQueryPool(debouncedSearch, cityKey)
        .map((query) => ({ query }));
      setExhausted(cursorsRef.current.length === 0);
      setInitialLoading(true);
      (async () => {
        const fresh = await fetchBatch(INITIAL_BATCH_SIZE);
        if (cancelled) return;
        setPlacesPool(fresh);
        setInitialLoading(false);
      })();
      return () => { cancelled = true; };
    }

    // ── Browse path (cached) ──────────────────────────────────────────
    const cached = readCachedCity(activeCacheKey);
    const sameProfile = cached && cached.cuisinesKey === currentCuisinesKey;

    if (cached && sameProfile) {
      // Fast path — hydrate straight from cache. No network, no spinner.
      // Cursors come back with whatever pageTokens were in flight when we
      // last wrote the cache, so load-more picks up exactly where it left off.
      setPlacesPool(cached.placesPool);
      seenIdsRef.current = new Set(cached.seenIds);
      cursorsRef.current = cached.cursors.length > 0
        ? cached.cursors.map((c) => ({ ...c }))
        : buildQueryPool(cityKey, profile.topCuisines).map((query) => ({ query }));
      setExhausted(cached.exhausted);
      setInitialLoading(false);
      return;
    }

    // Slow path — either no cache, stale cache, or taste profile changed.
    // When there's a cached places list with a different profile we still
    // show it immediately (avoid a flash of blank state) while a fresh
    // batch loads behind it.
    const hadPartialCache = !!cached;
    setPlacesPool(cached?.placesPool ?? []);
    seenIdsRef.current = new Set(cached?.seenIds ?? []);
    cursorsRef.current = buildQueryPool(cityKey, profile.topCuisines)
      .map((query) => ({ query }));
    setExhausted(false);
    setInitialLoading(!hadPartialCache);

    (async () => {
      const fresh = await fetchBatch(INITIAL_BATCH_SIZE);
      if (cancelled) return;
      // Merge the fresh batch onto whatever we rehydrated from cache so we
      // don't nuke a working list when the fresh call fails or returns
      // nothing new (e.g. offline / rate limited).
      setPlacesPool((prev) => {
        const byId = new Map<string, PlaceResult>();
        for (const p of prev) byId.set(p.id, p);
        for (const p of fresh) if (!byId.has(p.id)) byId.set(p.id, p);
        return Array.from(byId.values());
      });
      setInitialLoading(false);
    })();
    return () => { cancelled = true; };
    // `fetchBatch` already closes over lat/lng/city so listing it once is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCoords, lat, lng, cityKey, activeCacheKey, currentCuisinesKey, debouncedSearch]);

  // Persist the pool back to cache every time it changes (initial batch,
  // load-more appends, etc.) so the next visit to this city can skip the
  // network entirely. Debounced via the effect's own batching so we don't
  // write on every intermediate state transition. Skip writes while a
  // search is active so free-form queries don't overwrite the default
  // browse pool.
  useEffect(() => {
    if (!activeCacheKey) return;
    if (placesPool.length === 0) return;
    if (debouncedSearch) return;
    writeCachedCity(activeCacheKey, {
      placesPool,
      // Snapshot the current cursor state (pageTokens + drained flags) so a
      // reload can resume load-more mid-stream instead of restarting.
      cursors: cursorsRef.current.map((c) => ({ ...c })),
      seenIds: Array.from(seenIdsRef.current),
      exhausted,
      cuisinesKey: currentCuisinesKey,
    });
  }, [activeCacheKey, placesPool, exhausted, currentCuisinesKey, debouncedSearch]);

  const loadMore = useCallback(async () => {
    if (loadingMore || exhausted || initialLoading) return;
    // Strict content filters (Friends / Experts only) are authoritative
    // via augmentation — every known match is already spliced into the
    // pool from signals.communityByRestaurant. Paginating Google further
    // rarely produces matching rows, so we'd just spin the loader while
    // appending nothing. Skip the fetch and let the list end naturally.
    if (friendsOnly || expertsOnly) return;
    setLoadingMore(true);
    const fresh = await fetchBatch(LOAD_MORE_BATCH_SIZE);
    setPlacesPool((prev) => {
      const merged = [...prev];
      for (const p of fresh) merged.push(p);
      return merged;
    });
    setLoadingMore(false);
  }, [loadingMore, exhausted, initialLoading, fetchBatch, friendsOnly, expertsOnly]);

  // When the user turns on "Friends only" or "Experts only", we augment
  // the Google-fetched pool with restaurants the circle has rated. Google's
  // text search can miss places that are popular within a small trusted
  // group but don't rank broadly ("my friend's favorite sushi counter"),
  // so without this step those filters would only show the overlap that
  // happened to land in the Google response.
  //
  // Community rows already live in `signals.communityByRestaurant` (loaded
  // on mount), so this is a synchronous pool top-up — no extra network.
  // We skip rows outside the city radius and rows that are already in the
  // Google pool.
  //
  // CUISINE_LABEL_TO_TYPE lets a community row's free-text cuisine
  // ("Italian") feed into the same Google-type path the row renderer uses,
  // so pseudo-places get a cuisine badge instead of falling back to plain
  // "Restaurant".
  const CUISINE_LABEL_TO_TYPE = useMemo(() => {
    const out: Record<string, string> = {};
    for (const entry of CUISINE_TYPES) {
      if (entry.type) out[entry.label.toLowerCase()] = entry.type;
    }
    return out;
  }, []);

  const augmentedPool: PlaceResult[] = useMemo(() => {
    if (!friendsOnly && !expertsOnly) return placesPool;
    if (!hasCoords) return placesPool;
    const existing = new Set(placesPool.map((p) => p.id));
    const radiusKm = radiusMeters / 1000;
    const extras: PlaceResult[] = [];
    for (const [id, rows] of signals.communityByRestaurant) {
      if (existing.has(id)) continue;
      const isFriendHit = friendsOnly && friendRestaurantIds.has(id);
      const isExpertHit = expertsOnly && expertRestaurantIds.has(id);
      if (!isFriendHit && !isExpertHit) continue;
      const row = rows[0];
      if (!row || row.lat == null || row.lng == null) continue;
      // Keep the radius tolerance aligned with fetchBatch's 1.2× cushion
      // so an augmented pseudo-place doesn't get filtered out later by
      // the same distance check.
      if (
        haversineKm({ lat: row.lat, lng: row.lng }, { lat, lng }) > radiusKm * 1.2
      ) continue;
      const cuisineType = row.cuisine
        ? CUISINE_LABEL_TO_TYPE[row.cuisine.toLowerCase()]
        : undefined;
      extras.push({
        id,
        name: row.restaurant_name,
        lat: row.lat,
        lng: row.lng,
        rating: 0,
        priceLevel: row.price?.length ?? 0,
        address: row.address,
        fullAddress: row.address,
        photoUrl: null,
        types: cuisineType ? [cuisineType] : [],
        userRatingCount: 0,
      });
    }
    if (extras.length === 0) return placesPool;
    return [...placesPool, ...extras];
  }, [
    placesPool, friendsOnly, expertsOnly, signals, friendRestaurantIds,
    expertRestaurantIds, hasCoords, lat, lng, radiusMeters, CUISINE_LABEL_TO_TYPE,
  ]);

  // Re-score the augmented pool whenever it changes. The recommendation
  // engine handles cuisine/price/pair/tag/friend/expert weighting, so this
  // page just feeds in the profile + signals we've already gathered.
  // `skipUserHistory` is off because the spec wants every restaurant in the
  // city visible, not only ones the user hasn't touched before.
  const ranked: ScoredPlace[] = useMemo(() => {
    if (augmentedPool.length === 0) return [];
    if (!hasCoords) return augmentedPool.map((p) => ({ ...p, recScore: 0, sources: ['google'] as ScoredPlace['sources'] }));
    const target = { label: cityDisplay, lat, lng };
    return scoreCandidates(
      augmentedPool,
      profile,
      signals,
      target,
      radiusMeters,
      { limit: Infinity, skipUserHistory: false },
    );
  }, [augmentedPool, profile, signals, cityDisplay, lat, lng, hasCoords, radiusMeters]);

  // Apply the in-page filters + sort to the already-ranked list. Filters
  // never trigger a refetch — they shrink what's shown from the pool we
  // already have, so as infinite-scroll pulls more pages any matching
  // results trickle in without a round-trip.
  const visible: ScoredPlace[] = useMemo(() => {
    const out: ScoredPlace[] = [];
    const cuisineSet = new Set(selectedCuisines);
    for (const p of ranked) {
      if (selectedPrice > 0 && p.priceLevel !== selectedPrice) continue;
      if (cuisineSet.size > 0) {
        // Match if any of the place's Google types is in the selected
        // cuisine type set.
        let hit = false;
        for (const t of p.types) if (cuisineSet.has(t)) { hit = true; break; }
        if (!hit) continue;
      }
      if (selectedRadius > 0 && hasCoords) {
        const distMi = haversineDistanceMi(lat, lng, p.lat, p.lng);
        if (distMi > selectedRadius) continue;
      }
      if (friendsOnly && !friendRestaurantIds.has(p.id)) continue;
      if (expertsOnly && !expertRestaurantIds.has(p.id)) continue;
      out.push(p);
    }
    if (sortBy === 'recommended') return out;
    const sorted = [...out];
    if (sortBy === 'rating') {
      sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (sortBy === 'popularity') {
      sorted.sort((a, b) => (b.userRatingCount || 0) - (a.userRatingCount || 0));
    } else if (sortBy === 'distance' && hasCoords) {
      sorted.sort(
        (a, b) =>
          haversineDistanceMi(lat, lng, a.lat, a.lng) -
          haversineDistanceMi(lat, lng, b.lat, b.lng),
      );
    }
    return sorted;
  }, [
    ranked, selectedPrice, selectedCuisines, sortBy, hasCoords, lat, lng,
    selectedRadius, friendsOnly, expertsOnly,
    friendRestaurantIds, expertRestaurantIds,
  ]);

  // IntersectionObserver sentinel powers the infinite-scroll load-more. We
  // attach it ONCE on mount; listing `loadMore` in the deps would tear
  // down and rebuild the observer every time loadingMore flips, and
  // reattaching to an element that's still inside the rootMargin fires
  // the callback immediately — causing back-to-back fetches, the
  // spinner-without-results bug, and the sentinel glitch at the bottom
  // of the page. Calling through a ref keeps the latest loadMore without
  // disturbing the observer.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(loadMore);
  useEffect(() => { loadMoreRef.current = loadMore; }, [loadMore]);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) void loadMoreRef.current();
      }
    }, { rootMargin: '600px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Origin the row cards use for distance + drive/walk times. When the
  // user has a precise saved home address we measure from there — that's
  // the origin the new walk/drive filters also apply to, so "Under 20 min
  // walk" narrows against the same numbers the row shows. Otherwise we
  // fall back to the city centre and skip the route-based filters.
  const origin = exactHomeOrigin
    ? { lat: exactHomeOrigin.lat, lng: exactHomeOrigin.lng }
    : hasCoords
      ? { lat, lng }
      : null;

  // Current location the dropdown should display. When the URL doesn't carry
  // valid coords we leave it null so HomeLocationBar renders its "Select a
  // location" placeholder state.
  const currentLocation: HomeLocation | null = hasCoords
    ? { label: cityDisplay, lat, lng }
    : null;

  // When the user picks a different city (or address) from the dropdown we
  // swap the URL params. The page effects are keyed on those params, so a
  // fresh cache lookup + either instant hydration or a new fetch happens
  // automatically. HomeLocationBar itself persists the pick to recents +
  // last-selected, so we don't need to write those here. `replace: true`
  // keeps the browser history shallow — back always returns to wherever
  // the user opened the explore page from.
  const handleLocationChange = useCallback((loc: HomeLocation) => {
    navigate(
      `/location?label=${encodeURIComponent(loc.label)}&lat=${loc.lat}&lng=${loc.lng}`,
      { replace: true },
    );
  }, [navigate]);

  // "Use current location" — same flow as Map.tsx: geolocate, reverse-geocode
  // to a human label, then feed it back through the regular change handler.
  const handleUseCurrent = useCallback(async (): Promise<void> => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      throw new Error('Geolocation is not available in this browser.');
    }
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        maximumAge: 60 * 1000,
        timeout: 15000,
        enableHighAccuracy: true,
      });
    });
    const { latitude, longitude } = pos.coords;
    const newLabel = await reverseGeocode(latitude, longitude);
    handleLocationChange({ label: newLabel, lat: latitude, lng: longitude });
  }, [handleLocationChange]);

  return (
    <div className="min-h-screen bg-surface pb-24">
      {/* Sticky action bar — back + map stay pinned as the page scrolls so
          the user can always navigate out. Background is opaque so the
          scrolling content underneath isn't visible through the bar. */}
      <div className="sticky top-0 z-20 bg-surface px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-10 h-10 -ml-2 flex items-center justify-center rounded-full text-on-surface/70 hover:text-on-surface hover:bg-on-surface/[0.04] transition-colors"
            aria-label="Back"
          >
            <ArrowLeft size={22} />
          </button>
          <button
            type="button"
            onClick={() => { /* Map view hook-up is a later task. */ }}
            className="w-10 h-10 -mr-2 flex items-center justify-center rounded-full text-on-surface/70 hover:text-on-surface hover:bg-on-surface/[0.04] transition-colors"
            aria-label="Open map view"
          >
            <MapIcon size={20} />
          </button>
        </div>
      </div>

      {/* City picker — scrolls with the page since it's part of the title
          block, not the sticky navigation affordance. */}
      <div className="px-4 mt-1">
        <HomeLocationBar
          location={currentLocation}
          onChange={handleLocationChange}
          onUseCurrent={handleUseCurrent}
        />
      </div>

      {/* Guides — horizontal scroll, non-functional placeholder */}
      <section className="mt-5">
        <div className="px-4 flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <BookOpen size={14} className="text-primary/70" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-on-surface/60">Guides</h2>
          </div>
        </div>
        <div className="flex gap-2.5 overflow-x-auto pb-2 px-4 scrollbar-hide snap-x snap-mandatory">
          {PLACEHOLDER_GUIDES.map((g) => (
            <button
              key={g.id}
              type="button"
              className="flex-shrink-0 snap-start group text-left"
            >
              <div className="relative w-40 aspect-[4/5] rounded-xl overflow-hidden bg-muted">
                <img
                  src={g.image}
                  alt={g.title}
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/40 to-transparent pointer-events-none" />
                <div className="absolute top-2 left-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/90 backdrop-blur-sm text-[9px] font-bold uppercase tracking-wider text-on-surface/70">
                  <BookOpen size={9} />
                  Guide
                </div>
                <div className="absolute inset-x-0 bottom-0 p-2.5">
                  <p className="text-white text-[13px] font-serif font-bold leading-tight drop-shadow-sm line-clamp-2">{g.title}</p>
                  <p className="text-white/80 text-[10px] font-medium mt-0.5 truncate">by {g.author} · {g.count} spots</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Restaurant list */}
      <section className="mt-8">
        <div className="px-4 mx-auto max-w-3xl lg:max-w-4xl">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={15} className="text-primary/70" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-on-surface/60">
                {debouncedSearch ? `Results for "${debouncedSearch}"` : 'Picked for you'}
              </h2>
            </div>
          </div>

          {/* Search + filter row */}
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1 min-w-0">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search in ${cityDisplay}`}
                className="w-full bg-on-surface/[0.04] focus:bg-on-surface/[0.06] rounded-full py-2.5 pl-10 pr-10 text-sm font-medium focus:outline-none"
                autoCapitalize="off"
                autoCorrect="off"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full text-on-surface/50 hover:text-on-surface/80 hover:bg-on-surface/[0.04]"
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setFilterSheetOpen(true)}
              className={cn(
                'relative flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 rounded-full text-sm font-semibold transition-colors',
                activeFilterCount > 0
                  ? 'bg-primary/10 text-primary'
                  : 'bg-on-surface/[0.04] text-on-surface/70 hover:bg-on-surface/[0.06]',
              )}
              aria-label="Filters"
            >
              <SlidersHorizontal size={15} />
              <span className="hidden sm:inline">Filters</span>
              {activeFilterCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[10px] font-bold">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          {/* Active-filter chips — shown only when something is applied so
              the user can see and dismiss individual filters without
              reopening the sheet. */}
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {sortBy !== 'recommended' && (
                <FilterChip
                  label={SORT_LABELS[sortBy]}
                  onClear={() => setSortBy('recommended')}
                />
              )}
              {selectedPrice > 0 && (
                <FilterChip
                  label={'$'.repeat(selectedPrice)}
                  onClear={() => setSelectedPrice(0)}
                />
              )}
              {selectedRadius > 0 && (
                <FilterChip
                  label={`Within ${selectedRadius} mi`}
                  onClear={() => setSelectedRadius(0)}
                />
              )}
              {selectedWalkMin > 0 && (
                <FilterChip
                  label={`Walk ≤ ${selectedWalkMin} min`}
                  onClear={() => setSelectedWalkMin(0)}
                />
              )}
              {selectedDriveMin > 0 && (
                <FilterChip
                  label={`Drive ≤ ${selectedDriveMin} min`}
                  onClear={() => setSelectedDriveMin(0)}
                />
              )}
              {friendsOnly && (
                <FilterChip
                  label="Friends only"
                  onClear={() => setFriendsOnly(false)}
                />
              )}
              {expertsOnly && (
                <FilterChip
                  label="Experts only"
                  onClear={() => setExpertsOnly(false)}
                />
              )}
              {selectedCuisines.map((t) => {
                const entry = CUISINE_TYPES.find((c) => c.type === t);
                return (
                  <FilterChip
                    key={t}
                    label={entry?.label || t}
                    onClear={() =>
                      setSelectedCuisines((prev) => prev.filter((x) => x !== t))
                    }
                  />
                );
              })}
            </div>
          )}
        </div>

        {initialLoading ? (
          <div className="flex items-center justify-center py-16 text-on-surface/40">
            <Loader2 size={18} className="animate-spin" />
            <span className="ml-2 text-xs font-medium">
              {debouncedSearch ? `Searching "${debouncedSearch}"…` : `Finding restaurants in ${cityDisplay}…`}
            </span>
          </div>
        ) : visible.length === 0 ? (
          <div className="px-6 py-16 text-center text-on-surface/45 text-sm">
            {ranked.length > 0
              ? 'No restaurants match these filters. Try clearing them.'
              : debouncedSearch
                ? `No matches for "${debouncedSearch}" in ${cityDisplay}.`
                : `No restaurants found in ${cityDisplay} yet.`}
          </div>
        ) : (
          <>
            <div className="px-4 mx-auto max-w-3xl lg:max-w-4xl">
              <ul className="divide-y divide-on-surface/[0.06]">
                {visible.map((place) => (
                  <RestaurantRow
                    key={place.id}
                    place={place}
                    origin={origin}
                    friendCount={friendCounts.get(place.id) ?? (friendRestaurantIds.has(place.id) ? 1 : 0)}
                    expertCount={expertCounts.get(place.id) ?? (expertRestaurantIds.has(place.id) ? 1 : 0)}
                    walkMinCap={selectedWalkMin > 0 ? selectedWalkMin : null}
                    driveMinCap={selectedDriveMin > 0 ? selectedDriveMin : null}
                  />
                ))}
              </ul>
            </div>

            {/* Sentinel + load-more state */}
            <div ref={sentinelRef} className="h-1" />
            {loadingMore && (
              <div className="flex items-center justify-center py-6 text-on-surface/40">
                <Loader2 size={16} className="animate-spin" />
                <span className="ml-2 text-xs font-medium">Loading more…</span>
              </div>
            )}
            {/* "End of list" shows on real pagination exhaustion, and also
                when a strict filter (Friends / Experts) is active — those
                filters source entirely from community rows we've already
                loaded, so there's no "more" to fetch. */}
            {(exhausted || friendsOnly || expertsOnly) && !loadingMore && (
              <div className="text-center text-[11px] uppercase tracking-wider text-on-surface/35 py-6">
                You've reached the end
              </div>
            )}
          </>
        )}
      </section>

      <FilterSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        sortBy={sortBy}
        onSortChange={setSortBy}
        selectedPrice={selectedPrice}
        onPriceChange={setSelectedPrice}
        selectedCuisines={selectedCuisines}
        onCuisinesChange={setSelectedCuisines}
        selectedRadius={selectedRadius}
        onRadiusChange={setSelectedRadius}
        friendsOnly={friendsOnly}
        onFriendsOnlyChange={setFriendsOnly}
        expertsOnly={expertsOnly}
        onExpertsOnlyChange={setExpertsOnly}
        canFilterByTravelTime={!!exactHomeOrigin}
        homeLabel={exactHomeOrigin?.label.split(',')[0].trim() || null}
        selectedWalkMin={selectedWalkMin}
        onWalkMinChange={setSelectedWalkMin}
        selectedDriveMin={selectedDriveMin}
        onDriveMinChange={setSelectedDriveMin}
      />
    </div>
  );
};

/* ── Row ─────────────────────────────────────────────────────────────────────
   A single restaurant line item. Photo-free by design: the name, the match
   signals, and the travel context are all that matter on this surface. The
   score badge pins to the right so the eye can scan a column of numbers.
   ──────────────────────────────────────────────────────────────────────── */
interface RestaurantRowProps {
  place: ScoredPlace;
  origin: { lat: number; lng: number } | null;
  /** Number of distinct friends who rated this place. 0 when none. */
  friendCount: number;
  /** Number of distinct experts who rated (or recommended) this place. */
  expertCount: number;
  /** Walk / drive filter caps in minutes, or null when the filter is off.
   *  When non-null, rows whose travel time exceeds the cap render nothing.
   *  While travel times are still resolving, the row renders nothing too
   *  so a not-yet-loaded time can't slip past the filter. */
  walkMinCap: number | null;
  driveMinCap: number | null;
}

const scoreBg = (rating: number): string => {
  if (rating >= 8) return 'bg-emerald-500';
  if (rating >= 5) return 'bg-amber-500';
  return 'bg-red-500';
};

const RestaurantRow: React.FC<RestaurantRowProps> = ({
  place,
  origin,
  friendCount,
  expertCount,
  walkMinCap,
  driveMinCap,
}) => {
  const distanceMi = origin
    ? haversineDistanceMi(origin.lat, origin.lng, place.lat, place.lng)
    : 0;
  const distanceLabel = origin ? formatDistance(distanceMi) : '';

  const { driveMin, walkMin } = useTravelTimes(
    origin,
    Number.isFinite(place.lat) && Number.isFinite(place.lng)
      ? { lat: place.lat, lng: place.lng }
      : null,
  );
  const driveLabel = formatTravelTime(driveMin);
  const walkLabel = formatTravelTime(walkMin);

  // When a travel-time filter is active, hide rows that don't fit. While
  // the times are still loading (null) we also hide so the list can't
  // optimistically show a row that'll later disappear — which is what
  // caused the bottom-of-page glitch on earlier iterations.
  if (walkMinCap != null) {
    if (walkMin == null) return null;
    if (walkMin > walkMinCap) return null;
  }
  if (driveMinCap != null) {
    if (driveMin == null) return null;
    if (driveMin > driveMinCap) return null;
  }

  const priceLabel = priceLevelToString(place.priceLevel);
  const cuisine = inferCuisineLabel(place.types);

  const friendLabel = friendCount > 1
    ? `${friendCount} friends rated`
    : 'Friend rated';
  const expertLabel = expertCount > 1
    ? `${expertCount} experts rated`
    : 'Expert pick';

  return (
    <li>
      <Link
        to={`/restaurant/${place.id}`}
        className="block py-4 px-1 list-row-hover rounded-lg"
      >
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="font-serif text-[16px] sm:text-[17px] font-bold text-on-surface leading-snug line-clamp-2">
              {place.name}
            </h3>

            <p className="mt-1 text-[11px] sm:text-xs text-on-surface/55 font-medium uppercase tracking-wider truncate">
              {cuisine || 'Restaurant'}
              {priceLabel && <span className="text-on-surface/25 mx-1.5">·</span>}
              {priceLabel}
            </p>

            {/* Travel context — distance + drive + walk. Each pill only renders
                if we've got a value for it, so the row collapses gracefully
                when travel times aren't yet resolved (or aren't available). */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-on-surface/65">
              {distanceLabel && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={12} className="text-on-surface/40" />
                  {distanceLabel}
                </span>
              )}
              {driveLabel && (
                <span className="inline-flex items-center gap-1">
                  <Car size={12} className="text-on-surface/40" />
                  {driveLabel}
                </span>
              )}
              {walkLabel && (
                <span className="inline-flex items-center gap-1">
                  <Footprints size={12} className="text-on-surface/40" />
                  {walkLabel}
                </span>
              )}
            </div>

            {/* Friend / expert signal pills — mutually non-exclusive. Counts
                upgrade the label to "N friends rated" / "N experts rated"
                so the row visibly weights stronger circle signal. */}
            {(friendCount > 0 || expertCount > 0) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {friendCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider">
                    <Users size={10} />
                    {friendLabel}
                  </span>
                )}
                {expertCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary/15 text-secondary text-[10px] font-bold uppercase tracking-wider">
                    <UserCheck size={10} />
                    {expertLabel}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Right-aligned score pill. Hidden when Google hasn't supplied a
              usable rating, rather than surfacing a misleading 0.0. */}
          {place.rating > 0 && (
            <div
              className={cn(
                'mt-0.5 w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold tabular-nums flex-shrink-0',
                scoreBg(place.rating * 2), // Google is 0–5; app score scale is 0–10
              )}
            >
              {(place.rating * 2).toFixed(1)}
            </div>
          )}
        </div>
      </Link>
    </li>
  );
};

/* ── Filter chip ─────────────────────────────────────────────────────────────
   Dismissible pill shown above the list when a filter is active. The click
   target is the whole chip so tiny-finger targets still reach the X. */
const FilterChip: React.FC<{ label: string; onClear: () => void }> = ({ label, onClear }) => (
  <button
    type="button"
    onClick={onClear}
    className="inline-flex items-center gap-1 pl-2.5 pr-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold"
  >
    {label}
    <X size={12} className="opacity-70" />
  </button>
);

/* ── Filter sheet ────────────────────────────────────────────────────────────
   Bottom sheet with sort / price / cuisine controls. Stays unmounted while
   closed so the cuisine grid (80+ chips) doesn't cost render time on every
   keystroke. Visual language matches the existing sort/price/cuisine sheet
   on the Home page so users don't relearn anything. */
interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  sortBy: SortOption;
  onSortChange: (s: SortOption) => void;
  selectedPrice: number;
  onPriceChange: (p: number) => void;
  selectedCuisines: string[];
  onCuisinesChange: (next: string[]) => void;
  selectedRadius: number;
  onRadiusChange: (mi: number) => void;
  friendsOnly: boolean;
  onFriendsOnlyChange: (v: boolean) => void;
  expertsOnly: boolean;
  onExpertsOnlyChange: (v: boolean) => void;
  /** Walk / drive time filters are only meaningful when the user has a
   *  routable origin (a precise street address saved as their home).
   *  When false the sheet hides those sections entirely. */
  canFilterByTravelTime: boolean;
  /** First segment of the home label (e.g. "221 Main St") for the
   *  section blurb. Null when no exact home is set. */
  homeLabel: string | null;
  selectedWalkMin: number;
  onWalkMinChange: (n: number) => void;
  selectedDriveMin: number;
  onDriveMinChange: (n: number) => void;
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'rating', label: 'Highest Rated' },
  { value: 'popularity', label: 'Most Popular' },
  { value: 'distance', label: 'Closest First' },
];

const PRICE_LEVELS: { value: number; label: string }[] = [
  { value: 0, label: 'Any' },
  { value: 1, label: '$' },
  { value: 2, label: '$$' },
  { value: 3, label: '$$$' },
  { value: 4, label: '$$$$' },
];

// Radius options in miles. 0 means "Any" (no distance cap). The non-zero
// values mirror the Home feed's recommendation radius picker so the
// user's mental model is consistent across surfaces.
const RADIUS_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Any' },
  { value: 1, label: '1 mi' },
  { value: 3, label: '3 mi' },
  { value: 5, label: '5 mi' },
  { value: 10, label: '10 mi' },
  { value: 25, label: '25 mi' },
];

// Walk time caps. 0 = Any. Values tuned for the pedestrian scale —
// almost no one plans a 60+ minute walk, so we stop there.
const WALK_MIN_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Any' },
  { value: 10, label: '10 min' },
  { value: 20, label: '20 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 h' },
];

// Drive time caps. 0 = Any.
const DRIVE_MIN_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Any' },
  { value: 10, label: '10 min' },
  { value: 20, label: '20 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 h' },
];

const FilterSheet: React.FC<FilterSheetProps> = ({
  open,
  onClose,
  sortBy,
  onSortChange,
  selectedPrice,
  onPriceChange,
  selectedCuisines,
  onCuisinesChange,
  selectedRadius,
  onRadiusChange,
  friendsOnly,
  onFriendsOnlyChange,
  expertsOnly,
  onExpertsOnlyChange,
  canFilterByTravelTime,
  homeLabel,
  selectedWalkMin,
  onWalkMinChange,
  selectedDriveMin,
  onDriveMinChange,
}) => {
  const toggleCuisine = (type: string) => {
    onCuisinesChange(
      selectedCuisines.includes(type)
        ? selectedCuisines.filter((t) => t !== type)
        : [...selectedCuisines, type],
    );
  };
  const reset = () => {
    onSortChange('recommended');
    onPriceChange(0);
    onCuisinesChange([]);
    onRadiusChange(0);
    onFriendsOnlyChange(false);
    onExpertsOnlyChange(false);
    onWalkMinChange(0);
    onDriveMinChange(0);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
          >
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-on-surface/15" />
            </div>
            <div className="flex items-center justify-between px-5 pt-1 pb-3 border-b border-on-surface/6 flex-shrink-0">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface/60">
                Filters
              </h3>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center hover:bg-on-surface/10 transition-colors"
                aria-label="Close"
              >
                <X size={16} className="text-on-surface/60" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface/60 mb-3">Sort by</h4>
                <div className="grid grid-cols-2 gap-2">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => onSortChange(opt.value)}
                      className={cn(
                        'flex items-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all text-left',
                        sortBy === opt.value
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-on-surface/10 text-on-surface/60 hover:border-on-surface/20',
                      )}
                    >
                      {sortBy === opt.value && <Check size={14} />}
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface/60 mb-3">Price</h4>
                <div className="flex gap-2">
                  {PRICE_LEVELS.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => onPriceChange(p.value)}
                      className={cn(
                        'flex-1 py-3 rounded-xl border-2 text-sm font-bold transition-all',
                        selectedPrice === p.value
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-on-surface/10 text-on-surface/60 hover:border-on-surface/20',
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface/60 mb-3">
                  Distance
                </h4>
                <p className="text-[11px] text-on-surface/45 -mt-2 mb-2.5">
                  From the city centre.
                </p>
                <div className="flex flex-wrap gap-2">
                  {RADIUS_OPTIONS.map((r) => (
                    <button
                      key={r.value}
                      onClick={() => onRadiusChange(r.value)}
                      className={cn(
                        'px-4 py-2 rounded-full border-2 text-xs font-bold uppercase tracking-wider transition-all',
                        selectedRadius === r.value
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-on-surface/10 text-on-surface/50 hover:border-on-surface/20',
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Walk / drive time caps — hidden entirely when the user's
                  home isn't a precise address, since there's no routable
                  origin for Mapbox Directions to measure from. */}
              {canFilterByTravelTime && (
                <>
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Footprints size={14} className="text-on-surface/60" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface/60">Walk time</h4>
                    </div>
                    <p className="text-[11px] text-on-surface/45 -mt-2 mb-2.5">
                      From {homeLabel || 'your address'}.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {WALK_MIN_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          onClick={() => onWalkMinChange(o.value)}
                          className={cn(
                            'px-4 py-2 rounded-full border-2 text-xs font-bold uppercase tracking-wider transition-all',
                            selectedWalkMin === o.value
                              ? 'border-primary bg-primary/5 text-primary'
                              : 'border-on-surface/10 text-on-surface/50 hover:border-on-surface/20',
                          )}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Car size={14} className="text-on-surface/60" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface/60">Drive time</h4>
                    </div>
                    <p className="text-[11px] text-on-surface/45 -mt-2 mb-2.5">
                      From {homeLabel || 'your address'}.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {DRIVE_MIN_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          onClick={() => onDriveMinChange(o.value)}
                          className={cn(
                            'px-4 py-2 rounded-full border-2 text-xs font-bold uppercase tracking-wider transition-all',
                            selectedDriveMin === o.value
                              ? 'border-primary bg-primary/5 text-primary'
                              : 'border-on-surface/10 text-on-surface/50 hover:border-on-surface/20',
                          )}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface/60 mb-3">
                  From your circle
                </h4>
                <p className="text-[11px] text-on-surface/45 -mt-2 mb-2.5">
                  Show only places with ratings from people you trust.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onFriendsOnlyChange(!friendsOnly)}
                    className={cn(
                      'flex items-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all text-left',
                      friendsOnly
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-on-surface/10 text-on-surface/60 hover:border-on-surface/20',
                    )}
                  >
                    <Users size={15} className={friendsOnly ? 'text-primary' : 'text-on-surface/50'} />
                    Friends only
                  </button>
                  <button
                    onClick={() => onExpertsOnlyChange(!expertsOnly)}
                    className={cn(
                      'flex items-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all text-left',
                      expertsOnly
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-on-surface/10 text-on-surface/60 hover:border-on-surface/20',
                    )}
                  >
                    <UserCheck size={15} className={expertsOnly ? 'text-primary' : 'text-on-surface/50'} />
                    Experts only
                  </button>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface/60 mb-3">Cuisine</h4>
                <div className="flex flex-wrap gap-2">
                  {CUISINE_TYPES.filter((c) => c.type).map((c) => {
                    const isActive = selectedCuisines.includes(c.type);
                    return (
                      <button
                        key={c.type}
                        onClick={() => toggleCuisine(c.type)}
                        className={cn(
                          'px-3 py-1.5 rounded-full border-2 text-xs font-bold uppercase tracking-wider transition-all',
                          isActive
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-on-surface/10 text-on-surface/50 hover:border-on-surface/20',
                        )}
                      >
                        {isActive && <Check size={11} className="inline mr-1 -mt-0.5" />}
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex-shrink-0 bg-surface border-t border-black/5 px-5 py-4 flex gap-3">
              <button
                onClick={reset}
                className="flex-1 py-3 rounded-2xl border-2 border-on-surface/10 text-sm font-semibold text-on-surface/60 hover:bg-muted transition-colors"
              >
                Reset
              </button>
              <button
                onClick={onClose}
                className="flex-[2] py-3 rounded-2xl bg-primary text-white text-sm font-semibold shadow-lg shadow-primary/25 hover:shadow-xl transition-shadow"
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
