/**
 * Recipes Explore page — "The Recipe Box".
 *
 * Reached from Discover's "see all" on the Recipes rail (route /recipes-for-you).
 * Desktop: editorial layout with masthead + Recipe of the Day, prominent
 * search, and a faceted browse panel. Mobile: app-standard sticky header
 * (back / serif title / actions + search & filter row), Recipe of the Day,
 * a single source chip row, and the shared FilterSheet hosting meal / tags
 * / sort.
 *
 * All styling lives in RecipesForYou.css under .recipes-page-root so the
 * editorial tokens don't leak into other routes.
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { Link, useNavigate } from 'react-router-dom';
import { useHeaderFade } from '../lib/useHeaderFade';
import { ArrowLeft, ArrowUpDown, BookOpen, Bookmark, Cake, Check, ChefHat, ChevronDown, ChevronLeft, ChevronRight, ChevronRight as ChevRight, Clock, Crown, LayoutGrid, List, Plus, Search, SlidersHorizontal, Soup, Sparkles, Star, Sun, Tag, TrendingUp, UtensilsCrossed, Users, Wheat, Wine, X } from 'lucide-react';
import { ShareIcon } from '../components/icons/ShareIcon';
import { FilterSheet } from '../components/FilterSheet';
import { FilterSection, Pill, PillRow, Segment, SegmentItem } from '../components/filterPrimitives';
import { useAuth } from '../contexts/AuthContext';
import { useSignInModal } from '../contexts/SignInModalContext';
import { useLists, DEFAULT_WANT_TO_COOK_ID, type HomeMeal } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { usePageAddAction } from '../contexts/PageAddActionContext';
import { getPublicRecipes, type Recipe } from '../lib/supabase-recipes';
import { getProfilesByIds, getFriends, getFriendsPublicHomeMeals, type UserProfile, type FriendHomeMeal } from '../lib/supabase-community';
import { cn } from '../lib/utils';
import { shareExternally } from '../lib/native-share';
import './RecipesForYou.css';
import { avatarHue } from '../lib/avatar';
import { SearchField } from '../components/SearchField';

type SourceFilter = 'all' | 'friend' | 'chef' | 'home';
type SortKey = 'recent' | 'quick' | 'az';
type MealKey = 'breakfast' | 'lunch' | 'dinner' | 'dessert' | 'baking' | 'drinks';
type ViewMode = 'grid' | 'list';

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Most Recent',
  quick: 'Quickest first',
  az: 'A–Z',
};

// The browse segmented control. Shorter than SOURCE_LABELS: four words in
// one segmented bar have to fit a phone, and the bar's own label says what
// they're sources OF.
const SEGMENT_LABELS: Record<SourceFilter, string> = {
  all: 'All',
  friend: 'Friends',
  chef: 'Chefs',
  home: 'Home',
};

const SOURCE_LABELS: Record<SourceFilter, string> = {
  all: 'All recipes',
  friend: 'Friends',
  chef: 'Chefs',
  home: 'Home Cooks',
};

const DIFFICULTY_LABEL: Record<Recipe['difficulty'], string> = {
  easy: 'Easy', medium: 'Medium', hard: 'Hard',
};

// Browse-by-meal categories. Hue values feed the colored icon tile so the
// row reads like the editorial mock-up.
const MEAL_CATEGORIES: { key: MealKey; label: string; hue: number; icon: typeof Sun }[] = [
  { key: 'breakfast', label: 'Breakfast', hue: 42,  icon: Sun },
  { key: 'lunch',     label: 'Lunch',     hue: 90,  icon: Soup },
  { key: 'dinner',    label: 'Dinner',    hue: 355, icon: UtensilsCrossed },
  { key: 'dessert',   label: 'Dessert',   hue: 330, icon: Cake },
  { key: 'baking',    label: 'Baking',    hue: 30,  icon: Wheat },
  { key: 'drinks',    label: 'Drinks',    hue: 200, icon: Wine },
];


// How many cards the grid shows before "Load more recipes".
const PAGE_SIZE = 12;

/** A quick-filter chip. `test` is the real predicate — a chip that can't
 *  narrow anything is never offered (see `quickChips`). */
interface QuickChip { key: string; label: string; test: (r: Recipe) => boolean }

const totalMinutes = (r: Recipe): number => (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0);

// Stable seed-based number from a string — used only for deterministic
// ordering (so mixed pools don't reshuffle between renders), never for
// displayed counts.
const stableHash = (s: string): number => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

// Map the recipe's tags to a single meal category. Picks the first match;
// falls back to "dinner" when nothing matches so every recipe ends up in
// at least one bucket.
const recipeMeal = (r: Recipe): MealKey => {
  const tags = r.tags.map((t) => t.toLowerCase());
  const has = (...needles: string[]) => tags.some((t) => needles.some((n) => t.includes(n)));
  if (has('breakfast', 'brunch')) return 'breakfast';
  if (has('lunch')) return 'lunch';
  if (has('dessert', 'sweet')) return 'dessert';
  if (has('baking', 'bread')) return 'baking';
  if (has('drink', 'cocktail', 'beverage')) return 'drinks';
  return 'dinner';
};

// ── Desktop faceted-filter helpers ──────────────────────────────────
// The redesigned desktop browse panel filters on six facets. Meal / source
// reuse the existing classifiers; the rest derive straight from recipe data.
type FacetId = 'meal' | 'cuisine' | 'dietary' | 'time' | 'difficulty' | 'source';
const FACET_IDS: FacetId[] = ['meal', 'cuisine', 'dietary', 'time', 'difficulty', 'source'];

