/**
 * GuideCreatorSheet — multi-step wizard to create or edit a guide.
 *
 * Visual chrome mirrors the Advanced Recipe Builder: left rail (desktop)
 * with numbered step list and progress meter, or top progress strip
 * (phone), plus a sticky footer with Back / Save draft / Next or Publish.
 *
 * Steps:
 *   1. type        — Restaurants vs Recipes
 *   2. cover       — Cover photo.
 *   3. details     — Title, subtitle, intro, tags.
 *   4. seed        — pick a source (saved list / rated places / search /
 *                    recipes-list / recipes-my). Each option opens a
 *                    sub-page (back-to-picker) to pick individual items.
 *   5. entries     — Reorderable list of entries with inline detail edit.
 *   6. visibility  — Public / Private.
 *   7. review      — Mini-detail preview with click-to-edit jumps.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { X, ArrowLeft, ArrowRight, Plus, Trash2, BookOpen, ChefHat, Check, GripVertical, ImagePlus, Loader2, Globe, Lock, Search, ListChecks, Star, Wand2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useLists, type CustomList, type RestaurantRating, type Recipe as ListRecipe } from '../contexts/ListsContext';
import { useRecipes, type Recipe as DbRecipe } from '../contexts/RecipesContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { useBottomSheet } from '../lib/useBottomSheet';
import { saveGuide, type GuideEntry, type GuideType, type GuideVisibility, type Guide, type GuideTheme } from '../lib/supabase-guides';
import { searchPlacesByText, priceLevelToString, type PlaceResult } from '../lib/places';
import { GuideLiveEditor } from './guide/GuideLiveEditor';
import { getProfilesByIds, type UserProfile } from '../lib/supabase-community';
import './GuideCreatorSheet.css';
import './guide/GuideRender.css';
import './guide/GuideLiveEditor.css';

type Step = 'type' | 'cover' | 'details' | 'seed' | 'entries' | 'visibility' | 'review';
type SeedMode = 'list' | 'rated' | 'search' | 'recipes-list' | 'recipes-my';

interface GuideCreatorSheetProps {
  open: boolean;
  onClose: () => void;
  initialGuide?: Guide | null;
}

const STEPS_ORDER: Step[] = ['type', 'cover', 'details', 'seed', 'entries', 'visibility', 'review'];
const STEP_LABELS: Record<Step, string> = {
  type: 'Type',
  cover: 'Cover photo',
  details: 'Details',
  seed: 'Add entries',
  entries: 'Arrange entries',
  visibility: 'Visibility',
  review: 'Review & publish',
};
const NEXT_LABELS: Record<Exclude<Step, 'review'>, string> = {
  type: 'Cover photo',
  cover: 'Details',
  details: 'Add entries',
  seed: 'Arrange entries',
  entries: 'Visibility',
  visibility: 'Review & publish',
};

const TAG_SUGGESTIONS = [
  // Occasions
  'Date Night', 'First Date', 'Anniversary', 'Birthday', 'Special Occasion',
  'Holiday', 'Christmas', 'Thanksgiving', "Valentine's Day", "New Year's Eve",
  'Easter', "Mother's Day", "Father's Day", 'Brunch', 'Weekend', 'Weeknight',
  'Lunch', 'Quick Lunch', 'Late Night', 'Pre-Theater', 'Post-Theater',
  'Pre-Game', 'After Work', 'Happy Hour', 'Sunday Dinner', 'Game Day',
  'Movie Night', 'Casual Hangout', 'Bachelor', 'Bachelorette', 'Baby Shower',
  'Engagement', 'Wedding', 'Reunion', 'Going Away', 'Welcome Back',

  // Vibe / ambiance
  'Cozy', 'Romantic', 'Intimate', 'Quiet', 'Lively', 'Bustling', 'Energetic',
  'Trendy', 'Hipster', 'Classic', 'Old-School', 'Modern', 'Industrial',
  'Rustic', 'Chic', 'Elegant', 'Upscale', 'Casual', 'No-Frills', 'Divey',
  'Speakeasy', 'Hole-in-the-Wall', 'Hidden Gem', 'Iconic', 'Institution',
  'Buzzy', 'Up-and-Coming', 'Neighborhood Spot', 'Local Favorite',
  'Tourist-Free', 'Off-the-Beaten-Path', 'Destination', 'Worth the Trip',
  'Photogenic', 'Instagrammable', 'Beautiful', 'Stunning', 'Cool Decor',
  'Mural', 'Open Kitchen', "Chef's Counter", 'Counter Dining',

  // Seating / outdoor
  'Outdoor Seating', 'Patio', 'Garden', 'Rooftop', 'Terrace', 'Beachfront',
  'Waterfront', 'Skyline View', 'City View', 'Park View', 'Window Seat',
  'Booth', 'Bar Seating', 'Communal Table', 'Private Dining', 'Large Tables',
  'Sidewalk Seating', 'Heated Patio', 'Fireplace', 'Live Plants',
  'Sunset View', 'Mountain View', 'Beach View',

  // Cuisines
  'American', 'New American', 'Southern', 'Soul Food', 'Cajun', 'Creole',
  'Tex-Mex', 'Mexican', 'Oaxacan', 'Yucatecan', 'Peruvian', 'Brazilian',
  'Argentinian', 'Colombian', 'Venezuelan', 'Cuban', 'Caribbean', 'Jamaican',
  'Puerto Rican', 'Dominican', 'Italian', 'Northern Italian', 'Sicilian',
  'Tuscan', 'Roman', 'French', 'Provençal', 'Alsatian', 'Spanish', 'Basque',
  'Catalan', 'Portuguese', 'Greek', 'Turkish', 'Middle Eastern', 'Lebanese',
  'Syrian', 'Israeli', 'Moroccan', 'Tunisian', 'Egyptian', 'Ethiopian',
  'Eritrean', 'Persian', 'Afghan', 'Indian', 'North Indian', 'South Indian',
  'Goan', 'Pakistani', 'Sri Lankan', 'Bangladeshi', 'Nepalese', 'Tibetan',
  'Thai', 'Vietnamese', 'Cambodian', 'Laotian', 'Burmese', 'Malaysian',
  'Singaporean', 'Indonesian', 'Filipino', 'Chinese', 'Cantonese',
  'Szechuan', 'Hunan', 'Shanghainese', 'Taiwanese', 'Dim Sum', 'Japanese',
  'Sushi', 'Omakase', 'Izakaya', 'Ramen', 'Soba', 'Udon', 'Yakitori',
  'Tempura', 'Tonkatsu', 'Korean', 'Korean BBQ', 'Bibimbap', 'Russian',
  'Ukrainian', 'Polish', 'Hungarian', 'German', 'Austrian', 'Belgian',
  'Dutch', 'Scandinavian', 'Swedish', 'Danish', 'Norwegian', 'Icelandic',
  'British', 'Irish', 'Mediterranean', 'Eastern European', 'Hawaiian',
  'Pacific Rim', 'Fusion', 'Pan-Asian', 'Pan-Latin',

  // Food type
  'Pizza', 'Neapolitan', 'Detroit-Style', 'Sicilian Pizza', 'Wood-Fired',
  'Coal-Fired', 'Pizza by the Slice', 'Burger', 'Smash Burger', 'Sandwich',
  'Sub', 'Wrap', 'Banh Mi', 'Hot Dog', 'Salad', 'Bowl', 'Grain Bowl',
  'Pasta', 'Handmade Pasta', 'Noodles', 'Dumplings', 'Bao', 'Tacos',
  'Birria', 'Burrito', 'Quesadilla', 'Curry', 'Stir-Fry', 'Steak',
  'Steakhouse', 'Chophouse', 'Seafood', 'Raw Bar', 'Oysters', 'Lobster',
  'Crab', 'Shrimp', 'BBQ', 'Texas BBQ', 'Carolina BBQ', 'Brisket',
  'Ribs', 'Wings', 'Fried Chicken', 'Roast Chicken', 'Fish & Chips',
  'Bagels', 'Donuts', 'Pancakes', 'Waffles', 'French Toast', 'Eggs',
  'Avocado Toast', 'Coffee', 'Espresso', 'Pour Over', 'Matcha', 'Tea',
  'Boba', 'Smoothies', 'Juice', 'Ice Cream', 'Gelato', 'Sorbet', 'Pastries',
  'Croissants', 'Cakes', 'Cupcakes', 'Cookies', 'Bread', 'Sourdough',
  'Hot Pot', 'Shabu Shabu', 'Fondue', 'Charcuterie', 'Cheese Plate',

  // Drinks
  'Cocktails', 'Craft Cocktails', 'Classic Cocktails', 'Mocktails',
  'Wine Bar', 'Natural Wine', 'Orange Wine', 'Champagne', 'Bubbles',
  'Beer', 'Craft Beer', 'IPA', 'Lager', 'Pilsner', 'Sake', 'Whiskey',
  'Bourbon', 'Scotch', 'Rye', 'Mezcal', 'Tequila', 'Gin', 'Vodka', 'Rum',
  'Spritz', 'Negroni', 'Martini', 'Margarita', 'Manhattan', 'Old Fashioned',
  'Hot Chocolate', 'Iced Coffee', 'Cold Brew', 'Latte', 'Cappuccino',
  'Cortado', 'Flat White',

  // Diet
  'Vegan', 'Vegetarian', 'Plant-Based', 'Gluten-Free', 'Dairy-Free',
  'Nut-Free', 'Egg-Free', 'Soy-Free', 'Kosher', 'Halal', 'Pescatarian',
  'Flexitarian', 'Keto', 'Low-Carb', 'Paleo', 'Whole30', 'Mediterranean Diet',
  'Low-Sodium', 'Sugar-Free', 'Allergy-Friendly', 'Macro-Friendly', 'High-Protein',

  // Meal / format
  'Breakfast', 'All-Day Breakfast', 'Dinner', 'Dessert', 'Snack',
  'Appetizer', 'Tasting Menu', 'Prix Fixe', 'A La Carte', 'Buffet',
  'Family Style', 'Small Plates', 'Tapas', 'Shared Plates', 'Set Menu',
  'Wine Pairing',

  // Features / amenities
  'Dog-Friendly', 'Kid-Friendly', 'Family-Friendly', 'Stroller-Friendly',
  'Wheelchair-Accessible', 'Takeout', 'Delivery', 'Reservations', 'Walk-Ins',
  'BYOB', 'Corkage', 'Counter Service', 'Table Service', 'Self-Service',
  'Quick Service', 'Fine Dining', 'Casual Dining', 'Food Truck', 'Pop-Up',
  'Live Music', 'Live Jazz', 'DJ', 'Dancing', 'Karaoke', 'Trivia',
  'Open Mic', 'Sports On TV', 'Big Screen', 'Free Wifi', 'Laptop-Friendly',
  'Pet-Friendly Patio', 'Late-Night Kitchen', '24 Hours',

  // Price / value
  'Cheap Eats', 'Budget-Friendly', 'Affordable', 'Mid-Range', 'Pricey',
  'Splurge', 'Worth It', 'Hidden Value', 'Lunch Specials',

  // Quality / reputation
  'Michelin', 'Michelin Star', 'Michelin Bib', 'James Beard',
  'Award-Winning', 'Critically Acclaimed', "Critic's Pick", 'Legendary',
  'Just Opened', 'New', 'Trending', 'Must-Try', 'Bucket List',
  'Best in Class', 'Underrated', 'Overhyped',

  // Service
  'Friendly Service', 'Attentive Service', 'Knowledgeable Staff',
  'Sommelier', 'Tableside Service', 'Personalized',

  // Recipe / cooking
  'Quick', 'Easy', 'Make-Ahead', 'Meal Prep', 'One-Pot', 'One-Pan',
  'Sheet Pan', 'Dutch Oven', 'Slow Cooker', 'Instant Pot', 'Pressure Cooker',
  'Air Fryer', 'Grill', 'Stovetop', 'Oven-Roasted', 'No-Cook', 'No-Bake',
  'Microwave', 'Smoker', 'Sous Vide', '15-Min Meal', '30-Min Meal',
  'Under An Hour', 'Beginner', 'Intermediate', 'Advanced', 'Project Recipe',
  'Impressive', 'Crowd-Pleaser', 'Comfort Food', 'Healthy', 'Light',
  'Hearty', 'Spicy', 'Sweet', 'Savory', 'Tangy', 'Smoky', 'Fresh',
  'Bright', 'Bold', 'Mild', 'Kid-Approved', 'Picky-Eater Approved',
  'Big Batch', 'Freezer-Friendly', 'Pantry Staples', 'Leftovers-Friendly',
  'Bulk Cooking', 'Seasonal', 'Fall', 'Winter', 'Spring', 'Summer',
  'Lunar New Year', 'Diwali', 'Ramadan', 'Hanukkah',
];

const DEFAULT_TAG_SUGGESTIONS = [
  'Date Night', 'Brunch', 'Quick', 'Cozy', 'Cocktails', 'Vegan', 'Family', 'Weeknight',
];

const newEntryId = () => `e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** Compress a File to a base64 JPEG (max 1200px, 0.7 quality). */
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = document.createElement('img');
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 1200;
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) { height = (height / width) * maxSize; width = maxSize; }
          else { width = (width / height) * maxSize; height = maxSize; }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export const GuideCreatorSheet: React.FC<GuideCreatorSheetProps> = ({ open, onClose, initialGuide }) => {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { lists, ratings, restaurantMeta, getRestaurantInfo, homeMeals } = useLists();
  const { myRecipes } = useRecipes();
  const { phoneMode } = useSettings();
  const { showToast } = useToast();

  const accountIsPublic = profile?.is_public ?? true;

  const [step, setStep] = useState<Step>('type');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [type, setType] = useState<GuideType>('restaurants');
  const [seedMode, setSeedMode] = useState<SeedMode | null>(null);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [intro, setIntro] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [coverPhoto, setCoverPhoto] = useState('');
  const [visibility, setVisibility] = useState<GuideVisibility>(accountIsPublic ? 'public' : 'private');
  const [includePhotos, setIncludePhotos] = useState(true);
  const [entries, setEntries] = useState<GuideEntry[]>([]);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Live Editor state — `theme` carries everything the editor produces;
   *  `liveEditOpen` toggles the overlay; `authorProfile` is looked up
   *  lazily so the author panel has sensible defaults. */
  const [theme, setTheme] = useState<GuideTheme | undefined>(undefined);
  const [liveEditOpen, setLiveEditOpen] = useState(false);
  const [authorProfile, setAuthorProfile] = useState<UserProfile | null>(null);

  const { dragProps } = useBottomSheet(open, onClose);
  const dragRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initialGuide) {
      setEditingId(initialGuide.id);
      setType(initialGuide.type);
      setTitle(initialGuide.title);
      setSubtitle(initialGuide.subtitle);
      setIntro(initialGuide.intro);
      setTags(initialGuide.tags);
      setCoverPhoto(initialGuide.coverPhoto);
      setVisibility(initialGuide.visibility);
      setIncludePhotos(initialGuide.includePhotos);
      setEntries(initialGuide.entries);
      setTheme(initialGuide.theme);
      setStep('review');
    } else {
      setEditingId(null);
      setType('restaurants');
      setSeedMode(null);
      setTitle('');
      setSubtitle('');
      setIntro('');
      setTags([]);
      setCoverPhoto('');
      setTheme(undefined);
      setVisibility(accountIsPublic ? 'public' : 'private');
      setIncludePhotos(true);
      setEntries([]);
      setStep('type');
    }
    setExpandedEntryId(null);
    setBusy(false);
    setLiveEditOpen(false);
  }, [open, initialGuide?.id]);

  // Resolve the author profile once per signed-in user — used by the
  // Live Editor's hero/author panel for sensible defaults.
  useEffect(() => {
    if (!open || !user?.id || authorProfile?.id === user.id) return;
    let cancelled = false;
    (async () => {
      const profiles = await getProfilesByIds([user.id]);
      if (!cancelled) setAuthorProfile(profiles[user.id] || null);
    })();
    return () => { cancelled = true; };
  }, [open, user?.id, authorProfile?.id]);

  const currentStepIdx = STEPS_ORDER.indexOf(step);
  const totalSteps = STEPS_ORDER.length;
  const progress = Math.round(((currentStepIdx + 1) / totalSteps) * 100);

  /* ── Per-step gate ────────────────────────────────────────────── */
  const gate: { ok: boolean; reason?: string } = (() => {
    // Cover photo is OPTIONAL — when omitted, the guide opens with the
    // photo-less "Minimal" hero (see getTheme in supabase-guides.ts).
    if (step === 'details' && !title.trim()) {
      return { ok: false, reason: 'Give your guide a title before moving on.' };
    }
    if (step === 'seed' && entries.length === 0) {
      return { ok: false, reason: 'Add at least one entry from a source before moving on.' };
    }
    if (step === 'entries' && entries.length === 0) {
      return { ok: false, reason: 'Add at least one entry before moving on.' };
    }
    return { ok: true };
  })();

  const goNext = () => {
    if (!gate.ok) return;
    const next = STEPS_ORDER[Math.min(currentStepIdx + 1, STEPS_ORDER.length - 1)];
    setStep(next);
  };
  const goBack = () => {
    const prev = STEPS_ORDER[Math.max(currentStepIdx - 1, 0)];
    setStep(prev);
  };
  const jumpTo = (target: Step) => {
    setStep(target);
    setSeedMode(null);
  };

  /* ── Entry assembly ───────────────────────────────────────────── */

  const addEntryFromRating = (r: RestaurantRating): GuideEntry => {
    const meta = getRestaurantInfo(r.restaurantId);
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
  };

  const addEntryFromPlace = (p: PlaceResult): GuideEntry => {
    const existingRating = ratings.find((r) => r.restaurantId === p.id);
    if (existingRating) return addEntryFromRating(existingRating);
    return {
      id: newEntryId(),
      refId: p.id,
      name: p.name,
      subtitle: [p.types?.[0]?.replace(/_/g, ' '), priceLevelToString(p.priceLevel)].filter(Boolean).join(' · '),
      image: p.photoUrl || '',
      score: undefined,
    };
  };

  const addEntryFromListRecipe = (r: ListRecipe): GuideEntry => ({
    id: newEntryId(),
    refId: r.id,
    name: r.title,
    subtitle: [r.cuisine, r.difficulty].filter(Boolean).join(' · '),
    image: r.coverPhoto || r.photos?.[0]?.url || '',
    score: r.score,
    totalTime: (r.prepTime || 0) + (r.cookTime || 0),
    difficulty: r.difficulty,
    authorId: user?.id,
  });

  // Recipes in the cloud `recipes` table don't carry a score directly,
  // but the user may have logged a matching home meal (HomeMeal.score)
  // — those scores are the ones they expect to see when adding a
  // recipe to a guide. Look the score up by title (lowercase + trimmed
  // is sufficient since recipe titles are user-authored and short).
  const homeMealScores = useMemo(() => {
    const m = new Map<string, number>();
    for (const meal of homeMeals) {
      const key = (meal.name || '').trim().toLowerCase();
      if (key && typeof meal.score === 'number') m.set(key, meal.score);
    }
    return m;
  }, [homeMeals]);

  // Names from the user's ratings + cached restaurant meta + wishlist.
  // Cloud recipes whose title matches any of these are almost certainly
  // restaurant rows that leaked into the recipes table (e.g. from the
  // home-meal logger pre-fill), and we filter them out of the
  // "your recipes" picker so the user only sees real recipes.
  const restaurantNames = useMemo(() => {
    const s = new Set<string>();
    for (const r of ratings) {
      const k = (r.name || '').trim().toLowerCase();
      if (k) s.add(k);
    }
    for (const meta of Object.values(restaurantMeta) as Array<{ name?: string }>) {
      const k = (meta.name || '').trim().toLowerCase();
      if (k) s.add(k);
    }
    return s;
  }, [ratings, restaurantMeta]);

  const addEntryFromDbRecipe = (r: DbRecipe): GuideEntry => ({
    id: newEntryId(),
    refId: r.id,
    name: r.title,
    subtitle: [r.cuisine, r.difficulty].filter(Boolean).join(' · '),
    cuisine: r.cuisine || undefined,
    image: r.photos?.[0] || '',
    score: homeMealScores.get((r.title || '').trim().toLowerCase()),
    totalTime: (r.prepTimeMinutes || 0) + (r.cookTimeMinutes || 0),
    difficulty: r.difficulty,
    authorId: r.userId,
  });

  /* ── Cover photo upload ───────────────────────────────────────── */

  const coverInputRef = useRef<HTMLInputElement>(null);
  const onPickCoverFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const b64 = await compressImage(file);
      setCoverPhoto(b64);
    } catch (err) {
      console.warn('[Guide] cover compress failed', err);
      showToast("Couldn't read that image");
    } finally {
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  /* ── Save / publish ───────────────────────────────────────────── */

  const persist = async (publish: boolean): Promise<Guide | null> => {
    if (!user?.id) return null;
    setBusy(true);
    const saved = await saveGuide(user.id, {
      ...(editingId ? { id: editingId } : {}),
      type,
      title: title.trim(),
      subtitle: subtitle.trim(),
      intro: intro.trim(),
      coverPhoto,
      tags,
      visibility,
      isPublished: publish,
      includePhotos,
      entries,
      theme,
    });
    setBusy(false);
    if (!saved) {
      showToast("Couldn't save guide");
      return null;
    }
    setEditingId(saved.id);
    return saved;
  };

  const onSaveDraft = async () => {
    const saved = await persist(false);
    if (saved) showToast('Draft saved');
  };

  const onPublish = async () => {
    if (!coverPhoto) { showToast('Pick a cover photo'); setStep('cover'); return; }
    if (!title.trim()) { showToast('Add a title first'); setStep('details'); return; }
    if (entries.length === 0) { showToast('Add at least one entry'); setStep('entries'); return; }
    const saved = await persist(true);
    if (saved) {
      showToast('Guide published');
      onClose();
      navigate(`/guides/${saved.id}`);
    }
  };

  /* ── Live Editor integration ──────────────────────────────────── */

  // Assemble a Guide-shaped snapshot from the wizard's split state so
  // the editor can consume it like a real guide. computed fields and
  // timestamps are filled with safe placeholders.
  const liveEditData: Guide = useMemo(() => ({
    id: editingId || 'draft',
    userId: user?.id || '',
    type,
    title: title.trim(),
    subtitle: subtitle.trim(),
    intro: intro.trim(),
    coverPhoto,
    tags,
    visibility,
    isPublished: initialGuide?.isPublished ?? false,
    includePhotos,
    entries,
    avgScore: null,
    readMinutes: null,
    theme,
    createdAt: initialGuide?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }), [editingId, user?.id, type, title, subtitle, intro, coverPhoto, tags, visibility,
       includePhotos, entries, theme, initialGuide?.isPublished, initialGuide?.createdAt]);

  // Distribute the editor's snapshot back into the wizard's split state.
  const applyEditorPatch = (next: Guide) => {
    setTitle(next.title);
    setSubtitle(next.subtitle);
    setIntro(next.intro);
    setCoverPhoto(next.coverPhoto);
    setTags(next.tags);
    setEntries(next.entries);
    setVisibility(next.visibility);
    setIncludePhotos(next.includePhotos);
    setTheme(next.theme);
  };

  // Open the Live Editor. If the guide has no id yet, save a draft
  // first so we have one (the editor still works without an id, but
  // an id makes the Save guide round-trip atomic).
  const onLaunchLiveEdit = async () => {
    if (!user?.id) { showToast('Sign in to use Live edit'); return; }
    if (!editingId) {
      const saved = await persist(false);
      if (!saved) return;
    }
    setLiveEditOpen(true);
  };

  // Save from inside the editor — persists the snapshot the editor
  // sent (its absolutely-current data), not the wizard's potentially-
  // stale state. We still apply the snapshot to wizard state so the
  // wizard stays in sync (and so subsequent Publish reads it). The
  // publish flag is preserved from the original guide so saving from
  // live edit never inadvertently publishes or unpublishes.
  const onLiveEditSave = async (latest: Guide): Promise<boolean> => {
    if (!user?.id) { showToast('Sign in to save'); return false; }
    applyEditorPatch(latest);
    setBusy(true);
    const saved = await saveGuide(user.id, {
      ...(editingId ? { id: editingId } : {}),
      type: latest.type,
      title: (latest.title || '').trim(),
      subtitle: (latest.subtitle || '').trim(),
      intro: (latest.intro || '').trim(),
      coverPhoto: latest.coverPhoto,
      tags: latest.tags,
      visibility: latest.visibility,
      isPublished: initialGuide?.isPublished ?? false,
      includePhotos: latest.includePhotos,
      entries: latest.entries,
      theme: latest.theme,
    });
    setBusy(false);
    if (!saved) {
      showToast("Couldn't save guide");
      return false;
    }
    setEditingId(saved.id);
    showToast('Saved');
    return true;
  };

  /* ── Render ───────────────────────────────────────────────────── */

  if (!open) return null;

  const isPhone = phoneMode;

  const renderStep = () => {
    switch (step) {
      case 'type':
        return <StepType type={type} onChange={setType} />;
      case 'cover':
        return (
          <StepCover
            coverPhoto={coverPhoto}
            entries={entries}
            onPickCoverFromFile={() => coverInputRef.current?.click()}
            onPickCoverFromEntry={(img) => setCoverPhoto(img)}
            onClearCover={() => setCoverPhoto('')}
          />
        );
      case 'details':
        return (
          <StepDetails
            title={title}
            subtitle={subtitle}
            intro={intro}
            tags={tags}
            onTitle={setTitle}
            onSubtitle={setSubtitle}
            onIntro={setIntro}
            onToggleTag={(t) => setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])}
            onAddTag={(t) => setTags((prev) => prev.includes(t) ? prev : [...prev, t])}
            onRemoveTag={(t) => setTags((prev) => prev.filter((x) => x !== t))}
          />
        );
      case 'seed':
        return (
          <StepSeed
            type={type}
            seedMode={seedMode}
            onPick={setSeedMode}
            lists={lists}
            ratings={ratings}
            myRecipes={myRecipes}
            homeMealScores={homeMealScores}
            restaurantNames={restaurantNames}
            onAddRestaurants={(rs) => {
              setEntries((prev) => {
                const have = new Set(prev.map((e) => e.refId));
                const additions = rs.filter((r) => !have.has(r.restaurantId)).map(addEntryFromRating);
                return [...prev, ...additions];
              });
            }}
            onAddRestaurantsFromList={(l) => {
              const fromList = l.restaurantIds.map((rid) => {
                const listOverride = l.listRatings?.[rid];
                const baseRating = ratings.find((rr) => rr.restaurantId === rid);
                const r = listOverride || baseRating;
                if (r) return addEntryFromRating(r);
                const meta = restaurantMeta[rid];
                if (meta) {
                  return {
                    id: newEntryId(),
                    refId: rid,
                    name: meta.name,
                    subtitle: [meta.cuisine, meta.price].filter(Boolean).join(' · '),
                    image: meta.image || '',
                    neighborhood: meta.neighborhood,
                  } as GuideEntry;
                }
                return null;
              }).filter((e): e is GuideEntry => !!e);
              setEntries((prev) => {
                const have = new Set(prev.map((e) => e.refId));
                return [...prev, ...fromList.filter((e) => !have.has(e.refId))];
              });
            }}
            onAddPlaces={(ps) => {
              setEntries((prev) => {
                const have = new Set(prev.map((e) => e.refId));
                return [...prev, ...ps.filter((p) => !have.has(p.id)).map(addEntryFromPlace)];
              });
            }}
            onAddListRecipes={(rs) => {
              setEntries((prev) => {
                const have = new Set(prev.map((e) => e.refId));
                return [...prev, ...rs.filter((r) => !have.has(r.id)).map(addEntryFromListRecipe)];
              });
            }}
            onAddDbRecipes={(rs) => {
              setEntries((prev) => {
                const have = new Set(prev.map((e) => e.refId));
                return [...prev, ...rs.filter((r) => !have.has(r.id)).map(addEntryFromDbRecipe)];
              });
            }}
            onRemoveByRefId={(refId) => setEntries((prev) => prev.filter((e) => e.refId !== refId))}
            addedRefIds={new Set(entries.map((e) => e.refId))}
          />
        );
      case 'entries':
        return (
          <StepEntries
            type={type}
            entries={entries}
            includePhotos={includePhotos}
            onTogglePhotos={setIncludePhotos}
            expandedId={expandedEntryId}
            onToggleExpand={(id) => {
              const isOpening = expandedEntryId !== id;
              setExpandedEntryId(isOpening ? id : null);
              if (!isOpening) return;
              const entry = entries.find((e) => e.id === id);
              if (!entry || !entry.refId) return;
              const rating = ratings.find((r) => r.restaurantId === entry.refId);
              if (!rating) return;
              // Only auto-fill when the field has never been touched
              // (undefined). An empty string / empty array means the user
              // intentionally cleared it, and we should respect that.
              const patch: Partial<GuideEntry> = {};
              if (entry.notes === undefined && rating.notes?.trim()) {
                patch.notes = rating.notes.trim();
              }
              if (entry.mustOrder === undefined && rating.favoriteDishes && rating.favoriteDishes.length > 0) {
                patch.mustOrder = rating.favoriteDishes.map((s) => s.trim()).filter(Boolean);
              }
              if (Object.keys(patch).length > 0) {
                setEntries((prev) => prev.map((e) => e.id === id ? { ...e, ...patch } : e));
              }
            }}
            onRemove={(id) => setEntries((prev) => prev.filter((e) => e.id !== id))}
            onPatch={(id, patch) => setEntries((prev) => prev.map((e) => e.id === id ? { ...e, ...patch } : e))}
            onMove={(from, to) => setEntries((prev) => {
              const next = [...prev];
              const [moved] = next.splice(from, 1);
              next.splice(to, 0, moved);
              return next;
            })}
            onAddMore={() => { setSeedMode(null); setStep('seed'); }}
            dragRef={dragRef}
          />
        );
      case 'visibility':
        return (
          <StepVisibility
            visibility={visibility}
            onChange={setVisibility}
            accountIsPublic={accountIsPublic}
          />
        );
      case 'review':
        return (
          <StepReview
            type={type}
            title={title}
            subtitle={subtitle}
            intro={intro}
            coverPhoto={coverPhoto}
            tags={tags}
            entries={entries}
            includePhotos={includePhotos}
            visibility={visibility}
            onEditField={(target) => {
              if (target === 'cover') setStep('cover');
              else if (target === 'title' || target === 'intro' || target === 'tags') setStep('details');
              else if (target === 'entries') setStep('entries');
              else if (target === 'visibility') setStep('visibility');
            }}
            onEditEntry={(id) => { setExpandedEntryId(id); setStep('entries'); }}
          />
        );
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="guide-creator-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className={cn(
          'fixed inset-0 bg-black/55 backdrop-blur-sm z-[120] flex justify-center',
          phoneMode ? 'items-end' : 'items-center',
        )}
        onClick={onClose}
      >
        <motion.div
          key="guide-creator-sheet"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          {...dragProps}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'w-full overflow-hidden flex flex-col',
            phoneMode
              ? 'h-[94%] rounded-t-3xl'
              : 'h-[94%] sm:max-w-[1080px] sm:max-h-[94vh] sm:h-[860px] rounded-3xl',
          )}
          style={{ backgroundColor: 'var(--cream, #EDE7D9)' }}
        >
          <div className={`guide-creator${isPhone ? ' is-phone' : ''}`}>
            {!isPhone && (
              <button type="button" className="gc-pane-close" onClick={onClose} aria-label="Close">
                <X size={18} />
              </button>
            )}

            <div className="gc-shell">
              {/* Desktop rail */}
              {!isPhone && (
                <nav className="gc-rail">
                  <div className="gc-rail-eyebrow">{editingId ? 'Edit guide' : 'New guide'}</div>
                  <div className="gc-rail-title">Let's build a <em>guide</em>.</div>
                  <ol className="gc-rail-steps">
                    {STEPS_ORDER.map((s, i) => {
                      const isDone = i < currentStepIdx;
                      const isCurrent = i === currentStepIdx;
                      return (
                        <button
                          key={s}
                          type="button"
                          className={`gc-rail-step${isDone ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}`}
                          onClick={() => jumpTo(s)}
                        >
                          <span className="gc-rail-step-circle">
                            {isDone ? <Check size={14} strokeWidth={3} /> : i + 1}
                          </span>
                          <span className="gc-rail-step-text">
                            <span className="gc-rail-step-title">{STEP_LABELS[s]}</span>
                          </span>
                        </button>
                      );
                    })}
                  </ol>
                  <div className="gc-rail-foot">
                    <div className="gc-rail-foot-status">
                      <span className="dot" />
                      <span>{editingId ? 'Editing existing guide' : 'New guide'}</span>
                      <span style={{ marginLeft: 'auto' }}>Step {currentStepIdx + 1} of {totalSteps}</span>
                    </div>
                    <div className="gc-rail-foot-bar">
                      <div className="gc-rail-foot-bar-fill" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                </nav>
              )}

              {/* Phone progress strip + close */}
              {isPhone && (
                <div className="gc-phone-strip">
                  <div className="gc-phone-strip-progress">
                    {STEPS_ORDER.map((s, i) => {
                      const isDone = i < currentStepIdx;
                      const isCurrent = i === currentStepIdx;
                      return (
                        <button
                          key={s}
                          type="button"
                          className={`gc-phone-strip-dot${isDone ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}`}
                          onClick={() => jumpTo(s)}
                          aria-label={`Step ${i + 1}: ${STEP_LABELS[s]}`}
                        >
                          {isDone ? <Check size={14} strokeWidth={3} /> : i + 1}
                        </button>
                      );
                    })}
                    <span className="gc-phone-strip-label">{STEP_LABELS[step]}</span>
                  </div>
                  <button type="button" className="gc-phone-strip-close" onClick={onClose} aria-label="Close">
                    <X size={18} />
                  </button>
                </div>
              )}

              {/* Step pane */}
              <div className="gc-pane">
                <div className="gc-pane-head">
                  <div className="gc-pane-eyebrow">
                    Step <span className="strong">{currentStepIdx + 1}</span> of {totalSteps}
                  </div>
                  <h2 className="gc-pane-title">{STEP_LABELS[step]}</h2>
                </div>
                <div className="gc-pane-body">
                  {renderStep()}
                  {!gate.ok && gate.reason && (
                    <div className="gc-step-gate">{gate.reason}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Sticky footer */}
            <div className="gc-foot">
              <button
                type="button"
                className="gc-foot-back"
                onClick={goBack}
                disabled={currentStepIdx === 0}
              >
                <ArrowLeft size={16} /> Back
              </button>
              <div className="gc-foot-right">
                <button
                  type="button"
                  className="gc-foot-save"
                  onClick={onSaveDraft}
                  disabled={busy}
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                  Save draft
                </button>
                {(() => {
                  // Live edit needs everything from steps 1-4: a type, a
                  // cover photo, a title, and at least one entry. The
                  // simplest gate is "user has moved past Add entries"
                  // — the step gates already prevent advancing without
                  // the required fields, so being on step 5+ implies
                  // all of those are filled.
                  const liveEditUnlocked = currentStepIdx >= STEPS_ORDER.indexOf('entries');
                  return (
                    <button
                      type="button"
                      className="gc-foot-live-edit"
                      onClick={onLaunchLiveEdit}
                      disabled={busy || !liveEditUnlocked}
                      title={liveEditUnlocked
                        ? 'Open the Live editor — visual customizer'
                        : 'Finish steps 1-4 first — pick a type, cover, details, and add at least one entry.'}
                    >
                      <Wand2 size={14} />
                      Live edit
                    </button>
                  );
                })()}
                {step !== 'review' ? (
                  <button
                    type="button"
                    className="gc-foot-next"
                    onClick={goNext}
                    disabled={!gate.ok}
                    title={gate.ok ? undefined : gate.reason}
                  >
                    Next: {NEXT_LABELS[step]} <ArrowRight size={16} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="gc-foot-publish"
                    onClick={onPublish}
                    disabled={busy || entries.length === 0 || !title.trim() || !coverPhoto}
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={16} />}
                    {editingId ? 'Save changes' : 'Publish guide'}
                  </button>
                )}
              </div>
            </div>
          </div>

          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPickCoverFile}
          />
        </motion.div>
      </motion.div>

      {/* Live Editor overlay — portals itself to document.body so it
          escapes the wizard's stacking context. Render conditionally so
          we don't pay the cost when it isn't open. */}
      {liveEditOpen && (
        <GuideLiveEditor
          open={liveEditOpen}
          data={liveEditData}
          authorProfile={authorProfile}
          onChange={applyEditorPatch}
          onClose={() => setLiveEditOpen(false)}
          onSave={onLiveEditSave}
        />
      )}
    </AnimatePresence>
  );
};

