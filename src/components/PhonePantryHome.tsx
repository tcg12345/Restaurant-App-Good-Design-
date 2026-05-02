import React, { useMemo, useState } from 'react';
import { Bookmark, ChefHat, Clock, Flame, Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import type { CustomList, RestaurantRating, WishlistItem, HomeMeal } from '../contexts/ListsContext';

/**
 * Phone-only redesign of the Pantry home — replaces the search bar +
 * horizontal pill row with a card-based layout. Wishlist + rated
 * restaurants surface as the two prominent tiles at the top, custom lists
 * appear as a grid below, and a Recipes tab swaps the same grid for the
 * user's logged Home Cooking meals.
 *
 * Pure presentational: every navigation handler is hoisted as a callback so
 * the parent (Pantry.tsx) stays in charge of routing into the existing
 * detail views.
 */

interface Props {
  lists: CustomList[];
  ratedCount: number;
  ratedTopScores: number[]; // up to 3 highest scores, already sorted desc
  wishlistCount: number;
  homeMeals: HomeMeal[];
  onOpenList: (list: CustomList) => void;
  onOpenWishlist: () => void;
  onOpenRated: () => void;
  onCreateList: () => void;
  onOpenMeal: (meal: HomeMeal) => void;
}

type Tab = 'lists' | 'recipes';

// Deterministic color palette so a list's tile color is stable across
// renders without storing one on the model. Hash the id, mod into the
// palette. Tones are warm/muted to match the screenshot.
const LIST_PALETTE: Array<{ from: string; to: string }> = [
  { from: '#7B9CC4', to: '#506E92' }, // dusty blue
  { from: '#8E6C82', to: '#604858' }, // dusty purple
  { from: '#7A9270', to: '#506049' }, // forest green
  { from: '#C2725D', to: '#8D4A3C' }, // rust
  { from: '#D4A85A', to: '#A07F39' }, // gold
  { from: '#9C7A5A', to: '#71583E' }, // tan
  { from: '#5F8C8A', to: '#41615F' }, // teal
  { from: '#B16A6A', to: '#82494B' }, // brick
];

function colorForId(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return LIST_PALETTE[hash % LIST_PALETTE.length];
}

export const PhonePantryHome: React.FC<Props> = ({
  lists,
  ratedCount,
  ratedTopScores,
  wishlistCount,
  homeMeals,
  onOpenList,
  onOpenWishlist,
  onOpenRated,
  onCreateList,
  onOpenMeal,
}) => {
  const [tab, setTab] = useState<Tab>('lists');

  // Sort meals by recency for the recipes grid.
  const sortedMeals = useMemo(
    () => [...homeMeals].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [homeMeals],
  );

  return (
    <div className="pt-4 pb-32">
      {/* ── Title ── */}
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/40">
        Your Collection
      </p>
      <h1 className="font-serif text-[44px] leading-[1.05] mt-1 text-on-surface">
        The <span className="italic">{tab === 'lists' ? 'Pantry' : 'Cookbook'}</span>
      </h1>

      {/* ── Tab pill ── */}
      <div className="mt-6 inline-flex w-full bg-on-surface/[0.06] rounded-full p-1">
        {(['lists', 'recipes'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex-1 py-2 rounded-full text-sm font-semibold transition-all',
              tab === t
                ? 'bg-white text-on-surface shadow-sm'
                : 'text-on-surface/45',
            )}
          >
            {t === 'lists' ? 'Lists' : 'Recipes'}
          </button>
        ))}
      </div>

      {tab === 'lists' ? (
        <ListsTab
          lists={lists}
          ratedCount={ratedCount}
          ratedTopScores={ratedTopScores}
          wishlistCount={wishlistCount}
          onOpenList={onOpenList}
          onOpenWishlist={onOpenWishlist}
          onOpenRated={onOpenRated}
          onCreateList={onCreateList}
        />
      ) : (
        <RecipesTab meals={sortedMeals} onOpenMeal={onOpenMeal} />
      )}
    </div>
  );
};