// Tags we treat as "dietary" filter options (everything else stays a free tag).
const DIETARY_KEYS = ['gluten-free', 'vegetarian', 'vegan', 'healthy', 'low-carb', 'dairy-free', 'keto', 'paleo', 'high-protein'];
const recipeDietary = (r: Recipe): string[] => {
  const set = new Set(r.tags.map((t) => t.toLowerCase()));
  return DIETARY_KEYS.filter((k) => set.has(k));
};
const recipeTimeBucket = (r: Recipe): 'u30' | 'm3060' | 'o60' | null => {
  const m = (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0);
  if (m <= 0) return null;
  return m < 30 ? 'u30' : m <= 60 ? 'm3060' : 'o60';
};
const prettyTag = (t: string): string => t.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Format a (prep + cook) minute total for the recipe-of-day / trend rows.
const formatTime = (mins: number): string => {
  if (!Number.isFinite(mins) || mins <= 0) return '';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

const sourceOf = (r: Recipe, friendIds: Set<string>, author?: UserProfile): SourceFilter => {
  if (author?.is_verified || r.sourceType === 'expert') return 'chef';
  if (friendIds.has(r.userId)) return 'friend';
  return 'home';
};

// Adapt a FriendHomeMeal (rows from user_app_data.home_meals) into the
// Recipe shape so the rest of the page can treat both data sources as one
// list. Mirrors the adapter Discover.tsx uses for its rail.
const friendHomeMealToRecipe = (m: FriendHomeMeal): Recipe => ({
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
});

/**
 * Inverse of friendHomeMealToRecipe, for saving: shape a browsed public
 * recipe as a HomeMeal so it can live on the "Want to Cook" pantry list.
 *
 * When saving SOMEONE ELSE's recipe (`isOwn` false), the copy lands PRIVATE
 * (isPublic:false) and carries the original author's attribution — publishing
 * a duplicate under your name leaked other users' recipes into friends'
 * feeds/pickers. Only your own recipe re-saves itself public and without a
 * sourceAuthor stamp (which is what marks a copy as "from elsewhere").
 */
const publicRecipeToHomeMeal = (r: Recipe, isOwn: boolean, author?: UserProfile): HomeMeal => ({
  id: r.id,
  name: r.title,
  date: (r.createdAt || new Date().toISOString()).slice(0, 10),
  score: 0,
  wouldMakeAgain: false,
  description: r.description || '',
  photos: (r.photos || []).map((url) => ({ url, caption: '', isFavorite: false })),
  tags: r.tags || [],
  dishes: [],
  isPublic: isOwn,
  createdAt: Date.parse(r.createdAt) || Date.now(),
  coverPhoto: r.photos?.[0] || undefined,
  prepTime: r.prepTimeMinutes ?? undefined,
  cookTime: r.cookTimeMinutes ?? undefined,
  servings: r.servings ?? undefined,
  difficulty: r.difficulty
    ? ((r.difficulty.charAt(0).toUpperCase() + r.difficulty.slice(1)) as 'Easy' | 'Medium' | 'Hard')
    : undefined,
  cuisine: r.cuisine || undefined,
  ingredients: r.ingredients || [],
  steps: (r.steps || []).map((st) => st.text),
  ...(isOwn ? {} : {
    sourceAuthorId: r.userId,
    sourceAuthorName: author?.display_name || author?.username || undefined,
    sourceAuthorUsername: author?.username || undefined,
  }),
});

const sourceLabelOf = (s: SourceFilter): string =>
  s === 'chef' ? 'Chef' : s === 'friend' ? 'Friend' : 'Home Cook';

const SourceIcon: React.FC<{ source: SourceFilter; className?: string }> = ({ source, className }) =>
  source === 'chef'
    ? <Crown className={className} />
    : source === 'friend'
      ? <Users className={className} />
      : <ChefHat className={className} />;

interface RecipesForYouProps {
  /** Rendered inside another page's chrome — the Search tab's Recipes
   *  pill — rather than as its own route. That page already carries the
   *  pill naming this view and the one search field every tab shares, so
   *  the sticky header would only repeat both; the host drives the query
   *  instead. */
  embedded?: boolean;
  /** Embedded only: the host's field text. */
  query?: string;
  onQueryChange?: (q: string) => void;
}

export const RecipesForYou: React.FC<RecipesForYouProps> = ({ embedded = false, query, onQueryChange }) => {
  const navigate = useNavigate();
  const { user, isSignedIn } = useAuth();
  const { requireSignIn } = useSignInModal();
  const { homeMeals, lists, addRecipeToList, removeRecipeFromList } = useLists();
  const { phoneMode } = useSettings();
  const { setOverride: setPageAddAction } = usePageAddAction();
  // Mobile header (title + search + filters) dissolves with scroll,
  // Discover-style, and returns near the top.
  const headerFade = useHeaderFade({ enabled: phoneMode, windowScroll: true });

  // On the Recipe Box, the desktop header's "Add Rating" CTA becomes
  // "Add Recipe" (→ the create flow). Reverts on unmount.
  useEffect(() => {
    setPageAddAction({ label: 'Add Recipe', onClick: () => navigate('/create') });
    return () => setPageAddAction(null);
  }, [setPageAddAction, navigate]);

  // ── Data ──
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [authors, setAuthors] = useState<Record<string, UserProfile>>({});
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Saved = on the "Want to Cook" pantry list, same as every other recipe
  // save surface (recipe page sheet, feed cards) — one store, one meaning.
  const wantToCookList = lists.find((l) => l.id === DEFAULT_WANT_TO_COOK_ID);
  const savedIds = useMemo(
    () => new Set((wantToCookList?.recipes ?? []).map((r) => r.id)),
    [wantToCookList?.recipes],
  );

  // Filter / sort / view state.
  const [source, setSource] = useState<SourceFilter>('all');
  const [meal, setMeal] = useState<MealKey | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const [view, setView] = useState<ViewMode>('grid');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  // Mobile: meal / tag / sort live in the app's shared FilterSheet (same
  // bottom sheet as Discover and the public profile) instead of stacked
  // chip rows on the page.
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  // The header bookmark: your saved recipes, shown HERE rather than by
  // throwing you into the Pantry list (which, opened from the Search tab,
  // meant leaving the tab entirely to look at four cards).
  const [savedOnly, setSavedOnly] = useState(false);
  // The quick-filter row. A set, so they compose: "Under 30 min" plus a
  // tag narrows to both. Every chip is derived from the library itself
  // (see `quickChips`), so none of them can be a dead end.
  const [quick, setQuick] = useState<Set<string>>(new Set());
  const toggleQuick = useCallback((key: string) => {
    setQuick((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  // The grid pages in rather than dumping the whole library at once.
  const [shown, setShown] = useState(PAGE_SIZE);

  // Search — discreet field tucked into the explore-bar so the legacy
  // search behavior still works without the old sticky header.
  const [searchOpen, setSearchOpen] = useState(false);
  // Own state as a route, the host's when embedded — same name from here
  // down, so every filter, facet and empty state reads one query.
  const [ownQuery, setOwnQuery] = useState('');
  const searchQuery = embedded ? (query ?? '') : ownQuery;
  const setSearchQuery = embedded ? (onQueryChange ?? (() => {})) : setOwnQuery;

  // Desktop browse panel uses a multi-select faceted sidebar (Meal, Cuisine,
  // Dietary, Time, Difficulty, From). Kept separate from the mobile chips so
  // each layout keeps its own UX.
  const [facetSel, setFacetSel] = useState<Record<FacetId, Set<string>>>(() => ({
    meal: new Set(), cuisine: new Set(), dietary: new Set(), time: new Set(), difficulty: new Set(), source: new Set(),
  }));
  const toggleFacet = useCallback((fid: FacetId, key: string) => {
    setFacetSel((prev) => {
      const next = new Set(prev[fid]);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...prev, [fid]: next };
    });
  }, []);

  // Horizontal scroll refs.
  const trendRowRef = useRef<HTMLDivElement>(null);
  const friendsRowRef = useRef<HTMLDivElement>(null);
  const collectionsRowRef = useRef<HTMLDivElement>(null);

  // ── Load ──
  // Friends publish recipes through two separate paths: the formal /recipes
  // flow (rows in the `recipes` table, covered by getPublicRecipes) and the
  // meal-logger flow (rows in user_app_data.home_meals, only reachable via
  // getFriendsPublicHomeMeals). Both have to be merged so the "Friends" tab
  // and the From-Your-Friends rail aren't silently empty whenever the user's
  // friends only logged meals.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);

      // Run the public-recipes pull and the viewer's friends list in
      // parallel — neither depends on the other.
      const [list, friends] = await Promise.all([
        getPublicRecipes(200),
        user?.id ? getFriends(user.id) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      const friendIdSet = new Set(friends.map((f) => f.friend_id));
      setFriendIds(friendIdSet);

      // Pull friend home meals only when there are friends. Merge them into
      // the recipes list (de-duped by id, formal recipes win on collision).
      const friendIdArr = Array.from(friendIdSet);
      const homeMeals: FriendHomeMeal[] = friendIdArr.length > 0
        ? await getFriendsPublicHomeMeals(friendIdArr)
        : [];
      if (cancelled) return;
      const merged: Recipe[] = [...list];
      const seen = new Set(list.map((r) => r.id));
      for (const m of homeMeals) {
        if (!m?.id || seen.has(m.id)) continue;
        if ((m.name || '').trim().length === 0) continue;
        seen.add(m.id);
        merged.push(friendHomeMealToRecipe(m));
      }
      setRecipes(merged);

      const authorIds = Array.from(new Set(merged.map((r) => r.userId).filter(Boolean)));
      if (authorIds.length > 0) {
        const profiles = await getProfilesByIds(authorIds);
        if (!cancelled) setAuthors(profiles);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Close the sort menu on any outside click.
  useEffect(() => {
    if (!sortMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [sortMenuOpen]);

  // ── Save toggle → Want to Cook list ──
  const toggleSave = useCallback((id: string) => {
    if (!isSignedIn) { requireSignIn('Sign in to save recipes'); return; }
    if (savedIds.has(id)) {
      removeRecipeFromList(DEFAULT_WANT_TO_COOK_ID, id);
      return;
    }
    const r = recipes.find((x) => x.id === id);
    if (!r) return;
    const isOwn = !!user?.id && r.userId === user.id;
    addRecipeToList(DEFAULT_WANT_TO_COOK_ID, publicRecipeToHomeMeal(r, isOwn, isOwn ? undefined : authors[r.userId]));
  }, [isSignedIn, requireSignIn, savedIds, recipes, user?.id, authors, addRecipeToList, removeRecipeFromList]);

  // ── Derived: source classifier per recipe ──
  const recipeSource = useCallback((r: Recipe): SourceFilter => {
    return sourceOf(r, friendIds, authors[r.userId]);
  }, [friendIds, authors]);

  // The viewer's own recipes never belong in an "Explore" feed — they're
  // already surfaced from the cookbook/Pantry. Filter them out once and
  // route every downstream derivation (counts, trending, RoD, explore
  // grid) through this filtered list.
  const displayRecipes = useMemo(() => {
    if (!user?.id) return recipes;
    return recipes.filter((r) => r.userId !== user.id);
  }, [recipes, user?.id]);

  // ── Counts per meal / per source for the chip badges. ──
  const mealCounts = useMemo(() => {
    const out: Record<MealKey, number> = { breakfast: 0, lunch: 0, dinner: 0, dessert: 0, baking: 0, drinks: 0 };
    displayRecipes.forEach((r) => { out[recipeMeal(r)]++; });
    return out;
  }, [displayRecipes]);

  const sourceCounts = useMemo(() => {
    const out: Record<SourceFilter, number> = { all: displayRecipes.length, friend: 0, chef: 0, home: 0 };
    displayRecipes.forEach((r) => { out[recipeSource(r)]++; });
    return out;
  }, [displayRecipes, recipeSource]);

  // ── Recipe of the Day: pick stably per UTC day so the hero doesn't churn. ──
  const recipeOfDay = useMemo<Recipe | null>(() => {
    if (displayRecipes.length === 0) return null;
    const dayOfYear = Math.floor(Date.now() / 86400000);
    return displayRecipes[dayOfYear % displayRecipes.length] ?? null;
  }, [displayRecipes]);

  // ── Top tags (taken from the full library) for the explore-tag chips. ──
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    displayRecipes.forEach((r) => r.tags.forEach((t) => {
      counts.set(t, (counts.get(t) || 0) + 1);
    }));
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([t]) => t);
  }, [displayRecipes]);

  // ── Trending: top 6, ranked by recency. Fake "up X" derived from
  //    a stable hash so the value doesn't reshuffle each render. ──
  const trending = useMemo<Recipe[]>(() => displayRecipes.slice(0, 6), [displayRecipes]);

  // ── Friends' recent recipes ──
  const friendRecipes = useMemo(
    () => displayRecipes.filter((r) => friendIds.has(r.userId)).slice(0, 8),
    [displayRecipes, friendIds],
  );

  // ── Top friend names for the activity strip (deduplicated). ──
  const activeFriends = useMemo(() => {
    const seen = new Set<string>();
    const out: { userId: string; name: string }[] = [];
    for (const r of friendRecipes) {
      if (seen.has(r.userId)) continue;
      seen.add(r.userId);
      const p = authors[r.userId];
      const name = p?.display_name || p?.username || 'Friend';
      out.push({ userId: r.userId, name });
      if (out.length >= 3) break;
    }
    return out;
  }, [friendRecipes, authors]);

  // ── Chef spotlight: experts with at least one public recipe ──
  const chefSpotlight = useMemo(() => {
    const byChef = new Map<string, { profile: UserProfile; recipeCount: number }>();
    displayRecipes.forEach((r) => {
      const p = authors[r.userId];
      if (!p?.is_verified) return;
      const cur = byChef.get(p.user_id);
      if (cur) cur.recipeCount++;
      else byChef.set(p.user_id, { profile: p, recipeCount: 1 });
    });
    return Array.from(byChef.values())
      .sort((a, b) => b.recipeCount - a.recipeCount)
      .slice(0, 3);
  }, [displayRecipes, authors]);

  /* ── The quick-filter row ─────────────────────────────────────────────
     Built FROM the library, not hard-coded. Two chips the data can always
     answer — time and difficulty — then the most common real tags. A chip
     is only offered if it actually matches something, so tapping one can
     never land on "no recipes match", which is the failure mode a fixed
     row of fashionable words (Vegetarian, One pan, High protein) has on a
     library that doesn't happen to use those tags. */
  const quickChips = useMemo<QuickChip[]>(() => {
    const candidates: QuickChip[] = [
      { key: 'quick30', label: 'Under 30 min', test: (r) => { const t = totalMinutes(r); return t > 0 && t <= 30; } },
      { key: 'easy', label: 'Easy', test: (r) => r.difficulty === 'easy' },
      ...allTags.slice(0, 6).map((t) => ({
        key: `tag:${t}`,
        label: prettyTag(t),
        test: (r: Recipe) => r.tags.some((x) => x.toLowerCase() === t.toLowerCase()),
      })),
    ];
    return candidates.filter((c) => displayRecipes.some(c.test)).slice(0, 6);
  }, [displayRecipes, allTags]);

  // ── Filter + sort the explore grid ──
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const active = quickChips.filter((c) => quick.has(c.key));
    let pool = displayRecipes.filter((r) => {
      if (!r.title) return false;
      if (savedOnly && !savedIds.has(r.id)) return false;
      if (active.length > 0 && !active.every((c) => c.test(r))) return false;
      if (source !== 'all' && recipeSource(r) !== source) return false;
      if (meal && recipeMeal(r) !== meal) return false;
      if (tag && !r.tags.map((t) => t.toLowerCase()).includes(tag.toLowerCase())) return false;
      if (q) {
        const author = authors[r.userId];
        const haystack = [
          r.title, r.cuisine, r.description, author?.display_name, author?.username, ...r.tags,
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    pool = [...pool];
    if (sortBy === 'az') {
      pool.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === 'quick') {
      pool.sort((a, b) => {
        const at = (a.prepTimeMinutes ?? 0) + (a.cookTimeMinutes ?? 0);
        const bt = (b.prepTimeMinutes ?? 0) + (b.cookTimeMinutes ?? 0);
        const av = at <= 0 ? Number.POSITIVE_INFINITY : at;
        const bv = bt <= 0 ? Number.POSITIVE_INFINITY : bt;
        return av - bv;
      });
    } else {
      pool.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    return pool;
  }, [displayRecipes, authors, source, meal, tag, searchQuery, sortBy, recipeSource, savedOnly, savedIds, quick, quickChips]);

  // ── Stats strip ──
  const cookedCount = homeMeals.length;
  const recipesCount = displayRecipes.length;
  const savedCount = savedIds.size;

  // ── Helpers ──
  const scrollRow = useCallback((ref: React.RefObject<HTMLDivElement | null>, dir: 1 | -1) => {
    ref.current?.scrollBy({ left: dir * 600, behavior: 'smooth' });
  }, []);

  const clearFilters = () => {
    setSource('all');
    setMeal(null);
    setTag(null);
    setSearchQuery('');
    setQuick(new Set());
    setSavedOnly(false);
  };

  const filtersActive = source !== 'all' || meal !== null || tag !== null
    || searchQuery.trim().length > 0 || quick.size > 0 || savedOnly;

  // Narrowing the pool puts you back at the top of it — otherwise a filter
  // applied while 60 cards deep leaves you looking at a page of results
  // that no longer exists.
  useEffect(() => {
    setShown(PAGE_SIZE);
  }, [source, meal, tag, searchQuery, sortBy, savedOnly, quick]);

  // ── Desktop facets: which keys a recipe matches per facet ──
  const facetGet = useCallback((fid: FacetId, r: Recipe): string[] => {
    switch (fid) {
      case 'meal': return [recipeMeal(r)];
      case 'cuisine': return r.cuisine ? [r.cuisine] : [];
      case 'dietary': return recipeDietary(r);
      case 'time': { const b = recipeTimeBucket(r); return b ? [b] : []; }
      case 'difficulty': return r.difficulty ? [r.difficulty] : [];
      case 'source': return [recipeSource(r)];
      default: return [];
    }
  }, [recipeSource]);

  // Build the sidebar groups with live per-option counts (from the full
  // library), hiding any option that no recipe currently has.
  const facetGroups = useMemo(() => {
    const TIME_LABEL: Record<string, string> = { u30: 'Under 30 min', m3060: '30–60 min', o60: 'Over 1 hour' };
    const SRC_LABEL: Record<string, string> = { friend: 'Friends', chef: 'Chefs', home: 'Home Cooks' };
    const defs: { id: FacetId; title: string; order: string[] | null; label: (k: string) => string }[] = [
      { id: 'meal', title: 'Meal', order: MEAL_CATEGORIES.map((c) => c.key), label: (k) => MEAL_CATEGORIES.find((c) => c.key === k)?.label || k },
      { id: 'cuisine', title: 'Cuisine', order: null, label: (k) => k },
      { id: 'dietary', title: 'Dietary', order: DIETARY_KEYS, label: prettyTag },
      { id: 'time', title: 'Time', order: ['u30', 'm3060', 'o60'], label: (k) => TIME_LABEL[k] || k },
      { id: 'difficulty', title: 'Difficulty', order: ['easy', 'medium', 'hard'], label: (k) => DIFFICULTY_LABEL[k as keyof typeof DIFFICULTY_LABEL] || k },
      { id: 'source', title: 'From', order: ['friend', 'chef', 'home'], label: (k) => SRC_LABEL[k] || k },
    ];
    return defs.map((def) => {
      const counts = new Map<string, number>();
      for (const r of displayRecipes) for (const k of facetGet(def.id, r)) counts.set(k, (counts.get(k) || 0) + 1);
      const keys = def.order
        ? def.order.filter((k) => counts.has(k))
        : [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k);
      return {
        id: def.id,
        title: def.title,
        options: keys.map((k) => ({ key: k, label: def.label(k), count: counts.get(k) || 0, active: facetSel[def.id].has(k) })),
      };
    }).filter((g) => g.options.length > 0);
  }, [displayRecipes, facetGet, facetSel]);

  // Filter + sort for the desktop browse grid (multi-select within a facet =
  // OR, across facets = AND; plus the search query).
  const desktopFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const pool = displayRecipes.filter((r) => {
      if (!r.title) return false;
      for (const fid of FACET_IDS) {
        const sel = facetSel[fid];
        if (sel.size === 0) continue;
        if (!facetGet(fid, r).some((v) => sel.has(v))) return false;
      }
      if (q) {
        const author = authors[r.userId];
        const hay = [r.title, r.cuisine, r.description, author?.display_name, author?.username, ...r.tags].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const out = [...pool];
    if (sortBy === 'quick') {
      out.sort((a, b) => {
        const at = (a.prepTimeMinutes ?? 0) + (a.cookTimeMinutes ?? 0);
        const bt = (b.prepTimeMinutes ?? 0) + (b.cookTimeMinutes ?? 0);
        return (at <= 0 ? Infinity : at) - (bt <= 0 ? Infinity : bt);
      });
    } else if (sortBy === 'az') out.sort((a, b) => a.title.localeCompare(b.title));
    else out.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return out;
  }, [displayRecipes, authors, facetSel, facetGet, searchQuery, sortBy]);

  const desktopPills = useMemo(() => {
    const out: { fid: FacetId; key: string; label: string }[] = [];
    for (const g of facetGroups) for (const o of g.options) if (o.active) out.push({ fid: g.id, key: o.key, label: o.label });
    return out;
  }, [facetGroups]);
  const anyDesktopFilter = desktopPills.length > 0 || searchQuery.trim().length > 0;
  const clearDesktop = useCallback(() => {
    setFacetSel({ meal: new Set(), cuisine: new Set(), dietary: new Set(), time: new Set(), difficulty: new Set(), source: new Set() });
    setSearchQuery('');
  }, []);

  // Popular search chips — real cuisines + tags from the library so they
  // always return results.
  const popularSearches = useMemo(() => {
    const cuisines = Array.from(new Set(displayRecipes.map((r) => r.cuisine).filter(Boolean)));
    return Array.from(new Set([...cuisines.slice(0, 2), ...allTags.slice(0, 3)])).slice(0, 5);
  }, [displayRecipes, allTags]);

  const goToRecipe = useCallback((r: Recipe) => {
    navigate(r.userId ? `/recipe/${r.userId}/${r.id}` : `/recipe/${r.id}`);
  }, [navigate]);

  // ── Mobile layout (rendered when phoneMode is true) ─────────────
  //    Different markup using .m-* classes so the page looks like a
  //    proper phone screen instead of the desktop layout squashed down.
  if (phoneMode) {
    // Meal / tag / sort live in the FilterSheet — the chip on the search
    // row shows how many of them are set.
    const sheetFilterCount = (meal ? 1 : 0) + (tag ? 1 : 0) + (sortBy !== 'recent' ? 1 : 0);

    // ── Today's pick ──
    const heroCover = recipeOfDay?.photos?.[0] || '';
    const heroAuthor = recipeOfDay ? authors[recipeOfDay.userId] : undefined;
    const heroAuthorName = heroAuthor?.display_name || heroAuthor?.username || 'Anonymous';
    const heroHue = recipeOfDay ? avatarHue(recipeOfDay.userId || 'x') : 0;
    const heroTime = recipeOfDay ? formatTime(totalMinutes(recipeOfDay)) : '';
    const heroMeta = recipeOfDay
      ? [heroTime, recipeOfDay.difficulty && DIFFICULTY_LABEL[recipeOfDay.difficulty],
         recipeOfDay.servings ? `Serves ${recipeOfDay.servings}` : '']
          .filter(Boolean).join(' · ')
      : '';

    /* Collections are the meal categories, carrying their real counts and
       a cover borrowed from a recipe that's actually in them. Empty ones
       are dropped rather than shown as a tile leading to nothing. */
    const collections = MEAL_CATEGORIES
      .map((c) => ({
        ...c,
        count: mealCounts[c.key],
        cover: displayRecipes.find((r) => recipeMeal(r) === c.key && r.photos?.[0])?.photos?.[0] || '',
      }))
      .filter((c) => c.count > 0);

    // The hero and the collections rail are the page's browse furniture:
    // once you've asked for something specific, they're in the way of the
    // answer.
    const browsing = filtersActive;
    const visible = filtered.slice(0, shown);

    const savedBtn = (
      <button
        type="button"
        className={cn('m-icon-btn', savedOnly && 'on')}
        aria-pressed={savedOnly}
        title={savedOnly ? 'Showing saved' : 'Show saved'}
        aria-label={savedOnly ? 'Showing saved recipes' : 'Show saved recipes'}
        onClick={() => setSavedOnly((v) => !v)}
      >
        <Bookmark fill={savedOnly ? 'currentColor' : 'none'} />
      </button>
    );
    const addBtn = (
      <button
        type="button"
        className="m-add-btn"
        title="Add a recipe"
        aria-label="Add a recipe"
        onClick={() => {
          if (!isSignedIn) { requireSignIn('Sign in to add a recipe'); return; }
          navigate('/create', { state: { mode: 'recipe' } });
        }}
      >
        <Plus />
      </button>
    );
    const filterBtn = (
      <button
        type="button"
        className={cn('m-filter-btn', sheetFilterCount > 0 && 'active')}
        onClick={() => setFilterSheetOpen(true)}
        aria-label="Filters"
      >
        <SlidersHorizontal />
        {sheetFilterCount > 0 && <span className="badge">{sheetFilterCount}</span>}
      </button>
    );

    return (
      <div className={cn('recipes-page-root', embedded && 'is-embedded')}>
        {/* ── The bar at the top ──────────────────────────────────────
            As a route: back button, title, and the two things you come
            here to do — see what you saved, add one of your own.
            Embedded in the Search tab: the host's pill already names this
            view and its floating field already takes the query, so only
            the actions it can't carry stay. ─────────────────────────── */}
        {embedded ? (
          <div className="m-embed-actions">
            {savedBtn}
            {addBtn}
            {filterBtn}
          </div>
        ) : (
        <motion.header ref={headerFade.headerRef} style={headerFade.headerStyle} className="m-header">
          <div className="m-header-row">
            <button type="button" className="m-back-btn" onClick={() => navigate(-1)} aria-label="Back">
              <ChevronLeft />
            </button>
            <h1 className="m-header-title">Recipes</h1>
            <div className="m-header-actions">
              {savedBtn}
              {addBtn}
            </div>
          </div>
          <div className="m-browse-bar">
            <SearchField
              glassId="recipes-search"
              className="flex-1 min-w-0"
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search recipes or ingredients"
            />
            {filterBtn}
          </div>
        </motion.header>
        )}

        {/* ── Quick filters — the narrowings worth one tap ─────────── */}
        {quickChips.length > 0 && (
          <div className="m-quick" role="group" aria-label="Quick filters">
            {quickChips.map((c) => (
              <button
                key={c.key}
                type="button"
                className={cn('m-quick-chip', quick.has(c.key) && 'on')}
                aria-pressed={quick.has(c.key)}
                onClick={() => toggleQuick(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {/* ── Today's pick ────────────────────────────────────────── */}
        {recipeOfDay && !browsing && (
          <article
            className="m-hero"
            role="button"
            tabIndex={0}
            onClick={() => goToRecipe(recipeOfDay)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToRecipe(recipeOfDay); } }}
          >
            <div
              className="m-hero-img"
              style={{ background: `linear-gradient(135deg, hsl(${heroHue} 50% 52%), hsl(${(heroHue + 25) % 360} 50% 42%))` }}
            >
              {heroCover ? (
                <img src={heroCover} alt={recipeOfDay.title} decoding="async" referrerPolicy="no-referrer" />
              ) : (
                <div className="ph-fallback"><ChefHat /></div>
              )}
              <span className="m-hero-badge"><Star /> Today&rsquo;s pick</span>
              <button
                type="button"
                className={cn('m-hero-save', savedIds.has(recipeOfDay.id) && 'saved')}
                onClick={(e) => { e.stopPropagation(); toggleSave(recipeOfDay.id); }}
                aria-label={savedIds.has(recipeOfDay.id) ? 'Saved' : 'Save'}
              >
                <Bookmark fill={savedIds.has(recipeOfDay.id) ? 'currentColor' : 'none'} />
              </button>
              <h2 className="m-hero-name">{recipeOfDay.title}</h2>
            </div>
            <div className="m-hero-foot">
              <div className="m-hero-by">
                <span className="av" style={{ background: `hsl(${heroHue} 45% 38%)` }}>
                  {(heroAuthorName[0] || '?').toUpperCase()}
                </span>
                <span className="m-hero-by-text">
                  <span className="name">{heroAuthorName}</span>
                  {heroMeta && <span className="meta">{heroMeta}</span>}
                </span>
              </div>
              <span className="m-hero-cta">Start cooking <ChevRight /></span>
            </div>
          </article>
        )}

        {/* ── Collections — the meal categories, with what's in them ── */}
        {collections.length > 0 && !browsing && (
          <section className="m-sec">
            <div className="m-sec-head">
              <h2 className="m-sec-title">Collections</h2>
              <button type="button" className="m-sec-link" onClick={() => setFilterSheetOpen(true)}>
                See all
              </button>
            </div>
            <div className="m-rail no-scrollbar">
              {collections.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className="m-coll"
                  onClick={() => setMeal(c.key)}
                >
                  <span
                    className="m-coll-img"
                    style={{ background: `linear-gradient(135deg, hsl(${c.hue} 46% 46%), hsl(${(c.hue + 24) % 360} 46% 34%))` }}
                  >
                    {c.cover
                      ? <img src={c.cover} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                      : <c.icon />}
                    <span className="m-coll-text">
                      <span className="m-coll-name">{c.label}</span>
                      <span className="m-coll-count">{c.count} {c.count === 1 ? 'recipe' : 'recipes'}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── Browse all ──────────────────────────────────────────── */}
        <section className="m-sec m-browse">
          <div className="m-sec-head">
            <h2 className="m-sec-title">Browse all</h2>
            <div className="m-sec-right">
              <span className="m-count">{filtered.length} {filtered.length === 1 ? 'recipe' : 'recipes'}</span>
              <div className="m-view">
                <button
                  type="button"
                  className={cn(view === 'grid' && 'on')}
                  onClick={() => setView('grid')}
                  aria-label="Grid view"
                  aria-pressed={view === 'grid'}
                >
                  <LayoutGrid />
                </button>
                <button
                  type="button"
                  className={cn(view === 'list' && 'on')}
                  onClick={() => setView('list')}
                  aria-label="List view"
                  aria-pressed={view === 'list'}
                >
                  <List />
                </button>
              </div>
            </div>
          </div>

          <div className="m-seg" role="tablist" aria-label="Recipe source">
            {(['all', 'friend', 'chef', 'home'] as SourceFilter[]).map((sk) => (
              <button
                key={sk}
                type="button"
                role="tab"
                aria-selected={source === sk}
                className={cn('m-seg-item', source === sk && 'on')}
                onClick={() => setSource(sk)}
              >
                {SEGMENT_LABELS[sk]}
              </button>
            ))}
          </div>

          {filtersActive && (
            <div className="m-active">
              <span className="m-active-text">
                {savedOnly ? 'Saved recipes' : 'Filtered'}
              </span>
              <button type="button" className="m-active-clear" onClick={() => { clearFilters(); setSortBy('recent'); }}>
                Clear all
              </button>
            </div>
          )}

          {loading ? (
            <div className={cn('m-er-grid', view === 'list' && 'list')}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ height: view === 'list' ? 130 : 210 }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="m-empty">
              <p className="m-empty-lead">
                {savedOnly ? 'Nothing saved yet' : 'No recipes match those filters'}
              </p>
              <p className="m-empty-sub">
                {savedOnly
                  ? 'Tap the bookmark on any recipe and it lands here.'
                  : 'Try clearing a filter or two.'}
              </p>
              {filtersActive && (
                <button type="button" className="m-empty-btn" onClick={() => { clearFilters(); setSortBy('recent'); }}>
                  Clear all filters
                </button>
              )}
            </div>
          ) : (
            <>
              <div className={cn('m-er-grid', view === 'list' && 'list')}>
                {visible.map((r) => (
                  <MobileExploreCard
                    key={r.id}
                    r={r}
                    source={recipeSource(r)}
                    author={authors[r.userId]}
                    saved={savedIds.has(r.id)}
                    onSave={toggleSave}
                    view={view}
                    onClick={() => goToRecipe(r)}
                  />
                ))}
              </div>
              {filtered.length > visible.length && (
                <button
                  type="button"
                  className="m-more"
                  onClick={() => setShown((n) => n + PAGE_SIZE)}
                >
                  Load more recipes
                </button>
              )}
            </>
          )}
        </section>

        {/* ── Filter sheet — the app's shared bottom sheet (same chrome as
            Discover / the public profile) hosting meal, tags and sort. ── */}
        <FilterSheet
          open={filterSheetOpen}
          onClose={() => setFilterSheetOpen(false)}
          title="Filters"
          subtitle={`${filtered.length} ${filtered.length === 1 ? 'recipe' : 'recipes'}`}
          onReset={() => { setMeal(null); setTag(null); setSortBy('recent'); }}
        >
          <FilterSection label="Meal">
            <PillRow>
              <Pill active={!meal} onClick={() => setMeal(null)}>Any</Pill>
              {MEAL_CATEGORIES.map((c) => (
                <Pill key={c.key} active={meal === c.key} onClick={() => setMeal(meal === c.key ? null : c.key)}>
                  {c.label}
                </Pill>
              ))}
            </PillRow>
          </FilterSection>

          {allTags.length > 0 && (
            <FilterSection label="Popular tags">
              <PillRow>
                <Pill sm active={!tag} onClick={() => setTag(null)}>Any</Pill>
                {allTags.map((t) => (
                  <Pill sm key={t} active={tag === t} onClick={() => setTag(tag === t ? null : t)}>
                    {prettyTag(t)}
                  </Pill>
                ))}
              </PillRow>
            </FilterSection>
          )}

          <FilterSection label="Sort by">
            <Segment>
              {(['recent', 'quick', 'az'] as SortKey[]).map((k) => (
                <SegmentItem key={k} active={sortBy === k} onClick={() => setSortBy(k)}>
                  {SORT_LABELS[k]}
                </SegmentItem>
              ))}
            </Segment>
          </FilterSection>
        </FilterSheet>
      </div>
    );
  }

  return (
    <div className="recipes-page-root rbx">
      {/* ── Masthead: editorial title + Recipe of the Day ───────────── */}
      <section className="rbx-masthead">
        <div className="rbx-mast-grid">
          <div className="rbx-mast-left">
            <div className="r-breadcrumb">
              <Link to="/" aria-label="Back to Discover"><ArrowLeft /></Link>
              <Link to="/">Discover</Link>
              <span className="sep">/</span>
              <span className="here">Recipes</span>
            </div>
            <h1 className="rbx-title">The Recipe <span className="italic">Box</span></h1>
            <p className="rbx-sub">Everything friends have cooked, what chefs are sharing, and the dishes home cooks across the network are saving this week.</p>
          </div>
          {recipeOfDay && (
            <RecipeOfTheDay recipe={recipeOfDay} author={authors[recipeOfDay.userId]} saved={savedIds.has(recipeOfDay.id)} onSave={toggleSave} onOpen={() => goToRecipe(recipeOfDay)} />
          )}
        </div>
      </section>

      {/* ── Search + Browse ─────────────────────────────────────────── */}
      <section className="rbx-browse">
        <div className="rbx-browse-inner">
          {/* prominent search */}
          <div className="rbx-search">
            <h2 className="rbx-search-title">What do you want to <span className="italic">cook?</span></h2>
            <p className="rbx-search-sub">Search the full library — from friends, chefs, and home cooks.</p>
            <div className="rbx-search-box">
              <Search className="ic" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Try “butter chicken”, “Korean”, or “30-minute dinner”"
              />
              {searchQuery && (
                <button type="button" className="rbx-search-clear" onClick={() => setSearchQuery('')} aria-label="Clear search"><X /></button>
              )}
            </div>
            {popularSearches.length > 0 && (
              <div className="rbx-popular">
                <span className="lbl">Popular:</span>
                {popularSearches.map((p) => (
                  <button key={p} type="button" className="rbx-pop" onClick={() => setSearchQuery(p)}>{prettyTag(p)}</button>
                ))}
              </div>
            )}
          </div>

          {/* two-column browse: filter sidebar + results */}
          <div className="rbx-cols">
            <aside className="rbx-filters">
              <div className="rbx-filters-head">
                <span>Filters</span>
                {anyDesktopFilter && <button type="button" className="rbx-clear" onClick={clearDesktop}>Clear all</button>}
              </div>
              {facetGroups.map((g) => (
                <div key={g.id} className="rbx-facet">
                  <div className="rbx-facet-title">{g.title}</div>
                  <div className="rbx-facet-opts">
                    {g.options.map((o) => (
                      <button key={o.key} type="button" className={cn('rbx-opt', o.active && 'active')} onClick={() => toggleFacet(g.id, o.key)}>
                        <span className="rbx-check">{o.active && <Check />}</span>
                        <span className="rbx-opt-label">{o.label}</span>
                        <span className="rbx-opt-count">{o.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </aside>

            <div className="rbx-results">
              <div className="rbx-results-head">
                <div className="rbx-count"><span className="n">{desktopFiltered.length}</span> recipes</div>
                <div className="rbx-tools">
                  <div ref={sortMenuRef} className="rbx-sort-wrap">
                    <button type="button" className="rbx-sort" onClick={() => setSortMenuOpen((v) => !v)}>
                      <ArrowUpDown /><span>{SORT_LABELS[sortBy]}</span><ChevronDown className={cn('chev', sortMenuOpen && 'open')} />
                    </button>
                    {sortMenuOpen && (
                      <div className="rbx-sort-menu">
                        {(['recent', 'quick', 'az'] as SortKey[]).map((k) => (
                          <button key={k} type="button" className={cn('opt', sortBy === k && 'active')} onClick={() => { setSortBy(k); setSortMenuOpen(false); }}>
                            {SORT_LABELS[k]}{sortBy === k && <Check />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="rbx-view">
                    <button type="button" className={cn(view === 'grid' && 'on')} onClick={() => setView('grid')} aria-label="Grid view"><LayoutGrid /></button>
                    <button type="button" className={cn(view === 'list' && 'on')} onClick={() => setView('list')} aria-label="List view"><List /></button>
                  </div>
                </div>
              </div>

              {anyDesktopFilter && (
                <div className="rbx-pills">
                  {searchQuery.trim() && (
                    <button type="button" className="rbx-pill" onClick={() => setSearchQuery('')}>“{searchQuery.trim()}” <X /></button>
                  )}
                  {desktopPills.map((p) => (
                    <button key={p.fid + p.key} type="button" className="rbx-pill" onClick={() => toggleFacet(p.fid, p.key)}>{p.label} <X /></button>
                  ))}
                </div>
              )}

              {loading ? (
                <div className={cn('rbx-grid', view === 'list' && 'list')}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="rbx-skel" style={{ height: view === 'list' ? 150 : 280 }} />
                  ))}
                </div>
              ) : desktopFiltered.length === 0 ? (
                <div className="rbx-empty">
                  <div className="rbx-empty-title">No recipes match your filters</div>
                  <p>Try removing a filter or searching for something else.</p>
                  <button type="button" className="rbx-empty-btn" onClick={clearDesktop}>Clear all filters</button>
                </div>
              ) : (
                <div className={cn('rbx-grid', view === 'list' && 'list')}>
                  {desktopFiltered.map((r) => (
                    <BrowseCard
                      key={r.id}
                      r={r}
                      source={recipeSource(r)}
                      author={authors[r.userId]}
                      saved={savedIds.has(r.id)}
                      onSave={toggleSave}
                      onClick={() => goToRecipe(r)}
                      view={view}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────
   Sub-components — kept in this file so the page reads top-to-bottom.
   Each one renders a single visual block from the editorial mock-up.
   ──────────────────────────────────────────────────────────────────── */

interface SectionHeadProps {
  title: string;
  accentWord?: string;
  sub?: string;
  count?: number;
  link?: string;
  onScroll?: (dir: 1 | -1) => void;
  onLinkClick?: () => void;
}

const SectionHead: React.FC<SectionHeadProps> = ({ title, accentWord, sub, count, link, onScroll, onLinkClick }) => (
  <div className="r-section-head">
    <div>
      <h2 className="r-section-title">
        {title}
        {accentWord && <span className="accent">{accentWord}</span>}
        {count != null && <span className="count">{count}</span>}
      </h2>
      {sub && <div className="r-section-sub">{sub}</div>}
    </div>
    <div className="section-actions">
      {onScroll && (
        <div className="scroll-btns">
          <button type="button" className="scroll-btn" onClick={() => onScroll(-1)} aria-label="Scroll left">
            <ChevronLeft />
          </button>
          <button type="button" className="scroll-btn" onClick={() => onScroll(1)} aria-label="Scroll right">
            <ChevronRight />
          </button>
        </div>
      )}
      {link && (
        <button type="button" className="section-link" onClick={onLinkClick}>
          {link} <ChevronRight />
        </button>
      )}
    </div>
  </div>
);

/** Editorial recipe card for the redesigned desktop browse grid: cover with a
 *  source pill + save heart, then cuisine eyebrow, serif title, "By {chef}",
 *  and a time · difficulty meta line. Supports a horizontal list variant. */
const BrowseCard: React.FC<{
  r: Recipe;
  source: SourceFilter;
  author?: UserProfile;
  saved: boolean;
  onSave: (id: string) => void;
  onClick: () => void;
  view: ViewMode;
}> = ({ r, source, author, saved, onSave, onClick, view }) => {
  const cover = r.photos?.[0] || '';
  const time = formatTime((r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0));
  const authorName = author?.display_name || author?.username || 'Anonymous';
  const authorHue = avatarHue(r.userId || authorName);
  return (
    <article
      className={cn('rbx-card', view === 'list' && 'list')}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      <div className="rbx-card-img">
        <div className="rbx-card-bg" style={{ background: `linear-gradient(135deg, hsl(${authorHue} 50% 52%), hsl(${(authorHue + 25) % 360} 50% 42%))` }} />
        {cover ? (
          <img src={cover} alt={r.title} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        ) : (
          <div className="ph-fallback"><ChefHat /></div>
        )}
        <span className="rbx-card-src">{sourceLabelOf(source)}</span>
        <button
          type="button"
          className={cn('rbx-card-save', saved && 'on')}
          onClick={(e) => { e.stopPropagation(); onSave(r.id); }}
          aria-label={saved ? 'Saved' : 'Save'}
        >
          <Bookmark fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="rbx-card-body">
        <div className="rbx-card-cuisine">{r.cuisine || 'Recipe'}</div>
        <h3 className="rbx-card-name">{r.title}</h3>
        <div className="rbx-card-by">By {authorName}</div>
        <div className="rbx-card-meta">
          {time && <span className="item"><Clock /> {time}</span>}
          {time && r.difficulty ? <span className="dot" /> : null}
          {r.difficulty && <span>{DIFFICULTY_LABEL[r.difficulty]}</span>}
        </div>
      </div>
    </article>
  );
};

const RecipeOfTheDay: React.FC<{
  recipe: Recipe;
  author?: UserProfile;
  saved: boolean;
  onSave: (id: string) => void;
  onOpen: () => void;
}> = ({ recipe, author, saved, onSave, onOpen }) => {
  const cover = recipe.photos?.[0] || '';
  const totalTime = (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);
  const time = formatTime(totalTime);
  const authorName = author?.display_name || author?.username || 'Anonymous';
  const authorHue = avatarHue(recipe.userId || 'x');

  return (
    <article className="rod">
      <div className="rod-image">
        <div
          className="img-bg"
          style={{ background: `linear-gradient(135deg, hsl(${authorHue} 50% 52%), hsl(${(authorHue + 25) % 360} 50% 42%))` }}
        />
        {cover ? (
          <img className="rod-photo" src={cover} alt={recipe.title} decoding="async" referrerPolicy="no-referrer" />
        ) : (
          <div className="ph-fallback"><ChefHat /></div>
        )}
        <div className="rod-stamp">
          <Sparkles /> Recipe of the Day
        </div>
      </div>
      <div className="rod-body">
        <div>
          <h2 className="rod-name">{recipe.title}</h2>
          <div className="rod-meta">
            {time && <span><Clock /> {time}</span>}
            {time && recipe.difficulty ? <span className="sep" /> : null}
            {recipe.difficulty && <span>{DIFFICULTY_LABEL[recipe.difficulty]}</span>}
          </div>
        </div>

        <div>
          <div className="rod-foot">
            <div className="rod-author">
              <div className="rod-author-av" style={{ background: `hsl(${authorHue} 45% 38%)` }}>
                {(authorName[0] || '?').toUpperCase()}
              </div>
              <span className="rod-author-name">{authorName}</span>
            </div>
            <div className="rod-foot-actions">
              <button
                type="button"
                className={cn('rod-cta-icon', saved && 'saved')}
                onClick={() => onSave(recipe.id)}
                title={saved ? 'Saved' : 'Save'}
                aria-label={saved ? 'Saved' : 'Save'}
              >
                <Bookmark fill={saved ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                className="rod-cta-icon"
                title="Share"
                aria-label="Share"
                onClick={() => {
                  const url = `${window.location.origin}/recipe/${recipe.userId}/${recipe.id}`;
                  void shareExternally({ title: recipe.title, url });
                }}
              >
                <ShareIcon />
              </button>
            </div>
          </div>
          <button type="button" className="btn btn-primary rod-start" onClick={onOpen}>
            Start cooking <ChevronRight />
          </button>
        </div>
      </div>
    </article>
  );
};

/* ── Mobile sub-components ─────────────────────────────────────────── */

const MobileExploreCard: React.FC<{
  r: Recipe;
  source: SourceFilter;
  saved: boolean;
  onSave: (id: string) => void;
  onClick: () => void;
  view?: ViewMode;
  author?: UserProfile;
}> = ({ r, source, saved, onSave, onClick, view = 'grid', author }) => {
  const cover = r.photos?.[0] || '';
  const totalTime = (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0);
  const time = formatTime(totalTime);
  const hue = avatarHue(r.userId || r.id);

  const ImageBlock = (
    <div className="m-er-img" style={{ background: `linear-gradient(135deg, hsl(${hue} 50% 52%), hsl(${(hue + 25) % 360} 50% 42%))` }}>
      {cover ? (
        <img src={cover} alt={r.title} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      ) : (
        <div className="ph-fallback"><ChefHat /></div>
      )}
      <span className={cn('m-er-source', source)}>
        <SourceIcon source={source} /> {author?.display_name || author?.username || sourceLabelOf(source)}
      </span>
      <button
        type="button"
        className={cn('m-er-save', saved && 'saved')}
        onClick={(e) => { e.stopPropagation(); onSave(r.id); }}
        aria-label={saved ? 'Saved' : 'Save'}
      >
        <Bookmark fill={saved ? 'currentColor' : 'none'} />
      </button>
    </div>
  );

  const meta = (
    <div className="m-er-meta">
      {time && <span className="t"><Clock /> {time}</span>}
      {time && r.cuisine ? <span className="bar" /> : null}
      {r.cuisine && <span className="c">{r.cuisine}</span>}
      {!time && !r.cuisine && r.difficulty && <span className="c">{DIFFICULTY_LABEL[r.difficulty]}</span>}
    </div>
  );

  if (view === 'list') {
    return (
      <article
        className="m-er-card"
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      >
        {ImageBlock}
        <div className="m-er-body">
          <h3 className="m-er-name">{r.title}</h3>
          {r.description && <p className="m-er-desc">{r.description}</p>}
          {meta}
        </div>
      </article>
    );
  }

  return (
    <article
      className="m-er-card"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      {ImageBlock}
      <div className="m-er-body">
        <h3 className="m-er-name">{r.title}</h3>
        {meta}
      </div>
    </article>
  );
};
