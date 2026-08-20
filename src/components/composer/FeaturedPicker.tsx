/**
 * FeaturedPicker — the one surface for attaching a restaurant or a
 * recipe to a post item or a reel.
 *
 * Both composers (AddPostModal, AddReelModal) used to hand-roll their
 * own list rows, which drifted apart: one showed an amber star with the
 * user's private score, the other a bare number, and both fell back to
 * a generic map-pin tile whenever a place had no photo. Neither reads
 * like the rest of the app.
 *
 * What lives here instead:
 *   FeaturedThumb   — the artwork tile: the real photo when there is
 *                     one, otherwise a monogram on a deterministic warm
 *                     tint, so a photo-less row still has identity.
 *   FeaturedRow     — one pickable row (thumb, name, meta line, and an
 *                     add/selected affordance on the right).
 *   FeaturedSummary — the "you picked this" card.
 *   FeaturedPickerOverlay — the whole picking surface: a draggable
 *                     bottom sheet on phones, a centred dialog on
 *                     desktop, with search, grouped results and empty
 *                     states.
 *
 * No score, no star, no map pin — a picker is for choosing a place, not
 * for reading a rating, and scores appear nowhere else in the app as a
 * star.
 */
import React, { useCallback, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChefHat, Check, ChevronLeft, Loader2, Plus, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useBottomSheet } from '../../lib/useBottomSheet';

export type FeaturedKind = 'restaurant' | 'recipe';

export interface FeaturedRestaurant {
  id: string;
  name: string;
  cuisine: string;
  price: string;
  address: string;
  image?: string;
  score?: number;
  /** True for places already in the user's ratings / wishlist / meta —
   *  drives the "Your places" vs "More results" grouping. */
  fromUser?: boolean;
}

export interface FeaturedRecipe {
  id: string;
  title: string;
  prepTime: number;
  cookTime: number;
  servings: number;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  image?: string;
}

/* ── Meta lines ─────────────────────────────────────────────────────── */

/** Addresses arrive as anything from "High St" to a full postal line.
 *  Keep the first two comma-parts (street + city) — enough to tell two
 *  branches apart without swamping the row. */
export function shortAddress(address?: string): string {
  if (!address) return '';
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  return parts.slice(0, 2).join(', ');
}

export function restaurantMetaLine(r: Pick<FeaturedRestaurant, 'cuisine' | 'price' | 'address'>): string {
  return [r.cuisine, r.price, shortAddress(r.address)].filter(Boolean).join(' · ') || 'Restaurant';
}

export function recipeMetaLine(r: Pick<FeaturedRecipe, 'prepTime' | 'cookTime' | 'servings' | 'difficulty'>): string {
  const mins = (r.prepTime ?? 0) + (r.cookTime ?? 0);
  return [
    mins > 0 ? `${mins} min` : '',
    r.servings ? `${r.servings} serving${r.servings === 1 ? '' : 's'}` : '',
    r.difficulty,
  ].filter(Boolean).join(' · ') || 'Recipe';
}

/* ── Thumb ──────────────────────────────────────────────────────────── */

/** Soft monogram tints — warm, low-chroma, readable in both themes. */
const MONOGRAM_TINTS: { bg: string; ink: string }[] = [
  { bg: 'bg-[#f4ece6]', ink: 'text-[#9f3012]' },
  { bg: 'bg-[#eef0e8]', ink: 'text-[#5c6144]' },
  { bg: 'bg-[#f1ece4]', ink: 'text-[#8f6626]' },
  { bg: 'bg-[#eaf0ee]', ink: 'text-[#2e7d5c]' },
  { bg: 'bg-[#f2eaea]', ink: 'text-[#a8392a]' },
  { bg: 'bg-[#ece9f0]', ink: 'text-[#5f4d6b]' },
];

function tintFor(seed: string): { bg: string; ink: string } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return MONOGRAM_TINTS[h % MONOGRAM_TINTS.length];
}

/** First letter that actually renders — skips "The ", punctuation, and
 *  falls back to a chef hat for recipes with an unusable title. */
