import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Share2, ChefHat, Tag, Star, Edit3, Loader2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useRecipes, type Recipe, type RecipeReview } from '../contexts/RecipesContext';
import { useAuth } from '../contexts/AuthContext';
import { getProfilesByIds, type UserProfile } from '../lib/supabase-community';
import { getRecipe as fetchRecipeFromDb } from '../lib/supabase-recipes';
import {
  RecipeQuickInfoRow,
  RecipeIngredientList,
  RecipeDirectionsList,
  RecipeReviewList,
  RecipeMobileSectionNav,
  type QuickInfoItem,
} from '../lib/recipe-display';

const DIFFICULTY_LABELS: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const DIFFICULTY_COLORS: Record<string, string> = { easy: 'text-green-600 bg-green-50', medium: 'text-yellow-600 bg-yellow-50', hard: 'text-red-600 bg-red-50' };

export const RecipeDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getRecipe, getReviewsForRecipe, openRecipeModal } = useRecipes();
  const { user } = useAuth();

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<RecipeReview[]>([]);
  const [reviewerProfiles, setReviewerProfiles] = useState<Record<string, UserProfile>>({});
  const [authorProfile, setAuthorProfile] = useState<UserProfile | null>(null);
  const [servingsScale, setServingsScale] = useState(1);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIdx, setGalleryIdx] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      // Try context first, then DB
      let r = getRecipe(id) ?? null;
      if (!r) r = await fetchRecipeFromDb(id);
      if (cancelled) return;
      setRecipe(r);
      setLoading(false);

      if (r) {
        const [revs, profiles] = await Promise.all([
          getReviewsForRecipe(r.id),
          getProfilesByIds([r.userId]),
        ]);
        if (cancelled) return;
        setReviews(revs);
        if (profiles[r.userId]) setAuthorProfile(profiles[r.userId]);

        // Bulk-fetch reviewer profiles so the flat review list can render
        // names without each row firing its own request.
        const reviewerIds = Array.from(new Set(revs.map((rv) => rv.userId).filter((uid) => uid !== r.userId)));
        if (reviewerIds.length > 0) {
          const map = await getProfilesByIds(reviewerIds);
          if (!cancelled) setReviewerProfiles({ ...profiles, ...map });
        } else {
          setReviewerProfiles(profiles);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 size={40} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!recipe) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-4 px-8">
        <p className="text-on-surface/60 text-center">Recipe not found</p>
        <button onClick={() => navigate(-1)} className="text-primary font-medium">Go Back</button>
      </div>
    );
  }

  const isOwner = user?.id === recipe.userId;
  const heroPhoto = recipe.photos?.[0];
  const totalTime = (recipe.prepTimeMinutes || 0) + (recipe.cookTimeMinutes || 0);
  const avgRating = reviews.length > 0
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : null;

  // Build the magazine-metadata row from whatever the recipe actually has.
  const quickInfoItems: QuickInfoItem[] = [];
  if (recipe.prepTimeMinutes) quickInfoItems.push({ label: 'Prep', value: `${recipe.prepTimeMinutes}m` });
  if (recipe.cookTimeMinutes) quickInfoItems.push({ label: 'Cook', value: `${recipe.cookTimeMinutes}m` });
  if (totalTime > 0 && recipe.prepTimeMinutes && recipe.cookTimeMinutes) {
    quickInfoItems.push({ label: 'Total', value: `${totalTime}m` });
  }
  if (recipe.servings) quickInfoItems.push({ label: 'Serves', value: String(recipe.servings) });
  if (recipe.difficulty) quickInfoItems.push({ label: 'Level', value: DIFFICULTY_LABELS[recipe.difficulty] || recipe.difficulty });

  const sections: { id: string; label: string }[] = [];
  if (recipe.ingredients.length > 0) sections.push({ id: 'ingredients', label: 'Ingredients' });
  if (recipe.steps.length > 0) sections.push({ id: 'directions', label: 'Directions' });
  if (recipe.description) sections.push({ id: 'notes', label: 'Notes' });
  if (reviews.length > 0) sections.push({ id: 'reviews', label: 'Reviews' });

  return (
    <div className="pb-32 bg-surface min-h-screen">
      {/* ── Hero ── */}
      <div className="relative w-full overflow-hidden" style={{ height: heroPhoto ? '60vh' : '20vh', maxHeight: '70vh' }}>
        {heroPhoto ? (
          <img src={heroPhoto} alt={recipe.title} className="h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 w-full h-full bg-primary/5 flex items-center justify-center">
            <ChefHat size={64} className="text-primary/20" />
          </div>
        )}

        {heroPhoto && (
          <>
            <div className="absolute inset-x-0 bottom-0 h-1/2 pointer-events-none"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.45) 40%, rgba(0,0,0,0.1) 75%, transparent 100%)' }} />
            <div className="absolute inset-x-0 bottom-0 h-8 pointer-events-none"
              style={{ background: 'linear-gradient(to top, #fff8f6, transparent)' }} />
          </>
        )}

        {/* Back button */}
        <button onClick={() => navigate(-1)}
          className="absolute top-4 left-4 p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80 z-10">
          <ArrowLeft size={18} />
        </button>

        {/* Top-right actions */}
        <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
          {isOwner && (
            <button onClick={() => openRecipeModal(recipe)}
              className="p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80">
              <Edit3 size={16} />
            </button>
          )}
          <button
            onClick={() => {
              if (navigator.share) {
                navigator.share({ title: recipe.title, url: window.location.href });
              } else {
                navigator.clipboard.writeText(window.location.href);
              }
            }}
            className="p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80">
            <Share2 size={16} />
          </button>
        </div>

        {/* Title overlay */}
        {heroPhoto && (
          <div className="absolute bottom-10 left-5 right-5 z-10 pointer-events-none">
            <h1 className="text-2xl font-serif font-bold text-white leading-tight mb-1.5 drop-shadow-lg">{recipe.title}</h1>
            <div className="flex items-center gap-2 flex-wrap">
              {recipe.cuisine && <span className="text-[11px] font-semibold text-white/90 uppercase tracking-wider">{recipe.cuisine}</span>}
              {recipe.difficulty && (
                <>
                  {recipe.cuisine && <span className="text-white/50">·</span>}
                  <span className="text-[11px] font-semibold text-white/90 uppercase tracking-wider">{DIFFICULTY_LABELS[recipe.difficulty]}</span>
                </>
              )}
              {recipe.sourceType === 'expert' && (
                <>
                  <span className="text-white/50">·</span>
                  <span className="text-[11px] font-semibold text-yellow-300 uppercase tracking-wider flex items-center gap-1"><Star size={10} fill="currentColor" />Expert</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Mobile sticky section nav ── */}
      <RecipeMobileSectionNav sections={sections} />

      {/* ── Main Content ── */}
      <main className="px-5 pt-5">
        {/* Title (when no hero photo) */}
        {!heroPhoto && (
          <div className="mb-4">
            <h1 className="text-3xl font-serif font-bold text-on-surface leading-tight mb-1">{recipe.title}</h1>
            <div className="flex items-center gap-2 flex-wrap">
              {recipe.cuisine && <span className="text-[11px] font-semibold text-on-surface/50 uppercase tracking-wider">{recipe.cuisine}</span>}
              {recipe.difficulty && (
                <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full", DIFFICULTY_COLORS[recipe.difficulty])}>{DIFFICULTY_LABELS[recipe.difficulty]}</span>
              )}
            </div>
          </div>
        )}

        {/* Author + average rating row */}
        <div className="flex items-center justify-between gap-3 mb-5">
          {authorProfile ? (
            <button onClick={() => navigate(`/user/${authorProfile.username}`)}
              className="flex items-center gap-2.5 group min-w-0">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary/60 flex-shrink-0">
                {authorProfile.display_name?.charAt(0) || authorProfile.username?.charAt(0) || '?'}
              </div>
              <div className="min-w-0 text-left">
                <p className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors truncate">
                  {authorProfile.display_name || `@${authorProfile.username}`}
                </p>
                {recipe.sourceType === 'expert' && (
                  <p className="text-[10px] font-semibold text-yellow-600 flex items-center gap-1"><Star size={9} fill="currentColor" />Expert Chef</p>
                )}
              </div>
            </button>
          ) : <div />}

          {avgRating !== null && (
            <div className="flex items-baseline gap-1 flex-shrink-0">
              <span className={cn("text-2xl font-serif font-bold leading-none",
                avgRating >= 8 ? 'text-green-600' : avgRating >= 5 ? 'text-yellow-600' : 'text-red-500'
              )}>
                {avgRating.toFixed(1)}
              </span>
              <span className="text-[11px] text-on-surface/40">/ 10</span>
            </div>
          )}
        </div>

        {/* Quick info — flat magazine-metadata row */}
        {quickInfoItems.length > 0 && (
          <div className="py-4 mb-6 border-y border-on-surface/8">
            <RecipeQuickInfoRow items={quickInfoItems} />
          </div>
        )}

        {/* ── Ingredients ── */}
        {recipe.ingredients.length > 0 && (
          <section id="ingredients" className="mb-10 scroll-mt-20">
            <h2 className="font-serif font-bold text-2xl text-on-surface mb-4">Ingredients</h2>
            <RecipeIngredientList
              recipeKey={recipe.id}
              ingredients={recipe.ingredients}
              servings={recipe.servings ? {
                base: recipe.servings,
                scale: servingsScale,
                onScaleChange: setServingsScale,
              } : undefined}
            />
          </section>
        )}

        {/* ── Directions ── */}
        {recipe.steps.length > 0 && (
          <section id="directions" className="mb-10 scroll-mt-20">
            <h2 className="font-serif font-bold text-2xl text-on-surface mb-4">Directions</h2>
            <RecipeDirectionsList steps={recipe.steps.map((s) => s.text)} />
          </section>
        )}

        {/* ── Notes (description) ── */}
        {recipe.description && (
          <section id="notes" className="mb-10 scroll-mt-20">
            <h2 className="font-serif font-bold text-2xl text-on-surface mb-3">Notes</h2>
            <blockquote className="relative bg-amber-50/60 border-l-4 border-amber-400 rounded-r-xl px-5 py-4">
              <p className="italic font-serif text-on-surface/75 leading-[1.7] text-[15px] whitespace-pre-wrap">
                {recipe.description}
              </p>
            </blockquote>
          </section>
        )}

        {/* ── Tags ── */}
        {recipe.tags.length > 0 && (
          <section className="mb-10">
            <h2 className="font-serif font-bold text-base text-on-surface flex items-center gap-2 mb-3">
              <Tag size={16} className="text-primary/50" /> Tags
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {recipe.tags.map((tag) => (
                <span key={tag} className="px-3 py-1.5 rounded-full bg-primary/8 text-primary text-xs font-semibold">{tag}</span>
              ))}
            </div>
          </section>
        )}

        {/* ── Photos gallery ── */}
        {recipe.photos.length > 1 && (
          <section className="mb-10">
            <h2 className="font-serif font-bold text-2xl text-on-surface mb-4">Photos</h2>
            <div className="grid grid-cols-3 gap-1.5">
              {recipe.photos.slice(1).map((photo, idx) => (
                <button key={idx} onClick={() => { setGalleryIdx(idx + 1); setGalleryOpen(true); }}
                  className="aspect-square overflow-hidden">
                  <img src={photo} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── Reviews ── */}
        {reviews.length > 0 && (
          <section id="reviews" className="mb-10 scroll-mt-20">
            <h2 className="font-serif font-bold text-2xl text-on-surface mb-4">Reviews</h2>
            <RecipeReviewList
              reviews={reviews}
              profiles={reviewerProfiles}
              currentUserId={user?.id ?? null}
              renderRating={(rating) => (
                <span className={cn(
                  "text-base font-serif font-bold tabular-nums",
                  rating >= 8 ? 'text-green-600' : rating >= 5 ? 'text-yellow-600' : 'text-red-500',
                )}>
                  {rating.toFixed(1)}
                  <span className="text-[10px] text-on-surface/35 font-sans font-medium ml-0.5">/10</span>
                </span>
              )}
            />
          </section>
        )}
      </main>

      {/* ── Gallery overlay ── */}
      <AnimatePresence>
        {galleryOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black z-[200] flex flex-col" onClick={() => setGalleryOpen(false)}>
            <div className="flex items-center justify-between px-4 py-3">
              <button onClick={() => setGalleryOpen(false)} className="p-2 text-white/70"><ArrowLeft size={20} /></button>
              <span className="text-white/60 text-sm">{galleryIdx + 1} / {recipe.photos.length}</span>
              <div className="w-10" />
            </div>
            <div className="flex-1 flex items-center justify-center px-4" onClick={(e) => e.stopPropagation()}>
              <img src={recipe.photos[galleryIdx]} alt="" className="max-w-full max-h-full object-contain rounded-lg" />
            </div>
            <div className="flex justify-center gap-2 py-4">
              {recipe.photos.map((_, i) => (
                <button key={i} onClick={() => setGalleryIdx(i)}
                  className={cn("h-1.5 rounded-full transition-all", i === galleryIdx ? "bg-white w-5" : "bg-white/40 w-1.5")} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

