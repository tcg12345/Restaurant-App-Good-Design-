/**
 * AddEntryPicker — minimalist popover used by the Guide Live Editor to
 * append a new entry to the guide. Sourcing depends on the guide type:
 *
 *   • Restaurants: searches the user's rated restaurants (only).
 *   • Recipes:     searches the user's recipes in the cloud `recipes`
 *                  table (the same source the wizard's recipes-my picker
 *                  uses, with the rated-name filter applied so
 *                  restaurant-titled rows don't leak in).
 *
 * On click of the trigger button the popover opens with the search
 * input focused; a click on an item appends a fully-populated
 * GuideEntry (via shared builders in lib/guide-entry-builders.ts) and
 * closes the popover. Already-added entries are disabled so the user
 * can't double-add the same spot.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, X, Check, ChefHat, BookOpen, Loader2, MapPin } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';
import { useLists } from '../../contexts/ListsContext';
import { useRecipes } from '../../contexts/RecipesContext';
import { useHomeLocation } from '../../contexts/HomeLocationContext';
import { entryFromRating, entryFromDbRecipe, entryFromPlace } from '../../lib/guide-entry-builders';
import { searchPlacesByText, type PlaceResult } from '../../lib/places';
import type { GuideEntry, GuideType } from '../../lib/supabase-guides';

interface AddEntryPickerProps {
  type: GuideType;
  existingRefIds: Set<string>;
  onAdd: (entry: GuideEntry) => void;
  /** Optional alternate look — the TOC trailing CTA uses 'compact'. */
  variant?: 'block' | 'compact';
}

