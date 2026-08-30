import React, { useMemo } from 'react';
import { Bookmark, ChefHat, ChevronRight, Clock, Plus, Sparkles, Star, UtensilsCrossed } from 'lucide-react';
import { cn } from '../lib/utils';
import { useGlassSegments } from '../lib/glass-buttons';
import { scoreTintStyle } from '../lib/score';
import { DEFAULT_WANT_TO_COOK_ID, type CustomList, type HomeMeal } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { motion, useReducedMotion } from 'motion/react';

/**
 * Pantry landing — used on phone and desktop. Two top-level tabs:
 *
 *   • Restaurants (default) — Wishlist + "Your rankings" (rated) essentials,
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
  /** Opens the ranked recommendations browser. Renders the "For you"
   *  banner on the Restaurants tab when provided. */
  onOpenRecommendations?: () => void;
  /** The user's most-rated cuisines, for the "Your cuisines" rail. */
  topCuisines?: Array<{ name: string; count: number; avg: number }>;
  /** Open the rated list pre-filtered to one cuisine. */
  onOpenCuisine?: (cuisine: string) => void;
  // Recipe tab handlers
  onOpenAllRecipes: () => void;
  onCreateRecipeList: () => void;
  /** Open one recipe directly (the "Quick tonight" rail). */
  onOpenMeal?: (meal: HomeMeal) => void;
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
  topCuisines,
  onOpenCuisine,
  onOpenAllRecipes,
  onCreateRecipeList,
  onOpenMeal,
}) => {
  const { darkMode, phoneMode } = useSettings();
  const reduceMotion = useReducedMotion();
  // Native Liquid Glass over both states of the tab selector. The in-flow
  // track and the condensed capsule register as segmented glass controls —
  // one capsule of real material with a flat selection pill sliding on it —
  // and this component's markup becomes the invisible layout + the fallback
  // for everywhere the material doesn't exist. The scroll hand-off between
  // the two keeps working exactly as before: the native mirrors ride each
  // wrapper's animated opacity.
  const segItems = (['restaurants', 'recipes'] as PantryTab[]).map((t) => ({
    id: t,
    symbol: '',
    title: t === 'restaurants' ? 'Restaurants' : 'Recipes',
    label: t === 'restaurants' ? 'Restaurants' : 'Recipes',
    tint: 'label' as const,
    active: tab === t,
    onClick: () => onTabChange(t),
  }));
  const trackSeg = useGlassSegments({ id: 'pantry-tabs', items: segItems });
  const miniSeg = useGlassSegments({ id: 'pantry-tabs-mini', items: segItems });
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
    // No `pt-safe-4` on phone: the sticky rail below applies the safe area
    // itself, and having both meant the capsule sat a whole inset lower than
    // the notch while the page was at rest — the band of white space. The
    // rail is zero-height, so the spacer after it is what actually reserves
    // the room.
    <div className={cn('pb-32', !phoneMode && 'pt-safe-4')}>
      {/* ── Tab selector ──
          One control in one state: the compact capsule, sticky at the top.
          It used to be two — a full-width in-flow track that dissolved into
          this capsule as you scrolled. The small one was always the better
          of the two, so it is the only one now, and it simply stays.

          A zero-height sticky rail, exactly like the condensed overlay it
          replaces: the capsule floats over the page rather than occupying a
          row, which is what keeps a second band of safe-area padding from
          stacking on the page's own. The spacer below the rail is what
          gives the first cards their initial clearance. */}
      {phoneMode ? (
        <>
        <div className="sticky top-0 z-30 h-0 -mx-3">
          <div className="absolute inset-x-0 top-0 px-3 pt-safe-3 pb-2 flex justify-center">
          {/* Soft scrim: cards dissolve into the top edge instead of cutting
              across it. The capsule stays glass; the strip behind it does
              not have to be. */}
          <div
            className="absolute inset-x-0 top-0 -bottom-3 bg-gradient-to-b from-surface via-surface/70 to-transparent pointer-events-none"
            aria-hidden
          />
          <div
            ref={miniSeg.ref}
            data-tour="pantry-tabs"
            className={cn(
              'relative inline-flex items-center gap-0.5 rounded-full p-[3px]',
              !miniSeg.active && 'glass-control',
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
                  aria-hidden={miniSeg.active || undefined}
                  tabIndex={miniSeg.active ? -1 : undefined}
                  className={cn(
                    // The box is the room the page reserves for the native
                    // control, so its height is the control's, not the text's.
                    'inline-flex items-center gap-1.5 h-[44px] pl-3 pr-3.5 rounded-full text-[13.5px] font-bold transition-colors',
                    // Layout only while the native control draws on top.
                    miniSeg.active ? 'opacity-0'
                      : active
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
          </div>
        </div>
        {/* Clearance for the floating capsule: the safe area it sits under,
            its own height, and the gap beneath it — no more. */}
        <div aria-hidden style={{ height: 'calc(max(0.75rem, env(safe-area-inset-top, 0px)) + 58px)' }} />
        </>
      ) : (
        /* Desktop keeps the full-width track: there is no scroll hand-off to
           simplify there, and a small centred capsule in a wide column reads
           as lost rather than tidy. */
        <div
          ref={trackSeg.ref}
          className={cn(
            'inline-flex w-full rounded-full p-1',
            !trackSeg.active && (darkMode ? 'bg-white/[0.04]' : 'bg-on-surface/[0.06]'),
          )}
        >
          {(['restaurants', 'recipes'] as PantryTab[]).map((t) => (
            <button
              key={t}
              onClick={() => onTabChange(t)}
              aria-hidden={trackSeg.active || undefined}
              tabIndex={trackSeg.active ? -1 : undefined}
              className={cn(
                'flex-1 h-[42px] rounded-full text-sm font-semibold transition-all',
                trackSeg.active ? 'opacity-0'
                  : tab === t
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
      )}

      {/* Keyed on the tab, so switching mounts a fresh panel that fades in
          where the old one was. No exit animation on purpose: a tab is a
          high-frequency control, and waiting out an exit before the entrance
          doubles the time before the new content is simply there. The x offset
          matches the direction the selector's lens just travelled, so the two
          read as one movement instead of two. */}
      <motion.div
        key={tab}
        initial={{ opacity: 0, x: reduceMotion ? 0 : (tab === 'restaurants' ? -10 : 10) }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
      {tab === 'restaurants' ? (
        <RestaurantsTab
          lists={restaurantLists}
          ratedCount={ratedCount}
          ratedTopScores={ratedTopScores}
          wishlistCount={wishlistCount}
          topCuisines={topCuisines}
          onOpenList={onOpenList}
          onOpenWishlist={onOpenWishlist}
          onOpenRated={onOpenRated}
          onOpenCuisine={onOpenCuisine}
          onCreateRestaurantList={onCreateRestaurantList}
          onOpenRecommendations={onOpenRecommendations}
        />
      ) : (
        <RecipesTab
          lists={recipeLists}
          homeMeals={homeMeals}
          onOpenAllRecipes={onOpenAllRecipes}
          onOpenList={onOpenList}
          onCreateRecipeList={onCreateRecipeList}
          onOpenMeal={onOpenMeal}
        />
      )}
      </motion.div>
    </div>
  );
};

/* ─────────────── Shared furniture ───────────────
   The landing stopped being a grid of gradient squares: every list is a
   ROW that says what it holds, sections divide with hairlines, and the
   serif carries the titles — the same editorial language as the rest of
   the redesign. */

const SectionHead: React.FC<{ title: string; action?: { label: string; onClick: () => void } }> = ({ title, action }) => (
  <div className="flex items-center justify-between">
    <h2 className="font-serif text-[19px] font-bold tracking-[-0.02em] text-on-surface">{title}</h2>
    {action && (
      <button
        type="button"
        onClick={action.onClick}
        className="flex items-center gap-1 rounded-full bg-on-surface/[0.05] px-3 h-8 text-[12px] font-bold text-on-surface/70 active:bg-on-surface/[0.1] transition-colors"
      >
        <Plus size={12} strokeWidth={2.6} />
        {action.label}
      </button>
    )}
  </div>
);

const Rule: React.FC = () => <div className="mt-6 border-t border-on-surface/[0.1]" aria-hidden />;

/** A landing row: leading visual, title + fact line, trailing slot, chevron. */
const HomeRow: React.FC<{
  onClick: () => void;
  leading: React.ReactNode;
  title: string;
  meta: string;
  trailing?: React.ReactNode;
  first?: boolean;
}> = ({ onClick, leading, title, meta, trailing, first }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'w-full flex items-center gap-3.5 py-[13px] text-left active:opacity-60 transition-opacity',
      !first && 'border-t border-on-surface/[0.06]',
    )}
  >
    {leading}
    <span className="flex-1 min-w-0 block">
      <span className="block font-serif text-[16.5px] font-bold leading-[1.15] tracking-[-0.02em] text-on-surface truncate">{title}</span>
      <span className="block mt-[5px] text-[12.5px] leading-tight text-on-surface/50 truncate">{meta}</span>
    </span>
    {trailing}
    <ChevronRight size={15} className="flex-shrink-0 text-on-surface/25" />
  </button>
);

/* ─────────────── Restaurants tab ─────────────── */

const RestaurantsTab: React.FC<{
  lists: CustomList[];
  ratedCount: number;
  ratedTopScores: number[];
  wishlistCount: number;
  topCuisines?: Array<{ name: string; count: number; avg: number }>;
  onOpenList: (l: CustomList) => void;
  onOpenWishlist: () => void;
  onOpenRated: () => void;
  onOpenCuisine?: (cuisine: string) => void;
  onCreateRestaurantList: () => void;
  onOpenRecommendations?: () => void;
}> = ({ lists, ratedCount, ratedTopScores, wishlistCount, topCuisines, onOpenList, onOpenWishlist, onOpenRated, onOpenCuisine, onCreateRestaurantList, onOpenRecommendations }) => {
  const cuisines = (topCuisines || []).filter((c) => c.count >= 2).slice(0, 6);
  return (
    <>
      {/* For you — the one accent moment on the page. */}
      {onOpenRecommendations && (
        <button
          type="button"
          onClick={onOpenRecommendations}
          className="mt-5 w-full flex items-center gap-3 rounded-2xl bg-primary/[0.08] px-3.5 py-3 text-left active:bg-primary/[0.14] transition-colors"
        >
          <span className="flex-none w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center">
            <Sparkles size={14} strokeWidth={2.2} />
          </span>
          <span className="flex-1 min-w-0 block">
            <span className="block text-[13.5px] font-bold tracking-[-0.01em] text-primary">Recommended for you</span>
            <span className="block mt-[3px] text-[11.5px] text-on-surface/55 truncate">
              {ratedCount > 0 ? `Ranked from your ${ratedCount} rating${ratedCount === 1 ? '' : 's'}` : 'Places picked for your taste'}
            </span>
          </span>
          <ChevronRight size={14} className="flex-shrink-0 text-primary/70" />
        </button>
      )}

      <div className="mt-6">
        <SectionHead title="Essentials" />
        <div className="mt-1">
          <HomeRow
            first
            onClick={onOpenRated}
            leading={
              <span className="flex-none w-11 h-11 rounded-full bg-primary/[0.1] text-primary flex items-center justify-center">
                <Star size={18} strokeWidth={2.1} />
              </span>
            }
            title="Your rankings"
            meta={ratedCount > 0 ? `${ratedCount} place${ratedCount === 1 ? '' : 's'} rated` : 'Rate your first place'}
            trailing={ratedTopScores.length > 0 ? (
              <span className="flex-none flex items-center">
                {ratedTopScores.slice(0, 3).map((s, i) => {
                  const t = scoreTintStyle(s);
                  return (
                    <span
                      key={i}
                      className="flex items-center justify-center rounded-full font-serif font-bold tabular-nums border-[1.5px] border-surface"
                      style={{ width: 32, height: 32, fontSize: 10.5, marginLeft: i === 0 ? 0 : -8, background: t.background, color: t.color, boxShadow: `inset 0 0 0 1px ${t.ring}` }}
                    >
                      {s.toFixed(1) === '10.0' ? '10' : s.toFixed(1)}
                    </span>
                  );
                })}
              </span>
            ) : undefined}
          />
          <HomeRow
            onClick={onOpenWishlist}
            leading={
              <span className="flex-none w-11 h-11 rounded-full bg-tile-wish/[0.16] text-tile-wish-deep flex items-center justify-center">
                <Bookmark size={17} strokeWidth={2.1} />
              </span>
            }
            title="Want to try"
            meta={wishlistCount > 0 ? `${wishlistCount} saved for later` : 'Nothing saved yet'}
            trailing={wishlistCount > 0 ? (
              <span className="flex-none rounded-full bg-on-surface/[0.06] px-2.5 py-1.5 text-[11.5px] font-bold text-on-surface/65 tabular-nums">{wishlistCount}</span>
            ) : undefined}
          />
        </div>
      </div>

      {/* Your cuisines — the taste profile the ratings already contain. */}
      {cuisines.length >= 2 && onOpenCuisine && (
        <>
          <Rule />
          <div className="mt-5">
            <SectionHead title="Your cuisines" />
            <div className="mt-3 flex gap-2.5 overflow-x-auto scrollbar-hide -mx-4 px-4 scroll-px-4 snap-x">
              {cuisines.map((c) => {
                const t = scoreTintStyle(c.avg);
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => onOpenCuisine(c.name)}
                    className="flex-none snap-start flex items-center gap-2.5 rounded-2xl border border-on-surface/[0.08] pl-2 pr-3.5 py-2 active:bg-on-surface/[0.04] transition-colors"
                  >
                    <span
                      className="flex items-center justify-center rounded-full font-serif font-bold tabular-nums"
                      style={{ width: 34, height: 34, fontSize: 11.5, background: t.background, color: t.color, border: `1.5px solid ${t.ring}` }}
                    >
                      {c.avg.toFixed(1)}
                    </span>
                    <span className="text-left">
                      <span className="block text-[13px] font-bold tracking-[-0.01em] text-on-surface whitespace-nowrap">{c.name}</span>
                      <span className="block mt-[1px] text-[10.5px] text-on-surface/45">{c.count} places</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      <Rule />
      <div className="mt-5">
        <SectionHead title="Collections" action={{ label: 'New', onClick: onCreateRestaurantList }} />
        <div className="mt-1">
          {lists.length === 0 ? (
            <EmptyLine text="Group places into lists — date spots, pizza tour, home town." action="Create a list" onAction={onCreateRestaurantList} />
          ) : (
            lists.map((list, i) => (
              <HomeRow
                key={list.id}
                first={i === 0}
                onClick={() => onOpenList(list)}
                leading={<ListTile id={list.id} emoji={list.emoji} />}
                title={list.name}
                meta={(() => { const n = list.restaurantIds.length + (list.wishlistIds?.length || 0); return `${n} place${n === 1 ? '' : 's'}`; })()}
              />
            ))
          )}
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
  onOpenMeal?: (meal: HomeMeal) => void;
}> = ({ lists, homeMeals, onOpenAllRecipes, onOpenList, onCreateRecipeList, onOpenMeal }) => {
  const sortedMeals = useMemo(
    () => [...homeMeals].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [homeMeals],
  );
  const wantToCook = useMemo(
    () => lists.find((l) => l.id === DEFAULT_WANT_TO_COOK_ID) || null,
    [lists],
  );
  const otherRecipeLists = useMemo(
    () => lists.filter((l) => l.id !== DEFAULT_WANT_TO_COOK_ID),
    [lists],
  );
  // Under-35-minute recipes, newest first — the weeknight answer.
  const quickMeals = useMemo(
    () => sortedMeals.filter((m) => {
      const total = (m.prepTime || 0) + (m.cookTime || 0);
      return total > 0 && total <= 35;
    }).slice(0, 8),
    [sortedMeals],
  );
  const latestCover = sortedMeals[0]?.coverPhoto || sortedMeals[0]?.photos?.[0]?.url || '';

  return (
    <>
      <div className="mt-6">
        <SectionHead title="Essentials" />
        <div className="mt-1">
          <HomeRow
            first
            onClick={onOpenAllRecipes}
            leading={latestCover ? (
              <span className="flex-none w-11 h-11 rounded-[14px] overflow-hidden bg-tile-recipes/20">
                <img src={latestCover} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </span>
            ) : (
              <span className="flex-none w-11 h-11 rounded-full bg-tile-recipes/[0.16] text-tile-recipes-deep flex items-center justify-center">
                <ChefHat size={18} strokeWidth={2.1} />
              </span>
            )}
            title="Cookbook"
            meta={homeMeals.length > 0 ? `${homeMeals.length} recipe${homeMeals.length === 1 ? '' : 's'}` : 'Log your first recipe'}
          />
          {wantToCook && (
            <HomeRow
              onClick={() => onOpenList(wantToCook)}
              leading={
                <span className="flex-none w-11 h-11 rounded-full bg-tile-cook/[0.18] text-tile-cook-deep flex items-center justify-center">
                  <Bookmark size={17} strokeWidth={2.1} />
                </span>
              }
              title="Want to cook"
              meta={(() => { const n = wantToCook.recipes?.length || 0; return n > 0 ? `${n} saved` : 'Nothing saved yet'; })()}
              trailing={(wantToCook.recipes?.length || 0) > 0 ? (
                <span className="flex-none rounded-full bg-on-surface/[0.06] px-2.5 py-1.5 text-[11.5px] font-bold text-on-surface/65 tabular-nums">{wantToCook.recipes?.length}</span>
              ) : undefined}
            />
          )}
        </div>
      </div>

      {/* Quick tonight — recipes that fit a weeknight. */}
      {quickMeals.length >= 2 && onOpenMeal && (
        <>
          <Rule />
          <div className="mt-5">
            <SectionHead title="Quick tonight" />
            <div className="mt-3 flex gap-3 overflow-x-auto scrollbar-hide -mx-4 px-4 scroll-px-4 snap-x">
              {quickMeals.map((meal) => {
                const cover = meal.coverPhoto || meal.photos?.[0]?.url || '';
                const total = (meal.prepTime || 0) + (meal.cookTime || 0);
                return (
                  <button
                    key={meal.id}
                    type="button"
                    onClick={() => onOpenMeal(meal)}
                    className="flex-none snap-start w-[132px] text-left active:opacity-70 transition-opacity"
                  >
                    <span className="block h-[88px] rounded-2xl overflow-hidden bg-tile-recipes/[0.14]">
                      {cover ? (
                        <img src={cover} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="w-full h-full flex items-center justify-center text-tile-recipes-deep/50">
                          <ChefHat size={22} />
                        </span>
                      )}
                    </span>
                    <span className="mt-2 block font-serif text-[13.5px] font-bold leading-[1.2] tracking-[-0.01em] text-on-surface line-clamp-2">{meal.name || 'Untitled'}</span>
                    <span className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-on-surface/45">
                      <Clock size={10} strokeWidth={2.4} />
                      {formatDuration(total)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      <Rule />
      <div className="mt-5">
        <SectionHead title="Recipe lists" action={{ label: 'New', onClick: onCreateRecipeList }} />
        <div className="mt-1">
          {otherRecipeLists.length === 0 ? (
            <EmptyLine text="Group recipes into lists — weeknight rotation, baking, holiday table." action="Create a list" onAction={onCreateRecipeList} />
          ) : (
            otherRecipeLists.map((list, i) => (
              <HomeRow
                key={list.id}
                first={i === 0}
                onClick={() => onOpenList(list)}
                leading={<ListTile id={list.id} emoji={list.emoji} />}
                title={list.name}
                meta={(() => { const n = list.recipes?.length || 0; return `${n} recipe${n === 1 ? '' : 's'}`; })()}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
};

/* ─────────────── Bits ─────────────── */

/** A list's small identity tile — the old grid's gradient, shrunk to a
 *  44pt square with the emoji as the mark. */
const ListTile: React.FC<{ id: string; emoji?: string }> = ({ id, emoji }) => {
  const color = colorForId(id);
  return (
    <span
      className="flex-none w-11 h-11 rounded-[14px] flex items-center justify-center text-[19px]"
      style={{ backgroundImage: `linear-gradient(135deg, ${color.from}, ${color.to})` }}
    >
      {emoji || '•'}
    </span>
  );
};

const EmptyLine: React.FC<{ text: string; action: string; onAction: () => void }> = ({ text, action, onAction }) => (
  <div className="py-4">
    <p className="text-[13px] leading-relaxed text-on-surface/50 max-w-[280px]">{text}</p>
    <button
      type="button"
      onClick={onAction}
      className="mt-3 rounded-full border border-on-surface/[0.16] px-4 h-9 text-[12.5px] font-bold text-on-surface active:bg-on-surface/[0.05] transition-colors"
    >
      {action}
    </button>
  </div>
);

function formatDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
