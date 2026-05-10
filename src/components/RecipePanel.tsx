/**
 * RecipePanel — side panel / bottom sheet that opens when a viewer taps a
 * "featured recipe" card on a reel or post. Mirrors RestaurantPanel: the
 * goal is to surface the recipe at a glance without yanking the user out
 * of the feed. Tap the card → side panel slides in. Scroll the body →
 * the hero collapses smoothly. Tap a different card / scroll to a
 * different reel → the panel swaps to follow.
 *
 * The recipe itself lives in the author's home_meals table (FriendHomeMeal),
 * fetched lazily via getPublicHomeMealById. Until that resolves we render
 * what the reel/post snapshot already carries (title, time, servings,
 * difficulty, cover image) so the panel paints immediately.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useScroll, useTransform } from 'motion/react';
import { Link } from 'react-router-dom';
import {
  X, ArrowUpRight, Clock, Users, Flame, ChefHat, ImageOff, Loader2, ChevronDown, ListChecks, BookOpen,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  getPublicHomeMealById,
  getProfilesByIds,
  type FriendHomeMeal,
  type UserProfile,
} from '../lib/supabase-community';
import type { ReelRecipeSnapshot } from '../lib/supabase-reels';

/* ── Snapshot the panel accepts ───────────────────────────────────────────
   Both reels and posts can attach a recipe; the snapshot shapes match.
   We carry the snapshot itself plus the author's user id (needed to
   resolve the full meal record from supabase). */
export interface RecipePanelSnapshot {
  authorId: string;
  recipe: ReelRecipeSnapshot;
}

interface RecipePanelProps {
  snapshot: RecipePanelSnapshot | null;
  onClose: () => void;
  currentUserId: string | null;
  variant: 'panel' | 'sheet';
}

function formatTime(min: number): string {
  if (!min || min <= 0) return '';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/* ── Stat chip (time / servings / difficulty) ─────────────────────────── */

const StatPill: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
}> = ({ icon, label, value }) => (
  <div className="flex flex-col gap-1.5 rounded-2xl bg-paper ring-1 ring-on-surface/[0.07] px-3 py-3">
    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface/55">
      <span className="opacity-70">{icon}</span>
      {label}
    </div>
    <p className="text-[15px] font-bold leading-none text-on-surface tabular-nums">
      {value || '—'}
    </p>
  </div>
);

/* ── Body (shared between sheet + panel) ──────────────────────────────── */

