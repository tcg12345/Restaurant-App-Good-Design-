import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Car,
  Check,
  Crown,
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
import { useSettings } from '../contexts/SettingsContext';
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
  followPublicAccount,
  getAllFriendRatings,
  getExpertProfiles,
  getExpertRatings,
  getFollowedExpertIds,
  getProfilesInArea,
  getRatingsByUserIds,
  sendFriendRequest,
  type CommunityRating,
  type UserProfile,
} from '../lib/supabase-community';
import { supabase, supabaseConfigured } from '../lib/supabase';
// Per-city cache (places + paginated cursors) lives in
// `lib/location-place-cache` so the map view at /location/map can read the
// same hot pool the list view just populated.
import {
  cityCacheKey,
  cuisinesKeyOf,
  readCachedCity,
  writeCachedCity,
  type QueryCursor,
} from '../lib/location-place-cache';
import { haversineDistanceMi, formatDistance } from '../lib/distance';
import { formatTravelTime, useTravelTimes } from '../lib/directions';
import {
  HomeLocationBar,
  isExactAddress,
  loadLastSelectedLocation,
  reverseGeocode,
  type HomeLocation,
} from '../components/HomeLocationBar';

/* ── Placeholder guides ──────────────────────────────────────────────────────
   Same visual language as the Home page's horizontal guide scroller. Titles
   are templated with the selected city so the row doesn't read like
   someone else's trip — "A Pasta Crawl Through Westport" feels local even
   while the guide feature itself is still static content. Photos are
   generic enough to work anywhere.

   `{city}` is replaced with the short city name (e.g. "Westport",
   "New York") and `{CITY}` with its uppercase form for headlines.
   ──────────────────────────────────────────────────────────────────── */
type Guide = {
  id: string;
  title: string;
  author: string;
  image: string;
  count: number;
};

const GUIDE_TEMPLATES: Array<{
  id: string;
  titleTemplate: string;
  author: string;
  image: string;
  count: number;
}> = [
  {
    id: 'g-local-pasta',
    titleTemplate: 'A Pasta Crawl Through {city}',
    author: 'Jamie Lin',
    image: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&q=80&w=800',
    count: 9,
  },
  {
    id: 'g-local-date-night',
    titleTemplate: 'Where {city} Locals Take a Date',
    author: 'Camille Durand',
    image: 'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&q=80&w=800',
    count: 12,
  },
  {
    id: 'g-local-hidden-gems',
    titleTemplate: 'Hidden Gems in {city}',
    author: 'Marco Rossi',
    image: 'https://images.unsplash.com/photo-1526318896980-cf78c088247c?auto=format&fit=crop&q=80&w=800',
    count: 8,
  },
  {
    id: 'g-local-brunch',
    titleTemplate: 'A Proper Brunch Itinerary in {city}',
    author: 'Aiko Tanaka',
    image: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&q=80&w=800',
    count: 7,
  },
  {
    id: 'g-local-fine-dining',
    titleTemplate: 'Tasting-Menu Temples Near {city}',
    author: 'Diego Ramirez',
    image: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&q=80&w=800',
    count: 10,
  },
];

function buildLocationGuides(shortCity: string): Guide[] {
  const city = shortCity.trim() || 'your area';
  return GUIDE_TEMPLATES.map(({ titleTemplate, ...rest }) => ({
    ...rest,
    title: titleTemplate.replace(/\{city\}/g, city),
  }));
}

/* ── Filler suggestions ──────────────────────────────────────────────────────
   When the user_profiles table has no experts / non-expert candidates with
   a home_city in the explored area (which is the default state until people
   start filling in that field), the "Around {city}" row would render only
   restaurant cards. These templates fill the row with placeholder
   expert + friend cards keyed off the city name so the UX still shows the
   full mixed-card concept.

   The filler user_ids are namespaced ("filler-expert-…", "filler-friend-…")
   so the follow / add-friend handlers can skip the real API call and stay
   purely optimistic. Tapping the card navigates to /user/{username}, which
   will land on the standard profile page's "couldn't find this user"
   state — also acceptable until real data backfills.
   ──────────────────────────────────────────────────────────────────── */
const FILLER_EXPERT_TEMPLATES = [
  { username: 'jamielin', display_name: 'Jamie Lin', bio: 'Food writer covering {city}.' },
  { username: 'marcorossi', display_name: 'Marco Rossi', bio: 'Italian-trained chef, {city} regular.' },
  { username: 'aikotanaka', display_name: 'Aiko Tanaka', bio: 'Brunch + sushi obsessive in {city}.' },
];

