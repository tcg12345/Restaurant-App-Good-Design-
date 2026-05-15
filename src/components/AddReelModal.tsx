/**
 * AddReelModal — three-step flow.
 *
 *   Step 1: pick reel type (restaurant / recipe) and the featured item.
 *   Step 2: upload the video (skipped in edit mode — video is locked).
 *   Step 3: caption, location, audio, visibility — with a preview of
 *           the video pinned to the top so the user sees what they're
 *           captioning.
 *
 * Animations: horizontal slide between steps using motion's direction
 * variant. The picker dropdown in step 1 collapses/expands smoothly,
 * and step 2's drop zone cross-fades into the preview once a file is
 * accepted.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X, Film, ChefHat, MapPin, Search, Check, Upload, Music2, AlertCircle,
  Loader2, Globe, Users as UsersIcon, Star, ChevronLeft, ChevronRight,
  Image as ImageIcon, Trash2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  useReels,
  readVideoDuration,
  REEL_MAX_DURATION_SECONDS,
  type ReelKind,
} from '../contexts/ReelsContext';
import { useLists } from '../contexts/ListsContext';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { searchPlacesByText, priceLevelToString, CUISINE_TYPES, type PlaceResult } from '../lib/places';
import { searchLocations, type HomeLocation } from './HomeLocationBar';

// Build a Google Places type → human label lookup once.
const PLACE_TYPE_TO_CUISINE: Record<string, string> = {};
for (const c of CUISINE_TYPES) {
  if (c.type) PLACE_TYPE_TO_CUISINE[c.type] = c.label;
}
const cuisineFromTypes = (types: string[] | undefined): string => {
  if (!types) return '';
  for (const t of types) {
    if (PLACE_TYPE_TO_CUISINE[t]) return PLACE_TYPE_TO_CUISINE[t];
  }
  return '';
};

const DEFAULT_LAT = 40.735;
const DEFAULT_LNG = -74.027;

const BG_GRADIENT_POOL = [
  'from-orange-900 via-orange-800 to-orange-950',
  'from-stone-900 via-amber-900 to-stone-900',
  'from-zinc-900 via-rose-900/70 to-zinc-900',
  'from-yellow-900 via-amber-800 to-rose-950',
  'from-emerald-950 via-emerald-800 to-stone-900',
  'from-indigo-950 via-purple-900 to-stone-900',
];

function pickFromPool<T>(pool: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}

type Step = 1 | 2 | 3;

/* ── Modal ──────────────────────────────────────────────────────────── */