const RecipePanelBody: React.FC<{
  snapshot: RecipePanelSnapshot;
  onClose: () => void;
}> = ({ snapshot, onClose }) => {
  const { authorId, recipe } = snapshot;

  const [meal, setMeal] = useState<FriendHomeMeal | null>(null);
  const [author, setAuthor] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMeal(null);
    setAuthor(null);
    Promise.all([
      getPublicHomeMealById(authorId, recipe.id),
      getProfilesByIds([authorId]),
    ]).then(([m, profs]) => {
      if (cancelled) return;
      setMeal(m);
      setAuthor(profs[authorId] || null);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authorId, recipe.id]);

  /* ── Hero cover: prefer the recipe snapshot's image (already signed
        on the reel/post row), then the meal's coverPhoto, then the
        first uploaded photo. Falls back to a warm gradient. */
  const cover = recipe.image || meal?.coverPhoto || meal?.photos?.[0]?.url || '';

  /* ── Derived stats. Snapshot fields cover the common case; the meal
        record fills in cuisine + tags + ingredients + steps. */
  const totalTime = (recipe.prepTime || 0) + (recipe.cookTime || 0);
  const cuisine = meal?.cuisine || '';
  const description = meal?.description || '';
  const tags = meal?.tags || [];
  const ingredients = meal?.ingredients || [];
  const steps = meal?.steps || [];
  const photos = meal?.photos || [];

  const [ingredientsOpen, setIngredientsOpen] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);

  const visibleIngredients = ingredientsOpen ? ingredients : ingredients.slice(0, 6);
  const visibleSteps = stepsOpen ? steps : steps.slice(0, 3);

  /* ── Scroll-driven hero collapse — same shape as RestaurantPanel so
        the two panels feel like siblings. */
  const scrollRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll({ container: scrollRef });
  const heroHeight = useTransform(scrollY, [0, 130], [204, 60], { clamp: true });
  const mediaOpacity = useTransform(scrollY, [0, 80], [1, 0], { clamp: true });
  const expandedOpacity = useTransform(scrollY, [0, 60], [1, 0], { clamp: true });
  const expandedY = useTransform(scrollY, [0, 130], [0, -22], { clamp: true });
  const compactOpacity = useTransform(scrollY, [60, 130], [0, 1], { clamp: true });
  const bottomLineOpacity = useTransform(scrollY, [80, 130], [0, 1], { clamp: true });

  const fullRecipeHref = `/meal/${encodeURIComponent(authorId)}/${encodeURIComponent(recipe.id)}`;

  return (
    <>
      {/* Header — cover photo (or gradient) that collapses on scroll */}
      <motion.div
        className="relative flex-shrink-0 w-full bg-cream-2 overflow-hidden"
        style={{ height: heroHeight }}
      >
        {cover ? (
          <motion.img
            src={cover}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{ opacity: mediaOpacity }}
            referrerPolicy="no-referrer"
          />
        ) : (
          <motion.div
            className="absolute inset-0 bg-gradient-to-br from-amber-700 via-orange-700/40 to-stone-800 flex items-center justify-center text-white/30"
            style={{ opacity: mediaOpacity }}
          >
            <ChefHat size={32} />
          </motion.div>
        )}
        {/* Bottom legibility wash */}
        <motion.div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/75 via-black/25 to-transparent"
          style={{ opacity: mediaOpacity }}
        />

        {/* Expanded title — fades + slides up as the hero collapses */}
        <motion.div
          className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-3.5 text-white"
          style={{ opacity: expandedOpacity, y: expandedY }}
        >
          <h2 className="font-serif font-bold text-[21px] leading-[1.1] tracking-tight line-clamp-2">
            {recipe.title}
          </h2>
          <p className="text-[12px] text-white/85 mt-0.5 truncate">
            {[cuisine, totalTime > 0 ? formatTime(totalTime) : null, recipe.servings ? `${recipe.servings} servings` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </motion.div>

        {/* Compact title — fades in centered when collapsed */}
        <motion.div
          className="pointer-events-none absolute inset-0 flex items-center justify-center px-16"
          style={{ opacity: compactOpacity }}
        >
          <div className="min-w-0 text-center">
            <h3 className="font-serif font-bold text-on-surface text-[15px] leading-tight truncate">
              {recipe.title}
            </h3>
            <p className="text-[11px] text-on-surface/55 truncate mt-0.5">
              {[cuisine, recipe.difficulty].filter(Boolean).join(' · ')}
            </p>
          </div>
        </motion.div>

        {/* Close pill — pinned across both states */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/55 backdrop-blur text-white hover:bg-black/75 flex items-center justify-center transition-colors z-10"
        >
          <X size={17} />
        </button>

        {/* Hairline separator that appears once collapsed */}
        <motion.div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-on-surface/[0.09]"
          style={{ opacity: bottomLineOpacity }}
        />
      </motion.div>

      {/* Body */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 pt-5 pb-6 space-y-6">
        {/* Author chip — sits flush at the top so the eye lands on
            "who made this" before the meta. */}
        {author && (
          <Link
            to={`/user/${encodeURIComponent(author.username)}`}
            className="inline-flex items-center gap-2.5 group"
          >
            <span className="w-9 h-9 rounded-full bg-on-surface/10 text-on-surface flex items-center justify-center text-[12px] font-bold flex-shrink-0">
              {(author.display_name || author.username).slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-bold text-on-surface group-hover:underline underline-offset-2 truncate">
                {author.display_name || author.username}
              </span>
              <span className="block text-[11px] text-on-surface/50 font-mono truncate">
                @{author.username}
              </span>
            </span>
          </Link>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2">
          <StatPill icon={<Clock size={11} />} label="Time" value={formatTime(totalTime)} />
          <StatPill icon={<Users size={11} />} label="Serves" value={recipe.servings ? String(recipe.servings) : ''} />
          <StatPill icon={<Flame size={11} />} label="Level" value={recipe.difficulty || ''} />
        </div>

        {/* Description */}
        {description && (
          <p className="font-serif italic text-on-surface/80 text-[15px] leading-relaxed line-clamp-4">
            "{description}"
          </p>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 8).map((t) => (
              <span key={t} className="px-2.5 py-1 rounded-full bg-cream-2 text-on-surface/80 text-[11px] font-medium">
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Ingredients */}
        {loading && ingredients.length === 0 && steps.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-on-surface/45">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : (
          <>
            {ingredients.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2.5">
                  <h3 className="flex items-center gap-1.5 font-serif font-bold text-on-surface text-[15px]">
                    <ListChecks size={14} className="text-on-surface/55" />
                    Ingredients
                  </h3>
                  <span className="text-[11px] text-on-surface/50 tabular-nums">
                    {ingredients.length} item{ingredients.length === 1 ? '' : 's'}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {visibleIngredients.map((ing, i) => (
                    <li key={i} className="flex items-baseline gap-2.5 text-[13px] text-on-surface/85">
                      <span className="text-on-surface/40 tabular-nums shrink-0 min-w-[55px]">
                        {[ing.amount, ing.unit].filter(Boolean).join(' ') || '·'}
                      </span>
                      <span>{ing.name}</span>
                    </li>
                  ))}
                </ul>
                {ingredients.length > 6 && (
                  <button
                    type="button"
                    onClick={() => setIngredientsOpen((o) => !o)}
                    className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-on-surface/65 hover:text-on-surface transition-colors"
                  >
                    {ingredientsOpen ? 'Show less' : `Show all ${ingredients.length}`}
                    <ChevronDown size={13} className={cn('transition-transform duration-200', ingredientsOpen && 'rotate-180')} />
                  </button>
                )}
              </section>
            )}

            {/* Method / steps */}
            {steps.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2.5">
                  <h3 className="flex items-center gap-1.5 font-serif font-bold text-on-surface text-[15px]">
                    <BookOpen size={14} className="text-on-surface/55" />
                    Method
                  </h3>
                  <span className="text-[11px] text-on-surface/50 tabular-nums">
                    {steps.length} step{steps.length === 1 ? '' : 's'}
                  </span>
                </div>
                <ol className="space-y-3">
                  {visibleSteps.map((s, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-on-surface/[0.06] text-on-surface text-[12px] font-bold tabular-nums flex items-center justify-center mt-0.5">
                        {i + 1}
                      </span>
                      <p className="flex-1 text-[13px] text-on-surface/85 leading-relaxed">{s}</p>
                    </li>
                  ))}
                </ol>
                {steps.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setStepsOpen((o) => !o)}
                    className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-on-surface/65 hover:text-on-surface transition-colors"
                  >
                    {stepsOpen ? 'Show less' : `Show all ${steps.length} steps`}
                    <ChevronDown size={13} className={cn('transition-transform duration-200', stepsOpen && 'rotate-180')} />
                  </button>
                )}
              </section>
            )}

            {/* Photos — 4-up grid; tapping any thumbnail jumps into the
                full recipe page where the gallery lightbox lives. */}
            {photos.length > 1 && (
              <section>
                <div className="flex items-baseline justify-between mb-2.5">
                  <h3 className="font-serif font-bold text-on-surface text-[15px]">Photos</h3>
                  <span className="text-[11px] text-on-surface/50 tabular-nums">{photos.length}</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {photos.slice(0, 4).map((p, idx) => {
                    const isLast = idx === 3 && photos.length > 4;
                    const more = photos.length - 4;
                    return (
                      <Link
                        key={idx}
                        to={fullRecipeHref}
                        onClick={onClose}
                        className="relative aspect-square rounded-xl overflow-hidden bg-on-surface/[0.05] ring-1 ring-on-surface/[0.06] hover:ring-on-surface/[0.14] transition-shadow"
                      >
                        <img
                          src={p.url}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                        {isLast && (
                          <div className="absolute inset-0 bg-black/55 backdrop-blur-[1px] flex items-center justify-center">
                            <span className="text-white text-[14px] font-bold tabular-nums">+{more}</span>
                          </div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Empty state — meal couldn't load (deleted / private / RLS) */}
            {!loading && !meal && ingredients.length === 0 && steps.length === 0 && (
              <div className="rounded-2xl bg-on-surface/[0.04] px-4 py-5 text-center">
                <p className="text-[13px] text-on-surface/65 leading-snug">
                  Recipe details are unavailable. Open the full page for the latest.
                </p>
              </div>
            )}
          </>
        )}

        {/* View full recipe — primary route to the detail page. */}
        <Link
          to={fullRecipeHref}
          onClick={onClose}
          className="group flex items-center justify-center gap-1.5 w-full h-12 rounded-full bg-primary text-white text-[14px] font-bold hover:bg-primary/90 transition-colors shadow-sm"
        >
          View full recipe
          <ArrowUpRight size={16} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      </div>
    </>
  );
};

/* ── Desktop side panel + mobile sheet ───────────────────────────────── */

export const RecipePanel: React.FC<RecipePanelProps> = ({ snapshot, onClose, currentUserId: _currentUserId, variant }) => {
  void _currentUserId; // accepted for symmetry with RestaurantPanel; unused for now
  if (variant === 'sheet') {
    return (
      <AnimatePresence>
        {snapshot && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-black/55 backdrop-blur-sm flex items-end"
            onClick={onClose}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface w-full rounded-t-3xl flex flex-col ring-1 ring-on-surface/[0.16]"
              style={{ height: '85%' }}
            >
              <div className="pt-2 pb-1 flex justify-center flex-shrink-0">
                <span className="w-10 h-1 rounded-full bg-on-surface/15" />
              </div>
              <RecipePanelBody snapshot={snapshot} onClose={onClose} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {snapshot && (
        <motion.div
          key={`${snapshot.authorId}-${snapshot.recipe.id}`}
          initial={{ opacity: 0, x: 20, width: 0 }}
          animate={{ opacity: 1, x: 0, width: 380 }}
          exit={{ opacity: 0, x: 20, width: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 280 }}
          className="h-full bg-surface ring-1 ring-on-surface/[0.16] rounded-[24px] overflow-hidden flex flex-col flex-shrink-0 shadow-md"
        >
          <div className="w-[380px] h-full flex flex-col">
            <RecipePanelBody snapshot={snapshot} onClose={onClose} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
