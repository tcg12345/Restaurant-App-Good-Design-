/**
 * Shared `GuideEntry` builders used by both the Guide Creator wizard
 * (StepSeed) and the Live Editor's AddEntryPicker. The wizard used to
 * own these privately; lifting them keeps the assembly logic in one
 * place so a rating / recipe always produces the same shape regardless
 * of which surface added it.
 */
import type { RestaurantRating, RestaurantMeta } from '../contexts/ListsContext';
import type { Recipe as DbRecipe } from '../contexts/RecipesContext';
import type { Recipe as ListRecipe } from '../contexts/ListsContext';
import type { GuideEntry } from './supabase-guides';
import { priceLevelToString, type PlaceResult } from './places';

const newEntryId = () => `e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** Build a guide entry from one of the user's restaurant ratings. */
export function entryFromRating(
  r: RestaurantRating,
  meta?: RestaurantMeta | null,
): GuideEntry {
  const subtitleStr = [r.cuisine, r.price].filter(Boolean).join(' · ');
  const fromExplicit = (r.favoriteDishes || []).map((s) => s.trim()).filter(Boolean);
  const fromPhotos = (r.photos || [])
    .filter((p) => p.isFavorite && p.caption?.trim())
    .map((p) => p.caption.trim());
  const seen = new Set<string>();
  const allDishes: string[] = [];
  for (const d of [...fromExplicit, ...fromPhotos]) {
    const key = d.toLowerCase();
    if (!seen.has(key)) { seen.add(key); allDishes.push(d); }
  }
  return {
    id: newEntryId(),
    refId: r.restaurantId,
    name: r.name,
    subtitle: subtitleStr,
    cuisine: r.cuisine || undefined,
    price: r.price || undefined,
    image: r.photos?.[0]?.url || r.image || '',
    score: r.score,
    notes: r.notes?.trim() || undefined,
    mustOrder: allDishes.length > 0 ? allDishes : undefined,
    neighborhood: meta?.neighborhood,
    hours: meta?.hours?.[0]?.split(': ')[1],
  };
}

/** Build a guide entry from a Google Places result. Used when the
 *  picker can't find a matching rating in the user's data — the entry
 *  carries no personal score and minimal denormalized fields, but is
 *  good enough to render and link from the guide. */
export function entryFromPlace(p: PlaceResult): GuideEntry {
  const cuisine = p.types?.[0]?.replace(/_/g, ' ');
  const price = priceLevelToString(p.priceLevel);
  return {
    id: newEntryId(),
    refId: p.id,
    name: p.name,
    subtitle: [cuisine, price].filter(Boolean).join(' · '),
    cuisine: cuisine || undefined,
    price: price || undefined,
    image: p.photoUrl || '',
    score: undefined,
    neighborhood: p.address || undefined,
  };
}

/** Build a guide entry from a Recipe stored on a home-cooking list. */
export function entryFromListRecipe(r: ListRecipe, authorId?: string): GuideEntry {
  return {
    id: newEntryId(),
    refId: r.id,
    name: r.title,
    subtitle: [r.cuisine, r.difficulty].filter(Boolean).join(' · '),
    cuisine: r.cuisine || undefined,
    image: r.coverPhoto || r.photos?.[0]?.url || '',
    score: r.score,
    totalTime: (r.prepTime || 0) + (r.cookTime || 0),
    difficulty: r.difficulty,
    authorId,
  };
}

/** Build a guide entry from one of the user's recipes in the cloud
 *  table. Cloud recipes don't store a score; the caller can pass one
 *  (e.g. looked up from a matching home meal by title) so the entry
 *  carries the rating the user gave to the dish. */
export function entryFromDbRecipe(r: DbRecipe, score?: number): GuideEntry {
  return {
    id: newEntryId(),
    refId: r.id,
    name: r.title,
    subtitle: [r.cuisine, r.difficulty].filter(Boolean).join(' · '),
    cuisine: r.cuisine || undefined,
    image: r.photos?.[0] || '',
    score: typeof score === 'number' && score > 0 ? score : undefined,
    totalTime: (r.prepTimeMinutes || 0) + (r.cookTimeMinutes || 0),
    difficulty: r.difficulty,
    authorId: r.userId,
  };
}