function monogramFor(label: string): string {
  const cleaned = label.replace(/^(the|le|la|el|a)\s+/i, '').trim();
  const ch = Array.from(cleaned).find((c) => /\p{L}|\p{N}/u.test(c));
  return (ch || label.trim()[0] || '·').toUpperCase();
}

export const FeaturedThumb: React.FC<{
  label: string;
  image?: string;
  kind: FeaturedKind;
  /** Tailwind size classes — defaults to the 44px list size. */
  className?: string;
}> = ({ label, image, kind, className }) => {
  const tint = useMemo(() => tintFor(label || kind), [label, kind]);
  const usable = image && !image.startsWith('data:') ? image : undefined;
  return (
    <span
      className={cn(
        'rounded-[13px] overflow-hidden flex-shrink-0 flex items-center justify-center ring-1 ring-inset ring-on-surface/[0.07]',
        !usable && tint.bg,
        usable && 'bg-on-surface/[0.06]',
        className || 'w-11 h-11',
      )}
    >
      {usable ? (
        <img
          src={usable}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
        />
      ) : kind === 'recipe' && monogramFor(label) === '·' ? (
        <ChefHat size={16} className={tint.ink} />
      ) : (
        <span className={cn('font-serif font-bold text-[16px] leading-none', tint.ink)}>
          {monogramFor(label)}
        </span>
      )}
    </span>
  );
};

/* ── Row ────────────────────────────────────────────────────────────── */

export const FeaturedRow: React.FC<{
  title: string;
  meta: string;
  image?: string;
  kind: FeaturedKind;
  selected?: boolean;
  onClick: () => void;
}> = ({ title, meta, image, kind, selected, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={selected}
    className={cn(
      'group w-full flex items-center gap-3 rounded-2xl p-2 pr-2.5 text-left transition-colors',
      selected
        ? 'bg-primary/[0.07] ring-1 ring-inset ring-primary/25'
        : 'hover:bg-on-surface/[0.045] active:bg-on-surface/[0.07]',
    )}
  >
    <FeaturedThumb label={title} image={image} kind={kind} />
    <span className="flex-1 min-w-0">
      <span className="block text-[14px] font-bold leading-tight truncate">{title}</span>
      <span className="block mt-[3px] text-[11.5px] leading-tight text-on-surface/50 truncate">{meta}</span>
    </span>
    <span
      className={cn(
        'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-colors',
        selected
          ? 'bg-primary text-white'
          : 'bg-on-surface/[0.06] text-on-surface/40 group-hover:bg-primary group-hover:text-white',
      )}
      aria-hidden
    >
      {selected ? <Check size={14} strokeWidth={3} /> : <Plus size={14} strokeWidth={2.6} />}
    </span>
  </button>
);

/* ── Picked summary ─────────────────────────────────────────────────── */

export const FeaturedSummary: React.FC<{
  title: string;
  meta: string;
  image?: string;
  kind: FeaturedKind;
  onChange: () => void;
  onClear?: () => void;
  disabled?: boolean;
}> = ({ title, meta, image, kind, onChange, onClear, disabled }) => (
  <div className="rounded-2xl border-[1.5px] border-primary/25 bg-primary/[0.045] p-2.5">
    {/* The name gets the full width — the actions sit on their own row,
        so a long restaurant name isn't truncated to three words in the
        380px control panel. */}
    <div className="flex items-center gap-3">
      <FeaturedThumb label={title} image={image} kind={kind} className="w-12 h-12" />
      <div className="flex-1 min-w-0">
        <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-[0.12em] text-primary">
          <Check size={9} strokeWidth={3.4} /> Featured
        </span>
        <p className="text-[14px] font-bold leading-tight truncate mt-0.5">{title}</p>
        <p className="text-[11.5px] leading-tight text-on-surface/50 truncate mt-[3px]">{meta}</p>
      </div>
    </div>
    <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-primary/15">
      <button
        type="button"
        onClick={onChange}
        disabled={disabled}
        className="flex-1 h-8 rounded-xl text-[12px] font-bold text-primary hover:bg-primary/[0.09] active:bg-primary/[0.12] transition-colors disabled:opacity-40"
      >
        Change
      </button>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          className="flex-1 h-8 rounded-xl text-[12px] font-bold text-on-surface/55 hover:bg-on-surface/[0.06] active:bg-on-surface/[0.09] transition-colors disabled:opacity-40"
        >
          Remove
        </button>
      )}
    </div>
  </div>
);

