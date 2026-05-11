/**
 * RecipePanel — side panel / bottom sheet that opens when a viewer taps a
 * "featured recipe" card on a reel or post. Brings the full meal-recipe
 * page experience inside the feed:
 *
 *   - Compact, static header (no big hero image / no scroll-collapse).
 *   - Selectable ingredients with a servings scaler (state shared with
 *     the full /meal page via RecipesContext).
 *   - Numbered method steps with built-in StepTimer parsing.
 *   - Reviews list + inline rating / notes form.
 *   - "Save to my recipes" copies the meal into the viewer's own
 *     homeMeals as a private entry, so they get an editable copy.
 *   - "View full recipe" remains as the primary route for users who
 *     want the full editorial experience.
 *
 * The recipe lives in the author's home_meals table (FriendHomeMeal),
 * fetched lazily via getPublicHomeMealById.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router-dom';
import {
  X, ArrowUpRight, Clock, Flame, ChefHat, Loader2, BookmarkPlus, Bookmark, Star, Send,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  getPublicHomeMealById,
  getProfilesByIds,
  getFriends,
  type FriendHomeMeal,
  type UserProfile,
} from '../lib/supabase-community';
import {
  getHomeMealReviews,
  getMyHomeMealReview,
  upsertHomeMealReview,
  type HomeMealReview,
} from '../lib/supabase-home-meal-reviews';
import type { ReelRecipeSnapshot } from '../lib/supabase-reels';
import { useLists, type HomeMeal } from '../contexts/ListsContext';
import { useToast } from '../contexts/ToastContext';
import {
  RecipeIngredientList,
  RecipeDirectionsList,
  formatDuration,
} from '../lib/recipe-display';

/** Stable per-user avatar color so review rows read as varied without
 *  needing a real avatar URL. Hashes the user id to one of a small
 *  warm palette. */
const REVIEW_AVATAR_COLORS = [
  'bg-clay',
  'bg-amber-600',
  'bg-emerald-700',
  'bg-indigo-700',
  'bg-rose-700',
  'bg-teal-700',
  'bg-violet-700',
  'bg-orange-700',
];
function avatarColorForUser(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = ((h << 5) - h + userId.charCodeAt(i)) | 0;
  return REVIEW_AVATAR_COLORS[Math.abs(h) % REVIEW_AVATAR_COLORS.length];
}

/* ── Snapshot the panel accepts ──────────────────────────────────────── */
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

/* ── Star rating (used by both the form and the per-review rendering) ── */

const StarRating: React.FC<{
  value: number;
  onChange?: (n: number) => void;
  size?: number;
  /** When provided, hovering lights up that many stars instead of value. */
  hover?: number | null;
  onHover?: (n: number | null) => void;
}> = ({ value, onChange, size = 22, hover, onHover }) => {
  const display = hover ?? value;
  const interactive = !!onChange;
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= display;
        const Cmp = interactive ? 'button' : 'span';
        return (
          <Cmp
            key={n}
            type={interactive ? 'button' : undefined}
            onClick={interactive ? () => onChange?.(n) : undefined}
            onMouseEnter={interactive && onHover ? () => onHover(n) : undefined}
            onMouseLeave={interactive && onHover ? () => onHover(null) : undefined}
            className={cn(
              'inline-flex items-center justify-center transition-colors',
              interactive && 'hover:scale-110 active:scale-95',
            )}
            aria-label={interactive ? `${n} star${n === 1 ? '' : 's'}` : undefined}
          >
            <Star
              size={size}
              strokeWidth={1.6}
              className={cn(
                filled ? 'fill-amber-400 text-amber-400' : 'text-on-surface/25',
                'transition-colors',
              )}
            />
          </Cmp>
        );
      })}
    </div>
  );
};

const RATING_LABELS = ['', 'Poor', 'Just ok', 'Good', 'Great', 'Amazing!'];

/* ── Reviews section (list + form) ──────────────────────────────────── */

