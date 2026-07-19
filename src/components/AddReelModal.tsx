/**
 * AddReelModal — three-step flow.
 *
 *   Step 1: pick reel type (restaurant / recipe) and the featured item.
 *   Step 2: upload the video (skipped in edit mode — video is locked).
 *   Step 3: caption, location, visibility — with a preview of
 *           the video pinned to the top so the user sees what they're
 *           captioning.
 *
 * Animations: horizontal slide between steps using motion's direction
 * variant. The picker dropdown in step 1 collapses/expands smoothly,
 * and step 2's drop zone cross-fades into the preview once a file is
 * accepted.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  X, Film, ChefHat, MapPin, Search, Check, Upload, AlertCircle,
  Loader2, Globe, Users as UsersIcon, Star, ChevronLeft, ChevronRight,
  Image as ImageIcon, Trash2, Music2, Video as VideoIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useBottomSheet } from '../lib/useBottomSheet';
import {
  useReels,
  readVideoDuration,
  REEL_MAX_DURATION_SECONDS,
  type ReelKind,
} from '../contexts/ReelsContext';
import {
  MediaEditor,
  EditorStage,
  EditorControls,
  applyAllEdits,
  DEFAULT_EDIT_STATE,
  isEdited,
  type EditState,
  type EditorTab,
} from './MediaEditor';
import { DraggableSheet } from './DraggableSheet';
import { useLists } from '../contexts/ListsContext';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { searchPlacesByText, priceLevelToString, CUISINE_TYPES, type PlaceResult } from '../lib/places';
import { searchLocations, type HomeLocation } from './HomeLocationBar';
import { PhotoLibrary, canUseNativePhotoLibrary, nativePathToFile, type MediaItem } from '../lib/native-photos';
import { PhotoLibraryGrid } from './PhotoLibraryGrid';
import { ModalFloatingNav } from './ModalFloatingNav';

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

type Step = 1 | 2 | 3 | 4;

/* ── Modal ──────────────────────────────────────────────────────────── */

