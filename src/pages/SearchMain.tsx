import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search as SearchIcon, X, Clock, Star, Plus, Bookmark, UserPlus, Check, Loader2, ChefHat, ChevronDown } from 'lucide-react';
import { searchPlacesByText, priceLevelToString, extractCityState, formatLocationLabel, type PlaceResult } from '../lib/places';
import { useMichelinIndexReady } from '../lib/useMichelinMatch';
import { findMichelinMatchSync, michelinPriceDisplay, type MichelinInfo } from '../lib/michelin';
import { cn } from '../lib/utils';
import { LoadingSkeletonList } from '../components/LoadingSkeleton';
import { EmptyState } from '../components/EmptyState';
import { useLists } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';
import { getPublicRecipes, type Recipe } from '../lib/supabase-recipes';
import {
  searchUsersByUsername, getFriends, getSentRequestIds, getPendingRequests,
  getFollowerIds, sendFriendRequest, acceptFriendRequest, followPublicAccount,
  getAllPublicHomeMeals,
  type UserProfile, type FriendHomeMeal,
} from '../lib/supabase-community';

const RECENT_SEARCHES_KEY = 'gourmet-canvas-recent-searches-v2';
const MAX_RECENT = 10;
const DEFAULT_LAT = 40.735;
const DEFAULT_LNG = -73.99;
// Each section shows this many rows before the "Show all" toggle expands it.
const PREVIEW_COUNT = 5;

type SectionKey = 'restaurants' | 'recipes' | 'friends';

// Directional relationship per user, drives the trailing follow control. Mirrors
// AddFriendSheet: following > requested > incoming (Accept) > followback > Add.
type Relationship = 'following' | 'requested' | 'incoming' | 'followback';

interface RecentSearch {
  id: string;
  name: string;
  cuisine: string;
  price: string;
  image: string;
  address: string;
  rating?: number;
  timestamp?: number;
}

// Colored initial avatars for friend rows — same palette as AddFriendSheet so
// people look identical wherever they appear.
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

// Haversine distance in miles between two lat/lng points.
function haversineDistanceMi(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!lat2 || !lng2) return 0;
  const R = 3958.8; // Earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(miles: number): string {
  if (miles <= 0) return '';
  if (miles < 0.1) return '< 0.1 mi away';
  if (miles < 10) return `${miles.toFixed(1)} mi away`;
  return `${Math.round(miles)} mi away`;
}

function formatCookTime(mins: number | null): string {
  if (!mins || mins <= 0) return '';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// "Italian · 45m" style subtitle for the thin recipe rows.
function recipeMeta(r: Recipe): string {
  return [r.cuisine, formatCookTime(r.cookTimeMinutes)].filter(Boolean).join(' · ') || 'Recipe';
}

// Most real recipes live in the home_meals blob (user_app_data), not the
// formal recipes table — see the recipe-data-model. Adapt one into the Recipe
// shape so search can treat both sources as a single list. Mirrors RecipesForYou.
function homeMealToRecipe(m: FriendHomeMeal): Recipe {
  return {
    id: m.id,
    userId: m.userId,
    title: m.name,
    description: m.description || '',
    ingredients: m.ingredients || [],
    steps: (m.steps || []).map((text, i) => ({ order: i, text })),
    prepTimeMinutes: m.prepTime ?? null,
    cookTimeMinutes: m.cookTime ?? null,
    servings: m.servings ?? null,
    difficulty: ((m.difficulty?.toLowerCase() ?? 'medium') as 'easy' | 'medium' | 'hard'),
    cuisine: m.cuisine || '',
    tags: m.tags || [],
    photos: m.coverPhoto ? [m.coverPhoto] : (m.photos?.map((p) => p.url).filter(Boolean) || []),
    isPublic: true,
    sourceType: 'user',
    linkedRestaurantId: null,
    linkedMealId: null,
    createdAt: new Date(m.createdAt ?? Date.now()).toISOString(),
    updatedAt: new Date(m.createdAt ?? Date.now()).toISOString(),
  };
}

function readRecentSearches(): RecentSearch[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is RecentSearch =>
      !!x && typeof x === 'object' && typeof x.id === 'string' && typeof x.name === 'string'
    );
  } catch {
    return [];
  }
}