/* ── Step: Type ───────────────────────────────────────────────────── */

const StepType: React.FC<{ type: GuideType; onChange: (t: GuideType) => void }> = ({ type, onChange }) => (
  <>
    <p className="gc-pane-intro">You can mix types in a future guide — for now, each guide focuses on one.</p>
    <div className="gc-type-row">
      {([
        { key: 'restaurants' as const, label: 'Restaurants', icon: <BookOpen size={22} />, blurb: 'Curate places you love or want to share.' },
        { key: 'recipes' as const, label: 'Recipes', icon: <ChefHat size={22} />, blurb: 'Build a cookbook chapter from your saved recipes.' },
      ]).map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={`gc-type-card${type === opt.key ? ' is-active' : ''}`}
        >
          <div className="gc-type-card-icon">{opt.icon}</div>
          <div>
            <div className="gc-type-card-title">{opt.label}</div>
            <div className="gc-type-card-sub">{opt.blurb}</div>
          </div>
        </button>
      ))}
    </div>
  </>
);

/* ── Step: Seed ───────────────────────────────────────────────────── */

interface StepSeedProps {
  type: GuideType;
  seedMode: SeedMode | null;
  onPick: (m: SeedMode | null) => void;
  lists: CustomList[];
  ratings: RestaurantRating[];
  myRecipes: DbRecipe[];
  /** Lowercase-trimmed recipe-title -> score from the user's home meals.
   *  Cloud recipes don't store a score, but a matching HomeMeal does. */
  homeMealScores: Map<string, number>;
  /** Lowercase-trimmed names from `ratings` + cached `restaurantMeta`,
   *  used to filter restaurant-named rows out of the recipes picker. */
  restaurantNames: Set<string>;
  onAddRestaurants: (rs: RestaurantRating[]) => void;
  onAddRestaurantsFromList: (l: CustomList) => void;
  onAddPlaces: (ps: PlaceResult[]) => void;
  onAddListRecipes: (rs: ListRecipe[]) => void;
  onAddDbRecipes: (rs: DbRecipe[]) => void;
  onRemoveByRefId: (refId: string) => void;
  addedRefIds: Set<string>;
}

