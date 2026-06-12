/**
 * Shared helpers + components for rendering the editorial home meal / recipe
 * detail layout. Used by both the Pantry (author's own recipes) and the new
 * MealRecipePage (friends' public recipes opened from the Explore feed).
 *
 * Kept display-only: no helper here writes back to storage or mutates a
 * HomeMeal. Servings scaling, checkbox state, and step timers are all local
 * UI concerns and do NOT change the user's saved data.
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, X, ChevronLeft, ChevronRight, Check, Minus, Plus, Users, Gauge, type LucideIcon } from 'lucide-react';
import { cn } from './utils';
import { useRecipes } from '../contexts/RecipesContext';

/** Formats a minute total as a short "X hr Y min" string. */
export const formatDuration = (minutes: number): string => {
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (remMinutes === 0) return `${hours} hr`;
  return `${hours} hr ${remMinutes} min`;
};

/** Compact duration for tight stat cells ("2h 45m" / "45m" / "1h"). */
export const formatDurationCompact = (minutes: number): string => {
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (remMinutes === 0) return `${hours}h`;
  return `${hours}h ${remMinutes}m`;
};

/**
 * Canonical cover photo URL for a home meal. Always prefer the explicit
 * coverPhoto, fall back to the first uploaded photo, then empty string.
 * Used by every card / hero / page header so we don't accidentally show a
 * different image in different places for the same recipe.
 */
export const getMealCoverUrl = (
  meal: { coverPhoto?: string; photos?: { url: string }[] } | null | undefined,
): string => {
  if (!meal) return '';
  if (meal.coverPhoto) return meal.coverPhoto;
  return meal.photos?.[0]?.url || '';
};

/**
 * Parses an ingredient amount string ("2", "1/2", "1 1/2", "0.5") into a
 * number. Returns null when the string isn't a recognisable quantity (e.g.
 * "a pinch"); callers fall back to leaving the original string alone.
 */
export const parseQuantity = (str: string): number | null => {
  const trimmed = str.trim();
  if (!trimmed) return null;
  const mixed = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const d = parseInt(mixed[3], 10);
    return d ? parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / d : null;
  }
  const frac = trimmed.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const d = parseInt(frac[2], 10);
    return d ? parseInt(frac[1], 10) / d : null;
  }
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return parseFloat(trimmed);
  return null;
};

/** Converts a decimal back to a cooking-friendly fraction ("1/2", "1 1/2"). */
export const formatQuantity = (value: number): string => {
  if (!Number.isFinite(value) || value < 0) return '';
  if (value === 0) return '0';
  const whole = Math.floor(value);
  const frac = value - whole;
  if (frac < 0.02) return String(whole);
  const candidates: [number, string][] = [
    [1 / 8, '1/8'], [1 / 6, '1/6'], [1 / 5, '1/5'], [1 / 4, '1/4'], [1 / 3, '1/3'],
    [3 / 8, '3/8'], [2 / 5, '2/5'], [1 / 2, '1/2'], [3 / 5, '3/5'], [5 / 8, '5/8'],
    [2 / 3, '2/3'], [3 / 4, '3/4'], [4 / 5, '4/5'], [5 / 6, '5/6'], [7 / 8, '7/8'],
  ];
  let best = candidates[0];
  let bestDiff = Math.abs(frac - best[0]);
  for (const c of candidates) {
    const d = Math.abs(frac - c[0]);
    if (d < bestDiff) { best = c; bestDiff = d; }
  }
  if (Math.abs(1 - frac) < bestDiff) return String(whole + 1);
  if (whole === 0) return best[1];
  return `${whole} ${best[1]}`;
};

/**
 * Scales an ingredient amount string by a ratio. Non-numeric amounts are
 * passed through unchanged so values like "pinch" survive.
 */
export const scaleQuantity = (raw: string, ratio: number): string => {
  const parsed = parseQuantity(raw);
  if (parsed === null) return raw;
  return formatQuantity(parsed * ratio);
};

/**
 * Finds the first time reference in a direction step and returns the total
 * minutes. Used for surfacing an inline timer button next to that step.
 */
