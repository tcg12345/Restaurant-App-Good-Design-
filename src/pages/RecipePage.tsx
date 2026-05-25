/**
 * RecipePage — single canonical recipe detail page.
 *
 * Replaces the old RecipeDetail (formal recipes at /recipe/:id) and
 * MealRecipePage (home meals at /meal/:userId/:mealId). Mounts at
 * /recipe/:userId/:id (new canonical) AND /meal/:userId/:mealId
 * (kept as an alias so reels/messages/RecipePanel keep working).
 *
 * Data-source-agnostic: the page resolves the recipe by trying:
 *   1. Local stores when the current user is the owner (own recipes
 *      from RecipesContext, own home meals from ListsContext).
 *   2. The formal `recipes` table (when the id is UUID-shaped).
 *   3. `user_app_data.home_meals` via getPublicHomeMealById.
 * Whichever wins is normalized into a common view model; reviews and the
 * owner-edit affordance branch on the matched source.
 *
 * Layout: editorial 60vh hero with title overlay on phone, two-column
 * editorial split on desktop with sticky ingredients next to directions.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Share2, Star, Check, Edit3, MessageSquare, ChefHat, Loader2,
} from 'lucide-react';
import { ShareRecipeSheet } from '../components/ShareRecipeSheet';
import type { SharedRecipe } from '../contexts/ChatContext';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useLists } from '../contexts/ListsContext';
import { useRecipes, type Recipe, type RecipeIngredient, type RecipeReview } from '../contexts/RecipesContext';
import {
  getPublicHomeMealById,
  getProfilesByIds,
  getFriends,
  type FriendHomeMeal,
  type UserProfile,
} from '../lib/supabase-community';
import { getRecipe as fetchRecipeFromDb, getRecipeReviews } from '../lib/supabase-recipes';
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
  PhotoLightbox,
  RecipeQuickInfoRow,
  RecipeIngredientList,
  RecipeDirectionsList,
  RecipeReviewList,
  RecipeMobileSectionNav,
  RecipeEmptyState,
  type QuickInfoItem,
  type ReviewListItem,
} from '../lib/recipe-display';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuidLike = (v: string): boolean => UUID_RE.test(v);

const DIFFICULTY_LABEL: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/* ── Unified view model ─────────────────────────────────────────────────
   Both `Recipe` (from the `recipes` table) and `FriendHomeMeal` (from
   `user_app_data.home_meals`) collapse into this shape so the rest of
   the page renders identically regardless of source. The `source` flag
   drives the few branches that have to differ — review table, rating
   scale, edit affordance, etc.
   ──────────────────────────────────────────────────────────────────── */
type UnifiedRecipe = {
  source: 'recipe' | 'homeMeal';
  id: string;
  ownerId: string;
  title: string;
  description: string;
  cuisine: string;
  difficulty: 'easy' | 'medium' | 'hard' | '';
  tags: string[];
  ingredients: RecipeIngredient[];
  steps: string[];
  photos: Array<{ url: string; caption: string }>;
  coverPhoto: string;
  prepMinutes: number;
  cookMinutes: number;
  servings: number;
  date?: string;
  authorScore?: number;
  sourceType?: 'user' | 'expert';
  raw: Recipe | FriendHomeMeal;
};

function adaptRecipe(r: Recipe): UnifiedRecipe {
  const photos = (r.photos || []).map((url) => ({ url, caption: '' }));
  return {
    source: 'recipe',
    id: r.id,
    ownerId: r.userId,
    title: r.title || '',
    description: r.description || '',
    cuisine: r.cuisine || '',
    difficulty: (r.difficulty || '') as UnifiedRecipe['difficulty'],
    tags: r.tags || [],
    ingredients: r.ingredients || [],
    steps: (r.steps || []).map((s) => s.text),
    photos,
    coverPhoto: photos[0]?.url || '',
    prepMinutes: r.prepTimeMinutes ?? 0,
    cookMinutes: r.cookTimeMinutes ?? 0,
    servings: r.servings ?? 0,
    date: r.updatedAt || r.createdAt,
    sourceType: r.sourceType,
    raw: r,
  };
}