/* ── Picker overlay ─────────────────────────────────────────────────── */

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="px-2 pt-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/35">
    {children}
  </p>
);

export const FeaturedPickerOverlay: React.FC<{
  open: boolean;
  kind: FeaturedKind;
  phoneMode: boolean;
  onClose: () => void;
  search: string;
  onSearchChange: (v: string) => void;
  searching?: boolean;
  restaurants: FeaturedRestaurant[];
  recipes: FeaturedRecipe[];
  selectedId?: string | null;
  onPickRestaurant: (r: FeaturedRestaurant) => void;
  onPickRecipe: (r: FeaturedRecipe) => void;
}> = ({
  open, kind, phoneMode, onClose, search, onSearchChange, searching,
  restaurants, recipes, selectedId, onPickRestaurant, onPickRecipe,
}) => {
  // The composer's own backdrop sits underneath this one and closes the
  // whole modal on click, so every close path here has to stop the event
  // before it bubbles — otherwise dismissing the picker also throws away
  // the post/reel the user was building.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = useCallback(() => onCloseRef.current(), []);
  // Stable identity matters: Framer Motion treats a new drag-props object
  // as a controller reset, which cancels an in-flight dismiss gesture.
  const { dragProps, startDrag } = useBottomSheet(open && phoneMode, close);

  const isRestaurant = kind === 'restaurant';
  const query = search.trim();
  const mine = isRestaurant ? restaurants.filter((r) => r.fromUser !== false) : [];
  const found = isRestaurant ? restaurants.filter((r) => r.fromUser === false) : [];
  const empty = isRestaurant ? restaurants.length === 0 : recipes.length === 0;

  const emptyCopy = isRestaurant
    ? searching
      ? 'Searching…'
      : query.length === 0
        ? 'Search any restaurant by name, or pick one you have already saved.'
        : `Nothing matches “${query}”. Try a shorter name.`
    : query.length === 0
      ? 'No home cooking entries yet — add one in the Pantry and it will show up here.'
      : `Nothing matches “${query}”.`;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className={cn(
            'absolute inset-0 z-[120] bg-black/55 backdrop-blur-[3px] flex justify-center',
            phoneMode ? 'items-end' : 'items-center p-6',
          )}
          // Native keyboard: shrink the box the sheet is pinned to so the
          // search field and the first results stay above the keys.
          style={phoneMode ? { paddingBottom: 'var(--kb-height, 0px)' } : undefined}
          onClick={(e) => { e.stopPropagation(); close(); }}
        >
          <motion.div
            initial={phoneMode ? { y: '100%' } : { opacity: 0, scale: 0.97, y: 10 }}
            animate={phoneMode ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={phoneMode ? { y: '100%' } : { opacity: 0, scale: 0.98, y: 6 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            {...(phoneMode ? dragProps : {})}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'bg-surface text-on-surface flex flex-col overflow-hidden',
              phoneMode
                ? 'w-full rounded-t-[26px] shadow-[0_-12px_40px_rgba(0,0,0,0.35)]'
                : 'w-[min(520px,100%)] max-h-[min(620px,100%)] rounded-[22px] shadow-[0_28px_80px_rgba(0,0,0,0.45)]',
            )}
            style={phoneMode ? { height: 'min(78%, 620px)', maxHeight: '100%' } : undefined}
          >
            {/* Grab handle — phone only, and the only drag origin so the
                list underneath still scrolls. */}
            {phoneMode && (
              <div
                onPointerDown={startDrag}
                className="flex-shrink-0 pt-2.5 pb-1 flex justify-center touch-none cursor-grab active:cursor-grabbing"
                aria-label="Drag to dismiss"
              >
                <div className="w-9 h-1 rounded-full bg-on-surface/20" />
              </div>
            )}

            {/* Header — a back arrow on phones (this sheet sits on top of
                a step, so back is the honest affordance), an X on
                desktop where the dialog is a true modal. */}
            <div className="px-3.5 pt-2.5 pb-3 flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); close(); }}
                className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 active:bg-on-surface/[0.13] flex items-center justify-center text-on-surface/70 flex-shrink-0 transition-colors"
                aria-label={phoneMode ? 'Back to the composer' : 'Close picker'}
              >
                {phoneMode ? <ChevronLeft size={17} strokeWidth={2.4} /> : <X size={16} />}
              </button>
              <div className="flex-1 min-w-0 text-center">
                <h3 className="font-serif font-bold text-[16px] leading-none truncate">
                  {isRestaurant ? 'Feature a restaurant' : 'Feature a recipe'}
                </h3>
              </div>
              {/* Balances the back button so the title stays centred. */}
              <span className="w-9 h-9 flex-shrink-0" aria-hidden />
            </div>

            {/* Search */}
            <div className="px-4 pb-3 flex-shrink-0">
              <div className="flex items-center gap-2 rounded-full bg-on-surface/[0.045] border border-on-surface/[0.07] focus-within:border-primary/40 focus-within:bg-white px-4 h-11 transition-colors">
                <Search size={15} className="text-on-surface/40 flex-shrink-0" />
                <input
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder={isRestaurant ? 'Search any restaurant…' : 'Search your home cooking…'}
                  className="flex-1 min-w-0 bg-transparent text-sm placeholder:text-on-surface/35 focus:outline-none"
                />
                {searching && <Loader2 size={14} className="animate-spin text-on-surface/40 flex-shrink-0" />}
                {!searching && search.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onSearchChange('')}
                    className="w-6 h-6 rounded-full bg-on-surface/[0.08] hover:bg-on-surface/[0.15] flex items-center justify-center text-on-surface/55 flex-shrink-0"
                    aria-label="Clear search"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>

            {/* Results */}
            <div
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px), var(--kb-height, 0px))' }}
            >
              {empty ? (
                <div className="h-full flex flex-col items-center justify-center text-center px-8 py-10">
                  <div className="w-12 h-12 rounded-2xl bg-on-surface/[0.05] flex items-center justify-center text-on-surface/30">
                    {searching ? <Loader2 size={18} className="animate-spin" /> : isRestaurant ? <Search size={18} /> : <ChefHat size={18} />}
                  </div>
                  <p className="text-[12.5px] text-on-surface/45 mt-3 leading-relaxed max-w-[280px]">
                    {emptyCopy}
                  </p>
                </div>
              ) : isRestaurant ? (
                <>
                  {mine.length > 0 && (
                    <>
                      {found.length > 0 && <SectionLabel>Your places</SectionLabel>}
                      <ul className="space-y-0.5">
                        {mine.map((r) => (
                          <li key={r.id}>
                            <FeaturedRow
                              title={r.name}
                              meta={restaurantMetaLine(r)}
                              image={r.image}
                              kind="restaurant"
                              selected={selectedId === r.id}
                              onClick={() => onPickRestaurant(r)}
                            />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {found.length > 0 && (
                    <>
                      <SectionLabel>{mine.length > 0 ? 'More results' : 'Search results'}</SectionLabel>
                      <ul className="space-y-0.5">
                        {found.map((r) => (
                          <li key={r.id}>
                            <FeaturedRow
                              title={r.name}
                              meta={restaurantMetaLine(r)}
                              image={r.image}
                              kind="restaurant"
                              selected={selectedId === r.id}
                              onClick={() => onPickRestaurant(r)}
                            />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              ) : (
                <ul className="space-y-0.5 pt-1">
                  {recipes.map((r) => (
                    <li key={r.id}>
                      <FeaturedRow
                        title={r.title}
                        meta={recipeMetaLine(r)}
                        image={r.image}
                        kind="recipe"
                        selected={selectedId === r.id}
                        onClick={() => onPickRecipe(r)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
