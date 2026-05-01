import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowUpDown, ChefHat, Check, ChevronDown, Clock, Crown, Search, Users, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { getPublicRecipes, type Recipe } from '../lib/supabase-recipes';
import { getProfilesByIds, getFriends, type UserProfile } from '../lib/supabase-community';

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
        <div className="px-4 py-3 flex items-center gap-3">
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

        {/* Source pills + sort */}
        <div className="px-4 pb-3 flex items-center gap-2 overflow-x-auto no-scrollbar">
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

          <div className="flex-1 min-w-[8px]" />

          <div ref={sortMenuRef} className="relative flex-shrink-0">
            <button
              onClick={() => setSortMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-white border border-on-surface/8 text-on-surface/70 hover:border-on-surface/20 whitespace-nowrap"
            >
              <ArrowUpDown size={12} />
              {SORT_LABELS[sortBy]}
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
        </div>

        {/* Secondary filters */}
        <div className="px-4 pb-3 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setQuickOnly((v) => !v)}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all whitespace-nowrap',
              quickOnly
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-white text-on-surface/55 border-on-surface/8',
            )}
          >
            <Clock size={11} />
            Under 30m
          </button>
          {(['easy', 'medium', 'hard'] as Recipe['difficulty'][]).map((d) => (
            <button
              key={d}
              onClick={() => setDifficultyFilter((cur) => (cur === d ? null : d))}
              className={cn(
                'px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all whitespace-nowrap',
                difficultyFilter === d
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-white text-on-surface/55 border-on-surface/8',
              )}
            >
              {DIFFICULTY_LABEL[d]}
            </button>
          ))}
          {allCuisines.length > 0 && <span className="w-px h-4 bg-on-surface/10 mx-1 flex-shrink-0" />}
          {allCuisines.slice(0, 14).map((c) => (
            <button
              key={c}
              onClick={() => setCuisineFilter((cur) => (cur === c ? null : c))}
              className={cn(
                'px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all whitespace-nowrap',
                cuisineFilter === c
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-white text-on-surface/55 border-on-surface/8',
              )}
            >
              {c}
            </button>
          ))}
          {activeFilterCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="ml-1 flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold text-on-surface/50 hover:text-on-surface/80 whitespace-nowrap flex-shrink-0"
            >
              <X size={11} />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="max-w-5xl mx-auto p-4">
        {loading ? (
          <div className={cn('grid gap-4', phoneMode ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4')}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] rounded-2xl bg-on-surface/[0.04] animate-pulse" />
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
          <div className={cn('grid gap-4', phoneMode ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4')}>
            {filtered.map((r) => {
              const author = authors[r.userId];
              const cover = r.photos?.[0];
              const total = (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0);
              const totalLabel = formatDuration(total);
              const isFriend = friendIds.has(r.userId);
              const isExpert = !!author?.is_expert;
              return (
                <Link
                  key={r.id}
                  to={`/recipe/${r.id}`}
                  className="group flex flex-col"
                >
                  <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-on-surface/[0.05]">
                    {cover ? (
                      <img
                        src={cover}
                        alt={r.title}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-emerald-50">
                        <ChefHat size={32} className="text-emerald-300" />
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />

                    {/* Source badge */}
                    {(isExpert || isFriend) && (
                      <div className="absolute top-2 left-2 flex items-center gap-1">
                        {isExpert && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-500/95 text-white backdrop-blur-sm">
                            <Crown size={9} />
                            Chef
                          </span>
                        )}
                        {!isExpert && isFriend && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-blue-500/95 text-white backdrop-blur-sm">
                            <Users size={9} />
                            Friend
                          </span>
                        )}
                      </div>
                    )}

                    {/* Title block */}
                    <div className="absolute inset-x-0 bottom-0 p-3">
                      <p className="text-white text-sm font-bold leading-tight drop-shadow-sm line-clamp-2">{r.title}</p>
                      <div className="flex items-center gap-1.5 mt-1 text-[10.5px] text-white/85 font-medium">
                        {totalLabel && (
                          <span className="inline-flex items-center gap-0.5">
                            <Clock size={10} /> {totalLabel}
                          </span>
                        )}
                        {totalLabel && r.cuisine && <span className="text-white/40">·</span>}
                        {r.cuisine && <span>{r.cuisine}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Author row below the card so it doesn't overlap the title */}
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-on-surface/55 min-w-0">
                    <div className="w-5 h-5 rounded-full bg-on-surface/10 flex items-center justify-center text-[9px] font-serif font-bold text-on-surface/45 flex-shrink-0">
                      {(author?.display_name?.charAt(0) || author?.username?.charAt(0) || '?').toUpperCase()}
                    </div>
                    <span className="truncate">
                      {author?.display_name || author?.username || 'Unknown'}
                    </span>
                    {isExpert && <Crown size={10} className="text-amber-500 flex-shrink-0" />}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