function adaptHomeMeal(m: FriendHomeMeal): UnifiedRecipe {
  const photoList = [
    ...(m.coverPhoto ? [{ url: m.coverPhoto, caption: '' }] : []),
    ...(m.photos || []).map((p) => ({ url: p.url, caption: p.caption })),
  ];
  return {
    source: 'homeMeal',
    id: m.id,
    ownerId: m.userId,
    title: m.name || '',
    description: m.description || '',
    cuisine: m.cuisine || '',
    difficulty: ((m.difficulty || '').toLowerCase() || '') as UnifiedRecipe['difficulty'],
    tags: m.tags || [],
    ingredients: m.ingredients || [],
    steps: m.steps || [],
    photos: photoList,
    coverPhoto: photoList[0]?.url || '',
    prepMinutes: m.prepTime ?? 0,
    cookMinutes: m.cookTime ?? 0,
    servings: m.servings ?? 0,
    date: m.date,
    authorScore: m.score,
    raw: m,
  };
}

export const RecipePage: React.FC = () => {
  const params = useParams<{ userId?: string; id?: string; mealId?: string }>();
  // Support both /recipe/:userId/:id and /meal/:userId/:mealId.
  const ownerId = params.userId || '';
  const resolvedId = params.id || params.mealId || '';

  const navigate = useNavigate();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const { phoneMode } = useSettings();
  const { restaurantMeta, stashMetaKey, homeMeals: myHomeMeals } = useLists();
  const { myRecipes, openRecipeModal } = useRecipes();

  const [data, setData] = useState<UnifiedRecipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [authorProfile, setAuthorProfile] = useState<UserProfile | null>(null);

  // ── Home-meal review state ──
  const [homeMealReviews, setHomeMealReviews] = useState<HomeMealReview[]>([]);
  const [reviewerProfiles, setReviewerProfiles] = useState<Record<string, UserProfile>>({});
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [saving, setSaving] = useState(false);
  const [myRating, setMyRating] = useState(0);
  const [myHoverRating, setMyHoverRating] = useState<number | null>(null);
  const [myNotes, setMyNotes] = useState('');
  const [submittedAt, setSubmittedAt] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState(false);

  // ── Formal-recipe review state ──
  const [formalReviews, setFormalReviews] = useState<RecipeReview[]>([]);

  // ── Transient UI ──
  const [servingsScale, setServingsScale] = useState(1);
  const [lightboxPhotoIdx, setLightboxPhotoIdx] = useState<number | null>(null);
  const [shareRecipeData, setShareRecipeData] = useState<SharedRecipe | null>(null);

  // ── Load the recipe ──
  useEffect(() => {
    if (!resolvedId) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setData(null);
    setAuthorProfile(null);

    (async () => {
      // 1. Local stores win when the current user owns the content.
      //    This lets the cookbook open the user's own (potentially
      //    private) meals without hitting the public-meal endpoint.
      if (ownerId && currentUserId === ownerId) {
        const ownRecipe = myRecipes.find((r) => r.id === resolvedId);
        if (ownRecipe) {
          if (!cancelled) {
            setData(adaptRecipe(ownRecipe));
            setLoading(false);
          }
          return;
        }
        const ownMeal = myHomeMeals.find((m) => m.id === resolvedId);
        if (ownMeal) {
          if (!cancelled) {
            setData(adaptHomeMeal({ ...ownMeal, userId: ownerId }));
            setLoading(false);
          }
          return;
        }
      }

      // 2. Formal recipe lookup. The id column is uuid, so only try the
      //    table when the id is shaped like one — otherwise PostgREST
      //    400s and the console gets noisy for every home-meal load.
      if (isUuidLike(resolvedId)) {
        const formal = await fetchRecipeFromDb(resolvedId);
        if (cancelled) return;
        if (formal) {
          // Public OR the viewer is the owner.
          if (formal.isPublic || formal.userId === currentUserId) {
            setData(adaptRecipe(formal));
            setLoading(false);
            return;
          }
        }
      }

      // 3. Public home meal lookup needs the owner id from the URL.
      if (ownerId) {
        const meal = await getPublicHomeMealById(ownerId, resolvedId);
        if (cancelled) return;
        if (meal) {
          setData(adaptHomeMeal(meal));
          setLoading(false);
          return;
        }
      }

      if (!cancelled) {
        setNotFound(true);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [resolvedId, ownerId, currentUserId, myRecipes, myHomeMeals]);

  // ── Load author profile + reviews once the recipe is known ──
  useEffect(() => {
    if (!data) return;
    let cancelled = false;

    (async () => {
      const profileMap = await getProfilesByIds([data.ownerId]);
      if (cancelled) return;
      setAuthorProfile(profileMap[data.ownerId] ?? null);
    })();

    setLoadingReviews(true);
    setMyRating(0);
    setMyNotes('');
    setSubmittedAt(null);
    setFormalReviews([]);
    setHomeMealReviews([]);
    setReviewerProfiles({});

    (async () => {
      try {
        if (data.source === 'recipe') {
          const reviews = await getRecipeReviews(data.id);
          if (cancelled) return;
          setFormalReviews(reviews);
          const reviewerIds = Array.from(new Set(reviews.map((r) => r.userId).filter(Boolean)));
          if (reviewerIds.length > 0) {
            const map = await getProfilesByIds(reviewerIds);
            if (!cancelled) setReviewerProfiles(map);
          }
        } else {
          // Home meal: pull the dedicated table + meta-fallback rows
          // across the viewer's friend graph so reviews persisted via
          // ListsContext's meta path also show up.
          let scanIds: string[] = [data.ownerId];
          if (currentUserId) {
            scanIds.push(currentUserId);
            try {
              const friends = await getFriends(currentUserId);
              scanIds = [...new Set([...scanIds, ...friends.map((f) => f.friend_id)])];
            } catch { /* best-effort */ }
          }
          const [all, mine] = await Promise.all([
            getHomeMealReviews(data.id, scanIds),
            currentUserId ? getMyHomeMealReview(currentUserId, data.id) : Promise.resolve(null),
          ]);
          if (cancelled) return;
          setHomeMealReviews(all);
          let myReview = mine;
          if (!myReview && currentUserId) {
            const metaReviews = ((restaurantMeta as Record<string, unknown>).__my_meal_reviews__ ?? {}) as Record<string, { rating: number; notes: string }>;
            const localEntry = metaReviews[data.id];
            if (localEntry) {
              myReview = { id: 'local', userId: currentUserId, mealId: data.id, rating: localEntry.rating, notes: localEntry.notes || '', createdAt: '', updatedAt: '' };
            }
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
        }
      } catch (err) {
        console.warn('[RecipePage] failed to load reviews:', err);
      } finally {
        if (!cancelled) setLoadingReviews(false);
      }
    })();

    return () => { cancelled = true; };
    // restaurantMeta intentionally not in deps — the meta fallback only
    // matters at initial load; rereading on every meta-sync would spam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, currentUserId]);

  const homeMealSummary = useMemo(() => summarizeReviews(homeMealReviews), [homeMealReviews]);
  const formalAvgRating = useMemo(() => {
    if (formalReviews.length === 0) return null;
    return formalReviews.reduce((s, r) => s + r.rating, 0) / formalReviews.length;
  }, [formalReviews]);

  const handleSubmitHomeMealReview = async () => {
    if (!currentUserId || !data || data.source !== 'homeMeal' || myRating < 1) return;
    setSaving(true);
    setSubmitError(false);
    try {
      const reviewData = { rating: myRating, notes: myNotes.trim() };
      const saved = await upsertHomeMealReview(currentUserId, data.id, reviewData);

      const existingReviews = ((restaurantMeta as Record<string, unknown>).__my_meal_reviews__ ?? {}) as Record<string, unknown>;
      stashMetaKey('__my_meal_reviews__', {
        ...existingReviews,
        [data.id]: { rating: myRating, notes: myNotes.trim(), updatedAt: new Date().toISOString() },
      });

      if (saved) {
        setHomeMealReviews((prev) => {
          const filtered = prev.filter((r) => r.userId !== currentUserId);
          return [saved, ...filtered];
        });
      }
      setSubmittedAt(Date.now());
    } catch {
      setSubmitError(true);
    } finally {
      setSaving(false);
    }
  };

  // ── Render guards ──
  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 size={36} className="animate-spin text-primary/60" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="max-w-[680px] mx-auto px-6 py-16 text-center">
        <ChefHat size={36} className="mx-auto text-on-surface/20 mb-3" />
        <p className="text-sm font-semibold text-on-surface/50">Recipe not found</p>
        <p className="text-xs text-on-surface/35 mt-1">It may have been deleted or made private.</p>
        <button
          onClick={() => navigate(-1)}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-on-surface/5 text-sm font-semibold text-on-surface/60 hover:bg-on-surface/10 transition-colors"
        >
          <ArrowLeft size={14} /> Back
        </button>
      </div>
    );
  }

  const isOwner = !!currentUserId && data.ownerId === currentUserId;
  const totalTime = data.prepMinutes + data.cookMinutes;
  const hasIngredients = data.ingredients.length > 0;
  const hasSteps = data.steps.length > 0;
  const baseServings = data.servings > 0 ? data.servings : 4;
  const authorName = authorProfile?.display_name || authorProfile?.username || 'A friend';
  const heroPhoto = data.coverPhoto;

  const handleShare = () => {
    setShareRecipeData({
      mealId: data.id,
      authorId: data.ownerId,
      authorName,
      name: data.title,
      image: heroPhoto,
      description: data.description || undefined,
      tags: data.tags.length > 0 ? data.tags : undefined,
      totalTime: totalTime || undefined,
      difficulty: data.difficulty || undefined,
      ingredientCount: data.ingredients.length || undefined,
      stepCount: data.steps.length || undefined,
    });
  };

  const handleEditOwn = () => {
    if (data.source === 'recipe') {
      openRecipeModal(data.raw as Recipe);
    } else {
      // Home meals don't have an in-page editor; the Pantry cookbook
      // is the single edit surface for home meals today.
      navigate('/pantry?view=home-cooking');
    }
  };

  // ── Section blocks (shared between phone + desktop) ──
  const durationLabel = (m: number) => phoneMode ? formatDurationCompact(m) : formatDuration(m);
  const quickInfoItems: QuickInfoItem[] = [];
  if (data.prepMinutes > 0) quickInfoItems.push({ label: 'Prep', value: durationLabel(data.prepMinutes) });
  if (data.cookMinutes > 0) quickInfoItems.push({ label: 'Cook', value: durationLabel(data.cookMinutes) });
  if (totalTime > 0 && data.prepMinutes > 0 && data.cookMinutes > 0) {
    quickInfoItems.push({ label: 'Total', value: durationLabel(totalTime) });
  }
  if (data.servings > 0) quickInfoItems.push({ label: 'Serves', value: String(data.servings) });
  if (data.difficulty) {
    quickInfoItems.push({ label: 'Level', value: DIFFICULTY_LABEL[data.difficulty] || data.difficulty });
  }

  const statCardsBlock = quickInfoItems.length > 0 ? (
    <div className="py-4 border-y border-on-surface/8">
      <RecipeQuickInfoRow items={quickInfoItems} />
    </div>
  ) : null;

  // Aggregate rating: native scale per source so the number matches
  // what reviewers actually entered (5-star for meals, 10-point for
  // formal recipes).
  const ratingDisplay = (() => {
    if (data.source === 'homeMeal') {
      return (
        <div className="flex items-center gap-4">
          <div className="flex items-baseline">
            <span className="text-5xl font-serif font-bold tabular-nums text-amber-600">
              {homeMealSummary.count > 0 ? homeMealSummary.average.toFixed(1) : '—'}
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
                    homeMealSummary.count > 0 && n <= Math.round(homeMealSummary.average)
                      ? 'text-amber-500 fill-amber-500'
                      : 'text-amber-200',
                  )}
                />
              ))}
            </div>
            <p className="text-[11px] text-on-surface/50">
              {homeMealSummary.count === 0 ? 'No reviews yet' : `${homeMealSummary.count} review${homeMealSummary.count !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
      );
    }
    // Formal recipe: 10-point numeric, color-coded.
    if (formalAvgRating === null) {
      return (
        <p className="text-[11px] text-on-surface/40 font-medium">No reviews yet</p>
      );
    }
    const color = formalAvgRating >= 8 ? 'text-green-600' : formalAvgRating >= 5 ? 'text-yellow-600' : 'text-red-500';
    return (
      <div className="flex items-baseline">
        <span className={cn('text-5xl font-serif font-bold tabular-nums leading-none', color)}>
          {formalAvgRating.toFixed(1)}
        </span>
        <span className="text-sm text-on-surface/35 font-medium ml-1">/ 10</span>
        <span className="text-[11px] text-on-surface/40 ml-3">
          {formalReviews.length} review{formalReviews.length !== 1 ? 's' : ''}
        </span>
      </div>
    );
  })();

  // Title block for desktop hero (includes the h1) and the "subtitle"
  // block for below the phone editorial hero (rating + tags only — the
  // h1 already lives in the hero overlay so don't repeat it).
  const renderTitleBlock = (includeTitle: boolean) => (
    <header>
      {data.date && (
        <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-on-surface/40 font-medium mb-2">
          {data.source === 'homeMeal'
            ? new Date(data.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
            : `Updated ${new Date(data.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
        </p>
      )}
      {includeTitle && (
        <h1 className="font-serif font-bold text-[28px] leading-[1.1] sm:text-5xl text-on-surface mb-4">
          {data.title}
        </h1>
      )}
      <div className="mb-4">{ratingDisplay}</div>
      {data.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.tags.map((tag) => (
            <span key={tag} className="inline-flex items-center px-3 py-1 bg-amber-50 text-amber-800 rounded-full text-[11px] font-semibold tracking-wide">
              {tag}
            </span>
          ))}
        </div>
      )}
    </header>
  );

  const ingredientsBlock = hasIngredients ? (
    <section id="ingredients" className="scroll-mt-20">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h2 className="font-serif font-bold text-2xl text-on-surface">Ingredients</h2>
        <span className="text-[11px] text-on-surface/40 font-medium">
          {data.ingredients.length} item{data.ingredients.length !== 1 ? 's' : ''}
        </span>
      </div>
      <RecipeIngredientList
        recipeKey={`${data.source}-${data.id}`}
        ingredients={data.ingredients}
        servings={{
          base: baseServings,
          scale: servingsScale,
          onScaleChange: setServingsScale,
        }}
      />
    </section>
  ) : (
    <section id="ingredients" className="scroll-mt-20">
      <h2 className="font-serif font-bold text-2xl text-on-surface mb-4">Ingredients</h2>
      <RecipeEmptyState
        icon={ChefHat}
        title="No ingredients listed"
        hint={isOwner ? 'Add ingredients by editing this recipe.' : undefined}
      />
    </section>
  );

  const directionsBlock = hasSteps ? (
    <section id="directions" className="scroll-mt-20">
      <h2 className="font-serif font-bold text-2xl text-on-surface mb-4">Directions</h2>
      <RecipeDirectionsList steps={data.steps} />
    </section>
  ) : (
    <section id="directions" className="scroll-mt-20">
      <h2 className="font-serif font-bold text-2xl text-on-surface mb-4">Directions</h2>
      <RecipeEmptyState
        title="No directions yet"
        hint={isOwner ? 'Add step-by-step directions by editing this recipe.' : undefined}
      />
    </section>
  );

  const notesBlock = data.description ? (
    <section id="notes" className="scroll-mt-20">
      <h2 className="font-serif font-bold text-xl text-on-surface mb-3">Notes</h2>
      <blockquote className="relative bg-amber-50/60 border-l-4 border-amber-400 rounded-r-xl px-5 py-4 sm:px-6 sm:py-5">
        <p className="italic font-serif text-on-surface/75 leading-[1.7] text-[15px] sm:text-[16px] whitespace-pre-wrap">
          {data.description}
        </p>
      </blockquote>
    </section>
  ) : null;

  const photosBlock = data.photos.length > 0 ? (
    <section id="photos">
      <h2 className="font-serif font-bold text-xl text-on-surface mb-3">Photos</h2>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
        {data.photos.map((photo, i) => (
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

  // Inline 5-star rating form — only home meals have a write path
  // wired up today. Formal recipes get a quiet placeholder.
  const rateBlock = (
    <section id="rate" className="scroll-mt-20">
      <h2 className="font-serif font-bold text-xl text-on-surface mb-3">Rate this recipe</h2>
      {data.source === 'recipe' ? (
        <p className="text-sm text-on-surface/50 italic">Reviews for this recipe are coming soon.</p>
      ) : !currentUserId ? (
        <p className="text-sm text-on-surface/50 italic">Sign in to leave a rating.</p>
      ) : isOwner ? (
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
                      'transition-colors',
                      filled ? 'text-amber-500 fill-amber-500' : 'text-on-surface/20',
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
            onClick={handleSubmitHomeMealReview}
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

  // Reviews block — render rating in the source's native scale so the
  // number reads consistently with what the reviewer entered.
  const reviewListItems: ReviewListItem[] = data.source === 'homeMeal'
    ? homeMealReviews.map((r) => ({
        id: r.id, userId: r.userId, rating: r.rating, notes: r.notes, createdAt: r.createdAt,
      }))
    : formalReviews.map((r) => ({
        id: r.id, userId: r.userId, rating: r.rating, notes: r.notes, photo: r.photo, createdAt: r.createdAt,
      }));

  const reviewsBlock = (
    <section id="reviews" className="scroll-mt-20">
      <h2 className="font-serif font-bold text-xl text-on-surface mb-3">
        {reviewListItems.length > 0 ? `Reviews (${reviewListItems.length})` : 'Reviews'}
      </h2>
      {loadingReviews ? (
        <p className="text-sm text-on-surface/40 text-center py-6">Loading reviews…</p>
      ) : reviewListItems.length === 0 ? (
        <RecipeEmptyState
          icon={MessageSquare}
          title="No reviews yet"
          hint={data.source === 'homeMeal' ? 'Be the first to rate this recipe.' : 'Cook this recipe and share your thoughts.'}
        />
      ) : (
        <RecipeReviewList
          reviews={reviewListItems}
          profiles={reviewerProfiles}
          currentUserId={currentUserId}
          renderRating={(rating) => data.source === 'homeMeal' ? (
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  size={13}
                  className={cn(
                    n <= rating ? 'text-amber-500 fill-amber-500' : 'text-on-surface/15',
                  )}
                />
              ))}
            </div>
          ) : (
            <span className={cn(
              'text-base font-serif font-bold tabular-nums',
              rating >= 8 ? 'text-green-600' : rating >= 5 ? 'text-yellow-600' : 'text-red-500',
            )}>
              {rating.toFixed(1)}
              <span className="text-[10px] text-on-surface/35 font-sans font-medium ml-0.5">/10</span>
            </span>
          )}
        />
      )}
    </section>
  );

  const mobileSections: { id: string; label: string }[] = [
    { id: 'ingredients', label: 'Ingredients' },
    { id: 'directions', label: 'Directions' },
    ...(data.description ? [{ id: 'notes', label: 'Notes' }] : []),
    ...(data.photos.length > 0 ? [{ id: 'photos', label: 'Photos' }] : []),
    { id: 'reviews', label: 'Reviews' },
  ];

  const jumpTargets = mobileSections.concat(
    data.source === 'homeMeal' ? [{ id: 'rate', label: 'Rate' }] : [],
  );

  // ── Phone layout: editorial 60vh hero with title overlay ──
  if (phoneMode) {
    return (
      <div className="pb-32 bg-surface min-h-screen">
        {/* Hero with title overlay */}
        <div
          className="relative w-full overflow-hidden"
          style={{ height: heroPhoto ? '60vh' : '20vh', maxHeight: '70vh' }}
        >
          {heroPhoto ? (
            <button
              type="button"
              onClick={() => setLightboxPhotoIdx(0)}
              className="block w-full h-full"
              aria-label="Open photo gallery"
            >
              <img src={heroPhoto} alt={data.title} className="h-full w-full object-cover" />
            </button>
          ) : (
            <div className="absolute inset-0 w-full h-full bg-primary/5 flex items-center justify-center">
              <ChefHat size={64} className="text-primary/20" />
            </div>
          )}

          {heroPhoto && (
            <>
              <div
                className="absolute inset-x-0 bottom-0 h-1/2 pointer-events-none"
                style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.45) 40%, rgba(0,0,0,0.1) 75%, transparent 100%)' }}
              />
              <div
                className="absolute inset-x-0 bottom-0 h-8 pointer-events-none"
                style={{ background: 'linear-gradient(to top, #fff8f6, transparent)' }}
              />
            </>
          )}

          {/* Top-left back button */}
          <button
            onClick={() => navigate(-1)}
            className="absolute top-[max(1rem,env(safe-area-inset-top))] left-4 p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80 z-10"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>

          {/* Top-right actions */}
          <div className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 flex items-center gap-2 z-10">
            {isOwner && (
              <button
                onClick={handleEditOwn}
                className="p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80"
                aria-label="Edit"
              >
                <Edit3 size={16} />
              </button>
            )}
            <button
              onClick={handleShare}
              className="p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80"
              aria-label="Share"
            >
              <Share2 size={16} />
            </button>
          </div>

          {/* Title overlay (only when there's a cover photo) */}
          {heroPhoto && (
            <div className="absolute bottom-10 left-5 right-5 z-10 pointer-events-none">
              <h1 className="text-2xl font-serif font-bold text-white leading-tight mb-1.5 drop-shadow-lg">
                {data.title}
              </h1>
              <div className="flex items-center gap-2 flex-wrap">
                {data.cuisine && (
                  <span className="text-[11px] font-semibold text-white/90 uppercase tracking-wider">
                    {data.cuisine}
                  </span>
                )}
                {data.difficulty && (
                  <>
                    {data.cuisine && <span className="text-white/50">·</span>}
                    <span className="text-[11px] font-semibold text-white/90 uppercase tracking-wider">
                      {DIFFICULTY_LABEL[data.difficulty]}
                    </span>
                  </>
                )}
                {data.sourceType === 'expert' && (
                  <>
                    <span className="text-white/50">·</span>
                    <span className="text-[11px] font-semibold text-yellow-300 uppercase tracking-wider flex items-center gap-1">
                      <Star size={10} fill="currentColor" />Expert
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sticky section nav */}
        <RecipeMobileSectionNav sections={mobileSections} />

        {/* Content column — keep editorial reading measure */}
        <div className="max-w-[680px] mx-auto px-5 pt-6 space-y-8">
          {/* Show title here too only when there was NO hero photo to overlay */}
          {!heroPhoto && (
            <div>
              <h1 className="font-serif font-bold text-[28px] leading-[1.1] text-on-surface mb-3">
                {data.title}
              </h1>
              <div className="flex items-center gap-2 flex-wrap mb-3">
                {data.cuisine && (
                  <span className="text-[11px] font-semibold text-on-surface/50 uppercase tracking-wider">
                    {data.cuisine}
                  </span>
                )}
                {data.difficulty && (
                  <span className="text-[11px] font-semibold text-on-surface/50 uppercase tracking-wider">
                    {DIFFICULTY_LABEL[data.difficulty]}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Author row + rating + tags */}
          {renderTitleBlock(false)}

          {/* Author chip */}
          {authorProfile && (
            <div className="-mt-4">
              <button
                onClick={() => navigate(`/user/${authorProfile.username}`)}
                className="inline-flex items-center gap-2.5 group"
              >
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary/60 flex-shrink-0">
                  {authorProfile.display_name?.charAt(0) || authorProfile.username?.charAt(0) || '?'}
                </div>
                <div className="min-w-0 text-left">
                  <p className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors truncate">
                    {authorProfile.display_name || `@${authorProfile.username}`}
                  </p>
                  {data.sourceType === 'expert' && (
                    <p className="text-[10px] font-semibold text-yellow-600 flex items-center gap-1">
                      <Star size={9} fill="currentColor" />Expert Chef
                    </p>
                  )}
                </div>
              </button>
            </div>
          )}

          {statCardsBlock}
          {ingredientsBlock}
          {directionsBlock}
          {notesBlock}
          {photosBlock}
          {rateBlock}
          {reviewsBlock}
        </div>

        <PhotoLightbox
          photos={data.photos}
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

  // ── Desktop layout: editorial 2-col hero + sticky ingredients ──
  return (
    <div className="max-w-[880px] mx-auto px-3 pb-32 pt-safe-4">
      {/* Back header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="p-2 -ml-2 text-on-surface/40 hover:text-on-surface transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <p className="flex-1 text-[11px] uppercase tracking-[0.14em] text-on-surface/40 font-medium">
          From {authorName}&rsquo;s kitchen
        </p>
        {isOwner && (
          <button
            onClick={handleEditOwn}
            className="p-2 text-on-surface/40 hover:text-primary transition-colors"
            aria-label="Edit"
          >
            <Edit3 size={18} />
          </button>
        )}
        <button
          onClick={handleShare}
          className="p-2 -mr-2 text-on-surface/40 hover:text-emerald-600 transition-colors"
          aria-label="Share"
        >
          <Share2 size={18} />
        </button>
      </div>

      {/* Hero row */}
      <div className="grid md:grid-cols-[minmax(0,1fr)_240px] gap-6 items-stretch mb-8">
        {renderTitleBlock(true)}
        {heroPhoto && (
          <button
            type="button"
            onClick={() => setLightboxPhotoIdx(0)}
            className="hidden md:block relative rounded-2xl overflow-hidden border border-on-surface/8 group"
            aria-label="Open photo gallery"
          >
            <img src={heroPhoto} alt={data.title} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors" />
          </button>
        )}
      </div>

      {/* Author chip */}
      {authorProfile && (
        <div className="mb-6">
          <button
            onClick={() => navigate(`/user/${authorProfile.username}`)}
            className="inline-flex items-center gap-2.5 group"
          >
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary/60 flex-shrink-0">
              {authorProfile.display_name?.charAt(0) || authorProfile.username?.charAt(0) || '?'}
            </div>
            <div className="min-w-0 text-left">
              <p className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors truncate">
                {authorProfile.display_name || `@${authorProfile.username}`}
              </p>
              {data.sourceType === 'expert' && (
                <p className="text-[10px] font-semibold text-yellow-600 flex items-center gap-1">
                  <Star size={9} fill="currentColor" />Expert Chef
                </p>
              )}
            </div>
          </button>
        </div>
      )}

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
        photos={data.photos}
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
