/**
 * FriendRecipeModal
 *
 * Full-screen overlay that shows a friend's published home meal (recipe)
 * so the current user can read it and leave a 5-star review + notes.
 *
 * Reads/writes reviews through `supabase-home-meal-reviews.ts`, which
 * reuses the existing `recipe_reviews` table keyed on `(user_id, recipe_id)`
 * where `recipe_id` is the home meal's id. That way we don't need a new
 * database table to ship this feature.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ArrowLeft, Clock, Flame, Users, Hash, FileText, Star, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';
import type { FriendHomeMeal, UserProfile } from '../lib/supabase-community';
import {
  upsertHomeMealReview,
  getHomeMealReviews,
  getMyHomeMealReview,
  summarizeReviews,
  type HomeMealReview,
} from '../lib/supabase-home-meal-reviews';
import { getProfilesByIds } from '../lib/supabase-community';

const formatDuration = (minutes: number): string => {
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return `${hours} hr`;
  return `${hours} hr ${rem} min`;
};

export const FriendRecipeModal: React.FC<{
  meal: FriendHomeMeal | null;
  authorProfile: UserProfile | null;
  currentUserId: string | null;
  onClose: () => void;
}> = ({ meal, authorProfile, currentUserId, onClose }) => {
  const { phoneMode } = useSettings();

  const [reviews, setReviews] = useState<HomeMealReview[]>([]);
  const [reviewerProfiles, setReviewerProfiles] = useState<Record<string, UserProfile>>({});
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [saving, setSaving] = useState(false);
  const [myRating, setMyRating] = useState(0);
  const [myHoverRating, setMyHoverRating] = useState<number | null>(null);
  const [myNotes, setMyNotes] = useState('');
  const [submittedAt, setSubmittedAt] = useState<number | null>(null);

  // Is the current user the author of this recipe? Authors don't get a
  // rating form — they only see the aggregated reviews.
  const isAuthor = !!meal && !!currentUserId && meal.userId === currentUserId;

  const summary = useMemo(() => summarizeReviews(reviews), [reviews]);

  // Load reviews + my existing review whenever the modal opens on a new meal.
  useEffect(() => {
    if (!meal) return;
    let cancelled = false;
    setLoadingReviews(true);
    setMyRating(0);
    setMyNotes('');
    setSubmittedAt(null);
    (async () => {
      try {
        const [all, mine] = await Promise.all([
          getHomeMealReviews(meal.id),
          currentUserId ? getMyHomeMealReview(currentUserId, meal.id) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setReviews(all);
        if (mine) {
          setMyRating(mine.rating);
          setMyNotes(mine.notes);
        }
        // Fetch profiles for every reviewer we haven't seen.
        const reviewerIds = Array.from(new Set(all.map((r) => r.userId)));
        if (reviewerIds.length > 0) {
          const map = await getProfilesByIds(reviewerIds);
          if (!cancelled) setReviewerProfiles(map);
        }
      } catch (err) {
        console.warn('[FriendRecipeModal] failed to load reviews:', err);
      } finally {
        if (!cancelled) setLoadingReviews(false);
      }
    })();
    return () => { cancelled = true; };
  }, [meal, currentUserId]);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    if (!meal) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [meal]);

  if (!meal) return null;

  const hasIngredients = (meal.ingredients?.length ?? 0) > 0;
  const hasSteps = (meal.steps?.length ?? 0) > 0;
  const totalTime = (meal.prepTime ?? 0) + (meal.cookTime ?? 0);
  const cover = meal.coverPhoto || meal.photos?.[0]?.url || '';
  const authorName = authorProfile?.display_name || authorProfile?.username || 'A friend';

  const handleSubmitReview = async () => {
    if (!currentUserId || myRating < 1 || !meal) return;
    setSaving(true);
    try {
      const saved = await upsertHomeMealReview(currentUserId, meal.id, {
        rating: myRating,
        notes: myNotes.trim(),
      });
      if (saved) {
        // Merge or replace my review locally so the list updates instantly.
        setReviews((prev) => {
          const filtered = prev.filter((r) => r.userId !== currentUserId);
          return [saved, ...filtered];
        });
        setSubmittedAt(Date.now());
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {meal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[150] flex justify-center"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: phoneMode ? '100%' : 30, opacity: phoneMode ? 1 : 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: phoneMode ? '100%' : 30, opacity: phoneMode ? 1 : 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "bg-surface w-full overflow-hidden flex flex-col",
              phoneMode
                ? "h-full rounded-none"
                : "h-full sm:max-w-2xl sm:max-h-[92vh] sm:h-[92vh] sm:rounded-3xl sm:mt-auto sm:mb-auto",
            )}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-3 flex-shrink-0 border-b border-on-surface/6">
              <button
                onClick={onClose}
                className="p-2 -ml-2 text-on-surface/50 hover:text-on-surface transition-colors"
                aria-label="Back"
              >
                <ArrowLeft size={20} />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-[0.14em] text-on-surface/40 font-medium">
                  {authorName}&rsquo;s recipe
                </p>
                <h2 className="font-serif font-bold text-lg truncate">{meal.name}</h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-5">
              {/* Cover image */}
              {cover && (
                <div className="relative -mx-5 mb-5 overflow-hidden">
                  <img src={cover} alt={meal.name} className="w-full aspect-[16/9] object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                </div>
              )}

              {/* Title block */}
              <div className="mb-5">
                <h1 className="font-serif font-bold text-3xl sm:text-4xl text-on-surface leading-[1.1] mb-2">
                  {meal.name}
                </h1>
                {meal.description && (
                  <p className="text-sm text-on-surface/60 leading-relaxed italic">
                    {meal.description}
                  </p>
                )}
              </div>

              {/* Aggregate rating */}
              <div className="flex items-center gap-4 mb-5 bg-amber-50/60 border border-amber-200/60 rounded-2xl px-4 py-3">
                <div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-serif font-bold text-amber-600 tabular-nums">
                      {summary.count > 0 ? summary.average.toFixed(1) : '—'}
                    </span>
                    <span className="text-xs text-amber-700/60 font-semibold">/ 5</span>
                  </div>
                  <p className="text-[11px] text-amber-700/70 mt-0.5">
                    {summary.count === 0
                      ? 'No reviews yet'
                      : `${summary.count} review${summary.count !== 1 ? 's' : ''}`}
                  </p>
                </div>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((n) => {
                    const filled = summary.count > 0 && n <= Math.round(summary.average);
                    return (
                      <Star
                        key={n}
                        size={18}
                        className={cn(
                          filled ? "text-amber-500 fill-amber-500" : "text-amber-200",
                        )}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Meta bar */}
              {(totalTime > 0 || meal.servings || meal.difficulty) && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-on-surface/8 rounded-2xl overflow-hidden border border-on-surface/8 mb-5">
                  {(meal.prepTime ?? 0) > 0 && (
                    <div className="bg-white px-3 py-2.5">
                      <div className="flex items-center gap-1 mb-0.5">
                        <Clock size={11} className="text-on-surface/40" />
                        <p className="text-[9px] uppercase tracking-[0.12em] text-on-surface/45 font-medium">Prep</p>
                      </div>
                      <p className="font-serif font-bold text-sm text-on-surface leading-tight">{formatDuration(meal.prepTime ?? 0)}</p>
                    </div>
                  )}
                  {(meal.cookTime ?? 0) > 0 && (
                    <div className="bg-white px-3 py-2.5">
                      <div className="flex items-center gap-1 mb-0.5">
                        <Flame size={11} className="text-on-surface/40" />
                        <p className="text-[9px] uppercase tracking-[0.12em] text-on-surface/45 font-medium">Cook</p>
                      </div>
                      <p className="font-serif font-bold text-sm text-on-surface leading-tight">{formatDuration(meal.cookTime ?? 0)}</p>
                    </div>
                  )}
                  {(meal.servings ?? 0) > 0 && (
                    <div className="bg-white px-3 py-2.5">
                      <div className="flex items-center gap-1 mb-0.5">
                        <Users size={11} className="text-on-surface/40" />
                        <p className="text-[9px] uppercase tracking-[0.12em] text-on-surface/45 font-medium">Serves</p>
                      </div>
                      <p className="font-serif font-bold text-sm text-on-surface leading-tight">{meal.servings}</p>
                    </div>
                  )}
                  {meal.difficulty && (
                    <div className="bg-white px-3 py-2.5">
                      <div className="flex items-center gap-1 mb-0.5">
                        <Star size={11} className="text-amber-500 fill-amber-500" />
                        <p className="text-[9px] uppercase tracking-[0.12em] text-on-surface/45 font-medium">Level</p>
                      </div>
                      <p className="font-serif font-bold text-sm text-on-surface leading-tight">{meal.difficulty}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Tags */}
              {meal.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-6">
                  {meal.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center px-3 py-1 bg-amber-50 text-amber-800 rounded-full text-[11px] font-semibold tracking-wide">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Ingredients */}
              {hasIngredients && (
                <section className="bg-white rounded-2xl border border-on-surface/8 p-5 mb-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Hash size={16} className="text-emerald-600" />
                    <h3 className="font-serif font-bold text-lg">Ingredients</h3>
                    <span className="text-[11px] text-on-surface/35">({meal.ingredients!.length})</span>
                  </div>
                  <ul className="space-y-2">
                    {meal.ingredients!.map((ing, i) => (
                      <li key={i} className="flex items-baseline gap-3 text-[15px] leading-[1.6]">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 mt-2" />
                        <span className="flex-1 text-on-surface/80">
                          {(ing.amount || ing.unit) && (
                            <span className="font-semibold text-on-surface tabular-nums">
                              {ing.amount}{ing.unit ? ` ${ing.unit}` : ''}{ing.name ? ' ' : ''}
                            </span>
                          )}
                          <span className="text-on-surface/70">{ing.name}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Directions */}
              {hasSteps && (
                <section className="bg-white rounded-2xl border border-on-surface/8 p-5 mb-6">
                  <div className="flex items-center gap-2 mb-5">
                    <FileText size={16} className="text-emerald-600" />
                    <h3 className="font-serif font-bold text-lg">Directions</h3>
                  </div>
                  <ol className="space-y-5">
                    {meal.steps!.map((step, i) => (
                      <li key={i} className="flex gap-4">
                        <span className="flex-shrink-0 font-serif font-bold text-3xl text-emerald-600/80 leading-none tabular-nums pt-0.5">
                          {i + 1}
                        </span>
                        <p className="flex-1 text-[15px] text-on-surface/85 leading-[1.7] whitespace-pre-wrap pt-1">
                          {step}
                        </p>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {/* ────────── Rating form (viewers only) ────────── */}
              {!isAuthor && currentUserId && (
                <section className="bg-white rounded-2xl border-2 border-emerald-200 p-5 mb-6">
                  <h3 className="font-serif font-bold text-lg mb-1">Rate this recipe</h3>
                  <p className="text-xs text-on-surface/50 mb-4">
                    Tried it? Let {authorName} know what you thought.
                  </p>

                  {/* Star selector */}
                  <div className="flex items-center justify-center gap-1 mb-4">
                    {[1, 2, 3, 4, 5].map((n) => {
                      const displayRating = myHoverRating ?? myRating;
                      const filled = n <= displayRating;
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setMyRating(n)}
                          onMouseEnter={() => setMyHoverRating(n)}
                          onMouseLeave={() => setMyHoverRating(null)}
                          className="p-1 transition-transform hover:scale-110"
                          aria-label={`${n} star${n === 1 ? '' : 's'}`}
                        >
                          <Star
                            size={32}
                            className={cn(
                              "transition-colors",
                              filled ? "text-amber-500 fill-amber-500" : "text-on-surface/20",
                            )}
                          />
                        </button>
                      );
                    })}
                  </div>
                  {myRating > 0 && (
                    <p className="text-center text-xs text-on-surface/55 font-medium mb-4">
                      {['', 'Poor', 'Just ok', 'Good', 'Great', 'Amazing!'][myRating]}
                    </p>
                  )}

                  {/* Notes */}
                  <textarea
                    value={myNotes}
                    onChange={(e) => setMyNotes(e.target.value)}
                    placeholder="Any notes? (optional)"
                    rows={3}
                    className="w-full bg-on-surface/[0.04] border border-on-surface/10 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 resize-none mb-3"
                  />

                  <button
                    onClick={handleSubmitReview}
                    disabled={myRating < 1 || saving}
                    className="w-full py-3 bg-emerald-600 text-white rounded-full font-semibold text-sm hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {saving ? 'Saving…' : submittedAt ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Check size={14} /> Review saved
                      </span>
                    ) : 'Submit review'}
                  </button>
                </section>
              )}

              {/* Reviews list */}
              <section className="mb-6">
                <h3 className="font-serif font-bold text-lg mb-3">
                  {summary.count > 0 ? `Reviews (${summary.count})` : 'Reviews'}
                </h3>
                {loadingReviews ? (
                  <p className="text-sm text-on-surface/40 text-center py-6">Loading reviews…</p>
                ) : reviews.length === 0 ? (
                  <p className="text-sm text-on-surface/40 text-center py-6">
                    Be the first to rate this recipe.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {reviews.map((r) => {
                      const reviewerName = reviewerProfiles[r.userId]?.display_name
                        || reviewerProfiles[r.userId]?.username
                        || (r.userId === currentUserId ? 'You' : 'Someone');
                      return (
                        <div key={r.id} className="bg-white rounded-2xl border border-on-surface/8 p-4">
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <p className="text-sm font-semibold text-on-surface">{reviewerName}</p>
                            <div className="flex gap-0.5">
                              {[1, 2, 3, 4, 5].map((n) => (
                                <Star
                                  key={n}
                                  size={13}
                                  className={cn(
                                    n <= r.rating ? "text-amber-500 fill-amber-500" : "text-on-surface/15",
                                  )}
                                />
                              ))}
                            </div>
                          </div>
                          {r.notes && (
                            <p className="text-[13px] text-on-surface/70 leading-relaxed whitespace-pre-wrap">
                              {r.notes}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
