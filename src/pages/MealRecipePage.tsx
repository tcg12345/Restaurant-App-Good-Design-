/**
 * MealRecipePage — full-page view of a friend's published home meal.
 *
 * Opened when a user clicks a recipe card from the Explore feed. Has two
 * layouts in the same component — a NYT-Cooking-style single-column stack
 * for phones and the editorial two-column layout for desktop — both
 * populated from the same section blocks.
 *
 * Includes a 5-star rating form + list of other viewers' reviews. Only
 * writes happen through upsertHomeMealReview; the meal itself is read-only.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Flame, Users, Hash, FileText, Star, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { getPublicHomeMealById, getProfilesByIds, type FriendHomeMeal, type UserProfile } from '../lib/supabase-community';
import {
  upsertHomeMealReview,
  getHomeMealReviews,
  getMyHomeMealReview,
  summarizeReviews,
  type HomeMealReview,
} from '../lib/supabase-home-meal-reviews';
import {
  formatDuration,
  formatDurationCompact,
  getMealCoverUrl,
  scaleQuantity,
  extractStepMinutes,
  StepTimer,
  PhotoLightbox,
} from '../lib/recipe-display';

const scoreColor = (s: number) => s >= 8 ? 'text-green-600' : s >= 5 ? 'text-yellow-600' : 'text-red-500';

export const MealRecipePage: React.FC = () => {
  const { userId: authorId = '', mealId = '' } = useParams<{ userId: string; mealId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const { phoneMode } = useSettings();

  // ── Meal + author ──
  const [meal, setMeal] = useState<FriendHomeMeal | null>(null);
  const [authorProfile, setAuthorProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // ── Reviews ──
  const [reviews, setReviews] = useState<HomeMealReview[]>([]);
  const [reviewerProfiles, setReviewerProfiles] = useState<Record<string, UserProfile>>({});
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [saving, setSaving] = useState(false);
  const [myRating, setMyRating] = useState(0);
  const [myHoverRating, setMyHoverRating] = useState<number | null>(null);
  const [myNotes, setMyNotes] = useState('');
  const [submittedAt, setSubmittedAt] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState(false);

  // ── Transient recipe-page UI state (display-only) ──
  const [servingsScale, setServingsScale] = useState(1);
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(new Set());
  const [lightboxPhotoIdx, setLightboxPhotoIdx] = useState<number | null>(null);

  // Load the meal and author profile.
  useEffect(() => {
    if (!authorId || !mealId) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    (async () => {
      const [m, profileMap] = await Promise.all([
        getPublicHomeMealById(authorId, mealId),
        getProfilesByIds([authorId]),
      ]);
      if (cancelled) return;
      if (!m) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setMeal(m);
      setAuthorProfile(profileMap[authorId] ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authorId, mealId]);

  // Load reviews + the current user's existing review.
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
        const reviewerIds = Array.from(new Set(all.map((r) => r.userId)));
        if (reviewerIds.length > 0) {
          const map = await getProfilesByIds(reviewerIds);
          if (!cancelled) setReviewerProfiles(map);
        }
      } catch (err) {
        console.warn('[MealRecipePage] failed to load reviews:', err);
      } finally {
        if (!cancelled) setLoadingReviews(false);
      }
    })();
    return () => { cancelled = true; };
  }, [meal, currentUserId]);

  const toggleCheckedIngredient = (idx: number) => {
    setCheckedIngredients((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const summary = useMemo(() => summarizeReviews(reviews), [reviews]);

  const handleSubmitReview = async () => {
    if (!currentUserId || !meal || myRating < 1) return;
    setSaving(true);
    setSubmitError(false);
    try {
      const saved = await upsertHomeMealReview(currentUserId, meal.id, {
        rating: myRating,
        notes: myNotes.trim(),
      });
      if (saved) {
        setReviews((prev) => {
          const filtered = prev.filter((r) => r.userId !== currentUserId);
          return [saved, ...filtered];
        });
        setSubmittedAt(Date.now());
      } else {
        setSubmitError(true);
      }
    } catch {
      setSubmitError(true);
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──
  if (loading) {
    return (
      <div className="max-w-[880px] mx-auto px-3 py-6">
        <div className="animate-pulse space-y-4">
          <div className="h-10 w-24 bg-on-surface/5 rounded-full" />
          <div className="h-8 w-2/3 bg-on-surface/5 rounded" />
          <div className="h-6 w-1/2 bg-on-surface/5 rounded" />
          <div className="h-40 bg-on-surface/5 rounded-2xl" />
          <div className="h-40 bg-on-surface/5 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (notFound || !meal) {
    return (
      <div className="max-w-[880px] mx-auto px-3 py-12 text-center">
        <p className="text-sm font-semibold text-on-surface/50">Recipe not found</p>
        <p className="text-xs text-on-surface/35 mt-1">It may have been deleted or made private.</p>
        <button onClick={() => navigate(-1)} className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-on-surface/5 text-sm font-semibold text-on-surface/60 hover:bg-on-surface/10 transition-colors">
          <ArrowLeft size={14} /> Back
        </button>
      </div>
    );
  }

  const allPhotos = [
    ...(meal.coverPhoto ? [{ url: meal.coverPhoto, caption: '' }] : []),
    ...meal.photos.map((p) => ({ url: p.url, caption: p.caption })),
  ];
  const hasIngredients = (meal.ingredients?.length ?? 0) > 0;
  const hasSteps = (meal.steps?.length ?? 0) > 0;
  const totalTime = (meal.prepTime ?? 0) + (meal.cookTime ?? 0);

  // Desktop cover image derives from coverPhoto → first photo.
  const coverUrl = getMealCoverUrl(meal);

  // Servings scaling.
  const baseServings = meal.servings && meal.servings > 0 ? meal.servings : 4;
  const displayServings = Math.max(1, Math.round(baseServings * servingsScale));

  const jumpTargets: { id: string; label: string }[] = [
    ...(hasIngredients ? [{ id: 'ingredients', label: 'Ingredients' }] : []),
    ...(hasSteps ? [{ id: 'directions', label: 'Directions' }] : []),
    ...(meal.description ? [{ id: 'notes', label: 'Notes' }] : []),
    ...(allPhotos.length > 0 ? [{ id: 'photos', label: 'Photos' }] : []),
    { id: 'rate', label: 'Rate' },
  ];

  const authorName = authorProfile?.display_name || authorProfile?.username || 'A friend';
  const isAuthor = !!currentUserId && meal.userId === currentUserId;

  // ── Reusable section blocks, rendered identically on phone and desktop
  // but laid out differently around them. ──

  const titleBlock = (
    <header>
      <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-on-surface/40 font-medium mb-2">
        {new Date(meal.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
      </p>
      <h1 className="font-serif font-bold text-[28px] leading-[1.1] sm:text-5xl text-on-surface mb-4">
        {meal.name}
      </h1>

      {/* Aggregate rating callout */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-baseline">
          <span className="text-5xl font-serif font-bold tabular-nums text-amber-600">
            {summary.count > 0 ? summary.average.toFixed(1) : '—'}
          </span>
          <span className="text-sm text-on-surface/35 font-medium ml-1">/ 5</span>
        </div>
        <div>
          <div className="flex gap-0.5 mb-0.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <Star
                key={n}
                size={15}
                className={cn(
                  summary.count > 0 && n <= Math.round(summary.average)
                    ? "text-amber-500 fill-amber-500"
                    : "text-amber-200",
                )}
              />
            ))}
          </div>
          <p className="text-[11px] text-on-surface/50">
            {summary.count === 0 ? 'No reviews yet' : `${summary.count} review${summary.count !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* Tag pills */}
      {meal.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {meal.tags.map((tag) => (
            <span key={tag} className="inline-flex items-center px-3 py-1 bg-amber-50 text-amber-800 rounded-full text-[11px] font-semibold tracking-wide">
              {tag}
            </span>
          ))}
        </div>
      )}
    </header>
  );

  // Stat cards. On phone we stack as a 2-col grid with a compact duration
  // format ("2h 45m") and nowrap values so nothing ever wraps to a new line
  // or overflows a cell. Desktop keeps the wider 5-col grid.
  const durationLabel = (m: number) => phoneMode ? formatDurationCompact(m) : formatDuration(m);
  const statCells: { key: string; icon: React.ReactNode; label: string; value: string }[] = [];
  if ((meal.prepTime ?? 0) > 0) {
    statCells.push({ key: 'prep', icon: <Clock size={12} className="text-on-surface/40" />, label: 'Prep', value: durationLabel(meal.prepTime ?? 0) });
  }
  if ((meal.cookTime ?? 0) > 0) {
    statCells.push({ key: 'cook', icon: <Flame size={12} className="text-on-surface/40" />, label: 'Cook', value: durationLabel(meal.cookTime ?? 0) });
  }
  if (totalTime > 0 && (meal.prepTime ?? 0) > 0 && (meal.cookTime ?? 0) > 0) {
    statCells.push({ key: 'total', icon: <Clock size={12} className="text-on-surface/40" />, label: 'Total', value: durationLabel(totalTime) });
  }
  if ((meal.servings ?? 0) > 0) {
    statCells.push({ key: 'serves', icon: <Users size={12} className="text-on-surface/40" />, label: 'Serves', value: String(meal.servings) });
  }
  if (meal.difficulty) {
    statCells.push({ key: 'difficulty', icon: <Star size={12} className="text-amber-500 fill-amber-500" />, label: 'Difficulty', value: meal.difficulty });
  }

  const statCardsBlock = statCells.length > 0 ? (
    <div className={cn(
      "grid gap-px bg-on-surface/8 rounded-2xl overflow-hidden border border-on-surface/8",
      phoneMode ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
    )}>
      {statCells.map((c) => (
        <div key={c.key} className="bg-white px-4 py-3 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            {c.icon}
            <p className="text-[10px] uppercase tracking-[0.14em] text-on-surface/45 font-medium truncate">{c.label}</p>
          </div>
          <p className="font-serif font-bold text-lg text-on-surface leading-tight whitespace-nowrap truncate">{c.value}</p>
        </div>
      ))}
    </div>
  ) : null;

  const ingredientsBlock = hasIngredients ? (
    <section id="ingredients">
      <div className="bg-white rounded-2xl border border-on-surface/8 p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-3 mb-4">
          <h2 className="font-serif font-bold text-2xl text-on-surface">Ingredients</h2>
          <span className="text-[11px] text-on-surface/40 font-medium">
            {meal.ingredients!.length} item{meal.ingredients!.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 mb-4 pb-4 border-b border-on-surface/6">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-on-surface/45 font-medium mb-0.5">Scale for</p>
            <p className="text-sm font-semibold text-on-surface tabular-nums">
              {displayServings} serving{displayServings !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-1 bg-on-surface/[0.04] border border-on-surface/10 rounded-full">
            <button
              type="button"
              onClick={() => setServingsScale(Math.max(0.25, (displayServings - 1) / baseServings))}
              disabled={displayServings <= 1}
              className="w-9 h-9 flex items-center justify-center text-on-surface/60 hover:text-on-surface disabled:opacity-30 transition-colors text-lg"
              aria-label="Decrease servings"
            >−</button>
            <div className="w-9 text-center text-sm font-semibold tabular-nums">{displayServings}</div>
            <button
              type="button"
              onClick={() => setServingsScale((displayServings + 1) / baseServings)}
              className="w-9 h-9 flex items-center justify-center text-on-surface/60 hover:text-on-surface transition-colors text-lg"
              aria-label="Increase servings"
            >+</button>
          </div>
        </div>

        <ul className="space-y-0.5">
          {meal.ingredients!.map((ing, i) => {
            const isChecked = checkedIngredients.has(i);
            const scaledAmount = ing.amount ? scaleQuantity(ing.amount, servingsScale) : '';
            return (
              <li key={i}>
                <label className={cn(
                  "flex items-baseline gap-3 py-2.5 cursor-pointer group transition-colors",
                  isChecked && "opacity-40",
                )}>
                  <span className="flex items-center flex-shrink-0 translate-y-[2px]">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleCheckedIngredient(i)}
                      className="sr-only peer"
                    />
                    <span className={cn(
                      "w-[20px] h-[20px] rounded border-2 flex items-center justify-center transition-all",
                      isChecked
                        ? "bg-emerald-500 border-emerald-500 text-white"
                        : "border-on-surface/20 group-hover:border-on-surface/40",
                    )}>
                      {isChecked && <Check size={13} strokeWidth={3} />}
                    </span>
                  </span>
                  <span className={cn(
                    "flex-1 text-[15px] sm:text-[15px] leading-[1.6] text-on-surface/80",
                    isChecked && "line-through",
                  )}>
                    {(scaledAmount || ing.unit) && (
                      <span className="font-semibold text-on-surface tabular-nums">
                        {scaledAmount}{ing.unit ? ` ${ing.unit}` : ''}
                        {ing.name ? ' ' : ''}
                      </span>
                    )}
                    <span className="text-on-surface/70">{ing.name}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  ) : null;

  const directionsBlock = hasSteps ? (
    <section id="directions">
      <div className="bg-white rounded-2xl border border-on-surface/8 p-5 sm:p-6">
        <h2 className="font-serif font-bold text-2xl text-on-surface mb-5">Directions</h2>
        <ol className="space-y-5">
          {meal.steps!.map((step, i) => {
            const timerMinutes = extractStepMinutes(step);
            return (
              <li key={i} className="border-b border-on-surface/6 last:border-0 pb-5 last:pb-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-600 mb-1.5">
                  Step {i + 1}
                </p>
                <p className="text-[16px] leading-[1.7] text-on-surface/85 whitespace-pre-wrap">
                  {step}
                </p>
                {timerMinutes !== null && (
                  <div className="mt-2">
                    <StepTimer minutes={timerMinutes} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  ) : null;

  const notesBlock = meal.description ? (
    <section id="notes">
      <h2 className="font-serif font-bold text-xl text-on-surface mb-3">Notes</h2>
      <blockquote className="relative bg-amber-50/60 border-l-4 border-amber-400 rounded-r-xl px-5 py-4 sm:px-6 sm:py-5">
        <p className="italic font-serif text-on-surface/75 leading-[1.7] text-[15px] sm:text-[16px] whitespace-pre-wrap">
          {meal.description}
        </p>
      </blockquote>
    </section>
  ) : null;

  const photosBlock = allPhotos.length > 0 ? (
    <section id="photos">
      <h2 className="font-serif font-bold text-xl text-on-surface mb-3">Photos</h2>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
        {allPhotos.map((photo, i) => (
          <button
            key={i}
            onClick={() => setLightboxPhotoIdx(i)}
            className="aspect-square rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
          >
            <img src={photo.url} alt={photo.caption || `Photo ${i + 1}`} className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
    </section>
  ) : null;

  const rateBlock = (
    <section id="rate">
      <h2 className="font-serif font-bold text-xl text-on-surface mb-3">Rate this recipe</h2>
      {!currentUserId ? (
        <p className="text-sm text-on-surface/50 italic">Sign in to leave a rating.</p>
      ) : isAuthor ? (
        <p className="text-sm text-on-surface/50 italic">You can&rsquo;t rate your own recipe.</p>
      ) : (
        <div className="bg-white rounded-2xl border-2 border-emerald-200 p-5 sm:p-6">
          <p className="text-sm text-on-surface/60 mb-4">
            Tried it? Let {authorName} know what you thought.
          </p>

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
                    size={40}
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
            <p className="text-center text-sm text-on-surface/55 font-medium mb-4">
              {['', 'Poor', 'Just ok', 'Good', 'Great', 'Amazing!'][myRating]}
            </p>
          )}

          <textarea
            value={myNotes}
            onChange={(e) => setMyNotes(e.target.value)}
            placeholder="Any notes? (optional)"
            rows={4}
            className="w-full bg-on-surface/[0.04] border border-on-surface/10 rounded-xl py-3 px-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 resize-none mb-3"
          />

          <button
            onClick={handleSubmitReview}
            disabled={myRating < 1 || saving}
            className="w-full py-3.5 bg-emerald-600 text-white rounded-full font-semibold text-sm hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : submittedAt ? (
              <span className="inline-flex items-center gap-1.5">
                <Check size={14} /> Review saved
              </span>
            ) : 'Submit review'}
          </button>
          {submitError && (
            <p className="text-xs text-red-500 text-center mt-2">
              Something went wrong. Please try again.
            </p>
          )}
        </div>
      )}
    </section>
  );

  const reviewsBlock = (
    <section>
      <h2 className="font-serif font-bold text-xl text-on-surface mb-3">
        {summary.count > 0 ? `Reviews (${summary.count})` : 'Reviews'}
      </h2>
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
  );

  // ── Phone layout: single stacked column, NYT Cooking style ──
  if (phoneMode) {
    return (
      <div className="max-w-[680px] mx-auto pb-32">
        {/* Back header */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-2">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-on-surface/50 hover:text-on-surface transition-colors" aria-label="Back">
            <ArrowLeft size={22} />
          </button>
          <p className="text-[10px] uppercase tracking-[0.14em] text-on-surface/40 font-medium truncate">
            From {authorName}&rsquo;s kitchen
          </p>
        </div>

        {/* Full-width hero photo */}
        {coverUrl && (
          <button
            type="button"
            onClick={() => setLightboxPhotoIdx(0)}
            className="block w-full overflow-hidden relative mt-2 mb-5"
            aria-label="Open photo gallery"
          >
            <img src={coverUrl} alt={meal.name} className="w-full aspect-[4/3] object-cover" />
          </button>
        )}

        {/* Stacked content */}
        <div className="px-5 space-y-8">
          {titleBlock}
          {statCardsBlock}
          {ingredientsBlock}
          {directionsBlock}
          {notesBlock}
          {photosBlock}
          {rateBlock}
          {reviewsBlock}
        </div>

        <PhotoLightbox
          photos={allPhotos}
          index={lightboxPhotoIdx}
          onClose={() => setLightboxPhotoIdx(null)}
          onChange={setLightboxPhotoIdx}
        />
      </div>
    );
  }

  // ── Desktop layout: editorial with side-by-side ingredients + directions ──
  return (
    <div className="max-w-[880px] mx-auto px-3 pb-32 pt-4">
      {/* Back header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-on-surface/40 hover:text-on-surface transition-colors" aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <p className="text-[11px] uppercase tracking-[0.14em] text-on-surface/40 font-medium">
          From {authorName}&rsquo;s kitchen
        </p>
      </div>

      {/* Hero row: heading on left, cover image on right */}
      <div className="grid md:grid-cols-[minmax(0,1fr)_240px] gap-6 items-stretch mb-8">
        {titleBlock}
        {coverUrl && (
          <button
            type="button"
            onClick={() => setLightboxPhotoIdx(0)}
            className="hidden md:block relative rounded-2xl overflow-hidden border border-on-surface/8 group"
            aria-label="Open photo gallery"
          >
            <img src={coverUrl} alt={meal.name} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors" />
          </button>
        )}
      </div>

      {statCardsBlock && <div className="mb-8">{statCardsBlock}</div>}

      {/* Sticky jump nav */}
      {jumpTargets.length > 1 && (
        <nav className="sticky top-0 z-20 bg-surface/85 backdrop-blur-md border-b border-on-surface/8 mb-6">
          <div className="flex gap-1 py-2.5 overflow-x-auto scrollbar-hide">
            {jumpTargets.map((t) => (
              <a
                key={t.id}
                href={`#${t.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  const el = document.getElementById(t.id);
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="px-3 py-1.5 rounded-full text-xs font-semibold text-on-surface/60 hover:bg-on-surface/5 hover:text-on-surface transition-colors whitespace-nowrap"
              >
                {t.label}
              </a>
            ))}
          </div>
        </nav>
      )}

      {/* Two-column ingredients + directions */}
      <div className="grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-10 mb-10">
        <div className="md:sticky md:top-16 md:self-start">{ingredientsBlock}</div>
        {directionsBlock}
      </div>

      <div className="space-y-8 mb-12">
        {notesBlock}
        {photosBlock}
        {rateBlock}
        {reviewsBlock}
      </div>

      <PhotoLightbox
        photos={allPhotos}
        index={lightboxPhotoIdx}
        onClose={() => setLightboxPhotoIdx(null)}
        onChange={setLightboxPhotoIdx}
      />
    </div>
  );
};
