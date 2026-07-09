import React, { useMemo } from 'react';
import { Bookmark, ChefHat, ChevronRight, Clock, Flame, Plus, Sparkles, UtensilsCrossed } from 'lucide-react';
import { cn } from '../lib/utils';
import { scoreBadgeBg, scoreColor } from '../lib/score';
import { DEFAULT_WANT_TO_COOK_ID, type CustomList, type HomeMeal } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';

/**
 * Pantry landing — used on phone and desktop. Two top-level tabs:
 *
 *   • Restaurants (default) — Wishlist + "Your canvas" (rated) essentials,
 *     plus a card grid of user-created restaurant lists. The "+ New list"
 *     card opens the create-list sheet seeded for restaurant lists.
 *   • Recipes — "All Recipes" essential (the cookbook of every home meal
 *     the user has logged), plus a card grid of user-created recipe lists
 *     (CustomList where type === 'home-cooking'). "+ New recipe list"
 *     opens the create-list sheet seeded for recipe lists, so any recipe
 *     added to a sub-list also lands in All Recipes.
 *
 * Pure presentational: every navigation handler is hoisted as a callback so
 * the parent (Pantry.tsx) stays in charge of routing into the existing
 * detail views.
 */

interface Props {
  // Restaurant essentials
  ratedCount: number;
  ratedTopScores: number[]; // up to 3 highest scores, already sorted desc
  wishlistCount: number;
  // Both tabs share the same lists array — it's split by `type` here.
  lists: CustomList[];
  homeMeals: HomeMeal[];
  // Active tab (controlled by parent so it can be persisted in URL).
  tab: PantryTab;
  onTabChange: (tab: PantryTab) => void;
  // Restaurant tab handlers
  onOpenList: (list: CustomList) => void;
  onOpenWishlist: () => void;
  onOpenRated: () => void;
  onCreateRestaurantList: () => void;
  /** Opens the ranked recommendations browser. Renders the "Recommended for
   *  you" banner on the Restaurants tab when provided. */
  onOpenRecommendations?: () => void;
  // Recipe tab handlers
  onOpenAllRecipes: () => void;
  onCreateRecipeList: () => void;
}

export type PantryTab = 'restaurants' | 'recipes';

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
  ratedCount,
  ratedTopScores,
  wishlistCount,
  lists,
  homeMeals,
  tab,
  onTabChange,
  onOpenList,
  onOpenWishlist,
  onOpenRated,
  onCreateRestaurantList,
  onOpenRecommendations,
  onOpenAllRecipes,
  onCreateRecipeList,
}) => {
  const { darkMode } = useSettings();
  // Split lists by their kind so each tab only shows the relevant ones.
  const restaurantLists = useMemo(
    () => lists.filter((l) => l.type !== 'home-cooking'),
    [lists],
  );
  const recipeLists = useMemo(
    () => lists.filter((l) => l.type === 'home-cooking'),
    [lists],
  );

  return (
    <div className="pt-safe-4 pb-32">
      {/* ── Tab pill ── */}
      <div className={cn('inline-flex w-full rounded-full p-1', darkMode ? 'bg-white/[0.04]' : 'bg-on-surface/[0.06]')}>
        {(['restaurants', 'recipes'] as PantryTab[]).map((t) => (
          <button
            key={t}
            onClick={() => onTabChange(t)}
            className={cn(
              'flex-1 py-2 rounded-full text-sm font-semibold transition-all',
              // In dark mode the literal `bg-white` is remapped (with
              // !important) to the dark paper tone, which is *darker* than the
              // track — so the selected pill vanished. Branch on the theme to
              // give dark mode a clearly elevated, lighter pill instead.
              tab === t
                ? darkMode
                  ? 'bg-white/[0.16] text-white ring-1 ring-white/10 shadow-sm shadow-black/30'
                  : 'bg-white text-on-surface shadow-sm'
                : darkMode
                  ? 'text-on-surface/40'
                  : 'text-on-surface/45',
            )}
          >
            {t === 'restaurants' ? 'Restaurants' : 'Recipes'}
          </button>
        ))}
      </div>

      {tab === 'restaurants' ? (
        <>
          {/* Recommendations entry — a full-width banner above the card
              grid so "what should I try next?" is one tap from the
              landing, not buried in the rated view's toolbar. */}
          {onOpenRecommendations && (
            <button
              type="button"
              onClick={onOpenRecommendations}
              className="mt-5 w-full flex items-center gap-3 rounded-3xl bg-primary p-4 text-left text-white active:scale-[0.98] transition-transform"
            >
              <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-white/15">
                <Sparkles size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-serif text-[17px] font-bold leading-tight">Recommended for you</span>
                <span className="mt-0.5 block text-[12px] text-white/70">Ranked picks nearby, tuned to your taste</span>
              </span>
              <ChevronRight size={18} className="flex-shrink-0 text-white/70" />
            </button>
          )}
          <RestaurantsTab
            lists={restaurantLists}
            ratedCount={ratedCount}
            ratedTopScores={ratedTopScores}
            wishlistCount={wishlistCount}
            onOpenList={onOpenList}
            onOpenWishlist={onOpenWishlist}
            onOpenRated={onOpenRated}
            onCreateRestaurantList={onCreateRestaurantList}
          />
        </>
      ) : (
        <RecipesTab
          lists={recipeLists}
          homeMeals={homeMeals}
          onOpenAllRecipes={onOpenAllRecipes}
          onOpenList={onOpenList}
          onCreateRecipeList={onCreateRecipeList}
        />
      )}
    </div>
  );
};