export const extractStepMinutes = (text: string): number | null => {
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i);
  const minMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/i);
  const secMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i);
  let total = 0;
  let matched = false;
  if (hourMatch) { total += parseFloat(hourMatch[1]) * 60; matched = true; }
  if (minMatch) { total += parseFloat(minMatch[1]); matched = true; }
  if (secMatch) { total += parseFloat(secMatch[1]) / 60; matched = true; }
  if (!matched) return null;
  const minutes = Math.max(1, Math.round(total));
  return minutes > 0 ? minutes : null;
};

/**
 * Inline timer shown next to a direction step. Click to start → counts down
 * and flashes when it hits zero. Click again to reset.
 */
export const StepTimer: React.FC<{ minutes: number }> = ({ minutes }) => {
  const totalSeconds = minutes * 60;
  const [remaining, setRemaining] = useState(totalSeconds);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!running) return;
    if (remaining <= 0) {
      setRunning(false);
      setDone(true);
      return;
    }
    const id = window.setTimeout(() => setRemaining((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [running, remaining]);

  const mm = Math.floor(Math.max(0, remaining) / 60);
  const ss = Math.max(0, remaining) % 60;

  const onClick = () => {
    if (done) { setRemaining(totalSeconds); setDone(false); return; }
    if (running) { setRunning(false); return; }
    if (remaining <= 0) setRemaining(totalSeconds);
    setRunning(true);
  };

  const label = done
    ? 'Done!'
    : running || remaining !== totalSeconds
      ? `${mm}:${String(ss).padStart(2, '0')}`
      : formatDuration(minutes);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors flex-shrink-0",
        done
          ? "bg-amber-400/20 text-amber-700 animate-pulse"
          : running
            ? "bg-emerald-500/15 text-emerald-700"
            : "bg-on-surface/[0.05] text-on-surface/65 hover:bg-on-surface/[0.08] hover:text-on-surface",
      )}
      aria-label={running ? 'Pause timer' : done ? 'Reset timer' : 'Start timer'}
    >
      <Clock size={11} />
      {label}
    </button>
  );
};

