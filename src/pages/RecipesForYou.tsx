/**
 * Recipes Explore page — "The Recipe Box".
 *
 * Reached from Discover's "see all" on the Recipes rail (route /recipes-for-you).
 * Editorial layout with: page header + Recipe of the Day hero, browse-by-meal
 * categories, trending rail, friend activity strip, editor's collections,
 * friends' recent recipes, chef spotlight, and the full filterable Explore
 * grid (source tabs, sort, view toggle, tag chips).
 *
 * All styling lives in RecipesForYou.css under .recipes-page-root so the
 * editorial tokens don't leak into other routes.
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowUpDown, BookOpen, Bookmark, Cake, Check, ChefHat,
  ChevronDown, ChevronLeft, ChevronRight, ChevronRight as ChevRight, Clock, Crown, Heart,
  LayoutGrid, List, Plus, Search, Share2, Soup, Sparkles, Star, Sun, Tag,
  TrendingUp, UtensilsCrossed, Users, Wheat, Wine, X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { getPublicRecipes, type Recipe } from '../lib/supabase-recipes';
import { getProfilesByIds, getFriends, getFriendsPublicHomeMeals, type UserProfile, type FriendHomeMeal } from '../lib/supabase-community';
import { cn } from '../lib/utils';
import './RecipesForYou.css';

type SourceFilter = 'all' | 'friend' | 'chef' | 'home';
type SortKey = 'recent' | 'popular' | 'quick' | 'az';
type MealKey = 'breakfast' | 'lunch' | 'dinner' | 'dessert' | 'baking' | 'drinks';
type ViewMode = 'grid' | 'list';

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Most Recent',
  popular: 'Most Saved',
  quick: 'Quickest first',
  az: 'A–Z',
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

// Hand-curated collections — same shape as the mock-up. Keeps the section
// alive while a real collections backend doesn't exist yet.
const COLLECTIONS = [
  {
    id: 'c1',
    title: '30-Minute Weeknights',
    sub: '25 fast dinners that don\'t skimp',
    count: 25,
    by: 'Editors',
    img: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=900&auto=format&fit=crop',
    filter: { source: 'all' as SourceFilter, quick: true },
  },
  {
    id: 'c2',
    title: 'Weekend Baking Projects',
    sub: 'Slow loaves, laminated dough, big ambitions',
    count: 12,
    by: 'Editors',
    img: 'https://images.unsplash.com/photo-1568051243851-f9b136146e97?w=900&auto=format&fit=crop',
    filter: { source: 'all' as SourceFilter, meal: 'baking' as MealKey },
  },
  {
    id: 'c3',
    title: 'Comfort From Around the World',
    sub: 'Soul-warming dishes for cold nights',
    count: 18,
    by: 'Editors',
    img: 'https://images.unsplash.com/photo-1547592180-85f173990554?w=900&auto=format&fit=crop',
    filter: { source: 'all' as SourceFilter, tag: 'comfort' },
  },
  {
    id: 'c4',
    title: 'Vegetarian Showstoppers',
    sub: 'Mains that don\'t miss meat',
    count: 14,
    by: 'Editors',
    img: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=900&auto=format&fit=crop',
    filter: { source: 'all' as SourceFilter, tag: 'vegetarian' },
  },
];

const STORAGE_KEY_SAVED = 'gourmad-saved-recipes';

// Hash a string to a stable hue 0–360. Used for author avatars when we
// don't have an explicit color.
const hashToHue = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};

// Stable seed-based number from a string. Used for pseudo-real counts
// (followers, trending up arrows) so the same recipe always shows the
// same number rather than reshuffling each render.
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

// Format a (prep + cook) minute total for the recipe-of-day / trend rows.
const formatTime = (mins: number): string => {
  if (!Number.isFinite(mins) || mins <= 0) return '';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

const sourceOf = (r: Recipe, friendIds: Set<string>, author?: UserProfile): SourceFilter => {
  if (author?.is_expert || r.sourceType === 'expert') return 'chef';
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

const sourceLabelOf = (s: SourceFilter): string =>
  s === 'chef' ? 'Chef' : s === 'friend' ? 'Friend' : 'Home Cook';

const SourceIcon: React.FC<{ source: SourceFilter; className?: string }> = ({ source, className }) =>
  source === 'chef'
    ? <Crown className={className} />
    : source === 'friend'
      ? <Users className={className} />
      : <ChefHat className={className} />;

export const RecipesForYou: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { homeMeals } = useLists();
  const { phoneMode } = useSettings();

  // ── Data ──
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [authors, setAuthors] = useState<Record<string, UserProfile>>({});
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Saved set — local, persisted to localStorage so toggles survive a refresh.
  const [savedIds, setSavedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SAVED);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch { return new Set(); }
  });

  // Filter / sort / view state.
  const [source, setSource] = useState<SourceFilter>('all');
  const [meal, setMeal] = useState<MealKey | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const [view, setView] = useState<ViewMode>('grid');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  // Search — discreet field tucked into the explore-bar so the legacy
  // search behavior still works without the old sticky header.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

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

  // ── Save toggle (localStorage-backed) ──
  const toggleSave = useCallback((id: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(STORAGE_KEY_SAVED, JSON.stringify(Array.from(next))); } catch { /* ignore quota */ }
      return next;
    });
  }, []);

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
      if (!p?.is_expert) return;
      const cur = byChef.get(p.user_id);
      if (cur) cur.recipeCount++;
      else byChef.set(p.user_id, { profile: p, recipeCount: 1 });
    });
    return Array.from(byChef.values())
      .sort((a, b) => b.recipeCount - a.recipeCount)
      .slice(0, 3);
  }, [displayRecipes, authors]);

  // ── Filter + sort the explore grid ──
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let pool = displayRecipes.filter((r) => {
      if (!r.title) return false;
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
    } else if (sortBy === 'popular') {
      // No real popularity metric yet — fall back to a stable per-recipe
      // pseudo-saves score so the order is deterministic.
      pool.sort((a, b) => stableHash(b.id) - stableHash(a.id));
    } else {
      pool.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    return pool;
  }, [recipes, authors, source, meal, tag, searchQuery, sortBy, recipeSource]);

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
  };

  const filtersActive = source !== 'all' || meal !== null || tag !== null || searchQuery.trim().length > 0;

  const goToRecipe = useCallback((r: Recipe) => {
    if (r.userId) navigate(`/recipe/${r.userId}/${r.id}`);
    else navigate(`/recipe/${r.id}`);
  }, [navigate]);

  // ── Mobile layout (rendered when phoneMode is true) ─────────────
  //    Different markup using .m-* classes so the page looks like a
  //    proper phone screen instead of the desktop layout squashed down.
  if (phoneMode) {
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
    const recipeOfDayCover = recipeOfDay?.photos?.[0] || '';
    const rodAuthor = recipeOfDay ? authors[recipeOfDay.userId] : undefined;
    const rodAuthorName = rodAuthor?.display_name || rodAuthor?.username || 'Anonymous';
    const rodAuthorHue = recipeOfDay ? hashToHue(recipeOfDay.userId || 'x') : 0;
    const rodAuthorRole = rodAuthor?.is_expert
      ? `Chef${rodAuthor.home_city ? ` · ${rodAuthor.home_city}` : ''}`
      : rodAuthor?.bio || 'Home cook';
    const rodTotal = recipeOfDay ? ((recipeOfDay.prepTimeMinutes ?? 0) + (recipeOfDay.cookTimeMinutes ?? 0)) : 0;
    const rodTime = formatTime(rodTotal);

    return (
      <div className="recipes-page-root">
        {/* ── Sticky header ───────────────────────────────── */}
        <header className="m-header">
          <div className="m-header-row">
            <button type="button" className="m-back-btn" onClick={() => navigate(-1)} aria-label="Back">
              <ArrowLeft />
            </button>
            <div className="m-loc">
              <div className="m-loc-line">Discover · Recipes</div>
              <div className="m-loc-name">The Recipe Box</div>
            </div>
            <button type="button" className="m-icon-btn" title="Saved" aria-label="Saved" onClick={() => navigate('/activity/saved')}>
              <Bookmark />
            </button>
            <button type="button" className="m-icon-btn" title="Add Recipe" aria-label="Add Recipe" onClick={() => navigate('/create')}>
              <Plus />
            </button>
          </div>
          <div className="m-search">
            <Search />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search recipes, ingredients, cuisines…"
            />
            {searchQuery && (
              <button type="button" className="clr" onClick={() => setSearchQuery('')} aria-label="Clear">
                <X />
              </button>
            )}
          </div>
        </header>

        {/* ── Intro + stats ───────────────────────────────── */}
        <section className="m-r-intro">
          <div className="m-r-eyebrow">Today · {today}</div>
          <h1 className="m-r-title">Cook something <span className="accent">new</span></h1>
          <p className="m-r-sub">What friends made this week, chefs you follow, and editor picks.</p>
          <div className="m-r-stats">
            <div className="m-r-stat">
              <div className="n">{loading ? '—' : recipesCount}</div>
              <div className="l">Recipes</div>
            </div>
            <div className="m-r-stat">
              <div className="n">{savedCount}</div>
              <div className="l">Saved</div>
            </div>
            <div className="m-r-stat">
              <div className="n">{cookedCount}</div>
              <div className="l">Cooked</div>
            </div>
          </div>
        </section>

        {/* ── Recipe of the Day (stacked) ─────────────────── */}
        {recipeOfDay && (
          <article className="m-rod">
            <div
              className="m-rod-img"
              style={{ background: `linear-gradient(135deg, hsl(${rodAuthorHue} 50% 52%), hsl(${(rodAuthorHue + 25) % 360} 50% 42%))` }}
            >
              {recipeOfDayCover ? (
                <img className="m-rod-photo" src={recipeOfDayCover} alt={recipeOfDay.title} referrerPolicy="no-referrer" />
              ) : (
                <div className="ph-fallback"><ChefHat /></div>
              )}
              <div className="badge"><Sparkles /> Recipe of the Day</div>
              <button
                type="button"
                className={cn('save', savedIds.has(recipeOfDay.id) && 'saved')}
                onClick={() => toggleSave(recipeOfDay.id)}
                aria-label={savedIds.has(recipeOfDay.id) ? 'Saved' : 'Save'}
              >
                <Heart fill={savedIds.has(recipeOfDay.id) ? 'currentColor' : 'none'} />
              </button>
            </div>
            <div className="m-rod-body">
              <div className="m-rod-eyebrow">
                <span className="pulse" />
                Editor's pick
              </div>
              <h2 className="m-rod-name">{recipeOfDay.title}</h2>
              {recipeOfDay.description && <p className="m-rod-byline">{recipeOfDay.description}</p>}
              <div className="m-rod-meta">
                {rodTime && <span><Clock /> {rodTime}</span>}
                {rodTime && recipeOfDay.servings ? <span className="dot-sep" /> : null}
                {recipeOfDay.servings ? <span>{recipeOfDay.servings} servings</span> : null}
                {recipeOfDay.difficulty && (recipeOfDay.servings || rodTime) ? <span className="dot-sep" /> : null}
                {recipeOfDay.difficulty && <span>{DIFFICULTY_LABEL[recipeOfDay.difficulty]}</span>}
              </div>
              <div className="m-rod-author">
                <div className="av" style={{ background: `hsl(${rodAuthorHue} 45% 38%)` }}>
                  {(rodAuthorName[0] || '?').toUpperCase()}
                </div>
                <div className="m-rod-author-info">
                  <span className="name">{rodAuthorName}</span>
                  <span className="role">{rodAuthorRole}</span>
                </div>
              </div>
              <div className="m-rod-cta">
                <button type="button" className="m-btn m-btn-primary" onClick={() => goToRecipe(recipeOfDay)}>
                  Start cooking <ChevRight />
                </button>
                <button
                  type="button"
                  className="m-btn m-btn-ghost"
                  aria-label="Share"
                  onClick={() => {
                    const url = `${window.location.origin}/recipe/${recipeOfDay.userId}/${recipeOfDay.id}`;
                    if (navigator.share) navigator.share({ title: recipeOfDay.title, url }).catch(() => { /* user cancel */ });
                    else navigator.clipboard?.writeText(url).catch(() => { /* ignore */ });
                  }}
                >
                  <Share2 />
                </button>
              </div>
            </div>
          </article>
        )}

        {/* ── Browse by meal (3×2 grid) ───────────────────── */}
        <section className="m-section">
          <div className="m-section-head">
            <div>
              <h2 className="m-section-title">Browse by meal</h2>
              <div className="m-section-sub">Quick filters</div>
            </div>
          </div>
          <div className="m-cat-grid">
            {MEAL_CATEGORIES.map((c) => {
              const Ico = c.icon;
              return (
                <button
                  key={c.key}
                  type="button"
                  className={cn('m-cat', meal === c.key && 'active')}
                  onClick={() => setMeal(meal === c.key ? null : c.key)}
                >
                  <div className="m-cat-icon" style={{ background: `hsl(${c.hue} 50% 48%)` }}>
                    <Ico />
                  </div>
                  <div className="m-cat-text">
                    <div className="m-cat-label">{c.label}</div>
                    <div className="m-cat-count">{mealCounts[c.key] || 0}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Trending (h-scroll w/ hero+rank cards) ───────── */}
        {trending.length > 0 && (
          <section className="m-section">
            <div className="m-section-head">
              <div>
                <h2 className="m-section-title">Trending</h2>
                <div className="m-section-sub">What people are saving right now</div>
              </div>
              <button
                type="button"
                className="m-section-link"
                onClick={() => { setSortBy('popular'); setSource('all'); setTag(null); setMeal(null); }}
              >
                All <ChevRight />
              </button>
            </div>
            <div className="m-hscroll">
              {trending.map((r, i) => (
                <MobileTrendCard key={r.id} r={r} rank={i + 1} onClick={() => goToRecipe(r)} />
              ))}
            </div>
          </section>
        )}

        {/* ── Friend activity strip (compact) ─────────────── */}
        {activeFriends.length >= 2 && (
          <button
            type="button"
            className="m-activity-strip"
            onClick={() => { setSource('friend'); setMeal(null); setTag(null); }}
          >
            <div className="strip-avs">
              {activeFriends.map((f) => (
                <span
                  key={f.userId}
                  className="av"
                  style={{ background: `hsl(${hashToHue(f.userId)} 45% 42%)` }}
                >
                  {(f.name[0] || 'F').toUpperCase()}
                </span>
              ))}
            </div>
            <div className="strip-msg">
              {activeFriends.slice(0, -1).map((f, i, arr) => (
                <React.Fragment key={f.userId}>
                  <span className="b">{f.name}</span>{i < arr.length - 1 ? ', ' : ''}
                </React.Fragment>
              ))}
              {activeFriends.length > 1 && ' & '}
              <span className="b">{activeFriends[activeFriends.length - 1].name}</span>
              {' cooked '}
              <span className="b">{friendRecipes.length} recipe{friendRecipes.length === 1 ? '' : 's'}</span>
              {' this week'}
            </div>
            <span className="strip-arrow">›</span>
          </button>
        )}

        {/* ── Collections (h-scroll small) ────────────────── */}
        <section className="m-section">
          <div className="m-section-head">
            <div>
              <h2 className="m-section-title">Collections</h2>
              <div className="m-section-sub">Editor's picks for the week</div>
            </div>
            <button type="button" className="m-section-link">See all <ChevRight /></button>
          </div>
          <div className="m-hscroll">
            {COLLECTIONS.map((c) => (
              <button
                key={c.id}
                type="button"
                className="m-collection"
                onClick={() => {
                  if (c.filter.source) setSource(c.filter.source);
                  if (c.filter.meal) setMeal(c.filter.meal);
                  if (c.filter.tag) setTag(c.filter.tag);
                  document.querySelector('.recipes-page-root .m-explore')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                <div className="m-collection-bg">
                  <img className="m-collection-photo" src={c.img} alt={c.title} loading="lazy" />
                  <div className="m-collection-overlay" />
                </div>
                <span className="m-collection-tag">Collection</span>
                <div className="m-collection-body">
                  <div className="m-collection-count">{c.count} recipes · {c.by}</div>
                  <h3 className="m-collection-title">{c.title}</h3>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* ── From your friends (uses trending card style) ── */}
        {friendRecipes.length > 0 && (
          <section className="m-section">
            <div className="m-section-head">
              <div>
                <h2 className="m-section-title">From your friends <span className="count">{friendRecipes.length}</span></h2>
                <div className="m-section-sub">{activeFriends.map((f) => f.name).join(' & ') || 'Friends'} cooked recently</div>
              </div>
              <button
                type="button"
                className="m-section-link"
                onClick={() => { setSource('friend'); setMeal(null); setTag(null); document.querySelector('.recipes-page-root .m-explore')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
              >
                See all <ChevRight />
              </button>
            </div>
            <div className="m-hscroll">
              {friendRecipes.map((r) => (
                <MobileTrendCard key={r.id} r={r} rank="" onClick={() => goToRecipe(r)} />
              ))}
            </div>
          </section>
        )}

        {/* ── Chef spotlight (h-scroll w/ Follow button) ──── */}
        {chefSpotlight.length > 0 && (
          <section className="m-section">
            <div className="m-section-head">
              <div>
                <h2 className="m-section-title">Chef spotlight</h2>
                <div className="m-section-sub">Recipes from chefs you follow</div>
              </div>
              <button type="button" className="m-section-link" onClick={() => navigate('/experts')}>
                Browse <ChevRight />
              </button>
            </div>
            <div className="m-hscroll">
              {chefSpotlight.map((c) => (
                <MobileChefCard
                  key={c.profile.user_id}
                  profile={c.profile}
                  recipeCount={c.recipeCount}
                  onClick={() => navigate(`/user/${c.profile.username}`)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Explore (2-col grid / list) ─────────────────── */}
        <section className="m-section m-explore" style={{ marginBottom: 12 }}>
          <div className="m-explore-section-head">
            <div>
              <h2 className="m-explore-title">Explore <span className="accent">recipes</span></h2>
              <div className="m-explore-sub">The full library, filterable</div>
            </div>
            <div className="m-er-view">
              <button
                type="button"
                className={cn(view === 'grid' && 'on')}
                onClick={() => setView('grid')}
                aria-label="Grid view"
                title="Grid"
              >
                <LayoutGrid />
              </button>
              <button
                type="button"
                className={cn(view === 'list' && 'on')}
                onClick={() => setView('list')}
                aria-label="List view"
                title="List"
              >
                <List />
              </button>
            </div>
          </div>

          <div className="m-source-tabs">
            {(['all', 'friend', 'chef', 'home'] as SourceFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                className={cn('m-source-tab', source === s && 'active')}
                onClick={() => setSource(s)}
              >
                {s === 'friend' && <Users />}
                {s === 'chef' && <ChefHat />}
                {s === 'home' && <UtensilsCrossed />}
                <span>{SOURCE_LABELS[s]}</span>
                <span className="badge">{sourceCounts[s]}</span>
              </button>
            ))}
          </div>

          <div className="m-tag-chips">
            <button
              type="button"
              className={cn('m-tag-chip', !tag && 'active')}
              onClick={() => setTag(null)}
            >
              All
            </button>
            {allTags.map((t) => (
              <button
                key={t}
                type="button"
                className={cn('m-tag-chip', tag === t && 'active')}
                onClick={() => setTag(tag === t ? null : t)}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="m-result-count">
            <span><span className="n">{filtered.length}</span> recipes</span>
            {filtersActive && (
              <button type="button" className="m-result-clear" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>

          {loading ? (
            <div className={cn('m-er-grid', view === 'list' && 'list')}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ height: view === 'list' ? 130 : 200 }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="m-empty">No recipes match those filters.</div>
          ) : (
            <div className={cn('m-er-grid', view === 'list' && 'list')}>
              {filtered.map((r) => (
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
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="recipes-page-root">
      {/* ── Hero row: page header + Recipe of the Day ───────────────── */}
      <div className="r-hero-row">
        <header className="r-page-header">
          <div>
            <div className="r-breadcrumb">
              <Link to="/" aria-label="Back to Discover">
                <ArrowLeft />
              </Link>
              <Link to="/">Discover</Link>
              <span className="sep">/</span>
              <span className="here">Recipes</span>
            </div>
            <h1 className="r-page-title">
              The Recipe <span className="italic">Box</span>
            </h1>
            <p className="r-page-sub">
              Everything friends have cooked, what chefs are sharing, and what home cooks across the network are saving this week.
            </p>
          </div>
          <div className="r-header-stats">
            <div className="r-header-stat">
              <div className="n">{loading ? '—' : recipesCount}</div>
              <div className="l">Recipes</div>
            </div>
            <div className="r-header-stat">
              <div className="n">{savedCount}</div>
              <div className="l">Saved</div>
            </div>
            <div className="r-header-stat">
              <div className="n">{cookedCount}</div>
              <div className="l">Cooked</div>
            </div>
          </div>
        </header>

        {recipeOfDay && <RecipeOfTheDay recipe={recipeOfDay} author={authors[recipeOfDay.userId]} saved={savedIds.has(recipeOfDay.id)} onSave={toggleSave} onOpen={() => goToRecipe(recipeOfDay)} />}
      </div>

      {/* ── Browse by meal ──────────────────────────────────────────── */}
      <section className="r-categories">
        <SectionHead
          title="Browse by "
          accentWord="meal"
          sub="Quick filters across the whole library"
        />
        <div className="r-cat-row">
          {MEAL_CATEGORIES.map((c) => {
            const Ico = c.icon;
            return (
              <button
                key={c.key}
                type="button"
                className={cn('r-cat', meal === c.key && 'active')}
                onClick={() => setMeal(meal === c.key ? null : c.key)}
              >
                <div className="cat-icon" style={{ background: `hsl(${c.hue} 50% 48%)` }}>
                  <Ico />
                </div>
                <div className="cat-text">
                  <div className="cat-label">{c.label}</div>
                  <div className="cat-count">{mealCounts[c.key] || 0} recipes</div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Trending this week (tinted band) ────────────────────────── */}
      {trending.length > 0 && (
        <section className="r-scroll-section tinted">
          <SectionHead
            title="Trending "
            accentWord="this week"
            sub="What people are saving and cooking right now"
            link={trending.length > 0 ? 'See full list' : undefined}
            onScroll={(d) => scrollRow(trendRowRef, d)}
            onLinkClick={() => { setSortBy('popular'); setSource('all'); setTag(null); setMeal(null); }}
          />
          <div className="recipe-row" ref={trendRowRef} style={{ gridAutoColumns: '340px' }}>
            {trending.map((r, i) => (
              <TrendCard key={r.id} r={r} rank={i + 1} onClick={() => goToRecipe(r)} />
            ))}
          </div>
        </section>
      )}

      {/* ── Friend activity strip ───────────────────────────────────── */}
      {activeFriends.length >= 2 && (
        <div className="activity-strip">
          <div className="left">
            <div className="strip-avs">
              {activeFriends.map((f) => (
                <span
                  key={f.userId}
                  className="av"
                  style={{ background: `hsl(${hashToHue(f.userId)} 45% 42%)` }}
                >
                  {(f.name[0] || 'F').toUpperCase()}
                </span>
              ))}
            </div>
            <div className="strip-msg">
              {activeFriends.slice(0, -1).map((f, i, arr) => (
                <React.Fragment key={f.userId}>
                  <span className="b">{f.name}</span>{i < arr.length - 1 ? ', ' : ''}
                </React.Fragment>
              ))}
              {activeFriends.length > 1 && ' and '}
              <span className="b">{activeFriends[activeFriends.length - 1].name}</span>
              {' cooked '}
              <span className="b">{friendRecipes.length} recipe{friendRecipes.length === 1 ? '' : 's'}</span>
              {' this week — '}
              <button
                type="button"
                className="lnk"
                onClick={() => { setSource('friend'); setMeal(null); setTag(null); }}
              >
                see what they made →
              </button>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate('/activity')}
          >
            View activity
          </button>
        </div>
      )}

      {/* ── Editor's collections ────────────────────────────────────── */}
      <section className="r-scroll-section">
        <SectionHead
          title="Editor's "
          accentWord="collections"
          sub="Hand-picked recipe sets for the week ahead"
          link="All collections"
          onScroll={(d) => scrollRow(collectionsRowRef, d)}
        />
        <div className="recipe-row" ref={collectionsRowRef} style={{ gridAutoColumns: 'minmax(240px, 1fr)' }}>
          {COLLECTIONS.map((c) => (
            <button
              key={c.id}
              type="button"
              className="collection-card"
              onClick={() => {
                if (c.filter.source) setSource(c.filter.source);
                if (c.filter.meal) setMeal(c.filter.meal);
                if (c.filter.tag) setTag(c.filter.tag);
                document.querySelector('.recipes-page-root .explore')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <div className="cc-bg">
                <img className="cc-photo" src={c.img} alt={c.title} loading="lazy" />
                <div className="cc-overlay" />
              </div>
              <span className="cc-tag">Collection</span>
              <div className="cc-body">
                <div className="cc-count">{c.count} recipes · by {c.by}</div>
                <h3 className="cc-title">{c.title}</h3>
                <p className="cc-sub">{c.sub}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ── From your friends ───────────────────────────────────────── */}
      {friendRecipes.length > 0 && (
        <section className="r-scroll-section">
          <SectionHead
            title="From your "
            accentWord="friends"
            sub={`Recipes ${activeFriends.map((f) => f.name).join(', ') || 'your friends'} cooked recently`}
            count={friendRecipes.length}
            link="See all"
            onScroll={(d) => scrollRow(friendsRowRef, d)}
            onLinkClick={() => { setSource('friend'); setMeal(null); setTag(null); document.querySelector('.recipes-page-root .explore')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
          />
          <div className="recipe-row" ref={friendsRowRef} style={{ gridAutoColumns: '260px' }}>
            {friendRecipes.map((r) => (
              <MiniRecipeCard
                key={r.id}
                r={r}
                source={recipeSource(r)}
                author={authors[r.userId]}
                saved={savedIds.has(r.id)}
                onSave={toggleSave}
                onClick={() => goToRecipe(r)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Chef spotlight ──────────────────────────────────────────── */}
      {chefSpotlight.length > 0 && (
        <section className="r-scroll-section">
          <SectionHead
            title="Chef "
            accentWord="spotlight"
            sub="Recipes from chefs you follow"
            link="Browse chefs"
            onLinkClick={() => navigate('/experts')}
          />
          <div className="chef-row">
            {chefSpotlight.map((c) => (
              <ChefCard
                key={c.profile.user_id}
                profile={c.profile}
                recipeCount={c.recipeCount}
                onClick={() => navigate(`/user/${c.profile.username}`)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Explore (main grid) ─────────────────────────────────────── */}
      <section className="explore">
        <SectionHead
          title="Explore "
          accentWord="recipes"
          sub={
            (meal ? `${MEAL_CATEGORIES.find((m) => m.key === meal)?.label} · ` : '') +
            (tag ? `${tag} · ` : '') +
            'The full library, filterable'
          }
        />

        {/* Source tabs + search + sort + view toggle */}
        <div className="explore-bar">
          <div className="explore-tabs">
            {(['all', 'friend', 'chef', 'home'] as SourceFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                className={cn('exp-tab', source === s && 'active')}
                onClick={() => setSource(s)}
              >
                {s === 'friend' && <Users />}
                {s === 'chef' && <ChefHat />}
                {s === 'home' && <UtensilsCrossed />}
                {SOURCE_LABELS[s]}
                <span className="badge">{sourceCounts[s]}</span>
              </button>
            ))}
          </div>

          <div className="explore-right">
            {searchOpen ? (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                height: 36, padding: '0 8px 0 12px', borderRadius: 999,
                background: 'var(--surface)', border: '1px solid var(--border)',
              }}>
                <Search size={13} style={{ color: 'var(--muted)' }} />
                <input
                  type="text"
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search recipes, chefs..."
                  style={{
                    border: 0, outline: 0, background: 'transparent',
                    font: 'inherit', fontSize: 13, color: 'var(--ink)',
                    width: phoneMode ? 140 : 200,
                  }}
                />
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); setSearchOpen(false); }}
                  aria-label="Close search"
                  style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', color: 'var(--muted)' }}
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="exp-sort"
                onClick={() => setSearchOpen(true)}
                aria-label="Search"
                style={{ width: 36, padding: 0, justifyContent: 'center' }}
              >
                <Search />
              </button>
            )}

            <div ref={sortMenuRef} style={{ position: 'relative' }}>
              <button
                type="button"
                className="exp-sort"
                onClick={() => setSortMenuOpen((v) => !v)}
              >
                <ArrowUpDown />
                <span>{SORT_LABELS[sortBy]}</span>
                <ChevronDown className={cn('chev', sortMenuOpen && 'rotate-180')} style={{ transition: 'transform .15s' }} />
              </button>
              {sortMenuOpen && (
                <div className="exp-sort-menu">
                  {(['recent', 'popular', 'quick', 'az'] as SortKey[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={cn('opt', sortBy === k && 'active')}
                      onClick={() => { setSortBy(k); setSortMenuOpen(false); }}
                    >
                      {SORT_LABELS[k]}
                      {sortBy === k && <Check />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="exp-view">
              <button
                type="button"
                className={cn(view === 'grid' && 'on')}
                onClick={() => setView('grid')}
                title="Grid"
                aria-label="Grid view"
              >
                <LayoutGrid />
              </button>
              <button
                type="button"
                className={cn(view === 'list' && 'on')}
                onClick={() => setView('list')}
                title="List"
                aria-label="List view"
              >
                <List />
              </button>
            </div>
          </div>
        </div>

        {/* Tag chips */}
        <div className="explore-tags">
          <button
            type="button"
            className={cn('exp-tag', !tag && 'active')}
            onClick={() => setTag(null)}
          >
            All tags
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              type="button"
              className={cn('exp-tag', tag === t && 'active')}
              onClick={() => setTag(tag === t ? null : t)}
            >
              <Tag /> {t}
            </button>
          ))}
        </div>

        {/* Results count + clear */}
        <div className="explore-results-head">
          <div className="exp-count">
            <span className="n">{filtered.length}</span> recipes
            {filtersActive && (
              <button type="button" className="exp-clear" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className={cn('recipe-grid', view === 'list' && 'list')}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="skeleton"
                style={{ height: view === 'list' ? 160 : 320 }}
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            No recipes match those filters. Try clearing one.
          </div>
        ) : (
          <div className={cn('recipe-grid', view === 'list' && 'list')}>
            {filtered.map((r) => (
              <GridRecipeCard
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
  const authorRole = author?.is_expert ? `Chef${author.home_city ? ` · ${author.home_city}` : ''}` : author?.bio || 'Home cook';
  const authorHue = hashToHue(recipe.userId || 'x');
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <article className="rod">
      <div className="rod-image">
        <div
          className="img-bg"
          style={{ background: `linear-gradient(135deg, hsl(${authorHue} 50% 52%), hsl(${(authorHue + 25) % 360} 50% 42%))` }}
        />
        {cover ? (
          <img className="rod-photo" src={cover} alt={recipe.title} referrerPolicy="no-referrer" />
        ) : (
          <div className="ph-fallback"><ChefHat /></div>
        )}
        <div className="rod-stamp">
          <Sparkles /> Recipe of the Day
        </div>
      </div>
      <div className="rod-body">
        <div>
          <div className="rod-eyebrow">
            <span className="pulse" />
            Editor's pick · {today}
          </div>
          <h2 className="rod-name">{recipe.title}</h2>
          {recipe.description && <p className="rod-byline">{recipe.description}</p>}
          <div className="rod-meta">
            {time && <span><Clock /> {time}</span>}
            {time && recipe.servings ? <span className="sep" /> : null}
            {recipe.servings ? <span>{recipe.servings} servings</span> : null}
            {recipe.difficulty && (recipe.servings || time) ? <span className="sep" /> : null}
            {recipe.difficulty && <span>{DIFFICULTY_LABEL[recipe.difficulty]}</span>}
          </div>
        </div>

        <div>
          {(authorName || author) && (
            <div className="rod-author">
              <div className="rod-author-av" style={{ background: `hsl(${authorHue} 45% 38%)` }}>
                {(authorName[0] || '?').toUpperCase()}
              </div>
              <div className="rod-author-info">
                <span className="rod-author-name">{authorName}</span>
                <span className="rod-author-role">{authorRole}</span>
              </div>
            </div>
          )}
          <div className="rod-cta">
            <button type="button" className="btn btn-primary" onClick={onOpen}>
              Start cooking <ChevronRight />
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onSave(recipe.id)}
              aria-label={saved ? 'Saved' : 'Save'}
            >
              <Heart fill={saved ? 'currentColor' : 'none'} style={{ color: saved ? 'var(--accent)' : undefined }} />
              {saved ? 'Saved' : 'Save'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              title="Share"
              aria-label="Share"
              onClick={() => {
                const url = `${window.location.origin}/recipe/${recipe.userId}/${recipe.id}`;
                if (navigator.share) navigator.share({ title: recipe.title, url }).catch(() => { /* user cancel */ });
                else navigator.clipboard?.writeText(url).catch(() => { /* ignore */ });
              }}
            >
              <Share2 />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
};

const TrendCard: React.FC<{ r: Recipe; rank: number; onClick: () => void }> = ({ r, rank, onClick }) => {
  const totalTime = (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0);
  const time = formatTime(totalTime);
  const trendCount = 80 + (stableHash(r.id) % 200);
  return (
    <button type="button" className="trend-card" onClick={onClick}>
      <div className={cn('trend-rank', rank > 3 && 'dim')}>{rank}</div>
      <div className="trend-info">
        <h4 className="trend-name">{r.title}</h4>
        <div className="trend-meta">
          {r.cuisine && <span>{r.cuisine}</span>}
          {r.cuisine && time ? <span className="sep" /> : null}
          {time && <span>{time}</span>}
          <span className="sep" />
          <span className="up"><TrendingUp /> {trendCount}</span>
        </div>
      </div>
    </button>
  );
};

const MiniRecipeCard: React.FC<{
  r: Recipe;
  source: SourceFilter;
  author?: UserProfile;
  saved: boolean;
  onSave: (id: string) => void;
  onClick: () => void;
}> = ({ r, source, author, saved, onSave, onClick }) => {
  const cover = r.photos?.[0] || '';
  const totalTime = (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0);
  const time = formatTime(totalTime);
  const authorName = author?.display_name || author?.username || 'Anonymous';
  const authorHue = hashToHue(r.userId || authorName);
  return (
    <article className="rg-card" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}>
      <div className="rg-img">
        <div className="bg" style={{ background: `linear-gradient(135deg, hsl(${authorHue} 50% 52%), hsl(${(authorHue + 25) % 360} 50% 42%))` }} />
        {cover ? (
          <img className="rg-photo" src={cover} alt={r.title} loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <div className="ph-fallback"><ChefHat /></div>
        )}
        <span className={cn('rg-source', source)}>
          <SourceIcon source={source} /> {sourceLabelOf(source)}
        </span>
        <button
          type="button"
          className={cn('rg-save', saved && 'saved')}
          onClick={(e) => { e.stopPropagation(); onSave(r.id); }}
          title={saved ? 'Saved' : 'Save'}
          aria-label={saved ? 'Saved' : 'Save'}
        >
          <Heart fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="rg-body">
        <h3 className="rg-name">{r.title}</h3>
        {r.cuisine && <div className="rg-cuisine">{r.cuisine}</div>}
      </div>
      <div className="rg-meta">
        {time && <span className="item"><Clock /> {time}</span>}
        {r.servings ? <span className="item"><UtensilsCrossed /> {r.servings}</span> : null}
        <span className="item" style={{ marginLeft: 'auto' }}>
          <span
            className="rg-author-av"
            style={{ background: `hsl(${authorHue} 45% 40%)`, width: 20, height: 20, fontSize: 10 }}
          >
            {(authorName[0] || '?').toUpperCase()}
          </span>
          {authorName}
        </span>
      </div>
    </article>
  );
};

const GridRecipeCard: React.FC<{
  r: Recipe;
  source: SourceFilter;
  author?: UserProfile;
  saved: boolean;
  onSave: (id: string) => void;
  onClick: () => void;
  view: ViewMode;
}> = ({ r, source, author, saved, onSave, onClick, view }) => {
  const cover = r.photos?.[0] || '';
  const totalTime = (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0);
  const time = formatTime(totalTime);
  const authorName = author?.display_name || author?.username || 'Anonymous';
  const authorHue = hashToHue(r.userId || authorName);
  const visibleTags = r.tags.slice(0, 2);
  const extraTags = r.tags.length - 2;
  const saveCount = 4 + (stableHash(r.id) % 30);

  const ImageBlock = (
    <div className="rg-img">
      <div className="bg" style={{ background: `linear-gradient(135deg, hsl(${authorHue} 50% 52%), hsl(${(authorHue + 25) % 360} 50% 42%))` }} />
      {cover ? (
        <img className="rg-photo" src={cover} alt={r.title} loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <div className="ph-fallback"><ChefHat /></div>
      )}
      <span className={cn('rg-source', source)}>
        <SourceIcon source={source} /> {sourceLabelOf(source)}
      </span>
      <button
        type="button"
        className={cn('rg-save', saved && 'saved')}
        onClick={(e) => { e.stopPropagation(); onSave(r.id); }}
        title={saved ? 'Saved' : 'Save'}
        aria-label={saved ? 'Saved' : 'Save'}
      >
        <Heart fill={saved ? 'currentColor' : 'none'} />
      </button>
    </div>
  );

  const BodyBlock = (
    <div className="rg-body">
      <h3 className="rg-name">{r.title}</h3>
      <div className="rg-cuisine">
        {r.cuisine || 'Recipe'}
        {r.difficulty && <span className={cn('diff', r.difficulty)}>{DIFFICULTY_LABEL[r.difficulty]}</span>}
      </div>
      {r.description && <p className="rg-desc">{r.description}</p>}
      {visibleTags.length > 0 && (
        <div className="rg-tags">
          {visibleTags.map((t) => <span key={t} className="rg-tag">{t}</span>)}
          {extraTags > 0 && <span className="rg-tag more">+{extraTags}</span>}
        </div>
      )}
    </div>
  );

  if (view === 'list') {
    return (
      <article className="rg-card" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}>
        {ImageBlock}
        <div className="rg-card-right">
          {BodyBlock}
          <div className="list-side">
            <span
              className="rg-author-av"
              style={{ background: `hsl(${authorHue} 45% 40%)` }}
            >
              {(authorName[0] || '?').toUpperCase()}
            </span>
            <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>{authorName}</span>
            <span className="sep" />
            {time && <span className="item"><Clock /> {time}</span>}
            {r.servings ? <span className="item"><UtensilsCrossed /> {r.servings}</span> : null}
            <span className="item"><Bookmark /> {saveCount}</span>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="rg-card" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}>
      {ImageBlock}
      {BodyBlock}
      <div className="rg-meta">
        {time && <span className="item"><Clock /> {time}</span>}
        {r.servings ? <span className="item"><UtensilsCrossed /> {r.servings}</span> : null}
        <span className="item"><Bookmark /> {saveCount}</span>
      </div>
      <div className="rg-author">
        <span
          className="rg-author-av"
          style={{ background: `hsl(${authorHue} 45% 40%)` }}
        >
          {(authorName[0] || '?').toUpperCase()}
        </span>
        <span className="rg-author-name">{authorName}</span>
      </div>
    </article>
  );
};

const ChefCard: React.FC<{
  profile: UserProfile;
  recipeCount: number;
  onClick: () => void;
}> = ({ profile, recipeCount, onClick }) => {
  const name = profile.display_name || profile.username || 'Chef';
  const role = profile.home_city || 'Featured chef';
  const initials = name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase() || 'C';
  const hue = hashToHue(profile.user_id || name);
  const followers = 1000 + (stableHash(profile.user_id) % 16000);
  const followersLabel = followers >= 1000 ? `${(followers / 1000).toFixed(1)}k` : String(followers);
  return (
    <button type="button" className="chef-card" onClick={onClick}>
      <div className="chef-av" style={{ background: `hsl(${hue} 50% 32%)` }}>{initials}</div>
      <div className="chef-info">
        <h3 className="chef-name">{name}</h3>
        <div className="chef-role">{role}</div>
        {profile.bio && <p className="chef-tag">{profile.bio}</p>}
        <div className="chef-stats">
          <span className="item"><BookOpen /> <span className="b">{recipeCount}</span> recipes</span>
          <span className="item"><Users /> <span className="b">{followersLabel}</span> followers</span>
        </div>
      </div>
    </button>
  );
};

/* ── Mobile sub-components ─────────────────────────────────────────── */

const MobileTrendCard: React.FC<{ r: Recipe; rank: number | ''; onClick: () => void }> = ({ r, rank, onClick }) => {
  const cover = r.photos?.[0] || '';
  const totalTime = (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0);
  const time = formatTime(totalTime);
  const trendCount = 80 + (stableHash(r.id) % 200);
  const hue = hashToHue(r.userId || r.id);
  return (
    <article className="m-trend" role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}>
      <div className="m-trend-img" style={{ background: `linear-gradient(135deg, hsl(${hue} 50% 52%), hsl(${(hue + 25) % 360} 50% 42%))` }}>
        {cover ? (
          <img src={cover} alt={r.title} loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <div className="ph-fallback"><ChefHat /></div>
        )}
        {rank !== '' && (
          <div className={cn('m-trend-rank', typeof rank === 'number' && rank > 3 && 'dim')}>{rank}</div>
        )}
      </div>
      <div className="m-trend-body">
        <h4 className="m-trend-name">{r.title}</h4>
        <div className="m-trend-meta">
          {r.cuisine && <span>{r.cuisine}</span>}
          {r.cuisine && time ? <span className="sep" /> : null}
          {time && <span>{time}</span>}
          <span className="sep" />
          <span className="up"><TrendingUp /> {trendCount}</span>
        </div>
      </div>
    </article>
  );
};

const MobileChefCard: React.FC<{ profile: UserProfile; recipeCount: number; onClick: () => void }> = ({ profile, recipeCount, onClick }) => {
  const name = profile.display_name || profile.username || 'Chef';
  const role = profile.home_city || 'Featured chef';
  const initials = name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase() || 'C';
  const hue = hashToHue(profile.user_id || name);
  const followers = 1000 + (stableHash(profile.user_id) % 16000);
  const followersLabel = followers >= 1000 ? `${(followers / 1000).toFixed(1)}k` : String(followers);
  return (
    <article className="m-chef">
      <button
        type="button"
        className="m-chef-av"
        style={{ background: `hsl(${hue} 50% 32%)` }}
        onClick={onClick}
        aria-label={`View ${name}'s profile`}
      >
        {initials}
      </button>
      <button
        type="button"
        className="m-chef-info"
        onClick={onClick}
        style={{ background: 'transparent', textAlign: 'left' }}
      >
        <h3 className="m-chef-name">{name}</h3>
        <div className="m-chef-role">{role}</div>
        <div className="m-chef-stats">
          <span><span className="b">{recipeCount}</span> recipes</span>
          <span className="sep" />
          <span><span className="b">{followersLabel}</span> followers</span>
        </div>
      </button>
      <button type="button" className="m-chef-follow" onClick={onClick}>Follow</button>
    </article>
  );
};

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
  const saveCount = 4 + (stableHash(r.id) % 30);
  const hue = hashToHue(r.userId || r.id);

  const ImageBlock = (
    <div className="m-er-img" style={{ background: `linear-gradient(135deg, hsl(${hue} 50% 52%), hsl(${(hue + 25) % 360} 50% 42%))` }}>
      {cover ? (
        <img src={cover} alt={r.title} loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <div className="ph-fallback"><ChefHat /></div>
      )}
      <span className={cn('m-er-source', source)}>
        <SourceIcon source={source} /> {source === 'home' ? 'Home' : source === 'chef' ? 'Chef' : 'Friend'}
      </span>
      <button
        type="button"
        className={cn('m-er-save', saved && 'saved')}
        onClick={(e) => { e.stopPropagation(); onSave(r.id); }}
        aria-label={saved ? 'Saved' : 'Save'}
      >
        <Heart fill={saved ? 'currentColor' : 'none'} />
      </button>
    </div>
  );

  if (view === 'list') {
    const authorName = author?.display_name || author?.username || 'Anonymous';
    const visibleTags = r.tags.slice(0, 2);
    const extraTags = r.tags.length - 2;
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
          <div className="m-er-cuisine">
            {[r.cuisine, r.difficulty && DIFFICULTY_LABEL[r.difficulty]].filter(Boolean).join(' · ') || 'Recipe'}
          </div>
          {r.description && <p className="m-er-desc">{r.description}</p>}
          {visibleTags.length > 0 && (
            <div className="m-er-tags">
              {visibleTags.map((t) => <span key={t} className="m-er-tag">{t}</span>)}
              {extraTags > 0 && <span className="m-er-tag more">+{extraTags}</span>}
            </div>
          )}
          <div className="m-er-footer">
            <span className="av" style={{ background: `hsl(${hue} 45% 40%)` }}>
              {(authorName[0] || '?').toUpperCase()}
            </span>
            <span className="author">{authorName}</span>
            <span className="sep" />
            {time && <span className="item"><Clock /> {time}</span>}
            {r.servings ? <span className="item"><UtensilsCrossed /> {r.servings}</span> : null}
            <span className="item"><Bookmark /> {saveCount}</span>
          </div>
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
        <div className="m-er-cuisine">
          {[r.cuisine, r.difficulty && DIFFICULTY_LABEL[r.difficulty]].filter(Boolean).join(' · ') || 'Recipe'}
        </div>
        <div className="m-er-meta">
          {time && <span><Clock /> {time}</span>}
          <span><Bookmark /> {saveCount}</span>
        </div>
      </div>
    </article>
  );
};
