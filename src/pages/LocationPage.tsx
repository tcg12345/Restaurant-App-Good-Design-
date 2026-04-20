import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Car,
  Footprints,
  Loader2,
  Map as MapIcon,
  MapPin,
  Sparkles,
  UserCheck,
  Users,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import {
  searchPlacesByText,
  priceLevelToString,
  extractCityState,
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
  type CommunityRating,
} from '../lib/supabase-community';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { haversineDistanceMi, formatDistance } from '../lib/distance';
import { formatTravelTime, useTravelTimes } from '../lib/directions';

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

/* ── City-match helpers ──────────────────────────────────────────────────────
   The URL label may be a plain city ("Los Angeles, CA") or a street address
   ("123 Main St, Los Angeles, CA"). Either way we want to know which city
   the user is exploring, so we can filter Google results to restaurants
   actually in that city (Google often leaks nearby suburbs).
   ──────────────────────────────────────────────────────────────────────── */
function cityKeyFromLabel(label: string): string {
  const parts = label.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  // Leading digit → full street address; skip the street and use the next piece.
  if (/^\s*\d/.test(parts[0]) && parts.length > 1) return parts[1];
  return parts[0];
}

function placeMatchesCity(place: PlaceResult, cityKey: string): boolean {
  if (!cityKey) return true;
  const extracted = extractCityState(place.fullAddress, place.address);
  const city = extracted.split(',')[0].trim();
  return city.toLowerCase() === cityKey.toLowerCase();
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

const INITIAL_BATCH_SIZE = 4;  // queries issued up-front in parallel
const LOAD_MORE_BATCH_SIZE = 2; // queries issued per infinite-scroll page

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [expertProfiles, followedIds, friendRows, expertRows, expertRecRows] = await Promise.all([
        getExpertProfiles().catch(() => []),
        userId ? getFollowedExpertIds(userId).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
        userId ? getAllFriendRatings(userId).catch(() => [] as CommunityRating[]) : Promise.resolve([] as CommunityRating[]),
        getExpertRatings(200).catch(() => [] as CommunityRating[]),
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

      const expertUserIds = new Set(expertProfiles.map((e) => e.user_id));
      const friendUserIds = new Set(friendRows.map((r) => r.user_id));
      const communityByRestaurant = new Map<string, CommunityRating[]>();
      const friendSet = new Set<string>();
      const expertSet = new Set<string>();
      const ingest = (rows: CommunityRating[]) => {
        for (const row of rows) {
          const arr = communityByRestaurant.get(row.restaurant_id);
          if (arr) arr.push(row);
          else communityByRestaurant.set(row.restaurant_id, [row]);
          if (friendUserIds.has(row.user_id)) friendSet.add(row.restaurant_id);
          if (expertUserIds.has(row.user_id)) expertSet.add(row.restaurant_id);
        }
      };
      ingest(friendRows);
      ingest(expertRows);
      const expertRecIds = new Set<string>(expertRecRows.map((r) => r.restaurant_id));
      for (const id of expertRecIds) expertSet.add(id);

      setSignals({
        expertUserIds,
        followedExpertIds: followedIds,
        friendUserIds,
        communityByRestaurant,
        expertRecRestaurantIds: expertRecIds,
      });
      setFriendRestaurantIds(friendSet);
      setExpertRestaurantIds(expertSet);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // The sorted, deduplicated pool of places we've pulled for this city.
  // `placesPool` is the raw accumulated list; `ranked` is the same list after
  // scoring + sorting. We re-score whenever the pool or signals change so
  // newly-loaded friend/expert activity can bubble existing rows upward.
  const [placesPool, setPlacesPool] = useState<PlaceResult[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const queryPoolRef = useRef<string[]>([]);
  const queryCursorRef = useRef(0);

  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  const radiusMeters = 12000; // ~7.5 mi — covers a city plus its inner suburbs

  const fetchBatch = useCallback(async (batchSize: number): Promise<PlaceResult[]> => {
    if (!hasCoords) return [];
    const pool = queryPoolRef.current;
    if (queryCursorRef.current >= pool.length) {
      setExhausted(true);
      return [];
    }
    const batchQueries = pool.slice(queryCursorRef.current, queryCursorRef.current + batchSize);
    queryCursorRef.current += batchQueries.length;

    const results = await Promise.all(
      batchQueries.map((q) =>
        searchPlacesByText(q, lat, lng, cityDisplay, /* useRestriction */ true, radiusMeters)
          .catch(() => [] as PlaceResult[]),
      ),
    );

    const radiusKm = radiusMeters / 1000;
    const fresh: PlaceResult[] = [];
    // Interleave by batch position so each query contributes something visible
    // to the top of the list, rather than one query dominating the first page.
    const maxLen = Math.max(0, ...results.map((r) => r.length));
    for (let i = 0; i < maxLen; i++) {
      for (const list of results) {
        const p = list[i];
        if (!p) continue;
        if (seenIdsRef.current.has(p.id)) continue;
        if (!placeMatchesCity(p, cityKey)) continue;
        if (
          haversineKm({ lat: p.lat, lng: p.lng }, { lat, lng }) > radiusKm * 1.2
        ) continue;
        seenIdsRef.current.add(p.id);
        fresh.push(p);
      }
    }
    return fresh;
  }, [hasCoords, lat, lng, cityDisplay, cityKey, radiusMeters]);

  // Kick off the initial batch whenever the location changes.
  useEffect(() => {
    if (!hasCoords) {
      setInitialLoading(false);
      return;
    }
    let cancelled = false;
    setInitialLoading(true);
    setPlacesPool([]);
    setExhausted(false);
    seenIdsRef.current = new Set();
    queryPoolRef.current = buildQueryPool(cityKey, profile.topCuisines);
    queryCursorRef.current = 0;
    (async () => {
      const fresh = await fetchBatch(INITIAL_BATCH_SIZE);
      if (cancelled) return;
      setPlacesPool(fresh);
      setInitialLoading(false);
    })();
    return () => { cancelled = true; };
    // `fetchBatch` already closes over lat/lng/city so listing it once is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCoords, lat, lng, cityKey, profile.topCuisines.join('|')]);

  const loadMore = useCallback(async () => {
    if (loadingMore || exhausted || initialLoading) return;
    setLoadingMore(true);
    const fresh = await fetchBatch(LOAD_MORE_BATCH_SIZE);
    setPlacesPool((prev) => {
      const merged = [...prev];
      for (const p of fresh) merged.push(p);
      return merged;
    });
    setLoadingMore(false);
  }, [loadingMore, exhausted, initialLoading, fetchBatch]);

  // Re-score the full pool whenever it changes. The recommendation engine
  // handles cuisine/price/pair/tag/friend/expert weighting, so this page just
  // feeds in the profile + signals we've already gathered. `skipUserHistory`
  // is off because the spec wants every restaurant in the city visible, not
  // only ones the user hasn't touched before.
  const ranked: ScoredPlace[] = useMemo(() => {
    if (placesPool.length === 0) return [];
    if (!hasCoords) return placesPool.map((p) => ({ ...p, recScore: 0, sources: ['google'] as ScoredPlace['sources'] }));
    const target = { label: cityDisplay, lat, lng };
    return scoreCandidates(
      placesPool,
      profile,
      signals,
      target,
      radiusMeters,
      { limit: Infinity, skipUserHistory: false },
    );
  }, [placesPool, profile, signals, cityDisplay, lat, lng, hasCoords, radiusMeters]);

  // IntersectionObserver sentinel powers the infinite-scroll load-more. We
  // attach it once, near the bottom of the list; when it crosses the viewport
  // we pull the next batch of queries.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) void loadMore();
      }
    }, { rootMargin: '600px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  const origin = hasCoords ? { lat, lng } : null;

  return (
    <div className="min-h-screen bg-surface pb-24">
      {/* Header — back arrow + map action share one row, city title sits below */}
      <div className="px-4 pt-5">
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

        <div className="mt-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface/40">
            Dining in
          </p>
          <h1 className="mt-1 font-serif font-bold text-3xl text-on-surface leading-tight">
            {cityDisplay}
          </h1>
        </div>
      </div>

      {/* Guides — horizontal scroll, non-functional placeholder */}
      <section className="mt-6">
        <div className="px-4 flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BookOpen size={15} className="text-primary/70" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-on-surface/60">Guides</h2>
          </div>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2 px-4 scrollbar-hide snap-x snap-mandatory">
          {PLACEHOLDER_GUIDES.map((g) => (
            <button
              key={g.id}
              type="button"
              className="flex-shrink-0 snap-start group text-left"
            >
              <div className="relative w-56 aspect-[4/5] rounded-2xl overflow-hidden bg-muted">
                <img
                  src={g.image}
                  alt={g.title}
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/40 to-transparent pointer-events-none" />
                <div className="absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/90 backdrop-blur-sm text-[10px] font-bold uppercase tracking-wider text-on-surface/70">
                  <BookOpen size={10} />
                  Guide
                </div>
                <div className="absolute inset-x-0 bottom-0 p-3">
                  <p className="text-white text-[15px] font-serif font-bold leading-tight drop-shadow-sm line-clamp-2">{g.title}</p>
                  <p className="text-white/80 text-[11px] font-medium mt-1 truncate">by {g.author} · {g.count} spots</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Restaurant list */}
      <section className="mt-8">
        <div className="px-4 flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-primary/70" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-on-surface/60">Picked for you</h2>
          </div>
        </div>

        {initialLoading ? (
          <div className="flex items-center justify-center py-16 text-on-surface/40">
            <Loader2 size={18} className="animate-spin" />
            <span className="ml-2 text-xs font-medium">Finding restaurants in {cityDisplay}…</span>
          </div>
        ) : ranked.length === 0 ? (
          <div className="px-6 py-16 text-center text-on-surface/45 text-sm">
            No restaurants found in {cityDisplay} yet.
          </div>
        ) : (
          <>
            <div className="px-4 mx-auto max-w-3xl lg:max-w-4xl">
              <ul className="divide-y divide-on-surface/[0.06]">
                {ranked.map((place) => (
                  <RestaurantRow
                    key={place.id}
                    place={place}
                    origin={origin}
                    hasFriendRating={friendRestaurantIds.has(place.id)}
                    hasExpertRating={expertRestaurantIds.has(place.id)}
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
            {exhausted && !loadingMore && (
              <div className="text-center text-[11px] uppercase tracking-wider text-on-surface/35 py-6">
                You've reached the end
              </div>
            )}
          </>
        )}
      </section>
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
  hasFriendRating: boolean;
  hasExpertRating: boolean;
}

const scoreBg = (rating: number): string => {
  if (rating >= 8) return 'bg-emerald-500';
  if (rating >= 5) return 'bg-amber-500';
  return 'bg-red-500';
};

const RestaurantRow: React.FC<RestaurantRowProps> = ({
  place,
  origin,
  hasFriendRating,
  hasExpertRating,
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

  const priceLabel = priceLevelToString(place.priceLevel);
  const cuisine = inferCuisineLabel(place.types);

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

            {/* Friend / expert signal pills — mutually non-exclusive */}
            {(hasFriendRating || hasExpertRating) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {hasFriendRating && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider">
                    <Users size={10} />
                    Friend rated
                  </span>
                )}
                {hasExpertRating && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary/15 text-secondary text-[10px] font-bold uppercase tracking-wider">
                    <UserCheck size={10} />
                    Expert pick
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
