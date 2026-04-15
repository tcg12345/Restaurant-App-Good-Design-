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
import { ArrowLeft, Star, Check, Share2 } from 'lucide-react';
import { ShareRecipeSheet } from '../components/ShareRecipeSheet';
import type { SharedRecipe } from '../contexts/ChatContext';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useLists } from '../contexts/ListsContext';
import { getPublicHomeMealById, getProfilesByIds, getFriends, type FriendHomeMeal, type UserProfile } from '../lib/supabase-community';
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
  PhotoLightbox,
  RecipeQuickInfoRow,
  RecipeIngredientList,
  RecipeDirectionsList,
  RecipeReviewList,
  RecipeMobileSectionNav,
  type QuickInfoItem,
  type ReviewListItem,
} from '../lib/recipe-display';

export const MealRecipePage: React.FC = () => {
  const { userId: authorId = '', mealId = '' } = useParams<{ userId: string; mealId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const { phoneMode } = useSettings();
  const { restaurantMeta, stashMetaKey } = useLists();

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
  const [shareRecipeData, setShareRecipeData] = useState<SharedRecipe | null>(null);

  // ── Transient recipe-page UI state (display-only) ──
  // Ingredient checkbox state lives in RecipesContext now (keyed by `meal-${id}`)
  // so it survives in-session navigation away and back to the recipe page.
  const [servingsScale, setServingsScale] = useState(1);
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
        // Build the list of user IDs whose meta we should scan for reviews:
        // the author (author's own reviews wouldn't count but if they ever
        // reviewed something in that column it's harmless), the viewer, and
        // all of the viewer's friends (they're likely reviewers).
        let scanIds: string[] = [meal.userId];
        if (currentUserId) {
          scanIds.push(currentUserId);
          try {
            const friends = await getFriends(currentUserId);
            scanIds = [...new Set([...scanIds, ...friends.map((f) => f.friend_id)])];
          } catch { /* best-effort */ }
        }
        const [all, mine] = await Promise.all([
          getHomeMealReviews(meal.id, scanIds),
          currentUserId ? getMyHomeMealReview(currentUserId, meal.id) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setReviews(all);
        // Check Supabase first, then the in-memory ListsContext meta as a
        // secondary source (it's guaranteed to survive across meta syncs).
        let myReview = mine;
        if (!myReview && currentUserId) {
          const metaReviews = ((restaurantMeta as Record<string, unknown>).__my_meal_reviews__ ?? {}) as Record<string, { rating: number; notes: string }>;
          const localEntry = metaReviews[meal.id];
          if (localEntry) myReview = { id: 'local', userId: currentUserId, mealId: meal.id, rating: localEntry.rating, notes: localEntry.notes || '', createdAt: '', updatedAt: '' };
        }
        if (myReview) {
          setMyRating(myReview.rating);
          setMyNotes(myReview.notes);
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

  const summary = useMemo(() => summarizeReviews(reviews), [reviews]);

  const handleSubmitReview = async () => {
    if (!currentUserId || !meal || myRating < 1) return;
    setSaving(true);
    setSubmitError(false);
    try {
      const reviewData = { rating: myRating, notes: myNotes.trim() };
      const saved = await upsertHomeMealReview(currentUserId, meal.id, reviewData);

      // Regardless of whether the table or the meta fallback succeeded, also
      // write through ListsContext so the in-memory meta stays in sync and
      // future meta syncs won't overwrite the stashed review.
      const existingReviews = ((restaurantMeta as Record<string, unknown>).__my_meal_reviews__ ?? {}) as Record<string, unknown>;
      stashMetaKey('__my_meal_reviews__', {
        ...existingReviews,
        [meal.id]: { rating: myRating, notes: myNotes.trim(), updatedAt: new Date().toISOString() },
      });

      if (saved) {
        setReviews((prev) => {
          const filtered = prev.filter((r) => r.userId !== currentUserId);
          return [saved, ...filtered];
        });
        setSubmittedAt(Date.now());
      } else {
        // The meta fallback via stashMetaKey is already done above, so the
        // review IS persisted — just show success.
        setSubmittedAt(Date.now());
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

  // Servings scaling — the shared RecipeIngredientList handles the math; we
  // just pass it the base servings + the current scale.
  const baseServings = meal.servings && meal.servings > 0 ? meal.servings : 4;

  const jumpTargets: { id: string; label: string }[] = [
    ...(hasIngredients ? [{ id: 'ingredients', label: 'Ingredients' }] : []),
    ...(hasSteps ? [{ id: 'directions', label: 'Directions' }] : []),
    ...(meal.description ? [{ id: 'notes', label: 'Notes' }] : []),
    ...(allPhotos.length > 0 ? [{ id: 'photos', label: 'Photos' }] : []),
    { id: 'rate', label: 'Rate' },
  ];

  const authorName = authorProfile?.display_name || authorProfile?.username || 'A friend';

  const buildSharedRecipe = (): SharedRecipe => ({
    mealId: meal.id,
    authorId: meal.userId,
    authorName,
    name: meal.name,
    image: coverUrl,
    description: meal.description || undefined,
    tags: meal.tags.length > 0 ? meal.tags : undefined,
    totalTime: totalTime || undefined,
    difficulty: meal.difficulty || undefined,
    ingredientCount: meal.ingredients?.length || undefined,
    stepCount: meal.steps?.length || undefined,
  });
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

  // Magazine metadata row — flat, no card. Compact durations on phone so the
  // values never wrap, longer "2 hr 45 min" formatting on desktop.
  const durationLabel = (m: number) => phoneMode ? formatDurationCompact(m) : formatDuration(m);
  const quickInfoItems: QuickInfoItem[] = [];
  if ((meal.prepTime ?? 0) > 0) quickInfoItems.push({ label: 'Prep', value: durationLabel(meal.prepTime ?? 0) });
  if ((meal.cookTime ?? 0) > 0) quickInfoItems.push({ label: 'Cook', value: durationLabel(meal.cookTime ?? 0) });
  if (totalTime > 0 && (meal.prepTime ?? 0) > 0 && (meal.cookTime ?? 0) > 0) {
    quickInfoItems.push({ label: 'Total', value: durationLabel(totalTime) });
  }
  if ((meal.servings ?? 0) > 0) quickInfoItems.push({ label: 'Serves', value: String(meal.servings) });
  if (meal.difficulty) {
    quickInfoItems.push({ label: 'Level', value: meal.difficulty.charAt(0).toUpperCase() + meal.difficulty.slice(1) });
  }

  const statCardsBlock = quickInfoItems.length > 0 ? (
    <div className="py-4 border-y border-on-surface/8">
      <RecipeQuickInfoRow items={quickInfoItems} />
    </div>
  ) : null;

  const ingredientsBlock = hasIngredients ? (
    <section id="ingredients" className="scroll-mt-20">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h2 className="font-serif font-bold text-2xl text-on-surface">Ingredients</h2>
        <span className="text-[11px] text-on-surface/40 font-medium">
          {meal.ingredients!.length} item{meal.ingredients!.length !== 1 ? 's' : ''}
        </span>
      </div>
      <RecipeIngredientList
        recipeKey={`meal-${meal.id}`}
        ingredients={meal.ingredients!}
        servings={{
          base: baseServings,
          scale: servingsScale,
          onScaleChange: setServingsScale,
        }}
      />
    </section>
  ) : null;

  const directionsBlock = hasSteps ? (
    <section id="directions" className="scroll-mt-20">
      <h2 className="font-serif font-bold text-2xl text-on-surface mb-4">Directions</h2>
      <RecipeDirectionsList steps={meal.steps!} />
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

  const reviewListItems: ReviewListItem[] = reviews.map((r) => ({
    id: r.id,
    userId: r.userId,
    rating: r.rating,
    notes: r.notes,
    createdAt: r.createdAt,
  }));

  const reviewsBlock = (
    <section id="reviews" className="scroll-mt-20">
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
        <RecipeReviewList
          reviews={reviewListItems}
          profiles={reviewerProfiles}
          currentUserId={currentUserId}
          renderRating={(rating) => (
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  size={13}
                  className={cn(
                    n <= rating ? "text-amber-500 fill-amber-500" : "text-on-surface/15",
                  )}
                />
              ))}
            </div>
          )}
        />
      )}
    </section>
  );

  // Mobile section nav targets — same set as desktop jumpTargets but tuned to
  // the editorial section IDs we wire onto each block.
  const mobileSections: { id: string; label: string }[] = [
    ...(hasIngredients ? [{ id: 'ingredients', label: 'Ingredients' }] : []),
    ...(hasSteps ? [{ id: 'directions', label: 'Directions' }] : []),
    ...(meal.description ? [{ id: 'notes', label: 'Notes' }] : []),
    { id: 'reviews', label: 'Reviews' },
  ];

  // ── Phone layout: single stacked column, NYT Cooking style ──
  if (phoneMode) {
    return (
      <div className="max-w-[680px] mx-auto pb-32">
        {/* Back header */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-2">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-on-surface/50 hover:text-on-surface transition-colors" aria-label="Back">
            <ArrowLeft size={22} />
          </button>
          <p className="flex-1 text-[10px] uppercase tracking-[0.14em] text-on-surface/40 font-medium truncate">
            From {authorName}&rsquo;s kitchen
          </p>
          <button onClick={() => setShareRecipeData(buildSharedRecipe())}
            className="p-2 -mr-2 text-on-surface/40 hover:text-emerald-600 transition-colors" aria-label="Share">
            <Share2 size={20} />
          </button>
        </div>

        {/* Full-width hero photo */}
        {coverUrl && (
          <button
            type="button"
            onClick={() => setLightboxPhotoIdx(0)}
            className="block w-full overflow-hidden relative mt-2"
            aria-label="Open photo gallery"
          >
            <img src={coverUrl} alt={meal.name} className="w-full aspect-[4/3] object-cover" />
          </button>
        )}

        {/* Sticky section nav (sticks to top once scrolled past the hero) */}
        <RecipeMobileSectionNav sections={mobileSections} />

        {/* Stacked content */}
        <div className="px-5 pt-6 space-y-8">
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

        <ShareRecipeSheet
          open={!!shareRecipeData}
          recipe={shareRecipeData}
          onClose={() => setShareRecipeData(null)}
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
        <p className="flex-1 text-[11px] uppercase tracking-[0.14em] text-on-surface/40 font-medium">
          From {authorName}&rsquo;s kitchen
        </p>
        <button onClick={() => setShareRecipeData(buildSharedRecipe())}
          className="p-2 -mr-2 text-on-surface/40 hover:text-emerald-600 transition-colors" aria-label="Share">
          <Share2 size={18} />
        </button>
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
        <nav className="sticky top-0 z-20 bg-surface/75 backdrop-blur-md mb-6">
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

      <ShareRecipeSheet
        open={!!shareRecipeData}
        recipe={shareRecipeData}
        onClose={() => setShareRecipeData(null)}
      />
    </div>
  );
};
