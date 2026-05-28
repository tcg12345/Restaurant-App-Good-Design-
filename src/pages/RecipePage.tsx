/**
 * RecipePage — editorial recipe detail.
 *
 * Mounts at /recipe/:userId/:id (canonical), /meal/:userId/:mealId (alias),
 * and /recipe/:id (legacy single-id fallback). Loads the recipe by trying
 * local stores (own recipes / own home meals), then the formal `recipes`
 * table, then user_app_data.home_meals. The matched source drives review
 * fetch (recipe_reviews vs home_meal_reviews) and the owner-edit affordance.
 *
 * Layout: editorial split hero (text + image) on top, stats strip, action
 * row with primary "Start cooking" + secondary buttons + tag pills, an
 * intro prose with drop cap, then a two-column body (sticky ingredients
 * card next to numbered directions). Below: Notes from the kitchen,
 * Nutrition, About the chef, Reviews with rating breakdown, You might
 * also like. Plus a Cook mode dark overlay and a Write-a-review modal.
 *
 * All styling lives in RecipePage.css under .recipe-detail-page so the
 * editorial tokens don't leak into other routes.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Award, Check, ChefHat, ChevronLeft, ChevronRight, Clock,
  Edit3, Flame, Heart, Loader2, MessageCircle, Play, Plus, Printer,
  Share2, Sparkles, Star, Users, X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useLists, type HomeMeal } from '../contexts/ListsContext';
import { useRecipes, type Recipe, type RecipeIngredient, type RecipeReview } from '../contexts/RecipesContext';
import {
  getPublicHomeMealById,
  getProfilesByIds,
  getFriends,
  type FriendHomeMeal,
  type UserProfile,
} from '../lib/supabase-community';
import { getRecipe as fetchRecipeFromDb, getRecipeReviews, getPublicRecipes, upsertReview as upsertFormalReview } from '../lib/supabase-recipes';
import {
  upsertHomeMealReview,
  getHomeMealReviews,
  getMyHomeMealReview,
  type HomeMealReview,
} from '../lib/supabase-home-meal-reviews';
import { cn } from '../lib/utils';
import './RecipePage.css';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuidLike = (v: string): boolean => UUID_RE.test(v);

const DIFFICULTY_LABEL: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

const STORAGE_KEY_SAVED = 'gourmad-saved-recipes';
const STORAGE_KEY_COOKED = 'gourmad-cooked-recipes';

// Hash a string to a stable hue 0–360. Used for avatar gradients.
const hashToHue = (s: string): number => {
  let h = 0;
  for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};

// Quantity formatter — supports common fractions (¼, ½, ¾, ⅓, ⅔, ⅛)
// so the ingredient list reads like a cookbook rather than dumping "0.5 cups".
const VULGAR_FRAC: Record<string, string> = {
  '0.25': '¼', '0.5': '½', '0.75': '¾',
  '0.33': '⅓', '0.67': '⅔', '0.125': '⅛', '0.375': '⅜', '0.625': '⅝', '0.875': '⅞',
};
function formatQty(raw: string | number | undefined, scale: number): string {
  if (raw === undefined || raw === null || raw === '') return '';
  // The amount string in our DB might be "1", "1/2", "1 1/2", "0.5", or
  // free text like "to taste". Parse to a number when possible; otherwise
  // pass through unchanged (still scaled? no — only numeric values scale).
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  // Pure numeric / fraction parser shared with recipe-display.tsx.
  const mixed = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  let value: number | null = null;
  if (mixed) {
    const d = parseInt(mixed[3], 10);
    if (d) value = parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / d;
  } else {
    const frac = trimmed.match(/^(\d+)\/(\d+)$/);
    if (frac) {
      const d = parseInt(frac[2], 10);
      if (d) value = parseInt(frac[1], 10) / d;
    } else if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
      value = parseFloat(trimmed);
    }
  }
  if (value === null) return trimmed;
  const v = value * scale;
  if (v === 0) return '0';
  const whole = Math.floor(v);
  const frac = +(v - whole).toFixed(3);
  const fracStr = VULGAR_FRAC[frac.toFixed(2)] || (frac > 0 ? frac.toFixed(2).replace(/\.?0+$/, '') : '');
  if (whole === 0) return fracStr || '0';
  if (!fracStr) return String(whole);
  // Use unicode vulgar fraction inline with whole (e.g. "1½")
  if (VULGAR_FRAC[frac.toFixed(2)]) return `${whole}${fracStr}`;
  return `${whole} ${fracStr}`;
}

// Parse a step's first sentence as a title and the rest as body. Falls back
// to using the whole string as the body with no title when the step is just
// one short sentence (the visual still works — there's a numbered circle).
function splitStep(text: string): { title: string | null; body: string } {
  const trimmed = (text || '').trim();
  if (!trimmed) return { title: null, body: '' };
  // Look for a colon-style title: "Salt the water heavily: bring a pot..."
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx > 4 && colonIdx < 80) {
    const candidate = trimmed.slice(0, colonIdx).trim();
    if (!/[.!?]/.test(candidate)) {
      return { title: candidate, body: trimmed.slice(colonIdx + 1).trim() };
    }
  }
  // Otherwise split on the first sentence-ending punctuation when the
  // sentence is short enough to feel like a heading.
  const m = trimmed.match(/^([^.!?]+[.!?])\s+(.+)$/s);
  if (m && m[1].length <= 60 && m[2].length > 0) {
    return { title: m[1].replace(/[.!?]$/, '').trim(), body: m[2].trim() };
  }
  return { title: null, body: trimmed };
}

// Extract minutes/seconds from a step's body text so we can show a Start
// timer pill. Returns null when nothing time-like is mentioned.
function extractStepMs(text: string): { label: string; ms: number } | null {
  const haystack = text || '';
  const hour = haystack.match(/(\d+)\s?(?:hours?|hr|h)\b/i);
  const min = haystack.match(/(\d+)\s?(?:minutes?|mins?|m)\b/i);
  const sec = haystack.match(/(\d+)\s?(?:seconds?|secs?|s)\b/i);
  let ms = 0;
  const parts: string[] = [];
  if (hour) { ms += parseInt(hour[1]) * 3_600_000; parts.push(`${hour[1]}h`); }
  if (min)  { ms += parseInt(min[1])  * 60_000;    parts.push(`${min[1]} min`); }
  if (sec && !min && !hour) { ms += parseInt(sec[1]) * 1000; parts.push(`${sec[1]}s`); }
  if (ms === 0) return null;
  return { label: parts.join(' '), ms };
}

// Format minute total ("12 min", "1 h", "1 h 25 min")
function formatMinutes(mins: number): string {
  if (!Number.isFinite(mins) || mins <= 0) return '';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

// Normalize a rating to 5-point scale for display. Legacy formal-recipe
// data was stored as 0–10; anything > 5 gets halved.
const norm5 = (n: number): number => (n > 5 ? n / 2 : n);

/* ── Unified view model ──────────────────────────────────────────────
   Both Recipe (formal table) and FriendHomeMeal (home_meals JSON in
   user_app_data) flatten into this shape. `source` distinguishes them
   for the few branches that have to differ — review table, owner edit
   affordance, save target, etc. Everything else renders identically.
   ──────────────────────────────────────────────────────────────────── */
type UnifiedRecipe = {
  source: 'recipe' | 'homeMeal';
  id: string;
  ownerId: string;
  title: string;
  description: string;
  intro: string[];
  cuisine: string;
  difficulty: 'easy' | 'medium' | 'hard' | '';
  tags: string[];
  ingredients: RecipeIngredient[];
  steps: string[];
  photos: string[];
  coverPhoto: string;
  prepMinutes: number;
  cookMinutes: number;
  servings: number;
  date: string;
  updatedAt: string;
  sourceType?: 'user' | 'expert';
  /* ── Advanced-builder fields (all optional). ────────────────── */
  /** One-line summary shown under the title on the recipe page. */
  summary?: string;
  /** Meal courses, e.g. ['Dinner', 'Side']. Rendered as eyebrow chips. */
  course?: string[];
  /** Rest / chill minutes, separate from prep + cook. */
  chillMinutes?: number;
  /** Free-text yield label, e.g. "4 generous bowls". */
  yieldDescription?: string;
  /** Named ingredient sub-sections (Sauce / Dough / etc.). When present
   *  and non-empty, RecipePage renders these instead of the flat list. */
  ingredientGroups?: Array<{ name: string; ingredients: RecipeIngredient[] }>;
  /** Tools / cookware the reader should have ready. */
  equipment?: string[];
  /** Per-step rich details (title, body, duration, tip). When present
   *  and non-empty, RecipePage uses these instead of the flat strings. */
  stepDetails?: Array<{ title?: string; body: string; durationMin?: number; tip?: string }>;
  /** Labeled callouts (Chef's Tip / Make Ahead / etc.). */
  notes?: Array<{ type: 'tip' | 'makeAhead' | 'substitution' | 'general'; text: string }>;
  raw: Recipe | FriendHomeMeal;
};

// Description may be a long multi-paragraph chef's note. Split on blank
// lines so each paragraph gets its own <p> and the drop cap applies to the
// first one. Falls back to a single paragraph or an empty array.
function splitIntro(description: string): string[] {
  const cleaned = (description || '').trim();
  if (!cleaned) return [];
  return cleaned.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
}

function adaptRecipe(r: Recipe): UnifiedRecipe {
  return {
    source: 'recipe',
    id: r.id,
    ownerId: r.userId,
    title: r.title || '',
    description: r.description || '',
    intro: splitIntro(r.description || ''),
    cuisine: r.cuisine || '',
    difficulty: (r.difficulty || '') as UnifiedRecipe['difficulty'],
    tags: r.tags || [],
    ingredients: r.ingredients || [],
    steps: (r.steps || []).map((s) => s.text),
    photos: r.photos || [],
    coverPhoto: r.photos?.[0] || '',
    prepMinutes: r.prepTimeMinutes ?? 0,
    cookMinutes: r.cookTimeMinutes ?? 0,
    servings: r.servings ?? 0,
    date: r.createdAt || '',
    updatedAt: r.updatedAt || r.createdAt || '',
    sourceType: r.sourceType,
    raw: r,
  };
}