/** Simple swipeable photo lightbox for home meal views. */
export const PhotoLightbox: React.FC<{
  photos: { url: string; caption: string }[];
  index: number | null;
  onClose: () => void;
  onChange: (idx: number | null) => void;
}> = ({ photos, index, onClose, onChange }) => {
  useEffect(() => {
    if (index === null) return;
    document.body.style.overflow = 'hidden';
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && index < photos.length - 1) onChange(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) onChange(index - 1);
    };
    window.addEventListener('keydown', handleKey);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', handleKey); };
  }, [index, photos.length, onChange, onClose]);

  if (index === null || !photos[index]) return null;
  const photo = photos[index];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] bg-black/95 flex flex-col"
        onClick={onClose}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0">
          <span className="text-sm text-white/60 font-medium tabular-nums">{index + 1} / {photos.length}</span>
          <button onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-2 -mr-2 text-white/70 hover:text-white transition-colors">
            <X size={22} />
          </button>
        </div>

        {/* Photo */}
        <div className="flex-1 flex items-center justify-center px-4 min-h-0" onClick={(e) => e.stopPropagation()}>
          <motion.img
            key={photo.url}
            src={photo.url}
            alt={photo.caption || `Photo ${index + 1}`}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className="max-w-full max-h-full object-contain rounded-lg"
          />
        </div>

        {/* Caption + nav */}
        <div className="flex-shrink-0 px-5 py-4" onClick={(e) => e.stopPropagation()}>
          {photo.caption && (
            <p className="text-sm text-white/80 text-center mb-3 leading-relaxed">{photo.caption}</p>
          )}
          {photos.length > 1 && (
            <div className="flex items-center justify-center gap-4">
              <button onClick={() => index > 0 && onChange(index - 1)} disabled={index === 0}
                className="p-2 rounded-full bg-white/10 text-white disabled:opacity-30 transition-opacity">
                <ChevronLeft size={20} />
              </button>
              <button onClick={() => index < photos.length - 1 && onChange(index + 1)} disabled={index === photos.length - 1}
                className="p-2 rounded-full bg-white/10 text-white disabled:opacity-30 transition-opacity">
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
   Editorial recipe building blocks shared by RecipeDetail (own recipes) and
   MealRecipePage (friends' published meals). All flat — no card containers,
   relying on type weight + thin dividers for structure so both pages feel
   like a printed cookbook page rather than a stack of widgets.
   ─────────────────────────────────────────────────────────────────────────── */

/** A single label/value pair for the horizontal quick-info row. */
export type QuickInfoItem = { label: string; value: string; icon?: LucideIcon };

/**
 * Default label → icon mapping so pages that just pass `{ label, value }`
 * still get tasteful metadata icons for free. Explicit `icon` on the item
 * takes precedence.
 */
const QUICK_INFO_DEFAULT_ICONS: Record<string, LucideIcon> = {
  prep: Clock,
  cook: Clock,
  total: Clock,
  time: Clock,
  serves: Users,
  servings: Users,
  level: Gauge,
  difficulty: Gauge,
};

/**
 * Magazine-style recipe metadata row — a small icon, bold serif value and
 * uppercase label stacked in each cell, separated by thin vertical dividers.
 * No background or outer border; the dividers and typography do the work.
 */
export const RecipeQuickInfoRow: React.FC<{ items: QuickInfoItem[]; className?: string }> = ({ items, className }) => {
  if (items.length === 0) return null;
  return (
    <div className={cn("flex items-stretch", className)}>
      {items.map((item) => {
        const Icon = item.icon ?? QUICK_INFO_DEFAULT_ICONS[item.label.toLowerCase()];
        return (
          <div
            key={item.label}
            className="flex-1 min-w-0 px-2 first:pl-0 last:pr-0 border-l border-on-surface/10 first:border-l-0 flex flex-col items-center text-center"
          >
            {Icon && (
              <Icon size={14} className="text-on-surface/35 mb-1.5" strokeWidth={1.75} />
            )}
            <p className="font-serif font-bold text-[19px] leading-tight text-on-surface tabular-nums whitespace-nowrap">
              {item.value}
            </p>
            <p className="text-[10px] uppercase tracking-[0.14em] text-on-surface/45 font-medium mt-1">
              {item.label}
            </p>
          </div>
        );
      })}
    </div>
  );
};

/** Lightweight ingredient shape both data sources can satisfy. */
export type RecipeIngredientLite = { name: string; amount?: string; unit?: string };

interface RecipeIngredientListProps {
  /** Stable key (recipe / meal id) used to scope the checkbox state. */
  recipeKey: string;
  ingredients: RecipeIngredientLite[];
  /** Optional servings stepper. Provide base + scale and the component handles math. */
  servings?: {
    base: number;
    scale: number;
    onScaleChange: (scale: number) => void;
  };
  /** Compact density: tighter row padding, smaller Manrope type, and
   *  dotted dividers between rows. Used by the in-feed RecipePanel
   *  where vertical space is constrained. */
  compact?: boolean;
}

/**
 * Flat ingredient list with a checkbox column and bold quantities. No outer
 * card — uses thin dividers to separate rows. Checkbox state lives in
 * RecipesContext so it survives in-session navigation.
 */
export const RecipeIngredientList: React.FC<RecipeIngredientListProps> = ({ recipeKey, ingredients, servings, compact }) => {
  const { getCheckedIngredients, toggleIngredientCheck } = useRecipes();
  const checked = getCheckedIngredients(recipeKey);
  const ratio = servings?.scale ?? 1;

  if (ingredients.length === 0) return null;

  const displayServings = servings ? Math.max(1, Math.round(servings.base * servings.scale)) : 0;

  return (
    <div>
      {servings && (
        <div className="flex items-center justify-between gap-4 pb-4 mb-2 border-b border-on-surface/8">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-on-surface/45 font-medium mb-1">Servings</p>
            <p className="font-serif font-bold text-[22px] leading-none text-on-surface tabular-nums">
              {displayServings}
              <span className="text-xs text-on-surface/45 font-sans font-medium ml-1.5 align-middle">
                {displayServings === 1 ? 'serving' : 'servings'}
              </span>
            </p>
          </div>
          <div className="flex items-center bg-on-surface/[0.04] border border-on-surface/10 rounded-full">
            <button
              type="button"
              onClick={() => servings.onScaleChange(Math.max(0.25, (displayServings - 1) / servings.base))}
              disabled={displayServings <= 1}
              className="w-11 h-11 flex items-center justify-center rounded-l-full text-on-surface/60 hover:text-on-surface hover:bg-on-surface/[0.05] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              aria-label="Decrease servings"
            >
              <Minus size={16} />
            </button>
            <div className="w-px h-5 bg-on-surface/10" aria-hidden />
            <button
              type="button"
              onClick={() => servings.onScaleChange((displayServings + 1) / servings.base)}
              className="w-11 h-11 flex items-center justify-center rounded-r-full text-on-surface/60 hover:text-on-surface hover:bg-on-surface/[0.05] transition-colors"
              aria-label="Increase servings"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
      )}

      <ul className={cn(
        compact
          // Dotted hairline between rows in the compact variant.
          ? '[&>li+li]:border-t [&>li+li]:border-dotted [&>li+li]:border-on-surface/[0.18]'
          : 'divide-y divide-on-surface/[0.06]',
      )}>
        {ingredients.map((ing, i) => {
          const isChecked = checked.has(i);
          const scaledAmount = ing.amount ? scaleQuantity(ing.amount, ratio) : '';
          return (
            <li key={i}>
              <label className={cn(
                'flex items-center gap-4 cursor-pointer group transition-opacity',
                // Compact: ~9px y-padding → ~38px row at 13px body. Default
                // keeps the existing breathing room.
                compact ? 'py-[9px]' : 'py-3.5',
                isChecked && 'opacity-40',
              )}>
                {/* Checkbox column — fixed width so the rows align. */}
                <span className="flex items-center flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleIngredientCheck(recipeKey, i)}
                    className="sr-only peer"
                  />
                  <span className={cn(
                    'rounded-md border-2 flex items-center justify-center transition-all',
                    compact ? 'w-[20px] h-[20px]' : 'w-[22px] h-[22px]',
                    isChecked
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'border-on-surface/20 group-hover:border-on-surface/40',
                  )}>
                    {isChecked && <Check size={compact ? 12 : 14} strokeWidth={3} />}
                  </span>
                </span>
                {/* Amount + unit column — bold number, muted unit, fixed
                    min-width so every row's name starts at the same
                    horizontal position. */}
                <span
                  className={cn(
                    'flex-shrink-0 min-w-[64px] tabular-nums leading-snug font-sans',
                    isChecked && 'line-through',
                  )}
                  style={compact ? { fontSize: '12.5px' } : undefined}
                >
                  {scaledAmount && (
                    <span className={cn('font-bold text-on-surface', !compact && 'text-[15px]')}>{scaledAmount}</span>
                  )}
                  {ing.unit && (
                    <span className={cn('text-on-surface/50 font-normal ml-1', !compact && 'text-[15px]')}>{ing.unit}</span>
                  )}
                </span>
                {/* Name column — regular weight, slightly muted so the
                    quantity reads as the primary on each row. */}
                <span
                  className={cn(
                    'flex-1 min-w-0 text-on-surface/80 leading-snug font-sans',
                    compact ? 'text-[13px]' : 'text-[15px]',
                    isChecked && 'line-through',
                  )}
                >
                  {ing.name}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

/**
 * Editorial directions list: "Step N" eyebrow label over body text, separated
 * by hairline dividers. No card per step. Auto-injects a StepTimer when the
 * step text contains a recognised duration.
 */
export const RecipeDirectionsList: React.FC<{
  steps: string[];
  /** When provided, each step is tap-to-collapse: tapping the row
   *  shrinks the body + timer away to leave just the number, in a
   *  smooth height animation. State lives in RecipesContext so it
   *  survives in-session navigation. Without a key the list renders
   *  statically (current behavior for callers that haven't opted in). */
  recipeKey?: string;
  /** Compact density: Newsreader 18px clay-red step number anchored
   *  to the top-left, Manrope 13px body. Used by the in-feed
   *  RecipePanel where the standard 30px serif numeral feels
   *  oversized against the narrow column. */
  compact?: boolean;
}> = ({ steps, recipeKey, compact }) => {
  const { getCollapsedSteps, toggleStepCollapse } = useRecipes();
  const collapsed = recipeKey ? getCollapsedSteps(recipeKey) : null;
  const interactive = !!recipeKey;
  if (steps.length === 0) return null;
  return (
    <ol className="divide-y divide-on-surface/[0.06]">
      {steps.map((step, i) => {
        const timerMinutes = extractStepMinutes(step);
        const isCollapsed = collapsed?.has(i) ?? false;
        return (
          <li key={i}>
            <button
              type="button"
              disabled={!interactive}
              onClick={() => recipeKey && toggleStepCollapse(recipeKey, i)}
              aria-pressed={interactive ? isCollapsed : undefined}
              aria-label={interactive ? (isCollapsed ? `Expand step ${i + 1}` : `Collapse step ${i + 1}`) : undefined}
              className={cn(
                'w-full text-left transition-[padding,opacity] duration-200',
                interactive ? 'cursor-pointer' : 'cursor-default',
                // Collapsed rows stay tight; expanded rows breathe more
                // generously in the compact variant since the editorial
                // density was too cramped against the dividers.
                isCollapsed
                  ? 'py-2.5 opacity-50'
                  : compact
                    ? 'py-7'
                    : 'py-5',
                'first:pt-0 last:pb-0',
              )}
            >
              <div className={cn(
                'grid grid-cols-[auto_minmax(0,1fr)]',
                compact ? 'gap-x-3' : 'gap-x-5',
              )}>
                {/* Zero-padded serif step number — editorial accent that
                    anchors each step. In compact mode it sits in
                    Newsreader 18px / #b1442b, top-aligned slightly above
                    the body baseline. In the default variant it's a
                    larger 30px clay numeral. */}
                <motion.div
                  aria-hidden
                  animate={{ scale: isCollapsed ? 0.78 : 1 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className={cn(
                    'font-bold leading-none tabular-nums select-none origin-left',
                    compact
                      ? "text-[18px] [font-family:'Newsreader',serif]"
                      : 'font-serif text-[30px] text-primary/85',
                  )}
                  style={compact ? { color: '#b1442b' } : undefined}
                >
                  {String(i + 1).padStart(2, '0')}
                </motion.div>
                {/* Body + optional timer collapse together via a single
                    height-animated container. Wrapped in AnimatePresence
                    so it cleanly mounts/unmounts. */}
                <AnimatePresence initial={false}>
                  {!isCollapsed && (
                    <motion.div
                      key="body"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <p className={cn(
                        'selectable text-on-surface/85 whitespace-pre-wrap font-sans',
                        // pt-0 in compact mode so the Newsreader numeral
                        // sits slightly higher than the body baseline,
                        // matching the editorial reference.
                        compact
                          ? 'text-[13px] leading-[1.7]'
                          : 'text-[15px] leading-[1.75] pt-1',
                      )}>
                        {step}
                      </p>
                      {timerMinutes !== null && (
                        <div
                          className={cn(compact ? 'mt-2.5' : 'mt-3')}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <StepTimer minutes={timerMinutes} />
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
};

/** Minimal review shape both data sources can satisfy. */
export type ReviewListItem = {
  id: string;
  userId: string;
  rating: number;
  notes?: string;
  photo?: string;
  createdAt?: string;
};

interface RecipeReviewListProps {
  reviews: ReviewListItem[];
  profiles: Record<string, { display_name?: string; username?: string } | undefined>;
  currentUserId?: string | null;
  /** Page-supplied rating renderer (stars vs numeric vs whatever else). */
  renderRating?: (rating: number) => React.ReactNode;
}

/**
 * Flat review list — no per-review cards. Bold inline name + date header, the
 * page-supplied rating sits on the right, and review text wraps below.
 * Hairline dividers between entries.
 */
export const RecipeReviewList: React.FC<RecipeReviewListProps> = ({ reviews, profiles, currentUserId, renderRating }) => {
  if (reviews.length === 0) return null;
  return (
    <ul className="divide-y divide-on-surface/[0.06]">
      {reviews.map((r) => {
        const profile = profiles[r.userId];
        const name = profile?.display_name
          || profile?.username
          || (r.userId === currentUserId ? 'You' : 'Anonymous');
        const date = r.createdAt
          ? new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '';
        return (
          <li key={r.id} className="py-4 first:pt-0 last:pb-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm font-semibold text-on-surface">{name}</span>
              {date && (
                <>
                  <span className="text-on-surface/30">·</span>
                  <span className="text-xs text-on-surface/45">{date}</span>
                </>
              )}
              {renderRating && <div className="ml-auto">{renderRating(r.rating)}</div>}
            </div>
            {r.notes && (
              <p className="selectable text-[14px] text-on-surface/70 leading-[1.6] whitespace-pre-wrap">
                {r.notes}
              </p>
            )}
            {r.photo && (
              <img src={r.photo} alt="" className="mt-2 w-full rounded-xl object-cover max-h-48" />
            )}
          </li>
        );
      })}
    </ul>
  );
};

interface RecipeMobileSectionNavProps {
  sections: { id: string; label: string }[];
  /** Sticky offset from top — used when there's a fixed header above. */
  topOffset?: number;
}

/**
 * Sticky horizontal section navigation for mobile recipe pages. Highlights
 * the current section using IntersectionObserver as the user scrolls and
 * auto-scrolls the active pill into view.
 */
export const RecipeMobileSectionNav: React.FC<RecipeMobileSectionNavProps> = ({ sections, topOffset = 0 }) => {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? '');
  const containerRef = useRef<HTMLDivElement>(null);

  // Re-seed the active id whenever the section list changes shape so we don't
  // get stuck pointing at a stale section after data loads.
  useEffect(() => {
    if (sections.length === 0) return;
    if (!sections.find((s) => s.id === activeId)) setActiveId(sections[0].id);
  }, [sections, activeId]);

  useEffect(() => {
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: `-${topOffset + 60}px 0px -55% 0px`, threshold: 0 },
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections, topOffset]);

  // Keep the active pill in view as it changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !activeId) return;
    const activeBtn = container.querySelector<HTMLButtonElement>(`[data-section-id="${activeId}"]`);
    if (!activeBtn) return;
    const containerRect = container.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    if (btnRect.left < containerRect.left || btnRect.right > containerRect.right) {
      activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activeId]);

  if (sections.length === 0) return null;

  return (
    <div
      className="sticky z-20 bg-surface/75 backdrop-blur-md"
      // env(safe-area-inset-top) keeps the nav below the iOS status bar
      // once it sticks. Falls back to 0 on platforms without a safe area.
      style={{ top: `calc(${topOffset}px + env(safe-area-inset-top, 0px))` }}
    >
      <div ref={containerRef} className="flex gap-1 px-4 py-2 overflow-x-auto scrollbar-hide">
        {sections.map((s) => {
          const isActive = s.id === activeId;
          return (
            <button
              key={s.id}
              type="button"
              data-section-id={s.id}
              onClick={() => {
                const el = document.getElementById(s.id);
                if (!el) return;
                // Match the sticky nav's own offset so the scrolled-to section
                // header lands just under the nav instead of behind it.
                const safeTop = parseFloat(
                  getComputedStyle(document.documentElement).getPropertyValue('--sat-top'),
                ) || 0;
                const elTop = el.getBoundingClientRect().top + window.scrollY - topOffset - safeTop - 56;
                window.scrollTo({ top: elTop, behavior: 'smooth' });
              }}
              className={cn(
                "px-3.5 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap transition-colors",
                isActive
                  ? "bg-on-surface text-surface"
                  : "text-on-surface/55 hover:text-on-surface hover:bg-on-surface/5",
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
   Empty state — a quiet prompt for sections with no content yet (ingredients,
   directions, reviews). Uses soft body-copy tones so it reads as part of the
   page rather than a loud callout.
   ─────────────────────────────────────────────────────────────────────────── */
export const RecipeEmptyState: React.FC<{
  icon?: LucideIcon;
  title: string;
  hint?: string;
  className?: string;
}> = ({ icon: Icon, title, hint, className }) => (
  <div className={cn("py-8 text-center", className)}>
    {Icon && (
      <Icon size={22} className="text-on-surface/20 mx-auto mb-2" strokeWidth={1.5} />
    )}
    <p className="text-sm text-on-surface/45 font-medium">{title}</p>
    {hint && <p className="text-xs text-on-surface/35 mt-1">{hint}</p>}
  </div>
);