const ReviewsSection: React.FC<{
  meal: FriendHomeMeal;
  currentUserId: string | null;
}> = ({ meal, currentUserId }) => {
  const { showToast } = useToast();
  const { stashMetaKey } = useLists();
  const isAuthor = currentUserId === meal.userId;

  const [reviews, setReviews] = useState<HomeMealReview[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [myReview, setMyReview] = useState<HomeMealReview | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Load reviews + my review on mount.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setReviews([]);
    setProfiles({});
    setMyReview(null);

    (async () => {
      // Scan: author + me + my friends — same scope as the full page.
      let scanIds: string[] = [meal.userId];
      if (currentUserId) {
        scanIds.push(currentUserId);
        try {
          const friends = await getFriends(currentUserId);
          scanIds = Array.from(new Set([...scanIds, ...friends.map((f) => f.friend_id)]));
        } catch { /* best-effort */ }
      }
      const [all, mine] = await Promise.all([
        getHomeMealReviews(meal.id, scanIds),
        currentUserId ? getMyHomeMealReview(currentUserId, meal.id) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setReviews(all);
      setMyReview(mine);
      if (mine) {
        setRating(mine.rating);
        setNotes(mine.notes);
      }
      // Pull profiles so reviewer names render properly.
      const ids = Array.from(new Set(all.map((r) => r.userId)));
      if (ids.length > 0) {
        const profs = await getProfilesByIds(ids);
        if (!cancelled) setProfiles(profs);
      }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [meal.id, meal.userId, currentUserId]);

  const onSubmit = async () => {
    if (!currentUserId || rating < 1 || saving || isAuthor) return;
    setSaving(true);
    setSubmitError(false);
    try {
      const saved = await upsertHomeMealReview(currentUserId, meal.id, { rating, notes });
      if (!saved) throw new Error('save failed');
      // Update the in-memory review list so the new entry appears
      // immediately. Drop the previous entry by this user if present.
      setReviews((prev) => {
        const filtered = prev.filter((r) => r.userId !== currentUserId);
        return [saved, ...filtered];
      });
      setMyReview(saved);
      // Stash through ListsContext meta so it survives navigation away
      // and back without a re-fetch (mirrors the full-page behavior).
      try {
        const meta = (stashMetaKey as unknown as (k: string, v: unknown) => void);
        meta('__my_meal_reviews__', { ...({}), [meal.id]: { rating, notes } });
      } catch { /* meta sync is best-effort */ }
      setSavedAt(Date.now());
      showToast(myReview ? 'Review updated' : 'Review posted');
    } catch {
      setSubmitError(true);
    } finally {
      setSaving(false);
    }
  };

  const visibleReviews = showAll ? reviews : reviews.slice(0, 3);
  const summary = useMemo(() => {
    if (reviews.length === 0) return null;
    const total = reviews.reduce((acc, r) => acc + (r.rating || 0), 0);
    return { avg: total / reviews.length, count: reviews.length };
  }, [reviews]);

  return (
    <section>
      <h3 className="font-serif font-bold text-on-surface text-[18px] mb-3">Reviews</h3>

      {/* Subtle summary pill — average score, filled-stars rendering, count
          text. Reads as a quiet header for the list rather than a
          chip wedged into the section title. */}
      {summary && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-on-surface/[0.05] mb-4">
          <span className="font-serif font-bold text-on-surface text-[20px] leading-none tabular-nums">
            {summary.avg.toFixed(1)}
          </span>
          <StarRating value={Math.round(summary.avg)} size={16} />
          <span className="text-[13px] text-on-surface/55">
            {summary.count} {summary.count === 1 ? 'review' : 'reviews'}
          </span>
        </div>
      )}

      {/* Form — only shown to non-author signed-in viewers */}
      {currentUserId && !isAuthor && (
        <div className="rounded-2xl bg-paper ring-1 ring-on-surface/[0.07] p-4 mb-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface/55 mb-2.5">
            {myReview ? 'Update your review' : 'Rate this recipe'}
          </p>
          <StarRating
            value={rating}
            onChange={setRating}
            hover={hoverRating}
            onHover={setHoverRating}
          />
          {(hoverRating || rating) > 0 && (
            <p className="text-[12px] text-on-surface/65 mt-1.5 font-medium">
              {RATING_LABELS[hoverRating ?? rating]}
            </p>
          )}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={3}
            className="mt-3 w-full rounded-xl bg-on-surface/[0.04] border border-on-surface/[0.06] focus:bg-on-surface/[0.06] focus:ring-2 focus:ring-on-surface/10 focus:outline-none px-3 py-2 text-[13px] text-on-surface placeholder:text-on-surface/40 resize-none transition-colors"
          />
          <button
            type="button"
            onClick={onSubmit}
            disabled={rating < 1 || saving}
            className={cn(
              'mt-3 w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-full text-[13px] font-bold transition-colors',
              rating >= 1 && !saving
                ? 'bg-on-surface text-surface hover:bg-on-surface/90'
                : 'bg-on-surface/[0.08] text-on-surface/40 cursor-not-allowed',
            )}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={13} />}
            {saving ? 'Saving…' : savedAt ? 'Review saved' : myReview ? 'Update review' : 'Post review'}
          </button>
          {submitError && (
            <p className="text-[11px] text-rose-600 mt-2">Something went wrong. Try again.</p>
          )}
        </div>
      )}
      {!currentUserId && (
        <p className="text-[12px] text-on-surface/55 mb-4">Sign in to leave a review.</p>
      )}
      {isAuthor && (
        <p className="text-[12px] text-on-surface/55 mb-4 italic">You can't rate your own recipe.</p>
      )}

      {/* List — editorial review rows: circular avatar with initials on
          the left, name + stars on a shared baseline, italic serif
          quote underneath. Stars right-aligned so the rating reads
          against the rail. */}
      {loading ? (
        <div className="flex items-center justify-center py-4 text-on-surface/45">
          <Loader2 size={16} className="animate-spin" />
        </div>
      ) : reviews.length === 0 ? (
        <p className="text-[13px] text-on-surface/55 text-center py-4">
          No reviews yet. Be the first to rate it.
        </p>
      ) : (
        <>
          <ul className="space-y-4">
            {visibleReviews.map((r) => {
              const profile = profiles[r.userId];
              const name = profile?.display_name
                || profile?.username
                || (r.userId === currentUserId ? 'You' : 'Anonymous');
              const initials = (profile?.display_name || profile?.username || r.userId)
                .slice(0, 2)
                .toUpperCase();
              const avatarColor = avatarColorForUser(r.userId);
              return (
                <li key={r.id} className="flex items-start gap-3">
                  <span className={cn(
                    'w-9 h-9 rounded-full flex items-center justify-center text-white text-[12px] font-bold flex-shrink-0',
                    avatarColor,
                  )}>
                    {initials}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[14px] font-bold text-on-surface truncate">{name}</span>
                      <StarRating value={r.rating} size={13} />
                    </div>
                    {r.notes && (
                      <p className="font-serif italic text-on-surface/65 text-[14px] leading-snug mt-1">
                        "{r.notes}"
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {reviews.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAll((o) => !o)}
              className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-on-surface/65 hover:text-on-surface transition-colors"
            >
              {showAll ? 'Show fewer' : `Show all ${reviews.length} reviews`}
            </button>
          )}
        </>
      )}
    </section>
  );
};

/* ── Body ─────────────────────────────────────────────────────────────── */

const RecipePanelBody: React.FC<{
  snapshot: RecipePanelSnapshot;
  onClose: () => void;
  currentUserId: string | null;
}> = ({ snapshot, onClose, currentUserId }) => {
  const { authorId, recipe } = snapshot;
  const { homeMeals, createHomeMeal } = useLists();
  const { showToast } = useToast();

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

  /* ── Servings scaler — local to this panel session so the user's
        scratchpad doesn't survive across recipes. */
  const baseServings = recipe.servings || meal?.servings || 4;
  const [servingsScale, setServingsScale] = useState(1);
  // Reset the scaler when the snapshot changes (different recipe).
  useEffect(() => { setServingsScale(1); }, [recipe.id, authorId]);

  /* ── Save-to-my-recipes. We detect "already saved" by checking the
        user's own homeMeals for one whose name matches AND whose
        description holds our origin tag. createHomeMeal stores
        meta in the description so this round-trips. */
  const ORIGIN_TAG = `[from @${author?.username || authorId}]`;
  const alreadySaved = useMemo(() => {
    if (!meal) return false;
    return homeMeals.some(
      (m) => m.name === meal.name && (m.description || '').includes(ORIGIN_TAG),
    );
  }, [homeMeals, meal, ORIGIN_TAG]);

  const isOwnMeal = currentUserId === authorId;

  const handleSave = () => {
    if (!meal || alreadySaved || isOwnMeal) return;
    const description = meal.description
      ? `${meal.description}\n\n${ORIGIN_TAG}`
      : ORIGIN_TAG;
    const copy: Omit<HomeMeal, 'id' | 'createdAt'> = {
      name: meal.name,
      date: new Date().toISOString().slice(0, 10),
      score: 0,
      wouldMakeAgain: false,
      description,
      photos: meal.photos || [],
      tags: meal.tags || [],
      dishes: meal.dishes || [],
      isPublic: false,
      coverPhoto: meal.coverPhoto || meal.photos?.[0]?.url,
      prepTime: meal.prepTime,
      cookTime: meal.cookTime,
      servings: meal.servings,
      difficulty: meal.difficulty,
      cuisine: meal.cuisine,
      ingredients: meal.ingredients,
      steps: meal.steps,
    };
    createHomeMeal(copy);
    showToast('Saved to your recipes');
  };

  /* ── Derived display strings */
  const totalTime = (recipe.prepTime || 0) + (recipe.cookTime || 0);
  const cuisine = meal?.cuisine || '';
  const description = (meal?.description || '').replace(ORIGIN_TAG, '').trim();
  const tags = meal?.tags || [];
  const ingredients = meal?.ingredients || [];
  const steps = meal?.steps || [];
  const recipeKey = `meal-${recipe.id}`;

  const fullRecipeHref = `/meal/${encodeURIComponent(authorId)}/${encodeURIComponent(recipe.id)}`;

  return (
    <>
      {/* Compact static header — no hero image, no scroll-collapse. Two
          rows: title + close, then a small meta line. */}
      <div className="flex-shrink-0 border-b border-on-surface/[0.07] bg-surface/95 backdrop-blur sticky top-0 z-10 px-5 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-serif font-bold text-on-surface text-[18px] leading-[1.15] tracking-tight line-clamp-2">
              {recipe.title}
            </h2>
            <p className="text-[11px] text-on-surface/55 mt-1 truncate">
              {[
                author ? `@${author.username}` : null,
                cuisine,
                totalTime > 0 ? formatDuration(totalTime) : null,
                recipe.difficulty,
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full hover:bg-on-surface/[0.07] flex items-center justify-center text-on-surface/65 transition-colors flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-5 pb-6 space-y-6">
        {/* Author chip */}
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

        {/* Quick info — time + difficulty (servings is in the ingredient
            list since it's interactive there). */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2 rounded-2xl bg-paper ring-1 ring-on-surface/[0.07] px-3 py-2.5">
            <Clock size={14} className="text-on-surface/55 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface/55 leading-none">Time</p>
              <p className="text-[14px] font-bold text-on-surface tabular-nums leading-tight mt-0.5">
                {totalTime > 0 ? formatDuration(totalTime) : '—'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-2xl bg-paper ring-1 ring-on-surface/[0.07] px-3 py-2.5">
            <Flame size={14} className="text-on-surface/55 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface/55 leading-none">Level</p>
              <p className="text-[14px] font-bold text-on-surface leading-tight mt-0.5">
                {recipe.difficulty || '—'}
              </p>
            </div>
          </div>
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

        {/* Save button — pinned high so it's discoverable; turns into a
            "Saved" pill once the user has copied this recipe to their
            own collection. Hidden if the user is the author. */}
        {!isOwnMeal && (
          <button
            type="button"
            onClick={handleSave}
            disabled={alreadySaved || !meal}
            className={cn(
              'w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-full text-[13px] font-bold transition-colors',
              alreadySaved
                ? 'bg-emerald-100 text-emerald-800 cursor-default'
                : 'bg-on-surface/[0.06] text-on-surface hover:bg-on-surface/[0.1]',
            )}
          >
            {alreadySaved ? <Bookmark size={14} className="fill-emerald-700" /> : <BookmarkPlus size={14} />}
            {alreadySaved ? 'Saved to your recipes' : 'Save to your recipes'}
          </button>
        )}

        {/* Loading until the full meal record arrives — ingredients +
            steps + reviews all need it. */}
        {loading && (!ingredients.length && !steps.length) ? (
          <div className="flex items-center justify-center py-6 text-on-surface/45">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : (
          <>
            {/* Ingredients — reuses the shared component so checkbox
                state syncs with the full /meal page (RecipesContext key). */}
            {ingredients.length > 0 && (
              <section>
                <div className="flex items-baseline justify-between mb-3">
                  <h3 className="font-serif font-bold text-on-surface text-[18px]">Ingredients</h3>
                  <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 tabular-nums">
                    {ingredients.length} {ingredients.length === 1 ? 'item' : 'items'}
                  </span>
                </div>
                <RecipeIngredientList
                  recipeKey={recipeKey}
                  ingredients={ingredients}
                  servings={baseServings > 0 ? {
                    base: baseServings,
                    scale: servingsScale,
                    onScaleChange: setServingsScale,
                  } : undefined}
                />
              </section>
            )}

            {/* Method — RecipeDirectionsList parses minute durations from
                the step text and renders an inline StepTimer. Header
                gets a right-aligned "N STEPS" counter in mono caps so
                the section reads with editorial chrome. */}
            {steps.length > 0 && (
              <section>
                <div className="flex items-baseline justify-between mb-3">
                  <h3 className="font-serif font-bold text-on-surface text-[18px]">Method</h3>
                  <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 tabular-nums">
                    {steps.length} {steps.length === 1 ? 'step' : 'steps'}
                  </span>
                </div>
                <RecipeDirectionsList steps={steps} />
              </section>
            )}

            {/* Reviews */}
            {meal && (
              <ReviewsSection meal={meal} currentUserId={currentUserId} />
            )}

            {/* Empty state — meal couldn't load (deleted / private / RLS) */}
            {!loading && !meal && (
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

export const RecipePanel: React.FC<RecipePanelProps> = ({ snapshot, onClose, currentUserId, variant }) => {
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
              style={{ height: '88%' }}
            >
              <div className="pt-2 pb-1 flex justify-center flex-shrink-0">
                <span className="w-10 h-1 rounded-full bg-on-surface/15" />
              </div>
              <RecipePanelBody snapshot={snapshot} onClose={onClose} currentUserId={currentUserId} />
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
            <RecipePanelBody snapshot={snapshot} onClose={onClose} currentUserId={currentUserId} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