function adaptHomeMeal(m: FriendHomeMeal): UnifiedRecipe {
  const photos = [
    ...(m.coverPhoto ? [m.coverPhoto] : []),
    ...(m.photos || []).map((p) => p.url).filter(Boolean),
  ];
  // FriendHomeMeal is HomeMeal + userId; the advanced fields are
  // declared on HomeMeal so they're present in this type too.
  const adv = m as FriendHomeMeal & {
    summary?: string;
    course?: string[];
    chillTime?: number;
    yieldDescription?: string;
    ingredientGroups?: Array<{ name: string; ingredients: RecipeIngredient[] }>;
    equipment?: string[];
    stepDetails?: Array<{ title?: string; body: string; durationMin?: number; tip?: string }>;
    notes?: Array<{ type: 'tip' | 'makeAhead' | 'substitution' | 'general'; text: string }>;
  };
  return {
    source: 'homeMeal',
    id: m.id,
    ownerId: m.userId,
    title: m.name || '',
    description: m.description || '',
    intro: splitIntro(m.description || ''),
    cuisine: m.cuisine || '',
    difficulty: ((m.difficulty || '').toLowerCase() || '') as UnifiedRecipe['difficulty'],
    tags: m.tags || [],
    ingredients: m.ingredients || [],
    steps: m.steps || [],
    photos,
    coverPhoto: photos[0] || '',
    prepMinutes: m.prepTime ?? 0,
    cookMinutes: m.cookTime ?? 0,
    servings: m.servings ?? 0,
    date: m.date || '',
    updatedAt: new Date(m.createdAt ?? Date.now()).toISOString(),
    summary: adv.summary,
    course: adv.course,
    chillMinutes: adv.chillTime,
    yieldDescription: adv.yieldDescription,
    ingredientGroups: adv.ingredientGroups,
    equipment: adv.equipment,
    stepDetails: adv.stepDetails,
    notes: adv.notes,
    raw: m,
  };
}

type UnifiedReview = {
  id: string;
  userId: string;
  rating: number;
  notes: string;
  photo: string;
  createdAt: string;
  verified?: boolean;
};

