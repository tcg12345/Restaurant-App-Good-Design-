import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { Bookmark, ChefHat, ChevronRight, Plus, UtensilsCrossed } from 'lucide-react';
import { cn } from '../lib/utils';
import { useHeaderFade } from '../lib/useHeaderFade';
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
// palette. Hexes live in index.css (@theme --color-tile-*) so all tile
// colors have one home; consumed via var() in inline gradients here.
const LIST_PALETTE: Array<{ from: string; to: string }> = [
  { from: 'var(--color-tile-blue)', to: 'var(--color-tile-blue-deep)' },
  { from: 'var(--color-tile-purple)', to: 'var(--color-tile-purple-deep)' },
  { from: 'var(--color-tile-green)', to: 'var(--color-tile-green-deep)' },
  { from: 'var(--color-tile-rust)', to: 'var(--color-tile-rust-deep)' },
  { from: 'var(--color-tile-gold)', to: 'var(--color-tile-gold-deep)' },
  { from: 'var(--color-tile-tan)', to: 'var(--color-tile-tan-deep)' },
  { from: 'var(--color-tile-teal)', to: 'var(--color-tile-teal-deep)' },
  { from: 'var(--color-tile-brick)', to: 'var(--color-tile-brick-deep)' },
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
  const { darkMode, phoneMode } = useSettings();
  // The in-flow tab track dissolves as the page scrolls and hands off to
  // a compact glass capsule pinned at the top, so switching tabs never
  // means scrolling back up first. The distance is explicit: the track's
  // own height would swap the two within 40px of scroll, which reads as
  // a flicker — 80 puts the hand-off just after the track clears the top
  // of the viewport.
  const fade = useHeaderFade({ enabled: phoneMode, windowScroll: true, fadeDist: 80 });
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
      {/* ── Condensed selector ──
          Zero-height sticky rail: it pins to the top of the viewport
          without taking a row of layout, so the capsule floats over the
          cards it replaces the track for. */}
      {phoneMode && (
        <div className="sticky top-0 z-30 h-0">
          <motion.div
            style={fade.condensedStyle}
            className="absolute inset-x-0 top-0 flex justify-center pt-safe-3 pb-2 -mx-3 px-3"
          >
            {/* Soft scrim: cards dissolve into the top edge instead of
                cutting across it. The capsule stays glass; the strip
                behind it doesn't have to. */}
            <div
              className="absolute inset-x-0 top-0 -bottom-3 bg-gradient-to-b from-surface via-surface/70 to-transparent pointer-events-none"
              aria-hidden
            />
            <div
              className={cn(
                'relative inline-flex items-center gap-0.5 rounded-full p-[3px] backdrop-blur-2xl',
                darkMode
                  ? 'bg-white/[0.1] ring-1 ring-white/[0.14] shadow-[0_10px_30px_-14px_rgba(0,0,0,0.8)]'
                  : 'bg-surface/85 ring-1 ring-on-surface/[0.09] shadow-[0_10px_30px_-14px_rgba(0,0,0,0.45)]',
              )}
            >
              {(['restaurants', 'recipes'] as PantryTab[]).map((t) => {
                const Icon = t === 'restaurants' ? UtensilsCrossed : ChefHat;
                const active = tab === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onTabChange(t)}
                    aria-pressed={active}
                    className={cn(
                      'inline-flex items-center gap-1.5 h-8 pl-3 pr-3.5 rounded-full text-[12.5px] font-bold transition-colors',
                      active
                        ? 'bg-primary text-white shadow-[0_2px_8px_-2px_rgba(159,48,18,0.55)]'
                        : darkMode
                          ? 'text-white/55 active:text-white/80'
                          : 'text-on-surface/50 active:text-on-surface/80',
                    )}
                  >
                    <Icon size={13} strokeWidth={2.4} className="flex-shrink-0" />
                    {t === 'restaurants' ? 'Restaurants' : 'Recipes'}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </div>
      )}

      {/* ── Tab pill ── */}
      <motion.div
        ref={fade.headerRef}
        style={phoneMode ? fade.headerStyle : undefined}
        className={cn('inline-flex w-full rounded-full p-1', darkMode ? 'bg-white/[0.04]' : 'bg-on-surface/[0.06]')}
      >
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
      </motion.div>

      {tab === 'restaurants' ? (
        <>
          {/* Recommendations entry — a quiet hairline row, deliberately
              subordinate to the card grid below it. */}
          {onOpenRecommendations && (
            <button
              type="button"
              onClick={onOpenRecommendations}
              className="mt-5 flex w-full items-center justify-between rounded-2xl border border-on-surface/[0.08] px-4 py-2.5 text-left transition-colors active:bg-on-surface/[0.04]"
            >
              <span className="text-[13px] font-semibold text-on-surface/65">Recommended for you</span>
              <ChevronRight size={15} className="flex-shrink-0 text-on-surface/35" />
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
      className="relative aspect-square rounded-3xl overflow-hidden text-left p-4 flex flex-col justify-between bg-gradient-to-br from-tile-rated to-tile-rated-deep active:scale-[0.98] transition-transform"
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
                  'w-9 h-9 rounded-full border ring-2 ring-tile-rated flex items-center justify-center font-bold text-[12px] tabular-nums',
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
    className="relative aspect-square rounded-3xl overflow-hidden text-left p-4 flex flex-col justify-between bg-gradient-to-br from-tile-wish to-tile-wish-deep active:scale-[0.98] transition-transform"
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
      className="relative aspect-square rounded-3xl overflow-hidden text-left p-4 flex flex-col justify-between bg-gradient-to-br from-tile-recipes to-tile-recipes-deep active:scale-[0.98] transition-transform"
    >
      {cover && (
        <>
          <img
            src={cover}
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-50"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-tile-recipes-deep/95 via-tile-recipes-deep/55 to-tile-recipes-deep/30" />
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
    className="relative aspect-square rounded-3xl overflow-hidden text-left p-4 flex flex-col justify-between bg-gradient-to-br from-tile-cook to-tile-cook-deep active:scale-[0.98] transition-transform"
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


function formatDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
