import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
// @ts-ignore - Vite worker import for mapbox-gl CSP compatibility
import MapboxWorker from 'mapbox-gl/dist/mapbox-gl-csp-worker?worker';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MAPBOX_TOKEN } from './useRestaurantDetail';
import {
  ArrowLeft,
  BookOpen,
  Car,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crown,
  Footprints,
  LayoutGrid,
  Loader2,
  Map as MapIcon,
  MapPin,
  Maximize2,
  Minimize2,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Soup,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import './LocationPage.css';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useLists, type RestaurantMeta } from '../contexts/ListsContext';
import { useRecipes } from '../contexts/RecipesContext';
import { useSettings } from '../contexts/SettingsContext';
import {
  searchPlacesByTextPaged,
  priceLevelToString,
  CUISINE_TYPES,
  formatLocationLabel,
  fetchLocationDataForPlace,
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
  getProfilesByIds,
  searchUsersByUsername,
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
import { useBottomSheet } from '../lib/useBottomSheet';
import {
  HomeLocationBar,
  isExactAddress,
  loadLastSelectedLocation,
  getCurrentHomeLocation,
  geocodePlace,
  type HomeLocation,
} from '../components/HomeLocationBar';
import { useSetAssistantPageContext } from '../contexts/AssistantContext';

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
  'best breakfast in {city}',
  'best brunch in {city}',
  'hidden gem restaurants in {city}',
  'neighborhood restaurants in {city}',
  'local favorites restaurants in {city}',
  'fine dining {city}',
  'casual dining {city}',
  'date night restaurants in {city}',
  'romantic restaurants in {city}',
  'cheap eats {city}',
  'michelin restaurants {city}',
  'rooftop restaurants {city}',
  'cozy restaurants {city}',
  'wine bar {city}',
  'cocktail bar {city}',
  'gastropub {city}',
  'bistro {city}',
  'new restaurants in {city}',
  'iconic restaurants in {city}',
  'classic restaurants in {city}',
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
  'cheap eats',
  'rooftop restaurants',
  'wine bar',
  'cocktail bar',
  'gastropub',
  'bistro',
  'tavern',
  'cafe',
  'sandwich shop',
  'pizza restaurants',
  'sushi restaurants',
  'noodle restaurants',
];

// Strip accents, lowercase, and squash punctuation so "Aux Délices" and
// "aux delices" compare equal when scoring how well a restaurant's name
// matches the user's search query.
function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

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

// Mapbox CSP worker hookup — same wiring LocationMap.tsx does. Safe
// to assign even when LocationMap has already set it; the property is
// idempotent. Without this Vite prod builds crash on the worker URL.
mapboxgl.workerClass = MapboxWorker;

// The mini-map is locked to the same 8-mile bbox the list uses for its
// fetch radius. maxBounds prevents the user from panning to a different
// city — which would also let them ask "Search this area" to fetch
// places we'd never bind back to the URL's city.
const MAP_RADIUS_MILES = 8;
const MAP_RADIUS_DEG_LAT = MAP_RADIUS_MILES / 69;

function buildMiniMapBounds(lat: number, lng: number): mapboxgl.LngLatBoundsLike {
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLat = MAP_RADIUS_DEG_LAT;
  const dLng = MAP_RADIUS_DEG_LAT / cosLat;
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat + dLat],
  ];
}

// Marker pin background colour, mapped to the same green/amber/red
// scale the list-row score badges use so the map reads at a glance.
function miniMapMarkerColor(googleRating: number): string {
  const score = googleRating * 2;
  if (score >= 8) return '#2E7D5C';
  if (score >= 5) return '#C28F3A';
  if (score > 0) return '#A8392A';
  return '#8C8278';
}

// Generic seeds used by "Search this area" to fetch a small batch
// centred on the panned map position. Three is enough to surface the
// area's standouts. Each query is paged through Google's full
// nextPageToken chain (up to 3 pages each = ~60 places per query)
// so a single 'Search this area' press genuinely tries to exhaust
// what's available in the visible viewport, not just skim the top 20.
const SEARCH_HERE_QUERIES = [
  'best restaurants',
  'popular restaurants',
  'top rated restaurants',
  'highly rated restaurants',
  'hidden gem restaurants',
  'fine dining',
  'casual dining',
  'cheap eats',
];
// Per-query page cap. Google's text search returns at most 3 pages of
// 20 results each before the nextPageToken stops appearing — this just
// makes the cap explicit and keeps the worst-case request count bounded.
const SEARCH_HERE_MAX_PAGES = 3;
// Hard floor / ceiling on the bbox-derived radius. Keeps very-deep
// zooms from asking Google for 100m blocks (it ignores < ~50m anyway)
// and prevents very-wide zooms from out-running the city bbox.
const SEARCH_HERE_MIN_MI = 0.3;
const SEARCH_HERE_MAX_MI = 3;

// Map a Google cuisine type ('japanese_restaurant') to a word that
// reads naturally inside a text query ('japanese'). Falls back to
// stripping the _restaurant suffix when CUISINE_TYPES doesn't have
// the entry (or to a space-separated form for multi-word types like
// 'asian_fusion_restaurant' → 'asian fusion').
function typeToCuisineQueryWord(type: string): string {
  const entry = CUISINE_TYPES.find((c) => c.type === type);
  if (entry) return entry.label.toLowerCase();
  return type.replace(/_restaurant$/, '').replace(/_/g, ' ');
}

const INITIAL_BATCH_SIZE = 4;  // queries pulled in parallel on first load (≈40 unique places after dedup)
const LOAD_MORE_BATCH_SIZE = 4; // queries pulled per "Load more" click
// Target ≈ 30 fresh uniques per Load-more press. fetchBatch dedupes
// against everything previously seen, so as the pool grows each batch
// returns fewer net-new results — we keep paging within a single click
// until we hit the target or every cursor is drained.
const LOAD_MORE_TARGET = 30;
const LOAD_MORE_MAX_ATTEMPTS = 6;