const FILLER_FRIEND_TEMPLATES = [
  { username: 'camille_d', display_name: 'Camille Durand' },
  { username: 'diegoramirez', display_name: 'Diego Ramirez' },
  { username: 'samhughes', display_name: 'Sam Hughes' },
];

function isFillerProfile(profile: UserProfile): boolean {
  return profile.user_id.startsWith('filler-');
}

function buildFillerExperts(shortCity: string): UserProfile[] {
  const city = shortCity.trim() || 'the area';
  return FILLER_EXPERT_TEMPLATES.map((t, i) => ({
    user_id: `filler-expert-${i}`,
    display_name: t.display_name,
    username: t.username,
    bio: t.bio.replace(/\{city\}/g, city),
    is_public: true,
    is_expert: true,
    home_city: city,
  }));
}

function buildFillerFriends(shortCity: string): UserProfile[] {
  const city = shortCity.trim() || 'the area';
  return FILLER_FRIEND_TEMPLATES.map((t, i) => ({
    user_id: `filler-friend-${i}`,
    display_name: t.display_name,
    username: t.username,
    bio: '',
    is_public: true,
    is_expert: false,
    home_city: city,
  }));
}

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
   every reasonable angle on the area. We mix three flavours:

     - CITY_SEEDS ("best restaurants in {city}") lift Westport-labelled
       places to the top when Westport is the selected location.
     - AREA_SEEDS ("best restaurants near me") — identical phrasing without
       the city token, so Google's rankers use ONLY the bbox restriction
       to pick results. That's what lets nearby-town places (Norwalk,
       Fairfield, Weston) surface alongside Westport's own listings.
     - Cuisine variants per the user's taste profile, in both city-biased
       and area-only forms.
   ──────────────────────────────────────────────────────────────────────── */