/* ─────────────── Lists tab ─────────────── */

const ListsTab: React.FC<{
  lists: CustomList[];
  ratedCount: number;
  ratedTopScores: number[];
  wishlistCount: number;
  onOpenList: (l: CustomList) => void;
  onOpenWishlist: () => void;
  onOpenRated: () => void;
  onCreateList: () => void;
}> = ({ lists, ratedCount, ratedTopScores, wishlistCount, onOpenList, onOpenWishlist, onOpenRated, onCreateList }) => {
  return (
    <>
      {/* ── Section: Yours ── */}
      <div className="mt-6">
        <SectionLabel>Essentials</SectionLabel>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <RatedCard count={ratedCount} topScores={ratedTopScores} onClick={onOpenRated} />
          <WishlistCard count={wishlistCount} onClick={onOpenWishlist} />
        </div>
      </div>

      {/* ── Section: Collections ── */}
      <div className="mt-7">
        <SectionLabel>Collections</SectionLabel>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <NewListCard onClick={onCreateList} />
          {lists.map((list) => (
            <CustomListCard key={list.id} list={list} onClick={() => onOpenList(list)} />
          ))}
        </div>
      </div>
    </>
  );
};

/* ─────────────── Recipes tab ─────────────── */

const RecipesTab: React.FC<{ meals: HomeMeal[]; onOpenMeal: (m: HomeMeal) => void }> = ({ meals, onOpenMeal }) => {
  if (meals.length === 0) {
    return (
      <div className="mt-8 flex flex-col items-center text-center py-14 border-2 border-dashed border-on-surface/12 rounded-3xl">
        <ChefHat size={36} className="text-on-surface/20 mb-3" />
        <p className="text-sm font-semibold text-on-surface/50">No recipes yet</p>
        <p className="text-xs text-on-surface/35 mt-1 max-w-[220px]">
          Log a home meal or import a CSV to start filling your cookbook.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <SectionLabel>{`${meals.length} ${meals.length === 1 ? 'recipe' : 'recipes'}`}</SectionLabel>
      <div className="grid grid-cols-2 gap-3 mt-3">
        {meals.map((meal) => (
          <RecipeCard key={meal.id} meal={meal} onClick={() => onOpenMeal(meal)} />
        ))}
      </div>
    </div>
  );
};

/* ─────────────── Sub-components ─────────────── */

// Single-line modern section label — replaces the previous overline + big
// serif title combo. Uppercase, tight tracking, low contrast so the cards
// underneath carry the visual weight.
const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-on-surface/45">{children}</p>
);

