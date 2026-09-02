import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import { attachMapErrorFallback } from '../lib/map-error';
// @ts-ignore - Vite worker import for mapbox-gl CSP compatibility
import MapboxWorker from 'mapbox-gl/dist/mapbox-gl-csp-worker?worker';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MAPBOX_TOKEN } from '../lib/keys';
import { ArrowLeft, BookOpen, Car, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Footprints, LayoutGrid, Loader2, Map as MapIcon, MapPin, Maximize2, Minimize2, Search, SlidersHorizontal, Soup, UserCheck, Users, X } from 'lucide-react';
import { ShareIcon } from '../components/icons/ShareIcon';
import './LocationPage.css';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { cuisineLabel } from '../lib/cuisine';
import { getTasteQuiz } from '../lib/taste-quiz';
import { sampleRatings, buildTasteSummary } from '../lib/assistant-taste';
import { scoreHex, scoreTintStyle, formatScore } from '../lib/score';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { shareExternally, canonicalShareUrl } from '../lib/native-share';
import { useAuth } from '../contexts/AuthContext';
import { useLists, type RestaurantMeta } from '../contexts/ListsContext';
import { useRecipes, type Recipe as DbRecipe } from '../contexts/RecipesContext';
import { useSettings } from '../contexts/SettingsContext';
import {
  searchPlacesByTextPaged,
  priceLevelToString,
  CUISINE_TYPES,
  formatLocationLabel,
  fetchLocationDataForPlace,
  getPlaceDetails,
  resolvePlaceIdByNameCoords,
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
  countsForCommunity,
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
import { getOpenStatus } from '../lib/useRestaurantLocationLabel';
import { useMichelinMatch, useMichelinIndexReady } from '../lib/useMichelinMatch';
import { MichelinMark } from '../components/MichelinBadge';
import { findMichelinMatchSync, michelinPriceDisplay, passesMichelinFilter, michelinNearbySync, michelinToPlaceResult, isMichelinSyntheticId, parseMichelinSyntheticId } from '../lib/michelin';
import type { UserContext } from '../lib/location-chat-client';
import { formatTravelTime, useTravelTimes } from '../lib/directions';
import {
  HomeLocationBar,
  isExactAddress,
  loadLastSelectedLocation,
  getCurrentHomeLocation,
  geocodePlace,
  type HomeLocation,
} from '../components/HomeLocationBar';
import { useSetAssistantPageContext } from '../contexts/AssistantContext';
import { GuidesBrowser, type BrowseGuide } from '../components/GuidesBrowser';
import { getGuidesForLocation, getGuideSaveCounts, type Guide as GuideRow } from '../lib/supabase-guides';
import { useHeaderFade } from '../lib/useHeaderFade';
import { FilterSheet as FilterSheetShell } from '../components/FilterSheet';
import {
  FilterDrillSection,
  FilterSection,
  HoursFilterSection,
  Pill,
  PillRow,
  Segment,
  SegmentItem,
} from '../components/filterPrimitives';
import { MichelinDrillSection } from '../components/MichelinDistinctionFilter';
import { passesHoursFilter, isHoursFilterActive, emptyHoursFilter, type HoursFilter, restaurantLocalNow } from '../lib/hours';
import { SearchField } from '../components/SearchField';
import { GlassButton } from '../lib/glass-buttons';

/* ── Guide card view-model ────────────────────────────────────────────────────
   The Guides rail renders real, published guides for the selected city
   (fetched via getGuidesForLocation — either tagged with the city or
   containing at least one spot in it). Each card needs only this
   denormalized shape; the author byline is resolved from the guide's
   user_id. */
type LocationGuideCard = {
  id: string;
  title: string;
  author: string;
  image: string;
  count: number;
};

/** Whole days between an ISO timestamp and now (clamped at 0). Drives the
 *  "Browse all" popup's recency sort + "Updated" label for real guides. */
function daysSinceIso(iso?: string): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
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
/** Cuisine for a place — one shared resolver (lib/cuisine), so this page,
 *  LocationChat and the restaurant detail can't drift apart. */
const inferCuisineLabel = cuisineLabel;

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

// Marker pin background colour — the shared score-tier hexes (lib/score),
// so the map reads on the same scale as the list-row score badges.
function miniMapMarkerColor(googleRating: number): string {
  const score = googleRating * 2;
  if (score > 0) return scoreHex(score);
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
  // Michelin dataset readiness — gates the sync matcher used by the map-marker
  // popup below (overrides cuisine/price for starred/Bib restaurants).
  const michelinReady = useMichelinIndexReady();
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
  // Mobile header (back · location pill · share) dissolves with scroll,
  // Discover-style, and returns near the top.
  const headerFade = useHeaderFade({ enabled: isMobile, windowScroll: true });
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

  // Real, published guides for this city — tagged with the city or
  // containing at least one spot in it. Fetched per city; authors resolved
  // for the byline. `guidesLoaded` distinguishes "still fetching" from
  // "genuinely none" so the empty state doesn't flash on first paint.
  const [guideRows, setGuideRows] = useState<GuideRow[]>([]);
  const [guideAuthors, setGuideAuthors] = useState<Record<string, UserProfile>>({});
  const [guidesLoaded, setGuidesLoaded] = useState(false);

  useEffect(() => {
    if (!shortCityName.trim()) {
      setGuideRows([]);
      setGuidesLoaded(true);
      return;
    }
    let cancelled = false;
    setGuidesLoaded(false);
    setGuideRows([]);
    (async () => {
      const rows = await getGuidesForLocation({ city: shortCityName, limit: 30 });
      if (cancelled) return;
      setGuideRows(rows);
      const authorIds = Array.from(new Set(rows.map((g) => g.userId)));
      if (authorIds.length > 0) {
        const authors = await getProfilesByIds(authorIds);
        if (!cancelled) setGuideAuthors((prev) => ({ ...prev, ...authors }));
      }
      if (!cancelled) setGuidesLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [shortCityName]);

  const guideAuthorName = useCallback(
    (userId: string): string => {
      const a = guideAuthors[userId];
      return a?.display_name || a?.username || 'A local';
    },
    [guideAuthors],
  );

  const locationGuides = useMemo<LocationGuideCard[]>(
    () => guideRows.map((g) => ({
      id: g.id,
      title: g.title.trim() || 'Untitled guide',
      author: guideAuthorName(g.userId),
      image: g.coverPhoto || '',
      count: g.entries.length,
    })),
    [guideRows, guideAuthorName],
  );

  // Real bookmark counts for the browse popup (guide_save_counts RPC).
  const [guideSaveCounts, setGuideSaveCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (guideRows.length === 0) { setGuideSaveCounts({}); return; }
    let cancelled = false;
    getGuideSaveCounts(guideRows.map((g) => g.id)).then((counts) => {
      if (!cancelled) setGuideSaveCounts(counts);
    });
    return () => { cancelled = true; };
  }, [guideRows]);

  // Same guides, shaped for the "Browse all" popup.
  const browseGuides = useMemo<BrowseGuide[]>(
    () => guideRows.map((g) => ({
      id: g.id,
      title: g.title.trim() || 'Untitled guide',
      author: guideAuthorName(g.userId),
      image: g.coverPhoto || '',
      count: g.entries.length,
      daysAgo: daysSinceIso(g.updatedAt),
      saves: guideSaveCounts[g.id],
    })),
    [guideRows, guideAuthorName, guideSaveCounts],
  );

  // User's taste profile, reused to score every batch we fetch. `recentViews`
  // isn't available here (it lives in Map.tsx state), which is fine: it only
  // affects a skip-set, and the cost of occasionally re-showing a recent view
  // on this page is negligible.
  const profile = useMemo(
    () => buildTasteProfile(ratings, wishlist, lists, [], getTasteQuiz(myProfile)),
    // michelinReady is a rebuild trigger: the profile's michelinTaste shares
    // are gated on the dataset index inside the builder, so the profile must
    // be rebuilt once the index loads (same pattern as the recs popup).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ratings, wishlist, lists, michelinReady, myProfile],
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
  // True once the area lookup has resolved — lets the Local experts section
  // tell "still loading" apart from "genuinely nobody here yet".
  const [areaLoaded, setAreaLoaded] = useState(false);
  // Optimistic "just followed / just requested" set so the suggestion
  // card buttons flip to their done state instantly, before the server
  // round-trip resolves.
  const [followedSuggestions, setFollowedSuggestions] = useState<Set<string>>(new Set());

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
          // Self-picked slider scores don't feed circle signals or the
          // "N friends rated" counts — they're not calibrated data.
          if (!countsForCommunity(row)) continue;
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
      setAreaLoaded(true);
      return;
    }
    let cancelled = false;
    setAreaLoaded(false);
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
      setAreaFriendCandidates(candidates.filter((p) => !p.is_verified));
      setAreaLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [hasCoords, lat, lng, userId]);

  // Reset optimistic-follow sets when the location changes — the cards
  // about to render will be a different set of people, and the previous
  // pending state shouldn't leak across cities.
  useEffect(() => {
    setFollowedSuggestions(new Set());
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
  // One failed Google call used to wedge the loading flags forever (no
  // try/finally anywhere on the fetch paths): the initial spinner never
  // cleared and Load More died disabled. loadError drives a visible
  // "Couldn't load — retry" affordance instead; retryToken re-arms the
  // initial-batch effect.
  const [loadError, setLoadError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
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
  // Michelin distinction filter (multi-select, OR). Empty = off.
  const [selectedMichelin, setSelectedMichelin] = useState<string[]>([]);
  const toggleMichelin = useCallback((d: string) => {
    setSelectedMichelin((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }, []);
  // Opening-hours filter (breakfast/lunch/dinner + open now). Empty = off.
  const [hoursFilter, setHoursFilter] = useState<HoursFilter>(emptyHoursFilter());
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const activeFilterCount =
    (selectedPrice > 0 ? 1 : 0) +
    selectedCuisines.length +
    (sortBy !== 'recommended' ? 1 : 0) +
    (selectedRadius > 0 ? 1 : 0) +
    (selectedWalkMin > 0 ? 1 : 0) +
    (selectedDriveMin > 0 ? 1 : 0) +
    (friendsOnly ? 1 : 0) +
    (expertsOnly ? 1 : 0) +
    (selectedMichelin.length > 0 ? 1 : 0) +
    (isHoursFilterActive(hoursFilter) ? 1 : 0);

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
    setLoadError(false);

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
        try {
          const fresh = await fetchBatch(INITIAL_BATCH_SIZE);
          if (cancelled) return;
          setPlacesPool(fresh);
        } catch (err) {
          if (cancelled) return;
          console.warn('[Location] search batch failed:', err);
          setLoadError(true);
        } finally {
          // ALWAYS clear the spinner — a rejected Google call used to leave
          // "Searching…" up forever with no way out.
          if (!cancelled) setInitialLoading(false);
        }
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
      try {
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
      } catch (err) {
        if (cancelled) return;
        console.warn('[Location] initial batch failed:', err);
        setLoadError(true);
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // `fetchBatch` already closes over lat/lng/city so listing it once is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCoords, lat, lng, cityKey, activeCacheKey, currentCuisinesKey, debouncedSearch, retryToken]);

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
    setLoadError(false);
    try {
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
    } catch (err) {
      console.warn('[Location] load more failed:', err);
      setLoadError(true);
    } finally {
      // Without this, one rejected page left loadingMore stuck true and
      // the button permanently disabled.
      setLoadingMore(false);
    }
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
    // Stamp Michelin distinctions onto the pool before scoring — the same
    // attach the popup's gather stage performs — so the engine's
    // distinctiveness and michelin-taste terms fire on this page too, and
    // Guide-priced entries backfill an unknown price tier.
    const candidates = !michelinReady
      ? augmentedPool
      : augmentedPool.map((p) => {
          if (isMichelinSyntheticId(p.id)) return p;
          const info = findMichelinMatchSync(p.name, p.lat, p.lng, p.fullAddress || p.address);
          if (!info) return p;
          return {
            ...p,
            michelin: { stars: info.stars, bibGourmand: info.bibGourmand, selected: info.selected },
            priceLevel: p.priceLevel < 1 && info.priceTier >= 1 ? info.priceTier : p.priceLevel,
          };
        });
    return scoreCandidates(
      candidates,
      profile,
      signals,
      target,
      radiusMeters,
      { limit: Infinity, skipUserHistory: false },
    );
  }, [augmentedPool, profile, signals, cityDisplay, lat, lng, hasCoords, radiusMeters, michelinReady]);

  // Stable rank numbers: a badge shows the place's position in the
  // RECOMMENDED ranking and keeps it through re-sorts, filters, and
  // searches — the same rule the recommendations popup follows. Rows that
  // never went through the engine (assistant result sets, Michelin-filter
  // dataset extras) have no entry here and render without a badge.
  const rankById = useMemo(() => {
    const m = new Map<string, number>();
    ranked.forEach((p, i) => m.set(p.id, i + 1));
    return m;
  }, [ranked]);

  const handleFollowExpert = useCallback(
    async (targetId: string) => {
      // Optimistic: flip the local set so the button responds instantly,
      // rolled back below if the API call fails.
      setFollowedSuggestions((prev) => {
        const next = new Set(prev);
        next.add(targetId);
        return next;
      });
      if (!userId) return;
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

  // Apply the in-page filters + sort to the already-ranked list. Filters
  // never trigger a refetch — they shrink what's shown from the pool we
  // already have, so as infinite-scroll pulls more pages any matching
  // results trickle in without a round-trip.
  // AI-chat override: when the assistant recommends a set of restaurants
  // (e.g. "best italian in Port Chester"), it hands them here. While set,
  // the sidebar list + map markers show exactly these places and the map
  // flies to frame them — independent of the normal area pool/filters.
  // Cleared by re-searching the area or moving to a new city.
  const [assistantPlaces, setAssistantPlaces] = useState<ScoredPlace[] | null>(null);

  const visible: ScoredPlace[] = useMemo(() => {
    // AI-chat override takes over the list + markers wholesale, bypassing
    // the normal area pool and filters.
    if (assistantPlaces) return assistantPlaces;
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
      // Michelin distinction filter (depends on the dataset being loaded;
      // michelinReady is in the deps so the list re-filters once it lands).
      if (selectedMichelin.length > 0
        && !passesMichelinFilter(selectedMichelin, p.name, p.lat, p.lng, p.fullAddress || p.address)) continue;
      // Opening-hours filter (breakfast/lunch/dinner + open now). Search
      // results carry their own hours (regularOpeningHours in the search
      // FieldMask); the cached meta is the fallback for merged rows. Keeps
      // unknown-hours places and is a no-op when the filter is inactive.
      if (isHoursFilterActive(hoursFilter)
        && !passesHoursFilter(p.hours ?? restaurantMeta[p.id]?.hours, hoursFilter, restaurantLocalNow(p.lng || restaurantMeta[p.id]?.lng))) continue;
      out.push(p);
    }

    // Michelin filter active: Google's popularity pool rarely overlaps the
    // Michelin set, so source matching restaurants from the bundled dataset
    // directly and merge them in (deduping against any Google places already
    // matched, by name+proximity). michelinReady is in the deps so this fills
    // in as soon as the dataset loads.
    if (selectedMichelin.length > 0 && hasCoords && michelinReady) {
      const radiusMi = selectedRadius > 0 ? selectedRadius : radiusMeters / 1609.34;
      const haveNames = out.map((p) => ({ n: p.name.toLowerCase(), lat: p.lat, lng: p.lng }));
      for (const m of michelinNearbySync(lat, lng, radiusMi, selectedMichelin)) {
        const dup = haveNames.some((h) =>
          h.n === m.name.toLowerCase()
          && haversineDistanceMi(h.lat, h.lng, m.lat, m.lng) < 0.12);
        if (dup) continue;
        if (selectedPrice > 0 && m.priceTier !== selectedPrice) continue;
        const mPlace: ScoredPlace = { ...michelinToPlaceResult(m), recScore: 0, sources: ['google'] };
        if (isHoursFilterActive(hoursFilter)
          && !passesHoursFilter(mPlace.hours ?? restaurantMeta[mPlace.id]?.hours, hoursFilter, restaurantLocalNow(mPlace.lng || restaurantMeta[mPlace.id]?.lng))) continue;
        out.push(mPlace);
      }
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
    assistantPlaces,
    ranked, selectedPrice, selectedCuisines, sortBy, hasCoords, lat, lng,
    selectedRadius, friendsOnly, expertsOnly,
    friendRestaurantIds, expertRestaurantIds, debouncedSearch,
    selectedMichelin, michelinReady,
    hoursFilter, restaurantMeta,
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
    // Permission denied / no GPS rejects — swallow instead of emitting an
    // unhandled rejection (the user just stays on the current location).
    try {
      const loc = await getCurrentHomeLocation();
      handleLocationChange(loc);
    } catch (err) {
      console.warn('[Location] use-current-location failed:', err);
    }
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
  // Quick "Open now" chip — a shortcut into the same hoursFilter the
  // filter sheet uses, so it really filters the list.
  const openNow = hoursFilter.openNow;
  const toggleOpenNow = useCallback(
    () => setHoursFilter((f) => ({ ...f, openNow: !f.openNow })),
    [],
  );
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
  // "Browse all" guides popup (search + author filters over the rail's pool).
  const [guidesBrowserOpen, setGuidesBrowserOpen] = useState(false);
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
    // Compact attribution: Mapbox ToS requires it on every map. The CSS
    // (LocationPage.css) pins the ctrl corners to the visible slice of
    // the cropped mini-map canvas.
    map.addControl(new mapboxgl.AttributionControl({ compact: true }));
    attachMapErrorFallback(map, mapContainerRef.current);
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
    // Moving to a new city ends any AI-chat override so the area's own
    // results take back over.
    setAssistantPlaces(null);
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

  // ── AI chat → map ──────────────────────────────────────────────────
  // The assistant calls this with the restaurants it just recommended.
  // We swap the list + markers to exactly those (via `assistantPlaces`,
  // which the `visible` memo short-circuits on) and fly to frame them —
  // lifting the city bbox cap first so we can pan to another town. An
  // empty array clears the override and returns to the area results.
  const handleAssistantPlaces = useCallback((places: ScoredPlace[]) => {
    const valid = (places || []).filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (valid.length === 0) {
      setAssistantPlaces(null);
      return;
    }
    setAssistantPlaces(valid);
    setSelectedMarkerPlace(null);
    const map = mapRef.current;
    if (!map) return;
    map.setMaxBounds(null as unknown as mapboxgl.LngLatBoundsLike);
    if (valid.length === 1) {
      map.flyTo({ center: [valid[0].lng, valid[0].lat], zoom: 14, duration: 900 });
    } else {
      const bounds = new mapboxgl.LngLatBounds();
      for (const p of valid) bounds.extend([p.lng, p.lat]);
      map.fitBounds(bounds, { padding: 64, maxZoom: 15, duration: 900 });
    }
  }, []);

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
  const chatUserContext = useMemo<UserContext>(() => {
    const ctx: UserContext = {};
    if (myProfile?.display_name) ctx.displayName = myProfile.display_name;
    if (myProfile?.username) ctx.username = myProfile.username;
    if (myProfile?.home_city) ctx.homeCity = myProfile.home_city;
    if (profile.topCuisines.length > 0) ctx.topCuisines = profile.topCuisines.slice(0, 6);
    // A SAMPLE — their best, their worst and their most recent — plus the
    // true total, so the prompt can say it's a sample. Raising the old cap
    // from 8 to 50 narrowed the "you have no Boston ratings" bug without
    // closing it: any cap sorted by score alone still hides the tail, and
    // reporting the row count as the total made the model state it as
    // fact. search_my_ratings is the other half of the fix.
    // Address comes off the rating row itself (not the lazy-loaded
    // restaurant_meta) so the city is always present — meta-backed
    // neighborhood is preferred when it's there for the richer
    // "Beacon Hill, Boston" form.
    if (ratings.length > 0) {
      const sample = sampleRatings(ratings, 60);
      ctx.ratedTotal = sample.total;
      ctx.ratedTruncated = sample.truncated;
      ctx.topRated = sample.rows.map((r) => {
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
    /* The computed taste profile, in words — the same object the ranking
       uses. See lib/assistant-taste for why the chat needs it. */
    ctx.taste = buildTasteSummary(profile, getTasteQuiz(myProfile));
    ctx.account = {
      ratingCount: ratings.length,
      wishlistCount: wishlist.length,
      listCount: lists.length,
      recipeCount: myRecipes.length,
      bio: myProfile?.bio || undefined,
    };

    return ctx;
  }, [myProfile, profile, ratings, wishlist, lists, restaurantMeta, areaFriendCandidates, areaExperts, friendCounts, expertCounts, visible, myRecipes]);

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
        isExpert: !!p.is_verified,
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
    // Re-searching the visible area replaces any AI-chat override.
    setAssistantPlaces(null);
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

  // ── Mobile filter chips — rendered inside the sticky header so the
  // page opens on controls, the reference way. The page's button reset
  // (`.location-page-root button { padding:0; border:0; … }`) outranks
  // Tailwind utilities, so every visual property lives in inline styles.
  const mobileChipsRow = isMobile ? (() => {
    const chipBase: React.CSSProperties = {
      flexShrink: 0,
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      height: '34px',
      paddingLeft: '14px',
      paddingRight: '14px',
      borderRadius: '9999px',
      fontSize: '13px',
      fontWeight: 500,
      lineHeight: 1,
      letterSpacing: '-0.01em',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
      transition: 'background-color .15s ease, color .15s ease, border-color .15s ease',
    };
    const chipIdle: React.CSSProperties = {
      ...chipBase,
      background: 'rgba(var(--overlay-ink), 0.06)',
      color: 'var(--ink-2)',
      border: '1px solid transparent',
    };
    const chipActive: React.CSSProperties = {
      ...chipBase,
      background: 'var(--ink)',
      color: 'var(--cream)',
      border: '1px solid var(--ink)',
    };
    return (
      <div className="mt-2 -mx-3 px-3 pb-2.5 flex items-center gap-2 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={toggleOpenNow}
          style={openNow ? chipActive : chipIdle}
        >
          <span
            style={{
              position: 'relative',
              width: '22px',
              height: '13px',
              borderRadius: '9999px',
              flexShrink: 0,
              background: openNow ? 'var(--color-score-high)' : 'rgba(var(--overlay-ink), 0.25)',
              transition: 'background-color .15s ease',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: '2px',
                left: openNow ? '11px' : '2px',
                width: '9px',
                height: '9px',
                borderRadius: '9999px',
                background: '#fff',
                boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                transition: 'left .15s ease',
              }}
            />
          </span>
          Open now
        </button>
        <span
          style={{ flexShrink: 0, alignSelf: 'center', width: '1px', height: '16px', background: 'var(--border-strong)' }}
        />
        {QUICK_CUISINES.map((c) => {
          const active = selectedCuisines.includes(c.type);
          return (
            <button
              key={c.type}
              type="button"
              onClick={() => toggleCuisine(c.type)}
              style={active ? chipActive : chipIdle}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    );
  })() : null;

  return (
    <div className="location-page-root min-h-screen pb-24">
      {/* Mobile header — back arrow, a centered maps-style location pill
          (pin + city + chevron, opens the picker) and a share button.
          The pill is the page's only location chrome; the old big-serif
          hero below is gone. On desktop there is no separate back-arrow
          row: the back arrow lives inside the sticky filter bar below,
          so the page chrome is one bar instead of two stacked strips. */}
      {isMobile && (
      <motion.div
        ref={headerFade.headerRef}
        className="sticky top-0 z-20 pt-safe-3 pb-0 px-3"
        style={{ background: 'var(--loc-bar-bg)', backdropFilter: 'saturate(150%) blur(14px)', WebkitBackdropFilter: 'saturate(150%) blur(14px)', borderBottom: '1px solid var(--border)', ...headerFade.headerStyle }}
      >
        <div className="grid grid-cols-[40px_1fr_40px] items-center gap-2">
          <GlassButton
            id="loc-back"
            symbol="chevron.left"
            label="Back"
            onClick={() => navigate(-1)}
            className="hit-44 w-10 h-10 flex items-center justify-center rounded-full transition-transform active:scale-95"
            style={{ color: 'var(--ink)', background: 'rgba(var(--overlay-ink), 0.06)' }}
          >
            <ArrowLeft size={19} />
          </GlassButton>
          <div className="flex justify-center min-w-0">
            {/* The reference wears the city as a plain title, not a boxed
                pill — pin, name, chevron. Same picker underneath. */}
            <button
              type="button"
              onClick={() => setMobileLocationPickerOpen(true)}
              className="inline-flex items-center gap-1.5 h-10 max-w-full px-2 transition-[transform,opacity] active:opacity-60"
              style={{ color: 'var(--ink)' }}
              aria-label="Change location"
            >
              <MapPin size={15} strokeWidth={2.4} className="flex-none" style={{ color: 'var(--accent)' }} />
              <span className="text-[16.5px] font-bold tracking-[-0.02em] truncate">{cityDisplay}</span>
              <ChevronDown size={15} className="flex-none" style={{ color: 'var(--muted)' }} />
            </button>
          </div>
          <GlassButton
            id="loc-share"
            symbol="app.paperplane"
            label="Share"
            // canonicalShareUrl: window.location.href inside the native shell
            // is capacitor://localhost/… — build the link from the public web
            // origin + the page's path instead.
            onClick={() => { void shareExternally({ title: cityDisplay, url: canonicalShareUrl(window.location.pathname + window.location.search) }); }}
            className="hit-44 w-10 h-10 flex items-center justify-center rounded-full transition-transform active:scale-95"
            style={{ color: 'var(--ink)', background: 'rgba(var(--overlay-ink), 0.06)' }}
          >
            <ShareIcon size={18} />
          </GlassButton>
        </div>
        {mobileChipsRow}
      </motion.div>
      )}

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
        {/* Desktop: compact city chip — the global top bar that used to
            mirror the URL's city (and open the picker) is gone, so the
            page hosts its own. Same URL-replace flow as the mobile
            picker. */}
        {!isMobile && (
          <section className="pt-4 pb-1">
            <HomeLocationBar
              location={currentLocation}
              onChange={handleLocationChange}
              onUseCurrent={handleUseCurrent}
              variant="chip"
            />
          </section>
        )}

        {/* ── Sticky filter bar (desktop only — the mobile redesign
            uses a single compact filter row inserted between Local
            experts and the Search box further down) ───────────────── */}
        {!isMobile && (
        <div className="loc-filterbar">
          {/* Back arrow — lives inside the bar (very left) so the page has
              one chrome strip instead of a separate back-arrow row. */}
          <button
            type="button"
            className="fb-back"
            onClick={() => navigate(-1)}
            aria-label="Back"
          >
            <ArrowLeft />
          </button>

          <span className="fb-divider" />

          {/* What you're filtering BY. Flexes, and is the only part
              allowed to wrap — so a narrow desktop gets two tidy rows
              instead of four ragged ones. */}
          <div className="fb-group is-filters">
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
            onClick={toggleOpenNow}
          >
            <span className="sw" />
            Open now
          </button>
          </div>

          {/* How you're viewing the results. Held together so Sort,
              Filters and the view switcher can never end up on
              different rows from each other. */}
          <div className="fb-group is-actions">
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
              const michHit = michelinReady
                ? findMichelinMatchSync(p.name, p.lat, p.lng, p.address)
                : null;
              const cuisine = michHit ? michHit.cuisine : inferCuisineLabel(p);
              const priceLabel = michHit ? michelinPriceDisplay(michHit) : priceLevelToString(p.priceLevel);
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

        {/* ── Guides — hidden entirely when this location has none (also
            covers the still-loading phase, so the header never flashes
            in front of an empty row). ─────────────────────────────────── */}
        {locationGuides.length > 0 && isMobile && (
        <section className="lp-section">
          {/* Compact reference rail: a quiet head with an All pill, then
              small thumbs with the words BELOW the photo — the guides no
              longer own half the screen. */}
          <div className="gd-mini-head">
            <h2>Guides for {shortCityName}</h2>
            <button type="button" className="gd-all-pill" onClick={() => setGuidesBrowserOpen(true)}>
              All <ChevronRight />
            </button>
          </div>
          <div className="gd-row is-mobile is-compact">
            {locationGuides.map((g) => (
              <Link key={g.id} to={`/guides/${g.id}`} className="gd-mini">
                <div
                  className="gd-mini-img"
                  style={g.image ? { backgroundImage: `url(${g.image})` } : undefined}
                >
                  <div className="gd-stamp">
                    <BookOpen /> Guide · {g.count} spots
                  </div>
                </div>
                <h3 className="gd-mini-title">{g.title}</h3>
                <p className="gd-mini-by">by {g.author}</p>
              </Link>
            ))}
          </div>
        </section>
        )}
        {locationGuides.length > 0 && !isMobile && (
        <section className={cn('lp-section collapsible-section', guidesOpen ? 'is-open' : 'is-closed')}>
          {(
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
                <button type="button" className="section-link" onClick={() => setGuidesBrowserOpen(true)}>
                  Browse all <ChevronRight />
                </button>
              </div>
            )}
          </div>
          )}
          <div className="collapsible-body">
            <div className="gd-row" ref={guidesRowRef}>
                {locationGuides.map((g) => {
                  const initial = (g.author || '?').charAt(0).toUpperCase();
                  return (
                    <Link key={g.id} to={`/guides/${g.id}`} className="gd-card">
                      <div
                        className="gd-img"
                        style={g.image ? { backgroundImage: `url(${g.image})` } : undefined}
                      />
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
                    </Link>
                  );
                })}
                {/* End-of-rail "Browse all" tile — same affordance the header
                    link provides on desktop, and the only entry point on
                    mobile where the header is a collapse toggle. */}
                <button
                  type="button"
                  className="gd-card gd-browse-all"
                  onClick={() => setGuidesBrowserOpen(true)}
                >
                  <span className="gd-browse-all-icon"><BookOpen /></span>
                  <span className="gd-browse-all-title">Browse all guides</span>
                  <span className="gd-browse-all-sub">Search &amp; filter every guide <ChevronRight /></span>
                </button>
            </div>
          </div>
        </section>
        )}

        {/* ── Local experts ───────────────────────────────────────────── */}
        {(() => {
          // Real experts only — people whose declared home base sits in this
          // city's area. No filler: when there are none, the whole section
          // is hidden (this also covers the still-loading phase).
          const experts = areaExperts;
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
                    <span>Verified locals</span>
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
                      <h2>Verified locals</h2>
                      <span className="count">{experts.length}</span>
                    </div>
                    <div className="sub">Verified users based in this city</div>
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
                    <button type="button" className="section-link" onClick={() => navigate('/experts')}>See all <ChevronRight /></button>
                  </div>
                )}
              </div>
              )}
              <div className="collapsible-body">
                <div className={cn('exp-row', isMobile && 'is-mobile')} ref={expertsRowRef}>
                  {experts.map((e) => {
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
                          {e.bio || `Verified voice on ${shortCityName} dining.`}
                        </p>
                        <div className="exp-cta">
                          <button
                            type="button"
                            className={cn('btn-follow', isFollowing && 'following')}
                            onClick={() => handleFollowExpert(e.user_id)}
                          >
                            {isFollowing ? '✓ Following' : 'Follow'}
                          </button>
                          <Link className="btn-view" to={`/user/${e.username}`} aria-label={`View ${e.display_name || e.username}`}>
                            <ChevronRight />
                          </Link>
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
        {/* Filter chips now ride inside the sticky header above. */}

        {/* ── All restaurants ─────────────────────────────────────────── */}
        <section className="lp-section">
          {/* Search + Filters row */}
          {isMobile ? (
            <div className="flex items-center gap-2 mb-4 px-3">
              <SearchField
                glassId="location-rest-search"
                className="flex-1 min-w-0"
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search restaurants…"
              />
              {/* Filters pill — same inline-style recipe as the filter chips
                  above (so padding/shape/font survive the .location-page-root
                  button reset), but with a surface background + border so it
                  reads as the distinct action next to the search field rather
                  than a tinted filter chip. */}
              <button
                type="button"
                onClick={() => setFilterSheetOpen(true)}
                aria-label="Filters"
                style={{
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  height: '40px',
                  paddingLeft: '16px',
                  paddingRight: '16px',
                  borderRadius: '9999px',
                  fontSize: '14px',
                  fontWeight: 500,
                  lineHeight: 1,
                  letterSpacing: '-0.01em',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  background: 'var(--surface)',
                  color: 'var(--ink-2)',
                  border: '1px solid var(--border-strong)',
                  transition: 'background-color .15s ease, color .15s ease, border-color .15s ease',
                }}
              >
                <SlidersHorizontal size={15} style={{ opacity: 0.7, flexShrink: 0 }} />
                Filters
                {activeFilterCount > 0 && (
                  <span
                    style={{
                      display: 'inline-grid',
                      placeItems: 'center',
                      minWidth: '20px',
                      height: '20px',
                      paddingLeft: '6px',
                      paddingRight: '6px',
                      borderRadius: '9999px',
                      fontSize: '11px',
                      fontWeight: 700,
                      color: '#fff',
                      background: 'var(--accent)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
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
          ) : loadError && visible.length === 0 ? (
            <div className="lp-empty">
              <strong>Couldn&rsquo;t load restaurants</strong>
              Check your connection, then try again.
              <div className="lp-load-more-wrap">
                <button
                  type="button"
                  className="lp-load-more"
                  onClick={() => setRetryToken((t) => t + 1)}
                >
                  Retry
                </button>
              </div>
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
              <div className={cn('r-list', isMobile && 'is-mobile')}>
                {visible.map((place) => (
                  <LocationListItem
                    key={place.id}
                    place={place}
                    rank={rankById.get(place.id) ?? 0}
                    origin={origin}
                    walkMinCap={selectedWalkMin > 0 ? selectedWalkMin : null}
                    driveMinCap={selectedDriveMin > 0 ? selectedDriveMin : null}
                    isMobile={isMobile}
                    showMichelin={selectedMichelin.length > 0}
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
                    ) : loadError ? (
                      <>Couldn&rsquo;t load — try again</>
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
        selectedMichelin={selectedMichelin}
        onMichelinToggle={toggleMichelin}
        onMichelinClear={() => setSelectedMichelin([])}
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
        hoursFilter={hoursFilter}
        onHoursChange={setHoursFilter}
      />

      <GuidesBrowser
        open={guidesBrowserOpen}
        onClose={() => setGuidesBrowserOpen(false)}
        cityName={shortCityName}
        realGuides={browseGuides}
        onOpenGuide={(id) => navigate(`/guides/${id}`)}
        isMobile={isMobile}
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
        onAssistantPlaces={handleAssistantPlaces}
        userContext={chatUserContext}
        knownPlaces={chatKnownPlaces}
        recipes={chatRecipesAll}
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
  onAssistantPlaces: (places: ScoredPlace[]) => void;
  userContext: UserContext;
  knownPlaces: ScoredPlace[];
  recipes: DbRecipe[];
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
    onAssistantPlaces: props.onAssistantPlaces,
    userContext: props.userContext,
    knownPlaces: props.knownPlaces,
    recipes: props.recipes,
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
    props.onAssistantPlaces,
    props.userContext,
    props.knownPlaces,
    props.recipes,
  ]);
  useSetAssistantPageContext(ctx);
  return null;
};


const scoreBg = (rating: number): string => {
  if (rating >= 8) return 'bg-emerald-500';
  if (rating >= 5) return 'bg-amber-500';
  return 'bg-red-500';
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
  selectedMichelin: string[];
  onMichelinToggle: (d: string) => void;
  onMichelinClear: () => void;
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
  hoursFilter: HoursFilter;
  onHoursChange: (f: HoursFilter) => void;
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
  selectedMichelin,
  onMichelinToggle,
  onMichelinClear,
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
  hoursFilter,
  onHoursChange,
}) => {
  const cuisineOptions = useMemo(
    () => CUISINE_TYPES.filter((c) => c.type).map((c) => ({ value: c.type, label: c.label })),
    [],
  );

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
    onMichelinClear();
    onRadiusChange(0);
    onFriendsOnlyChange(false);
    onExpertsOnlyChange(false);
    onWalkMinChange(0);
    onDriveMinChange(0);
    onHoursChange(emptyHoursFilter());
  };

  return (
    <FilterSheetShell open={open} onClose={onClose} title="Filters" onReset={reset}>
      {/* ── Sort by ─────────────────────────────────────────── */}
      <FilterSection label="Sort by">
        <PillRow>
          {SORT_OPTIONS.map((opt) => (
            <Pill key={opt.value} active={sortBy === opt.value} onClick={() => onSortChange(opt.value)}>
              {opt.label}
            </Pill>
          ))}
        </PillRow>
      </FilterSection>

      {/* ── Price ───────────────────────────────────────────── */}
      <FilterSection label="Price">
        <Segment>
          {PRICE_LEVELS.map((p) => (
            <SegmentItem key={p.value} active={selectedPrice === p.value} onClick={() => onPriceChange(p.value)}>
              {p.label}
            </SegmentItem>
          ))}
        </Segment>
      </FilterSection>

      {/* ── Drill pages: hours / cuisine / Michelin ─────────── */}
      <HoursFilterSection value={hoursFilter} onChange={onHoursChange} />
      <FilterDrillSection
        id="cuisine"
        label="Cuisine"
        options={cuisineOptions}
        selected={selectedCuisines}
        onToggle={toggleCuisine}
        searchPlaceholder="Search cuisines"
        emptyLabel="All cuisines"
      />
      <MichelinDrillSection selected={selectedMichelin} onToggle={onMichelinToggle} />

      {/* ── Distance ────────────────────────────────────────── */}
      <FilterSection
        label="Distance"
        value={selectedRadius === 0 ? 'Any' : `Within ${selectedRadius} mi`}
        isSet={selectedRadius > 0}
        sub="From the city centre. Drag to the far left for no limit."
      >
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
      </FilterSection>

      {/* ── Walk / drive time caps ──────────────────────────── */}
      {canFilterByTravelTime && (
        <>
          <FilterSection
            label={(
              <>
                <Footprints size={12} style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 6 }} />
                Walk time
              </>
            )}
            value={selectedWalkMin === 0 ? 'Any' : WALK_MIN_OPTIONS.find((o) => o.value === selectedWalkMin)?.label}
            isSet={selectedWalkMin > 0}
            sub={`From ${homeLabel || 'your address'}.`}
          >
            <PillRow>
              {WALK_MIN_OPTIONS.map((o) => (
                <Pill key={o.value} sm active={selectedWalkMin === o.value} onClick={() => onWalkMinChange(o.value)}>
                  {o.label}
                </Pill>
              ))}
            </PillRow>
          </FilterSection>

          <FilterSection
            label={(
              <>
                <Car size={12} style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 6 }} />
                Drive time
              </>
            )}
            value={selectedDriveMin === 0 ? 'Any' : DRIVE_MIN_OPTIONS.find((o) => o.value === selectedDriveMin)?.label}
            isSet={selectedDriveMin > 0}
            sub={`From ${homeLabel || 'your address'}.`}
          >
            <PillRow>
              {DRIVE_MIN_OPTIONS.map((o) => (
                <Pill key={o.value} sm active={selectedDriveMin === o.value} onClick={() => onDriveMinChange(o.value)}>
                  {o.label}
                </Pill>
              ))}
            </PillRow>
          </FilterSection>
        </>
      )}

      {/* ── From your circle ────────────────────────────────── */}
      <FilterSection label="From your circle" sub="Show only places with ratings from people you trust.">
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
      </FilterSection>
    </FilterSheetShell>
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
  /** Show the Michelin distinction mark on the card. Only true while a
   *  Michelin filter is active, so the mark never appears unfiltered. */
  showMichelin?: boolean;
}

const LocationListItem: React.FC<LocationListItemProps> = ({
  place,
  rank,
  origin,
  walkMinCap,
  driveMinCap,
  isMobile = false,
  showMichelin = false,
}) => {
  const { twoDecimalScores } = useSettings();
  const { driveMin, walkMin } = useTravelTimes(
    origin,
    Number.isFinite(place.lat) && Number.isFinite(place.lng)
      ? { lat: place.lat, lng: place.lng }
      : null,
  );
  // Michelin override for cuisine + price (no star/bib marker on cards).
  // Hook must run before the early returns below to satisfy Rules of Hooks.
  const mich = useMichelinMatch(
    place.name, place.lat, place.lng, place.fullAddress || place.address,
    inferCuisineLabel(place), priceLevelToString(place.priceLevel),
  );
  const { restaurantMeta, cacheRestaurantMeta, ratings } = useLists();
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

  // Personal score first (new rec engine): your own rating when you've
  // been, else the engine's predicted "for you" score; the Google rating
  // (×2) remains only as the cold fallback so the circle never blanks.
  const myRating = ratings.find((r) => r.restaurantId === place.id && r.score > 0);
  const personal = myRating ? myRating.score : typeof place.predicted === 'number' ? place.predicted : 0;
  const score = personal > 0 ? personal : place.rating > 0 ? place.rating * 2 : 0;
  const scoreLabel = myRating ? 'your score' : personal > 0 ? 'for you' : '';
  const cuisine = mich.cuisine;
  const priceLabel = mich.price;
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
  // place across pages is free. (useLists is called above, before the
  // travel-time early returns.)
  const meta = restaurantMeta[place.id];
  // Include hours in the "fully cached" check: a place cached on an earlier
  // visit (address + neighborhood) but without opening hours must still
  // backfill so the Open/Closed + today's-hours status can render. Once the
  // fetch writes hours (or an empty array when Google has none), the gate is
  // satisfied and it won't refetch. Michelin dataset rows already carry their
  // address/neighborhood from the dataset, so for them "done" just means hours.
  const hasFullLocationData = isMichelinSyntheticId(place.id)
    ? meta?.hours !== undefined
    : !!meta?.addressComponents && meta?.neighborhood !== undefined && meta?.hours !== undefined;
  useEffect(() => {
    if (!place.id || hasFullLocationData) return;
    let cancelled = false;
    (async () => {
      // Michelin dataset rows carry a synthetic id (no Google place id). The
      // address/neighborhood already come from the dataset; resolve the real
      // Google place (the same path the detail page uses) just to warm opening
      // hours so the Open/Closed status can render here too.
      if (isMichelinSyntheticId(place.id)) {
        const parsed = parseMichelinSyntheticId(place.id);
        const resolved = parsed
          ? await resolvePlaceIdByNameCoords(parsed.name, parsed.lat, parsed.lng).catch(() => null)
          : null;
        if (cancelled) return;
        if (!resolved) {
          // Couldn't map it to a Google place — record empty hours so we stop trying.
          cacheRestaurantMeta({ id: place.id, hours: [] });
          return;
        }
        const details = await getPlaceDetails(resolved).catch(() => null);
        if (cancelled || !details) return;
        cacheRestaurantMeta({ id: place.id, hours: details.hours ?? [] });
        return;
      }

      // `place` came out of a Places search, which already returned address
      // components, coordinates and hours (they're in the search FieldMask).
      // Handing them over as a seed means this row costs one Mapbox lookup
      // instead of a billed Place Details call; an incomplete seed (a row
      // reconstructed from somewhere thinner) falls through to the fetch.
      const { addressComponents, neighborhood, lat: ll, lng: lg, hours } =
        await fetchLocationDataForPlace(place.id, {
          addressComponents: place.addressComponents,
          lat: place.lat,
          lng: place.lng,
          hours: place.hours,
        });
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
    })();
    return () => { cancelled = true; };
  }, [place.id, hasFullLocationData, cacheRestaurantMeta]);

  const locationLabel = formatLocationLabel(
    meta?.addressComponents,
    place.address || '',
    meta?.neighborhood,
  );

  // Real open/closed + today's hours, parsed from the backfilled Google
  // weekdayDescriptions against the current time (replaces the old score-based
  // heuristic). `open: null` (no hours data) hides the status chip entirely.
  const status = getOpenStatus(meta?.hours);
  const statusColor = status.open ? 'var(--color-score-high-ink)' : 'var(--color-score-low-ink)';
  const dotColor = status.open ? 'var(--color-score-high)' : 'var(--color-score-low)';

  // "3.6 mi · 22 min" — distance + drive time (walk as fallback).
  const timePart = driveLabel || walkLabel || '';
  const distLine = distLabel ? (timePart ? `${distLabel}  ·  ${timePart}` : distLabel) : timePart;

  // Soft tiered score circle with an inset ring (per the redesign). The
  // token-backed pack from lib/score adapts in dark mode — same treatment
  // as ScoreRing.
  const tierPack = scoreTintStyle(score);
  const tier = { bg: tierPack.background, ring: tierPack.ring, text: tierPack.color };
  /* Two decimals only where four characters fit — ScoreRing's own 40px
     threshold, applied here because this disc is hand-rolled rather than
     that component. Below it the disc stays one-decimal whatever the
     "Precise scores" setting says. */
  const twoDpAt = (size: number) => twoDecimalScores && size >= 40;
  const scoreBadge = (size: number) => ({
    width: size, height: size, borderRadius: 9999,
    background: score > 0 ? tier.bg : 'var(--bg-2)',
    boxShadow: `inset 0 0 0 1.5px ${score > 0 ? tier.ring : 'var(--border-strong)'}`,
    color: score > 0 ? tier.text : 'var(--muted)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'var(--serif)', fontWeight: 700,
    fontSize: Math.round(size * (twoDpAt(size) ? 0.29 : 0.36)),
    fontVariantNumeric: 'tabular-nums' as const, flexShrink: 0, letterSpacing: '-0.01em',
  });
  const scoreTextAt = (size: number) => (score > 0 ? formatScore(score, twoDpAt(size)) : '—');

  // Status (Open/Closed + today's hours) and distance·time, shared by both
  // layouts; `fs` is the only size difference (12.5 mobile / 13 desktop).
  const statusRow = (fs: number) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: `8px ${fs >= 13 ? 18 : 16}px`, marginTop: 12 }}>
      {(status.label || status.detail) && (
        <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 7, fontWeight: 600, fontSize: fs }}>
          {status.label && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
              <span style={{ width: 7, height: 7, borderRadius: 9999, background: dotColor, flexShrink: 0 }} />
              <span style={{ color: statusColor, fontWeight: 700 }}>{status.label}</span>
            </span>
          )}
          {status.detail && <span style={{ color: 'var(--muted)', fontWeight: 500 }}>{status.detail}</span>}
        </span>
      )}
      {distLine && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: fs, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          <Clock size={fs >= 13 ? 14 : 13} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
          {distLine}
        </span>
      )}
    </div>
  );

  // Cuisine · price · ★ Google (+ Michelin). The Google rating moved into
  // this meta line when the score circle became the personalized score, so
  // the public signal stays visible without competing with "for you".
  // Location is appended inline on desktop and shown on its own line on
  // mobile.
  const cuisinePrice = (fs: number, withLocation: boolean) => (
    <div style={{ marginTop: 8, fontWeight: 600, fontSize: fs, lineHeight: 1.4 }}>
      {cuisine && <span style={{ color: 'var(--ink-2)', fontWeight: 700, letterSpacing: '0.01em' }}>{cuisine}</span>}
      {cuisine && priceLabel && <span style={{ color: 'var(--muted-2)' }}> · </span>}
      {priceLabel && <span style={{ color: 'var(--ink)', fontWeight: 700 }}>{priceLabel}</span>}
      {place.rating > 0 && (
        <>
          {(cuisine || priceLabel) && <span style={{ color: 'var(--muted-2)' }}> · </span>}
          <span style={{ color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            <span style={{ color: 'var(--color-score-mid)' }}>★</span> {place.rating.toFixed(1)}
          </span>
        </>
      )}
      {withLocation && locationLabel && <span style={{ color: 'var(--muted)', fontWeight: 500 }}> · {locationLabel}</span>}
      {showMichelin && mich.michelin && (
        <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginLeft: 8 }}>
          <MichelinMark michelin={mich.michelin} size={12} />
        </span>
      )}
    </div>
  );

  // Recommended-rank badge — matches the popup's language: primary fill for
  // the top three picks, quiet neutral otherwise. Rows without an engine
  // rank (rank 0) render no badge rather than a fake number.
  const rankBadge = (size: number, fs: number, marginTop = 0) =>
    rank > 0 ? (
      <span
        className={cn(
          'grid flex-shrink-0 place-items-center rounded-full font-bold tabular-nums',
          rank <= 3 ? 'bg-primary text-on-primary' : 'bg-on-surface/[0.05] text-on-surface/55',
        )}
        style={{ width: size, height: size, fontSize: fs, marginTop }}
      >
        {rank}
      </span>
    ) : null;

  // Score circle + its microlabel ("your score" / "for you"); no label when
  // the value is the plain Google fallback.
  const scoreColumn = (size: number, labelFs: number) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0 }}>
      <div style={scoreBadge(size)}>{scoreTextAt(size)}</div>
      {scoreLabel && (
        <span style={{ fontSize: labelFs, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {scoreLabel}
        </span>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Link to={`/restaurant/${place.id}`} style={{ display: 'block', padding: '20px 26px', borderTop: '1px solid var(--border)', textDecoration: 'none', color: 'inherit' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          {rankBadge(26, 12, 2)}
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <h3 style={{ fontFamily: 'var(--serif)', fontWeight: 700, fontSize: 21, lineHeight: 1.16, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
              {place.name}
            </h3>
            {cuisinePrice(12.5, false)}
            {locationLabel && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, fontWeight: 500, fontSize: 13, color: 'var(--muted)' }}>
                <MapPin size={13} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{locationLabel}</span>
              </div>
            )}
            {statusRow(12.5)}
          </div>
          {scoreColumn(50, 8)}
        </div>
      </Link>
    );
  }

  return (
    <Link to={`/restaurant/${place.id}`} className="r-list-item">
      {rankBadge(30, 13)}
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <h3 style={{ fontFamily: 'var(--serif)', fontWeight: 700, fontSize: 23, lineHeight: 1.16, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
          {place.name}
        </h3>
        {cuisinePrice(13, true)}
        {statusRow(13)}
      </div>
      {scoreColumn(56, 8.5)}
    </Link>
  );
};
