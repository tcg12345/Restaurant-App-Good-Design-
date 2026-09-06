import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpDown, BookOpen, Bookmark, Cake, Check, ChefHat, ChevronLeft, Clock, LayoutGrid, List, Plus, Search, SlidersHorizontal, Soup, Sun, UtensilsCrossed, Wheat, Wine, X } from 'lucide-react';
import { FilterSheet } from '../components/FilterSheet';
import { FilterDrillSection, FilterSection, Pill, PillRow } from '../components/filterPrimitives';
import { SearchField } from '../components/SearchField';
import { GlassButton } from '../lib/glass-buttons';
import { usePageBack } from '../lib/usePageBack';
import { useAuth } from '../contexts/AuthContext';
import { useSignInModal } from '../contexts/SignInModalContext';
import { useLists, DEFAULT_WANT_TO_COOK_ID, type HomeMeal } from '../contexts/ListsContext';
import { usePageAddAction } from '../contexts/PageAddActionContext';
import { getPublicRecipes, type Recipe } from '../lib/supabase-recipes';
import { getProfilesByIds, getFriends, getFriendsPublicHomeMeals, type UserProfile, type FriendHomeMeal } from '../lib/supabase-community';
import { cn } from '../lib/utils';
import './RecipesForYou.css';

type Source = 'all' | 'friend' | 'expert' | 'saved';
type Filters = { meal: string; cuisines: string[]; tags: string[]; quick: boolean; easy: boolean; sort: 'recent' | 'quick' | 'az' };
const defaults = (): Filters => ({ meal: '', cuisines: [], tags: [], quick: false, easy: false, sort: 'recent' });
const meals = [
  { key: 'breakfast', label: 'Breakfast', icon: Sun }, { key: 'lunch', label: 'Lunch', icon: Soup },
  { key: 'dinner', label: 'Dinner', icon: UtensilsCrossed }, { key: 'dessert', label: 'Dessert', icon: Cake },
  { key: 'baking', label: 'Baking', icon: Wheat }, { key: 'drinks', label: 'Drinks', icon: Wine },
];
const totalMinutes = (r: Recipe) => Math.max(0, r.prepTimeMinutes ?? 0) + Math.max(0, r.cookTimeMinutes ?? 0);
const formatTime = (m: number) => m > 0 ? (m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}`) : '';
const prettyTag = (s: string) => s.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
// Untagged recipes stay in All; don't silently label every unknown recipe Dinner.
const recipeMeal = (r: Recipe) => {
  const tags = (r.tags ?? []).join(' ').toLowerCase();
  if (/breakfast|brunch/.test(tags)) return 'breakfast';
  if (/lunch/.test(tags)) return 'lunch';
  if (/dessert|sweet/.test(tags)) return 'dessert';
  if (/baking|bread/.test(tags)) return 'baking';
  if (/drink|cocktail|beverage/.test(tags)) return 'drinks';
  return /dinner|supper|main course/.test(tags) ? 'dinner' : '';
};
const filterCount = (f: Filters) => Number(!!f.meal) + f.cuisines.length + f.tags.length + Number(f.quick) + Number(f.easy);
const toggleValue = (values: string[], value: string) => values.includes(value) ? values.filter(v => v !== value) : [...values, value];

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


interface RecipesForYouProps { embedded?: boolean; query?: string; onQueryChange?: (q: string) => void }

export const RecipesForYou: React.FC<RecipesForYouProps> = ({ embedded = false, query, onQueryChange }) => {
  const navigate = useNavigate();
  const goBack = usePageBack('/pantry');
  const { user, isSignedIn } = useAuth();
  const { requireSignIn } = useSignInModal();
  const { lists, addRecipeToList, removeRecipeFromList } = useLists();
  const { setOverride: setPageAddAction } = usePageAddAction();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [authors, setAuthors] = useState<Record<string, UserProfile>>({});
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [ownQuery, setOwnQuery] = useState('');
  const searchQuery = embedded ? query ?? '' : ownQuery;
  const setSearchQuery = embedded ? onQueryChange ?? (() => {}) : setOwnQuery;
  const [source, setSource] = useState<Source>('all');
  const [filters, setFilters] = useState<Filters>(defaults);
  const [draft, setDraft] = useState<Filters>(defaults);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [shown, setShown] = useState(12);
  const savedRecipes = lists.find(l => l.id === DEFAULT_WANT_TO_COOK_ID)?.recipes;
  const savedIds = useMemo(() => new Set((savedRecipes ?? []).map(r => r.id)), [savedRecipes]);
  const createRecipe = useCallback(() => {
    if (!isSignedIn) { requireSignIn('Sign in to add a recipe'); return; }
    navigate('/create', { state: { mode: 'recipe' } });
  }, [isSignedIn, requireSignIn, navigate]);
  useEffect(() => {
    // An embedded, retained tab must not change the host page's add action.
    if (embedded) return;
    setPageAddAction({ label: 'Add Recipe', onClick: createRecipe });
    return () => setPageAddAction(null);
  }, [embedded, setPageAddAction, createRecipe]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {

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
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, reloadKey]);


  const toggleSave = (r: Recipe) => {
    if (!isSignedIn) { requireSignIn('Sign in to save recipes'); return; }
    if (savedIds.has(r.id)) removeRecipeFromList(DEFAULT_WANT_TO_COOK_ID, r.id);
    else addRecipeToList(DEFAULT_WANT_TO_COOK_ID, publicRecipeToHomeMeal(r, r.userId === user?.id, authors[r.userId]));
  };
  const openRecipe = (r: Recipe) => navigate(r.userId ? `/recipe/${r.userId}/${r.id}` : `/recipe/${r.id}`);
  const library = useMemo(() => recipes.filter(r => r.title?.trim() && r.userId !== user?.id)
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)), [recipes, user?.id]);
  const cuisines = useMemo(() => [...new Set(library.map(r => r.cuisine).filter(Boolean))].sort(), [library]);
  const tags = useMemo(() => [...new Set(library.flatMap(r => r.tags ?? []))].sort(), [library]);
  const availableMeals = meals.filter(m => library.some(r => recipeMeal(r) === m.key));
  const matches = (f: Filters) => {
    const terms = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const result = library.filter(r => {
      if (source === 'friend' && !friendIds.has(r.userId)) return false;
      if (source === 'expert' && !authors[r.userId]?.is_verified && r.sourceType !== 'expert') return false;
      if (source === 'saved' && !savedIds.has(r.id)) return false;
      if (f.quick && (totalMinutes(r) <= 0 || totalMinutes(r) > 30)) return false;
      if (f.easy && r.difficulty !== 'easy') return false;
      if (f.meal && recipeMeal(r) !== f.meal) return false;
      if (f.cuisines.length && !f.cuisines.includes(r.cuisine)) return false;
      if (f.tags.length && !f.tags.some(t => (r.tags ?? []).includes(t))) return false;
      const author = authors[r.userId];
      const haystack = [r.title, r.description, r.cuisine, ...(r.tags ?? []), ...(r.ingredients ?? []).map(i => i.name), author?.display_name, author?.username].join(' ').toLowerCase();
      return terms.every(term => haystack.includes(term));
    });
    if (f.sort === 'az') result.sort((a, b) => a.title.localeCompare(b.title));
    if (f.sort === 'quick') result.sort((a, b) => (totalMinutes(a) || Infinity) - (totalMinutes(b) || Infinity));
    return result;
  };
  const results = matches(filters);
  const activeCount = filterCount(filters);
  const searching = !!searchQuery.trim() || activeCount > 0 || source !== 'all';
  const featured = library.find(r => r.photos?.[0] && friendIds.has(r.userId)) ?? library.find(r => r.photos?.[0]) ?? library[0];
  const reset = () => { setFilters(defaults()); setSource('all'); setSearchQuery(''); };
  useEffect(() => { setShown(12); }, [filters, source, searchQuery]);
  const showFilters = () => { setDraft({ ...filters, cuisines: [...filters.cuisines], tags: [...filters.tags] }); setSheetOpen(true); };
  const sourceTitle = { all: 'Find your next favorite', friend: 'From your people', expert: 'From the experts', saved: 'Saved to cook' }[source];

  return (
    <div className={cn('recipe-discovery', embedded && 'recipe-discovery--embedded')}>
      {!embedded && <header className="rd-header">
        <GlassButton id="recipes-back" symbol="chevron.left" label="Back" onClick={goBack} className="rd-back"><ChevronLeft size={22} /></GlassButton>
        <h1>Recipes</h1>
        <button className="rd-round" onClick={createRecipe} aria-label="Create a recipe"><Plus size={22} /></button>
      </header>}
      {!embedded && <div className="rd-search"><SearchField glassId="recipes-search" value={searchQuery} onChange={setSearchQuery} placeholder="Recipes, ingredients, cuisines" /></div>}
      <div className="rd-sources" role="group" aria-label="Recipe source">
        {([['all', 'Explore'], ['friend', 'Following'], ['expert', 'Experts'], ['saved', 'Saved']] as const).map(([key, label]) =>
          <button key={key} aria-pressed={source === key} className={cn(source === key && 'selected')} onClick={() => setSource(key)}>{label}</button>)}
      </div>
      <div className="rd-tools">
        <div className="rd-quick" role="group" aria-label="Quick recipe filters">
          <button onClick={showFilters} className={cn('rd-filter', activeCount > 0 && 'selected')}><SlidersHorizontal size={17} />Filters{activeCount > 0 && <span>{activeCount}</span>}</button>
          <button aria-pressed={filters.quick} className={cn(filters.quick && 'selected')} onClick={() => setFilters(f => ({ ...f, quick: !f.quick }))}><Clock size={16} />30 min or less</button>
          <button aria-pressed={filters.easy} className={cn(filters.easy && 'selected')} onClick={() => setFilters(f => ({ ...f, easy: !f.easy }))}><ChefHat size={17} />Easy</button>
        </div>
      </div>
      {searching && <div className="rd-filter-summary"><span>{searchQuery ? `Results for “${searchQuery}”` : activeCount ? `${activeCount} filter${activeCount === 1 ? '' : 's'} applied` : sourceTitle}</span><button onClick={reset}>Clear all<X size={14} /></button></div>}
      {!searching && !loading && !loadError && featured && <section className="rd-feature-section" aria-label="Featured recipe">
        <div className="rd-intro"><div><p className="rd-eyebrow">A little kitchen inspiration</p><h1>Something worth making.</h1></div></div>
        <RecipeTile recipe={featured} author={authors[featured.userId]} saved={savedIds.has(featured.id)} onSave={() => toggleSave(featured)} onOpen={() => openRecipe(featured)} hero label={friendIds.has(featured.userId) ? 'From someone you follow' : 'From the community'} />
        {availableMeals.length > 1 && <div className="rd-meals" role="group" aria-label="Browse by meal">
          {availableMeals.map(({ key, label, icon: Icon }) => <button key={key} onClick={() => setFilters(f => ({ ...f, meal: key }))}><span><Icon size={23} strokeWidth={1.5} /></span>{label}</button>)}
        </div>}
      </section>}
      <section className="rd-results" aria-label="Recipe results" aria-busy={loading}>
        <div className="rd-section-head"><div><h2>{searching ? sourceTitle : 'Explore the kitchen'}</h2><p role="status">{loading ? 'Finding inspiration…' : `${results.length} recipe${results.length === 1 ? '' : 's'}${filters.sort === 'quick' ? ' · Quickest first' : filters.sort === 'az' ? ' · A–Z' : ''}`}</p></div>
          <div className="rd-result-actions"><button className="rd-round" onClick={showFilters} aria-label="Sort recipes"><ArrowUpDown size={18} /></button><button className="rd-round" aria-label={view === 'grid' ? 'Switch to list view' : 'Switch to grid view'} onClick={() => setView(v => v === 'grid' ? 'list' : 'grid')}>{view === 'grid' ? <List size={20} /> : <LayoutGrid size={18} />}</button></div>
        </div>
        {loading ? <div className="rd-grid" aria-label="Loading recipes">{Array.from({ length: 6 }, (_, i) => <div className="rd-skeleton" key={i}><div /><span /><span /></div>)}</div>
          : loadError ? <div className="rd-empty"><BookOpen size={32} /><h3>Couldn’t load recipes</h3><p>Try again to get back to browsing.</p><button onClick={() => setReloadKey(k => k + 1)}>Try again</button></div>
          : !results.length ? <div className="rd-empty"><Search size={32} /><h3>{searching ? 'A fresh search might help' : 'The kitchen is just getting started'}</h3><p>{source === 'saved' ? 'Bookmark recipes as you browse. They’ll be waiting here and in your cookbook.' : source === 'friend' ? 'Recipes shared by people you follow will appear here. Try Explore for more inspiration.' : searching ? 'Try another ingredient, or clear your filters to see more recipes.' : 'Share a recipe of your own, or come back for new ideas.'}</p><button onClick={searching ? reset : createRecipe}>{searching ? 'Explore all recipes' : 'Create a recipe'}<ArrowRight size={17} /></button></div>
          : <><div className={cn('rd-grid', view === 'list' && 'rd-grid--list')}>{results.slice(0, shown).map(r => <RecipeTile key={r.id} recipe={r} author={authors[r.userId]} saved={savedIds.has(r.id)} onSave={() => toggleSave(r)} onOpen={() => openRecipe(r)} />)}</div>
            {results.length > shown && <button className="rd-more" onClick={() => setShown(n => n + 12)}>More recipes<Plus size={18} /></button>}</>}
      </section>
      {!loading && !searching && <button className="rd-create" onClick={createRecipe}><span className="rd-create-icon"><BookOpen size={23} /></span><span><strong>Have something good to share?</strong><small>Add your own recipe to the kitchen.</small></span><Plus size={20} /></button>}
      <FilterSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Recipe filters" subtitle="Find what fits your kitchen" onReset={() => setDraft(defaults())} applyLabel={`Show ${matches(draft).length} recipes`} onApply={() => { setFilters(draft); setSheetOpen(false); }}>
        <FilterSection label="Sort by"><PillRow>{([['recent', 'Newest'], ['quick', 'Quickest'], ['az', 'A–Z']] as const).map(([key, label]) => <Pill key={key} active={draft.sort === key} onClick={() => setDraft(f => ({ ...f, sort: key }))}>{label}</Pill>)}</PillRow></FilterSection>
        <FilterSection label="Keep it simple"><PillRow><Pill active={draft.quick} onClick={() => setDraft(f => ({ ...f, quick: !f.quick }))}>30 minutes or less</Pill><Pill active={draft.easy} onClick={() => setDraft(f => ({ ...f, easy: !f.easy }))}>Easy to make</Pill></PillRow></FilterSection>
        {availableMeals.length > 0 && <FilterSection label="Meal"><PillRow><Pill active={!draft.meal} onClick={() => setDraft(f => ({ ...f, meal: '' }))}>Any</Pill>{availableMeals.map(m => <Pill key={m.key} active={draft.meal === m.key} onClick={() => setDraft(f => ({ ...f, meal: f.meal === m.key ? '' : m.key }))}>{m.label}</Pill>)}</PillRow></FilterSection>}
        {cuisines.length > 0 && <FilterDrillSection id="recipe-cuisines" label="Cuisine" options={cuisines.map(value => ({ value, label: value }))} selected={draft.cuisines} onToggle={value => setDraft(f => ({ ...f, cuisines: toggleValue(f.cuisines, value) }))} searchPlaceholder="Search cuisines" />}
        {tags.length > 0 && <FilterDrillSection id="recipe-tags" label="Recipe tags" options={tags.map(value => ({ value, label: prettyTag(value) }))} selected={draft.tags} onToggle={value => setDraft(f => ({ ...f, tags: toggleValue(f.tags, value) }))} searchPlaceholder="Search tags" />}
      </FilterSheet>
    </div>
  );
};

const RecipeTile: React.FC<{ recipe: Recipe; author?: UserProfile; saved: boolean; onSave: () => void; onOpen: () => void; hero?: boolean; label?: string }> = ({ recipe: r, author, saved, onSave, onOpen, hero = false, label }) => {
  const [failedPhoto, setFailedPhoto] = useState('');
  const photo = r.photos?.[0];
  const hasPhoto = !!photo && photo !== failedPhoto;
  const time = formatTime(totalMinutes(r));
  const name = author?.display_name || author?.username || 'Community cook';
  return <article className={cn('rd-card', hero && 'rd-card--hero', !hasPhoto && 'rd-card--no-photo')}>
    <button className="rd-card-open" onClick={onOpen} aria-label={`View ${r.title}`}>
      <div className="rd-card-image">{hasPhoto ? <img src={photo} alt="" loading={hero ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" onError={() => setFailedPhoto(photo)} /> : <div className="rd-photo-fallback"><ChefHat size={hero ? 70 : 42} strokeWidth={1} /><span>{r.cuisine || 'From the kitchen'}</span></div>}
        {hero && <span className="rd-feature-label">{label}</span>}
      </div>
      <div className="rd-card-copy"><p className="rd-card-category">{r.cuisine || 'Community recipe'}</p><h3>{r.title}</h3><p className="rd-card-author">{name}{author?.is_verified && <Check size={12} aria-label="Verified" />}</p><div className="rd-card-meta">{time && <span><Clock size={13} />{time}</span>}{r.difficulty && <span>{prettyTag(r.difficulty)}</span>}{hero && !!r.servings && <span>Serves {r.servings}</span>}</div>{hero && <span className="rd-hero-link">View recipe<ArrowRight size={18} /></span>}</div>
    </button>
    <button className={cn('rd-save', saved && 'is-saved')} aria-label={`${saved ? 'Unsave' : 'Save'} ${r.title}`} aria-pressed={saved} onClick={onSave}><Bookmark size={19} fill={saved ? 'currentColor' : 'none'} /></button>
  </article>;
}
