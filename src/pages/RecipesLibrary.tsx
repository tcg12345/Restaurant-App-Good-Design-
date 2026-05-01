import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, ChefHat, Clock, Plus, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { useRecipes, type Recipe } from '../contexts/RecipesContext';

const DIFFICULTY_LABELS: Record<Recipe['difficulty'], string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

const formatDuration = (totalMinutes: number | null): string | null => {
  if (!totalMinutes || totalMinutes <= 0) return null;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
};

export const RecipesLibrary: React.FC = () => {
  const navigate = useNavigate();
  const { myRecipes, refreshMyRecipes, openRecipeModal } = useRecipes();
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // Pull the latest list on mount so the page reflects any rows added by an
  // import that happened in another tab or before the cache was hydrated.
  useEffect(() => {
    refreshMyRecipes();
  }, [refreshMyRecipes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return myRecipes;
    return myRecipes.filter((r) =>
      r.title.toLowerCase().includes(q) ||
      r.cuisine.toLowerCase().includes(q) ||
      r.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [myRecipes, search]);

  return (
    <div className="min-h-screen bg-surface">
      <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm border-b border-primary/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 hover:bg-primary/5 rounded-full transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 text-primary" />
          </button>
          <BookOpen size={20} className="text-emerald-600" />
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-serif font-semibold text-primary">My Recipes</h1>
            <p className="text-xs text-on-surface/40">
              {myRecipes.length} {myRecipes.length === 1 ? 'recipe' : 'recipes'}
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
          <button
            onClick={() => openRecipeModal()}
            className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-full transition-colors"
            aria-label="New recipe"
          >
            <Plus size={20} />
          </button>
        </div>

        {searchOpen && (
          <div className="relative mt-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/35" />
            <input
              type="text"
              placeholder="Search by title, cuisine, or tag..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              className="w-full pl-9 pr-4 py-2.5 text-sm bg-on-surface/[0.04] border border-on-surface/8 rounded-xl text-on-surface placeholder:text-on-surface/35 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/40 transition-all"
            />
          </div>
        )}
      </div>

      <div className="max-w-2xl mx-auto p-4">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <BookOpen size={40} className="text-on-surface/15 mb-3" />
            <p className="text-sm font-semibold text-on-surface/40 mb-1">
              {search.trim() ? 'No recipes found' : 'No recipes yet'}
            </p>
            <p className="text-xs text-on-surface/30 max-w-[260px]">
              {search.trim()
                ? 'Try a different search.'
                : 'Tap + to create one, or import a CSV/JSON from Log Home Meal.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-on-surface/[0.06]">
            {filtered.map((recipe) => {
              const cover = recipe.photos[0];
              const total = (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);
              const totalLabel = formatDuration(total);
              return (
                <li key={recipe.id}>
                  <button
                    onClick={() => navigate(`/recipe/${recipe.id}`)}
                    className="w-full flex gap-4 py-4 text-left group active:scale-[0.99] transition-transform"
                  >
                    <div className="w-20 h-20 rounded-2xl overflow-hidden bg-on-surface/[0.05] flex-shrink-0">
                      {cover ? (
                        <img
                          src={cover}
                          alt={recipe.title}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-emerald-50">
                          <ChefHat size={24} className="text-emerald-300" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <h3 className="font-serif font-bold text-[15px] leading-snug line-clamp-2">
                        {recipe.title}
                      </h3>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-on-surface/50 font-medium uppercase tracking-wider">
                        {totalLabel && (
                          <>
                            <Clock size={11} />
                            <span>{totalLabel}</span>
                          </>
                        )}
                        {totalLabel && recipe.cuisine && <span className="text-on-surface/25">·</span>}
                        {recipe.cuisine && <span>{recipe.cuisine}</span>}
                        {(totalLabel || recipe.cuisine) && (
                          <span className="text-on-surface/25">·</span>
                        )}
                        <span>{DIFFICULTY_LABELS[recipe.difficulty]}</span>
                      </div>
                      {recipe.description && (
                        <p className="text-[12px] text-on-surface/50 mt-1 leading-snug line-clamp-2">
                          {recipe.description}
                        </p>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