export const AddReelModal: React.FC = () => {
  const { addReelModalOpen, addReelInitialKind, editingReelId, closeAddReelModal, postReel, updateReel, setReelVisibility, reels, consumePendingReelVideo } = useReels();
  const editingReel = editingReelId ? reels.find((r) => r.id === editingReelId) ?? null : null;
  const isEditing = !!editingReel;
  const { ratings, wishlist, restaurantMeta, homeMeals } = useLists();
  const { user } = useAuth();
  const { phoneMode } = useSettings();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const { dragProps } = useBottomSheet(addReelModalOpen && !phoneMode, closeAddReelModal);

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
  const [videoEdits, setVideoEdits] = useState<EditState>(DEFAULT_EDIT_STATE);
  // On native iOS: the user's currently-selected camera-roll MediaItem
  // before they've pressed Next. We don't materialize it (getMedia +
  // file copy) until Next is pressed so tapping a thumb feels instant
  // and the user can change their mind without re-reading the file.
  const [nativePick, setNativePick] = useState<MediaItem | null>(null);
  // True while Next is materializing the native pick into a File.
  const [nativeMaterializing, setNativeMaterializing] = useState(false);
  // Set true while we re-encode the video with the chosen edits on
  // submission so the user sees a "Finishing edits" status separately
  // from the upload progress.
  const [finalizingEdits, setFinalizingEdits] = useState(false);
  const [caption, setCaption] = useState('');
  const [audio, setAudio] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [pickedLocation, setPickedLocation] = useState<HomeLocation | null>(null);
  const [isPublic, setIsPublic] = useState(true);
  // ── Phone composer state — mirrors AddPostModal's canvas + sheet. ──
  // Edit-step tab + text-overlay selection live here so the canvas can
  // make the matching overlay interactive; `stageNatural` feeds the
  // crop controls.
  const [editTab, setEditTab] = useState<EditorTab>('trim');
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [stageNatural, setStageNatural] = useState<{ w: number; h: number } | undefined>(undefined);
  // Canvas space reserved behind the sheet's settled position.
  const [sheetReserve, setSheetReserve] = useState(360);
  // Set after a successful share — drives the success overlay.
  const [sharedReel, setSharedReel] = useState<{ id: string } | null>(null);
  const [pickedRestaurantId, setPickedRestaurantId] = useState<string | null>(null);
  const [pickedRecipeId, setPickedRecipeId] = useState<string | null>(null);
  const [restaurantSearch, setRestaurantSearch] = useState('');
  const [recipeSearch, setRecipeSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // In-flight Mux upload — lets the close button double as Cancel while a
  // create upload runs (abort → createReel rolls the row back).
  const uploadAbortRef = useRef<AbortController | null>(null);
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
      setVideoEdits(DEFAULT_EDIT_STATE);
      setCaption(editingReel.caption);
      setLocationLabel(editingReel.locationLabel || '');
      setPickedLocation(editingReel.locationLabel ? { label: editingReel.locationLabel, lat: 0, lng: 0 } : null);
      setIsPublic(editingReel.isPublic);
      setPickedRestaurantId(editingReel.restaurant?.id ?? null);
      setPickedRecipeId(editingReel.recipe?.id ?? null);
      // Skip the video + edit steps in edit mode — media is immutable.
      setStep(4);
    } else {
      setKind(addReelInitialKind ?? 'restaurant');
      setVideoFile(null);
      setVideoUrl(null);
      setVideoDuration(null);
      setVideoEdits(DEFAULT_EDIT_STATE);
      setNativePick(null);
      setNativeMaterializing(false);
      setCaption('');
      setLocationLabel('');
      setPickedLocation(null);
      setIsPublic(true);
      setPickedRestaurantId(null);
      setPickedRecipeId(null);
      setStep(1);
    }
    setAudio('');
    setSharedReel(null);
    setEditTab('trim');
    setSelectedTextId(null);
    setStageNatural(undefined);
    setFinalizingEdits(false);
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

  // On phone, auto-open the OS picker the first time the video step
  // mounts so the user lands on the camera roll without a second tap.
  // The "Create reel" tap that opened the modal preserves the user
  // gesture context for ~100ms on iOS / Android Chrome, which is
  // usually long enough to programmatically click the file input. We
  // only fire when no video is chosen yet so going back to the video
  // step to replace doesn't re-open the picker automatically.
  const autoOpenedRef = useRef(false);

  // Consume a video handed off from the Create page's embedded surface —
  // it runs through the normal intake (probe + duration validation), and
  // the auto-opened OS picker is suppressed so it doesn't pop over it.
  const pendingConsumedRef = useRef(false);
  useEffect(() => {
    if (!addReelModalOpen) { pendingConsumedRef.current = false; return; }
    if (pendingConsumedRef.current) return;
    pendingConsumedRef.current = true;
    const file = consumePendingReelVideo();
    if (file) {
      autoOpenedRef.current = true;
      void onPickFile(file);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addReelModalOpen]);

  useEffect(() => {
    if (!addReelModalOpen) { autoOpenedRef.current = false; return; }
    if (step !== 1 || videoUrl || autoOpenedRef.current) return;
    // On native iOS the page renders an inline PhotoLibraryGrid instead of
    // the dashed placeholder — auto-opening the OS picker would be a
    // double UI and immediately steal focus from the grid.
    if (canUseNativePhotoLibrary()) { autoOpenedRef.current = true; return; }
    autoOpenedRef.current = true;
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
    if (!addReelModalOpen || step !== 3 || kind !== 'restaurant') return;
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

  // Debounced location search — runs while the user is typing on step 4.
  useEffect(() => {
    if (!addReelModalOpen || step !== 4) return;
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
    // Reset any prior edits for the new video so the editor opens
    // with a clean slate.
    setVideoEdits(DEFAULT_EDIT_STATE);
    // Drag-drop / web file-input picks now also wait for the user to
    // tap Next, matching the inline native-grid behaviour.
  };

  const clearVideo = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(null);
    setVideoUrl(null);
    setVideoDuration(null);
    setNativePick(null);
    setValidationMsg(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Run on Next-button tap when the user has tapped a thumbnail in the
  // native grid but hasn't materialized it yet. Returns true on success
  // so the caller can advance to step 2.
  const materializeNativePick = async (): Promise<boolean> => {
    if (!nativePick) return false;
    setNativeMaterializing(true);
    try {
      const { path, mimeType } = await PhotoLibrary.getMedia({ id: nativePick.id });
      const ext = mimeType.split('/')[1] || 'mov';
      const file = await nativePathToFile(path, `reel-${nativePick.id}.${ext}`, mimeType);
      await onPickFile(file);
      return true;
    } catch (err) {
      console.warn('[AddReel] native materialize failed:', err);
      setValidationMsg("Couldn't load that video — try another.");
      return false;
    } finally {
      setNativeMaterializing(false);
    }
  };

  // Camera-capture handler for the in-grid Camera tile.
  const onCameraTap = async () => {
    try {
      const res = await PhotoLibrary.pickCamera({ mediaType: 'video' });
      if (res.cancelled || !res.path || !res.mimeType) return;
      const ext = res.mimeType.split('/')[1] || 'mov';
      const file = await nativePathToFile(res.path, `reel-camera-${Date.now()}.${ext}`, res.mimeType);
      setNativePick(null); // captured video replaces any staged grid pick
      await onPickFile(file);
    } catch (err) {
      console.warn('[AddReel] camera failed:', err);
      setValidationMsg("Couldn't open the camera. Check camera permission in Settings.");
    }
  };

  // ── Step gates ──
  const hasFeatured = kind === 'restaurant' ? !!pickedRestaurant : !!pickedRecipe;
  // Step gates:
  //   1 (video)   → needs a chosen file OR a staged native pick
  //   2 (edit)    → always passes (editing is optional)
  //   3 (featured)→ needs a picked restaurant or recipe
  const canAdvanceFromStep1 = (!!videoFile && !!videoUrl) || !!nativePick;
  const canAdvanceFromStep2 = true;
  const canAdvanceFromStep3 = hasFeatured;
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
      // Bake the user's edits (crop / trim / colour / filter) into a
      // new video file before uploading. Skipped when no edits were
      // touched — applyAllEdits returns an empty record in that case.
      let fileToUpload: File = videoFile;
      let durationToUpload: number = videoDuration ?? 0;
      if (videoUrl && isEdited(videoEdits, videoDuration)) {
        setFinalizingEdits(true);
        try {
          const edited = await applyAllEdits([{
            key: 'reel-video',
            mediaType: 'video',
            file: videoFile,
            previewUrl: videoUrl,
            durationSeconds: videoDuration,
            edits: videoEdits,
          }], undefined, () => showToast('Audio couldn’t be kept', {
            subtitle: 'This device dropped sound from the edited video',
          }));
          if (edited['reel-video']) {
            fileToUpload = edited['reel-video'];
            // Re-derive the duration from the trim window so the reel
            // metadata matches the edited file.
            if (videoEdits.trim) {
              durationToUpload = Math.max(0, videoEdits.trim.end - videoEdits.trim.start);
            }
          }
        } finally {
          setFinalizingEdits(false);
        }
      }
      const bgGradient = pickFromPool(BG_GRADIENT_POOL, fileToUpload.name + user.id);
      const att = buildAttachment();
      const controller = new AbortController();
      uploadAbortRef.current = controller;
      const reel = await postReel({
        file: fileToUpload, kind,
        caption: caption.trim(),
        audioLabel: audio.trim() || 'Original audio',
        locationLabel: resolvedLocationLabel,
        bgGradient,
        durationSeconds: durationToUpload,
        isPublic,
        restaurant: att.restaurant, recipe: att.recipe,
        onProgress: (n) => setProgress(n),
        signal: controller.signal,
      });
      if (!reel) throw new Error("Couldn't create the reel — try again.");
      if (phoneMode) {
        // The composer's animated success overlay takes it from here.
        setSharedReel({ id: reel.id });
      } else {
        showToast('Reel posted', { subtitle: "It's live in the feed" });
        closeAddReelModal();
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        // User tapped Cancel — createReel already rolled the row back.
        showToast('Upload cancelled');
        setProgress(0);
      } else {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setErrorMsg(msg);
        setProgress(0);
      }
    } finally {
      uploadAbortRef.current = null;
      setSubmitting(false);
    }
  };

  // Abort the in-flight Mux upload (Share step's Cancel affordance).
  const cancelUpload = () => uploadAbortRef.current?.abort();

  // ── Step variants for the slide animation ──
  const stepVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? 32 : -32, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -32 : 32, opacity: 0 }),
  };

  // ── Phone composer derivations — mirrors AddPostModal's layout. ──
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const phoneSheetH = Math.round(
    step === 1 ? Math.min(Math.max(winH * 0.46, 320), 480)
    : step === 2 ? Math.min(Math.max(winH * 0.52, 380), 540)
    : step === 3 ? Math.min(Math.max(winH * 0.55, 400), 560)
    : Math.min(Math.max(winH * 0.58, 430), 600),
  );
  const phoneSheetMax = winH - 108;

  const phoneTitle = isEditing
    ? 'Edit reel'
    : step === 1 ? 'New reel' : step === 2 ? 'Edit' : step === 3 ? 'Featured' : 'Details';
  const phoneDotSteps: Step[] = isEditing ? [4] : [1, 2, 3, 4];
  const canJumpTo = (s: Step) => (isEditing ? s === 4 : s === 1 || !!videoUrl);

  const phonePrimary =
    step === 1 ? {
      label: nativeMaterializing ? (
        <><Loader2 size={14} className="animate-spin" /> Loading…</>
      ) : (
        <>Next <ChevronRight size={13} strokeWidth={2.8} /></>
      ),
      onClick: () => {
        if (nativeMaterializing) return;
        if (videoFile && videoUrl && !nativePick) { goToStep(2); return; }
        if (nativePick) void materializeNativePick().then((ok) => { if (ok) goToStep(2); });
      },
      disabled: !canAdvanceFromStep1 || nativeMaterializing,
    }
    : step === 2 ? {
      label: <>Next <ChevronRight size={13} strokeWidth={2.8} /></>,
      onClick: () => goToStep(3),
      disabled: false,
    }
    : step === 3 ? {
      label: <>Next <ChevronRight size={13} strokeWidth={2.8} /></>,
      onClick: () => goToStep(4),
      disabled: !canAdvanceFromStep3,
    }
    : {
      label: submitting ? (
        <><Loader2 size={14} className="animate-spin" /> {isEditing ? 'Saving…' : finalizingEdits ? 'Finishing…' : `Uploading ${Math.round(progress * 100)}%`}</>
      ) : (
        <>{isEditing ? 'Save changes' : 'Share'} <ChevronRight size={14} strokeWidth={2.6} /></>
      ),
      onClick: onSubmit,
      disabled: !canSubmit,
    };

  // The canvas item — the picked video with its live edits.
  const stageItem = videoFile && videoUrl ? {
    key: 'reel-video',
    mediaType: 'video' as const,
    file: videoFile,
    previewUrl: videoUrl,
    durationSeconds: videoDuration,
    edits: videoEdits,
  } : null;

  // "Create another" from the success overlay — back to a clean slate.
  const resetForCreate = () => {
    clearVideo();
    setVideoEdits(DEFAULT_EDIT_STATE);
    setCaption('');
    setAudio('');
    setLocationLabel('');
    setPickedLocation(null);
    setIsPublic(true);
    setPickedRestaurantId(null);
    setPickedRecipeId(null);
    setEditTab('trim');
    setSelectedTextId(null);
    setStageNatural(undefined);
    setErrorMsg(null);
    setSharedReel(null);
    setDirection(-1);
    setStep(1);
  };

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
          {phoneMode ? (

          /* ═════════ Phone composer ═════════
             Same design as the post composer: full-screen dark canvas
             with the step content in a draggable bottom sheet. */
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full h-full bg-[#16120e] text-white flex flex-col overflow-hidden"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi,.3gp,.qt,.hevc"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPickFile(f);
                e.target.value = '';
              }}
            />

            {/* ── Header ── */}
            <div className="pt-safe-4 px-4 pb-2.5 flex items-center relative flex-shrink-0 z-10">
              <button
                type="button"
                onClick={() => {
                  // While a create upload runs, this doubles as Cancel —
                  // aborts the Mux PUT; createReel rolls the row back.
                  if (submitting) { if (!isEditing) cancelUpload(); return; }
                  if (step > 1 && !isEditing && !sharedReel) goToStep((step - 1) as Step);
                  else closeAddReelModal();
                }}
                disabled={submitting && isEditing}
                className="w-9 h-9 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white disabled:opacity-40 flex-shrink-0 transition-colors"
                aria-label={submitting && !isEditing ? 'Cancel upload' : step > 1 && !isEditing && !sharedReel ? 'Back' : 'Close'}
              >
                {step > 1 && !isEditing && !sharedReel && !submitting ? <ChevronLeft size={17} strokeWidth={2.4} /> : <X size={16} strokeWidth={2.4} />}
              </button>

              {/* Centered title + step dots */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 mt-[calc(env(safe-area-inset-top,0px)/2)] flex flex-col items-center gap-[5px]">
                <h2 className="font-serif font-bold text-[17px] leading-none whitespace-nowrap">
                  {sharedReel ? 'Reel shared' : phoneTitle}
                </h2>
                <div className="flex gap-1">
                  {phoneDotSteps.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { if (!submitting && !sharedReel && canJumpTo(s)) goToStep(s); }}
                      className={cn(
                        'w-[16px] h-[3px] rounded-full transition-colors',
                        s === step ? 'bg-primary' : s < step ? 'bg-primary/60' : 'bg-white/25',
                      )}
                      aria-label={`Go to step ${s}`}
                    />
                  ))}
                </div>
              </div>

              {!sharedReel && (
                <button
                  type="button"
                  onClick={phonePrimary.onClick}
                  disabled={phonePrimary.disabled}
                  className="ml-auto h-9 pl-4 pr-3.5 rounded-full bg-surface text-on-surface inline-flex items-center gap-1 text-[13px] font-bold active:scale-95 transition-transform disabled:opacity-35"
                >
                  {phonePrimary.label}
                </button>
              )}
            </div>

            {/* ── Video canvas ── */}
            <div className="flex-1 min-h-0 relative">
              {stageItem ? (
                <>
                  <motion.div
                    key={stageItem.key}
                    initial={{ opacity: 0.35, scale: 0.99 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className="absolute inset-x-3 top-0.5 bottom-2"
                  >
                    <EditorStage
                      item={stageItem}
                      tab={step === 2 ? editTab : null}
                      selectedTextId={selectedTextId}
                      onSelectText={(id) => setSelectedTextId(id)}
                      onEditsChange={step === 2 ? (edits) => setVideoEdits(edits) : undefined}
                      onNatural={(size) => setStageNatural(size)}
                    />
                  </motion.div>
                  {videoDuration != null && step !== 2 && (
                    <div className="absolute left-5 bottom-4 rounded-full bg-black/60 backdrop-blur px-2.5 py-1 text-[11px] font-bold text-white pointer-events-none z-10">
                      {videoDuration.toFixed(0)}s
                    </div>
                  )}
                  {step === 3 && hasFeatured && (
                    <div className="absolute left-5 top-2 inline-flex items-center gap-1.5 rounded-full bg-primary text-white px-2.5 py-1 text-[10.5px] font-bold shadow-lg pointer-events-none z-10">
                      {kind === 'restaurant' ? <MapPin size={10} /> : <ChefHat size={10} />}
                      <span className="max-w-[180px] truncate">
                        {kind === 'restaurant' ? pickedRestaurant?.name : pickedRecipe?.title}
                      </span>
                    </div>
                  )}
                </>
              ) : isEditing && editingReel?.videoUrl ? (
                /* Edit mode — media is locked; preview the existing reel. */
                <div className="absolute inset-x-3 top-0.5 bottom-2">
                  <video
                    src={editingReel.videoUrl}
                    muted
                    autoPlay
                    loop
                    playsInline
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : nativePick?.thumbnailDataUrl ? (
                /* Staged camera-roll pick — instant low-res preview. */
                <motion.div
                  key={nativePick.id}
                  initial={{ opacity: 0.4, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-x-3 top-0.5 bottom-2"
                >
                  <img src={nativePick.thumbnailDataUrl} alt="" className="w-full h-full object-contain" />
                </motion.div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center px-10 text-center">
                  <div className="flex items-center gap-2.5 text-white/40">
                    <Film size={26} />
                    <VideoIcon size={26} />
                  </div>
                  <p className="text-[14px] font-semibold text-white/75 mt-3">
                    {canUseNativePhotoLibrary() ? 'Pick a video from your camera roll below' : 'Add a video'}
                  </p>
                  <p className="text-[12px] text-white/40 mt-1 leading-relaxed">
                    Vertical works best · up to {REEL_MAX_DURATION_SECONDS}s
                  </p>
                  {!canUseNativePhotoLibrary() && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-4 h-10 px-5 rounded-full bg-surface text-on-surface text-[13px] font-bold active:scale-95 transition-transform"
                    >
                      Open camera roll
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Space reserved behind the resting sheet — the sheet itself
                is an overlay, so dragging it never reflows the canvas. */}
            <div
              className="flex-shrink-0 transition-[height] duration-[400ms]"
              style={{ height: sheetReserve, transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)' }}
            />

            {/* ── Bottom sheet ── */}
            <DraggableSheet
              height={phoneSheetH}
              minHeight={92}
              maxHeight={phoneSheetMax}
              draggable={!sharedReel}
              fit={step !== 1}
              resetKey={step}
              onReserveChange={setSheetReserve}
              className="z-20 bg-surface text-on-surface shadow-[0_-10px_40px_rgba(0,0,0,0.35)]"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                  className="px-5 pt-1"
                  // Clears the home indicator, and lifts the fields above
                  // the native keyboard when it opens (--kb-height).
                  style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom, 0px), calc(var(--kb-height, 0px) + 0.75rem))' }}
                >
                  {/* ── STEP 1 · Camera roll ── */}
                  {step === 1 && !isEditing && (
                    <div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/40">Recents</span>
                        <span className="text-[12px] font-semibold text-on-surface/45">
                          Videos · up to {REEL_MAX_DURATION_SECONDS}s
                        </span>
                      </div>

                      {canUseNativePhotoLibrary() ? (
                        /* Native camera roll — auto-loaded, single-select;
                           drag the sheet up for the full-screen gallery. */
                        <div className="-mx-5 mt-2">
                          <PhotoLibraryGrid
                            mediaType="video"
                            onSelect={(item) => {
                              if (nativePick?.id === item.id) { setNativePick(null); return; }
                              if (videoUrl) clearVideo();
                              setNativePick(item);
                            }}
                            selectedIds={nativePick ? [nativePick.id] : []}
                            selectionMode="single"
                            onCameraTap={() => { void onCameraTap(); }}
                          />
                        </div>
                      ) : videoUrl ? (
                        /* Web — a video is picked; offer replace/remove. */
                        <div className="flex items-center gap-2 mt-3">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-full bg-on-surface/[0.05] active:bg-on-surface/10 text-[12.5px] font-bold text-on-surface/70 transition-colors"
                          >
                            <ImageIcon size={13} /> Replace
                          </button>
                          <button
                            type="button"
                            onClick={clearVideo}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-full bg-on-surface/[0.05] active:bg-on-surface/10 text-[12.5px] font-bold text-on-surface/70 transition-colors"
                          >
                            <Trash2 size={13} /> Remove
                          </button>
                        </div>
                      ) : (
                        /* Web fallback — the OS picker is the camera roll. */
                        <div className="grid grid-cols-3 gap-1.5 mt-3">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="aspect-square rounded-[10px] border-[1.5px] border-dashed border-on-surface/20 flex flex-col items-center justify-center gap-1 text-on-surface/45 active:bg-on-surface/[0.04] transition-colors"
                          >
                            <Film size={17} strokeWidth={2.2} />
                            <span className="text-[10.5px] font-bold uppercase tracking-wider">Add</span>
                          </button>
                        </div>
                      )}

                      {validationMsg && (
                        <div className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-[12px] text-rose-700">
                          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                          <span>{validationMsg}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── STEP 2 · Edit ── */}
                  {step === 2 && !isEditing && stageItem && (
                    <div>
                      <div className="flex items-baseline justify-between mb-3.5">
                        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/40">
                          Your video
                        </span>
                        {isEdited(videoEdits, videoDuration) && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                            <Check size={10} /> Edited
                          </span>
                        )}
                      </div>
                      <EditorControls
                        item={stageItem}
                        tab={editTab}
                        onTabChange={setEditTab}
                        onEditsChange={setVideoEdits}
                        selectedTextId={selectedTextId}
                        onSelectTextId={setSelectedTextId}
                        natural={stageNatural}
                      />
                    </div>
                  )}

                  {/* ── STEP 3 · Type + featured ── */}
                  {step === 3 && !isEditing && (
                    <StepFeatured
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

                  {/* ── STEP 4 · Details ── */}
                  {step === 4 && (
                    <div className="space-y-4">
                      <section>
                        <textarea
                          value={caption}
                          onChange={(e) => setCaption(e.target.value.slice(0, 280))}
                          placeholder="Write a caption…"
                          rows={3}
                          disabled={submitting}
                          className="w-full rounded-2xl bg-white border-[1.5px] border-on-surface/[0.08] px-3.5 py-3 text-[14px] leading-relaxed placeholder:text-on-surface/35 focus:outline-none focus:border-primary/50 focus:shadow-[0_0_0_3px_rgba(159,48,18,0.07)] resize-none disabled:opacity-50 transition-all"
                        />
                        <div className="text-right text-[11px] font-semibold text-on-surface/35 mt-1 tabular-nums">{caption.length} / 280</div>
                      </section>

                      {/* Location — pick a suggestion to attach it. */}
                      <section ref={locationWrapRef} className="relative">
                        <div className="flex items-baseline justify-between mb-2">
                          <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface/45">Location</label>
                          {pickedLocation && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                              <Check size={10} /> Selected
                            </span>
                          )}
                        </div>
                        <div className={cn(
                          'flex items-center gap-2 rounded-full bg-on-surface/[0.04] border px-4 h-11 transition-colors',
                          pickedLocation ? 'border-emerald-200 bg-emerald-50/40' : 'border-on-surface/[0.06]',
                        )}>
                          <MapPin size={15} className={cn('flex-shrink-0', pickedLocation ? 'text-emerald-600' : 'text-on-surface/45')} />
                          <input
                            value={locationLabel}
                            onChange={(e) => {
                              setLocationLabel(e.target.value);
                              if (pickedLocation) setPickedLocation(null);
                            }}
                            onFocus={() => setLocationFocused(true)}
                            placeholder="Search a city, neighborhood, or country…"
                            disabled={submitting}
                            maxLength={100}
                            className="flex-1 bg-transparent text-sm placeholder:text-on-surface/35 focus:outline-none disabled:opacity-50"
                          />
                          {locationLabel && !submitting && (
                            <button
                              type="button"
                              onClick={() => { setLocationLabel(''); setPickedLocation(null); setLocationSuggestions([]); }}
                              className="hit-44 w-6 h-6 rounded-full bg-on-surface/[0.08] active:bg-on-surface/[0.15] flex items-center justify-center text-on-surface/55 flex-shrink-0"
                              aria-label="Clear location"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                        <AnimatePresence>
                          {locationFocused && !pickedLocation && locationSuggestions.length > 0 && (
                            <motion.div
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              transition={{ duration: 0.12 }}
                              className="absolute z-30 left-0 right-0 mt-1 rounded-2xl bg-surface border border-on-surface/[0.08] shadow-xl overflow-hidden"
                            >
                              <ul className="max-h-[260px] overflow-y-auto">
                                {locationSuggestions.map((s, idx) => (
                                  <li key={`${s.label}-${idx}`}>
                                    <button
                                      type="button"
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => {
                                        setPickedLocation(s);
                                        setLocationLabel(s.label);
                                        setLocationSuggestions([]);
                                        setLocationFocused(false);
                                      }}
                                      className="w-full flex items-start gap-3 px-3 py-2.5 active:bg-on-surface/[0.05] text-left"
                                    >
                                      <MapPin size={14} className="text-on-surface/40 flex-shrink-0 mt-0.5" />
                                      <span className="min-w-0 flex-1 text-sm text-on-surface truncate">{s.label}</span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </section>

                      <section>
                        <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface/45 mb-2">Audio</label>
                        <div className="flex items-center gap-2 rounded-full bg-on-surface/[0.04] border border-on-surface/[0.06] px-4 h-11">
                          <Music2 size={15} className="text-on-surface/45 flex-shrink-0" />
                          <input
                            value={audio}
                            onChange={(e) => setAudio(e.target.value)}
                            placeholder="Original audio"
                            disabled={submitting}
                            maxLength={60}
                            className="flex-1 bg-transparent text-sm placeholder:text-on-surface/35 focus:outline-none disabled:opacity-50"
                          />
                        </div>
                      </section>

                      <section>
                        <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface/45 mb-2">Visibility</label>
                        <div className="flex gap-2">
                          {([
                            { value: true, label: 'Public', sub: 'Anyone on Gourmet Canvas' },
                            { value: false, label: 'Followers only', sub: 'Only people who follow you' },
                          ] as const).map((opt) => {
                            const active = isPublic === opt.value;
                            return (
                              <button
                                key={opt.label}
                                type="button"
                                onClick={() => setIsPublic(opt.value)}
                                disabled={submitting}
                                className={cn(
                                  'flex-1 min-w-0 flex flex-col gap-0.5 rounded-2xl border-[1.5px] px-3.5 py-3 text-left transition-all disabled:opacity-40',
                                  active
                                    ? 'border-primary bg-white shadow-[0_0_0_3px_rgba(159,48,18,0.08)]'
                                    : 'border-on-surface/[0.09]',
                                )}
                              >
                                <span className={cn('text-[13px] font-bold leading-tight', active ? 'text-on-surface' : 'text-on-surface/65')}>{opt.label}</span>
                                <span className="text-[11.5px] text-on-surface/45 leading-snug">{opt.sub}</span>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    </div>
                  )}

                  {/* Notices — sign-in gate + submit errors, every step. */}
                  {(!user?.id || errorMsg) && !sharedReel && (
                    <div className="mt-3.5 space-y-2">
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
                </motion.div>
              </AnimatePresence>
            </DraggableSheet>

            {/* ── Success overlay ── */}
            <AnimatePresence>
              {sharedReel && (
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="absolute inset-0 z-40 bg-surface text-on-surface flex flex-col items-center justify-center"
                >
                  <motion.div
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', damping: 13, stiffness: 240, delay: 0.05 }}
                    className="w-[76px] h-[76px] rounded-full bg-primary flex items-center justify-center"
                  >
                    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <motion.path
                        d="M5 13l5 5L20 7"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ delay: 0.28, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </svg>
                  </motion.div>
                  <motion.h3
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.3 }}
                    className="font-serif font-bold text-[26px] mt-6"
                  >
                    Your reel is live
                  </motion.h3>
                  <motion.p
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.28, duration: 0.3 }}
                    className="text-[13.5px] text-on-surface/50 mt-2"
                  >
                    {isPublic ? "Shared publicly — it's in the feed now" : 'Shared with your followers'}
                  </motion.p>
                  <motion.div
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.36, duration: 0.3 }}
                    className="flex items-center gap-2.5 mt-7"
                  >
                    <button
                      type="button"
                      onClick={resetForCreate}
                      className="h-[42px] px-5 rounded-full border-[1.5px] border-on-surface/15 text-[13.5px] font-bold text-on-surface/70 active:bg-on-surface/[0.05] transition-colors"
                    >
                      Create another
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const id = sharedReel.id;
                        closeAddReelModal();
                        navigate(`/r/reel-${id}`);
                      }}
                      className="h-[42px] px-6 rounded-full bg-on-surface text-surface text-[13.5px] font-bold active:opacity-90 transition-opacity"
                    >
                      View reel
                    </button>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
          ) : (

          /* ═════════ Desktop card ═════════ */
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            {...dragProps}
            onClick={(e) => e.stopPropagation()}
            className="relative bg-surface w-full overflow-hidden flex flex-col h-full sm:max-w-xl sm:max-h-[92vh] sm:h-[92vh] rounded-none sm:rounded-3xl"
          >
            {/* Header */}
            <div className="px-5 pt-safe-4 pb-3 flex items-center gap-3 border-b border-on-surface/[0.06] flex-shrink-0">
              {/* Close — back lives in the floating action bar now. While a
                  create upload is in flight it doubles as Cancel: aborts the
                  Mux PUT and createReel rolls the just-inserted row back. */}
              <button
                type="button"
                onClick={() => {
                  if (submitting) { if (!isEditing) cancelUpload(); return; }
                  closeAddReelModal();
                }}
                disabled={submitting && isEditing}
                className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center text-on-surface/70 transition-colors disabled:opacity-40 flex-shrink-0"
                aria-label={submitting && !isEditing ? 'Cancel upload' : 'Close'}
              >
                <X size={18} />
              </button>
              <div className="flex-1 min-w-0">
                <h2 className="font-serif font-bold text-lg leading-tight truncate">
                  {isEditing ? 'Edit reel' : (
                    step === 1 ? 'Upload your video' :
                    step === 2 ? 'Edit your video' :
                    step === 3 ? "What's your reel?" :
                    'Final touches'
                  )}
                </h2>
                {!isEditing && (
                  <p className="text-[12px] text-on-surface/45 mt-0.5 truncate">
                    {step === 1 && `Up to ${REEL_MAX_DURATION_SECONDS}s.`}
                    {step === 2 && 'Crop, trim, adjust, or pick a filter.'}
                    {step === 3 && 'Pick a type and the featured item.'}
                    {step === 4 && 'Add a caption and details.'}
                  </p>
                )}
              </div>
            </div>

            {/* Desktop stepper — full-width progress bar with labelled
                checkpoints, like YouTube's upload flow. Hidden in edit
                mode (single step). */}
            {!isEditing && (
              <DesktopStepper currentStep={step} />
            )}

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
                  className="px-5 pt-5 pb-28"
                >
                  {/* ───────── STEP 1: VIDEO ───────── */}
                  {step === 1 && !isEditing && (
                    <StepVideo
                      videoUrl={videoUrl}
                      videoDuration={videoDuration}
                      validationMsg={validationMsg}
                      onPickFile={onPickFile}
                      onClearVideo={clearVideo}
                      fileInputRef={fileInputRef}
                      nativePick={nativePick}
                      onNativePickChange={setNativePick}
                      onCameraTap={onCameraTap}
                    />
                  )}

                  {/* ───────── STEP 2: EDIT (crop / trim / filters) ─── */}
                  {step === 2 && !isEditing && videoFile && videoUrl && (
                    <MediaEditor
                      items={[{
                        key: 'reel-video',
                        mediaType: 'video',
                        file: videoFile,
                        previewUrl: videoUrl,
                        durationSeconds: videoDuration,
                        edits: videoEdits,
                      }]}
                      activeKey="reel-video"
                      onActiveChange={() => { /* single item */ }}
                      onEditsChange={(_key, next) => setVideoEdits(next)}
                    />
                  )}

                  {/* ───────── STEP 3: TYPE + FEATURED ───────── */}
                  {step === 3 && !isEditing && (
                    <StepFeatured
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

                  {/* ───────── STEP 4: FINAL DETAILS ───────── */}
                  {step === 4 && (
                    <Step3Details
                      videoUrl={videoUrl}
                      existingVideoUrl={editingReel?.videoUrl}
                      caption={caption}
                      setCaption={setCaption}
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

            {/* Floating action bar — compact, dynamic primary + back button,
                floating over the step content instead of a pinned bottom bar. */}
            {(() => {
              let onPrimary: () => void = () => {};
              let primaryDisabled = false;
              let label: React.ReactNode;
              if (step === 4) {
                onPrimary = onSubmit;
                primaryDisabled = !canSubmit;
                label = submitting ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    {isEditing ? 'Saving…' : finalizingEdits ? 'Finishing edits…' : `Uploading… ${Math.round(progress * 100)}%`}
                  </>
                ) : (
                  <>
                    <Upload size={15} />
                    {isEditing ? 'Save changes' : 'Post reel'}
                  </>
                );
              } else if (step === 3) {
                onPrimary = () => goToStep(4);
                primaryDisabled = !canAdvanceFromStep3;
                label = <>Next <ChevronRight size={15} /></>;
              } else if (step === 2) {
                onPrimary = () => goToStep(3);
                label = <>Next <ChevronRight size={15} /></>;
              } else {
                onPrimary = () => {
                  if (videoFile && videoUrl) { goToStep(2); return; }
                  if (nativePick && !nativeMaterializing) {
                    void materializeNativePick().then((ok) => { if (ok) goToStep(2); });
                  }
                };
                primaryDisabled = !canAdvanceFromStep1 || nativeMaterializing;
                label = nativeMaterializing
                  ? <><Loader2 size={15} className="animate-spin" /> Loading…</>
                  : <>Next <ChevronRight size={15} /></>;
              }
              const showBack = step > 1 && !isEditing;
              return (
                <ModalFloatingNav
                  onBack={showBack ? () => { if (!submitting) goToStep((step - 1) as Step); } : undefined}
                  backDisabled={submitting}
                  onPrimary={onPrimary}
                  primaryDisabled={primaryDisabled}
                  progress={submitting && !finalizingEdits ? progress : undefined}
                  notice={(errorMsg || !user?.id) ? (
                    <>
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
                    </>
                  ) : undefined}
                >
                  {label}
                </ModalFloatingNav>
              );
            })()}
          </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ── Step 2: Type + Featured item ─────────────────────────────────────── */

interface RestaurantPickItem {
  id: string; name: string; cuisine: string; price: string;
  address: string; image?: string; score?: number; fromUser: boolean;
}
interface RecipePickItem {
  id: string; title: string; prepTime: number; cookTime: number;
  servings: number; difficulty: 'Easy' | 'Medium' | 'Hard'; image?: string;
}

const StepFeatured: React.FC<{
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
        <p className="font-sans text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-2.5">Type</p>
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
        <p className="font-sans text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-2.5">
          {kind === 'restaurant' ? 'Featured restaurant' : 'Featured recipe'}
        </p>

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
                      You don't have any recipes yet.
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

/* ── Step 1: Video upload ────────────────────────────────────────────── */

const StepVideo: React.FC<{
  videoUrl: string | null;
  videoDuration: number | null;
  validationMsg: string | null;
  onPickFile: (file: File | null) => void;
  onClearVideo: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  nativePick: MediaItem | null;
  onNativePickChange: (item: MediaItem | null) => void;
  onCameraTap: () => void;
}> = ({ videoUrl, videoDuration, validationMsg, onPickFile, onClearVideo, fileInputRef, nativePick, onNativePickChange, onCameraTap }) => {
  // Drag-drop on this step's surface.
  const [dragDepth, setDragDepth] = useState(0);
  const dragActive = dragDepth > 0;
  // On native iOS we render the PhotoLibraryGrid inline. Tapping a thumb
  // just stages it — the heavy getMedia + file copy run when the user
  // presses Next, owned by the parent modal.
  const useNativeGrid = canUseNativePhotoLibrary();
  const onNativeSelect = useCallback((item: MediaItem) => {
    // Single-select with toggle: tapping the same thumb clears it.
    onNativePickChange(nativePick?.id === item.id ? null : item);
  }, [nativePick, onNativePickChange]);
  const selectedIds = nativePick ? [nativePick.id] : [];
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
      {/* Flex-center wrapper — the inner tile is sized by aspect-ratio
          + max-h, which often resolves to less than the parent's full
          width, so we center it horizontally here. */}
      <div className={cn(!videoUrl && useNativeGrid ? '-mx-5' : 'flex items-start justify-center')}>
      <AnimatePresence mode="wait">
        {!videoUrl ? (
          useNativeGrid ? (
            <motion.div
              key="empty-native"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="w-full"
            >
              <p className="text-[12.5px] text-on-surface/55 px-5 pb-3 max-w-[280px] leading-relaxed">
                Pick a vertical video from your camera roll. Up to {REEL_MAX_DURATION_SECONDS}s.
              </p>
              <PhotoLibraryGrid
                mediaType="video"
                onSelect={onNativeSelect}
                selectedIds={selectedIds}
                selectionMode="single"
                onCameraTap={onCameraTap}
                columns={3}
              />
            </motion.div>
          ) : (
          <motion.label
            key="empty"
            htmlFor="reel-video-input"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className={cn(
              'rounded-3xl border-2 border-dashed cursor-pointer transition-all relative overflow-hidden',
              'flex flex-col items-center justify-center text-center',
              'aspect-[9/16] max-h-[60vh] h-[60vh] w-auto max-w-full',
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
          )
        ) : (
          <motion.div
            key="preview"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="relative rounded-3xl overflow-hidden bg-black aspect-[9/16] max-h-[60vh] h-[60vh] w-auto max-w-full"
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
      </div>

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

/* ── Step 3: Final touches (caption + location + visibility) ── */

const Step3Details: React.FC<{
  videoUrl: string | null;
  existingVideoUrl: string | undefined;
  caption: string;
  setCaption: (v: string) => void;
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
  videoUrl, existingVideoUrl, caption, setCaption,
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

/* ── Desktop stepper ──────────────────────────────────────────────────
   Horizontal progress bar with labelled checkpoints. Steps before the
   current one render a primary-filled circle with a check mark and a
   filled connector to the right; the current step is a primary ring
   with a filled dot; upcoming steps are outline-only with a muted
   connector. Mimics YouTube's upload-flow stepper, tuned for our
   three-step reel program. */

const STEPPER_LABELS: { label: string }[] = [
  { label: 'Video' },
  { label: 'Edit' },
  { label: 'Featured' },
  { label: 'Details' },
];

const DesktopStepper: React.FC<{ currentStep: Step }> = ({ currentStep }) => {
  const total = STEPPER_LABELS.length;
  return (
    <div className="border-b border-on-surface/[0.06] px-8 py-2.5 flex-shrink-0 bg-surface">
      <div className="relative flex items-center justify-between gap-2">
        {STEPPER_LABELS.map((entry, i) => {
          const stepNum = (i + 1) as Step;
          const status: 'done' | 'current' | 'upcoming' =
            stepNum < currentStep ? 'done' : stepNum === currentStep ? 'current' : 'upcoming';
          const isLast = i === total - 1;
          const nextDone = stepNum < currentStep;
          return (
            <React.Fragment key={entry.label}>
              <div className="flex items-center gap-2 flex-shrink-0 relative z-10">
                <motion.div
                  className={cn(
                    'w-6 h-6 rounded-full flex items-center justify-center transition-colors',
                    status === 'done' && 'bg-primary text-white',
                    status === 'current' && 'bg-primary text-white ring-[3px] ring-primary/15',
                    status === 'upcoming' && 'bg-on-surface/[0.04] border-2 border-on-surface/15 text-on-surface/35',
                  )}
                  initial={false}
                  animate={status === 'current' ? { scale: 1.04 } : { scale: 1 }}
                  transition={{ type: 'spring', damping: 22, stiffness: 320 }}
                >
                  {status === 'done' ? (
                    <Check size={12} strokeWidth={3} />
                  ) : (
                    <span className="text-[10.5px] font-bold tabular-nums">{stepNum}</span>
                  )}
                </motion.div>
                <span className={cn(
                  'text-[12px] font-bold leading-tight transition-colors whitespace-nowrap',
                  status === 'upcoming' ? 'text-on-surface/40' : 'text-on-surface',
                )}>
                  {entry.label}
                </span>
              </div>
              {!isLast && (
                <div className="flex-1 relative h-[2px]">
                  <div className="absolute inset-0 rounded-full bg-on-surface/10" />
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded-full bg-primary"
                    initial={false}
                    animate={{ width: nextDone ? '100%' : '0%' }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
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