function writeRecentSearches(list: RecentSearch[]) {
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota errors */
  }
}

function placeToRecent(place: PlaceResult): RecentSearch {
  return {
    id: place.id,
    name: place.name,
    cuisine: extractCityState(place.fullAddress || '', place.address || ''),
    price: priceLevelToString(place.priceLevel),
    image: place.photoUrl || '',
    address: place.fullAddress || place.address || '',
    rating: place.rating,
    timestamp: Date.now(),
  };
}

// Small section header — uppercase label + result count, matching this page's
// existing "Recent Searches" vocabulary.
const SectionHeading: React.FC<{ label: string; count: number; phoneMode: boolean }> = ({ label, count, phoneMode }) => (
  <div className={cn('flex items-center gap-2 mb-1', phoneMode && 'px-4')}>
    <h2 className="text-xs font-bold text-on-surface/45 uppercase tracking-[0.15em]">{label}</h2>
    <span className="text-[11px] font-bold text-on-surface/30">{count}</span>
  </div>
);

const ShowAllRow: React.FC<{ expanded: boolean; total: number; phoneMode: boolean; onClick: () => void }> = ({ expanded, total, phoneMode, onClick }) => (
  <div className={cn('mt-1.5', phoneMode && 'px-4')}>
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-[13px] font-bold text-primary hover:text-primary/80 transition-colors"
    >
      {expanded ? 'Show less' : `Show all ${total}`}
      <ChevronDown size={15} className={cn('transition-transform', expanded && 'rotate-180')} />
    </button>
  </div>
);