const CITY_SEEDS: string[] = [
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

const AREA_SEEDS: string[] = [
  'best restaurants',
  'popular restaurants',
  'top rated restaurants',
  'highly rated restaurants',
  'fine dining',
  'hidden gem restaurants',
  'brunch restaurants',
  'takeout restaurants',
  'family restaurants',
  'upscale restaurants',
];

function buildQueryPool(cityKey: string, topCuisines: string[]): string[] {
  const city = cityKey || '';
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (q: string) => {
    const key = q.toLowerCase().trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(q);
  };
  // Interleave personalised cuisine picks (both city-biased and area-only),
  // city-seeded generics, and area-seeded generics. The three flavours
  // surface different slices of the same bbox so dedup has a lot less
  // overlap to chew through — more unique places reach the list per page.
  const cityCuisine = city
    ? topCuisines.flatMap((c) => [
        `best ${c} restaurants in ${city}`,
        `top rated ${c} restaurants in ${city}`,
      ])
    : [];
  const areaCuisine = topCuisines.flatMap((c) => [
    `best ${c} restaurants`,
    `${c} restaurants`,
  ]);
  const citySeeds = city ? CITY_SEEDS.map((s) => s.replace('{city}', city)) : [];
  const areaSeeds = AREA_SEEDS;
  const longest = Math.max(
    cityCuisine.length,
    areaCuisine.length,
    citySeeds.length,
    areaSeeds.length,
  );
  for (let i = 0; i < longest; i++) {
    if (cityCuisine[i]) push(cityCuisine[i]);
    if (areaCuisine[i]) push(areaCuisine[i]);
    if (citySeeds[i]) push(citySeeds[i]);
    if (areaSeeds[i]) push(areaSeeds[i]);
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

/* Discriminated union for the "Around {city}" suggestion row. The three
   shapes don't share much beyond "render in a horizontal scroller", so
   we keep them as a tagged union and dispatch in the renderer. */
type SuggestionCard =
  | { kind: 'expert'; profile: UserProfile }
  | { kind: 'friend'; profile: UserProfile }
  | { kind: 'restaurant'; place: ScoredPlace };

type SortOption = 'recommended' | 'rating' | 'popularity' | 'distance';

const SORT_LABELS: Record<SortOption, string> = {
  recommended: 'Recommended',
  rating: 'Highest Rated',
  popularity: 'Most Popular',
  distance: 'Closest First',
};

const INITIAL_BATCH_SIZE = 4;  // queries pulled in parallel on first load
const LOAD_MORE_BATCH_SIZE = 3; // queries pulled per infinite-scroll page

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

  // Short city name for guide card titles. "Westport, CT" → "Westport",
  // "New York, NY" → "New York". Falls back to the display value if
  // there's no comma. Kept separate from cityKey because cityKey is
  // lowercased / used for cache identifiers, and we want the original
  // casing in user-facing copy.
  const shortCityName = useMemo(() => {
    const first = cityDisplay.split(',')[0]?.trim();
    return first || cityDisplay;
  }, [cityDisplay]);

  const locationGuides = useMemo(
    () => buildLocationGuides(shortCityName),
    [shortCityName],
  );

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

  // People in this area, surfaced as the "Around {city}" suggestions row.
  // Both lists query user_profiles by home_lat/lng bounding box; profiles
  // without a declared home base don't appear, which is by design — we
  // can't say someone is "in this area" without that signal.
  const [areaExperts, setAreaExperts] = useState<UserProfile[]>([]);
  const [areaFriendCandidates, setAreaFriendCandidates] = useState<UserProfile[]>([]);
  // Optimistic "just followed / just requested" set so the suggestion
  // card buttons flip to their done state instantly, before the server
  // round-trip resolves.
  const [followedSuggestions, setFollowedSuggestions] = useState<Set<string>>(new Set());
  const [requestedFriendIds, setRequestedFriendIds] = useState<Set<string>>(new Set());

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

  // Pull experts + non-expert profiles whose declared home base sits in
  // this city's bounding box. Powers the "Around {city}" suggestions row
  // between Guides and the restaurant list. The bbox spans roughly
  // ±8 mi (degrees scaled by the cosine of latitude so it stays square
  // at higher latitudes); profiles without home_lat are not in the
  // index range and never returned, which is the desired behaviour —
  // we don't want to claim someone is "in this area" without a signal.
  useEffect(() => {
    if (!hasCoords) {
      setAreaExperts([]);
      setAreaFriendCandidates([]);
      return;
    }
    let cancelled = false;
    const dLat = 8 / 69; // ~8 mi → degrees of latitude
    const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
    const dLng = (8 / 69) / cosLat;
    const bbox = {
      latLow: lat - dLat,
      latHigh: lat + dLat,
      lngLow: lng - dLng,
      lngHigh: lng + dLng,
    };
    const exclude = userId ? [userId] : [];
    (async () => {
      const [experts, candidates] = await Promise.all([
        getProfilesInArea({ bbox, expertsOnly: true, excludeUserIds: exclude, limit: 8 }),
        getProfilesInArea({ bbox, expertsOnly: false, excludeUserIds: exclude, limit: 8 }),
      ]);
      if (cancelled) return;
      setAreaExperts(experts);
      // Drop experts from the friend-candidate list so a single profile
      // doesn't render twice in the same row.
      setAreaFriendCandidates(candidates.filter((p) => !p.is_expert));
    })();
    return () => { cancelled = true; };
  }, [hasCoords, lat, lng, userId]);

  // Reset optimistic-follow sets when the location changes — the cards
  // about to render will be a different set of people, and the previous
  // pending state shouldn't leak across cities.
  useEffect(() => {
    setFollowedSuggestions(new Set());
    setRequestedFriendIds(new Set());
  }, [lat, lng]);

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

  // 8 mi default fetch radius — tuned to match what "nearby" feels like
  // from the selected location. Using a looser 20 km bbox had results
  // leaking in from corners as much as 15 mi out, which users on a small
  // town like Westport reported as "very far away". The rectangle we
  // send to Google still circumscribes this circle, but the post-filter
  // below clamps back to a strict 8-mile circle so corner leakage can't
  // surface.
  const radiusMeters = 12875; // ≈ 8 mi
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
        // Strict circular post-filter. Google's rectangle wraps the
        // circle, so a place in a bbox corner can sit up to √2 × radius
        // from the centre — about 11 mi when radius is 8 mi. Without
        // this cutoff those corner results felt "very far away".
        if (
          haversineKm({ lat: p.lat, lng: p.lng }, { lat, lng }) > radiusKm
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
    // Keep paging up to a few times per scroll event until we actually
    // add new unique places. Without this, a batch that happens to
    // return only duplicates (very common once a few queries overlap)
    // leaves the user at the bottom with nothing new to look at — and
    // the IntersectionObserver won't re-fire unless they scroll more.
    // Bounded at 3 attempts so a genuinely-exhausted pool doesn't
    // burn API calls in a tight loop.
    let collected: PlaceResult[] = [];
    for (let attempts = 0; attempts < 3 && collected.length === 0; attempts++) {
      const fresh = await fetchBatch(LOAD_MORE_BATCH_SIZE);
      if (fresh.length > 0) {
        collected = fresh;
        break;
      }
      if (cursorsRef.current.every((c) => c.drained)) break;
    }
    if (collected.length > 0) {
      setPlacesPool((prev) => {
        const merged = [...prev];
        for (const p of collected) merged.push(p);
        return merged;
      });
    }
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
      // Same strict circular cutoff fetchBatch uses so augmented
      // pseudo-places can't leak past the radius.
      if (
        haversineKm({ lat: row.lat, lng: row.lng }, { lat, lng }) > radiusKm
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

  // Mixed expert / friend / restaurant cards for the "Around {city}" row.
  // We interleave the three types so the row alternates kinds and the
  // user always sees a bit of everything before scrolling — instead of
  // grouping (which would put all experts first, all friends second, etc.).
  // Capped at 12 cards total so the row stays scannable on phones.
  //
  // Filler profiles fill in for either column when nobody real has
  // declared a home base in this area yet — that's the default state
  // until users start opting into home_city, and without fillers the
  // row would degrade to "all restaurants, every city". The follow /
  // friend handlers below detect filler ids and skip the API call.
  const suggestionCards = useMemo<SuggestionCard[]>(() => {
    if (!hasCoords) return [];
    const experts = areaExperts.length > 0 ? areaExperts : buildFillerExperts(shortCityName);
    const friends = areaFriendCandidates.length > 0 ? areaFriendCandidates : buildFillerFriends(shortCityName);
    const featuredRestaurants = ranked.slice(0, 6);
    const cards: SuggestionCard[] = [];
    const longest = Math.max(experts.length, friends.length, featuredRestaurants.length);
    for (let i = 0; i < longest && cards.length < 12; i++) {
      if (experts[i]) cards.push({ kind: 'expert', profile: experts[i] });
      if (friends[i]) cards.push({ kind: 'friend', profile: friends[i] });
      if (featuredRestaurants[i]) cards.push({ kind: 'restaurant', place: featuredRestaurants[i] });
    }
    return cards.slice(0, 12);
  }, [hasCoords, areaExperts, areaFriendCandidates, ranked, shortCityName]);

  const handleFollowExpert = useCallback(
    async (targetId: string) => {
      // Always flip the local set so the button's "Following" state is
      // visible even for filler profiles or anonymous users — the row is
      // a demo surface as much as a functional one.
      setFollowedSuggestions((prev) => {
        const next = new Set(prev);
        next.add(targetId);
        return next;
      });
      // Filler profiles have synthetic ids that aren't in user_profiles,
      // so the follow API would just error. Skip the call entirely.
      if (!userId || targetId.startsWith('filler-')) return;
      const ok = await followPublicAccount(userId, targetId);
      if (!ok) {
        // Roll back the optimistic update so the button doesn't lie about
        // the follow having succeeded.
        setFollowedSuggestions((prev) => {
          const next = new Set(prev);
          next.delete(targetId);
          return next;
        });
      }
    },
    [userId],
  );

  const handleAddFriend = useCallback(
    async (targetId: string) => {
      setRequestedFriendIds((prev) => {
        const next = new Set(prev);
        next.add(targetId);
        return next;
      });
      if (!userId || targetId.startsWith('filler-')) return;
      const ok = await sendFriendRequest(userId, targetId);
      if (!ok) {
        setRequestedFriendIds((prev) => {
          const next = new Set(prev);
          next.delete(targetId);
          return next;
        });
      }
    },
    [userId],
  );

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
      <div className="sticky top-0 z-20 bg-surface px-4 pt-safe-4 pb-2">
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
            onClick={() => {
              if (!hasCoords) return;
              navigate(
                `/location/map?label=${encodeURIComponent(cityDisplay)}&lat=${lat}&lng=${lng}`,
              );
            }}
            disabled={!hasCoords}
            className="w-10 h-10 -mr-2 flex items-center justify-center rounded-full text-on-surface/70 hover:text-on-surface hover:bg-on-surface/[0.04] transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
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
          {locationGuides.map((g) => (
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

      {/* Around {city} — mixed expert / friend / restaurant suggestions.
          Sits between the Guides row and the main restaurant list so the
          user gets a sense of "who and what's around here" before diving
          into the long list. The row hides itself when there's nothing
          to show (no profiles in the area + ranked still empty), so a
          fresh / unindexed location doesn't render a dead section. */}
      {suggestionCards.length > 0 && (
        <section className="mt-6">
          <div className="px-4 flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-primary/70" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-on-surface/60">
                Around {shortCityName}
              </h2>
            </div>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 px-4 scrollbar-hide snap-x snap-mandatory">
            {suggestionCards.map((card, idx) => (
              <SuggestionCardView
                key={
                  card.kind === 'restaurant'
                    ? `r-${card.place.id}`
                    : `${card.kind}-${card.profile.user_id}-${idx}`
                }
                card={card}
                followed={
                  card.kind === 'expert'
                  && (signals.followedExpertIds.has(card.profile.user_id)
                    || followedSuggestions.has(card.profile.user_id))
                }
                requested={
                  card.kind === 'friend' && requestedFriendIds.has(card.profile.user_id)
                }
                onFollow={handleFollowExpert}
                onAddFriend={handleAddFriend}
              />
            ))}
          </div>
        </section>
      )}

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

/* ── Suggestion card ─────────────────────────────────────────────────────────
   The "Around {city}" row renders three card kinds — expert, friend
   suggestion, restaurant — through this single component. They share
   roughly the same footprint (260 × 320-ish) so the row stays visually
   uniform while the content + CTA differ.

   Expert / friend cards generate a colored gradient surface keyed off
   the first letter of the name (no avatars yet) — same trick the Circle
   page uses, so the visual language is consistent.

   Restaurant cards link straight to the detail page, no inline CTA. */
interface SuggestionCardViewProps {
  card: SuggestionCard;
  followed: boolean;
  requested: boolean;
  onFollow: (userId: string) => void;
  onAddFriend: (userId: string) => void;
}

const SuggestionCardView: React.FC<SuggestionCardViewProps> = ({
  card,
  followed,
  requested,
  onFollow,
  onAddFriend,
}) => {
  if (card.kind === 'restaurant') {
    const place = card.place;
    const cuisine = inferCuisineLabel(place.types);
    const priceLabel = priceLevelToString(place.priceLevel);
    return (
      <Link
        to={`/restaurant/${place.id}`}
        className="flex-shrink-0 snap-start group block w-56"
      >
        <div className="relative aspect-square rounded-2xl overflow-hidden bg-gradient-to-br from-primary/15 to-amber-100/40 flex items-center justify-center">
          <span className="font-serif text-6xl font-bold text-primary/30">
            {place.name.charAt(0).toUpperCase()}
          </span>
          {place.rating > 0 && (
            <div
              className={cn(
                'absolute top-3 right-3 w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold tabular-nums shadow-md',
                scoreBg(place.rating * 2),
              )}
            >
              {(place.rating * 2).toFixed(1)}
            </div>
          )}
          <div className="absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/90 backdrop-blur-sm text-[9px] font-bold uppercase tracking-wider text-primary">
            <Sparkles size={9} />
            Pick
          </div>
        </div>
        <div className="px-1 pt-2.5">
          <h3 className="font-serif text-[15px] font-bold text-on-surface leading-snug line-clamp-2">
            {place.name}
          </h3>
          <p className="mt-1 text-[11px] text-on-surface/55 font-medium uppercase tracking-wider truncate">
            {cuisine || 'Restaurant'}
            {priceLabel && <span className="text-on-surface/25 mx-1.5">·</span>}
            {priceLabel}
          </p>
        </div>
      </Link>
    );
  }

  const profile = card.profile;
  const isExpert = card.kind === 'expert';
  const cityShort = profile.home_city ? profile.home_city.split(',')[0].trim() : '';
  // Filler profiles aren't real users, so navigating to /user/{username}
  // would land on a 404. Render the avatar surface as a static div for
  // fillers so the card still looks the same but the tap is a no-op.
  const filler = isFillerProfile(profile);
  const AvatarSurface: React.ElementType = filler ? 'div' : Link;
  const avatarProps = filler ? {} : { to: `/user/${profile.username}` };
  return (
    <div className="flex-shrink-0 snap-start w-56">
      <AvatarSurface
        {...avatarProps}
        className="block relative aspect-square rounded-2xl overflow-hidden group"
      >
        <div className={cn(
          'h-full w-full flex items-center justify-center',
          isExpert
            ? 'bg-gradient-to-br from-amber-100 to-primary/10'
            : 'bg-gradient-to-br from-secondary/20 to-secondary/5',
        )}>
          <span className={cn(
            'text-6xl font-serif font-bold',
            isExpert ? 'text-primary/30' : 'text-secondary/45',
          )}>
            {(profile.display_name || profile.username || '?').charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
        <div className="absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/90 backdrop-blur-sm text-[9px] font-bold uppercase tracking-wider">
          {isExpert ? (
            <>
              <Crown size={9} className="text-amber-500" />
              <span className="text-primary">Expert</span>
            </>
          ) : (
            <>
              <Users size={9} className="text-secondary" />
              <span className="text-secondary">Suggested</span>
            </>
          )}
        </div>
        <div className="absolute inset-x-3 bottom-3 text-white">
          <h3 className="font-serif text-base font-bold leading-tight truncate">
            {profile.display_name || profile.username}
          </h3>
          <p className="text-[10px] text-white/75 truncate mt-0.5">@{profile.username}</p>
          {cityShort && (
            <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-white/80">
              <MapPin size={9} className="text-white/60" />
              {cityShort}
            </p>
          )}
        </div>
      </AvatarSurface>
      {isExpert ? (
        followed ? (
          <div className="mt-2 h-9 flex items-center justify-center gap-1.5 bg-on-surface/[0.06] rounded-full">
            <Check size={13} className="text-on-surface/45" />
            <span className="text-[11px] font-bold text-on-surface/55">Following</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onFollow(profile.user_id)}
            className="mt-2 w-full h-9 bg-primary/10 text-primary text-[11px] font-bold rounded-full hover:bg-primary/15 active:bg-primary/20 transition-colors"
          >
            Follow
          </button>
        )
      ) : requested ? (
        <div className="mt-2 h-9 flex items-center justify-center gap-1.5 bg-on-surface/[0.06] rounded-full">
          <Check size={13} className="text-on-surface/45" />
          <span className="text-[11px] font-bold text-on-surface/55">Requested</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onAddFriend(profile.user_id)}
          className="mt-2 w-full h-9 bg-secondary/10 text-secondary text-[11px] font-bold rounded-full hover:bg-secondary/15 active:bg-secondary/20 transition-colors"
        >
          Add Friend
        </button>
      )}
    </div>
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
  const { phoneMode } = useSettings();
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
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: phoneMode ? 0.18 : 0.16 }}
          className={cn(
            'fixed inset-0 z-50',
            phoneMode ? 'bg-black/30 backdrop-blur-sm' : 'bg-black/50 backdrop-blur-md',
            !phoneMode && 'flex items-start justify-center pt-[10vh] px-4',
          )}
          onClick={onClose}
        >
          <motion.div
            {...(phoneMode
              ? {
                  initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' },
                  transition: { type: 'spring' as const, damping: 28, stiffness: 300 },
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
                ? 'fixed bottom-0 left-0 right-0 rounded-t-3xl max-h-[85vh] shadow-2xl'
                : 'w-full max-w-2xl rounded-[28px] max-h-[80vh] shadow-[0_30px_80px_-16px_rgba(0,0,0,0.42)] ring-1 ring-on-surface/[0.06]',
            )}
          >
            {phoneMode && (
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                <div className="w-10 h-1 rounded-full bg-on-surface/15" />
              </div>
            )}
            <div className={cn(
              'flex items-center justify-between flex-shrink-0',
              phoneMode ? 'px-5 pt-1 pb-3 border-b border-on-surface/[0.06]' : 'px-6 pt-5 pb-4',
            )}>
              <h3 className={cn(
                phoneMode
                  ? 'text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface/60'
                  : 'font-serif font-bold text-[20px]',
              )}>
                Filters
              </h3>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-on-surface/[0.05] flex items-center justify-center hover:bg-on-surface/[0.10] transition-colors"
                aria-label="Close"
              >
                <X size={16} className="text-on-surface/60" />
              </button>
            </div>
            {!phoneMode && <div className="border-t border-on-surface/[0.06]" />}

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
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface/60">
                    Distance
                  </h4>
                  <span className="text-xs font-bold tabular-nums text-primary">
                    {selectedRadius === 0 ? 'Any' : `Within ${selectedRadius} mi`}
                  </span>
                </div>
                <p className="text-[11px] text-on-surface/45 mb-2.5">
                  From the city centre. Drag to the far left for no limit.
                </p>
                <input
                  type="range"
                  min={0}
                  max={25}
                  step={1}
                  value={selectedRadius}
                  onChange={(e) => onRadiusChange(Number(e.target.value))}
                  aria-label="Maximum distance from city centre in miles"
                  className="accent-primary w-full h-2"
                />
                <div className="mt-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-on-surface/40">
                  <span>Any</span>
                  <span>25 mi</span>
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
