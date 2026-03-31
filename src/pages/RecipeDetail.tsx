import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Share2, Clock, Users, ChefHat, Timer,
  Hash, Minus, Plus, Tag, Star, Edit3, Loader2, MapPin,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useRecipes, type Recipe, type RecipeReview } from '../contexts/RecipesContext';
import { useAuth } from '../contexts/AuthContext';
import { getProfilesByIds, type UserProfile } from '../lib/supabase-community';
import { getRecipe as fetchRecipeFromDb } from '../lib/supabase-recipes';

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
  const [authorProfile, setAuthorProfile] = useState<UserProfile | null>(null);
  const [servingMultiplier, setServingMultiplier] = useState(1);
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

  const adjustedAmount = (amount: string) => {
    if (servingMultiplier === 1 || !amount) return amount;
    const num = parseFloat(amount);
    if (isNaN(num)) return amount;
    const adjusted = num * servingMultiplier;
    return adjusted % 1 === 0 ? adjusted.toString() : adjusted.toFixed(1);
  };

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

      {/* ── Main Content ── */}
      <main className="px-4 pt-4">
        {/* Title (when no hero photo) */}
        {!heroPhoto && (
          <div className="mb-4">
            <h1 className="text-2xl font-serif font-bold text-on-surface leading-tight mb-1">{recipe.title}</h1>
            <div className="flex items-center gap-2 flex-wrap">
              {recipe.cuisine && <span className="text-[11px] font-semibold text-on-surface/50 uppercase tracking-wider">{recipe.cuisine}</span>}
              {recipe.difficulty && (
                <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full", DIFFICULTY_COLORS[recipe.difficulty])}>{DIFFICULTY_LABELS[recipe.difficulty]}</span>
              )}
            </div>
          </div>
        )}

        {/* Author */}
        {authorProfile && (
          <button onClick={() => navigate(`/user/${authorProfile.username}`)}
            className="flex items-center gap-2.5 mb-4 group">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary/60">
              {authorProfile.display_name?.charAt(0) || authorProfile.username?.charAt(0) || '?'}
            </div>
            <div>
              <p className="text-sm font-medium text-on-surface/70 group-hover:text-primary transition-colors">
                {authorProfile.display_name || `@${authorProfile.username}`}
              </p>
              {recipe.sourceType === 'expert' && (
                <p className="text-[10px] font-semibold text-yellow-600 flex items-center gap-1"><Star size={9} fill="currentColor" />Expert Chef</p>
              )}
            </div>
          </button>
        )}

        {/* Description */}
        {recipe.description && (
          <p className="text-sm text-on-surface/60 leading-relaxed mb-5">{recipe.description}</p>
        )}

        {/* Quick info bar */}
        {totalTime > 0 || recipe.servings ? (
          <div className="flex items-center gap-4 mb-5 py-3 px-4 bg-white rounded-2xl border border-on-surface/8">
            {recipe.prepTimeMinutes ? (
              <div className="flex items-center gap-1.5 text-on-surface/50">
                <Clock size={14} />
                <div>
                  <p className="text-xs font-semibold">{recipe.prepTimeMinutes}m</p>
                  <p className="text-[9px] text-on-surface/30">Prep</p>
                </div>
              </div>
            ) : null}
            {recipe.cookTimeMinutes ? (
              <div className="flex items-center gap-1.5 text-on-surface/50">
                <Timer size={14} />
                <div>
                  <p className="text-xs font-semibold">{recipe.cookTimeMinutes}m</p>
                  <p className="text-[9px] text-on-surface/30">Cook</p>
                </div>
              </div>
            ) : null}
            {totalTime > 0 && (
              <div className="flex items-center gap-1.5 text-primary">
                <Clock size={14} />
                <div>
                  <p className="text-xs font-semibold">{totalTime}m</p>
                  <p className="text-[9px] text-primary/50">Total</p>
                </div>
              </div>
            )}
            {recipe.servings && (
              <div className="flex items-center gap-1.5 text-on-surface/50 ml-auto">
                <Users size={14} />
                <p className="text-xs font-semibold">{recipe.servings} servings</p>
              </div>
            )}
          </div>
        ) : null}

        {/* Average rating */}
        {avgRating !== null && (
          <div className="flex items-center gap-3 mb-5 py-3 px-4 bg-white rounded-2xl border border-on-surface/8">
            <div className={cn("text-2xl font-serif font-bold",
              avgRating >= 8 ? 'text-green-500' : avgRating >= 5 ? 'text-yellow-500' : 'text-red-500'
            )}>
              {avgRating.toFixed(1)}
            </div>
            <div>
              <p className="text-xs font-semibold text-on-surface/60">Community Rating</p>
              <p className="text-[10px] text-on-surface/30">{reviews.length} review{reviews.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
        )}

        {/* ── Ingredients ── */}
        {recipe.ingredients.length > 0 && (
          <section className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-serif font-bold text-on-surface flex items-center gap-2">
                <Hash size={16} className="text-primary/50" /> Ingredients
              </h2>
              {recipe.servings && (
                <div className="flex items-center gap-2">
                  <button onClick={() => setServingMultiplier((m) => Math.max(0.5, m - 0.5))}
                    className="w-6 h-6 rounded-full border border-on-surface/15 flex items-center justify-center text-on-surface/40 hover:border-primary hover:text-primary transition-colors">
                    <Minus size={12} />
                  </button>
                  <span className="text-xs font-semibold text-on-surface/60 min-w-[40px] text-center">
                    {servingMultiplier === 1 ? `${recipe.servings}` : `${Math.round(recipe.servings * servingMultiplier)}`}
                  </span>
                  <button onClick={() => setServingMultiplier((m) => m + 0.5)}
                    className="w-6 h-6 rounded-full border border-on-surface/15 flex items-center justify-center text-on-surface/40 hover:border-primary hover:text-primary transition-colors">
                    <Plus size={12} />
                  </button>
                </div>
              )}
            </div>
            <div className="bg-white rounded-2xl border border-on-surface/8 divide-y divide-on-surface/6">
              {recipe.ingredients.map((ing, idx) => (
                <div key={idx} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary/40 flex-shrink-0" />
                  <span className="text-sm font-medium text-on-surface/70 flex-1">{ing.name}</span>
                  {(ing.amount || ing.unit) && (
                    <span className="text-sm text-on-surface/40 flex-shrink-0">
                      {[adjustedAmount(ing.amount), ing.unit].filter(Boolean).join(' ')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Steps ── */}
        {recipe.steps.length > 0 && (
          <section className="mb-6">
            <h2 className="text-base font-serif font-bold text-on-surface flex items-center gap-2 mb-3">
              <ChefHat size={16} className="text-primary/50" /> Instructions
            </h2>
            <div className="space-y-3">
              {recipe.steps.map((step, idx) => (
                <div key={idx} className="flex gap-3 bg-white rounded-2xl border border-on-surface/8 p-4">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-primary">{step.order}</span>
                  </div>
                  <p className="text-sm text-on-surface/70 leading-relaxed flex-1 pt-0.5">{step.text}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Tags ── */}
        {recipe.tags.length > 0 && (
          <section className="mb-6">
            <h2 className="text-base font-serif font-bold text-on-surface flex items-center gap-2 mb-3">
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
          <section className="mb-6">
            <h2 className="text-base font-serif font-bold text-on-surface mb-3">Photos</h2>
            <div className="grid grid-cols-3 gap-1.5">
              {recipe.photos.slice(1).map((photo, idx) => (
                <button key={idx} onClick={() => { setGalleryIdx(idx + 1); setGalleryOpen(true); }}
                  className="aspect-square rounded-xl overflow-hidden">
                  <img src={photo} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── Reviews ── */}
        {reviews.length > 0 && (
          <section className="mb-6">
            <h2 className="text-base font-serif font-bold text-on-surface mb-3">Reviews</h2>
            <div className="space-y-2">
              {reviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </div>
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

/* ── Review card ── */
const ReviewCard: React.FC<{ review: RecipeReview }> = ({ review }) => {
  const [authorName, setAuthorName] = useState('');
  useEffect(() => {
    getProfilesByIds([review.userId]).then((p) => {
      const prof = p[review.userId];
      if (prof) setAuthorName(prof.display_name || `@${prof.username}`);
    });
  }, [review.userId]);

  const scoreColor = review.rating >= 8 ? 'text-green-500' : review.rating >= 5 ? 'text-yellow-500' : 'text-red-500';

  return (
    <div className="bg-white rounded-2xl border border-on-surface/8 p-4">
      <div className="flex items-center gap-2.5 mb-2">
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary/60">
          {authorName.charAt(0) || '?'}
        </div>
        <span className="text-sm font-medium text-on-surface/60 flex-1">{authorName || 'Anonymous'}</span>
        <span className={cn("text-lg font-serif font-bold", scoreColor)}>{review.rating.toFixed(1)}</span>
      </div>
      {review.notes && <p className="text-sm text-on-surface/50 leading-relaxed">{review.notes}</p>}
      {review.photo && (
        <img src={review.photo} alt="" className="mt-2 w-full rounded-xl object-cover max-h-48" />
      )}
    </div>
  );
};