export const RecipePage: React.FC = () => {
  const params = useParams<{ userId?: string; id?: string; mealId?: string }>();
  const ownerId = params.userId || '';
  const resolvedId = params.id || params.mealId || '';

  const navigate = useNavigate();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const { phoneMode } = useSettings();
  const { restaurantMeta, stashMetaKey, homeMeals: myHomeMeals, openHomeMealModal } = useLists();
  const { myRecipes, openRecipeModal } = useRecipes();

  // ── Data ──
  const [data, setData] = useState<UnifiedRecipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [authorProfile, setAuthorProfile] = useState<UserProfile | null>(null);
  const [reviews, setReviews] = useState<UnifiedReview[]>([]);
  const [reviewerProfiles, setReviewerProfiles] = useState<Record<string, UserProfile>>({});
  const [myReview, setMyReview] = useState<UnifiedReview | null>(null);
  const [related, setRelated] = useState<Recipe[]>([]);
  const [relatedAuthors, setRelatedAuthors] = useState<Record<string, UserProfile>>({});

  // ── User interactions ──
  const [savedIds, setSavedIds] = useState<Set<string>>(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY_SAVED); return new Set(raw ? JSON.parse(raw) : []); }
    catch { return new Set(); }
  });
  const [cookedIds, setCookedIds] = useState<Set<string>>(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY_COOKED); return new Set(raw ? JSON.parse(raw) : []); }
    catch { return new Set(); }
  });
  const [servings, setServings] = useState<number>(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [doneSteps, setDoneSteps] = useState<Set<number>>(new Set());
  const [cookMode, setCookMode] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const saved = data ? savedIds.has(data.id) : false;
  const cooked = data ? cookedIds.has(data.id) : false;

  // ── Load the recipe ──
  useEffect(() => {
    if (!resolvedId) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setData(null);
    setAuthorProfile(null);
    setReviews([]);
    setMyReview(null);
    setReviewerProfiles({});

    (async () => {
      // 1. Local stores — owner viewing their own content.
      if (ownerId && currentUserId === ownerId) {
        const ownRecipe = myRecipes.find((r) => r.id === resolvedId);
        if (ownRecipe) {
          if (!cancelled) { setData(adaptRecipe(ownRecipe)); setLoading(false); }
          return;
        }
        const ownMeal = myHomeMeals.find((m) => m.id === resolvedId);
        if (ownMeal) {
          if (!cancelled) { setData(adaptHomeMeal({ ...ownMeal, userId: ownerId })); setLoading(false); }
          return;
        }
      }
      // 2. Formal recipe table (UUID-shaped only).
      if (isUuidLike(resolvedId)) {
        const formal = await fetchRecipeFromDb(resolvedId);
        if (cancelled) return;
        if (formal && (formal.isPublic || formal.userId === currentUserId)) {
          setData(adaptRecipe(formal));
          setLoading(false);
          return;
        }
      }
      // 3. Public home meal.
      if (ownerId) {
        const meal = await getPublicHomeMealById(ownerId, resolvedId);
        if (cancelled) return;
        if (meal) { setData(adaptHomeMeal(meal)); setLoading(false); return; }
      }
      if (!cancelled) { setNotFound(true); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [resolvedId, ownerId, currentUserId, myRecipes, myHomeMeals]);

  // ── Reviews + author profile + related recipes ──
  useEffect(() => {
    if (!data) return;
    let cancelled = false;

    // Seed the servings stepper from the recipe's base each time data changes.
    setServings(data.servings > 0 ? data.servings : 4);
    setChecked(new Set());
    setDoneSteps(new Set());

    (async () => {
      const profileMap = await getProfilesByIds([data.ownerId]);
      if (!cancelled) setAuthorProfile(profileMap[data.ownerId] ?? null);
    })();

    (async () => {
      try {
        if (data.source === 'recipe') {
          const rows = await getRecipeReviews(data.id);
          if (cancelled) return;
          const reviewerIds = Array.from(new Set(rows.map((r) => r.userId).filter(Boolean)));
          const profiles = reviewerIds.length > 0 ? await getProfilesByIds(reviewerIds) : {};
          if (cancelled) return;
          const adapted: UnifiedReview[] = rows.map((r: RecipeReview) => ({
            id: r.id,
            userId: r.userId,
            rating: norm5(r.rating),
            notes: r.notes || '',
            photo: r.photo || '',
            createdAt: r.createdAt,
          }));
          setReviewerProfiles(profiles);
          setReviews(adapted.filter((r) => r.userId !== currentUserId));
          const mine = adapted.find((r) => r.userId === currentUserId) || null;
          setMyReview(mine);
        } else {
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
          const reviewerIds = Array.from(new Set(all.map((r) => r.userId).filter(Boolean)));
          const profiles = reviewerIds.length > 0 ? await getProfilesByIds(reviewerIds) : {};
          if (cancelled) return;
          setReviewerProfiles(profiles);
          const adapted: UnifiedReview[] = all.map((r: HomeMealReview) => ({
            id: r.id,
            userId: r.userId,
            rating: norm5(r.rating),
            notes: r.notes || '',
            photo: '',
            createdAt: r.createdAt,
          }));
          setReviews(adapted.filter((r) => r.userId !== currentUserId));
          // Layered fallback: dedicated table → ListsContext meta
          let resolvedMine: UnifiedReview | null = null;
          if (mine) {
            resolvedMine = { id: mine.id, userId: mine.userId, rating: norm5(mine.rating), notes: mine.notes || '', photo: '', createdAt: mine.createdAt };
          } else if (currentUserId) {
            const metaReviews = ((restaurantMeta as Record<string, unknown>).__my_meal_reviews__ ?? {}) as Record<string, { rating: number; notes: string }>;
            const local = metaReviews[data.id];
            if (local) {
              resolvedMine = { id: 'local', userId: currentUserId, rating: norm5(local.rating), notes: local.notes || '', photo: '', createdAt: '' };
            }
          }
          setMyReview(resolvedMine);
        }
      } catch (err) {
        console.warn('[RecipePage] failed to load reviews:', err);
      }
    })();

    // Related — fetch a slice and filter to same-cuisine + not-self + not-this-recipe.
    (async () => {
      try {
        const all = await getPublicRecipes(60);
        if (cancelled) return;
        const wantCuisine = (data.cuisine || '').toLowerCase();
        const filtered = all.filter((r) => {
          if (r.id === data.id) return false;
          if (r.userId === data.ownerId && wantCuisine) {
            // Same chef + same cuisine still feels like "more like this".
            return r.cuisine.toLowerCase() === wantCuisine;
          }
          if (wantCuisine) return r.cuisine.toLowerCase() === wantCuisine;
          return true;
        });
        const top = (filtered.length >= 4 ? filtered : all.filter((r) => r.id !== data.id)).slice(0, 4);
        setRelated(top);
        const relatedAuthorIds = Array.from(new Set(top.map((r) => r.userId).filter(Boolean)));
        if (relatedAuthorIds.length > 0) {
          const profiles = await getProfilesByIds(relatedAuthorIds);
          if (!cancelled) setRelatedAuthors(profiles);
        }
      } catch { /* non-fatal */ }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, currentUserId]);

  // ── Sticky-nav scroll state ──
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 200);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Helpers ──
  const showToast = useCallback((msg: string) => setToast(msg), []);
  const persistSet = (set: Set<string>, key: string) => {
    try { localStorage.setItem(key, JSON.stringify(Array.from(set))); } catch { /* quota */ }
  };
  const handleSave = useCallback(() => {
    if (!data) return;
    setSavedIds((prev) => {
      const next = new Set<string>(prev);
      if (next.has(data.id)) { next.delete(data.id); showToast('Removed from saved'); }
      else { next.add(data.id); showToast('Saved to your recipe box'); }
      persistSet(next, STORAGE_KEY_SAVED);
      return next;
    });
  }, [data, showToast]);
  const handleCooked = useCallback(() => {
    if (!data) return;
    setCookedIds((prev) => {
      const next = new Set<string>(prev);
      if (next.has(data.id)) { next.delete(data.id); showToast('Removed from cooked'); }
      else { next.add(data.id); showToast('Nice — marked as cooked'); }
      persistSet(next, STORAGE_KEY_COOKED);
      return next;
    });
  }, [data, showToast]);
  const handleShare = useCallback(() => {
    if (!data) return;
    const url = `${window.location.origin}/recipe/${data.ownerId}/${data.id}`;
    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator.share({ title: data.title, url }).catch(() => { /* user cancel */ });
    } else {
      navigator.clipboard?.writeText(url).catch(() => { /* ignore */ });
      showToast('Link copied to clipboard');
    }
  }, [data, showToast]);
  const handlePrint = useCallback(() => window.print(), []);
  const handleEdit = useCallback(() => {
    if (!data) return;
    if (data.source === 'recipe') {
      openRecipeModal(data.raw as Recipe);
      return;
    }
    // Home meal / Advanced-builder recipe. Open the Add Recipe modal
    // pre-filled with the meal so the user can edit in place. Prefer
    // the canonical store copy (myHomeMeals) over the adapted view
    // data — it carries the full HomeMeal shape the modal expects.
    const meal = myHomeMeals.find((m) => m.id === data.id) ?? (data.raw as HomeMeal);
    openHomeMealModal(meal);
  }, [data, openRecipeModal, openHomeMealModal, myHomeMeals]);

  const submitReview = useCallback(async (
    rating: number,
    title: string,
    body: string,
    cookedIt: boolean,
  ) => {
    if (!data || !currentUserId || rating < 1) return false;
    try {
      if (data.source === 'recipe') {
        const saved = await upsertFormalReview(currentUserId, data.id, {
          rating,
          notes: title ? `${title}\n\n${body}` : body,
          photo: '',
        });
        if (saved) {
          setMyReview({
            id: saved.id,
            userId: saved.userId,
            rating: norm5(saved.rating),
            notes: saved.notes,
            photo: saved.photo || '',
            createdAt: saved.createdAt,
          });
        }
      } else {
        const notes = title ? `${title}\n\n${body}` : body;
        const saved = await upsertHomeMealReview(currentUserId, data.id, { rating, notes });
        // Also stash via ListsContext meta so the home-meal fallback path
        // surfaces the review for the author.
        const existing = ((restaurantMeta as Record<string, unknown>).__my_meal_reviews__ ?? {}) as Record<string, unknown>;
        stashMetaKey('__my_meal_reviews__', {
          ...existing,
          [data.id]: { rating, notes, updatedAt: new Date().toISOString() },
        });
        if (saved) {
          setMyReview({ id: saved.id, userId: saved.userId, rating: norm5(saved.rating), notes: saved.notes, photo: '', createdAt: saved.createdAt });
        }
      }
      if (cookedIt && data && !cookedIds.has(data.id)) {
        setCookedIds((prev) => {
          const next = new Set<string>(prev); next.add(data.id);
          persistSet(next, STORAGE_KEY_COOKED);
          return next;
        });
      }
      showToast('Review posted — thanks for cooking!');
      return true;
    } catch (err) {
      console.warn('[RecipePage] review submit failed:', err);
      showToast('Could not post review');
      return false;
    }
  }, [data, currentUserId, cookedIds, restaurantMeta, stashMetaKey, showToast]);

  // ── Derived view data ──
  const stars5 = useMemo(() => {
    if (!data) return 0;
    const all = [...reviews, ...(myReview ? [myReview] : [])];
    if (all.length === 0) return 0;
    return all.reduce((s, r) => s + r.rating, 0) / all.length;
  }, [reviews, myReview, data]);
  const ratingsCount = useMemo(() => reviews.length + (myReview ? 1 : 0), [reviews.length, myReview]);
  const ratingBreakdown = useMemo<Record<number, number>>(() => {
    const all = [...reviews, ...(myReview ? [myReview] : [])];
    const out: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const r of all) {
      const rounded = Math.max(1, Math.min(5, Math.round(r.rating)));
      out[rounded]++;
    }
    return out;
  }, [reviews, myReview]);

  const totalMinutes = (data?.prepMinutes || 0) + (data?.cookMinutes || 0) + (data?.chillMinutes || 0);

  // Servings scaling for the ingredient list. Base is the original recipe's
  // serves (≥ 1) so scaling never divides by zero on quirky data.
  const baseServings = Math.max(1, data?.servings || 4);
  const scale = servings > 0 ? servings / baseServings : 1;

  const isOwner = !!data && !!currentUserId && data.ownerId === currentUserId;

  const toggleCheck = useCallback((key: string) => {
    setChecked((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  }, []);
  const toggleStep = useCallback((i: number) => {
    setDoneSteps((prev) => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; });
  }, []);

  // ── Render guards ──
  if (loading) {
    return (
      <div className="recipe-detail-page">
        <div className="rd-state">
          <Loader2 size={32} className="animate-spin icon" />
        </div>
      </div>
    );
  }
  if (notFound || !data) {
    return (
      <div className="recipe-detail-page">
        <div className="rd-state">
          <ChefHat size={36} className="icon" />
          <p className="title">Recipe not found</p>
          <p className="sub">It may have been deleted or made private.</p>
          <button type="button" className="back-link" onClick={() => navigate(-1)}>
            <ArrowLeft /> Back
          </button>
        </div>
      </div>
    );
  }

  // ── Author display ──
  const authorName = authorProfile?.display_name || authorProfile?.username || 'Anonymous';
  const authorRole = authorProfile?.is_expert
    ? `Chef${authorProfile.home_city ? ` · ${authorProfile.home_city}` : ''}`
    : 'Home cook';
  const authorInitial = (authorName[0] || '?').toUpperCase();
  const authorInitials = authorName.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || 'A';
  const authorHue = hashToHue(data.ownerId || authorName);
  const authorBg = `hsl(${authorHue} 45% 38%)`;

  // ── Stars renderer ──
  const renderStars = (value: number, size = 13) => {
    const rounded = Math.round(value);
    return Array.from({ length: 5 }).map((_, i) => (
      <Star
        key={i}
        size={size}
        className={i < rounded ? '' : 'empty'}
        fill={i < rounded ? 'currentColor' : 'currentColor'}
      />
    ));
  };

  // ── Mobile layout (rendered when phoneMode is true) ──────────────
  //    Different markup using .rdm-* classes so the page renders as a
  //    phone screen instead of the desktop layout squashed down. Shares
  //    all data hooks, save/cook handlers, and review submission with
  //    the desktop branch below.
  if (phoneMode) {
    return (
      <div className="recipe-detail-page">
        <MobileRecipeView
          data={data}
          authorProfile={authorProfile}
          reviews={reviews}
          reviewerProfiles={reviewerProfiles}
          myReview={myReview}
          related={related}
          relatedAuthors={relatedAuthors}
          stars5={stars5}
          ratingsCount={ratingsCount}
          ratingBreakdown={ratingBreakdown}
          totalMinutes={totalMinutes}
          baseServings={baseServings}
          scale={scale}
          servings={servings}
          setServings={setServings}
          checked={checked}
          toggleCheck={toggleCheck}
          doneSteps={doneSteps}
          toggleStep={toggleStep}
          saved={saved}
          cooked={cooked}
          isOwner={isOwner}
          scrolled={scrolled}
          toast={toast}
          cookMode={cookMode}
          setCookMode={setCookMode}
          reviewOpen={reviewOpen}
          setReviewOpen={setReviewOpen}
          handleSave={handleSave}
          handleCooked={handleCooked}
          handleShare={handleShare}
          handleEdit={handleEdit}
          submitReview={submitReview}
          renderStars={renderStars}
          authorName={authorName}
          authorRole={authorRole}
          authorInitial={authorInitial}
          authorInitials={authorInitials}
          authorBg={authorBg}
          authorUsername={authorProfile?.username || ''}
          currentUserId={currentUserId}
          currentUserName={user?.email?.split('@')[0] || 'You'}
          navigate={navigate}
        />
      </div>
    );
  }

  return (
    <div className="recipe-detail-page">
      {/* ── Top nav ───────────────────────────────────────────────── */}
      <nav className={cn('rd-nav', scrolled && 'scrolled')}>
        <div className="rd-nav-inner">
          <div className="rd-nav-left">
            <button type="button" className="rd-nav-back" onClick={() => navigate(-1)} aria-label="Back">
              <ArrowLeft />
            </button>
            <span className="crumbs">
              <Link to="/">Discover</Link>
              <span className="crumb-sep">/</span>
              <Link to="/recipes-for-you">Recipes</Link>
              <span className="crumb-sep">/</span>
              <span className="here">{data.title.split(' ').slice(-1)[0] || 'Recipe'}</span>
            </span>
          </div>
          <div className="rd-nav-title">{data.title}</div>
          <div className="rd-nav-actions">
            <button type="button" className="icon-btn" title="Print" onClick={handlePrint} aria-label="Print"><Printer /></button>
            <button type="button" className={cn('icon-btn', saved && 'saved')} title={saved ? 'Saved' : 'Save'} onClick={handleSave} aria-label="Save">
              <Heart fill={saved ? 'currentColor' : 'none'} />
            </button>
            <button type="button" className="icon-btn" title="Share" onClick={handleShare} aria-label="Share"><Share2 /></button>
            {isOwner && (
              <button type="button" className="icon-btn" title="Edit" onClick={handleEdit} aria-label="Edit"><Edit3 /></button>
            )}
            <button type="button" className="rd-nav-primary" onClick={() => setCookMode(true)}>
              <Play fill="currentColor" /> Cook
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <header className="rd-hero">
        <div className="rd-hero-text">
          <div className="rd-hero-eyebrow">
            {data.cuisine && <span>{data.cuisine}</span>}
            {data.cuisine && data.difficulty && <span className="sep">·</span>}
            {data.difficulty && <span>{DIFFICULTY_LABEL[data.difficulty]}</span>}
            {data.course && data.course.length > 0 && (
              <>
                <span className="sep">·</span>
                {data.course.slice(0, 3).map((c) => (
                  <span key={c} className="rd-eyebrow-chip">{c}</span>
                ))}
              </>
            )}
            {data.sourceType === 'expert' && (
              <span className="badge"><Sparkles /> Editor's pick</span>
            )}
          </div>
          <h1 className="rd-hero-title">{data.title}</h1>
          {data.summary ? (
            <p className="rd-hero-byline">{data.summary}</p>
          ) : data.intro[0] ? (
            <p className="rd-hero-byline">{data.intro[0].length > 180 ? data.intro[0].slice(0, 177) + '…' : data.intro[0]}</p>
          ) : null}
          {(ratingsCount > 0 || data.updatedAt) && (
            <div className="rd-hero-meta-row">
              {ratingsCount > 0 && (
                <span className="rating">
                  <span className="stars">{renderStars(stars5)}</span>
                  {stars5.toFixed(1)}
                </span>
              )}
              {ratingsCount > 0 && (
                <span className="ratings-link">{ratingsCount.toLocaleString()} rating{ratingsCount === 1 ? '' : 's'}</span>
              )}
              {cookedIds.size > 0 && data && cookedIds.has(data.id) && (
                <>
                  {ratingsCount > 0 && <span className="sep" />}
                  <span>You cooked this</span>
                </>
              )}
              {data.updatedAt && (
                <>
                  {(ratingsCount > 0 || (data && cookedIds.has(data.id))) && <span className="sep" />}
                  <span>Updated {new Date(data.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </>
              )}
            </div>
          )}
          {(authorProfile || data.ownerId) && (
            <button
              type="button"
              className="rd-hero-author"
              onClick={() => authorProfile?.username && navigate(`/user/${authorProfile.username}`)}
              style={{ background: 'transparent', textAlign: 'left' }}
            >
              <div className="rd-hero-author-av" style={{ background: authorBg }}>{authorInitial}</div>
              <div className="rd-hero-author-info">
                <span className="rd-hero-author-byline">Recipe by</span>
                <span className="rd-hero-author-name">
                  {authorName} <span className="rd-hero-author-role">— {authorRole}</span>
                </span>
              </div>
            </button>
          )}
        </div>
        <div className="rd-hero-image">
          {data.coverPhoto ? (
            <img src={data.coverPhoto} alt={data.title} referrerPolicy="no-referrer" />
          ) : (
            <div className="ph-fallback"><ChefHat /></div>
          )}
        </div>
      </header>

      {/* ── Stats strip ───────────────────────────────────────────── */}
      <section className="rd-stats">
        <div className="rd-stats-inner">
          <div className="rd-stat">
            <div className="rd-stat-label"><Clock /> Prep</div>
            <div className="rd-stat-value">
              {data.prepMinutes > 0 ? <>{data.prepMinutes} <span className="unit">min</span></> : '—'}
            </div>
          </div>
          <div className="rd-stat">
            <div className="rd-stat-label"><Flame /> Cook</div>
            <div className="rd-stat-value">
              {data.cookMinutes > 0 ? <>{data.cookMinutes} <span className="unit">min</span></> : '—'}
            </div>
          </div>
          {data.chillMinutes && data.chillMinutes > 0 && (
            <div className="rd-stat">
              <div className="rd-stat-label"><Clock /> Rest</div>
              <div className="rd-stat-value">
                {data.chillMinutes} <span className="unit">min</span>
              </div>
            </div>
          )}
          <div className="rd-stat">
            <div className="rd-stat-label"><Clock /> Total</div>
            <div className="rd-stat-value">
              {totalMinutes > 0 ? <>{totalMinutes} <span className="unit">min</span></> : '—'}
            </div>
          </div>
          <div className="rd-stat">
            <div className="rd-stat-label"><Users /> Serves</div>
            <div className="rd-stat-value">{data.servings > 0 ? data.servings : '—'}</div>
            {data.yieldDescription && (
              <div className="rd-stat-sub">{data.yieldDescription}</div>
            )}
          </div>
          <div className="rd-stat">
            <div className="rd-stat-label"><Award /> Level</div>
            <div className="rd-stat-value" data-large="true" style={{ fontSize: 20 }}>
              {data.difficulty ? DIFFICULTY_LABEL[data.difficulty] : '—'}
            </div>
          </div>
        </div>
      </section>

      {/* ── Action bar ────────────────────────────────────────────── */}
      <section className="rd-actions">
        <button type="button" className="rd-action-btn primary" onClick={() => setCookMode(true)}>
          <Play fill="currentColor" /> Start cooking
        </button>
        <button type="button" className={cn('rd-action-btn', saved && 'saved')} onClick={handleSave}>
          <Heart fill={saved ? 'currentColor' : 'none'} />
          {saved ? 'Saved' : 'Save'}
        </button>
        <button type="button" className={cn('rd-action-btn', cooked && 'cooked-state')} onClick={handleCooked}>
          {cooked ? <Check /> : <ChefHat />}
          {cooked ? "I've cooked this" : 'Mark as cooked'}
        </button>
        <button type="button" className="rd-action-btn" onClick={handleShare}><Share2 /> Share</button>
        <button type="button" className="rd-action-btn" onClick={handlePrint}><Printer /> Print</button>
        {isOwner && (
          <button type="button" className="rd-action-btn" onClick={handleEdit}><Edit3 /> Edit</button>
        )}
        <div className="rd-action-divider" />
        {data.tags.length > 0 && (
          <div className="rd-tags">
            {data.tags.map((t) => <span key={t} className="rd-tag">{t}</span>)}
          </div>
        )}
      </section>

      {/* ── Intro prose with drop cap ─────────────────────────────── */}
      {data.intro.length > 0 && (
        <section className="rd-intro">
          {data.intro.map((p, i) => <p key={i}>{p}</p>)}
        </section>
      )}

      {/* ── Body: ingredients sidebar + directions ────────────────── */}
      <div className="rd-body">
        <aside className="rd-ingredients">
          {(() => {
            // When the recipe was published via the Advanced builder it
            // carries explicit ingredient groups (Sauce / Dough / etc.).
            // Otherwise treat the flat list as a single anonymous group
            // so the render below has a uniform shape. Total count is
            // the sum across groups either way.
            const renderGroups = (data.ingredientGroups && data.ingredientGroups.length > 0)
              ? data.ingredientGroups
              : [{ name: '', ingredients: data.ingredients }];
            const totalItems = renderGroups.reduce((sum, g) => sum + g.ingredients.length, 0);
            return (
              <>
          <div className="rd-section-head">
            <h2 className="rd-section-title">Ingredients</h2>
            <span className="rd-section-count">{totalItems} item{totalItems === 1 ? '' : 's'}</span>
          </div>
          {totalItems === 0 ? (
            <p style={{ marginTop: 16, fontSize: 14, color: 'var(--muted)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>
              No ingredients listed.
            </p>
          ) : (
            <>
              <div className="rd-servings-control">
                <div>
                  <div className="rd-servings-label">Servings</div>
                  <div className="scaled-from">Scaled from {baseServings}</div>
                </div>
                <div className="rd-servings-stepper">
                  <button type="button" onClick={() => setServings((s) => Math.max(1, s - 1))} disabled={servings <= 1} aria-label="Decrease servings">–</button>
                  <span className="value">{servings}</span>
                  <button type="button" onClick={() => setServings((s) => Math.min(24, s + 1))} aria-label="Increase servings">+</button>
                </div>
              </div>
              {renderGroups.map((group, gi) => (
                <div className="rd-ingr-group" key={gi}>
                  {group.name && renderGroups.length > 1 && (
                    <h3 className="rd-ingr-group-title">{group.name}</h3>
                  )}
                  <div className="rd-ingr-list">
                    {group.ingredients.map((ing, ii) => {
                      const key = `g-${gi}-i-${ii}`;
                      const isChecked = checked.has(key);
                      const qty = formatQty(ing.amount, scale);
                      return (
                        <button
                          key={key}
                          type="button"
                          className={cn('rd-ingr-item', isChecked && 'checked')}
                          onClick={() => toggleCheck(key)}
                        >
                          <span className="check"><Check /></span>
                          <span className="rd-ingr-text text">
                            {qty && <span className="qty">{qty}</span>}
                            {ing.unit && <span className="unit">{ing.unit}</span>}
                            <span className="name">{ing.name}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="rd-ingr-actions">
                <button type="button" className="rd-ingr-action" onClick={() => showToast('Coming soon')}>
                  <Plus /> Add to list
                </button>
                <button type="button" className="rd-ingr-action" onClick={handlePrint}>
                  <Printer /> Print
                </button>
              </div>
            </>
          )}
              </>
            );
          })()}
        </aside>

        <section className="rd-main-col">
          <div className="rd-directions-head">
            <div>
              <h2 className="rd-section-title">Directions</h2>
              <div className="sub">
                {data.steps.length} step{data.steps.length === 1 ? '' : 's'}
                {totalMinutes > 0 ? ` · estimated ${formatMinutes(totalMinutes)}` : ''}
              </div>
            </div>
            <button type="button" className="rd-cookmode-btn" onClick={() => setCookMode(true)}>
              <Play fill="currentColor" /> Cook mode
            </button>
          </div>

          {/* Equipment row — only renders for recipes that have it.
              Sits between the Directions header and the first step,
              same editorial card style as the cookbook reference. */}
          {data.equipment && data.equipment.length > 0 && (
            <div className="rd-equipment-card">
              <span className="rd-equipment-card-label">Equipment</span>
              <ul className="rd-equipment-card-list">
                {data.equipment.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {(() => {
            // Prefer rich stepDetails when present (Advanced builder).
            // Otherwise derive the same shape from the flat string list
            // so the rest of this branch can render uniformly.
            const richSteps = (data.stepDetails && data.stepDetails.length > 0)
              ? data.stepDetails
              : data.steps.map((s) => {
                  const split = splitStep(s);
                  const timer = extractStepMs(s);
                  return {
                    title: split.title || undefined,
                    body: split.body || s,
                    durationMin: timer ? Math.round(timer.ms / 60000) : undefined,
                    tip: undefined as string | undefined,
                  };
                });
            if (richSteps.length === 0) {
              return (
                <p style={{ fontSize: 15, color: 'var(--muted)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>
                  No directions yet.
                </p>
              );
            }
            return (
              <ol className="rd-steps">
                {richSteps.map((step, i) => {
                  const isDone = doneSteps.has(i);
                  return (
                    <li key={i} className={cn('rd-step', isDone && 'done')}>
                      <div className="rd-step-num-wrap">
                        <div className="rd-step-num">{String(i + 1).padStart(2, '0')}</div>
                        <button
                          type="button"
                          className="rd-step-check"
                          onClick={() => toggleStep(i)}
                          title={isDone ? 'Mark as not done' : 'Mark as done'}
                          aria-label={isDone ? 'Mark as not done' : 'Mark as done'}
                        >
                          <Check />
                        </button>
                      </div>
                      <div className="rd-step-content">
                        {step.title && <h3 className="rd-step-title">{step.title}</h3>}
                        <p className="rd-step-body">{step.body}</p>
                        {step.durationMin !== undefined && step.durationMin > 0 && (
                          <div className="rd-step-meta">
                            <StepTimerButton
                              label={`${step.durationMin} min`}
                              durationMs={step.durationMin * 60_000}
                            />
                          </div>
                        )}
                        {step.tip && (
                          <div className="rd-step-tip">
                            <span className="rd-step-tip-label">Tip</span>
                            <span className="rd-step-tip-text">{step.tip}</span>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            );
          })()}
        </section>
      </div>

      {/* ── Notes from the kitchen (Advanced builder typed callouts) ── */}
      {data.notes && data.notes.length > 0 && (
        <section className="rd-notes">
          <h2 className="rd-section-title">Notes from the kitchen</h2>
          <div className="rd-notes-list">
            {data.notes.map((n, i) => (
              <div key={i} className="rd-note-card" data-type={n.type}>
                <span className="rd-note-card-label">
                  {n.type === 'tip' ? "Chef's tip"
                    : n.type === 'makeAhead' ? 'Make ahead'
                    : n.type === 'substitution' ? 'Substitution'
                    : 'Note'}
                </span>
                <p className="rd-note-card-text">{n.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Author bio ────────────────────────────────────────────── */}
      {authorProfile && (
        <section className="rd-author-bio">
          <div className="rd-author-bio-inner">
            <div className="rd-author-bio-av" style={{ background: authorBg }}>{authorInitials}</div>
            <div className="rd-author-bio-info">
              <div className="rd-author-bio-label">About the {authorProfile.is_expert ? 'chef' : 'cook'}</div>
              <h3 className="rd-author-bio-name">{authorName}</h3>
              <div className="rd-author-bio-role">{authorRole}</div>
              {authorProfile.bio && <p className="rd-author-bio-text">{authorProfile.bio}</p>}
              <button
                type="button"
                className="rd-author-follow"
                onClick={() => authorProfile.username && navigate(`/user/${authorProfile.username}`)}
              >
                View profile
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Reviews ───────────────────────────────────────────────── */}
      <section className="rd-reviews-section">
        <div className="rd-reviews-head">
          <div>
            <h2 className="rd-reviews-title">What people are saying</h2>
            <div className="rd-reviews-summary">
              <span className="rd-reviews-avg">
                {ratingsCount > 0 ? stars5.toFixed(1) : '—'}<span className="of">/5</span>
              </span>
              <div>
                <div className="rd-reviews-stars">{renderStars(stars5, 18)}</div>
                <div className="rd-reviews-count">
                  {ratingsCount > 0
                    ? `${ratingsCount.toLocaleString()} rating${ratingsCount === 1 ? '' : 's'}`
                    : 'No reviews yet'}
                </div>
              </div>
            </div>
            {myReview ? (
              <div className="rd-reviews-cta-done">
                <Check /> Thanks for reviewing — you rated this {Math.round(myReview.rating)}/5
              </div>
            ) : (
              currentUserId && !isOwner && (
                <button type="button" className="rd-reviews-cta" onClick={() => setReviewOpen(true)}>
                  <Star fill="currentColor" /> Write a review
                </button>
              )
            )}
          </div>
          <div className="rd-rating-bars">
            {([5, 4, 3, 2, 1] as const).map((n) => {
              const count = ratingBreakdown[n] || 0;
              const pct = ratingsCount > 0 ? (count / ratingsCount) * 100 : 0;
              return (
                <React.Fragment key={n}>
                  <span className="rd-rating-bar-label">{n} <Star fill="currentColor" /></span>
                  <div className="rd-rating-bar-track">
                    <div className="rd-rating-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="rd-rating-bar-count">{count.toLocaleString()}</span>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <div className="rd-reviews-list">
          {myReview && (
            <ReviewCard
              review={myReview}
              isMine
              profile={null}
              currentUserName={user?.email?.split('@')[0]}
              renderStars={renderStars}
            />
          )}
          {reviews.map((r) => (
            <ReviewCard
              key={r.id}
              review={r}
              profile={reviewerProfiles[r.userId]}
              renderStars={renderStars}
            />
          ))}
          {reviews.length === 0 && !myReview && (
            <p style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '32px', fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--muted)' }}>
              Be the first to cook and review this.
            </p>
          )}
        </div>
      </section>

      {/* ── Related recipes ──────────────────────────────────────── */}
      {related.length > 0 && (
        <section className="rd-related-section">
          <div className="rd-related-head">
            <h2 className="rd-related-title">
              You might also <span className="accent">like</span>
            </h2>
            <Link to="/recipes-for-you" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)' }}>
              Browse all recipes →
            </Link>
          </div>
          <div className="rd-related-grid">
            {related.map((r) => {
              const ra = relatedAuthors[r.userId];
              const rAuthor = ra?.display_name || ra?.username || 'Chef';
              const rHue = hashToHue(r.userId || rAuthor);
              const rTime = (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0);
              const rCover = r.photos?.[0] || '';
              return (
                <button
                  key={r.id}
                  type="button"
                  className="rd-related-card"
                  onClick={() => navigate(`/recipe/${r.userId}/${r.id}`)}
                >
                  <div className="rd-related-img" style={{ background: `linear-gradient(135deg, hsl(${rHue} 50% 52%), hsl(${(rHue + 25) % 360} 50% 42%))` }}>
                    {rCover ? (
                      <img src={rCover} alt={r.title} loading="lazy" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="ph-fallback"><ChefHat /></div>
                    )}
                  </div>
                  <div className="rd-related-body">
                    <h3 className="rd-related-name">{r.title}</h3>
                    <div className="rd-related-meta">
                      {r.cuisine && <span>{r.cuisine}</span>}
                      {r.cuisine && rTime > 0 && <span className="sep" />}
                      {rTime > 0 && <span><Clock /> {formatMinutes(rTime)}</span>}
                      <span className="sep" />
                      <span className="author">
                        <span className="av" style={{ background: `hsl(${rHue} 45% 38%)` }}>{(rAuthor[0] || '?').toUpperCase()}</span>
                        {rAuthor}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Cook mode overlay ────────────────────────────────────── */}
      {cookMode && (
        <CookMode recipe={data} onClose={() => setCookMode(false)} />
      )}

      {/* ── Review modal ─────────────────────────────────────────── */}
      {reviewOpen && data && (
        <ReviewModal
          recipe={data}
          authorName={authorName}
          currentUserName={user?.email?.split('@')[0] || 'You'}
          onClose={() => setReviewOpen(false)}
          onSubmit={async (form) => {
            const ok = await submitReview(form.rating, form.title, form.body, form.cookedIt);
            if (ok) setReviewOpen(false);
          }}
        />
      )}

      {/* ── Toast ────────────────────────────────────────────────── */}
      {toast && (
        <div className="rd-toast">
          <Check /> {toast}
        </div>
      )}
    </div>
  );
};

/* ── Sub-components ──────────────────────────────────────────────── */

const StepTimerButton: React.FC<{ label: string; durationMs: number }> = ({ label, durationMs }) => {
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(durationMs);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (running) {
      intervalRef.current = window.setInterval(() => {
        setRemaining((r) => {
          if (r <= 1000) {
            if (intervalRef.current) window.clearInterval(intervalRef.current);
            setRunning(false);
            return 0;
          }
          return r - 1000;
        });
      }, 1000);
    } else if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) window.clearInterval(intervalRef.current); };
  }, [running]);

  const display = useMemo(() => {
    const total = Math.ceil(remaining / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m > 0) return `${m}:${String(s).padStart(2, '0')}`;
    return `${s}s`;
  }, [remaining]);

  return (
    <button
      type="button"
      className="rd-step-timer"
      onClick={() => {
        if (!running && remaining === 0) setRemaining(durationMs);
        setRunning(!running);
      }}
    >
      <Clock />
      <span>{label}</span>
      <span className="play">
        {running ? display : (remaining > 0 && remaining < durationMs ? `${display} · paused` : 'Start')}
      </span>
    </button>
  );
};

const CookMode: React.FC<{ recipe: UnifiedRecipe; onClose: () => void }> = ({ recipe, onClose }) => {
  const [step, setStep] = useState(0);
  const total = recipe.steps.length;
  const current = recipe.steps[step] || '';
  const split = splitStep(current);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setStep((s) => Math.min(total - 1, s + 1));
      if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [total, onClose]);

  if (total === 0) {
    return (
      <div className="rd-cookmode">
        <div className="rd-cookmode-nav">
          <div className="rd-cookmode-title">Cook mode · {recipe.title}</div>
          <button type="button" className="rd-cookmode-close" onClick={onClose} aria-label="Exit (Esc)"><X /></button>
        </div>
        <div className="rd-cookmode-body">
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', fontFamily: 'var(--serif)', color: 'rgba(255,255,255,0.6)' }}>
            No directions to step through yet.
          </div>
        </div>
      </div>
    );
  }

  const timer = extractStepMs(current);

  return (
    <div className="rd-cookmode">
      <div className="rd-cookmode-nav">
        <div className="rd-cookmode-title">Cook mode · {recipe.title}</div>
        <button type="button" className="rd-cookmode-close" onClick={onClose} aria-label="Exit (Esc)"><X /></button>
      </div>
      <div className="rd-cookmode-progress">
        {recipe.steps.map((_, i) => (
          <div key={i} className={cn('rd-cm-dot', i < step && 'done', i === step && 'current')} />
        ))}
      </div>
      <div className="rd-cookmode-body">
        <div>
          <div className="rd-cookmode-step-num">{String(step + 1).padStart(2, '0')}</div>
          {timer && (
            <div className="rd-cookmode-step-meta" style={{ marginTop: 16 }}>
              <Clock size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />
              {timer.label}
            </div>
          )}
        </div>
        <div>
          <div className="rd-cookmode-step-meta">Step {step + 1} of {total}</div>
          {split.title && <h2 className="rd-cookmode-step-title">{split.title}</h2>}
          <p className="rd-cookmode-step-body">{split.body || current}</p>
        </div>
      </div>
      <div className="rd-cookmode-controls">
        <button type="button" className="rd-cm-btn" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          <ChevronLeft /> Previous
        </button>
        <div className="rd-cm-counter">
          <span className="n">{step + 1}</span> <span style={{ opacity: 0.5 }}>/ {total}</span>
        </div>
        <button
          type="button"
          className="rd-cm-btn primary"
          onClick={() => { if (step >= total - 1) onClose(); else setStep(step + 1); }}
        >
          {step >= total - 1 ? 'Finished' : 'Next step'} <ChevronRight />
        </button>
      </div>
    </div>
  );
};

const ReviewModal: React.FC<{
  recipe: UnifiedRecipe;
  authorName: string;
  currentUserName: string;
  onClose: () => void;
  onSubmit: (form: { rating: number; title: string; body: string; cookedIt: boolean }) => void;
}> = ({ recipe, currentUserName, onClose, onSubmit }) => {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [cookedIt, setCookedIt] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const labels = ['', 'Did not like it', 'Just okay', 'Pretty good', 'Really good', 'Loved it'];
  const canSubmit = rating > 0 && body.trim().length >= 10 && !submitting;

  return (
    <div className="rd-modal-overlay" onClick={onClose}>
      <form
        className="rd-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canSubmit) return;
          setSubmitting(true);
          await onSubmit({ rating, title: title.trim(), body: body.trim(), cookedIt });
          setSubmitting(false);
        }}
      >
        <header className="rd-modal-head">
          <div>
            <div className="rd-modal-eyebrow">Write a review</div>
            <h2 className="rd-modal-title">{recipe.title}</h2>
          </div>
          <button type="button" className="rd-modal-close" onClick={onClose} aria-label="Close"><X /></button>
        </header>
        <div className="rd-modal-body">
          <div className="rd-modal-field">
            <label className="rd-modal-label">Your rating</label>
            <div className="rd-modal-stars">
              {[1, 2, 3, 4, 5].map((n) => {
                const active = n <= (hover || rating);
                return (
                  <button
                    type="button"
                    key={n}
                    className={cn('rd-modal-star', active && 'active')}
                    onMouseEnter={() => setHover(n)}
                    onMouseLeave={() => setHover(0)}
                    onClick={() => setRating(n)}
                    aria-label={`${n} star${n === 1 ? '' : 's'}`}
                  >
                    <Star />
                  </button>
                );
              })}
              <span className="rd-modal-star-label">{labels[hover || rating] || 'Tap to rate'}</span>
            </div>
          </div>
          <div className="rd-modal-field">
            <label className="rd-modal-toggle">
              <input type="checkbox" checked={cookedIt} onChange={(e) => setCookedIt(e.target.checked)} />
              <span className="box"><Check /></span>
              <span>I actually cooked this recipe</span>
            </label>
          </div>
          <div className="rd-modal-field">
            <label className="rd-modal-label" htmlFor="rd-title">Headline <span className="opt">(optional)</span></label>
            <input
              id="rd-title"
              className="rd-modal-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sum it up in a few words"
              maxLength={80}
            />
          </div>
          <div className="rd-modal-field">
            <label className="rd-modal-label" htmlFor="rd-body">
              Your review
              <span className="hint">{body.length}/600 · min 10</span>
            </label>
            <textarea
              id="rd-body"
              className="rd-modal-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, 600))}
              placeholder="What did you make of it? Any tips for other cooks? Subs you tried?"
              rows={5}
            />
          </div>
        </div>
        <footer className="rd-modal-foot">
          <div className="rd-modal-foot-hint">
            Posted as <strong>{currentUserName}</strong>
          </div>
          <div className="rd-modal-foot-actions">
            <button type="button" className="rd-action-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className={cn('rd-action-btn', 'primary', !canSubmit && 'disabled')} disabled={!canSubmit}>
              <Check /> {submitting ? 'Posting…' : 'Post review'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
};

const ReviewCard: React.FC<{
  review: UnifiedReview;
  profile?: UserProfile | null;
  isMine?: boolean;
  currentUserName?: string;
  renderStars: (value: number, size?: number) => React.ReactNode;
}> = ({ review, profile, isMine, currentUserName, renderStars }) => {
  const name = isMine
    ? (currentUserName || 'You')
    : (profile?.display_name || profile?.username || 'Anonymous');
  const initial = (name[0] || '?').toUpperCase();
  const hue = hashToHue(review.userId || name);
  const date = review.createdAt
    ? new Date(review.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'just now';
  // The headline/body separator we wrote when submitting was "\n\n".
  const splitIdx = review.notes.indexOf('\n\n');
  const reviewTitle = splitIdx > 0 ? review.notes.slice(0, splitIdx).trim() : '';
  const reviewBody = splitIdx > 0 ? review.notes.slice(splitIdx + 2).trim() : review.notes;
  return (
    <article className={cn('rd-review', isMine && 'rd-review-mine')}>
      {isMine && <div className="rd-review-mine-badge">Your review</div>}
      <header className="rd-review-head">
        <div className="rd-review-av" style={{ background: `hsl(${hue} 45% 38%)` }}>{initial}</div>
        <div className="rd-review-meta">
          <div className="rd-review-name">
            {name}
            {isMine && <span className="verified"><Check /> Verified cook</span>}
          </div>
          <div className="rd-review-info">
            <span>{date}</span>
          </div>
        </div>
        <div className="rd-review-rating">{renderStars(review.rating)}</div>
      </header>
      {reviewTitle && (
        <div style={{ fontFamily: 'var(--serif)', fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
          {reviewTitle}
        </div>
      )}
      {reviewBody && <p className="rd-review-body">"{reviewBody}"</p>}
      {!isMine && (
        <div className="rd-review-actions">
          <button type="button"><Heart /> Helpful</button>
          <button type="button"><MessageCircle /> Reply</button>
        </div>
      )}
    </article>
  );
};

/* ── Mobile render tree ─────────────────────────────────────────────
   Renders a phone-shaped recipe detail view that mirrors the supplied
   mock-up. Receives all the parent state + handlers as props so the
   data hooks aren't duplicated between layouts. Keeps a sticky header
   with a Back + heart + share, a 4:3 hero image, a title block with
   eyebrow/title/byline/rating/author/3×2 stats/3 action buttons, then
   tags, an intro with drop cap, an ingredients section, a directions
   section, notes, nutrition (hidden), author bio, reviews, and a
   horizontal "you might also like" rail. A black FAB pinned to the
   bottom-right launches Cook mode.
   ──────────────────────────────────────────────────────────────────── */

interface MobileViewProps {
  data: UnifiedRecipe;
  authorProfile: UserProfile | null;
  reviews: UnifiedReview[];
  reviewerProfiles: Record<string, UserProfile>;
  myReview: UnifiedReview | null;
  related: Recipe[];
  relatedAuthors: Record<string, UserProfile>;
  stars5: number;
  ratingsCount: number;
  ratingBreakdown: Record<number, number>;
  totalMinutes: number;
  baseServings: number;
  scale: number;
  servings: number;
  setServings: React.Dispatch<React.SetStateAction<number>>;
  checked: Set<string>;
  toggleCheck: (key: string) => void;
  doneSteps: Set<number>;
  toggleStep: (i: number) => void;
  saved: boolean;
  cooked: boolean;
  isOwner: boolean;
  scrolled: boolean;
  toast: string | null;
  cookMode: boolean;
  setCookMode: React.Dispatch<React.SetStateAction<boolean>>;
  reviewOpen: boolean;
  setReviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleSave: () => void;
  handleCooked: () => void;
  handleShare: () => void;
  handleEdit: () => void;
  submitReview: (rating: number, title: string, body: string, cookedIt: boolean) => Promise<boolean>;
  renderStars: (value: number, size?: number) => React.ReactNode;
  authorName: string;
  authorRole: string;
  authorInitial: string;
  authorInitials: string;
  authorBg: string;
  authorUsername: string;
  currentUserId: string | null;
  currentUserName: string;
  navigate: (to: string | number) => void;
}

const MobileRecipeView: React.FC<MobileViewProps> = ({
  data, authorProfile, reviews, reviewerProfiles, myReview, related, relatedAuthors,
  stars5, ratingsCount, ratingBreakdown, totalMinutes, baseServings, scale,
  servings, setServings, checked, toggleCheck, doneSteps, toggleStep,
  saved, cooked, isOwner, scrolled, toast, cookMode, setCookMode, reviewOpen, setReviewOpen,
  handleSave, handleCooked, handleShare, handleEdit, submitReview,
  renderStars, authorName, authorRole, authorInitial, authorInitials, authorBg,
  authorUsername, currentUserId, currentUserName, navigate,
}) => (
  <div className="rdm">
    {/* Sticky header */}
    <nav className={cn('rdm-nav', scrolled && 'scrolled')}>
      <div className="rdm-nav-row">
        <button type="button" className="rdm-back" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft />
        </button>
        <div className="rdm-nav-title">{data.title}</div>
        <button
          type="button"
          className={cn('rdm-nav-icon', saved && 'saved')}
          onClick={handleSave}
          aria-label={saved ? 'Saved' : 'Save'}
        >
          <Heart fill={saved ? 'currentColor' : 'none'} />
        </button>
        <button type="button" className="rdm-nav-icon" onClick={handleShare} aria-label="Share">
          <Share2 />
        </button>
      </div>
    </nav>

    <div className="rdm-page">
      {/* Hero image */}
      <div className="rdm-hero-img">
        {data.coverPhoto ? (
          <img src={data.coverPhoto} alt={data.title} referrerPolicy="no-referrer" />
        ) : (
          <div className="ph-fallback"><ChefHat /></div>
        )}
        {data.sourceType === 'expert' && (
          <div className="badge"><Sparkles /> Editor's pick</div>
        )}
      </div>

      {/* Title block */}
      <section className="rdm-title-block">
        {(data.cuisine || data.difficulty) && (
          <div className="rdm-eyebrow">
            {data.cuisine && <span>{data.cuisine}</span>}
            {data.cuisine && data.difficulty && <span className="sep">·</span>}
            {data.difficulty && <span>{DIFFICULTY_LABEL[data.difficulty]}</span>}
          </div>
        )}
        <h1 className="rdm-title">{data.title}</h1>
        {data.intro[0] && (
          <p className="rdm-byline">
            {data.intro[0].length > 220 ? data.intro[0].slice(0, 217) + '…' : data.intro[0]}
          </p>
        )}

        {(ratingsCount > 0 || cooked) && (
          <div className="rdm-rating-row">
            {ratingsCount > 0 && (
              <span className="rating">
                <Star fill="currentColor" /> {stars5.toFixed(1)}
              </span>
            )}
            {ratingsCount > 0 && (
              <span>{ratingsCount.toLocaleString()} rating{ratingsCount === 1 ? '' : 's'}</span>
            )}
            {cooked && (
              <>
                {ratingsCount > 0 && <span className="sep" />}
                <span>You cooked this</span>
              </>
            )}
          </div>
        )}

        {(authorProfile || data.ownerId) && (
          <button
            type="button"
            className="rdm-author"
            onClick={() => authorUsername && navigate(`/user/${authorUsername}`)}
          >
            <div className="av" style={{ background: authorBg }}>{authorInitial}</div>
            <div className="rdm-author-info">
              <span className="byline">Recipe by</span>
              <span className="name">{authorName}</span>
              <span className="role">{authorRole}</span>
            </div>
          </button>
        )}

        <div className="rdm-stats">
          <div className="rdm-stat">
            <div className="l">Prep</div>
            <div className="v">
              {data.prepMinutes > 0 ? <>{data.prepMinutes}<span className="unit">min</span></> : '—'}
            </div>
          </div>
          <div className="rdm-stat">
            <div className="l">Cook</div>
            <div className="v">
              {data.cookMinutes > 0 ? <>{data.cookMinutes}<span className="unit">min</span></> : '—'}
            </div>
          </div>
          <div className="rdm-stat">
            <div className="l">Total</div>
            <div className="v">
              {totalMinutes > 0 ? <>{totalMinutes}<span className="unit">min</span></> : '—'}
            </div>
          </div>
          <div className="rdm-stat">
            <div className="l">Serves</div>
            <div className="v">{data.servings > 0 ? data.servings : '—'}</div>
          </div>
          <div className="rdm-stat">
            <div className="l">Level</div>
            <div className="v" style={{ fontSize: 14, paddingTop: 4 }}>
              {data.difficulty ? DIFFICULTY_LABEL[data.difficulty] : '—'}
            </div>
          </div>
          <div className="rdm-stat">
            <div className="l">Steps</div>
            <div className="v">{data.steps.length || '—'}</div>
          </div>
        </div>

        <div className="rdm-actions">
          <button type="button" className={cn('rdm-act', saved && 'saved')} onClick={handleSave}>
            <Heart fill={saved ? 'currentColor' : 'none'} />
            {saved ? 'Saved' : 'Save'}
          </button>
          <button type="button" className={cn('rdm-act', cooked && 'cooked-state')} onClick={handleCooked}>
            {cooked ? <Check /> : <ChefHat />}
            {cooked ? 'Cooked' : 'Cooked it'}
          </button>
          <button type="button" className="rdm-act" onClick={() => window.print()}>
            <Printer /> Print
          </button>
        </div>
      </section>

      {/* Tags */}
      {data.tags.length > 0 && (
        <div className="rdm-tags">
          {data.tags.map((t) => <span key={t} className="rdm-tag">{t}</span>)}
        </div>
      )}

      {/* Intro */}
      {data.intro.length > 0 && (
        <section className="rdm-intro">
          {data.intro.map((p, i) => <p key={i}>{p}</p>)}
        </section>
      )}

      {/* Ingredients */}
      <section className="rdm-section">
        <h2 className="rdm-section-title">
          Ingredients
          <span className="count">{data.ingredients.length} item{data.ingredients.length === 1 ? '' : 's'}</span>
        </h2>
        {data.ingredients.length === 0 ? (
          <p style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 14, color: 'var(--muted)' }}>
            No ingredients listed.
          </p>
        ) : (
          <>
            <div className="rdm-servings">
              <div>
                <div className="lbl">Servings</div>
                <div className="sub">Scaled from {baseServings}</div>
              </div>
              <div className="rdm-stepper">
                <button type="button" onClick={() => setServings((s) => Math.max(1, s - 1))} disabled={servings <= 1} aria-label="Decrease servings">–</button>
                <span className="v">{servings}</span>
                <button type="button" onClick={() => setServings((s) => Math.min(24, s + 1))} aria-label="Increase servings">+</button>
              </div>
            </div>
            <div className="rdm-ingr-group">
              {data.ingredients.map((ing, i) => {
                const key = `i-${i}`;
                const isChecked = checked.has(key);
                const qty = formatQty(ing.amount, scale);
                return (
                  <button
                    key={key}
                    type="button"
                    className={cn('rdm-ingr-item', isChecked && 'checked')}
                    onClick={() => toggleCheck(key)}
                  >
                    <span className="check"><Check /></span>
                    <span className="rdm-ingr-text text">
                      {qty && <span className="qty">{qty}</span>}
                      {ing.unit && <span className="unit">{ing.unit}</span>}
                      <span className="name">{ing.name}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* Directions */}
      <section className="rdm-section">
        <h2 className="rdm-section-title">
          Directions
          <span className="count">{data.steps.length} step{data.steps.length === 1 ? '' : 's'}</span>
        </h2>
        {/* Equipment card — sits between the Directions title and the
            first step on phone too, but stacked vertically to fit. */}
        {data.equipment && data.equipment.length > 0 && (
          <div className="rd-equipment-card">
            <span className="rd-equipment-card-label">Equipment</span>
            <ul className="rd-equipment-card-list">
              {data.equipment.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {data.steps.length === 0 ? (
          <p style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 14, color: 'var(--muted)' }}>
            No directions yet.
          </p>
        ) : (
          <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {data.steps.map((step, i) => {
              const split = splitStep(step);
              const timer = extractStepMs(step);
              const isDone = doneSteps.has(i);
              return (
                <li key={i} className={cn('rdm-step', isDone && 'done')}>
                  <div className="rdm-step-num-wrap">
                    <div className="rdm-step-num">{String(i + 1).padStart(2, '0')}</div>
                    <button
                      type="button"
                      className="rdm-step-check"
                      onClick={() => toggleStep(i)}
                      aria-label={isDone ? 'Mark as not done' : 'Mark as done'}
                    >
                      <Check />
                    </button>
                  </div>
                  <div>
                    {split.title && <h3 className="rdm-step-title">{split.title}</h3>}
                    <p className="rdm-step-body">{split.body || step}</p>
                    {timer && (
                      <div className="rdm-step-meta">
                        <MobileStepTimer label={timer.label} durationMs={timer.ms} />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Author bio */}
      {authorProfile && (
        <section className="rdm-section">
          <h2 className="rdm-section-title">About the {authorProfile.is_expert ? 'chef' : 'cook'}</h2>
          <div className="rdm-author-bio">
            <div className="rdm-author-bio-row">
              <div className="rdm-author-bio-av" style={{ background: authorBg }}>{authorInitials}</div>
              <div className="rdm-author-bio-info">
                <h3 className="rdm-author-bio-name">{authorName}</h3>
                <div className="rdm-author-bio-role">{authorRole}</div>
              </div>
            </div>
            {authorProfile.bio && <p className="rdm-author-bio-text">{authorProfile.bio}</p>}
            <div className="rdm-author-bio-stats">
              <button
                type="button"
                className="rdm-author-bio-follow"
                onClick={() => authorUsername && navigate(`/user/${authorUsername}`)}
              >
                View profile
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Reviews */}
      <section className="rdm-section">
        <h2 className="rdm-section-title">
          Reviews
          {ratingsCount > 0 && <span className="count">{ratingsCount.toLocaleString()}</span>}
        </h2>
        <div className="rdm-reviews-summary">
          <div className="rdm-reviews-avg">
            {ratingsCount > 0 ? stars5.toFixed(1) : '—'}<span className="of">/5</span>
          </div>
          <div>
            <div className="rdm-reviews-stars">{renderStars(stars5)}</div>
            <div className="rdm-reviews-count">
              {ratingsCount > 0
                ? `${ratingsCount.toLocaleString()} rating${ratingsCount === 1 ? '' : 's'}`
                : 'No reviews yet'}
            </div>
            {myReview ? (
              <div className="rdm-reviews-cta-done">
                <Check /> Rated {Math.round(myReview.rating)}/5
              </div>
            ) : (
              currentUserId && !isOwner && (
                <button type="button" className="rdm-reviews-cta" onClick={() => setReviewOpen(true)}>
                  <Star fill="currentColor" /> Write a review
                </button>
              )
            )}
          </div>
        </div>
        {ratingsCount > 0 && (
          <div className="rdm-rating-bars">
            {([5, 4, 3, 2, 1] as const).map((n) => {
              const count = ratingBreakdown[n] || 0;
              const pct = ratingsCount > 0 ? (count / ratingsCount) * 100 : 0;
              return (
                <React.Fragment key={n}>
                  <span className="rdm-rating-bar-label">{n} <Star fill="currentColor" /></span>
                  <div className="rdm-rating-bar-track">
                    <div className="rdm-rating-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="rdm-rating-bar-count">{count.toLocaleString()}</span>
                </React.Fragment>
              );
            })}
          </div>
        )}
        {myReview && (
          <MobileReviewCard
            review={myReview}
            isMine
            currentUserName={currentUserName}
            renderStars={renderStars}
          />
        )}
        {reviews.slice(0, 3).map((r) => (
          <MobileReviewCard
            key={r.id}
            review={r}
            profile={reviewerProfiles[r.userId]}
            renderStars={renderStars}
          />
        ))}
        {reviews.length === 0 && !myReview && (
          <p style={{ textAlign: 'center', padding: '20px 8px', fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--muted)', fontSize: 14 }}>
            Be the first to cook and review this.
          </p>
        )}
      </section>

      {/* Related */}
      {related.length > 0 && (
        <section className="rdm-section">
          <h2 className="rdm-section-title">You might also like</h2>
          <div className="rdm-related-row">
            {related.map((r) => {
              const ra = relatedAuthors[r.userId];
              const rAuthor = ra?.display_name || ra?.username || 'Chef';
              const rHue = hashToHue(r.userId || rAuthor);
              const rTime = (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0);
              const rCover = r.photos?.[0] || '';
              return (
                <button
                  key={r.id}
                  type="button"
                  className="rdm-related"
                  onClick={() => navigate(`/recipe/${r.userId}/${r.id}`)}
                >
                  <div className="rdm-related-img" style={{ background: `linear-gradient(135deg, hsl(${rHue} 50% 52%), hsl(${(rHue + 25) % 360} 50% 42%))` }}>
                    {rCover ? (
                      <img src={rCover} alt={r.title} loading="lazy" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="ph-fallback"><ChefHat /></div>
                    )}
                  </div>
                  <div className="rdm-related-body">
                    <h3 className="rdm-related-name">{r.title}</h3>
                    <div className="rdm-related-meta">
                      {r.cuisine && <span>{r.cuisine}</span>}
                      {r.cuisine && rTime > 0 && <span className="sep" />}
                      {rTime > 0 && <span>{formatMinutes(rTime)}</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Owner edit (small inline link, since the design lacks an edit affordance) */}
      {isOwner && (
        <section className="rdm-section" style={{ paddingBottom: 40 }}>
          <button
            type="button"
            className="rdm-act"
            onClick={handleEdit}
            style={{ flex: 'none', width: '100%' }}
          >
            <Edit3 /> Edit this recipe
          </button>
        </section>
      )}
    </div>

    {/* Cook mode FAB (hidden when overlay open) */}
    {!cookMode && data.steps.length > 0 && (
      <button type="button" className="rdm-cookmode-fab" onClick={() => setCookMode(true)}>
        <Play fill="currentColor" /> Cook mode
      </button>
    )}

    {/* Cook mode overlay */}
    {cookMode && (
      <MobileCookMode recipe={data} onClose={() => setCookMode(false)} />
    )}

    {/* Review modal */}
    {reviewOpen && (
      <ReviewModal
        recipe={data}
        authorName={authorName}
        currentUserName={currentUserName}
        onClose={() => setReviewOpen(false)}
        onSubmit={async (form) => {
          const ok = await submitReview(form.rating, form.title, form.body, form.cookedIt);
          if (ok) setReviewOpen(false);
        }}
      />
    )}

    {/* Toast */}
    {toast && (
      <div className="rdm-toast">
        <Check /> {toast}
      </div>
    )}
  </div>
);

const MobileStepTimer: React.FC<{ label: string; durationMs: number }> = ({ label, durationMs }) => {
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(durationMs);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (running) {
      intervalRef.current = window.setInterval(() => {
        setRemaining((r) => {
          if (r <= 1000) {
            if (intervalRef.current) window.clearInterval(intervalRef.current);
            setRunning(false);
            return 0;
          }
          return r - 1000;
        });
      }, 1000);
    } else if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) window.clearInterval(intervalRef.current); };
  }, [running]);

  const display = useMemo(() => {
    const total = Math.ceil(remaining / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m > 0) return `${m}:${String(s).padStart(2, '0')}`;
    return `${s}s`;
  }, [remaining]);

  return (
    <button
      type="button"
      className="rdm-step-timer"
      onClick={() => {
        if (!running && remaining === 0) setRemaining(durationMs);
        setRunning(!running);
      }}
    >
      <Clock />
      <span>{label}</span>
      <span className="play">
        {running ? display : (remaining > 0 && remaining < durationMs ? display : 'Start')}
      </span>
    </button>
  );
};

const MobileReviewCard: React.FC<{
  review: UnifiedReview;
  profile?: UserProfile | null;
  isMine?: boolean;
  currentUserName?: string;
  renderStars: (value: number, size?: number) => React.ReactNode;
}> = ({ review, profile, isMine, currentUserName, renderStars }) => {
  const name = isMine
    ? (currentUserName || 'You')
    : (profile?.display_name || profile?.username || 'Anonymous');
  const initial = (name[0] || '?').toUpperCase();
  const hue = hashToHue(review.userId || name);
  const date = review.createdAt
    ? new Date(review.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'just now';
  const splitIdx = review.notes.indexOf('\n\n');
  const reviewBody = splitIdx > 0 ? review.notes.slice(splitIdx + 2).trim() : review.notes;
  return (
    <article className={cn('rdm-review', isMine && 'rdm-review-mine')}>
      {isMine && <div className="rdm-review-mine-badge">Your review</div>}
      <header className="rdm-review-head">
        <div className="rdm-review-av" style={{ background: `hsl(${hue} 45% 38%)` }}>{initial}</div>
        <div className="rdm-review-meta">
          <div className="rdm-review-name">
            {name}
            {isMine && <span className="verified"><Check /> Verified</span>}
          </div>
          <div className="rdm-review-info">
            <span>{date}</span>
          </div>
        </div>
        <div className="rdm-review-rating">{renderStars(review.rating)}</div>
      </header>
      {reviewBody && <p className="rdm-review-body">"{reviewBody}"</p>}
    </article>
  );
};

const MobileCookMode: React.FC<{ recipe: UnifiedRecipe; onClose: () => void }> = ({ recipe, onClose }) => {
  const [step, setStep] = useState(0);
  const total = recipe.steps.length;
  const current = recipe.steps[step] || '';
  const split = splitStep(current);
  const timer = extractStepMs(current);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setStep((s) => Math.min(total - 1, s + 1));
      if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [total, onClose]);

  return (
    <div className="rdm-cookmode">
      <div className="rdm-cm-nav">
        <button type="button" className="rdm-cm-close" onClick={onClose} aria-label="Exit"><X /></button>
        <div className="rdm-cm-title">Cook mode</div>
        <div style={{ width: 36 }} />
      </div>
      <div className="rdm-cm-progress">
        {recipe.steps.map((_, i) => (
          <div key={i} className={cn('rdm-cm-dot', i < step && 'done', i === step && 'current')} />
        ))}
      </div>
      <div className="rdm-cm-body">
        <div className="rdm-cm-stepmeta">
          Step {step + 1} of {total}{timer ? ` · ${timer.label}` : ''}
        </div>
        <div className="rdm-cm-num">{String(step + 1).padStart(2, '0')}</div>
        {split.title && <h2 className="rdm-cm-step-title">{split.title}</h2>}
        <p className="rdm-cm-step-body">{split.body || current}</p>
      </div>
      <div className="rdm-cm-controls">
        <button
          type="button"
          className="rdm-cm-btn"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          <ChevronLeft /> Back
        </button>
        <button
          type="button"
          className="rdm-cm-btn primary"
          onClick={() => { if (step >= total - 1) onClose(); else setStep(step + 1); }}
        >
          {step >= total - 1 ? 'Finish' : 'Next'} <ChevronRight />
        </button>
      </div>
    </div>
  );
};