export const AddEntryPicker: React.FC<AddEntryPickerProps> = ({ type, existingRefIds, onAdd, variant = 'block' }) => {
  const { user } = useAuth();
  const { ratings, getRestaurantInfo, homeMeals, restaurantMeta } = useLists();
  const { myRecipes } = useRecipes();
  const homeLoc = useHomeLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Places search — runs only for restaurant guides, debounced.
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const placeReqIdRef = useRef(0);
  const placeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Close on outside click + Esc.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    // Capture phase so this fires BEFORE the editor's window-level Escape
    // handler; preventDefault + stopPropagation claim the keypress so one
    // Esc closes only the popover, not the whole editor.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Focus the search field whenever the popover opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
    if (!open) {
      setQuery('');
      setPlaceResults([]);
    }
  }, [open]);

  // Debounced Google Places search — only for restaurant guides, only
  // when the picker is open and the user has typed something. We anchor
  // to the user's home location when set, otherwise fall back to NYC
  // (matches the wizard's StepSeed default).
  useEffect(() => {
    if (!open || type !== 'restaurants') return;
    if (placeDebounceRef.current) clearTimeout(placeDebounceRef.current);
    const q = query.trim();
    if (!q) {
      setPlaceResults([]);
      setSearchingPlaces(false);
      return;
    }
    setSearchingPlaces(true);
    const reqId = ++placeReqIdRef.current;
    const lat = homeLoc?.location?.lat ?? 40.7128;
    const lng = homeLoc?.location?.lng ?? -74.0060;
    placeDebounceRef.current = setTimeout(async () => {
      try {
        const found = await searchPlacesByText(q, lat, lng);
        if (reqId !== placeReqIdRef.current) return;
        setPlaceResults(found.slice(0, 10));
      } catch {
        if (reqId === placeReqIdRef.current) setPlaceResults([]);
      } finally {
        if (reqId === placeReqIdRef.current) setSearchingPlaces(false);
      }
    }, 260);
    return () => { if (placeDebounceRef.current) clearTimeout(placeDebounceRef.current); };
  }, [open, type, query, homeLoc]);

  // Names from the user's ratings + cached restaurant meta — used to
  // filter restaurant-named rows out of the cloud recipes table.
  // Cloud recipes that are explicitly linked to a restaurant
  // (`linkedRestaurantId`) are filtered separately by id.
  const restaurantNames = useMemo(() => {
    const s = new Set<string>();
    for (const r of ratings) {
      const k = (r.name || '').trim().toLowerCase();
      if (k) s.add(k);
    }
    for (const meta of Object.values(restaurantMeta) as Array<{ name?: string }>) {
      const k = (meta.name || '').trim().toLowerCase();
      if (k) s.add(k);
    }
    return s;
  }, [ratings, restaurantMeta]);

  // Cloud recipes don't carry a score; if the user logged a matching
  // home meal, surface its score (mirrors the wizard).
  const homeMealScores = useMemo(() => {
    const m = new Map<string, number>();
    for (const meal of homeMeals) {
      const key = (meal.name || '').trim().toLowerCase();
      if (key && typeof meal.score === 'number') m.set(key, meal.score);
    }
    return m;
  }, [homeMeals]);

  const restaurantHits = useMemo(() => {
    if (type !== 'restaurants') return [];
    const q = query.trim().toLowerCase();
    return ratings
      .filter((r) => !q
        || r.name.toLowerCase().includes(q)
        || (r.cuisine || '').toLowerCase().includes(q)
        || (r.address || '').toLowerCase().includes(q))
      .slice(0, 24);
  }, [type, ratings, query]);

  const recipeHits = useMemo(() => {
    if (type !== 'recipes') return [];
    const q = query.trim().toLowerCase();
    return myRecipes
      .filter((r) => !r.linkedRestaurantId)
      .filter((r) => !restaurantNames.has((r.title || '').trim().toLowerCase()))
      // A real recipe has at least some content. Restaurant placeholders
      // that ended up in the recipes table — title + cuisine + nothing
      // else — fail this gate and don't appear in the picker.
      .filter((r) => {
        const hasIngredients = (r.ingredients?.length || 0) > 0;
        const hasSteps = (r.steps?.length || 0) > 0;
        const hasDescription = (r.description || '').trim().length > 0;
        const hasTime = (r.prepTimeMinutes || 0) + (r.cookTimeMinutes || 0) > 0;
        return hasIngredients || hasSteps || hasDescription || hasTime;
      })
      .filter((r) => !q
        || r.title.toLowerCase().includes(q)
        || (r.cuisine || '').toLowerCase().includes(q)
        || (r.tags || []).some((t) => t.toLowerCase().includes(q)))
      .slice(0, 24);
  }, [type, myRecipes, restaurantNames, query]);


  const handleAddRestaurant = (id: string) => {
    const r = ratings.find((rr) => rr.restaurantId === id);
    if (!r) return;
    const meta = getRestaurantInfo(id);
    onAdd(entryFromRating(r, meta));
    setOpen(false);
  };

  const handleAddPlace = (place: PlaceResult) => {
    // If the user has actually rated this place we still prefer the
    // rich rating-derived entry (score, dishes, notes) over the bare
    // Places snapshot.
    const matching = ratings.find((r) => r.restaurantId === place.id);
    if (matching) {
      const meta = getRestaurantInfo(place.id);
      onAdd(entryFromRating(matching, meta));
    } else {
      onAdd(entryFromPlace(place));
    }
    setOpen(false);
  };

  // Dedupe Places results against rated hits so we don't render the
  // same restaurant in both sections.
  const ratedIds = useMemo(
    () => new Set(restaurantHits.map((r) => r.restaurantId)),
    [restaurantHits],
  );
  const placeResultsDedup = useMemo(
    () => placeResults.filter((p) => !ratedIds.has(p.id) && !existingRefIds.has(p.id)),
    [placeResults, ratedIds, existingRefIds],
  );

  const handleAddRecipe = (id: string) => {
    const r = myRecipes.find((rr) => rr.id === id);
    if (!r) return;
    const score = homeMealScores.get((r.title || '').trim().toLowerCase());
    onAdd(entryFromDbRecipe(r, score));
    setOpen(false);
  };

  const placeholder = type === 'restaurants'
    ? 'Search your rated places or the database…'
    : 'Search your recipes…';

  // "Nothing at all to show" — used to render the empty-state row.
  // For restaurants this is now `no rated hits AND no database hits AND
  // not currently searching` so the empty hint doesn't flash while the
  // debounced Places call is in flight.
  const nothingToShow = type === 'restaurants'
    ? (restaurantHits.length === 0 && placeResultsDedup.length === 0 && !searchingPlaces)
    : recipeHits.length === 0;
  const emptyHint = type === 'restaurants'
    ? (query.trim()
      ? 'No matches in your rated places or the database.'
      : (ratings.length === 0
        ? "You haven't rated any restaurants yet — search above to add from the database."
        : 'Type to search the database.'))
    : (myRecipes.length === 0
      ? "You haven't created any recipes yet."
      : 'No matches in your recipes.');

  return (
    <div className={cn('gle-picker-wrap', variant === 'compact' && 'is-compact')} ref={popRef}>
      <button
        type="button"
        className={cn(variant === 'compact' ? 'gle-picker-trigger-compact' : 'gle-add-entry')}
        onClick={() => setOpen((v) => !v)}
      >
        <Plus size={variant === 'compact' ? 12 : 14} />
        <span>{type === 'recipes' ? 'Add another recipe' : 'Add another spot'}</span>
      </button>

      {open && (
        <div className="gle-picker-pop" role="dialog" aria-label={type === 'recipes' ? 'Add recipe' : 'Add restaurant'}>
          <div className="gle-picker-search">
            <Search size={14} className="gle-picker-search-ico" />
            <input
              ref={inputRef}
              className="gle-picker-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
            />
            {query && (
              <button
                type="button"
                className="gle-picker-clear"
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <X size={11} />
              </button>
            )}
          </div>

          <div className="gle-picker-list">
            {!user?.id && (
              <div className="gle-picker-empty">Sign in to use the picker.</div>
            )}

            {user?.id && nothingToShow && (
              <div className="gle-picker-empty">{emptyHint}</div>
            )}

            {user?.id && type === 'restaurants' && restaurantHits.length > 0 && (
              <div className="gle-picker-section">Your rated places</div>
            )}
            {user?.id && type === 'restaurants' && restaurantHits.map((r) => {
              const added = existingRefIds.has(r.restaurantId);
              return (
                <button
                  key={r.restaurantId}
                  type="button"
                  className={cn('gle-picker-item', added && 'is-added')}
                  onClick={() => !added && handleAddRestaurant(r.restaurantId)}
                  disabled={added}
                >
                  <div className="gle-picker-item-text">
                    <div className="gle-picker-item-name">{r.name}</div>
                    <div className="gle-picker-item-sub">
                      {[r.cuisine, r.price, r.address].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {typeof r.score === 'number' && r.score > 0 && (
                    <span className="gle-picker-item-score">{r.score.toFixed(1)}</span>
                  )}
                  {added
                    ? <Check size={14} className="gle-picker-item-check" />
                    : <Plus size={14} className="gle-picker-item-plus" />}
                </button>
              );
            })}

            {user?.id && type === 'restaurants' && (searchingPlaces || placeResultsDedup.length > 0) && (
              <div className="gle-picker-section">
                From the database
                {searchingPlaces && <Loader2 size={11} className="gle-picker-spinner" />}
              </div>
            )}
            {user?.id && type === 'restaurants' && placeResultsDedup.map((p) => {
              const added = existingRefIds.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={cn('gle-picker-item', added && 'is-added')}
                  onClick={() => !added && handleAddPlace(p)}
                  disabled={added}
                >
                  <span className="gle-picker-item-ico">
                    <MapPin size={14} />
                  </span>
                  <div className="gle-picker-item-text">
                    <div className="gle-picker-item-name">{p.name}</div>
                    <div className="gle-picker-item-sub">
                      {[p.types?.[0]?.replace(/_/g, ' '), p.address].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {added
                    ? <Check size={14} className="gle-picker-item-check" />
                    : <Plus size={14} className="gle-picker-item-plus" />}
                </button>
              );
            })}

            {user?.id && type === 'recipes' && recipeHits.map((r) => {
              const added = existingRefIds.has(r.id);
              const total = (r.prepTimeMinutes || 0) + (r.cookTimeMinutes || 0);
              const score = homeMealScores.get((r.title || '').trim().toLowerCase());
              return (
                <button
                  key={r.id}
                  type="button"
                  className={cn('gle-picker-item', added && 'is-added')}
                  onClick={() => !added && handleAddRecipe(r.id)}
                  disabled={added}
                >
                  <span className="gle-picker-item-ico">
                    <ChefHat size={14} />
                  </span>
                  <div className="gle-picker-item-text">
                    <div className="gle-picker-item-name">{r.title}</div>
                    <div className="gle-picker-item-sub">
                      {[r.cuisine, r.difficulty, total > 0 ? `${total} min` : null].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {typeof score === 'number' && score > 0 && (
                    <span className="gle-picker-item-score">{score.toFixed(1)}</span>
                  )}
                  {added
                    ? <Check size={14} className="gle-picker-item-check" />
                    : <Plus size={14} className="gle-picker-item-plus" />}
                </button>
              );
            })}
          </div>

          {((type === 'restaurants' ? ratings.length + placeResultsDedup.length : myRecipes.length) > 0) && (
            <div className="gle-picker-foot">
              <span>
                {type === 'restaurants'
                  ? (placeResultsDedup.length > 0
                    ? `${restaurantHits.length} rated · ${placeResultsDedup.length} from database`
                    : `${restaurantHits.length} of ${ratings.length} rated places`)
                  : `${recipeHits.length} of ${myRecipes.length} recipes`}
              </span>
              <span className="gle-picker-foot-ico">
                {type === 'restaurants' ? <BookOpen size={11} /> : <ChefHat size={11} />}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