// Score-chip layout for the "Your canvas" card. Up to 3 chips, slightly
// overlapping. Falls back to a tasteful empty state when the user has no
// ratings yet.
const RatedCard: React.FC<{ count: number; topScores: number[]; onClick: () => void }> = ({ count, topScores, onClick }) => {
  const hasRatings = count > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative aspect-square rounded-3xl overflow-hidden text-left p-4 flex flex-col justify-between bg-gradient-to-br from-[#2C2826] to-[#161311] active:scale-[0.98] transition-transform"
    >
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/55 bg-white/10 px-2 py-0.5 rounded-full">
          Rated
        </span>
        {hasRatings && (
          <div className="flex -space-x-2">
            {topScores.slice(0, 3).map((s, i) => (
              <div
                key={i}
                className="w-9 h-9 rounded-full bg-emerald-700/95 ring-2 ring-[#2C2826] flex items-center justify-center text-white font-serif font-bold text-[12px] tabular-nums"
              >
                {s.toFixed(1)}
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <p className="text-white font-serif font-bold text-[20px] leading-tight">Your canvas</p>
        <p className="text-white/55 text-xs mt-0.5">
          {hasRatings ? `${count} place${count === 1 ? '' : 's'}` : 'No ratings yet'}
        </p>
      </div>
    </button>
  );
};

const WishlistCard: React.FC<{ count: number; onClick: () => void }> = ({ count, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="relative aspect-square rounded-3xl overflow-hidden text-left p-4 flex flex-col justify-between bg-gradient-to-br from-[#D26A4A] to-[#A8482E] active:scale-[0.98] transition-transform"
  >
    <div className="flex items-start justify-between">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/85 bg-white/15 px-2 py-0.5 rounded-full">
        Wishlist
      </span>
      <Bookmark size={20} className="text-white fill-white" />
    </div>
    <div>
      <p className="text-white font-serif font-bold text-[20px] leading-tight">Want to try</p>
      <p className="text-white/75 text-xs mt-0.5">
        {count > 0 ? `${count} saved` : 'Nothing saved yet'}
      </p>
    </div>
  </button>
);

const NewListCard: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="aspect-square rounded-3xl border-2 border-dashed border-on-surface/15 flex flex-col items-center justify-center text-on-surface/45 hover:border-on-surface/25 hover:text-on-surface/65 active:scale-[0.98] transition-all"
  >
    <Plus size={26} strokeWidth={1.6} className="mb-1.5" />
    <span className="text-xs font-semibold">New list</span>
  </button>
);

const CustomListCard: React.FC<{ list: CustomList; onClick: () => void }> = ({ list, onClick }) => {
  const total = list.restaurantIds.length + (list.wishlistIds?.length || 0);
  const color = colorForId(list.id);
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative aspect-square rounded-3xl overflow-hidden text-left p-4 flex flex-col justify-between active:scale-[0.98] transition-transform"
      style={{ backgroundImage: `linear-gradient(135deg, ${color.from}, ${color.to})` }}
    >
      <span className="text-2xl">{list.emoji}</span>
      <div>
        <p className="text-white font-serif font-bold text-[18px] leading-tight line-clamp-2">{list.name}</p>
        <p className="text-white/75 text-xs mt-0.5">
          {total} {total === 1 ? 'place' : 'places'}
        </p>
      </div>
    </button>
  );
};

const RecipeCard: React.FC<{ meal: HomeMeal; onClick: () => void }> = ({ meal, onClick }) => {
  const cover = meal.coverPhoto || meal.photos?.[0]?.url || '';
  const total = (meal.prepTime ?? 0) + (meal.cookTime ?? 0);
  const color = colorForId(meal.id);

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative aspect-square rounded-3xl overflow-hidden text-left p-4 flex flex-col justify-between active:scale-[0.98] transition-transform"
      style={cover ? undefined : { backgroundImage: `linear-gradient(135deg, ${color.from}, ${color.to})` }}
    >
      {cover && (
        <>
          <img
            src={cover}
            alt={meal.name}
            className="absolute inset-0 w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/15" />
        </>
      )}
      <div className="relative flex items-start justify-between">
        {meal.score > 0 ? (
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/90 bg-emerald-700/90 px-2 py-0.5 rounded-full">
            {meal.score.toFixed(1)}
          </span>
        ) : (
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/85 bg-white/15 px-2 py-0.5 rounded-full">
            Recipe
          </span>
        )}
        {!cover && <ChefHat size={20} className="text-white/85" />}
      </div>
      <div className="relative">
        <p className="text-white font-serif font-bold text-[18px] leading-tight line-clamp-2">{meal.name}</p>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-white/80">
          {total > 0 && (
            <span className="inline-flex items-center gap-1">
              <Clock size={10} />
              {formatDuration(total)}
            </span>
          )}
          {meal.cuisine && total > 0 && <span className="text-white/40">·</span>}
          {meal.cuisine && <span>{meal.cuisine}</span>}
          {meal.difficulty && !meal.cuisine && total === 0 && (
            <span className="inline-flex items-center gap-1">
              <Flame size={10} />
              {meal.difficulty}
            </span>
          )}
        </div>
      </div>
    </button>
  );
};

function formatDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