const StepSeed: React.FC<StepSeedProps> = ({ type, seedMode, onPick, lists, ratings, myRecipes, homeMealScores, restaurantNames, onAddRestaurants, onAddRestaurantsFromList, onAddPlaces, onAddListRecipes, onAddDbRecipes, onRemoveByRefId, addedRefIds }) => {
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [importedListIds, setImportedListIds] = useState<Set<string>>(new Set());
  const [ratedFilter, setRatedFilter] = useState('');
  const [recipesFilter, setRecipesFilter] = useState('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchReqIdRef = useRef(0);

  const relevantLists = type === 'restaurants'
    ? lists.filter((l) => (l.restaurantIds?.length || 0) > 0)
    : lists.filter((l) => l.type === 'home-cooking' && (l.recipes?.length || 0) > 0);

  const trimmedSearch = searchQ.trim();
  useEffect(() => {
    if (seedMode !== 'search') return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!trimmedSearch) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const reqId = ++searchReqIdRef.current;
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const found = await searchPlacesByText(trimmedSearch, 40.7128, -74.0060);
        if (reqId !== searchReqIdRef.current) return;
        setSearchResults(found.slice(0, 10));
      } catch {
        if (reqId === searchReqIdRef.current) setSearchResults([]);
      } finally {
        if (reqId === searchReqIdRef.current) setSearching(false);
      }
    }, 240);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [trimmedSearch, seedMode]);

  const seedOptions: { key: SeedMode; label: string; blurb: string; icon: React.ReactNode }[] =
    type === 'restaurants'
      ? [
          { key: 'list', label: 'From an existing list', blurb: 'Import every place from one of your saved lists.', icon: <ListChecks size={18} /> },
          { key: 'rated', label: 'From your rated places', blurb: 'Hand-pick from restaurants you\'ve already scored.', icon: <Star size={18} /> },
          { key: 'search', label: 'Search the database', blurb: 'Add any restaurant by name.', icon: <Search size={18} /> },
        ]
      : [
          { key: 'recipes-list', label: 'From a home-cooking list', blurb: 'Import every recipe from one of your home-cooking lists.', icon: <ListChecks size={18} /> },
          { key: 'recipes-my', label: 'From your recipes', blurb: 'Hand-pick from recipes you\'ve created.', icon: <ChefHat size={18} /> },
        ];

  if (!seedMode) {
    return (
      <>
        <p className="gc-pane-intro">Pick a source — you can keep adding from other sources later.</p>
        <div className="gc-source-row">
          {seedOptions.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => onPick(o.key)}
              className="gc-source-card"
            >
              <span className="gc-source-card-icon">{o.icon}</span>
              <span className="gc-source-card-text">
                <span className="gc-source-card-title">{o.label}</span>
                <span className="gc-source-card-sub">{o.blurb}</span>
              </span>
              <ArrowRight size={16} className="gc-source-card-chev" />
            </button>
          ))}
        </div>
        {addedRefIds.size > 0 && (
          <div className="gc-review-meta-strip" style={{ marginTop: 18 }}>
            <Check size={14} />
            {addedRefIds.size} entr{addedRefIds.size === 1 ? 'y' : 'ies'} added so far
            <span className="gc-review-meta-strip-spacer" />
            Continue to arrange entries
          </div>
        )}
      </>
    );
  }

  // ── Subpage: From a list (restaurants) ────────────────────────
  if (seedMode === 'list') {
    return (
      <>
        <button type="button" className="gc-subpage-back" onClick={() => onPick(null)}>
          <ArrowLeft size={13} /> Back to sources
        </button>
        {relevantLists.length === 0 ? (
          <div className="gc-empty">You don't have any lists with places yet.</div>
        ) : (
          <div>
            {relevantLists.map((l) => {
              const isImported = importedListIds.has(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    onAddRestaurantsFromList(l);
                    setImportedListIds((prev) => {
                      const next = new Set(prev);
                      next.add(l.id);
                      return next;
                    });
                  }}
                  className={`gc-pick-row${isImported ? ' is-added' : ''}`}
                >
                  <span className="gc-pick-row-emoji">{l.emoji}</span>
                  <span className="gc-pick-row-text">
                    <span className="gc-pick-row-title">{l.name}</span>
                    <span className="gc-pick-row-sub">{l.restaurantIds.length} places</span>
                  </span>
                  <span className="gc-pick-row-add">
                    {isImported ? <Check size={15} strokeWidth={2.8} /> : <Plus size={15} strokeWidth={2.4} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </>
    );
  }

  // ── Subpage: Rated places ─────────────────────────────────────
  if (seedMode === 'rated') {
    const ratedQ = ratedFilter.trim().toLowerCase();
    const filteredRatings = ratedQ
      ? ratings.filter((r) =>
          r.name.toLowerCase().includes(ratedQ)
          || (r.cuisine || '').toLowerCase().includes(ratedQ)
          || (r.address || '').toLowerCase().includes(ratedQ)
        )
      : ratings;
    return (
      <>
        <button type="button" className="gc-subpage-back" onClick={() => onPick(null)}>
          <ArrowLeft size={13} /> Back to sources
        </button>
        {ratings.length === 0 ? (
          <div className="gc-empty">You haven't rated any places yet.</div>
        ) : (
          <>
            <div className="gc-search-row">
              <Search size={15} />
              <input
                value={ratedFilter}
                onChange={(e) => setRatedFilter(e.target.value)}
                placeholder="Filter your rated places…"
              />
              {ratedFilter && (
                <button type="button" onClick={() => setRatedFilter('')} aria-label="Clear filter">
                  <X size={13} />
                </button>
              )}
            </div>
            {filteredRatings.length === 0 ? (
              <div className="gc-empty">No matches.</div>
            ) : (
              <div>
                {filteredRatings.map((r) => {
                  const isAdded = addedRefIds.has(r.restaurantId);
                  return (
                    <button
                      key={r.restaurantId}
                      type="button"
                      onClick={() => {
                        if (isAdded) onRemoveByRefId(r.restaurantId);
                        else onAddRestaurants([r]);
                      }}
                      className={`gc-pick-row${isAdded ? ' is-added' : ''}`}
                    >
                      <span className="gc-pick-row-text">
                        <span className="gc-pick-row-title">{r.name}</span>
                        <span className="gc-pick-row-sub">{[r.cuisine, r.price].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="gc-pick-row-score">{r.score.toFixed(1)}</span>
                      <span className="gc-pick-row-add">
                        {isAdded ? <Check size={15} strokeWidth={2.8} /> : <Plus size={15} strokeWidth={2.4} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </>
    );
  }

  // ── Subpage: Search ───────────────────────────────────────────
  if (seedMode === 'search') {
    return (
      <>
        <button type="button" className="gc-subpage-back" onClick={() => onPick(null)}>
          <ArrowLeft size={13} /> Back to sources
        </button>
        <div className="gc-search-row">
          <Search size={15} />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search any restaurant…"
            autoFocus
          />
          {searching && <Loader2 size={14} className="animate-spin" style={{ color: 'var(--muted, #8C8278)' }} />}
          {!searching && searchQ && (
            <button type="button" onClick={() => setSearchQ('')} aria-label="Clear search">
              <X size={13} />
            </button>
          )}
        </div>
        <div>
          {searchResults.map((p) => {
            const isAdded = addedRefIds.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  if (isAdded) onRemoveByRefId(p.id);
                  else onAddPlaces([p]);
                }}
                className={`gc-pick-row${isAdded ? ' is-added' : ''}`}
              >
                <span className="gc-pick-row-text">
                  <span className="gc-pick-row-title">{p.name}</span>
                  <span className="gc-pick-row-sub">{p.address}</span>
                </span>
                <span className="gc-pick-row-add">
                  {isAdded ? <Check size={15} strokeWidth={2.8} /> : <Plus size={15} strokeWidth={2.4} />}
                </span>
              </button>
            );
          })}
          {searchResults.length === 0 && !searching && searchQ.trim() && (
            <div className="gc-empty">No results — try a different query.</div>
          )}
          {searchResults.length === 0 && !searching && !searchQ.trim() && (
            <div className="gc-empty">Start typing to find restaurants.</div>
          )}
        </div>
      </>
    );
  }

  // ── Subpage: Recipes from list ────────────────────────────────
  if (seedMode === 'recipes-list') {
    return (
      <>
        <button type="button" className="gc-subpage-back" onClick={() => onPick(null)}>
          <ArrowLeft size={13} /> Back to sources
        </button>
        {relevantLists.length === 0 ? (
          <div className="gc-empty">No home-cooking lists yet. Add recipes in Pantry first.</div>
        ) : (
          <div>
            {relevantLists.map((l) => {
              const isImported = importedListIds.has(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    if (l.recipes) onAddListRecipes(l.recipes);
                    setImportedListIds((prev) => {
                      const next = new Set(prev);
                      next.add(l.id);
                      return next;
                    });
                  }}
                  className={`gc-pick-row${isImported ? ' is-added' : ''}`}
                >
                  <span className="gc-pick-row-emoji">{l.emoji}</span>
                  <span className="gc-pick-row-text">
                    <span className="gc-pick-row-title">{l.name}</span>
                    <span className="gc-pick-row-sub">{l.recipes?.length || 0} recipes</span>
                  </span>
                  <span className="gc-pick-row-add">
                    {isImported ? <Check size={15} strokeWidth={2.8} /> : <Plus size={15} strokeWidth={2.4} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </>
    );
  }

  // ── Subpage: My recipes ───────────────────────────────────────
  if (seedMode === 'recipes-my') {
    // Restaurants leak into the cloud `recipes` table when the user
    // creates a restaurant-themed entry via a flow that bridges both
    // tables (e.g. recreating a dish from a rated place). Four filters
    // together keep them out:
    //   1. `linkedRestaurantId` set → explicitly a restaurant-linked row
    //   2. title matches a rated restaurant name (case-insensitive)
    //   3. title matches a cached restaurantMeta name
    //   4. row has no actual recipe content (no ingredients / steps /
    //      description / prep+cook time). Real recipes almost always
    //      have at least one of these; pure placeholders don't.
    const recipesOnly = myRecipes.filter((r) => {
      if (r.linkedRestaurantId) return false;
      const lower = (r.title || '').trim().toLowerCase();
      if (restaurantNames.has(lower)) return false;
      const hasIngredients = (r.ingredients?.length || 0) > 0;
      const hasSteps = (r.steps?.length || 0) > 0;
      const hasDescription = (r.description || '').trim().length > 0;
      const hasTime = (r.prepTimeMinutes || 0) + (r.cookTimeMinutes || 0) > 0;
      if (!hasIngredients && !hasSteps && !hasDescription && !hasTime) return false;
      return true;
    });
    const recipesQ = recipesFilter.trim().toLowerCase();
    const filteredRecipes = recipesQ
      ? recipesOnly.filter((r) =>
          r.title.toLowerCase().includes(recipesQ)
          || (r.cuisine || '').toLowerCase().includes(recipesQ)
          || (r.tags || []).some((t) => t.toLowerCase().includes(recipesQ))
        )
      : recipesOnly;
    return (
      <>
        <button type="button" className="gc-subpage-back" onClick={() => onPick(null)}>
          <ArrowLeft size={13} /> Back to sources
        </button>
        {recipesOnly.length === 0 ? (
          <div className="gc-empty">You haven't created any recipes yet.</div>
        ) : (
          <>
            <div className="gc-search-row">
              <Search size={15} />
              <input
                value={recipesFilter}
                onChange={(e) => setRecipesFilter(e.target.value)}
                placeholder="Filter your recipes…"
              />
              {recipesFilter && (
                <button type="button" onClick={() => setRecipesFilter('')} aria-label="Clear filter">
                  <X size={13} />
                </button>
              )}
            </div>
            {filteredRecipes.length === 0 ? (
              <div className="gc-empty">No matches.</div>
            ) : (
              <div>
                {filteredRecipes.map((r) => {
                  const isAdded = addedRefIds.has(r.id);
                  const totalMin = (r.prepTimeMinutes || 0) + (r.cookTimeMinutes || 0);
                  const subBits = [
                    r.cuisine,
                    r.difficulty,
                    totalMin > 0 ? `${totalMin} min` : null,
                  ].filter(Boolean);
                  const score = homeMealScores.get((r.title || '').trim().toLowerCase());
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        if (isAdded) onRemoveByRefId(r.id);
                        else onAddDbRecipes([r]);
                      }}
                      className={`gc-pick-row${isAdded ? ' is-added' : ''}`}
                    >
                      <span className="gc-pick-row-thumb">
                        {r.photos?.[0]
                          ? <img src={r.photos[0]} alt="" referrerPolicy="no-referrer" />
                          : <ChefHat size={20} />}
                      </span>
                      <span className="gc-pick-row-text">
                        <span className="gc-pick-row-title">{r.title}</span>
                        <span className="gc-pick-row-sub">{subBits.join(' · ')}</span>
                      </span>
                      {typeof score === 'number' && score > 0 && (
                        <span className="gc-pick-row-score">{score.toFixed(1)}</span>
                      )}
                      <span className="gc-pick-row-add">
                        {isAdded ? <Check size={15} strokeWidth={2.8} /> : <Plus size={15} strokeWidth={2.4} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </>
    );
  }

  return null;
};

/* ── Step: Cover photo ────────────────────────────────────────────── */

interface StepCoverProps {
  coverPhoto: string;
  entries: GuideEntry[];
  onPickCoverFromFile: () => void;
  onPickCoverFromEntry: (img: string) => void;
  onClearCover: () => void;
}

const StepCover: React.FC<StepCoverProps> = ({ coverPhoto, entries, onPickCoverFromFile, onPickCoverFromEntry, onClearCover }) => {
  const entryThumbs = entries.filter((e) => !!e.image).slice(0, 8);

  return (
    <>
      <p className="gc-pane-intro">Pick a cover photo to set the tone — or skip and use the minimal, photo-less header.</p>
      <div className="gc-field">
        <div className="gc-label">
          Cover photo <span className="opt">optional</span>
        </div>
        {coverPhoto ? (
          <div className="gc-dropzone-preview" style={{ backgroundImage: `url(${coverPhoto})` }}>
            <div className="gc-dropzone-preview-actions">
              <button type="button" onClick={onPickCoverFromFile}>Replace</button>
              <button type="button" onClick={onClearCover}>Remove</button>
            </div>
          </div>
        ) : (
          <button type="button" className="gc-dropzone" onClick={onPickCoverFromFile}>
            <span className="gc-dropzone-icon"><ImagePlus size={22} /></span>
            <span>
              <span className="gc-dropzone-text">
                Drop an image or <span className="accent">click to browse</span>
              </span>
              <span className="gc-dropzone-sub">JPG or PNG · optional — skip for a minimal, photo-less header</span>
            </span>
          </button>
        )}
        {entryThumbs.length > 0 && (
          <div className="gc-thumb-row">
            <div className="gc-thumb-row-label">Or pick from your entries</div>
            <div className="gc-thumb-strip">
              {entryThumbs.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onPickCoverFromEntry(e.image)}
                  className={`gc-thumb${coverPhoto === e.image ? ' is-active' : ''}`}
                >
                  <img src={e.image} alt="" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

/* ── Step: Details (title + subtitle + intro + tags) ──────────────── */

interface StepDetailsProps {
  title: string;
  subtitle: string;
  intro: string;
  tags: string[];
  onTitle: (v: string) => void;
  onSubtitle: (v: string) => void;
  onIntro: (v: string) => void;
  onToggleTag: (t: string) => void;
  onAddTag: (t: string) => void;
  onRemoveTag: (t: string) => void;
}

const StepDetails: React.FC<StepDetailsProps> = ({ title, subtitle, intro, tags, onTitle, onSubtitle, onIntro, onToggleTag, onAddTag, onRemoveTag }) => {
  const [tagDraft, setTagDraft] = useState('');
  const tagDraftTrimmed = tagDraft.trim().toLowerCase();
  const tagSuggestions = useMemo(() => {
    const selected = new Set(tags);
    // Empty input: show the curated short list so the page doesn't get
    // overwhelmed by every possible tag.
    if (tagDraftTrimmed === '') {
      return DEFAULT_TAG_SUGGESTIONS.filter((t) => !selected.has(t));
    }
    // Typing: search the full library. Rank exact > starts-with > contains
    // so the most relevant suggestion lands at the top, then cap to 30.
    const ranked: Array<{ tag: string; score: number; idx: number }> = [];
    TAG_SUGGESTIONS.forEach((t, idx) => {
      if (selected.has(t)) return;
      const lower = t.toLowerCase();
      if (!lower.includes(tagDraftTrimmed)) return;
      let score = 1;
      if (lower === tagDraftTrimmed) score = 3;
      else if (lower.startsWith(tagDraftTrimmed)) score = 2;
      ranked.push({ tag: t, score, idx });
    });
    ranked.sort((a, b) => b.score - a.score || a.idx - b.idx);
    return ranked.slice(0, 30).map((r) => r.tag);
  }, [tags, tagDraftTrimmed]);

  return (
    <>
      <div className="gc-field">
        <div className="gc-label">
          Title <span className="req">required</span>
        </div>
        <input
          className="gc-input is-title"
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="e.g. Best Chinese Restaurants in NYC"
          maxLength={120}
        />
      </div>

      <div className="gc-field">
        <div className="gc-label">Subtitle <span className="opt">optional</span></div>
        <input
          className="gc-input"
          value={subtitle}
          onChange={(e) => onSubtitle(e.target.value)}
          placeholder="A one-line tease that sits under the title."
          maxLength={160}
        />
      </div>

      <div className="gc-field">
        <div className="gc-label">Intro paragraph <span className="opt">optional</span></div>
        <textarea
          className="gc-textarea"
          value={intro}
          onChange={(e) => onIntro(e.target.value)}
          placeholder="Set the scene — why this guide, who it's for."
          rows={4}
          maxLength={800}
        />
      </div>

      <div className="gc-field">
        <div className="gc-label">Tags <span className="opt">optional</span></div>
        {tags.length > 0 && (
          <div className="gc-chip-row">
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onRemoveTag(t)}
                className="gc-chip is-removable"
              >
                {t}
                <X size={11} />
              </button>
            ))}
          </div>
        )}
        <div className="gc-chip-row">
          <input
            className="gc-chip-add"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const v = tagDraft.trim();
                if (v) { onAddTag(v); setTagDraft(''); }
              }
            }}
            placeholder="Add a tag (press Enter)"
            style={{ minWidth: 180 }}
          />
        </div>
        {tagSuggestions.length > 0 && (
          <div className="gc-chip-row">
            {tagSuggestions.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { onToggleTag(t); setTagDraft(''); }}
                className="gc-chip"
              >
                + {t}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

/* ── Local-state comma-separated input ─────────────────────────────
   The previous inline version split on every keystroke and dropped
   empty pieces, so typing the separator (", ") got eaten before the
   next dish could be typed. This keeps the raw text in local state
   and only commits to the entry on blur. */

const DishesInput: React.FC<{
  value: string[];
  placeholder?: string;
  onCommit: (next: string[]) => void;
}> = ({ value, placeholder, onCommit }) => {
  const joinedExternal = (value || []).join(', ');
  const [draft, setDraft] = useState(joinedExternal);
  const lastSeen = useRef(joinedExternal);
  useEffect(() => {
    if (joinedExternal !== lastSeen.current) {
      setDraft(joinedExternal);
      lastSeen.current = joinedExternal;
    }
  }, [joinedExternal]);
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft.split(',').map((s) => s.trim()).filter(Boolean);
        lastSeen.current = next.join(', ');
        onCommit(next);
      }}
      placeholder={placeholder}
      className="gc-input"
    />
  );
};

/* ── Step: Entries (reorder + per-entry edit) ─────────────────────── */

interface StepEntriesProps {
  type: GuideType;
  entries: GuideEntry[];
  includePhotos: boolean;
  onTogglePhotos: (next: boolean) => void;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  onRemove: (id: string) => void;
  onPatch: (id: string, patch: Partial<GuideEntry>) => void;
  onMove: (from: number, to: number) => void;
  onAddMore: () => void;
  dragRef: React.MutableRefObject<number | null>;
}

const StepEntries: React.FC<StepEntriesProps> = ({ type, entries, includePhotos, onTogglePhotos, expandedId, onToggleExpand, onRemove, onPatch, onMove, onAddMore, dragRef }) => {
  const orderedKey = type === 'restaurants' ? 'mustOrder' : 'keyIngredients';
  const orderedLabel = type === 'restaurants' ? 'Favorite Dishes' : 'Key Ingredients';

  // Whole-pane editor when an entry is selected. Clicking Edit on a row
  // sets expandedId via the parent; the back link clears it and returns
  // to the list. Auto-fill (notes / mustOrder from the matching rating)
  // already runs in onToggleExpand, so by the time we render here the
  // entry is pre-populated.
  const editingEntry = expandedId ? entries.find((e) => e.id === expandedId) : null;
  if (editingEntry) {
    const idx = entries.findIndex((e) => e.id === editingEntry.id);
    const orderedVals = type === 'restaurants' ? editingEntry.mustOrder : editingEntry.keyIngredients;
    return (
      <>
        <button type="button" className="gc-subpage-back" onClick={() => onToggleExpand(editingEntry.id)}>
          <ArrowLeft size={13} /> Back to entries
        </button>

        <div className="gc-entry-edit-head">
          <span className="gc-entry-edit-num">{(idx + 1).toString().padStart(2, '0')}</span>
          <span className="gc-entry-edit-img">
            {editingEntry.image && <img src={editingEntry.image} alt="" referrerPolicy="no-referrer" />}
          </span>
          <div className="gc-entry-edit-text">
            <div className="gc-entry-edit-name">{editingEntry.name}</div>
            {editingEntry.subtitle && <div className="gc-entry-edit-sub">{editingEntry.subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={() => { onRemove(editingEntry.id); }}
            aria-label="Remove entry"
            className="gc-entry-edit-delete"
          >
            <Trash2 size={16} />
          </button>
        </div>

        <div className="gc-field">
          <div className="gc-label">Score <span className="opt">0–10 · optional</span></div>
          <input
            type="number"
            step="0.1"
            min="0"
            max="10"
            value={typeof editingEntry.score === 'number' ? editingEntry.score : ''}
            onChange={(e) => {
              const v = e.target.value === '' ? undefined : Math.max(0, Math.min(10, parseFloat(e.target.value)));
              onPatch(editingEntry.id, { score: typeof v === 'number' && Number.isFinite(v) ? v : undefined });
            }}
            placeholder="—"
            className="gc-input"
            style={{ maxWidth: 140 }}
          />
        </div>

        <div className="gc-field">
          <div className="gc-label">Notes <span className="opt">pre-filled from your rating</span></div>
          <textarea
            value={editingEntry.notes || ''}
            onChange={(e) => onPatch(editingEntry.id, { notes: e.target.value })}
            placeholder="What makes this special? Why are you sending people here?"
            rows={5}
            className="gc-textarea"
          />
        </div>

        <div className="gc-field">
          <div className="gc-label">
            {orderedLabel}{' '}
            <span className="opt">comma separated{type === 'restaurants' ? ' · pre-filled from your rating' : ''}</span>
          </div>
          <DishesInput
            value={orderedVals || []}
            placeholder={type === 'restaurants' ? 'Cold sesame noodles, Twice-cooked pork belly' : 'Saffron, Bomba rice'}
            onCommit={(next) => onPatch(editingEntry.id, { [orderedKey]: next } as Partial<GuideEntry>)}
          />
        </div>

        {type === 'restaurants' && (
          <>
            <div className="gc-field">
              <div className="gc-label">Best for <span className="opt">optional</span></div>
              <input
                value={editingEntry.bestFor || ''}
                onChange={(e) => onPatch(editingEntry.id, { bestFor: e.target.value })}
                placeholder="A grown-up dinner. The room you bring your parents to."
                className="gc-input"
              />
            </div>
            <div className="gc-field">
              <div className="gc-label">Insider tip <span className="opt">optional</span></div>
              <input
                value={editingEntry.insiderTip || ''}
                onChange={(e) => onPatch(editingEntry.id, { insiderTip: e.target.value })}
                placeholder="Sit upstairs by the window."
                className="gc-input"
              />
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <>
      <p className="gc-pane-intro">Drag to reorder, edit each entry's details, or remove. Add more from another source if you need.</p>

      <div className="gc-photo-toggle">
        <div className="gc-photo-toggle-icon"><ImagePlus size={16} /></div>
        <div className="gc-photo-toggle-text">
          <div className="gc-photo-toggle-title">Include photos on entries</div>
          <div className="gc-photo-toggle-sub">When off, entry cards render text-only on the published guide.</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={includePhotos}
          onClick={() => onTogglePhotos(!includePhotos)}
          className={`gc-switch${includePhotos ? ' is-on' : ''}`}
        >
          <span className="gc-switch-knob" />
        </button>
      </div>

      <div className="gc-entries-head">
        <div className="gc-pane-eyebrow">
          <span className="strong">{entries.length}</span> entr{entries.length === 1 ? 'y' : 'ies'}
        </div>
        <button type="button" onClick={onAddMore} className="gc-entries-add-more">
          <Plus size={14} /> Add more
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="gc-empty">No entries yet — go back and add some from a source.</div>
      ) : (
        <div className="gc-entry-list">
          {entries.map((entry, idx) => (
            <div
              key={entry.id}
              draggable
              onDragStart={() => { dragRef.current = idx; }}
              onDragOver={(e) => { e.preventDefault(); }}
              onDrop={() => {
                const from = dragRef.current;
                if (from === null || from === idx) return;
                onMove(from, idx);
                dragRef.current = null;
              }}
              className="gc-entry-card"
            >
              <div className="gc-entry-row">
                <span className="gc-entry-grip"><GripVertical size={16} /></span>
                <span className="gc-entry-num">{(idx + 1).toString().padStart(2, '0')}</span>
                <div className="gc-entry-text">
                  <div className="gc-entry-name">{entry.name}</div>
                  <div className="gc-entry-sub">{entry.subtitle}</div>
                </div>
                <div className="gc-entry-actions">
                  {typeof entry.score === 'number' && entry.score > 0 && (
                    <span className="gc-entry-score" title="Your rating">{entry.score.toFixed(1)}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => onToggleExpand(entry.id)}
                    className="gc-entry-edit-pill"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(entry.id)}
                    aria-label="Remove"
                    className="gc-entry-action"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

/* ── Step: Visibility ─────────────────────────────────────────────── */

const StepVisibility: React.FC<{
  visibility: GuideVisibility;
  onChange: (v: GuideVisibility) => void;
  accountIsPublic: boolean;
}> = ({ visibility, onChange, accountIsPublic }) => (
  <>
    <p className="gc-pane-intro">
      Defaults to your account setting ({accountIsPublic ? 'public' : 'private'}). You can change this anytime after publishing.
    </p>
    <div className="gc-visibility-row">
      {([
        { key: 'public' as const, label: 'Public', icon: <Globe size={20} />, blurb: 'Appears on Discover. Anyone with the link can read it.' },
        { key: 'private' as const, label: 'Private', icon: <Lock size={20} />, blurb: 'Only you can see it. Use this for drafts or personal lists.' },
      ]).map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={`gc-visibility-card${visibility === opt.key ? ' is-active' : ''}`}
        >
          <div className="gc-visibility-icon">{opt.icon}</div>
          <div>
            <div className="gc-visibility-title">{opt.label}</div>
            <div className="gc-visibility-sub">{opt.blurb}</div>
          </div>
        </button>
      ))}
    </div>
  </>
);

/* ── Step: Review (mini-detail preview) ───────────────────────────── */

const StepReview: React.FC<{
  type: GuideType;
  title: string;
  subtitle: string;
  intro: string;
  coverPhoto: string;
  tags: string[];
  entries: GuideEntry[];
  includePhotos: boolean;
  visibility: GuideVisibility;
  onEditField: (target: 'cover' | 'title' | 'intro' | 'tags' | 'entries' | 'visibility') => void;
  onEditEntry: (id: string) => void;
}> = ({ type, title, subtitle, intro, coverPhoto, tags, entries, includePhotos, visibility, onEditField, onEditEntry }) => {
  const avg = (() => {
    const scored = entries.map((e) => e.score).filter((s): s is number => typeof s === 'number');
    if (scored.length === 0) return null;
    return (scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(1);
  })();

  return (
    <>
      <p className="gc-pane-intro">Tap anything to jump back and edit. When it looks right, hit Publish.</p>

      <div className="gc-review">
        <button type="button" onClick={() => onEditField('cover')} className="gc-review-hero">
          {coverPhoto ? (
            <>
              <img src={coverPhoto} alt="" referrerPolicy="no-referrer" />
              <div className="gc-review-hero-overlay" />
              <div className="gc-review-hero-text">
                <div className="gc-review-hero-eyebrow">
                  Guides / {type === 'recipes' ? 'Recipes' : 'Restaurants'}{tags[0] ? ` · ${tags[0]}` : ''}
                </div>
                <div className="gc-review-hero-title">{title || 'Untitled guide'}</div>
                {subtitle && <div className="gc-review-hero-sub">{subtitle}</div>}
                <div className="gc-review-hero-meta">
                  {entries.length} {type === 'recipes' ? 'recipes' : 'spots'}{avg ? ` · ${avg} avg` : ''}
                </div>
              </div>
            </>
          ) : (
            <div className="gc-review-hero-empty">
              <ImagePlus size={26} />
              Add a cover photo
            </div>
          )}
        </button>

        <div className="gc-review-body">
          <button type="button" onClick={() => onEditField('title')} className="gc-review-edit-link" style={{ alignSelf: 'flex-start' }}>
            Edit title, subtitle, intro & tags →
          </button>

          {intro && (
            <p className="gc-review-intro">{intro}</p>
          )}

          {tags.length > 0 && (
            <div className="gc-review-tags">
              {tags.map((t) => <span key={t} className="gc-review-tag">{t}</span>)}
            </div>
          )}

          <div className="gc-review-meta-strip">
            {visibility === 'public' ? <Globe size={14} /> : <Lock size={14} />}
            {visibility === 'public' ? 'Public' : 'Private'}
            <span className="gc-review-meta-strip-spacer" />
            <button type="button" onClick={() => onEditField('visibility')} className="gc-review-edit-link" style={{ color: 'inherit' }}>
              Change
            </button>
          </div>

          <div className="gc-review-entries-head">
            <h4>{entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</h4>
            <button type="button" onClick={() => onEditField('entries')} className="gc-review-edit-link">
              Edit entries →
            </button>
          </div>
          <div className="gc-review-entries">
            {entries.map((e, idx) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onEditEntry(e.id)}
                className="gc-review-entry"
              >
                <span className="gc-review-entry-num">{(idx + 1).toString().padStart(2, '0')}</span>
                {includePhotos && (
                  <span className="gc-review-entry-img">
                    {e.image && <img src={e.image} alt="" referrerPolicy="no-referrer" />}
                  </span>
                )}
                <div className="gc-review-entry-text">
                  <div className="gc-review-entry-name">{e.name}</div>
                  <div className="gc-review-entry-sub">{e.subtitle}</div>
                </div>
                {typeof e.score === 'number' && e.score > 0 && (
                  <span className="gc-review-entry-score">{e.score.toFixed(1)}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};
