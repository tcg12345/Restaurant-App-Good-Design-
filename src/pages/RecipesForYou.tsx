import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowUpDown, ChefHat, Check, ChevronDown, Clock, Crown, Search, Users, X, SlidersHorizontal, UtensilsCrossed, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { getPublicRecipes, type Recipe } from '../lib/supabase-recipes';
import { getProfilesByIds, getFriends, type UserProfile } from '../lib/supabase-community';
import { useBottomSheet } from '../lib/useBottomSheet';

type SourceFilter = 'all' | 'friends' | 'chefs' | 'cooks';
type SortKey = 'recent' | 'quick' | 'az';

const SOURCE_LABELS: Record<SourceFilter, string> = {
  all: 'All',
  friends: 'Friends',
  chefs: 'Chefs',
  cooks: 'Home Cooks',
};

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Most Recent',
  quick: 'Quickest',
  az: 'A–Z',
};

const DIFFICULTY_LABEL: Record<Recipe['difficulty'], string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

const formatDuration = (totalMinutes: number): string | null => {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return null;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
};

export const RecipesForYou: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { homeMeals } = useLists();
  const { phoneMode } = useSettings();

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [authors, setAuthors] = useState<Record<string, UserProfile>>({});
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Filter / sort state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [cuisineFilter, setCuisineFilter] = useState<string | null>(null);
  const [difficultyFilter, setDifficultyFilter] = useState<Recipe['difficulty'] | null>(null);
  const [quickOnly, setQuickOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Desktop vs phone — the Filters overlay opens as a centered modal on
  // wide viewports and a bottom sheet on narrow ones.
  const [isWideViewport, setIsWideViewport] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsWideViewport(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const isDesktop = isWideViewport && !phoneMode;
  const { dragProps } = useBottomSheet(filtersOpen, () => setFiltersOpen(false));

  // ── Data load ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Pull a generous slice of public recipes; client-side filters are
      // applied below. Cap is high enough that the page feels well-populated
      // without a paginated endpoint.
      const list = await getPublicRecipes(200);
      if (cancelled) return;
      setRecipes(list);

      const authorIds = Array.from(new Set(list.map((r) => r.userId).filter(Boolean)));
      if (authorIds.length > 0) {
        const profiles = await getProfilesByIds(authorIds);
        if (!cancelled) setAuthors(profiles);
      }

      if (user?.id) {
        const friends = await getFriends(user.id);
        if (!cancelled) setFriendIds(new Set(friends.map((f) => f.friend_id)));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Close sort menu on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false);
      }
    };
    if (sortMenuOpen) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [sortMenuOpen]);

  // ── Derived data ──
  const allCuisines = useMemo(() => {
    const counts = new Map<string, number>();
    recipes.forEach((r) => {
      if (r.cuisine) counts.set(r.cuisine, (counts.get(r.cuisine) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c);
  }, [recipes]);

  // Light personalization: same taste signal as the home rec row, applied to
  // break ties when the user picks "Most Recent". We surface recipes whose
  // cuisine/tags overlap with the user's logged Home Cooking meals, so the
  // feed feels relevant on first paint.
  const tasteWeights = useMemo(() => {
    const cuisineCounts: Record<string, number> = {};
    const tagCounts: Record<string, number> = {};
    homeMeals.forEach((m) => {
      const w = m.score >= 7 ? 2 : 1;
      if (m.cuisine) cuisineCounts[m.cuisine.toLowerCase()] = (cuisineCounts[m.cuisine.toLowerCase()] || 0) + w;
      m.tags.forEach((t) => { tagCounts[t.toLowerCase()] = (tagCounts[t.toLowerCase()] || 0) + w; });
    });
    return { cuisineCounts, tagCounts };
  }, [homeMeals]);

  const tasteScore = (r: Recipe) => {
    let s = 0;
    if (r.cuisine) s += (tasteWeights.cuisineCounts[r.cuisine.toLowerCase()] || 0) * 2;
    r.tags.forEach((t) => { s += tasteWeights.tagCounts[t.toLowerCase()] || 0; });
    return s;
  };

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let pool = recipes.filter((r) => {
      if (!r.title) return false;
      if (source !== 'all') {
        const author = authors[r.userId];
        if (source === 'friends' && !friendIds.has(r.userId)) return false;
        if (source === 'chefs' && !author?.is_expert) return false;
        if (source === 'cooks' && author?.is_expert) return false;
      }
      if (cuisineFilter && r.cuisine !== cuisineFilter) return false;
      if (difficultyFilter && r.difficulty !== difficultyFilter) return false;
      if (quickOnly) {
        const total = (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0);
        if (total <= 0 || total > 30) return false;
      }
      if (q) {
        const author = authors[r.userId];
        const haystack = [
          r.title,
          r.cuisine,
          r.description,
          author?.display_name,
          author?.username,
          ...r.tags,
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    // Sort
    pool = [...pool];
    if (sortBy === 'az') {
      pool.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === 'quick') {
      pool.sort((a, b) => {
        const at = (a.prepTimeMinutes ?? 0) + (a.cookTimeMinutes ?? 0);
        const bt = (b.prepTimeMinutes ?? 0) + (b.cookTimeMinutes ?? 0);
        // Recipes with no time fall to the bottom.
        const av = at <= 0 ? Number.POSITIVE_INFINITY : at;
        const bv = bt <= 0 ? Number.POSITIVE_INFINITY : bt;
        return av - bv;
      });
    } else {
      // Recent: keep DB order (already updated_at desc), but boost
      // taste-matching recipes within ties.
      pool.sort((a, b) => {
        const ta = tasteScore(a);
        const tb = tasteScore(b);
        if (tb !== ta) return tb - ta;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    }
    return pool;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipes, authors, friendIds, source, cuisineFilter, difficultyFilter, quickOnly, searchQuery, sortBy, tasteWeights]);

  // ── Render ──
  const activeFilterCount =
    (cuisineFilter ? 1 : 0) +
    (difficultyFilter ? 1 : 0) +
    (quickOnly ? 1 : 0);

  const clearAllFilters = () => {
    setCuisineFilter(null);
    setDifficultyFilter(null);
    setQuickOnly(false);
  };

  return (
    <div className="min-h-screen bg-surface">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-surface/95 backdrop-blur-sm border-b border-primary/10">
        <div className="px-4 pt-safe-3 pb-3 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 hover:bg-primary/5 rounded-full transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 text-primary" />
          </button>
          <ChefHat size={20} className="text-emerald-600" />
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-serif font-semibold text-primary">Explore Recipes</h1>
            <p className="text-xs text-on-surface/40">
              {loading
                ? 'Loading...'
                : `${filtered.length} ${filtered.length === 1 ? 'recipe' : 'recipes'}`}
            </p>
          </div>
          <button
            onClick={() => setSearchOpen((v) => !v)}
            className={cn(
              'p-2 rounded-full transition-colors',
              searchOpen ? 'text-primary bg-primary/10' : 'text-on-surface/40 hover:text-on-surface',
            )}
            aria-label="Search"
          >
            <Search size={18} />
          </button>
        </div>

        {searchOpen && (
          <div className="px-4 pb-3">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
              <input
                type="text"
                placeholder="Search recipes, chefs, cuisines..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full pl-9 pr-9 py-2.5 text-sm bg-on-surface/[0.04] border border-on-surface/8 rounded-xl text-on-surface placeholder:text-on-surface/35 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/40 transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-on-surface/35 hover:text-on-surface hover:bg-on-surface/5"
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Filter bar — source pills on the left, sort + Filters button on
            the right. All secondary filters (cuisine, difficulty, quick)
            now live behind the Filters button so the bar stays tidy. */}
        <div className="px-4 pb-3 flex items-center gap-2">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar flex-1 min-w-0">
            {(['all', 'friends', 'chefs', 'cooks'] as SourceFilter[]).map((s) => (
              <button
                key={s}
                onClick={() => setSource(s)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all whitespace-nowrap',
                  source === s
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-white text-on-surface/60 border-on-surface/8 hover:border-on-surface/20',
                )}
              >
                {s === 'friends' && <Users size={12} />}
                {s === 'chefs' && <Crown size={12} />}
                {s === 'cooks' && <ChefHat size={12} />}
                {SOURCE_LABELS[s]}
              </button>
            ))}
          </div>

          <div ref={sortMenuRef} className="relative flex-shrink-0">
            <button
              onClick={() => setSortMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-white border border-on-surface/8 text-on-surface/70 hover:border-on-surface/20 whitespace-nowrap"
            >
              <ArrowUpDown size={12} />
              <span className="hidden sm:inline">{SORT_LABELS[sortBy]}</span>
              <ChevronDown size={12} className={cn('transition-transform', sortMenuOpen && 'rotate-180')} />
            </button>
            {sortMenuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-on-surface/8 rounded-xl shadow-lg overflow-hidden z-30 min-w-[140px]">
                {(['recent', 'quick', 'az'] as SortKey[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => { setSortBy(k); setSortMenuOpen(false); }}
                    className={cn(
                      'w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-left hover:bg-on-surface/5 transition-colors',
                      sortBy === k ? 'text-emerald-700 font-semibold' : 'text-on-surface/70',
                    )}
                  >
                    {SORT_LABELS[k]}
                    {sortBy === k && <Check size={13} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => setFiltersOpen(true)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all whitespace-nowrap flex-shrink-0',
              activeFilterCount > 0
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-white text-on-surface/70 border-on-surface/8 hover:border-on-surface/20',
            )}
          >
            <SlidersHorizontal size={12} />
            Filters
            {activeFilterCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] rounded-full bg-emerald-600 text-white text-[10px] font-bold tabular-nums px-1">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Active filter chips — only renders when any secondary filter is
            on, so the bar above stays clean. Each chip is a tap-to-remove. */}
        {activeFilterCount > 0 && (
          <div className="px-4 pb-3 flex items-center gap-1.5 flex-wrap">
            {quickOnly && (
              <button
                onClick={() => setQuickOnly(false)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
              >
                <Clock size={10} />
                Under 30m
                <X size={11} className="-mr-0.5 opacity-60" />
              </button>
            )}
            {difficultyFilter && (
              <button
                onClick={() => setDifficultyFilter(null)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
              >
                {DIFFICULTY_LABEL[difficultyFilter]}
                <X size={11} className="-mr-0.5 opacity-60" />
              </button>
            )}
            {cuisineFilter && (
              <button
                onClick={() => setCuisineFilter(null)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
              >
                {cuisineFilter}
                <X size={11} className="-mr-0.5 opacity-60" />
              </button>
            )}
            <button
              onClick={clearAllFilters}
              className="ml-1 text-[11px] font-semibold text-on-surface/50 hover:text-on-surface/80 underline-offset-2 hover:underline"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="px-4 sm:px-6 lg:px-8 py-4">
        {loading ? (
          <div className={cn('grid gap-3', phoneMode ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6')}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-[260px] rounded-2xl bg-on-surface/[0.04] animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ChefHat size={40} className="text-on-surface/15 mb-3" />
            <p className="text-sm font-semibold text-on-surface/40 mb-1">No recipes match these filters</p>
            <p className="text-xs text-on-surface/30 max-w-[260px]">Try clearing filters or switching to a different source.</p>
            {activeFilterCount > 0 && (
              <button
                onClick={clearAllFilters}
                className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-full text-xs font-semibold hover:bg-emerald-700 transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className={cn('grid gap-3', phoneMode ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6')}>
            {filtered.map((r) => {
              const author = authors[r.userId];
              const total = (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0);
              const totalLabel = formatDuration(total);
              const isFriend = friendIds.has(r.userId);
              const isExpert = !!author?.is_expert;
              const ingCount = r.ingredients?.length || 0;
              const stepCount = r.steps?.length || 0;
              const sourceCls = isExpert
                ? 'bg-amber-500/95 text-white'
                : isFriend
                  ? 'bg-blue-500/95 text-white'
                  : 'bg-on-surface/[0.06] text-on-surface/70';
              const sourceLabel = isExpert ? 'Chef' : isFriend ? 'Friend' : 'Home cook';
              const SourceIcon = isExpert ? Crown : isFriend ? Users : ChefHat;
              return (
                <Link
                  key={r.id}
                  to={`/recipe/${r.id}`}
                  className="group relative rounded-2xl bg-white border border-on-surface/[0.07] hover:border-on-surface/[0.18] hover:shadow-[0_8px_24px_-10px_rgba(0,0,0,0.12)] transition-all p-4 flex flex-col overflow-hidden"
                >
                  {/* Top emerald accent strip */}
                  <div className="absolute inset-x-0 top-0 h-1 bg-emerald-500/80" />

                  {/* Top row: source chip + chef icon */}
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] truncate min-w-0', sourceCls)}>
                      <SourceIcon size={11} />
                      {sourceLabel}
                    </span>
                    <ChefHat size={15} className="text-emerald-500/70 flex-shrink-0" />
                  </div>

                  {/* Title + cuisine row */}
                  <div className="mt-3.5">
                    <h3 className="font-serif text-[17px] font-bold leading-[1.18] line-clamp-2 text-on-surface group-hover:text-primary transition-colors">
                      {r.title}
                    </h3>
                    {(r.cuisine || r.difficulty) && (
                      <p className="mt-1.5 text-[11.5px] text-on-surface/55 font-medium uppercase tracking-[0.08em] truncate">
                        {[r.cuisine, DIFFICULTY_LABEL[r.difficulty]].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>

                  {/* Short description preview when available */}
                  {r.description && (
                    <p className="mt-2.5 text-[13px] text-on-surface/55 italic leading-snug line-clamp-2">
                      {r.description}
                    </p>
                  )}

                  {/* Tag pips (max 2) so the page reads scannable */}
                  {r.tags && r.tags.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {r.tags.slice(0, 2).map((t) => (
                        <span key={t} className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700/85">
                          {t}
                        </span>
                      ))}
                      {r.tags.length > 2 && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-on-surface/45">
                          +{r.tags.length - 2}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Spacer so the footer pins to the bottom */}
                  <div className="flex-1" />

                  {/* Stats footer */}
                  {(totalLabel || ingCount > 0 || stepCount > 0) && (
                    <div className="mt-3 pt-3 border-t border-on-surface/[0.06] flex items-center justify-between text-[12px] text-on-surface/70 font-semibold tabular-nums">
                      {totalLabel ? (
                        <span className="inline-flex items-center gap-1.5"><Clock size={13} />{totalLabel}</span>
                      ) : <span />}
                      {ingCount > 0 ? (
                        <span className="inline-flex items-center gap-1.5" title={`${ingCount} ingredient${ingCount === 1 ? '' : 's'}`}>
                          <UtensilsCrossed size={13} />{ingCount}
                        </span>
                      ) : <span />}
                      {stepCount > 0 ? (
                        <span className="inline-flex items-center gap-1.5" title={`${stepCount} step${stepCount === 1 ? '' : 's'}`}>
                          <BookOpen size={13} />{stepCount}
                        </span>
                      ) : <span />}
                    </div>
                  )}

                  {/* Author footer */}
                  <div className="mt-2.5 pt-2.5 border-t border-on-surface/[0.04] flex items-center gap-2 text-[12.5px] text-on-surface/65 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-on-surface/10 flex items-center justify-center text-[10px] font-serif font-bold text-on-surface/60 flex-shrink-0">
                      {(author?.display_name?.charAt(0) || author?.username?.charAt(0) || '?').toUpperCase()}
                    </div>
                    <span className="truncate font-medium">
                      {author?.display_name || author?.username || 'Unknown'}
                    </span>
                    {isExpert && <Crown size={12} className="text-amber-500 flex-shrink-0" />}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Filters popup ─────────────────────────────────────────────
          Centered modal on desktop, bottom sheet on phone/mobile.
          Hosts every secondary filter: cooking time, difficulty, and the
          full cuisine list. The bar above the grid only shows source +
          sort + an active-chip preview, keeping the page chrome tight. */}
      <AnimatePresence>
        {filtersOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className={cn(
              'fixed inset-0 z-50 bg-black/45 backdrop-blur-sm flex justify-center',
              isDesktop ? 'items-center px-4' : 'items-end',
            )}
            onClick={() => setFiltersOpen(false)}
          >
            <motion.div
              initial={isDesktop ? { opacity: 0, y: 12, scale: 0.98 } : { y: '100%' }}
              animate={isDesktop ? { opacity: 1, y: 0, scale: 1 } : { y: 0 }}
              exit={isDesktop ? { opacity: 0, y: 12, scale: 0.98 } : { y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              {...(isDesktop ? {} : dragProps)}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'bg-surface flex flex-col w-full',
                isDesktop
                  ? 'max-w-md rounded-2xl shadow-2xl border border-on-surface/[0.08] max-h-[80vh]'
                  : 'rounded-t-3xl max-h-[88vh]',
              )}
            >
              {!isDesktop && (
                <div className="pt-2 pb-1 flex justify-center">
                  <span className="w-10 h-1 rounded-full bg-on-surface/15" />
                </div>
              )}

              {/* Header */}
              <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-on-surface/[0.06]">
                <h3 className="font-serif font-bold text-[18px] text-on-surface">Filters</h3>
                <button
                  onClick={() => setFiltersOpen(false)}
                  className="w-8 h-8 rounded-full hover:bg-on-surface/[0.05] flex items-center justify-center text-on-surface/60"
                  aria-label="Close filters"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
                {/* Cooking time */}
                <section>
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/45 mb-2.5">Cooking time</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setQuickOnly(false)}
                      className={cn(
                        'inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
                        !quickOnly
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-white text-on-surface/65 border-on-surface/8',
                      )}
                    >
                      Any
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickOnly(true)}
                      className={cn(
                        'inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
                        quickOnly
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-white text-on-surface/65 border-on-surface/8',
                      )}
                    >
                      <Clock size={11} />
                      Under 30m
                    </button>
                  </div>
                </section>

                {/* Difficulty */}
                <section>
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/45 mb-2.5">Difficulty</p>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setDifficultyFilter(null)}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
                        !difficultyFilter
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-white text-on-surface/65 border-on-surface/8',
                      )}
                    >
                      Any
                    </button>
                    {(['easy', 'medium', 'hard'] as Recipe['difficulty'][]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDifficultyFilter(d)}
                        className={cn(
                          'px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
                          difficultyFilter === d
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-white text-on-surface/65 border-on-surface/8',
                        )}
                      >
                        {DIFFICULTY_LABEL[d]}
                      </button>
                    ))}
                  </div>
                </section>

                {/* Cuisine */}
                {allCuisines.length > 0 && (
                  <section>
                    <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/45 mb-2.5">Cuisine</p>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setCuisineFilter(null)}
                        className={cn(
                          'px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
                          !cuisineFilter
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-white text-on-surface/65 border-on-surface/8',
                        )}
                      >
                        Any
                      </button>
                      {allCuisines.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setCuisineFilter(c)}
                          className={cn(
                            'px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
                            cuisineFilter === c
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-white text-on-surface/65 border-on-surface/8',
                          )}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              {/* Footer — clear + apply */}
              <div className="px-5 py-4 border-t border-on-surface/[0.06] flex items-center gap-3">
                <button
                  type="button"
                  onClick={clearAllFilters}
                  disabled={activeFilterCount === 0}
                  className="px-4 py-2.5 text-sm font-semibold text-on-surface/65 hover:text-on-surface disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Clear all
                </button>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  className="flex-1 h-11 rounded-full bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 transition-colors"
                >
                  {activeFilterCount > 0
                    ? `Show ${filtered.length} ${filtered.length === 1 ? 'recipe' : 'recipes'}`
                    : 'Done'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