export const AddReelModal: React.FC = () => {
  const { addReelModalOpen, addReelInitialKind, editingReelId, closeAddReelModal, postReel, updateReel, setReelVisibility, reels } = useReels();
  const editingReel = editingReelId ? reels.find((r) => r.id === editingReelId) ?? null : null;
  const isEditing = !!editingReel;
  const { ratings, wishlist, restaurantMeta, homeMeals } = useLists();
  const { user } = useAuth();
  const { phoneMode } = useSettings();
  const { showToast } = useToast();

  // ── Step machine ──
  const [step, setStep] = useState<Step>(1);
  // Direction = +1 (forward) or -1 (back) — drives slide direction.
  const [direction, setDirection] = useState<1 | -1>(1);
  const goToStep = (next: Step) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  };

  // ── Form state ──
  const [kind, setKind] = useState<ReelKind>(addReelInitialKind ?? 'restaurant');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [caption, setCaption] = useState('');
  const [audio, setAudio] = useState('Original audio');
  const [locationLabel, setLocationLabel] = useState('');
  const [pickedLocation, setPickedLocation] = useState<HomeLocation | null>(null);
  const [isPublic, setIsPublic] = useState(true);
  const [pickedRestaurantId, setPickedRestaurantId] = useState<string | null>(null);
  const [pickedRecipeId, setPickedRecipeId] = useState<string | null>(null);
  const [restaurantSearch, setRestaurantSearch] = useState('');
  const [recipeSearch, setRecipeSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Places API search (restaurants) ──
  const [userLat, setUserLat] = useState<number>(DEFAULT_LAT);
  const [userLng, setUserLng] = useState<number>(DEFAULT_LNG);
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const placeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPlaceQueryRef = useRef<string>('');

  // ── Location search (free-text reel location) ──
  const [locationSuggestions, setLocationSuggestions] = useState<HomeLocation[]>([]);
  const [locationFocused, setLocationFocused] = useState(false);
  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLocationQueryRef = useRef<string>('');
  const locationWrapRef = useRef<HTMLDivElement | null>(null);

  // Reset whenever the modal reopens.
  useEffect(() => {
    if (!addReelModalOpen) return;
    if (editingReel) {
      setKind(editingReel.kind);
      setVideoFile(null);
      setVideoUrl(null);
      setVideoDuration(null);
      setCaption(editingReel.caption);
      setAudio(editingReel.audioLabel);
      setLocationLabel(editingReel.locationLabel || '');
      setPickedLocation(editingReel.locationLabel ? { label: editingReel.locationLabel, lat: 0, lng: 0 } : null);
      setIsPublic(editingReel.isPublic);
      setPickedRestaurantId(editingReel.restaurant?.id ?? null);
      setPickedRecipeId(editingReel.recipe?.id ?? null);
      // Skip video step in edit mode — video is immutable.
      setStep(3);
    } else {
      setKind(addReelInitialKind ?? 'restaurant');
      setVideoFile(null);
      setVideoUrl(null);
      setVideoDuration(null);
      setCaption('');
      setAudio('Original audio');
      setLocationLabel('');
      setPickedLocation(null);
      setIsPublic(true);
      setPickedRestaurantId(null);
      setPickedRecipeId(null);
      setStep(1);
    }
    setDirection(1);
    setRestaurantSearch('');
    setRecipeSearch('');
    setPlaceResults([]);
    setSearchingPlaces(false);
    setLocationSuggestions([]);
    setLocationFocused(false);
    setSubmitting(false);
    setProgress(0);
    setErrorMsg(null);
    setValidationMsg(null);
  }, [addReelModalOpen, addReelInitialKind, editingReelId]);

  // Revoke the preview URL when it changes or the modal closes.
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  // On phone, auto-open the OS picker the first time step 2 mounts so
  // the user lands on the camera roll without a second tap (the
  // "Next" tap from step 1 keeps the user-gesture context alive long
  // enough on iOS / Android Chrome). We only fire when no video is
  // chosen yet so going back to step 2 to replace doesn't re-open.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!addReelModalOpen) { autoOpenedRef.current = false; return; }
    if (step !== 2 || videoUrl || autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    // Defer a tick so the step's input element is mounted.
    const id = window.setTimeout(() => {
      try { fileInputRef.current?.click(); } catch { /* user gesture lost — fall back to tap */ }
    }, 60);
    return () => window.clearTimeout(id);
  }, [addReelModalOpen, step, videoUrl]);

  // Best-effort geolocation lookup so Places search biases local matches.
  useEffect(() => {
    if (!addReelModalOpen) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        setUserLat(pos.coords.latitude);
        setUserLng(pos.coords.longitude);
      },
      () => { /* permission denied — keep default bias */ },
      { timeout: 5000 },
    );
    return () => { cancelled = true; };
  }, [addReelModalOpen]);

  // Debounced Places search for restaurants — only when the user is on
  // step 1 and the restaurant tab.
  useEffect(() => {
    if (!addReelModalOpen || step !== 1 || kind !== 'restaurant') return;
    if (placeDebounceRef.current) clearTimeout(placeDebounceRef.current);
    const q = restaurantSearch.trim();
    if (q.length < 2) {
      setPlaceResults([]);
      setSearchingPlaces(false);
      return;
    }
    setSearchingPlaces(true);
    placeDebounceRef.current = setTimeout(async () => {
      lastPlaceQueryRef.current = q;
      try {
        const found = await searchPlacesByText(q, userLat, userLng);
        if (lastPlaceQueryRef.current !== q) return;
        setPlaceResults(found);
      } catch (err) {
        console.warn('[AddReel] places search failed', err);
        if (lastPlaceQueryRef.current === q) setPlaceResults([]);
      } finally {
        if (lastPlaceQueryRef.current === q) setSearchingPlaces(false);
      }
    }, 300);
    return () => {
      if (placeDebounceRef.current) clearTimeout(placeDebounceRef.current);
    };
  }, [addReelModalOpen, step, kind, restaurantSearch, userLat, userLng]);

  // Debounced location search — runs while the user is typing on step 3.
  useEffect(() => {
    if (!addReelModalOpen || step !== 3) return;
    if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
    const q = locationLabel.trim();
    if (!q || (pickedLocation && pickedLocation.label === locationLabel)) {
      setLocationSuggestions([]);
      return;
    }
    if (q.length < 2) {
      setLocationSuggestions([]);
      return;
    }
    locationDebounceRef.current = setTimeout(async () => {
      lastLocationQueryRef.current = q;
      try {
        const found = await searchLocations(q);
        if (lastLocationQueryRef.current !== q) return;
        setLocationSuggestions(found);
      } catch (err) {
        console.warn('[AddReel] location search failed', err);
        if (lastLocationQueryRef.current === q) setLocationSuggestions([]);
      }
    }, 250);
    return () => { if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current); };
  }, [addReelModalOpen, step, locationLabel, pickedLocation]);

  // Click-outside the location field — close the suggestions dropdown.
  useEffect(() => {
    if (!locationFocused) return;
    const onDocClick = (e: MouseEvent) => {
      if (locationWrapRef.current && !locationWrapRef.current.contains(e.target as Node)) {
        setLocationFocused(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [locationFocused]);

  // ── Helpers ──
  const safePickerImage = (url: string | undefined | null): string | undefined => {
    if (!url || typeof url !== 'string') return undefined;
    if (url.startsWith('data:')) return undefined;
    return url;
  };

  const PICKER_LIMIT = 20;

  // ── Restaurant pick list (local + Places) ──
  const restaurantPickList = useMemo(() => {
    type Item = { id: string; name: string; cuisine: string; price: string; address: string; image?: string; score?: number; fromUser: boolean };
    if (!addReelModalOpen) return [] as Item[];
    const q = restaurantSearch.trim().toLowerCase();
    const seen = new Set<string>();
    const items: Item[] = [];
    const ratingScoreById = new Map<string, number>();
    for (const r of ratings) {
      ratingScoreById.set(r.restaurantId, r.score);
      if (seen.has(r.restaurantId)) continue;
      const passesQ = !q || `${r.name} ${r.cuisine} ${r.address}`.toLowerCase().includes(q);
      if (!passesQ) continue;
      seen.add(r.restaurantId);
      items.push({
        id: r.restaurantId, name: r.name, cuisine: r.cuisine, price: r.price, address: r.address,
        image: safePickerImage(r.image), score: r.score, fromUser: true,
      });
    }
    for (const w of wishlist) {
      if (seen.has(w.restaurantId)) continue;
      const passesQ = !q || `${w.name} ${w.cuisine} ${w.address}`.toLowerCase().includes(q);
      if (!passesQ) continue;
      seen.add(w.restaurantId);
      items.push({
        id: w.restaurantId, name: w.name, cuisine: w.cuisine, price: w.price, address: w.address,
        image: safePickerImage(w.image), score: ratingScoreById.get(w.restaurantId), fromUser: true,
      });
    }
    for (const [id, m] of Object.entries(restaurantMeta || {})) {
      if (id.startsWith('__') || seen.has(id)) continue;
      const meta = m as { name?: string; cuisine?: string; price?: string; address?: string; image?: string };
      if (!meta?.name) continue;
      const passesQ = !q || `${meta.name} ${meta.cuisine || ''} ${meta.address || ''}`.toLowerCase().includes(q);
      if (!passesQ) continue;
      seen.add(id);
      items.push({
        id, name: meta.name, cuisine: meta.cuisine || '', price: meta.price || '', address: meta.address || '',
        image: safePickerImage(meta.image), score: ratingScoreById.get(id), fromUser: true,
      });
    }
    if (q) {
      for (const p of placeResults) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        items.push({
          id: p.id, name: p.name, cuisine: cuisineFromTypes(p.types),
          price: priceLevelToString(p.priceLevel) || '',
          address: p.address || p.fullAddress || '',
          image: undefined, score: ratingScoreById.get(p.id), fromUser: false,
        });
      }
    }
    return items.slice(0, q ? 30 : PICKER_LIMIT);
  }, [addReelModalOpen, ratings, wishlist, restaurantMeta, restaurantSearch, placeResults]);

  // ── Recipe pick list ──
  const recipePickList = useMemo(() => {
    type Item = { id: string; title: string; prepTime: number; cookTime: number; servings: number; difficulty: 'Easy' | 'Medium' | 'Hard'; image?: string };
    if (!addReelModalOpen) return [] as Item[];
    const items: Item[] = homeMeals.map((m) => ({
      id: m.id, title: m.name,
      prepTime: m.prepTime ?? 0, cookTime: m.cookTime ?? 0, servings: m.servings ?? 0,
      difficulty: m.difficulty ?? 'Easy',
      image: safePickerImage(m.coverPhoto || m.photos?.[0]?.url),
    }));
    const q = recipeSearch.trim().toLowerCase();
    if (!q) return items.slice(0, PICKER_LIMIT);
    return items.filter((it) => it.title.toLowerCase().includes(q)).slice(0, PICKER_LIMIT);
  }, [addReelModalOpen, homeMeals, recipeSearch]);

  const pickedRestaurant = useMemo(() => {
    if (editingReel?.restaurant && editingReel.restaurant.id === pickedRestaurantId) {
      return {
        id: editingReel.restaurant.id, name: editingReel.restaurant.name,
        cuisine: editingReel.restaurant.cuisine, price: editingReel.restaurant.price,
        address: editingReel.restaurant.address, image: editingReel.restaurant.image,
        score: editingReel.restaurant.score, fromUser: false,
      };
    }
    return restaurantPickList.find((r) => r.id === pickedRestaurantId) ?? null;
  }, [editingReel, restaurantPickList, pickedRestaurantId]);
  const pickedRecipe = useMemo(() => {
    if (editingReel?.recipe && editingReel.recipe.id === pickedRecipeId) {
      return { ...editingReel.recipe };
    }
    return recipePickList.find((r) => r.id === pickedRecipeId) ?? null;
  }, [editingReel, recipePickList, pickedRecipeId]);

  // ── Video selection ──
  const onPickFile = async (file: File | null) => {
    if (!file) return;
    setValidationMsg(null);
    setErrorMsg(null);
    const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|mkv|avi|3gp|qt|hevc)$/i;
    const looksLikeVideo = file.type.startsWith('video/') || VIDEO_EXT_RE.test(file.name);
    if (!looksLikeVideo) {
      setValidationMsg('Please pick a video file.');
      return;
    }
    let duration: number;
    try {
      duration = await readVideoDuration(file);
    } catch (err) {
      console.warn('[AddReel] probe failed:', err);
      setValidationMsg("Couldn't read this video — try exporting to MP4 (H.264) and uploading again.");
      return;
    }
    if (duration > REEL_MAX_DURATION_SECONDS + 0.5) {
      setValidationMsg(`Video is ${duration.toFixed(0)}s — reels are limited to ${REEL_MAX_DURATION_SECONDS}s.`);
      return;
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
    setVideoDuration(duration);
  };

  const clearVideo = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(null);
    setVideoUrl(null);
    setVideoDuration(null);
    setValidationMsg(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Step gates ──
  const hasFeatured = kind === 'restaurant' ? !!pickedRestaurant : !!pickedRecipe;
  const canAdvanceFromStep1 = hasFeatured;
  const canAdvanceFromStep2 = !!videoFile && !!videoUrl;
  const canSubmit = !!user?.id && hasFeatured && !submitting && (isEditing || !!videoFile);

  // ── Submit ──
  const buildAttachment = () => ({
    restaurant: kind === 'restaurant' && pickedRestaurant ? {
      id: pickedRestaurant.id, name: pickedRestaurant.name,
      cuisine: pickedRestaurant.cuisine, price: pickedRestaurant.price,
      address: pickedRestaurant.address, image: pickedRestaurant.image,
      score: pickedRestaurant.score,
    } : undefined,
    recipe: kind === 'recipe' && pickedRecipe ? {
      id: pickedRecipe.id, title: pickedRecipe.title,
      prepTime: pickedRecipe.prepTime, cookTime: pickedRecipe.cookTime,
      servings: pickedRecipe.servings, difficulty: pickedRecipe.difficulty,
      image: pickedRecipe.image,
    } : undefined,
  });

  const resolvedLocationLabel = (pickedLocation?.label ?? locationLabel).trim();

  const onSubmit = async () => {
    if (!canSubmit || !user?.id) return;
    setErrorMsg(null);
    setSubmitting(true);
    // Edit
    if (isEditing && editingReel) {
      try {
        const att = buildAttachment();
        const ok = await updateReel(editingReel.id, {
          caption: caption.trim(),
          audioLabel: audio.trim() || 'Original audio',
          locationLabel: resolvedLocationLabel,
          restaurant: att.restaurant ?? null,
          recipe: att.recipe ?? null,
        });
        if (!ok) throw new Error("Couldn't update the reel — try again.");
        if (editingReel.isPublic !== isPublic) {
          await setReelVisibility(editingReel.id, isPublic);
        }
        showToast('Reel updated');
        closeAddReelModal();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Update failed');
      } finally {
        setSubmitting(false);
      }
      return;
    }
    // Create
    if (!videoFile) { setSubmitting(false); return; }
    setProgress(0.05);
    try {
      const bgGradient = pickFromPool(BG_GRADIENT_POOL, videoFile.name + user.id);
      const att = buildAttachment();
      const reel = await postReel({
        file: videoFile, kind,
        caption: caption.trim(),
        audioLabel: audio.trim() || 'Original audio',
        locationLabel: resolvedLocationLabel,
        bgGradient,
        durationSeconds: videoDuration ?? 0,
        isPublic,
        restaurant: att.restaurant, recipe: att.recipe,
        onProgress: (n) => setProgress(n),
      });
      if (!reel) throw new Error("Couldn't create the reel — try again.");
      showToast('Reel posted', { subtitle: "It's live in the feed" });
      closeAddReelModal();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setErrorMsg(msg);
      setProgress(0);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step variants for the slide animation ──
  const stepVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? 32 : -32, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -32 : 32, opacity: 0 }),
  };

  const totalSteps = isEditing ? 1 : 3;
  const stepIndex = isEditing ? 0 : step - 1;

  return (
    <AnimatePresence>
      {addReelModalOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className={cn(
            'fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex justify-center',
            phoneMode ? 'items-end' : 'items-end sm:items-center',
          )}
          onClick={() => { if (!submitting) closeAddReelModal(); }}
        >
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'bg-surface w-full overflow-hidden flex flex-col',
              phoneMode
                ? 'h-full rounded-none'
                : 'h-full sm:max-w-lg sm:max-h-[92vh] sm:h-[92vh] rounded-none sm:rounded-3xl',
            )}
          >
            {/* Header */}
            <div className="px-5 pt-4 pb-3 flex items-center gap-3 border-b border-on-surface/[0.06] flex-shrink-0">
              {/* Back / close */}
              {step > 1 && !isEditing ? (
                <button
                  type="button"
                  onClick={() => goToStep((step - 1) as Step)}
                  disabled={submitting}
                  className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center text-on-surface/70 transition-colors disabled:opacity-40 flex-shrink-0"
                  aria-label="Back"
                >
                  <ChevronLeft size={18} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { if (!submitting) closeAddReelModal(); }}
                  disabled={submitting}
                  className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center text-on-surface/70 transition-colors disabled:opacity-40 flex-shrink-0"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              )}
              <div className="flex-1 min-w-0">
                <h2 className="font-serif font-bold text-lg leading-tight truncate">
                  {isEditing ? 'Edit reel' : (
                    step === 1 ? "What's your reel?" :
                    step === 2 ? 'Upload your video' :
                    'Final touches'
                  )}
                </h2>
                {!isEditing && (
                  <p className="text-[12px] text-on-surface/45 mt-0.5 truncate">
                    {step === 1 && 'Pick a type and the featured item.'}
                    {step === 2 && `Up to ${REEL_MAX_DURATION_SECONDS}s.`}
                    {step === 3 && 'Add a caption and details.'}
                  </p>
                )}
              </div>
              {/* Step pip indicator — hidden in edit mode (single step). */}
              {!isEditing && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {Array.from({ length: totalSteps }).map((_, i) => (
                    <motion.span
                      key={i}
                      className={cn(
                        'h-1.5 rounded-full',
                        i <= stepIndex ? 'bg-primary' : 'bg-on-surface/10',
                      )}
                      animate={{ width: i === stepIndex ? 20 : 6 }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Body — animated step content */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden relative">
              <AnimatePresence mode="wait" initial={false} custom={direction}>
                <motion.div
                  key={step}
                  custom={direction}
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  className="px-5 pt-5 pb-6"
                >
                  {/* ───────── STEP 1 ───────── */}
                  {step === 1 && !isEditing && (
                    <Step1Type
                      kind={kind}
                      setKind={(k) => {
                        setKind(k);
                        setPickedRestaurantId(null);
                        setPickedRecipeId(null);
                        setRestaurantSearch('');
                        setRecipeSearch('');
                      }}
                      pickedRestaurant={pickedRestaurant}
                      pickedRecipe={pickedRecipe}
                      onClearPick={() => {
                        setPickedRestaurantId(null);
                        setPickedRecipeId(null);
                      }}
                      restaurantSearch={restaurantSearch}
                      setRestaurantSearch={setRestaurantSearch}
                      recipeSearch={recipeSearch}
                      setRecipeSearch={setRecipeSearch}
                      restaurantPickList={restaurantPickList}
                      recipePickList={recipePickList}
                      searchingPlaces={searchingPlaces}
                      onPickRestaurant={(id) => setPickedRestaurantId(id)}
                      onPickRecipe={(id) => setPickedRecipeId(id)}
                    />
                  )}

                  {/* ───────── STEP 2 ───────── */}
                  {step === 2 && !isEditing && (
                    <Step2Video
                      videoUrl={videoUrl}
                      videoDuration={videoDuration}
                      validationMsg={validationMsg}
                      onPickFile={onPickFile}
                      onClearVideo={clearVideo}
                      fileInputRef={fileInputRef}
                    />
                  )}

                  {/* ───────── STEP 3 ───────── */}
                  {step === 3 && (
                    <Step3Details
                      videoUrl={videoUrl}
                      existingVideoUrl={editingReel?.videoUrl}
                      caption={caption}
                      setCaption={setCaption}
                      audio={audio}
                      setAudio={setAudio}
                      locationLabel={locationLabel}
                      setLocationLabel={(v) => {
                        setLocationLabel(v);
                        if (pickedLocation && v !== pickedLocation.label) setPickedLocation(null);
                      }}
                      pickedLocation={pickedLocation}
                      onPickLocation={(loc) => {
                        setPickedLocation(loc);
                        setLocationLabel(loc.label);
                        setLocationFocused(false);
                      }}
                      onClearLocation={() => {
                        setPickedLocation(null);
                        setLocationLabel('');
                      }}
                      locationFocused={locationFocused}
                      setLocationFocused={setLocationFocused}
                      locationSuggestions={locationSuggestions}
                      locationWrapRef={locationWrapRef}
                      isPublic={isPublic}
                      setIsPublic={setIsPublic}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Auth / error band — shown below the body but above the footer */}
            {(errorMsg || !user?.id) && (
              <div className="px-5 pb-2 flex-shrink-0 space-y-2">
                {!user?.id && (
                  <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800">
                    <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                    <span>Sign in to post reels.</span>
                  </div>
                )}
                {errorMsg && (
                  <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-[12px] text-rose-700">
                    <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="border-t border-on-surface/[0.06] px-5 py-3 bg-surface flex items-center gap-3 flex-shrink-0">
              {/* Step 1 + 2: Next button. Step 3: Post / Save. */}
              {!isEditing && step === 1 && (
                <button
                  type="button"
                  onClick={() => goToStep(2)}
                  disabled={!canAdvanceFromStep1}
                  className={cn(
                    'flex-1 h-11 rounded-full text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors',
                    canAdvanceFromStep1
                      ? 'bg-primary text-white hover:bg-primary/90'
                      : 'bg-on-surface/10 text-on-surface/35 cursor-not-allowed',
                  )}
                >
                  Next <ChevronRight size={15} />
                </button>
              )}
              {!isEditing && step === 2 && (
                <button
                  type="button"
                  onClick={() => goToStep(3)}
                  disabled={!canAdvanceFromStep2}
                  className={cn(
                    'flex-1 h-11 rounded-full text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors',
                    canAdvanceFromStep2
                      ? 'bg-primary text-white hover:bg-primary/90'
                      : 'bg-on-surface/10 text-on-surface/35 cursor-not-allowed',
                  )}
                >
                  Next <ChevronRight size={15} />
                </button>
              )}
              {step === 3 && (
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={!canSubmit}
                  className={cn(
                    'flex-1 h-11 rounded-full text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors relative overflow-hidden',
                    canSubmit && !submitting
                      ? 'bg-primary text-white hover:bg-primary/90'
                      : 'bg-on-surface/10 text-on-surface/35 cursor-not-allowed',
                  )}
                >
                  {submitting ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      {isEditing ? 'Saving…' : `Uploading… ${Math.round(progress * 100)}%`}
                    </>
                  ) : (
                    <>
                      <Upload size={15} />
                      {isEditing ? 'Save changes' : 'Post reel'}
                    </>
                  )}
                  {submitting && (
                    <span
                      className="absolute left-0 bottom-0 h-0.5 bg-white/40"
                      style={{ width: `${Math.round(progress * 100)}%`, transition: 'width 200ms ease-out' }}
                    />
                  )}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ── Step 1: Type + Featured item ─────────────────────────────────────── */

interface RestaurantPickItem {
  id: string; name: string; cuisine: string; price: string;
  address: string; image?: string; score?: number; fromUser: boolean;
}
interface RecipePickItem {
  id: string; title: string; prepTime: number; cookTime: number;
  servings: number; difficulty: 'Easy' | 'Medium' | 'Hard'; image?: string;
}

const Step1Type: React.FC<{
  kind: ReelKind;
  setKind: (k: ReelKind) => void;
  pickedRestaurant: RestaurantPickItem | null;
  pickedRecipe: RecipePickItem | null;
  onClearPick: () => void;
  restaurantSearch: string;
  setRestaurantSearch: (v: string) => void;
  recipeSearch: string;
  setRecipeSearch: (v: string) => void;
  restaurantPickList: RestaurantPickItem[];
  recipePickList: RecipePickItem[];
  searchingPlaces: boolean;
  onPickRestaurant: (id: string) => void;
  onPickRecipe: (id: string) => void;
}> = ({
  kind, setKind, pickedRestaurant, pickedRecipe, onClearPick,
  restaurantSearch, setRestaurantSearch, recipeSearch, setRecipeSearch,
  restaurantPickList, recipePickList, searchingPlaces,
  onPickRestaurant, onPickRecipe,
}) => {
  const picked = kind === 'restaurant' ? pickedRestaurant : pickedRecipe;

  return (
    <div className="space-y-6">
      {/* Type chooser — two big cards */}
      <section>
        <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-2.5">Type</h3>
        <div className="grid grid-cols-2 gap-3">
          {(['restaurant', 'recipe'] as const).map((k) => {
            const Icon = k === 'restaurant' ? MapPin : ChefHat;
            const active = kind === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  'rounded-2xl border px-4 py-4 text-left transition-all',
                  active
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                    : 'border-on-surface/[0.08] bg-white hover:border-on-surface/15',
                )}
              >
                <div className={cn(
                  'w-10 h-10 rounded-full flex items-center justify-center mb-2 transition-colors',
                  active ? 'bg-primary text-white' : 'bg-on-surface/[0.06] text-on-surface/55',
                )}>
                  <Icon size={18} />
                </div>
                <p className="font-serif font-bold text-[15px] leading-tight">
                  {k === 'restaurant' ? 'Restaurant Reel' : 'Recipe Reel'}
                </p>
                <p className="text-[11.5px] text-on-surface/50 mt-1 leading-snug">
                  {k === 'restaurant' ? 'Showcase a place you visited' : 'Walk through a recipe'}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Picker for the chosen type — slides open smoothly */}
      <motion.section
        key={kind}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-2.5">
          {kind === 'restaurant' ? 'Featured restaurant' : 'Featured recipe'}
        </h3>

        {picked ? (
          <PickedPill
            name={kind === 'restaurant' ? (pickedRestaurant?.name ?? '') : (pickedRecipe?.title ?? '')}
            meta={kind === 'restaurant'
              ? [pickedRestaurant?.cuisine, pickedRestaurant?.price, pickedRestaurant?.address?.split(',')[0]?.trim()].filter(Boolean).join(' · ')
              : [
                ((pickedRecipe?.prepTime ?? 0) + (pickedRecipe?.cookTime ?? 0)) > 0 ? `${(pickedRecipe?.prepTime ?? 0) + (pickedRecipe?.cookTime ?? 0)} min` : '',
                pickedRecipe?.servings ? `${pickedRecipe.servings} serv` : '',
                pickedRecipe?.difficulty ?? '',
              ].filter(Boolean).join(' · ')
            }
            image={kind === 'restaurant' ? pickedRestaurant?.image : pickedRecipe?.image}
            onClear={onClearPick}
          />
        ) : (
          <>
            {kind === 'restaurant' ? (
              <>
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/45" />
                  <input
                    type="text"
                    value={restaurantSearch}
                    onChange={(e) => setRestaurantSearch(e.target.value)}
                    placeholder="Search restaurants…"
                    className="w-full h-11 pl-9 pr-3 rounded-full bg-on-surface/[0.05] focus:bg-on-surface/[0.08] outline-none text-sm"
                  />
                  {searchingPlaces && (
                    <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/45 animate-spin" />
                  )}
                </div>
                <ul className="mt-3 divide-y divide-on-surface/[0.06] rounded-2xl border border-on-surface/[0.06] bg-white max-h-[40vh] overflow-y-auto">
                  {restaurantPickList.length === 0 ? (
                    <li className="px-3 py-6 text-center text-[12.5px] text-on-surface/45">
                      {restaurantSearch.trim().length >= 2
                        ? 'No matches. Try a different name.'
                        : 'Start typing to find a restaurant.'}
                    </li>
                  ) : (
                    restaurantPickList.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => onPickRestaurant(r.id)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-on-surface/[0.03] transition-colors"
                        >
                          <div className="w-10 h-10 rounded-xl overflow-hidden bg-on-surface/[0.06] flex-shrink-0 flex items-center justify-center">
                            {r.image ? (
                              <img src={r.image} alt="" loading="lazy" decoding="async"
                                className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <MapPin size={14} className="text-on-surface/30" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-bold truncate">{r.name}</p>
                            <p className="text-[11.5px] text-on-surface/55 truncate">
                              {[r.cuisine, r.price, r.address?.split(',')[0]?.trim()].filter(Boolean).join(' · ') || 'Restaurant'}
                            </p>
                          </div>
                          {typeof r.score === 'number' && r.score > 0 && (
                            <div className="flex items-center gap-1 text-[11px] font-bold text-amber-700 flex-shrink-0">
                              <Star size={11} className="fill-amber-500 text-amber-500" /> {r.score.toFixed(1)}
                            </div>
                          )}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </>
            ) : (
              <>
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/45" />
                  <input
                    type="text"
                    value={recipeSearch}
                    onChange={(e) => setRecipeSearch(e.target.value)}
                    placeholder="Search your recipes…"
                    className="w-full h-11 pl-9 pr-3 rounded-full bg-on-surface/[0.05] focus:bg-on-surface/[0.08] outline-none text-sm"
                  />
                </div>
                <ul className="mt-3 divide-y divide-on-surface/[0.06] rounded-2xl border border-on-surface/[0.06] bg-white max-h-[40vh] overflow-y-auto">
                  {recipePickList.length === 0 ? (
                    <li className="px-3 py-6 text-center text-[12.5px] text-on-surface/45">
                      You don't have any home cooking recipes yet.
                    </li>
                  ) : (
                    recipePickList.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => onPickRecipe(r.id)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-on-surface/[0.03] transition-colors"
                        >
                          <div className="w-10 h-10 rounded-xl overflow-hidden bg-on-surface/[0.06] flex-shrink-0 flex items-center justify-center">
                            {r.image ? (
                              <img src={r.image} alt="" loading="lazy" decoding="async"
                                className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <ChefHat size={14} className="text-on-surface/30" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-bold truncate">{r.title}</p>
                            <p className="text-[11.5px] text-on-surface/55 truncate">
                              {[
                                ((r.prepTime ?? 0) + (r.cookTime ?? 0)) > 0 ? `${(r.prepTime ?? 0) + (r.cookTime ?? 0)} min` : '',
                                r.servings ? `${r.servings} serv` : '',
                                r.difficulty,
                              ].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </>
            )}
          </>
        )}
      </motion.section>
    </div>
  );
};

/* ── Step 2: Video upload ────────────────────────────────────────────── */

const Step2Video: React.FC<{
  videoUrl: string | null;
  videoDuration: number | null;
  validationMsg: string | null;
  onPickFile: (file: File | null) => void;
  onClearVideo: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}> = ({ videoUrl, videoDuration, validationMsg, onPickFile, onClearVideo, fileInputRef }) => {
  // Drag-drop on this step's surface.
  const [dragDepth, setDragDepth] = useState(0);
  const dragActive = dragDepth > 0;
  const onDragEnter: React.DragEventHandler = (e) => {
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    e.preventDefault();
    setDragDepth((d) => d + 1);
  };
  const onDragOver: React.DragEventHandler = (e) => {
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave: React.DragEventHandler = (e) => {
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    e.preventDefault();
    setDragDepth((d) => Math.max(0, d - 1));
  };
  const onDrop: React.DragEventHandler = (e) => {
    e.preventDefault();
    setDragDepth(0);
    const file = e.dataTransfer?.files?.[0];
    if (file) onPickFile(file);
  };

  return (
    <div
      className="space-y-3"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <AnimatePresence mode="wait">
        {!videoUrl ? (
          <motion.label
            key="empty"
            htmlFor="reel-video-input"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className={cn(
              'block rounded-3xl border-2 border-dashed cursor-pointer transition-all relative overflow-hidden',
              'flex flex-col items-center justify-center text-center',
              'aspect-[9/16] max-h-[60vh]',
              dragActive
                ? 'border-primary bg-primary/[0.06]'
                : 'border-on-surface/15 bg-on-surface/[0.025] hover:border-on-surface/30 active:bg-on-surface/[0.04]',
            )}
          >
            <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
              <Film size={26} />
            </div>
            <p className="font-serif font-bold text-[18px] leading-tight px-6">Tap to pick a video</p>
            <p className="text-[12.5px] text-on-surface/55 mt-1.5 px-6 max-w-[260px] leading-relaxed">
              Choose from your camera roll. Vertical works best. Up to {REEL_MAX_DURATION_SECONDS}s.
            </p>
            {/* The actual file input — visually hidden but the parent label
                forwards taps. Mobile browsers show the photo library
                directly inside the OS picker sheet that opens on tap. */}
            <input
              id="reel-video-input"
              ref={fileInputRef}
              type="file"
              accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi,.3gp,.qt,.hevc"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickFile(f);
                e.target.value = '';
              }}
            />
            {dragActive && (
              <div className="absolute inset-0 bg-primary/[0.08] backdrop-blur-[1px] flex items-center justify-center text-[13px] font-bold text-primary pointer-events-none">
                Drop to upload
              </div>
            )}
          </motion.label>
        ) : (
          <motion.div
            key="preview"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="relative mx-auto rounded-3xl overflow-hidden bg-black aspect-[9/16] max-h-[60vh]"
          >
            <video
              src={videoUrl}
              controls
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
            />
            <button
              type="button"
              onClick={onClearVideo}
              className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-black/55 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-sm"
              aria-label="Remove video"
            >
              <Trash2 size={14} />
            </button>
            {videoDuration != null && (
              <div className="absolute bottom-2.5 left-2.5 px-2 py-1 rounded-full bg-black/55 backdrop-blur-sm text-white text-[11px] font-bold">
                {videoDuration.toFixed(1)}s
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Secondary action when a video is already picked: replace */}
      {videoUrl && (
        <div className="flex justify-center">
          <label htmlFor="reel-video-input-replace" className="inline-flex items-center gap-2 px-4 h-10 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 text-sm font-semibold text-on-surface/80 cursor-pointer transition-colors">
            <ImageIcon size={14} /> Replace
            <input
              id="reel-video-input-replace"
              type="file"
              accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi,.3gp,.qt,.hevc"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickFile(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      )}

      {validationMsg && (
        <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-[12px] text-rose-700">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{validationMsg}</span>
        </div>
      )}
    </div>
  );
};

/* ── Step 3: Final touches (caption + location + audio + visibility) ── */

const Step3Details: React.FC<{
  videoUrl: string | null;
  existingVideoUrl: string | undefined;
  caption: string;
  setCaption: (v: string) => void;
  audio: string;
  setAudio: (v: string) => void;
  locationLabel: string;
  setLocationLabel: (v: string) => void;
  pickedLocation: HomeLocation | null;
  onPickLocation: (loc: HomeLocation) => void;
  onClearLocation: () => void;
  locationFocused: boolean;
  setLocationFocused: (v: boolean) => void;
  locationSuggestions: HomeLocation[];
  locationWrapRef: React.RefObject<HTMLDivElement | null>;
  isPublic: boolean;
  setIsPublic: (v: boolean) => void;
}> = ({
  videoUrl, existingVideoUrl, caption, setCaption, audio, setAudio,
  locationLabel, setLocationLabel, pickedLocation, onPickLocation, onClearLocation,
  locationFocused, setLocationFocused, locationSuggestions, locationWrapRef,
  isPublic, setIsPublic,
}) => {
  const previewSrc = videoUrl ?? existingVideoUrl ?? null;

  return (
    <div className="space-y-5">
      {/* Video preview pinned to the top, centered. */}
      <div className="flex justify-center">
        <div className="relative rounded-2xl overflow-hidden bg-on-surface/[0.06] aspect-[9/16] w-40 sm:w-44 flex-shrink-0">
          {previewSrc ? (
            <video
              src={previewSrc}
              muted
              autoPlay
              loop
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-on-surface/30">
              <Film size={26} />
            </div>
          )}
        </div>
      </div>

      {/* Caption */}
      <section>
        <label className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-2 block">Caption</label>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value.slice(0, 280))}
          placeholder="Write something…"
          rows={3}
          className="w-full p-3 rounded-2xl bg-on-surface/[0.04] focus:bg-on-surface/[0.06] outline-none text-sm resize-none"
        />
        <div className="text-right text-[11px] text-on-surface/40 mt-1">{caption.length}/280</div>
      </section>

      {/* Location */}
      <section>
        <label className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-2 block">Location</label>
        <div ref={locationWrapRef} className="relative">
          <div className="flex items-center gap-2 h-11 rounded-full bg-on-surface/[0.05] focus-within:bg-on-surface/[0.08] px-3 transition-colors">
            <MapPin size={15} className="text-on-surface/45 flex-shrink-0" />
            <input
              type="text"
              value={locationLabel}
              onChange={(e) => setLocationLabel(e.target.value)}
              onFocus={() => setLocationFocused(true)}
              placeholder="Add a location"
              className="flex-1 bg-transparent outline-none text-sm min-w-0"
            />
            {locationLabel && (
              <button
                type="button"
                onClick={onClearLocation}
                className="text-on-surface/40 hover:text-on-surface/70 flex-shrink-0"
                aria-label="Clear location"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <AnimatePresence>
            {locationFocused && locationSuggestions.length > 0 && (
              <motion.ul
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full left-0 right-0 mt-1.5 rounded-2xl bg-white border border-on-surface/[0.08] shadow-[0_12px_28px_-10px_rgba(0,0,0,0.18)] overflow-hidden z-10 max-h-64 overflow-y-auto"
              >
                {locationSuggestions.map((loc) => (
                  <li key={`${loc.label}-${loc.lat}-${loc.lng}`}>
                    <button
                      type="button"
                      onClick={() => onPickLocation(loc)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-on-surface/[0.03] transition-colors"
                    >
                      <MapPin size={13} className="text-on-surface/35 flex-shrink-0" />
                      <span className="text-[13px] truncate">{loc.label}</span>
                    </button>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* Audio */}
      <section>
        <label className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-2 block">Audio</label>
        <div className="flex items-center gap-2 h-11 rounded-full bg-on-surface/[0.05] focus-within:bg-on-surface/[0.08] px-3 transition-colors">
          <Music2 size={15} className="text-on-surface/45 flex-shrink-0" />
          <input
            type="text"
            value={audio}
            onChange={(e) => setAudio(e.target.value.slice(0, 60))}
            placeholder="Original audio"
            className="flex-1 bg-transparent outline-none text-sm min-w-0"
          />
        </div>
      </section>

      {/* Visibility */}
      <section>
        <label className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-2 block">Who can see this?</label>
        <div className="grid grid-cols-2 gap-2">
          {([
            { value: true, icon: Globe, label: 'Public', sub: 'Anyone can see this' },
            { value: false, icon: UsersIcon, label: 'Followers', sub: 'Only people who follow you' },
          ] as const).map((opt) => {
            const active = isPublic === opt.value;
            const Icon = opt.icon;
            return (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => setIsPublic(opt.value)}
                className={cn(
                  'rounded-2xl border px-3 py-3 text-left transition-all',
                  active
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                    : 'border-on-surface/[0.08] bg-white hover:border-on-surface/15',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon size={14} className={active ? 'text-primary' : 'text-on-surface/55'} />
                  <span className="text-[13px] font-bold">{opt.label}</span>
                </div>
                <p className="text-[11px] text-on-surface/55 leading-snug">{opt.sub}</p>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};

/* ── Picked-pill chip used by step 1 for the featured item ──────────── */

const PickedPill: React.FC<{ name: string; meta: string; image?: string; onClear: () => void; disabled?: boolean }> = ({ name, meta, image, onClear, disabled }) => (
  <div className="flex items-center gap-3 rounded-2xl bg-primary/[0.06] border border-primary/15 px-3 py-2.5">
    <div className="w-10 h-10 rounded-xl overflow-hidden bg-on-surface/[0.06] flex-shrink-0 flex items-center justify-center">
      {image && !image.startsWith('data:') ? (
        <img src={image} alt="" loading="lazy" decoding="async"
          className="w-full h-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <Check size={14} className="text-primary" />
      )}
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-sm font-bold truncate">{name}</p>
      <p className="text-[11px] text-on-surface/55 truncate">{meta}</p>
    </div>
    <button
      type="button"
      onClick={onClear}
      disabled={disabled}
      className="text-[11px] font-semibold text-on-surface/55 hover:text-on-surface px-2 h-8 rounded-full hover:bg-on-surface/[0.05] disabled:opacity-40"
    >
      Change
    </button>
  </div>
);