/* ── Page ────────────────────────────────────────────────────────────────── */
export const LocationPage: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const label = params.get('label') || 'Location';
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);

  const { user, profile: myProfile } = useAuth();
  const userId = user?.id ?? null;
  const { ratings, wishlist, lists, restaurantMeta } = useLists();
  // The canonical source of the user's saved recipes — same store
  // the Pantry's home-cooking section reads from. Prior version was
  // pulling from `lists[].recipes` (a legacy attach point that's
  // empty in practice) so the chat saw zero recipes and refused to
  // answer recipe questions.
  const { myRecipes } = useRecipes();

  // Mobile gate. The page was originally desktop-first; the mobile
  // layout is a full redesign (different header, hero, filter row,
  // card sizes, list item, etc.) so we branch the JSX rather than
  // patch the desktop CSS.
  const { phoneMode } = useSettings();
  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsNarrowViewport(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const isMobile = phoneMode || isNarrowViewport;
  // Drives the headless HomeLocationBar picker opened from the mobile
  // header's "{city} ▾" button.
  const [mobileLocationPickerOpen, setMobileLocationPickerOpen] = useState(false);

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
    // Keep paging until we've gathered roughly LOAD_MORE_TARGET fresh
    // uniques or every cursor is drained. fetchBatch already dedupes
    // against `seenIdsRef`, so as the pool grows each batch returns
    // fewer net-new places — a single 3-cursor pass often only nets a
    // handful once the obvious queries have been exhausted. Without
    // looping, the user would click Load More and see 5 new rows; with
    // it they see ~30 per click until the underlying pool truly runs
    // out, which is the contract they expect.
    const collected: PlaceResult[] = [];
    for (let attempts = 0; attempts < LOAD_MORE_MAX_ATTEMPTS; attempts++) {
      const fresh = await fetchBatch(LOAD_MORE_BATCH_SIZE);
      for (const p of fresh) collected.push(p);
      if (collected.length >= LOAD_MORE_TARGET) break;
      if (cursorsRef.current.every((c) => c.drained)) break;
      // Don't infinite-loop on a string of empty batches — give it one
      // more retry past the first zero return, then bail.
      if (fresh.length === 0 && attempts >= 2) break;
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

  // Cuisine-filter backfill. The initial cursor pool is built from
  // generic seeds + the user's taste-profile cuisines, so picking a
  // cuisine that ISN'T in the user's profile (e.g. Japanese for an
  // Italian-leaning profile) leaves us with a 141-place pool and zero
  // Japanese-tagged results — the filter trims everything. When a new
  // cuisine becomes selected, fire a one-shot batch of cuisine-
  // specific Google queries and append the matches to the pool.
  // Results are deduped via seenIdsRef; backfilled cuisines are
  // tracked in a ref so toggling a cuisine off/on doesn't re-fetch.
  const cuisineBackfilledRef = useRef<Set<string>>(new Set());
  // Reset the backfill tracker on city change so jumping cities
  // re-fires the cuisine queries for the new city.
  useEffect(() => {
    cuisineBackfilledRef.current = new Set();
  }, [cityKey]);
  useEffect(() => {
    if (!hasCoords || selectedCuisines.length === 0) return;
    const toBackfill = selectedCuisines.filter(
      (t) => !cuisineBackfilledRef.current.has(t),
    );
    if (toBackfill.length === 0) return;
    let cancelled = false;
    (async () => {
      const allFresh: PlaceResult[] = [];
      const priceLevels = selectedPrice > 0 ? [selectedPrice] : undefined;
      for (const type of toBackfill) {
        const word = typeToCuisineQueryWord(type);
        const queries = cityKey
          ? [
              `best ${word} restaurants in ${cityKey}`,
              `top rated ${word} restaurants in ${cityKey}`,
              `popular ${word} restaurants`,
            ]
          : [
              `best ${word} restaurants`,
              `top rated ${word} restaurants`,
              `popular ${word} restaurants`,
            ];
        try {
          const results = await Promise.all(
            queries.map((q) => searchPlacesByTextPaged(q, {
              lat, lng, radiusMeters,
              useRestriction: true,
              priceLevels,
            }).then((r) => r.places).catch(() => [] as PlaceResult[])),
          );
          for (const list of results) {
            for (const p of list) {
              if (seenIdsRef.current.has(p.id)) continue;
              seenIdsRef.current.add(p.id);
              allFresh.push(p);
            }
          }
          cuisineBackfilledRef.current.add(type);
        } catch (err) {
          console.error('[LocationPage] cuisine backfill error:', err);
        }
      }
      if (cancelled) return;
      if (allFresh.length > 0) {
        setPlacesPool((prev) => [...prev, ...allFresh]);
      }
    })();
    return () => { cancelled = true; };
  }, [hasCoords, lat, lng, cityKey, selectedCuisines, selectedPrice, radiusMeters]);

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
    // When the user is searching, Google's text search returns a mix of
    // literal name matches and broad "related" results (e.g. "aux delices"
    // also brings back Isabelle et Vincent and Gold's Delicatessen because
    // they're nearby bakeries/delis). The recommendation engine that built
    // `ranked` weights cuisine fit / rating / distance but has zero signal
    // on "does this restaurant's name actually match what the user typed",
    // so unrelated highly-rated places used to outrank the literal hit.
    //
    // We re-rank by a name-match score whenever a query is active so the
    // literal match comes first, falling back to the upstream recommendation
    // order (or the user-selected sort) for everything else.
    const q = debouncedSearch.trim().toLowerCase();
    const nameMatchScore = (name: string): number => {
      if (!q) return 0;
      const n = normalizeForMatch(name);
      const nq = normalizeForMatch(q);
      if (!n || !nq) return 0;
      if (n === nq) return 1000;
      if (n.startsWith(nq)) return 800;
      if (n.includes(nq)) return 600;
      // Word-by-word fallback so multi-word queries still score partial hits
      // ("aux delices patisserie" matches "Aux Delices").
      const qWords = nq.split(/\s+/).filter(Boolean);
      if (qWords.length === 0) return 0;
      const nameWords = new Set(n.split(/\s+/).filter(Boolean));
      let matched = 0;
      for (const w of qWords) if (nameWords.has(w)) matched++;
      if (matched === qWords.length) return 400;
      return Math.round((matched / qWords.length) * 200);
    };

    if (sortBy === 'recommended') {
      if (!q) return out;
      // Stable sort by name-match score, preserving the recommendation order
      // as a tiebreaker for ties (e.g. multiple substring matches).
      const indexed = out.map((p, i) => ({ p, i, s: nameMatchScore(p.name) }));
      indexed.sort((a, b) => b.s - a.s || a.i - b.i);
      return indexed.map((x) => x.p);
    }

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
    // Even when the user picked an explicit sort, a literal name match
    // should still surface above the noise — otherwise typing "aux delices"
    // and tapping "Highest Rated" buries the actual restaurant.
    if (q) {
      sorted.sort((a, b) => {
        const sa = nameMatchScore(a.name);
        const sb = nameMatchScore(b.name);
        return sb - sa;
      });
    }
    return sorted;
  }, [
    ranked, selectedPrice, selectedCuisines, sortBy, hasCoords, lat, lng,
    selectedRadius, friendsOnly, expertsOnly,
    friendRestaurantIds, expertRestaurantIds, debouncedSearch,
  ]);



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
    const loc = await getCurrentHomeLocation();
    handleLocationChange(loc);
  }, [handleLocationChange]);

  /* ── Redesign-only local state ───────────────────────────────────────────── */
  // Map view jump — used by the mini-map CTA and the List/Map view
  // toggle. Disabled when we don't have coords to anchor it.
  const handleOpenMap = useCallback(() => {
    if (!hasCoords) return;
    navigate(
      `/location/map?label=${encodeURIComponent(cityDisplay)}&lat=${lat}&lng=${lng}`,
    );
  }, [hasCoords, navigate, cityDisplay, lat, lng]);
  // Visual-only Open-now toggle. TODO: filter when PlaceResult exposes
  // openingHours.openNow.
  const [openNow, setOpenNow] = useState(false);
  // Visual-only neighborhood pill state. TODO: replace placeholder with a
  // real neighborhood list per city + a real filter on visible[].
  const [neighborhood, setNeighborhood] = useState<string>('all');
  const [neighborhoodMenuOpen, setNeighborhoodMenuOpen] = useState(false);
  // Sort dropdown opened from the sticky bar.
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  // Mini-map expand toggle.
  const [mapExpanded, setMapExpanded] = useState(false);
  // ── Interactive mini-map ─────────────────────────────────────────────
  // Real Mapbox GL instance pinned to the city bbox. Markers come from
  // `visible[]` so the map mirrors the list's filters live; a "Search
  // this area" button runs a tight-radius fetch at the current map
  // centre and appends the new places into the shared pool.
  // `mapWrapperRef` is the outer .minimap; `mapContainerRef` is the
  // inner Mapbox canvas host. The wrapper is what we observe with
  // IntersectionObserver for the auto-collapse-on-scroll-past behavior.
  const mapWrapperRef = useRef<HTMLDivElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Record<string, mapboxgl.Marker>>({});
  const centerMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [searchingHere, setSearchingHere] = useState(false);
  // Tapping a marker no longer navigates straight to the restaurant
  // detail page; instead we open a small floating island over the map
  // with key info and let the user tap THAT to navigate. Same pattern
  // Google Maps uses for marker info cards.
  const [selectedMarkerPlace, setSelectedMarkerPlace] = useState<ScoredPlace | null>(null);
  // Latest coords in a ref so the mount-only init effect can read the
  // current values without taking them as deps.
  const initialMapCoordsRef = useRef({ hasCoords, lat, lng });
  initialMapCoordsRef.current = { hasCoords, lat, lng };
  // Collapsible sections (Guides + Local experts).
  const [guidesOpen, setGuidesOpen] = useState(true);
  const [expertsOpen, setExpertsOpen] = useState(true);
  // Horizontal-rail scroll refs so the section header arrows can scroll
  // their respective rails one screen at a time.
  const guidesRowRef = useRef<HTMLDivElement | null>(null);
  const expertsRowRef = useRef<HTMLDivElement | null>(null);
  const scrollRow = useCallback(
    (ref: React.MutableRefObject<HTMLDivElement | null>, dir: -1 | 1) => {
      ref.current?.scrollBy({ left: dir * 600, behavior: 'smooth' });
    },
    [],
  );

  // Quick-cuisine chips for the sticky bar. The five most-asked-about
  // cuisines, mapped to the same Google type strings the FilterSheet uses
  // so toggling them flows through the existing selectedCuisines state.
  const QUICK_CUISINES: Array<{ label: string; type: string }> = useMemo(
    () => [
      { label: 'Japanese', type: 'japanese_restaurant' },
      { label: 'Italian', type: 'italian_restaurant' },
      { label: 'French', type: 'french_restaurant' },
      { label: 'Korean', type: 'korean_restaurant' },
      { label: 'American', type: 'american_restaurant' },
    ],
    [],
  );
  const toggleCuisine = useCallback(
    (type: string) => {
      setSelectedCuisines((prev) =>
        prev.includes(type) ? prev.filter((x) => x !== type) : [...prev, type],
      );
    },
    [],
  );

  // Placeholder neighborhood list — wired in but only filters by substring
  // match against `place.address` (best-effort until we have real data).
  const NEIGHBORHOODS = useMemo(
    () => ['All neighborhoods', 'SoHo', 'West Village', 'Midtown', 'Brooklyn', 'Upper West'],
    [],
  );

  // ── Mini-map: initialise once ──────────────────────────────────────
  // Mount Mapbox into the container only when we actually have coords.
  // The map persists for the page lifetime; subsequent location changes
  // recenter it via the effect below rather than tearing down + rebuilding.
  useEffect(() => {
    if (!mapContainerRef.current || !MAPBOX_TOKEN) return;
    const init = initialMapCoordsRef.current;
    if (!init.hasCoords) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [init.lng, init.lat],
      zoom: 12,
      attributionControl: false,
      // maxBounds caps panning to the city's 8 mi bbox so a "Search this
      // area" click can never reach restaurants outside the area the
      // user picked — same radius the list uses, so the two views agree.
      maxBounds: buildMiniMapBounds(init.lat, init.lng),
    });
    mapRef.current = map;
    map.on('load', () => {
      setMapReady(true);
      map.resize();
    });
    return () => {
      for (const m of Object.values(markersRef.current)) (m as mapboxgl.Marker).remove();
      markersRef.current = {};
      if (centerMarkerRef.current) { centerMarkerRef.current.remove(); centerMarkerRef.current = null; }
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCoords]);

  // Recenter + re-bound on city change. Mirrors LocationMap's pattern:
  // clear maxBounds, jump to the new centre, re-apply bounds. flyTo
  // across hundreds of miles can leave a blank-tile flash on slow
  // connections so we jumpTo.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasCoords) return;
    map.setMaxBounds(null as unknown as mapboxgl.LngLatBoundsLike);
    map.jumpTo({ center: [lng, lat], zoom: 12 });
    map.setMaxBounds(buildMiniMapBounds(lat, lng));
    map.resize();
  }, [hasCoords, lat, lng]);

  // Keep the Mapbox canvas in lock-step with its container at all
  // times. ResizeObserver fires after the browser commits each layout
  // tick during the CSS height transition (and on window resize, sidebar
  // toggles, etc.), so the canvas redraws continuously instead of
  // snapping into place once the transition finishes — which was the
  // 'expanded container with no map below' choppiness on toggle.
  useEffect(() => {
    const map = mapRef.current;
    const container = mapContainerRef.current;
    if (!map || !container || !mapReady) return;
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);
    return () => ro.disconnect();
  }, [mapReady]);

  // Auto-collapse the expanded map once the user scrolls past it.
  // Observer is only attached while expanded — when the wrapper stops
  // intersecting the viewport (fully scrolled past in either direction)
  // we flip mapExpanded back to false, so when the user scrolls back
  // up the strip is in its compact state again.
  useEffect(() => {
    if (!mapExpanded) return;
    const node = mapWrapperRef.current;
    if (!node) return;
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          setMapExpanded(false);
        }
      }
    }, { threshold: 0 });
    io.observe(node);
    return () => io.disconnect();
  }, [mapExpanded]);

  // ── Mini-map: sync restaurant markers with `visible` ───────────────
  // Tear-down + rebuild on every change. Diffing would let us skip some
  // DOM churn but the lists usually either grow (Load More) or filter
  // wholesale, and rebuild is easier to reason about. Each marker is a
  // small DOM button coloured by the place's rating; click navigates
  // straight to the detail page.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const m of Object.values(markersRef.current)) (m as mapboxgl.Marker).remove();
    markersRef.current = {};
    for (const place of visible) {
      if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) continue;
      // Mapbox sets a transform:translate(...) on the marker root to
      // position it. If our CSS adds another `transform` (e.g. a hover
      // scale) it overrides the translate and the marker jumps to (0,0)
      // of the map container until the hover ends. Solution: keep the
      // root transparent/transform-free and put the visual pill inside.
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'minimap-marker';
      el.title = place.name;
      const inner = document.createElement('span');
      inner.className = 'minimap-marker-inner';
      inner.style.backgroundColor = miniMapMarkerColor(place.rating);
      inner.textContent = place.rating > 0 ? (place.rating * 2).toFixed(1) : '·';
      el.appendChild(inner);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        // Open the floating island over the bottom of the map with
        // this place's info. Tap-through to the detail page lives on
        // the island itself so users can scan the card first.
        setSelectedMarkerPlace(place);
      });
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([place.lng, place.lat])
        .addTo(map);
      markersRef.current[place.id] = marker;
    }
  }, [visible, mapReady, navigate]);

  // ── Mini-map: city-centre marker (distinct from restaurants) ───────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !hasCoords) return;
    if (centerMarkerRef.current) {
      centerMarkerRef.current.remove();
      centerMarkerRef.current = null;
    }
    const el = document.createElement('div');
    el.className = 'minimap-center-marker';
    el.innerHTML = '<span class="ring"></span><span class="dot"></span>';
    centerMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat([lng, lat])
      .addTo(map);
  }, [lat, lng, hasCoords, mapReady]);

  // Clear the marker island when the selected place falls out of
  // visible[] (filter change, search, neighborhood toggle, etc.) —
  // otherwise the card lingers showing a place that's no longer on
  // the map.
  useEffect(() => {
    if (!selectedMarkerPlace) return;
    if (!visible.some((p) => p.id === selectedMarkerPlace.id)) {
      setSelectedMarkerPlace(null);
    }
  }, [visible, selectedMarkerPlace]);

  // Toggle the .is-selected class on the active marker so it visually
  // pops. Runs whenever the selection changes; doesn't touch the
  // markers themselves (no teardown), just flips a class on the
  // existing DOM elements via marker.getElement().
  useEffect(() => {
    const id = selectedMarkerPlace?.id;
    for (const [pid, m] of Object.entries(markersRef.current)) {
      const el = (m as mapboxgl.Marker).getElement();
      if (pid === id) el.classList.add('is-selected');
      else el.classList.remove('is-selected');
    }
  }, [selectedMarkerPlace, visible]);

  // ── AI chatbot context: personalize from the user's data ─────────
  // Pull a city + region tag out of a Google-formatted address so the
  // chat's user-context lines say "Boston, MA" instead of just an
  // unparseable street. Falls through to the full address when the
  // shape is unfamiliar. Used for ratings + wishlist entries whose
  // restaurant_meta hasn't been backfilled yet (meta is lazy-loaded
  // when the user views the detail page, so older entries are bare).
  const cityFromAddress = (address: string | undefined | null): string => {
    if (!address) return '';
    const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts.join(', ');
    // 3+ parts: drop the street (first), keep city + state/region
    // (next two). e.g. "200 Berkeley St, Boston, MA 02116" -> "Boston, MA 02116".
    return parts.slice(1, 3).join(', ');
  };
  // Inlined into the system prompt every turn so Claude can weight
  // recommendations toward the user's taste history, friends, and
  // followed experts. Strictly read-only — same data already shown
  // throughout the app, just packaged for the model.
  const chatUserContext = useMemo(() => {
    const ctx: {
      displayName?: string;
      username?: string;
      homeCity?: string;
      topCuisines?: string[];
      topRated?: Array<{ name: string; score?: number; cuisine?: string; neighborhood?: string }>;
      wishlist?: Array<{ name: string; cuisine?: string; neighborhood?: string }>;
      recipes?: Array<{ title: string; cuisine?: string }>;
      friends?: Array<{ displayName: string; username?: string }>;
      followedExperts?: Array<{ displayName: string; username?: string; bio?: string }>;
      circleSignals?: Array<{ restaurantId: string; friendCount?: number; expertCount?: number }>;
    } = {};
    if (myProfile?.display_name) ctx.displayName = myProfile.display_name;
    if (myProfile?.username) ctx.username = myProfile.username;
    if (myProfile?.home_city) ctx.homeCity = myProfile.home_city;
    if (profile.topCuisines.length > 0) ctx.topCuisines = profile.topCuisines.slice(0, 6);
    // Send ALL ratings (up to 50), sorted by score desc. Previous
    // 8-item cap caused the chat to confidently say "you have no
    // Boston ratings" when the user's Boston picks happened to
    // score below their top 8. Address comes off the rating row
    // itself (not the lazy-loaded restaurant_meta) so the city is
    // always present — meta-backed neighborhood is preferred when
    // it's there for the richer "Beacon Hill, Boston" form.
    if (ratings.length > 0) {
      const sorted = [...ratings].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 50);
      ctx.topRated = sorted.map((r) => {
        const meta = restaurantMeta[r.restaurantId];
        const richLocation = meta
          ? formatLocationLabel(meta.addressComponents, meta.address || r.address || '', meta.neighborhood)
          : '';
        const location = richLocation || cityFromAddress(r.address);
        return {
          id: r.restaurantId,
          name: r.name || meta?.name || 'Unnamed',
          score: typeof r.score === 'number' ? r.score : undefined,
          cuisine: r.cuisine || meta?.cuisine || undefined,
          neighborhood: location || undefined,
        };
      });
    }
    // Wishlist — same treatment, capped at 30.
    if (wishlist.length > 0) {
      ctx.wishlist = wishlist.slice(0, 30).map((w) => {
        const meta = restaurantMeta[w.restaurantId];
        const richLocation = meta
          ? formatLocationLabel(meta.addressComponents, meta.address || w.address || '', meta.neighborhood)
          : '';
        const location = richLocation || cityFromAddress(w.address);
        return {
          id: w.restaurantId,
          name: w.name || meta?.name || 'Unnamed',
          cuisine: w.cuisine || meta?.cuisine || undefined,
          neighborhood: location || undefined,
        };
      });
    }
    // Recipes are nested under lists.
    // Pull from useRecipes().myRecipes — the canonical Supabase-backed
    // store the Pantry uses. Filter to "real" recipes only — anything
    // with zero ingredients AND zero steps is almost certainly a stub
    // (auto-imported / placeholder / accidentally-created entry whose
    // title happens to be a restaurant name). Surfacing stubs makes
    // the AI hallucinate when the user asks "what recipe should I
    // cook" — it picks a stub and the card looks like a restaurant
    // recommendation in disguise. Keep them out of the model's view.
    if (myRecipes.length > 0) {
      const seen = new Set<string>();
      const recipes: Array<{ id: string; title: string; cuisine?: string; prepTime?: number; cookTime?: number; difficulty?: string; ingredientCount?: number; stepCount?: number }> = [];
      for (const r of myRecipes) {
        if (!r?.id || seen.has(r.id)) continue;
        const ing = r.ingredients?.length || 0;
        const stp = r.steps?.length || 0;
        if (ing === 0 && stp === 0) continue;  // stub — skip
        seen.add(r.id);
        recipes.push({
          id: r.id,
          title: r.title || 'Untitled recipe',
          cuisine: r.cuisine || undefined,
          prepTime: r.prepTimeMinutes ?? undefined,
          cookTime: r.cookTimeMinutes ?? undefined,
          // Capitalise so the system-prompt line reads naturally
          // ("Easy" / "Medium" / "Hard").
          difficulty: r.difficulty
            ? r.difficulty.charAt(0).toUpperCase() + r.difficulty.slice(1)
            : undefined,
          // Send counts so the AI can see at-a-glance whether a row
          // is a substantial cooking recipe vs a thin metadata row.
          ingredientCount: ing,
          stepCount: stp,
        });
        if (recipes.length >= 30) break;
      }
      if (recipes.length > 0) ctx.recipes = recipes;
    }
    // Friends + followed experts come from areaFriendCandidates +
    // areaExperts, both already loaded for the "Around <city>" rail.
    if (areaFriendCandidates.length > 0) {
      ctx.friends = areaFriendCandidates.slice(0, 10).map((f) => ({
        displayName: f.display_name || f.username,
        username: f.username,
      }));
    }
    if (areaExperts.length > 0) {
      ctx.followedExperts = areaExperts.slice(0, 8).map((e) => ({
        displayName: e.display_name || e.username,
        username: e.username,
        bio: e.bio || undefined,
      }));
    }
    // Circle ratings on the visible pool. Only include places that
    // have at least one friend or expert hit so the array stays tight.
    if (visible.length > 0 && (friendCounts.size > 0 || expertCounts.size > 0)) {
      const sig: Array<{ restaurantId: string; friendCount?: number; expertCount?: number }> = [];
      for (const p of visible.slice(0, 30)) {
        const fc = friendCounts.get(p.id) || 0;
        const ec = expertCounts.get(p.id) || 0;
        if (fc > 0 || ec > 0) sig.push({
          restaurantId: p.id,
          friendCount: fc || undefined,
          expertCount: ec || undefined,
        });
      }
      if (sig.length > 0) ctx.circleSignals = sig;
    }
    return ctx;
  }, [myProfile, profile.topCuisines, ratings, wishlist, lists, restaurantMeta, areaFriendCandidates, areaExperts, friendCounts, expertCounts, visible]);

  // Synthesize minimal ScoredPlace objects for every restaurant the
  // user has rated or wishlisted. Passed to LocationChat so its card
  // lookup can render cards for places outside the visible[] / pool
  // (e.g. Plénitude in Paris when the user is browsing New York).
  // We don't have lat/lng or Google types on rating rows — they're
  // only needed for the in-pool recommendation scoring, not for
  // chat-card rendering, so neutral values are fine.
  const chatKnownPlaces = useMemo<ScoredPlace[]>(() => {
    const seen = new Set<string>();
    const out: ScoredPlace[] = [];
    const push = (id: string, name: string, score: number, cuisine: string, address: string, image: string) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push({
        id,
        name: name || 'Unnamed',
        rating: score > 0 ? score / 2 : 0, // app's 0-10 -> Google's 0-5
        types: [],
        priceLevel: 0,
        address: address || '',
        fullAddress: address || '',
        photoUrl: image || null,
        userRatingCount: 0,
        lat: 0,
        lng: 0,
        recScore: score,
        sources: ['google'],
        // Keep the canonical cuisine string from the rating row so
        // the chat card can show it even though `types` is empty.
        // (LocationChat falls back to this when inferCuisineLabel
        // returns nothing.)
        // @ts-expect-error - extra field for chat use only
        cuisineHint: cuisine || '',
      });
    };
    for (const r of ratings) push(r.restaurantId, r.name, r.score, r.cuisine, r.address, r.image);
    for (const w of wishlist) push(w.restaurantId, w.name, 0, w.cuisine, w.address, w.image);
    return out;
  }, [ratings, wishlist]);

  // De-duped + stub-filtered list of every Recipe the user owns.
  // Passed to LocationChat as the recipe-card lookup table. Same
  // 0-ingredients-AND-0-steps stub filter as the system-prompt
  // context above so cards can't render for placeholder entries
  // either (and if the AI ever tries to recommend one of those ids,
  // the lookup misses and the "Recipe not found in your saved list"
  // fallback shows instead of a misleading restaurant-name card).
  const chatRecipesAll = useMemo(() => {
    const seen = new Set<string>();
    const out: typeof myRecipes = [];
    for (const r of myRecipes) {
      if (!r?.id || seen.has(r.id)) continue;
      const ing = r.ingredients?.length || 0;
      const stp = r.steps?.length || 0;
      if (ing === 0 && stp === 0) continue;
      seen.add(r.id);
      out.push(r);
    }
    return out;
  }, [myRecipes]);

  // ── Chat-tool: lookup other users by name / handle ───────────────
  // Wired to Claude's lookup_user tool. Returns up to 5 public
  // profiles via the existing searchUsersByUsername helper.
  const handleLookupUser = useCallback(async (query: string) => {
    // Empty queries are intentional — the assistant uses them to
    // browse "any users" / "people I might follow". searchUsersByUsername
    // returns the first 20 profiles when query is empty.
    const q = query.trim();
    try {
      const profiles = await searchUsersByUsername(q, userId || '');
      return profiles.slice(0, 8).map((p) => ({
        username: p.username,
        displayName: p.display_name || p.username,
        bio: p.bio || undefined,
        isExpert: !!p.is_expert,
        homeCity: p.home_city || undefined,
      }));
    } catch (err) {
      console.error('[LocationPage] handleLookupUser error:', err);
      return [];
    }
  }, [userId]);

  // ── Chat-tool: who in the user's circle rated this restaurant? ──
  // Wired to Claude's get_circle_ratings tool. Reads from the same
  // signals.communityByRestaurant map the recommendation engine
  // already populates (all friend + expert ratings, not just for
  // visible places). Profiles for raters that aren't already in the
  // areaExperts / areaFriendCandidates pools are fetched lazily via
  // getProfilesByIds. Returns a shape the chat can stash so any
  // names Claude mentions auto-link to their profile.
  const handleGetCircleRatings = useCallback(async (restaurantId: string) => {
    const id = restaurantId.trim();
    if (!id) return [];
    const ratings = signals.communityByRestaurant.get(id) || [];
    if (ratings.length === 0) return [];
    // Build a profile lookup using what's already loaded for the page…
    const profiles: Record<string, UserProfile> = {};
    for (const e of areaExperts) profiles[e.user_id] = e;
    for (const f of areaFriendCandidates) profiles[f.user_id] = f;
    // …then fetch any raters we don't have profiles for yet.
    const allUserIds: string[] = ratings.map((r) => r.user_id);
    const missing: string[] = Array.from(new Set(allUserIds))
      .filter((uid) => !profiles[uid]);
    if (missing.length > 0) {
      try {
        const fetched = await getProfilesByIds(missing);
        Object.assign(profiles, fetched);
      } catch (err) {
        console.error('[LocationPage] handleGetCircleRatings profile fetch error:', err);
      }
    }
    return ratings.map((r) => {
      const p = profiles[r.user_id];
      return {
        username: p?.username || '',
        displayName: p?.display_name || p?.username || 'Unknown',
        isExpert: signals.expertUserIds.has(r.user_id),
        isFriend: signals.friendUserIds.has(r.user_id),
        score: typeof r.score === 'number' ? r.score : undefined,
        notes: r.notes || undefined,
      };
    });
  }, [signals, areaExperts, areaFriendCandidates]);

  // ── Chat-tool: free-text search for the AI assistant ─────────────
  // Bound to the LocationChat's onSearchRestaurants prop. When the
  // model can't find what the user asked for in its system-prompt
  // pool, it calls search_restaurants and this fires a Google Places
  // text search anchored to the city. Single page (≤20 hits) for
  // chat responsiveness — Claude only needs enough to pick 3-5
  // recommendations from. Deduped against seenIdsRef and appended
  // to placesPool so anything that passes the user's current filters
  // also surfaces in the list / map; anything outside the filters
  // lives only in the chat's local map.
  const handleChatSearch = useCallback(async (query: string, city?: string): Promise<ScoredPlace[]> => {
    const q = query.trim();
    if (!q) return [];
    try {
      const priceLevels = selectedPrice > 0 ? [selectedPrice] : undefined;
      // Resolve which city to search in. When Claude passes a city
      // different from the page's current one (e.g. "Felice in
      // Westport, CT" after a web_search), geocode it via Mapbox and
      // search that bbox instead of the page's lat/lng. Falls back
      // gracefully to the current city if geocoding fails.
      let anchor: { lat: number; lng: number; radiusMeters: number } | null = null;
      const targetCity = city?.trim();
      const currentCityKey = shortCityName.toLowerCase();
      const isOtherCity = !!targetCity && targetCity.toLowerCase() !== currentCityKey;
      if (isOtherCity) {
        try {
          const geocoded = await geocodePlace(targetCity!);
          if (geocoded) {
            anchor = {
              lat: geocoded.lat,
              lng: geocoded.lng,
              // ~12 mi — wider than the per-city default so a single
              // text query like "burger spot" inside Westport actually
              // covers the whole town.
              radiusMeters: 19312,
            };
          }
        } catch {
          // ignore — fall through to current-city anchor below
        }
      }
      if (!anchor) {
        if (!hasCoords) return [];
        anchor = { lat, lng, radiusMeters };
      }
      // When searching another city, embed the city in the query
      // string too — gives Google's ranker the extra location bias.
      const finalQuery = isOtherCity ? `${q} in ${targetCity}` : q;
      const res = await searchPlacesByTextPaged(finalQuery, {
        lat: anchor.lat,
        lng: anchor.lng,
        radiusMeters: anchor.radiusMeters,
        useRestriction: true,
        priceLevels,
      });
      const fresh: PlaceResult[] = [];
      for (const p of res.places) {
        if (seenIdsRef.current.has(p.id)) continue;
        seenIdsRef.current.add(p.id);
        fresh.push(p);
      }
      // Only append to the current city's pool when the search WAS
      // for the current city — otherwise the user's list/map would
      // start showing Westport spots while they're browsing NYC.
      if (fresh.length > 0 && !isOtherCity) {
        setPlacesPool((prev) => [...prev, ...fresh]);
      }
      return res.places.map<ScoredPlace>((p) => ({
        ...p,
        recScore: p.rating > 0 ? p.rating * 2 : 0,
        sources: ['google'],
      }));
    } catch (err) {
      console.error('[LocationPage] handleChatSearch error:', err);
      return [];
    }
  }, [hasCoords, lat, lng, selectedPrice, radiusMeters, shortCityName]);

  // ── "Search this area" — exhaustive viewport-anchored fetch ────────
  // Derives the radius from the map's actual visible bounds (zoom in =
  // tight radius, zoom out = wider) and runs a broad query mix at the
  // current map centre. Each query is paged through Google's full
  // nextPageToken chain so we genuinely exhaust the visible area's
  // ranking instead of skimming the top 20 per query. Cuisine-aware
  // when filters are active. Results dedupe against seenIdsRef and
  // append to placesPool — which is then captured by the existing
  // 15-min TTL cache, so re-clicking inside the window is free.
  const handleSearchHere = useCallback(async () => {
    const map = mapRef.current;
    if (!map || searchingHere) return;
    setSearchingHere(true);
    try {
      const c = map.getCenter();
      const bounds = map.getBounds();
      // Compute the radius from the actual visible viewport so the
      // search follows the zoom: zoom in tight → only spots inside the
      // viewport; zoom out → broader. Clamped so very-deep zooms still
      // ask Google for a usable footprint (it ignores sub-50m radii)
      // and very-wide zooms don't out-run the city bbox.
      let radiusMi = SEARCH_HERE_MAX_MI;
      if (bounds) {
        const ne = bounds.getNorthEast();
        const cornerMi = haversineDistanceMi(c.lat, c.lng, ne.lat, ne.lng);
        radiusMi = Math.max(
          SEARCH_HERE_MIN_MI,
          Math.min(cornerMi * 0.9, SEARCH_HERE_MAX_MI),
        );
      }
      const radiusMeters = Math.round(radiusMi * 1609.34);

      const priceLevels = selectedPrice > 0 ? [selectedPrice] : undefined;
      // Cuisine-aware query mix. With filters active we issue
      // cuisine-specific queries so the results actually survive the
      // client-side cuisine filter; otherwise the broad generic pool.
      const queries: string[] = selectedCuisines.length > 0
        ? selectedCuisines.flatMap((type) => {
            const word = typeToCuisineQueryWord(type);
            return [
              `best ${word} restaurants`,
              `popular ${word} restaurants`,
              `top rated ${word} restaurants`,
              `${word} restaurants`,
            ];
          })
        : [...SEARCH_HERE_QUERIES];

      // Page each query exhaustively. Returns every PlaceResult the
      // query surfaces across its full nextPageToken chain (capped at
      // SEARCH_HERE_MAX_PAGES — Google stops paginating at 3 anyway).
      // Queries run in parallel; pages within a query run serially
      // because each page's call needs the previous response's token.
      const exhaustQuery = async (q: string): Promise<PlaceResult[]> => {
        const out: PlaceResult[] = [];
        let pageToken: string | undefined = undefined;
        for (let page = 0; page < SEARCH_HERE_MAX_PAGES; page++) {
          try {
            const res = await searchPlacesByTextPaged(q, {
              lat: c.lat,
              lng: c.lng,
              radiusMeters,
              useRestriction: true,
              priceLevels,
              pageToken,
            });
            out.push(...res.places);
            pageToken = res.nextPageToken || undefined;
            if (!pageToken) break;
          } catch {
            break;
          }
        }
        return out;
      };
      const results = await Promise.all(queries.map(exhaustQuery));

      const fresh: PlaceResult[] = [];
      for (const list of results) {
        for (const p of list) {
          if (seenIdsRef.current.has(p.id)) continue;
          seenIdsRef.current.add(p.id);
          fresh.push(p);
        }
      }
      if (fresh.length > 0) {
        setPlacesPool((prev) => [...prev, ...fresh]);
      }
    } catch (err) {
      console.error('[LocationPage] handleSearchHere error:', err);
    } finally {
      setSearchingHere(false);
    }
  }, [searchingHere, selectedPrice, selectedCuisines]);

  return (
    <div className="location-page-root min-h-screen pb-24">
      {/* Back-arrow row — map icon + location hero have moved to the
          global top bar (DesktopHeader). Keeps the route navigable.
          On mobile we render a richer header with a centered LOCATION
          eyebrow + "{city} ▾" dropdown trigger and a share button. */}
      <div className={cn('sticky top-0 z-20 pt-safe-4 pb-2', isMobile ? 'px-1' : 'px-4')} style={{ background: 'rgba(237,231,217,0.92)', backdropFilter: 'saturate(150%) blur(14px)' }}>
        {isMobile ? (
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="w-10 h-10 -ml-2 flex items-center justify-center rounded-full transition-colors"
              style={{ color: 'var(--ink-2)' }}
              aria-label="Back"
            >
              <ArrowLeft size={22} />
            </button>
            <div className="flex-1 min-w-0 text-center">
              <button
                type="button"
                onClick={() => setMobileLocationPickerOpen(true)}
                className="inline-flex items-center gap-1 max-w-full"
                style={{ color: 'var(--ink)' }}
                aria-label="Change location"
              >
                <span className="font-serif font-semibold text-[17px] tracking-[-0.01em] truncate">{cityDisplay}</span>
                <ChevronDown size={16} style={{ color: 'var(--muted-2)' }} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                if (typeof navigator !== 'undefined' && navigator.share) {
                  void navigator.share({ title: cityDisplay, url: window.location.href }).catch(() => {});
                }
              }}
              className="w-10 h-10 -mr-2 flex items-center justify-center rounded-full transition-colors"
              style={{ color: 'var(--ink-2)' }}
              aria-label="Share"
            >
              <Share2 size={20} />
            </button>
          </div>
        ) : (
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="w-10 h-10 -ml-2 flex items-center justify-center rounded-full transition-colors"
              style={{ color: 'var(--ink-2)' }}
              aria-label="Back"
            >
              <ArrowLeft size={22} />
            </button>
          </div>
        )}
      </div>

      {/* Headless location picker — opened by tapping "{city} ▾" in the
          mobile header above. The component is portal-rendered, so its
          position in the tree doesn't matter visually. */}
      {isMobile && (
        <HomeLocationBar
          variant="headless"
          location={currentLocation}
          onChange={handleLocationChange}
          onUseCurrent={handleUseCurrent}
          open={mobileLocationPickerOpen}
          onOpenChange={setMobileLocationPickerOpen}
        />
      )}

      <div className={cn('lp-page', isMobile && 'is-mobile')}>
        {/* ── Mobile hero — EXPLORING eyebrow + big serif city name.
            Desktop already gets a hero from DesktopHeader so this is
            mobile-only. ─────────────────────────────────────────────── */}
        {isMobile && (() => {
          const now = new Date();
          const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          // Split "New York, NY" into ["New York", "NY"] so we can render
          // the region as a smaller italic suffix next to the title.
          const parts = cityDisplay.split(',').map((s) => s.trim()).filter(Boolean);
          const mainName = parts[0] || cityDisplay;
          const region = parts.length > 1 ? parts.slice(1).join(', ') : '';
          return (
            <section className="pt-4 pb-5 px-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] flex items-center gap-2" style={{ color: 'var(--accent)' }}>
                Exploring
                <span style={{ color: 'var(--muted-2)' }}>·</span>
                <span style={{ color: 'var(--muted)' }}>{timeStr}</span>
              </p>
              <h1 className="mt-2 font-serif font-semibold leading-[1.02] tracking-[-0.025em]" style={{ color: 'var(--ink)' }}>
                <span className="text-[44px]">{mainName}</span>
                {region && (
                  <>
                    <span className="text-[44px]" style={{ color: 'var(--muted-2)' }}>,</span>{' '}
                    <span className="text-[32px] italic font-medium" style={{ color: 'var(--muted-2)' }}>{region}</span>
                  </>
                )}
              </h1>
            </section>
          );
        })()}

        {/* ── Sticky filter bar (desktop only — the mobile redesign
            uses a single compact filter row inserted between Local
            experts and the Search box further down) ───────────────── */}
        {!isMobile && (
        <div className="loc-filterbar">
          {/* Neighborhoods — placeholder popover. TODO: real per-city list. */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              className={cn('fb-chip', neighborhood !== 'all' && 'active')}
              onClick={() => setNeighborhoodMenuOpen((v) => !v)}
            >
              <MapIcon /> {neighborhood === 'all' ? 'All neighborhoods' : neighborhood}
              <ChevronDown />
            </button>
            {neighborhoodMenuOpen && (
              <div className="fb-menu" style={{ right: 'auto', left: 0 }}>
                {NEIGHBORHOODS.map((n) => {
                  const value = n === 'All neighborhoods' ? 'all' : n;
                  const active = neighborhood === value;
                  return (
                    <button
                      key={n}
                      type="button"
                      className={cn('fb-menu-item', active && 'active')}
                      onClick={() => { setNeighborhood(value); setNeighborhoodMenuOpen(false); }}
                    >
                      <span>{n}</span>
                      {active && <Check size={14} className="check" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Clear-all-cuisines chip */}
          <button
            type="button"
            className={cn('fb-chip', selectedCuisines.length > 0 && 'active')}
            onClick={() => setSelectedCuisines([])}
          >
            <Soup /> {selectedCuisines.length === 0
              ? 'All cuisines'
              : `${selectedCuisines.length} selected`}
            {selectedCuisines.length > 0 && <span style={{ marginLeft: 4 }}>×</span>}
          </button>

          <span className="fb-divider" />

          {QUICK_CUISINES.map((c) => (
            <button
              key={c.type}
              type="button"
              className={cn('fb-chip', selectedCuisines.includes(c.type) && 'active')}
              onClick={() => toggleCuisine(c.type)}
            >
              {c.label}
            </button>
          ))}

          <span className="fb-divider" />

          <button
            type="button"
            className={cn('fb-toggle', openNow && 'active')}
            onClick={() => setOpenNow((v) => !v)}
          >
            <span className="sw" />
            Open now
          </button>

          <span className="fb-spacer" />

          {/* Sort */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              className="fb-sort"
              onClick={() => setSortMenuOpen((v) => !v)}
            >
              <span className="label">Sort:</span>
              <span>{SORT_LABELS[sortBy]}</span>
              <ChevronDown />
            </button>
            {sortMenuOpen && (
              <div className="fb-menu">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={cn('fb-menu-item', sortBy === opt.value && 'active')}
                    onClick={() => { setSortBy(opt.value); setSortMenuOpen(false); }}
                  >
                    <span>{opt.label}</span>
                    {sortBy === opt.value && <Check size={14} className="check" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Open the full Filters sheet — same target as the button
              that sits above the All-restaurants list. The chip shows
              a small accent badge when any filters are active. */}
          <button
            type="button"
            className="fb-chip"
            onClick={() => setFilterSheetOpen(true)}
            aria-label="Open filters"
          >
            <SlidersHorizontal /> Filters
            {activeFilterCount > 0 && (
              <span className="fb-count">{activeFilterCount}</span>
            )}
          </button>

          {/* List/Map view */}
          <div className="fb-view-group">
            <button type="button" className="fb-view-btn active">
              <LayoutGrid /> List
            </button>
            <button
              type="button"
              className="fb-view-btn"
              onClick={handleOpenMap}
              disabled={!hasCoords}
            >
              <MapIcon /> Map
            </button>
          </div>
        </div>
        )}

        {/* ── Mini-map ────────────────────────────────────────────────── */}
        {hasCoords && (
          <div ref={mapWrapperRef} className={cn('minimap', isMobile && 'is-mobile', mapExpanded && !isMobile && 'is-expanded')}>
            <div ref={mapContainerRef} className="minimap-canvas" />
            <div className="minimap-info">
              <span className="pulse" />
              {visible.length > 0
                ? `${visible.length} spots nearby`
                : initialLoading ? 'Loading nearby spots…' : '0 spots nearby'}
            </div>
            {/* Expand-to-fullscreen toggle hidden on mobile per design;
                "Open map" CTA below is the only escape to the full map. */}
            {!isMobile && (
              <button
                type="button"
                className="minimap-expand"
                onClick={(e) => { e.stopPropagation(); setMapExpanded((v) => !v); }}
                aria-label={mapExpanded ? 'Collapse map' : 'Expand map'}
              >
                {mapExpanded ? <Minimize2 /> : <Maximize2 />}
              </button>
            )}
            {/* "Search this area" overlay overlapped score pins on the
                small mobile map; we suppress it there. */}
            {!isMobile && (
              <button
                type="button"
                className="minimap-search-here"
                onClick={(e) => { e.stopPropagation(); void handleSearchHere(); }}
                disabled={searchingHere || !mapReady}
              >
                {searchingHere ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Searching…
                  </>
                ) : (
                  <>
                    <Search size={14} />
                    Search this area
                  </>
                )}
              </button>
            )}
            {/* Open-map CTA hides when the marker island is showing
                — they share the bottom edge of the map and the island
                is the primary affordance in that state. */}
            {!selectedMarkerPlace && (
              <button
                type="button"
                className="minimap-cta"
                onClick={(e) => { e.stopPropagation(); handleOpenMap(); }}
              >
                Open map <ChevronRight />
              </button>
            )}
            {selectedMarkerPlace && (() => {
              const p = selectedMarkerPlace;
              const score = p.rating > 0 ? p.rating * 2 : 0;
              const scoreClass = score >= 8 ? 'is-good' : score >= 5 ? 'is-mid' : 'is-low';
              const cuisine = inferCuisineLabel(p.types);
              const priceLabel = priceLevelToString(p.priceLevel);
              const meta = restaurantMeta[p.id];
              const areaLabel = formatLocationLabel(
                meta?.addressComponents,
                p.address || '',
                meta?.neighborhood,
              );
              return (
                <div className="minimap-island" role="dialog" aria-label={p.name}>
                  <button
                    type="button"
                    className="minimap-island-body"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedMarkerPlace(null);
                      navigate(`/restaurant/${p.id}`);
                    }}
                  >
                    <div className={cn('minimap-island-score', scoreClass)}>
                      {score > 0 ? score.toFixed(1) : '—'}
                    </div>
                    <div className="minimap-island-info">
                      <h4>{p.name}</h4>
                      <p>
                        {cuisine && <span className="accent">{cuisine}</span>}
                        {cuisine && priceLabel && <span className="dot">·</span>}
                        {priceLabel && <span className="price">{priceLabel}</span>}
                        {(cuisine || priceLabel) && areaLabel && <span className="dot">·</span>}
                        {areaLabel && <span>{areaLabel}</span>}
                      </p>
                    </div>
                    <ChevronRight />
                  </button>
                  <button
                    type="button"
                    className="minimap-island-close"
                    onClick={(e) => { e.stopPropagation(); setSelectedMarkerPlace(null); }}
                    aria-label="Close"
                  >
                    <X />
                  </button>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── Guides ──────────────────────────────────────────────────── */}
        <section className={cn('lp-section collapsible-section', guidesOpen ? 'is-open' : 'is-closed')}>
          {isMobile ? (
            <button
              type="button"
              onClick={() => setGuidesOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-3 mb-3 text-left"
              style={{ paddingLeft: '20px', paddingRight: '20px' }}
            >
              <h2 className="font-serif font-semibold text-[26px] leading-[1.1] tracking-[-0.02em] flex items-baseline gap-2 flex-wrap min-w-0" style={{ color: 'var(--ink)' }}>
                <span>Guides for {shortCityName}</span>
                <span className="text-[14px] font-medium" style={{ color: 'var(--muted)' }}>{locationGuides.length}</span>
              </h2>
              <span
                className={cn('loc-section-chev', guidesOpen && 'is-open')}
                aria-hidden="true"
              >
                <ChevronDown />
              </span>
            </button>
          ) : (
          <div className="loc-section-head is-collapsible">
            <button
              type="button"
              className="loc-section-head-main"
              onClick={() => setGuidesOpen((v) => !v)}
            >
              <span className={cn('loc-section-chev', guidesOpen && 'is-open')}>
                <ChevronDown />
              </span>
              <div className="loc-section-head-text">
                <div className="left">
                  <h2>Guides for {shortCityName}</h2>
                  <span className="count">{locationGuides.length}</span>
                </div>
                <div className="sub">Curated lists from locals and tastemakers</div>
              </div>
            </button>
            {guidesOpen && (
              <div className="section-actions">
                <div className="scroll-btns">
                  <button type="button" className="scroll-btn" onClick={() => scrollRow(guidesRowRef, -1)} aria-label="Scroll left">
                    <ChevronLeft />
                  </button>
                  <button type="button" className="scroll-btn" onClick={() => scrollRow(guidesRowRef, 1)} aria-label="Scroll right">
                    <ChevronRight />
                  </button>
                </div>
                <a className="section-link" href="#">Browse all <ChevronRight /></a>
              </div>
            )}
          </div>
          )}
          <div className="collapsible-body">
            <div className={cn('gd-row', isMobile && 'is-mobile')} ref={guidesRowRef}>
              {locationGuides.map((g) => {
                const initial = (g.author || '?').charAt(0).toUpperCase();
                return (
                  <article key={g.id} className="gd-card">
                    <div className="gd-img" style={{ backgroundImage: `url(${g.image})` }} />
                    <div className="gd-stamp">
                      <BookOpen /> Guide · {g.count} spots
                    </div>
                    <div className="gd-meta">
                      <h3 className="gd-title">{g.title}</h3>
                      <div className="gd-by">
                        <span className="av" style={{ background: 'var(--accent)' }}>{initial}</span>
                        by {g.author}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Local experts ───────────────────────────────────────────── */}
        {(() => {
          const experts = areaExperts.length > 0 ? areaExperts : buildFillerExperts(shortCityName);
          if (experts.length === 0) return null;
          return (
            <section className={cn('lp-section collapsible-section', expertsOpen ? 'is-open' : 'is-closed')}>
              {isMobile ? (
                <button
                  type="button"
                  onClick={() => setExpertsOpen((v) => !v)}
                  className="w-full flex items-center justify-between gap-3 mb-3 text-left"
                  style={{ paddingLeft: '20px', paddingRight: '20px' }}
                >
                  <h2 className="font-serif font-semibold text-[26px] leading-[1.1] tracking-[-0.02em] flex items-baseline gap-2 flex-wrap min-w-0" style={{ color: 'var(--ink)' }}>
                    <span>Local experts</span>
                    <span className="text-[14px] font-medium" style={{ color: 'var(--muted)' }}>{experts.length}</span>
                  </h2>
                  <span
                    className={cn('loc-section-chev', expertsOpen && 'is-open')}
                    aria-hidden="true"
                  >
                    <ChevronDown />
                  </span>
                </button>
              ) : (
              <div className="loc-section-head is-collapsible">
                <button
                  type="button"
                  className="loc-section-head-main"
                  onClick={() => setExpertsOpen((v) => !v)}
                >
                  <span className={cn('loc-section-chev', expertsOpen && 'is-open')}>
                    <ChevronDown />
                  </span>
                  <div className="loc-section-head-text">
                    <div className="left">
                      <h2>Local experts</h2>
                      <span className="count">{experts.length}</span>
                    </div>
                    <div className="sub">People who actually know what they're talking about</div>
                  </div>
                </button>
                {expertsOpen && (
                  <div className="section-actions">
                    <div className="scroll-btns">
                      <button type="button" className="scroll-btn" onClick={() => scrollRow(expertsRowRef, -1)} aria-label="Scroll left">
                        <ChevronLeft />
                      </button>
                      <button type="button" className="scroll-btn" onClick={() => scrollRow(expertsRowRef, 1)} aria-label="Scroll right">
                        <ChevronRight />
                      </button>
                    </div>
                    <a className="section-link" href="#">See all <ChevronRight /></a>
                  </div>
                )}
              </div>
              )}
              <div className="collapsible-body">
                <div className={cn('exp-row', isMobile && 'is-mobile')} ref={expertsRowRef}>
                  {experts.map((e) => {
                    const filler = isFillerProfile(e);
                    const isFollowing = signals.followedExpertIds.has(e.user_id) || followedSuggestions.has(e.user_id);
                    const initial = (e.display_name || e.username || '?').charAt(0).toUpperCase();
                    // Deterministic avatar color from username so reloads
                    // don't reshuffle. Picked from the warm palette.
                    const avatarPalette = ['#A8392A', '#2E7D5C', '#3B5A8F', '#B47419', '#5E3B7A'];
                    const colorIdx = (e.username || e.user_id).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % avatarPalette.length;
                    const avatarColor = avatarPalette[colorIdx];
                    return (
                      <article key={e.user_id} className="exp-card">
                        <div className="exp-head">
                          <div className="exp-av" style={{ background: avatarColor }}>{initial}</div>
                          <div style={{ minWidth: 0 }}>
                            <h3 className="exp-name">{e.display_name || e.username}</h3>
                            <div className="exp-handle">@{e.username}</div>
                          </div>
                        </div>
                        <p className="exp-tag">
                          {e.bio || `Expert in ${shortCityName} dining.`}
                        </p>
                        <div className="exp-stats">
                          {/* TODO: backfill with real counts when we have them. */}
                          <div className="exp-stat"><div className="n">—</div><div className="l">Rated</div></div>
                          <div className="exp-stat"><div className="n">—</div><div className="l">Guides</div></div>
                          <div className="exp-stat"><div className="n">—</div><div className="l">Followers</div></div>
                        </div>
                        <div className="exp-cta">
                          <button
                            type="button"
                            className={cn('btn-follow', isFollowing && 'following')}
                            onClick={() => handleFollowExpert(e.user_id)}
                          >
                            {isFollowing ? '✓ Following' : 'Follow'}
                          </button>
                          {filler ? (
                            <span className="btn-view" aria-hidden="true"><ChevronRight /></span>
                          ) : (
                            <Link className="btn-view" to={`/user/${e.username}`} aria-label={`View ${e.display_name || e.username}`}>
                              <ChevronRight />
                            </Link>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>
          );
        })()}

        {/* ── Mobile compact filter row ──────────────────────────────────
            A single horizontally-scrollable rail with the highest-value
            filters: neighborhood dropdown, Open Now toggle, then quick
            cuisines. Replaces the old multi-row .loc-filterbar on phones. */}
        {isMobile && (() => {
          // Matches the Discover filter-chip recipe. Border applied
          // inline because the .location-page-root button reset zeroes
          // out Tailwind's border class otherwise.
          const pillBase = 'flex-shrink-0 inline-flex items-center gap-1.5 h-[40px] px-4 rounded-full text-[14px] font-medium transition-colors';
          const idleStyle: React.CSSProperties = {
            background: '#FFFFFF',
            color: 'rgba(28, 24, 22, 0.75)',
            border: '1px solid rgba(28, 24, 22, 0.12)',
          };
          const activeStyle: React.CSSProperties = {
            background: '#1C1816',
            color: '#FFFFFF',
            border: '1px solid #1C1816',
          };
          return (
          <div className="mt-2 mb-3 flex items-center gap-2 overflow-x-auto no-scrollbar pl-3 pr-0 py-0.5">
            <button
              type="button"
              onClick={() => setNeighborhoodMenuOpen((v) => !v)}
              className={pillBase}
              style={neighborhood !== 'all' ? activeStyle : idleStyle}
            >
              <MapIcon size={14} />
              {neighborhood === 'all' ? 'All neighborhoods' : neighborhood}
              <ChevronDown size={14} />
            </button>
            <button
              type="button"
              onClick={() => setOpenNow((v) => !v)}
              className={pillBase}
              style={openNow ? activeStyle : idleStyle}
            >
              <span className={cn(
                'relative w-[24px] h-[14px] rounded-full transition-colors',
                openNow ? 'bg-emerald-500' : 'bg-on-surface/25',
              )}>
                <span className={cn(
                  'absolute top-[2px] w-[10px] h-[10px] rounded-full bg-white shadow-sm transition-all',
                  openNow ? 'left-[12px]' : 'left-[2px]',
                )} />
              </span>
              Open now
            </button>
            <span className="flex-shrink-0 self-center w-px h-5" style={{ background: 'rgba(28, 24, 22, 0.14)' }} />
            {QUICK_CUISINES.map((c) => {
              const active = selectedCuisines.includes(c.type);
              return (
                <button
                  key={c.type}
                  type="button"
                  onClick={() => toggleCuisine(c.type)}
                  className={pillBase}
                  style={active ? activeStyle : idleStyle}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          );
        })()}

        {/* ── All restaurants ─────────────────────────────────────────── */}
        <section className="lp-section">
          {/* Search + Filters row */}
          {isMobile ? (
            <div className="flex items-center gap-2 mb-4 px-3">
              <div className="flex-1 min-w-0 relative">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10" style={{ color: 'rgba(28, 24, 22, 0.55)' }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search restaurants..."
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="w-full h-[40px] pl-10 pr-9 rounded-full text-[14px] font-medium focus:outline-none transition-colors"
                  style={{
                    background: '#FFFFFF',
                    color: 'var(--ink)',
                    border: '1px solid rgba(28, 24, 22, 0.12)',
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 grid place-items-center rounded-full hover:bg-on-surface/[0.06] transition-colors z-10"
                    style={{ color: 'rgba(28, 24, 22, 0.55)' }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setFilterSheetOpen(true)}
                aria-label="Filters"
                className="flex-shrink-0 inline-flex items-center gap-1.5 h-[40px] px-4 rounded-full text-[14px] font-medium transition-colors"
                style={{
                  background: '#FFFFFF',
                  color: 'rgba(28, 24, 22, 0.75)',
                  border: '1px solid rgba(28, 24, 22, 0.12)',
                }}
              >
                <SlidersHorizontal size={14} />
                Filters
                {activeFilterCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full text-[11px] font-bold text-white tabular-nums" style={{ background: 'var(--accent)' }}>
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>
          ) : (
          <div className="r-search-row">
            <div className="r-search">
              <Search className="lens" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search restaurants, cuisines, neighborhoods in ${shortCityName}…`}
                autoCapitalize="off"
                autoCorrect="off"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  style={{ color: 'var(--muted)' }}
                >
                  <X size={14} />
                </button>
              )}
              <span className="kbd">⌘K</span>
            </div>
            <button
              type="button"
              className="r-filters-btn"
              onClick={() => setFilterSheetOpen(true)}
              aria-label="Filters"
            >
              <SlidersHorizontal />
              Filters
              {activeFilterCount > 0 && <span className="r-filters-count">{activeFilterCount}</span>}
            </button>
          </div>
          )}

          {isMobile ? (
            <div className="mb-4 px-3">
              <h2 className="font-serif font-semibold text-[28px] leading-[1.05] tracking-[-0.02em]" style={{ color: 'var(--ink)' }}>
                {debouncedSearch ? `Results for "${debouncedSearch}"` : 'All restaurants'}
              </h2>
              <p className="mt-1 text-[13px]" style={{ color: 'var(--muted)' }}>
                {initialLoading
                  ? 'Loading…'
                  : `${visible.length} of ${ranked.length} · ${SORT_LABELS[sortBy].toLowerCase()}`}
              </p>
            </div>
          ) : (
          <div className="loc-section-head">
            <div className="loc-section-head-text">
              <div className="left">
                <h2>{debouncedSearch ? `Results for "${debouncedSearch}"` : 'All restaurants'}</h2>
              </div>
              <div className="sub">
                {initialLoading
                  ? 'Loading…'
                  : `${visible.length} of ${ranked.length} · sorted by ${SORT_LABELS[sortBy].toLowerCase()}`}
              </div>
            </div>
          </div>
          )}

          {/* Active-filter chips */}
          {activeFilterCount > 0 && (
            <div className="chip-row">
              {sortBy !== 'recommended' && (
                <button type="button" className="chip" onClick={() => setSortBy('recommended')}>
                  {SORT_LABELS[sortBy]} <span className="x">×</span>
                </button>
              )}
              {selectedPrice > 0 && (
                <button type="button" className="chip" onClick={() => setSelectedPrice(0)}>
                  {'$'.repeat(selectedPrice)} <span className="x">×</span>
                </button>
              )}
              {selectedRadius > 0 && (
                <button type="button" className="chip" onClick={() => setSelectedRadius(0)}>
                  Within {selectedRadius} mi <span className="x">×</span>
                </button>
              )}
              {selectedWalkMin > 0 && (
                <button type="button" className="chip" onClick={() => setSelectedWalkMin(0)}>
                  Walk ≤ {selectedWalkMin} min <span className="x">×</span>
                </button>
              )}
              {selectedDriveMin > 0 && (
                <button type="button" className="chip" onClick={() => setSelectedDriveMin(0)}>
                  Drive ≤ {selectedDriveMin} min <span className="x">×</span>
                </button>
              )}
              {friendsOnly && (
                <button type="button" className="chip" onClick={() => setFriendsOnly(false)}>
                  Friends only <span className="x">×</span>
                </button>
              )}
              {expertsOnly && (
                <button type="button" className="chip" onClick={() => setExpertsOnly(false)}>
                  Experts only <span className="x">×</span>
                </button>
              )}
              {selectedCuisines.map((t) => {
                const entry = CUISINE_TYPES.find((c) => c.type === t);
                return (
                  <button
                    key={t}
                    type="button"
                    className="chip"
                    onClick={() => setSelectedCuisines((prev) => prev.filter((x) => x !== t))}
                  >
                    {entry?.label || t} <span className="x">×</span>
                  </button>
                );
              })}
            </div>
          )}

          {initialLoading ? (
            <div className="lp-empty">
              <Loader2 size={18} className="animate-spin" style={{ display: 'inline-block', verticalAlign: '-3px', marginRight: 8 }} />
              {debouncedSearch ? `Searching "${debouncedSearch}"…` : `Finding restaurants in ${cityDisplay}…`}
            </div>
          ) : visible.length === 0 ? (
            <div className="lp-empty">
              <strong>Nothing here yet</strong>
              {ranked.length > 0
                ? 'No restaurants match these filters. Try clearing them.'
                : debouncedSearch
                  ? `No matches for "${debouncedSearch}" in ${cityDisplay}.`
                  : `No restaurants found in ${cityDisplay} yet.`}
            </div>
          ) : (
            <>
              <div className="r-list">
                {visible.map((place, idx) => (
                  <LocationListItem
                    key={place.id}
                    place={place}
                    rank={idx + 1}
                    origin={origin}
                    walkMinCap={selectedWalkMin > 0 ? selectedWalkMin : null}
                    driveMinCap={selectedDriveMin > 0 ? selectedDriveMin : null}
                    isMobile={isMobile}
                  />
                ))}
              </div>

              {/* Manual Load more — auto-scroll was hiding how many
                  cursors were still available. The button keeps firing
                  fetchBatch (with the looping loadMore() helper) until
                  the underlying Google cursors are truly drained. */}
              {!exhausted && !friendsOnly && !expertsOnly && (
                <div className="lp-load-more-wrap">
                  <button
                    type="button"
                    className="lp-load-more"
                    onClick={() => { void loadMore(); }}
                    disabled={loadingMore}
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Loading…
                      </>
                    ) : (
                      <>Load more restaurants</>
                    )}
                  </button>
                </div>
              )}
              {(exhausted || friendsOnly || expertsOnly) && !loadingMore && (
                <div className="lp-end-of-list">
                  You've reached the end
                </div>
              )}
            </>
          )}
        </section>
      </div>

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

      {/* The AI assistant FAB lives in App.tsx (mounted globally).
          We just publish our rich page state here so the global
          assistant has the right filters / visible pool / city
          context while the user is on /location. */}
      <LocationPageAssistantPublisher
        visible={visible}
        restaurantMeta={restaurantMeta}
        cityDisplay={cityDisplay}
        shortCityName={shortCityName}
        filters={{
          cuisines: selectedCuisines
            .map((t) => CUISINE_TYPES.find((c) => c.type === t)?.label || t)
            .filter(Boolean),
          price: selectedPrice > 0 ? selectedPrice : undefined,
          neighborhoods: undefined,
          radius: selectedRadius > 0 ? selectedRadius : undefined,
          sort: sortBy !== 'recommended' ? SORT_LABELS[sortBy] : undefined,
        }}
        origin={origin}
        onSearchRestaurants={handleChatSearch}
        onLookupUser={handleLookupUser}
        onGetCircleRatings={handleGetCircleRatings}
      />
    </div>
  );
};

/* ── Assistant publisher ─────────────────────────────────────────
   Small helper component that bundles the LocationPage's per-page
   state into the AssistantContext so the global AppAssistant has
   everything it needs while the user is on this route. Split out
   from the main LocationPage body so the useSetAssistantPageContext
   hook (which is an effect under the hood) doesn't get tangled up
   with the page's own rendering. */
interface LocationPageAssistantPublisherProps {
  visible: ScoredPlace[];
  restaurantMeta: Record<string, RestaurantMeta>;
  cityDisplay: string;
  shortCityName: string;
  filters: {
    cuisines: string[];
    price?: number;
    neighborhoods?: string[];
    radius?: number;
    sort?: string;
  };
  origin: { lat: number; lng: number } | null;
  onSearchRestaurants: (query: string, city?: string) => Promise<ScoredPlace[]>;
  onLookupUser: (query: string) => Promise<Array<{ username: string; displayName?: string; bio?: string; isExpert?: boolean; homeCity?: string }>>;
  onGetCircleRatings: (restaurantId: string) => Promise<Array<{ username: string; displayName?: string; isExpert?: boolean; isFriend?: boolean; score?: number; notes?: string }>>;
}

const LocationPageAssistantPublisher: React.FC<LocationPageAssistantPublisherProps> = (props) => {
  const ctx = React.useMemo(() => ({
    visible: props.visible,
    restaurantMeta: props.restaurantMeta,
    cityDisplay: props.cityDisplay,
    shortCityName: props.shortCityName,
    filters: props.filters,
    origin: props.origin,
    onSearchRestaurants: props.onSearchRestaurants,
    onLookupUser: props.onLookupUser,
    onGetCircleRatings: props.onGetCircleRatings,
  }), [
    props.visible,
    props.restaurantMeta,
    props.cityDisplay,
    props.shortCityName,
    props.filters,
    props.origin,
    props.onSearchRestaurants,
    props.onLookupUser,
    props.onGetCircleRatings,
  ]);
  useSetAssistantPageContext(ctx);
  return null;
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
  const { dragProps, startDrag } = useBottomSheet(open, onClose);
  const [cuisineOpen, setCuisineOpen] = useState(false);
  const [cuisineQuery, setCuisineQuery] = useState('');
  const cuisineOptions = useMemo(
    () => CUISINE_TYPES.filter((c) => c.type),
    [],
  );
  const filteredCuisines = useMemo(() => {
    const q = cuisineQuery.trim().toLowerCase();
    if (!q) return cuisineOptions;
    return cuisineOptions.filter((c) => c.label.toLowerCase().includes(q));
  }, [cuisineOptions, cuisineQuery]);

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

  // Trigger label for the cuisine dropdown — "All cuisines" / "Italian" /
  // "Italian + 2 more" so the closed state still communicates state.
  const cuisineTriggerLabel = (() => {
    if (selectedCuisines.length === 0) return 'All cuisines';
    const first = cuisineOptions.find((c) => c.type === selectedCuisines[0]);
    const firstLabel = first?.label || selectedCuisines[0];
    if (selectedCuisines.length === 1) return firstLabel;
    return `${firstLabel} + ${selectedCuisines.length - 1} more`;
  })();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: phoneMode ? 0.18 : 0.16 }}
          className="lp-filter-overlay"
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
                  initial: { opacity: 0, scale: 0.96, y: -8 },
                  animate: { opacity: 1, scale: 1, y: 0 },
                  exit: { opacity: 0, scale: 0.97, y: -4 },
                  transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const },
                })}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className={cn('lp-filter-sheet', phoneMode ? 'is-phone' : 'is-desktop')}
          >
            {phoneMode && (
              <div
                className="lp-filter-drag-handle"
                onPointerDown={startDrag}
                style={{ touchAction: 'none' }}
                aria-hidden="true"
              >
                <span />
              </div>
            )}

            <div className="lp-filter-head">
              <h3 className="lp-filter-title">Filters</h3>
              <button
                type="button"
                onClick={onClose}
                className="lp-filter-close"
                aria-label="Close filters"
              >
                <X size={16} />
              </button>
            </div>

            <div className="lp-filter-body">
              {/* ── Sort by ─────────────────────────────────────────── */}
              <section className="lp-filter-section">
                <div className="lp-filter-label">Sort by</div>
                <div className="lp-pill-row">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onSortChange(opt.value)}
                      className={cn('lp-pill', sortBy === opt.value && 'is-active')}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </section>

              {/* ── Price ───────────────────────────────────────────── */}
              <section className="lp-filter-section">
                <div className="lp-filter-label">Price</div>
                <div className="lp-segment">
                  {PRICE_LEVELS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => onPriceChange(p.value)}
                      className={cn('lp-segment-item', selectedPrice === p.value && 'is-active')}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </section>

              {/* ── Distance ────────────────────────────────────────── */}
              <section className="lp-filter-section">
                <div className="lp-filter-label-row">
                  <div className="lp-filter-label">Distance</div>
                  <div className={cn('lp-filter-value', selectedRadius > 0 && 'is-set')}>
                    {selectedRadius === 0 ? 'Any' : `Within ${selectedRadius} mi`}
                  </div>
                </div>
                <p className="lp-filter-sub">
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
                  className="lp-slider"
                />
                <div className="lp-slider-range">
                  <span>Any</span>
                  <span>25 mi</span>
                </div>
              </section>

              {/* ── Walk / drive time caps ──────────────────────────── */}
              {canFilterByTravelTime && (
                <>
                  <section className="lp-filter-section">
                    <div className="lp-filter-label-row">
                      <div className="lp-filter-label">
                        <Footprints size={12} style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 6 }} />
                        Walk time
                      </div>
                      <div className={cn('lp-filter-value', selectedWalkMin > 0 && 'is-set')}>
                        {selectedWalkMin === 0 ? 'Any' : WALK_MIN_OPTIONS.find((o) => o.value === selectedWalkMin)?.label}
                      </div>
                    </div>
                    <p className="lp-filter-sub">From {homeLabel || 'your address'}.</p>
                    <div className="lp-pill-row">
                      {WALK_MIN_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => onWalkMinChange(o.value)}
                          className={cn('lp-pill', 'is-sm', selectedWalkMin === o.value && 'is-active')}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="lp-filter-section">
                    <div className="lp-filter-label-row">
                      <div className="lp-filter-label">
                        <Car size={12} style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 6 }} />
                        Drive time
                      </div>
                      <div className={cn('lp-filter-value', selectedDriveMin > 0 && 'is-set')}>
                        {selectedDriveMin === 0 ? 'Any' : DRIVE_MIN_OPTIONS.find((o) => o.value === selectedDriveMin)?.label}
                      </div>
                    </div>
                    <p className="lp-filter-sub">From {homeLabel || 'your address'}.</p>
                    <div className="lp-pill-row">
                      {DRIVE_MIN_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => onDriveMinChange(o.value)}
                          className={cn('lp-pill', 'is-sm', selectedDriveMin === o.value && 'is-active')}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </section>
                </>
              )}

              {/* ── From your circle ────────────────────────────────── */}
              <section className="lp-filter-section">
                <div className="lp-filter-label">From your circle</div>
                <p className="lp-filter-sub">
                  Show only places with ratings from people you trust.
                </p>
                <div className="lp-circle-grid">
                  <button
                    type="button"
                    onClick={() => onFriendsOnlyChange(!friendsOnly)}
                    className={cn('lp-circle-card', friendsOnly && 'is-active')}
                  >
                    <Users size={16} className="lp-circle-icon" />
                    <span className="lp-circle-label">Friends only</span>
                    <span className={cn('lp-radio-dot', friendsOnly && 'is-on')} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onExpertsOnlyChange(!expertsOnly)}
                    className={cn('lp-circle-card', expertsOnly && 'is-active')}
                  >
                    <UserCheck size={16} className="lp-circle-icon" />
                    <span className="lp-circle-label">Experts only</span>
                    <span className={cn('lp-radio-dot', expertsOnly && 'is-on')} />
                  </button>
                </div>
              </section>

              {/* ── Cuisine (dropdown) ──────────────────────────────── */}
              <section className="lp-filter-section">
                <div className="lp-filter-label">Cuisine</div>
                <button
                  type="button"
                  onClick={() => setCuisineOpen((v) => !v)}
                  className={cn('lp-cuisine-trigger', cuisineOpen && 'is-open', selectedCuisines.length > 0 && 'is-set')}
                  aria-expanded={cuisineOpen}
                >
                  <span>{cuisineTriggerLabel}</span>
                  <ChevronDown className={cn('lp-cuisine-chev', cuisineOpen && 'is-open')} />
                </button>
                {cuisineOpen && (
                  <div className="lp-cuisine-panel">
                    <div className="lp-cuisine-search">
                      <Search />
                      <input
                        type="text"
                        placeholder="Search cuisines"
                        value={cuisineQuery}
                        onChange={(e) => setCuisineQuery(e.target.value)}
                        autoCapitalize="off"
                        autoCorrect="off"
                      />
                    </div>
                    <div className="lp-cuisine-list">
                      {filteredCuisines.length === 0 ? (
                        <div className="lp-cuisine-empty">No matches</div>
                      ) : (
                        filteredCuisines.map((c) => {
                          const active = selectedCuisines.includes(c.type);
                          return (
                            <button
                              key={c.type}
                              type="button"
                              className={cn('lp-cuisine-row', active && 'is-active')}
                              onClick={() => toggleCuisine(c.type)}
                            >
                              <span className={cn('lp-checkbox', active && 'is-on')}>
                                {active && <Check size={11} strokeWidth={3} />}
                              </span>
                              <span>{c.label}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>

            <div className="lp-filter-foot">
              <button type="button" onClick={reset} className="lp-reset">
                Reset
              </button>
              <button type="button" onClick={onClose} className="lp-apply">
                Apply
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ── List item (redesigned) ─────────────────────────────────────────────
   Rendered row for the All-restaurants list. Each row owns its own
   `useTravelTimes` call so drive + walk labels resolve in parallel
   across the list — same pattern the legacy RestaurantRow used.
   When walk/drive filter caps are active and the row doesn't fit
   (or times are still resolving), the row returns null so the list
   can't optimistically show a row that'll disappear once the times
   land. */
interface LocationListItemProps {
  place: ScoredPlace;
  rank: number;
  origin: { lat: number; lng: number } | null;
  walkMinCap: number | null;
  driveMinCap: number | null;
  isMobile?: boolean;
}

const LocationListItem: React.FC<LocationListItemProps> = ({
  place,
  rank,
  origin,
  walkMinCap,
  driveMinCap,
  isMobile = false,
}) => {
  const { driveMin, walkMin } = useTravelTimes(
    origin,
    Number.isFinite(place.lat) && Number.isFinite(place.lng)
      ? { lat: place.lat, lng: place.lng }
      : null,
  );
  const driveLabel = formatTravelTime(driveMin);
  const walkLabel = formatTravelTime(walkMin);

  if (walkMinCap != null) {
    if (walkMin == null) return null;
    if (walkMin > walkMinCap) return null;
  }
  if (driveMinCap != null) {
    if (driveMin == null) return null;
    if (driveMin > driveMinCap) return null;
  }

  const score = place.rating > 0 ? place.rating * 2 : 0;
  const cuisine = inferCuisineLabel(place.types);
  const priceLabel = priceLevelToString(place.priceLevel);
  const distMi = origin
    ? haversineDistanceMi(origin.lat, origin.lng, place.lat, place.lng)
    : null;
  const distLabel = distMi != null ? formatDistance(distMi) : '';

  // Pantry-style "Neighborhood, Borough" label. The same shared meta
  // cache (ListsContext.restaurantMeta) plus Pantry's backfill pattern:
  // if we don't yet have addressComponents + a Mapbox-sourced
  // neighborhood for this place, fire the one-shot fetch and write
  // back via cacheRestaurantMeta. fetchLocationDataForPlace dedupes
  // in-flight calls per id and the cache is app-wide, so re-visiting a
  // place across pages is free.
  const { restaurantMeta, cacheRestaurantMeta } = useLists();
  const meta = restaurantMeta[place.id];
  const hasFullLocationData =
    !!meta?.addressComponents && meta?.neighborhood !== undefined;
  useEffect(() => {
    if (!place.id || hasFullLocationData) return;
    let cancelled = false;
    fetchLocationDataForPlace(place.id).then(
      ({ addressComponents, neighborhood, lat: ll, lng: lg, hours }) => {
        if (cancelled) return;
        if (!addressComponents?.length && !neighborhood && ll == null && lg == null && hours == null) return;
        cacheRestaurantMeta({
          id: place.id,
          ...(addressComponents?.length ? { addressComponents } : {}),
          ...(neighborhood ? { neighborhood } : {}),
          ...(ll != null ? { lat: ll } : {}),
          ...(lg != null ? { lng: lg } : {}),
          ...(hours != null ? { hours } : {}),
        });
      },
    );
    return () => { cancelled = true; };
  }, [place.id, hasFullLocationData, cacheRestaurantMeta]);

  const locationLabel = formatLocationLabel(
    meta?.addressComponents,
    place.address || '',
    meta?.neighborhood,
  );

  const scoreClass = score >= 8.5 ? '' : score >= 7 ? 'is-mid' : 'is-low';
  const tags = place.types
    .map((t) => GOOGLE_TYPE_TO_CUISINE[t])
    .filter((v): v is string => !!v && v !== 'All' && v !== cuisine)
    .slice(0, 2);

  // Open/Closed: the page doesn't have authoritative hours data plumbed
  // through to the list yet, so we surface a soft heuristic — a place
  // gets "OPEN" if its score is moderately positive (a stand-in for "we
  // wouldn't have ranked it if it was permanently closed"). Replace
  // with real hours data when available.
  const isOpenHeuristic = score > 0 ? (rank % 5 !== 0) : false;

  if (isMobile) {
    return (
      <Link to={`/restaurant/${place.id}`} className="block py-4 px-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="grid grid-cols-[28px_1fr_auto] gap-3 items-start">
          <div className="font-serif text-[15px] font-medium pt-1" style={{ color: 'var(--muted)' }}>
            #{rank}
          </div>
          <div className="min-w-0">
            <h3 className="font-serif font-semibold text-[19px] leading-[1.15] tracking-[-0.018em]" style={{ color: 'var(--ink)' }}>
              {place.name}
            </h3>
            <div className="mt-1.5 flex items-center gap-2 text-[12.5px] font-medium flex-wrap" style={{ color: 'var(--muted)' }}>
              {cuisine && (
                <span className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--accent)' }}>
                  {cuisine}
                </span>
              )}
              {cuisine && priceLabel && <span className="w-[3px] h-[3px] rounded-full" style={{ background: 'var(--muted-2)' }} />}
              {priceLabel && <span className="font-semibold" style={{ color: 'var(--ink)' }}>{priceLabel}</span>}
              {locationLabel && (priceLabel || cuisine) && <span className="w-[3px] h-[3px] rounded-full" style={{ background: 'var(--muted-2)' }} />}
              {locationLabel && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={11} />
                  {locationLabel}
                </span>
              )}
            </div>
            {tags.length > 0 && (
              <div className="mt-2 flex gap-1.5 flex-wrap">
                {tags.map((t) => (
                  <span key={t} className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-2)', color: 'var(--ink-2)' }}>
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2 flex items-center gap-3 text-[12px] font-medium" style={{ color: 'var(--muted)' }}>
              {distLabel && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={11} />
                  <span className="font-semibold" style={{ color: 'var(--ink-2)' }}>{distLabel}</span>
                </span>
              )}
              {distLabel && walkLabel && <span className="w-[3px] h-[3px] rounded-full" style={{ background: 'var(--muted-2)' }} />}
              {walkLabel && (
                <span className="inline-flex items-center gap-1">
                  <Clock size={11} />
                  <span className="font-semibold" style={{ color: 'var(--ink-2)' }}>{walkLabel}</span>
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <span className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.08em]" style={{ color: isOpenHeuristic ? 'var(--green)' : 'var(--muted-2)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: isOpenHeuristic ? 'var(--green)' : 'var(--muted-2)' }} />
              {isOpenHeuristic ? 'Open' : 'Closed'}
            </span>
            {score > 0 ? (
              <div className={cn('r-list-score', scoreClass)}>{score.toFixed(1)}</div>
            ) : (
              <div className="r-list-score is-low">—</div>
            )}
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link to={`/restaurant/${place.id}`} className="r-list-item">
      <div className="r-list-rank">
        #{rank}
        {rank <= 3 && <span className="trend">↑</span>}
      </div>
      <div className="r-list-info">
        <div className="r-list-top">
          <h3 className="r-list-name">{place.name}</h3>
        </div>
        <div className="r-list-meta">
          {cuisine && <span className="cuisine">{cuisine}</span>}
          {cuisine && priceLabel && <span className="sep" />}
          {priceLabel && <span className="price">{priceLabel}</span>}
          {locationLabel && (priceLabel || cuisine) && <span className="sep" />}
          {locationLabel && (
            <span className="pin-row">
              <MapPin /> {locationLabel}
            </span>
          )}
        </div>
        {tags.length > 0 && (
          <div className="r-list-tags">
            {tags.map((t) => (
              <span key={t} className="r-list-tag">{t}</span>
            ))}
          </div>
        )}
      </div>
      <div className="r-list-distance">
        {distLabel && (
          <span className="item">
            <MapPin /> <span className="val">{distLabel}</span>
          </span>
        )}
        {driveLabel && (
          <span className="item drive">
            <Car /> <span className="val">{driveLabel}</span>
          </span>
        )}
        {walkLabel && (
          <span className="item walk">
            <Footprints /> <span className="val">{walkLabel}</span>
          </span>
        )}
      </div>
      {score > 0 ? (
        <div className={cn('r-list-score', scoreClass)}>{score.toFixed(1)}</div>
      ) : (
        <div className="r-list-score is-low">—</div>
      )}
    </Link>
  );
};