/* ─────────────── Restaurants tab ─────────────── */

const RestaurantsTab: React.FC<{
  lists: CustomList[];
  ratedCount: number;
  ratedTopScores: number[];
  wishlistCount: number;
  onOpenList: (l: CustomList) => void;
  onOpenWishlist: () => void;
  onOpenRated: () => void;
  onCreateRestaurantList: () => void;
}> = ({ lists, ratedCount, ratedTopScores, wishlistCount, onOpenList, onOpenWishlist, onOpenRated, onCreateRestaurantList }) => {
  return (
    <>
      {/* ── Section: Essentials ── */}
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
          <NewListCard label="New list" onClick={onCreateRestaurantList} />
          {lists.map((list) => (
            <CustomListCard key={list.id} list={list} onClick={() => onOpenList(list)} />
          ))}
        </div>
      </div>
    </>
  );
};

/* ─────────────── Recipes tab ─────────────── */

const RecipesTab: React.FC<{
  lists: CustomList[];
  homeMeals: HomeMeal[];
  onOpenAllRecipes: () => void;
  onOpenList: (l: CustomList) => void;
  onCreateRecipeList: () => void;
}> = ({ lists, homeMeals, onOpenAllRecipes, onOpenList, onCreateRecipeList }) => {
  const sortedMeals = useMemo(
    () => [...homeMeals].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [homeMeals],
  );

  // Pull the built-in "Want to Cook" list out so it gets its own
  // essentials card (parallel to the restaurant Wishlist card on the
  // other tab). The remaining recipe lists fall through to the grid.
  const wantToCook = useMemo(
    () => lists.find((l) => l.id === DEFAULT_WANT_TO_COOK_ID) || null,
    [lists],
  );
  const otherRecipeLists = useMemo(
    () => lists.filter((l) => l.id !== DEFAULT_WANT_TO_COOK_ID),
    [lists],
  );

  return (
    <>
      {/* ── Section: Essentials ── */}
      <div className="mt-6">
        <SectionLabel>Essentials</SectionLabel>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <AllRecipesCard count={homeMeals.length} topMeal={sortedMeals[0]} onClick={onOpenAllRecipes} />
          {wantToCook && (
            <WantToCookCard
              count={wantToCook.recipes?.length || 0}
              onClick={() => onOpenList(wantToCook)}
            />
          )}
        </div>
      </div>

      {/* ── Section: Recipe lists ── */}
      <div className="mt-7">
        <SectionLabel>Recipe lists</SectionLabel>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <NewListCard label="New recipe list" onClick={onCreateRecipeList} />
          {otherRecipeLists.map((list) => (
            <RecipeListCard key={list.id} list={list} onClick={() => onOpenList(list)} />
          ))}
        </div>
      </div>
    </>
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
                className={cn(
                  'w-9 h-9 rounded-full border ring-2 ring-[#2C2826] flex items-center justify-center font-bold text-[12px] tabular-nums',
                  scoreBadgeBg(s),
                  scoreColor(s),
                )}
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

// "All Recipes" essential card on the Recipes tab. Contains every meal the
// user has logged, regardless of which recipe list they live in. Optionally
// shows a small preview of the most recent meal's cover image.
const AllRecipesCard: React.FC<{ count: number; topMeal?: HomeMeal; onClick: () => void }> = ({ count, topMeal, onClick }) => {
  const cover = topMeal?.coverPhoto || topMeal?.photos?.[0]?.url || '';
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative aspect-square rounded-3xl overflow-hidden text-left p-4 flex flex-col justify-between bg-gradient-to-br from-[#2F4A39] to-[#15281D] active:scale-[0.98] transition-transform"
    >
      {cover && (
        <>
          <img
            src={cover}
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-50"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#15281D]/95 via-[#15281D]/55 to-[#15281D]/30" />
        </>
      )}
      <div className="relative flex items-start justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/75 bg-white/10 px-2 py-0.5 rounded-full">
          All Recipes
        </span>
        <ChefHat size={20} className="text-white/85" />
      </div>
      <div className="relative">
        <p className="text-white font-serif font-bold text-[20px] leading-tight">Cookbook</p>
        <p className="text-white/65 text-xs mt-0.5">
          {count > 0 ? `${count} recipe${count === 1 ? '' : 's'}` : 'No recipes yet'}
        </p>
      </div>
    </button>
  );
};

// "Want to Cook" essential card — recipe-side counterpart to the
// restaurant Wishlist card. Saffron gradient evokes a dog-eared
// cookbook page so the user can immediately tell it from All Recipes
// (deep green) and the other tab's Wishlist (orange-red).
const WantToCookCard: React.FC<{ count: number; onClick: () => void }> = ({ count, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="relative aspect-square rounded-3xl overflow-hidden text-left p-4 flex flex-col justify-between bg-gradient-to-br from-[#C68F3A] to-[#8E5E1F] active:scale-[0.98] transition-transform"
  >
    <div className="flex items-start justify-between">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/85 bg-white/15 px-2 py-0.5 rounded-full">
        Saved
      </span>
      <Bookmark size={20} className="text-white fill-white" />
    </div>
    <div>
      <p className="text-white font-serif font-bold text-[20px] leading-tight">Want to cook</p>
      <p className="text-white/75 text-xs mt-0.5">
        {count > 0 ? `${count} saved` : 'Nothing saved yet'}
      </p>
    </div>
  </button>
);

const NewListCard: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="aspect-square rounded-3xl border-2 border-dashed border-on-surface/15 flex flex-col items-center justify-center text-on-surface/45 hover:border-on-surface/25 hover:text-on-surface/65 active:scale-[0.98] transition-all"
  >
    <Plus size={26} strokeWidth={1.6} className="mb-1.5" />
    <span className="text-xs font-semibold">{label}</span>
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

const RecipeListCard: React.FC<{ list: CustomList; onClick: () => void }> = ({ list, onClick }) => {
  const total = list.recipes?.length || 0;
  const color = colorForId(list.id);
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative aspect-square rounded-3xl overflow-hidden text-left p-4 flex flex-col justify-between active:scale-[0.98] transition-transform"
      style={{ backgroundImage: `linear-gradient(135deg, ${color.from}, ${color.to})` }}
    >
      <div className="flex items-start justify-between">
        <span className="text-2xl">{list.emoji}</span>
        <UtensilsCrossed size={18} className="text-white/70" />
      </div>
      <div>
        <p className="text-white font-serif font-bold text-[18px] leading-tight line-clamp-2">{list.name}</p>
        <p className="text-white/75 text-xs mt-0.5">
          {total} {total === 1 ? 'recipe' : 'recipes'}
        </p>
      </div>
    </button>
  );
};

// Kept for potential future use — the recipe grid card used to show
// individual meals. The new layout reaches them via the "All Recipes"
// essential or the recipe sub-list detail view, so the export is unused
// here. Leaving the component in case a future view wants it.
export const RecipeCard: React.FC<{ meal: HomeMeal; onClick: () => void }> = ({ meal, onClick }) => {
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
          <span
            className={cn(
              'w-9 h-9 rounded-full border flex items-center justify-center font-bold text-[12px] tabular-nums shadow-md shadow-black/20',
              scoreBadgeBg(meal.score),
              scoreColor(meal.score),
            )}
          >
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