export const SearchMain: React.FC = () => {
  const navigate = useNavigate();
  const { openAddRestaurantModal, toggleWishlist, isWishlisted } = useLists();
  const { phoneMode } = useSettings();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [searchQuery, setSearchQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>(() => readRecentSearches());

  // Per-section results + loading. Restaurants + friends are searched live;
  // recipes are filtered client-side from a pool fetched once (most live in
  // the home_meals blob, which has no server-side title search).
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [friendResults, setFriendResults] = useState<UserProfile[]>([]);
  const [recipePool, setRecipePool] = useState<Recipe[]>([]);
  const [poolLoading, setPoolLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [friendsLoading, setFriendsLoading] = useState(false);

  // Which sections are expanded (showing all, not just the first PREVIEW_COUNT).
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({ restaurants: false, recipes: false, friends: false });

  // Follow state for the friends section.
  const [relationships, setRelationships] = useState<Record<string, Relationship>>({});
  const [pendingFollow, setPendingFollow] = useState<Set<string>>(new Set());
  const [incomingReqIds, setIncomingReqIds] = useState<Record<string, string>>({});

  const [userLat, setUserLat] = useState(DEFAULT_LAT);
  const [userLng, setUserLng] = useState(DEFAULT_LNG);
  const [locationKnown, setLocationKnown] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const recipesSectionRef = useRef<HTMLElement>(null);
  const friendsSectionRef = useRef<HTMLElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef<string>('');

  // Michelin overlay for restaurant rows.
  const michelinReady = useMichelinIndexReady();
  const michelinByPlaceId = useMemo(() => {
    const m: Record<string, MichelinInfo> = {};
    if (!michelinReady) return m;
    for (const place of results) {
      const hit = findMichelinMatchSync(place.name, place.lat, place.lng, place.fullAddress || place.address);
      if (hit) m[place.id] = hit;
    }
    return m;
  }, [michelinReady, results]);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLat(pos.coords.latitude);
        setUserLng(pos.coords.longitude);
        setLocationKnown(true);
      },
      () => { /* keep defaults; locationKnown stays false so distance is hidden */ },
      { timeout: 5000 },
    );
  }, []);

  // Build the recipe search pool once: public home meals (where most recipes
  // live) + the public recipes table, deduped by id. Filtered client-side as
  // the user types so the Recipes section updates instantly.
  useEffect(() => {
    let cancelled = false;
    setPoolLoading(true);
    (async () => {
      const [homeMeals, tableRecipes] = await Promise.all([
        getAllPublicHomeMeals(userId || '', { mealLimit: 80 }),
        getPublicRecipes(40),
      ]);
      if (cancelled) return;
      const byId = new Map<string, Recipe>();
      for (const r of [...homeMeals.map(homeMealToRecipe), ...tableRecipes]) {
        if (r.id && !byId.has(r.id)) byId.set(r.id, r);
      }
      setRecipePool([...byId.values()]);
      setPoolLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const recipeResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return recipePool
      .filter((r) => r.title.toLowerCase().includes(q) || (r.cuisine || '').toLowerCase().includes(q))
      .slice(0, 24);
  }, [searchQuery, recipePool]);

  // Load the current user's directional edges once so friend rows show the
  // right follow control. Precedence matches AddFriendSheet.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const [following, sentIds, incoming, followerIds] = await Promise.all([
        getFriends(userId),
        getSentRequestIds(userId),
        getPendingRequests(userId),
        getFollowerIds(userId),
      ]);
      if (cancelled) return;
      const map: Record<string, Relationship> = {};
      following.forEach((f) => { map[f.friend_id] = 'following'; });
      sentIds.forEach((id) => { if (!map[id]) map[id] = 'requested'; });
      const inc: Record<string, string> = {};
      incoming.forEach((r) => { if (!map[r.user_id]) map[r.user_id] = 'incoming'; inc[r.user_id] = r.id; });
      followerIds.forEach((id) => { if (!map[id]) map[id] = 'followback'; });
      setRelationships(map);
      setIncomingReqIds(inc);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const runRestaurantSearch = useCallback(async (q: string) => {
    if (lastQueryRef.current !== q) return;
    setLoading(true);
    try {
      const found = await searchPlacesByText(q, userLat, userLng);
      if (lastQueryRef.current !== q) return;
      setResults(found);
    } catch {
      if (lastQueryRef.current === q) setResults([]);
    } finally {
      if (lastQueryRef.current === q) setLoading(false);
    }
  }, [userLat, userLng]);

  // Debounced search across all three sections as the user types.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = searchQuery.trim();
    // A fresh query starts every section collapsed again.
    setExpanded({ restaurants: false, recipes: false, friends: false });
    if (!q) {
      lastQueryRef.current = '';
      setResults([]); setFriendResults([]);
      setLoading(false); setFriendsLoading(false);
      return;
    }
    lastQueryRef.current = q;
    setLoading(true); setFriendsLoading(true);
    debounceRef.current = setTimeout(() => {
      void runRestaurantSearch(q);
      if (userId) {
        searchUsersByUsername(q, userId)
          .then((us) => { if (lastQueryRef.current === q) setFriendResults(us); })
          .catch(() => { if (lastQueryRef.current === q) setFriendResults([]); })
          .finally(() => { if (lastQueryRef.current === q) setFriendsLoading(false); });
      } else {
        setFriendResults([]); setFriendsLoading(false);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery, runRestaurantSearch, userId]);

  // Mirror `expanded` into a ref so toggleSection can read the current state
  // without depending on it (keeps the callback identity stable).
  const expandedRef = useRef(expanded);
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);

  const toggleSection = useCallback((key: SectionKey) => {
    const willExpand = !expandedRef.current[key];
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
    // Expanding one of the lower sections brings it up to the top of the view.
    // Run after the new rows have committed so the scroll target is settled.
    if (willExpand && (key === 'recipes' || key === 'friends')) {
      // Bring the expanded section up just below the sticky search header.
      // Compute the offset from the live header height so it lands correctly
      // even with the iOS safe-area inset. Runs after the rows have committed.
      setTimeout(() => {
        const el = key === 'recipes' ? recipesSectionRef.current : friendsSectionRef.current;
        if (!el) return;
        const headerH = headerRef.current?.getBoundingClientRect().height ?? 72;
        const y = window.scrollY + el.getBoundingClientRect().top - headerH - 8;
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      }, 60);
    }
  }, []);

  const followUser = useCallback(async (target: UserProfile) => {
    if (!userId || pendingFollow.has(target.user_id)) return;
    const rel = relationships[target.user_id];
    if (rel === 'following' || rel === 'requested') return;
    setPendingFollow((p) => new Set(p).add(target.user_id));
    const immediate = !!(target.is_public || target.is_expert);
    const ok = immediate
      ? await followPublicAccount(userId, target.user_id)
      : await sendFriendRequest(userId, target.user_id);
    setPendingFollow((p) => { const n = new Set(p); n.delete(target.user_id); return n; });
    if (ok) setRelationships((prev) => ({ ...prev, [target.user_id]: immediate ? 'following' : 'requested' }));
  }, [userId, pendingFollow, relationships]);

  const handleAccept = useCallback(async (target: UserProfile) => {
    const reqId = incomingReqIds[target.user_id];
    if (!userId || !reqId || pendingFollow.has(target.user_id)) return;
    setPendingFollow((p) => new Set(p).add(target.user_id));
    const ok = await acceptFriendRequest(reqId);
    setPendingFollow((p) => { const n = new Set(p); n.delete(target.user_id); return n; });
    if (ok) setRelationships((prev) => ({ ...prev, [target.user_id]: 'followback' }));
  }, [userId, incomingReqIds, pendingFollow]);

  const handleSelectResult = (place: PlaceResult) => {
    const entry = placeToRecent(place);
    const next = [entry, ...recentSearches.filter((x) => x.id !== entry.id)].slice(0, MAX_RECENT);
    setRecentSearches(next);
    writeRecentSearches(next);
    navigate(`/restaurant/${place.id}`);
  };

  const handleRecentClick = (r: RecentSearch) => {
    navigate(`/restaurant/${r.id}`);
  };

  const handleRemove = (id: string) => {
    const next = recentSearches.filter((x) => x.id !== id);
    setRecentSearches(next);
    writeRecentSearches(next);
  };

  const handleClearAll = () => {
    setRecentSearches([]);
    writeRecentSearches([]);
  };

  const hasQuery = searchQuery.trim().length > 0;

  // ── Row renderers ──────────────────────────────────────────────────────
  const renderRestaurantRow = (place: PlaceResult) => {
    const location = formatLocationLabel(place.addressComponents, place.fullAddress || place.address || '');
    const price = priceLevelToString(place.priceLevel);
    const distance = locationKnown
      ? formatDistance(haversineDistanceMi(userLat, userLng, place.lat, place.lng))
      : '';
    const wishlisted = isWishlisted(place.id);
    const meta = {
      id: place.id,
      name: place.name,
      image: place.photoUrl || '',
      cuisine: location || 'Restaurant',
      price,
      address: place.fullAddress || place.address || '',
    };
    const mich = michelinByPlaceId[place.id];
    const label = mich ? mich.cuisine : (location || 'Restaurant');
    const priceText = mich ? michelinPriceDisplay(mich) : price;
    return (
      <li key={place.id}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => handleSelectResult(place)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectResult(place); }
          }}
          className={cn(
            'w-full flex gap-3 py-3 text-left group transition-colors hover:bg-on-surface/[0.03] active:bg-on-surface/[0.05] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            phoneMode ? 'px-4' : 'px-2 -mx-2 rounded-xl',
          )}
        >
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <h3 className="font-serif font-bold text-[15px] leading-snug line-clamp-2 group-hover:text-primary transition-colors">{place.name}</h3>
            <p className="mt-0.5 text-[12.5px] text-on-surface/55 font-medium truncate">
              {label}
              {priceText && <><span className="text-on-surface/25 mx-1.5">·</span>{priceText}</>}
            </p>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-on-surface/50">
              {place.rating > 0 && (
                <span className="flex items-center gap-1 text-primary font-bold">
                  <Star size={12} className="fill-primary" />
                  {place.rating.toFixed(1)}
                </span>
              )}
              {place.rating > 0 && distance && <span className="text-on-surface/25">·</span>}
              {distance && <span>{distance}</span>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 self-center">
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleWishlist(meta); }}
              className={cn(
                'w-9 h-9 rounded-full flex items-center justify-center bg-on-surface/[0.04] shadow-sm transition-transform duration-150 hover:scale-105 active:scale-95',
                wishlisted ? 'text-primary' : 'text-on-surface/70 hover:text-primary',
              )}
              aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
            >
              <Bookmark size={16} className={cn(wishlisted && 'fill-primary')} />
            </button>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); openAddRestaurantModal(meta); }}
              className="w-9 h-9 rounded-full flex items-center justify-center bg-on-surface/[0.04] shadow-sm text-primary transition-transform duration-150 hover:scale-105 active:scale-95"
              aria-label="Add to list"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
      </li>
    );
  };

  const renderRecipeRow = (r: Recipe) => (
    <li key={r.id}>
      <button
        type="button"
        onClick={() => navigate(`/recipe/${r.userId}/${r.id}`)}
        className={cn(
          'w-full flex items-center gap-3 py-2.5 text-left group transition-colors hover:bg-on-surface/[0.03] active:bg-on-surface/[0.05]',
          phoneMode ? 'px-4' : 'px-2 -mx-2 rounded-xl',
        )}
      >
        {r.photos[0] ? (
          <img
            src={r.photos[0]}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="w-11 h-11 rounded-xl object-cover flex-shrink-0 bg-on-surface/[0.05]"
          />
        ) : (
          <div className="w-11 h-11 rounded-xl flex-shrink-0 bg-on-surface/[0.05] flex items-center justify-center text-on-surface/30">
            <ChefHat size={18} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-serif font-bold text-[14px] leading-tight truncate group-hover:text-primary transition-colors">{r.title}</h3>
          <p className="text-[12px] text-on-surface/55 truncate mt-0.5">{recipeMeta(r)}</p>
        </div>
      </button>
    </li>
  );

  const renderFollowControl = (p: UserProfile) => {
    const isPending = pendingFollow.has(p.user_id);
    const status = relationships[p.user_id];
    if (status === 'following') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-on-surface/[0.06] text-[12px] font-semibold text-on-surface/55 flex-shrink-0">
          <Check size={13} /> Following
        </span>
      );
    }
    if (status === 'requested') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-on-surface/[0.06] text-[12px] font-semibold text-on-surface/55 flex-shrink-0">
          <Check size={13} /> Requested
        </span>
      );
    }
    if (status === 'incoming') {
      return (
        <button
          type="button"
          onClick={() => handleAccept(p)}
          disabled={isPending}
          className="inline-flex items-center gap-1 px-3.5 h-8 rounded-full bg-primary text-white text-[12px] font-bold hover:bg-primary/90 transition-colors disabled:opacity-60 flex-shrink-0"
        >
          {isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} strokeWidth={2.6} />}
          Accept
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => followUser(p)}
        disabled={isPending}
        className="inline-flex items-center gap-1 px-3.5 h-8 rounded-full bg-primary text-white text-[12px] font-bold hover:bg-primary/90 transition-colors disabled:opacity-60 flex-shrink-0"
      >
        {isPending ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} strokeWidth={2.6} />}
        {status === 'followback' ? 'Follow back' : 'Follow'}
      </button>
    );
  };

  const renderFriendRow = (p: UserProfile) => {
    const color = avatarColor(p.user_id);
    const initial = initialOf(p.display_name || p.username);
    return (
      <li key={p.user_id} className={cn('flex items-center gap-3 py-2.5', phoneMode ? 'px-4' : 'px-2 -mx-2')}>
        <button
          type="button"
          onClick={() => p.username && navigate(`/user/${p.username}`)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left group"
        >
          <div className={cn('w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0', color.bg)}>
            <span className={cn('text-[15px] font-serif font-bold', color.text)}>{initial}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-bold text-on-surface truncate leading-tight group-hover:text-primary transition-colors">
              {p.display_name || p.username || 'User'}
            </p>
            <p className="text-[12px] text-on-surface/55 truncate mt-0.5">@{p.username}</p>
          </div>
        </button>
        {renderFollowControl(p)}
      </li>
    );
  };

  const anyResults = results.length > 0 || recipeResults.length > 0 || friendResults.length > 0;
  const anyLoading = loading || friendsLoading || poolLoading;

  return (
    <div className="pb-32 min-h-screen bg-surface">
      <header ref={headerRef} className="sticky top-0 w-full bg-surface/80 backdrop-blur-md z-40">
        <div className="px-4 pt-safe-3 pb-3 flex items-center gap-3 md:max-w-2xl md:mx-auto">
          <button
            type="button"
            onClick={() => navigate('/search')}
            className="w-10 h-10 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center text-on-surface/70 transition-colors flex-shrink-0"
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
          <form
            className="flex-1 relative"
            onSubmit={(e) => { e.preventDefault(); void runRestaurantSearch(searchQuery.trim()); }}
          >
            <SearchIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/40" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search restaurants, recipes, people..."
              className="w-full bg-on-surface/[0.04] rounded-full py-3 pl-11 pr-10 text-sm font-medium focus:outline-none focus:bg-on-surface/[0.06] transition-all"
              autoCapitalize="off"
              autoCorrect="off"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); inputRef.current?.focus(); }}
                className="absolute inset-y-0 right-3 flex items-center text-on-surface/30 hover:text-on-surface/60"
                aria-label="Clear search"
              >
                <X size={16} />
              </button>
            )}
          </form>
        </div>
      </header>

      <main className={cn('pt-2 md:max-w-2xl md:mx-auto md:px-4', !phoneMode && 'px-4')}>
        {hasQuery ? (
          !anyResults && anyLoading ? (
            <LoadingSkeletonList count={6} variant="list-item" className={cn('divide-y divide-on-surface/[0.06]', phoneMode && 'px-4')} />
          ) : !anyResults ? (
            <EmptyState icon={<SearchIcon size={48} />} heading="No results" description="Try a different search." />
          ) : (
            <div className="space-y-6 pb-4">
              {/* ── Restaurants ── */}
              {results.length > 0 && (
                <section className="scroll-mt-[84px]">
                  <SectionHeading label="Restaurants" count={results.length} phoneMode={phoneMode} />
                  <ul className="divide-y divide-on-surface/[0.06]">
                    {(expanded.restaurants ? results : results.slice(0, PREVIEW_COUNT)).map(renderRestaurantRow)}
                  </ul>
                  {results.length > PREVIEW_COUNT && (
                    <ShowAllRow expanded={expanded.restaurants} total={results.length} phoneMode={phoneMode} onClick={() => toggleSection('restaurants')} />
                  )}
                </section>
              )}

              {/* ── Recipes ── */}
              {recipeResults.length > 0 && (
                <section ref={recipesSectionRef} className="scroll-mt-[84px]">
                  <SectionHeading label="Recipes" count={recipeResults.length} phoneMode={phoneMode} />
                  <ul className="divide-y divide-on-surface/[0.06]">
                    {(expanded.recipes ? recipeResults : recipeResults.slice(0, PREVIEW_COUNT)).map(renderRecipeRow)}
                  </ul>
                  {recipeResults.length > PREVIEW_COUNT && (
                    <ShowAllRow expanded={expanded.recipes} total={recipeResults.length} phoneMode={phoneMode} onClick={() => toggleSection('recipes')} />
                  )}
                </section>
              )}

              {/* ── Friends ── */}
              {friendResults.length > 0 && (
                <section ref={friendsSectionRef} className="scroll-mt-[84px]">
                  <SectionHeading label="Friends" count={friendResults.length} phoneMode={phoneMode} />
                  <ul className="space-y-1">
                    {(expanded.friends ? friendResults : friendResults.slice(0, PREVIEW_COUNT)).map(renderFriendRow)}
                  </ul>
                  {friendResults.length > PREVIEW_COUNT && (
                    <ShowAllRow expanded={expanded.friends} total={friendResults.length} phoneMode={phoneMode} onClick={() => toggleSection('friends')} />
                  )}
                </section>
              )}
            </div>
          )
        ) : recentSearches.length > 0 ? (
          // ── Recent searches — thin restaurant cards ──
          <section>
            <div className={cn('flex items-center justify-between mb-2 mt-2', phoneMode && 'px-4')}>
              <div className="flex items-center gap-2">
                <Clock size={13} className="text-on-surface/40" />
                <h2 className="text-xs font-bold text-on-surface/40 uppercase tracking-[0.15em]">Recent Searches</h2>
              </div>
              <button
                type="button"
                onClick={handleClearAll}
                className="text-xs font-bold text-primary uppercase tracking-wider"
              >
                Clear All
              </button>
            </div>
            <ul className="divide-y divide-on-surface/[0.06]">
              {recentSearches.map((r) => {
                const wishlisted = isWishlisted(r.id);
                const location = formatLocationLabel(undefined, r.address);
                const meta = { id: r.id, name: r.name, image: r.image, cuisine: r.cuisine, price: r.price, address: r.address };
                return (
                  <li key={r.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleRecentClick(r)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRecentClick(r); }
                      }}
                      className={cn(
                        'w-full flex items-center gap-3 py-4 text-left group transition-colors hover:bg-on-surface/[0.03] active:bg-on-surface/[0.05] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                        phoneMode ? 'px-4' : 'px-2 -mx-2 rounded-xl',
                      )}
                    >
                      <div className="w-9 h-9 flex-shrink-0 rounded-full bg-on-surface/[0.05] flex items-center justify-center text-on-surface/40">
                        <Clock size={15} />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <h3 className="font-serif font-bold text-[15px] leading-snug line-clamp-2">{r.name}</h3>
                        {(r.cuisine || location) && (
                          <p className="mt-0.5 text-[11px] text-on-surface/50 font-medium uppercase tracking-wider truncate">
                            {r.cuisine}
                            {r.cuisine && location && <span className="text-on-surface/25 mx-1.5">·</span>}
                            {location}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 self-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleWishlist(meta); }}
                          className={cn(
                            'w-9 h-9 rounded-full flex items-center justify-center bg-on-surface/[0.04] shadow-sm transition-transform duration-150 hover:scale-105 active:scale-95',
                            wishlisted ? 'text-primary' : 'text-on-surface/70 hover:text-primary',
                          )}
                          aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
                        >
                          <Bookmark size={16} className={cn(wishlisted && 'fill-primary')} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); openAddRestaurantModal(meta); }}
                          className="w-9 h-9 rounded-full flex items-center justify-center bg-on-surface/[0.04] shadow-sm text-primary transition-transform duration-150 hover:scale-105 active:scale-95"
                          aria-label="Add to list"
                        >
                          <Plus size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRemove(r.id); }}
                          className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface/30 hover:text-on-surface/60 hover:bg-on-surface/[0.04] transition-colors"
                          aria-label={`Remove ${r.name}`}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <EmptyState
            icon={<SearchIcon size={48} />}
            heading="Search for a restaurant"
            description="Recent picks will appear here."
          />
        )}
      </main>
    </div>
  );
};
