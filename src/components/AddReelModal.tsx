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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GlassButton } from '../lib/glass-buttons';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  X, Film, ChefHat, MapPin, Check, AlertCircle,
  Loader2, Globe, Users as UsersIcon, ChevronLeft, ChevronRight,
  Image as ImageIcon, Trash2, Music2, Video as VideoIcon, Plus,
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
import { searchPlacesByText, priceLevelToString, type PlaceResult } from '../lib/places';
import { cuisineLabel } from '../lib/cuisine';
import { searchLocations, type HomeLocation } from './HomeLocationBar';
import { PhotoLibrary, canUseNativePhotoLibrary, nativePathToFile, type MediaItem } from '../lib/native-photos';
import { PhotoLibraryGrid } from './PhotoLibraryGrid';
import {
  FeaturedPickerOverlay,
  FeaturedSummary,
  restaurantMetaLine,
  recipeMetaLine,
  type FeaturedKind,
  type FeaturedRestaurant,
  type FeaturedRecipe,
} from './composer/FeaturedPicker';

// Build a Google Places type → human label lookup once.

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

/** "0:12" from seconds — matches the post composer's duration pill. */
function fmtDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const VISIBILITY_OPTIONS = [
  { value: true, label: 'Public', sub: 'Anyone on GoodEats can see this', subShort: 'Anyone on GoodEats', Icon: Globe },
  { value: false, label: 'Followers only', sub: 'Only people who follow you', subShort: 'Only people who follow you', Icon: UsersIcon },
] as const;

/* ── Modal ──────────────────────────────────────────────────────────── */

export const AddReelModal: React.FC = () => {
  const { addReelModalOpen, addReelInitialKind, editingReelId, closeAddReelModal, postReel, updateReel, setReelVisibility, reels, consumePendingReelVideo } = useReels();
  const editingReel = editingReelId ? reels.find((r) => r.id === editingReelId) ?? null : null;
  const isEditing = !!editingReel;
  const { ratings, wishlist, restaurantMeta, homeMeals } = useLists();
  const { user, profile } = useAuth();
  const { phoneMode } = useSettings();
  const { showToast } = useToast();
  const navigate = useNavigate();

  // Body-scroll lock + swipe-back stand-down while the composer owns the
  // screen. Drag-to-dismiss is off: both layouts are full surfaces with
  // their own close affordance.
  useBottomSheet(addReelModalOpen, closeAddReelModal);

  // ── Step machine ──
  const [step, setStep] = useState<Step>(1);
  const goToStep = (next: Step) => setStep(next);

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
  // The featured item is held as a full snapshot, not an id. Google
  // Places results only exist inside the current search response, so an
  // id-plus-lookup lost the selection the moment the query changed —
  // e.g. tapping "Change" (which clears the search box) silently
  // un-featured the place and disabled the Next button.
  const [pickedRestaurant, setPickedRestaurant] = useState<FeaturedRestaurant | null>(null);
  const [pickedRecipe, setPickedRecipe] = useState<FeaturedRecipe | null>(null);
  const [restaurantSearch, setRestaurantSearch] = useState('');
  const [recipeSearch, setRecipeSearch] = useState('');
  // Which featured picker is open, if any — the same overlay serves the
  // phone sheet and the desktop dialog.
  const [pickerOpen, setPickerOpen] = useState<FeaturedKind | null>(null);
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
  const [locationSearching, setLocationSearching] = useState(false);
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
      setPickedRestaurant(editingReel.restaurant ? { ...editingReel.restaurant } : null);
      setPickedRecipe(editingReel.recipe ? { ...editingReel.recipe } : null);
      // Skip the video + edit steps in edit mode — media is immutable —
      // but keep Featured editable: updateReel patches the attachment.
      setStep(3);
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
      setPickedRestaurant(null);
      setPickedRecipe(null);
      setStep(1);
    }
    setAudio('');
    setSharedReel(null);
    setEditTab('trim');
    setSelectedTextId(null);
    setStageNatural(undefined);
    setFinalizingEdits(false);
    setRestaurantSearch('');
    setRecipeSearch('');
    setPickerOpen(null);
    setLocationSearching(false);
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
      // The video was already chosen on the Create page's camera roll —
      // landing on step 1 would show that exact screen a second time, so
      // jump straight to Edit once intake (probe + validation) accepts it.
      // A rejected file stays on step 1 with its validation message.
      void onPickFile(file).then((accepted) => { if (accepted) setStep(2); });
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
    if (!addReelModalOpen || pickerOpen !== 'restaurant') return;
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
  }, [addReelModalOpen, pickerOpen, restaurantSearch, userLat, userLng]);

  // Debounced location search — runs while the user is typing on step 4.
  useEffect(() => {
    if (!addReelModalOpen || step !== 4) return;
    if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
    const q = locationLabel.trim();
    if (!q || (pickedLocation && pickedLocation.label === locationLabel)) {
      setLocationSuggestions([]);
      setLocationSearching(false);
      return;
    }
    if (q.length < 2) {
      setLocationSuggestions([]);
      setLocationSearching(false);
      return;
    }
    setLocationSearching(true);
    locationDebounceRef.current = setTimeout(async () => {
      lastLocationQueryRef.current = q;
      try {
        const found = await searchLocations(q);
        if (lastLocationQueryRef.current !== q) return;
        setLocationSuggestions(found);
      } catch (err) {
        console.warn('[AddReel] location search failed', err);
        if (lastLocationQueryRef.current === q) setLocationSuggestions([]);
      } finally {
        if (lastLocationQueryRef.current === q) setLocationSearching(false);
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
          id: p.id, name: p.name, cuisine: cuisineLabel(p),
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

  // ── Video selection ──
  /** Validate + stage a picked file. Returns true only when the file was
   *  ACCEPTED — callers that advance the wizard must check this, or a
   *  rejected pick lands the user on an empty step 2 with the validation
   *  message left behind on step 1. */
  const onPickFile = async (file: File | null): Promise<boolean> => {
    if (!file) return false;
    setValidationMsg(null);
    setErrorMsg(null);
    const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|mkv|avi|3gp|qt|hevc)$/i;
    const looksLikeVideo = file.type.startsWith('video/') || VIDEO_EXT_RE.test(file.name);
    if (!looksLikeVideo) {
      setValidationMsg('Please pick a video file.');
      return false;
    }
    let duration: number;
    try {
      duration = await readVideoDuration(file);
    } catch (err) {
      console.warn('[AddReel] probe failed:', err);
      setValidationMsg("Couldn't read this video — try exporting to MP4 (H.264) and uploading again.");
      return false;
    }
    if (duration > REEL_MAX_DURATION_SECONDS + 0.5) {
      setValidationMsg(`Video is ${duration.toFixed(0)}s — reels are limited to ${REEL_MAX_DURATION_SECONDS}s.`);
      return false;
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
    return true;
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
      // Only report success when validation actually accepted the file —
      // returning true unconditionally advanced the wizard to an empty
      // step 2 while the rejection message stayed behind on step 1.
      return await onPickFile(file);
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
      // Both layouts hold the composer open on the animated success
      // screen with "Create another" / "View reel".
      setProgress(1);
      setSharedReel({ id: reel.id });
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
  /* ── Shared derivations ─────────────────────────────────────────────
     Both layouts drive off the same step machine, titles, dots and
     primary action — the phone sheet and the desktop panel differ only
     in how they lay the pieces out. */

  // Edit mode locks the media, so its flow starts at Featured.
  const firstStep: Step = isEditing ? 3 : 1;
  const composerTitle = isEditing
    ? (step === 3 ? 'Edit reel' : 'Details')
    : step === 1 ? 'New reel' : step === 2 ? 'Edit' : step === 3 ? 'Featured' : 'Details';
  const dotSteps: Step[] = isEditing ? [3, 4] : [1, 2, 3, 4];
  const canJumpTo = (s: Step) => (isEditing ? s >= 3 : s === 1 || !!videoUrl);
  const canGoBack = step > firstStep && !sharedReel;

  const primary: { label: React.ReactNode; onClick: () => void; disabled: boolean } =
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
      disabled: !canAdvanceFromStep2,
    }
    : step === 3 ? {
      label: <>Next <ChevronRight size={13} strokeWidth={2.8} /></>,
      onClick: () => goToStep(4),
      disabled: !canAdvanceFromStep3,
    }
    : {
      label: submitting ? (
        <><Loader2 size={14} className="animate-spin" /> {isEditing ? 'Saving…' : finalizingEdits ? 'Finishing edits…' : `Uploading ${Math.round(progress * 100)}%`}</>
      ) : (
        <>{isEditing ? 'Save changes' : 'Share'} <ChevronRight size={14} strokeWidth={2.6} /></>
      ),
      onClick: onSubmit,
      disabled: !canSubmit,
    };

  /** Phone header's leading button: cancel an upload, walk a step back,
   *  or close — in that order, so it never skips a step the user can
   *  still see. */
  const onBackTap = () => {
    if (submitting) { if (!isEditing) cancelUpload(); return; }
    if (canGoBack) goToStep((step - 1) as Step);
    else closeAddReelModal();
  };

  // ── Phone sheet geometry ──
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const phoneSheetH = Math.round(
    step === 1 ? Math.min(Math.max(winH * 0.46, 320), 480)
    : step === 2 ? Math.min(Math.max(winH * 0.52, 380), 540)
    : step === 3 ? Math.min(Math.max(winH * 0.48, 350), 500)
    : Math.min(Math.max(winH * 0.58, 430), 600),
  );
  // The camera-roll step earns a near-full detent — a raised gallery is
  // meant to cover the canvas. Every later step shares the screen with
  // the live preview, so the sheet is capped and scrolls internally
  // instead of growing until the media is a thumbnail (the Text and
  // Filters tabs used to do exactly that).
  const phoneSheetMax = step === 1 ? winH - 108 : Math.round(winH * 0.62);

  const authorName = profile?.display_name || profile?.username || 'You';
  const authorInitials = (authorName.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('') || 'Y').toUpperCase();

  // The canvas item — the picked video with its live edits.
  const stageItem = videoFile && videoUrl ? {
    key: 'reel-video',
    mediaType: 'video' as const,
    file: videoFile,
    previewUrl: videoUrl,
    durationSeconds: videoDuration,
    edits: videoEdits,
  } : null;

  /** Subtitle for the desktop media row — "0:12 · MP4". */
  const videoRowSub = (() => {
    const ext = videoFile ? (videoFile.name.split('.').pop() || '').toUpperCase().slice(0, 5) : '';
    return [fmtDuration(videoDuration), ext].filter(Boolean).join(' · ') || 'Video';
  })();

  // ── Drag-and-drop onto the desktop canvas ──
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
    if (file) void onPickFile(file);
  };

  /* ── Step 3 panel — reel type + the featured item ──
     One instance shared by both layouts (only one renders at a time).
     The type is locked while editing: `kind` is a column on the reel
     row and updateReel can't move it, so switching it here would leave
     a restaurant reel filed under recipes. */
  const switchKind = (k: ReelKind) => {
    if (k === kind) return;
    setKind(k);
    setPickedRestaurant(null);
    setPickedRecipe(null);
    setRestaurantSearch('');
    setRecipeSearch('');
  };

  const featuredPanel = (
    <div className="space-y-5">
      <section>
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/40 mb-2.5">
          Reel type
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          {([
            { k: 'restaurant' as const, Icon: MapPin, label: 'Restaurant', sub: 'Showcase a place you visited' },
            { k: 'recipe' as const, Icon: ChefHat, label: 'Recipe', sub: 'Walk through a dish you cooked' },
          ]).map(({ k, Icon, label, sub }) => {
            const active = kind === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => switchKind(k)}
                disabled={submitting || isEditing}
                className={cn(
                  'rounded-2xl border-[1.5px] p-3 text-left transition-all disabled:cursor-not-allowed',
                  active
                    ? 'border-primary bg-white shadow-[0_0_0_3px_rgba(159,48,18,0.08)]'
                    : 'border-on-surface/[0.09] hover:border-on-surface/20',
                  isEditing && !active && 'opacity-40',
                )}
              >
                <Icon size={16} className={cn('mb-1.5', active ? 'text-primary' : 'text-on-surface/40')} />
                <span className={cn('block text-[13px] font-bold leading-tight', active ? 'text-on-surface' : 'text-on-surface/65')}>
                  {label}
                </span>
                <span className="block text-[11.5px] text-on-surface/45 leading-snug mt-0.5">{sub}</span>
              </button>
            );
          })}
        </div>
        {isEditing && (
          <p className="text-[11.5px] text-on-surface/40 mt-2 leading-relaxed">
            A reel's type is fixed once it's posted — you can still swap the featured {kind}.
          </p>
        )}
      </section>

      <section>
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/40 mb-2.5">
          {kind === 'restaurant' ? 'Featured restaurant' : 'Featured recipe'}
        </p>
        {kind === 'restaurant' && pickedRestaurant ? (
          <FeaturedSummary
            title={pickedRestaurant.name}
            meta={restaurantMetaLine(pickedRestaurant)}
            image={pickedRestaurant.image}
            kind="restaurant"
            disabled={submitting}
            onChange={() => { setRestaurantSearch(''); setPickerOpen('restaurant'); }}
            onClear={() => setPickedRestaurant(null)}
          />
        ) : kind === 'recipe' && pickedRecipe ? (
          <FeaturedSummary
            title={pickedRecipe.title}
            meta={recipeMetaLine(pickedRecipe)}
            image={pickedRecipe.image}
            kind="recipe"
            disabled={submitting}
            onChange={() => { setRecipeSearch(''); setPickerOpen('recipe'); }}
            onClear={() => setPickedRecipe(null)}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              if (kind === 'restaurant') { setRestaurantSearch(''); setPickerOpen('restaurant'); }
              else { setRecipeSearch(''); setPickerOpen('recipe'); }
            }}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-on-surface/20 py-3.5 text-[13px] font-bold text-primary hover:border-primary hover:bg-primary/[0.03] active:bg-primary/[0.05] transition-colors disabled:opacity-40"
          >
            <Plus size={15} strokeWidth={2.4} />
            {kind === 'restaurant' ? 'Choose a restaurant' : 'Choose a recipe'}
          </button>
        )}
        <p className="text-[12px] leading-relaxed text-on-surface/40 mt-3">
          {kind === 'restaurant'
            ? 'Every reel features one place — viewers tap it to open the restaurant.'
            : 'Every reel features one dish — viewers tap it to open the recipe.'}
        </p>
      </section>
    </div>
  );

  /* ── Location field — one instance of the state-heavy JSX, shared by
     the phone step-4 body and the desktop details panel. */
  const locationField = (
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
            // Editing invalidates a previous selection — the user has to
            // pick from the suggestions again.
            if (pickedLocation) setPickedLocation(null);
          }}
          onFocus={() => setLocationFocused(true)}
          placeholder="Search a city, neighborhood, or country…"
          disabled={submitting}
          maxLength={100}
          className="flex-1 min-w-0 bg-transparent text-sm placeholder:text-on-surface/35 focus:outline-none disabled:opacity-50"
        />
        {locationSearching && <Loader2 size={14} className="animate-spin text-on-surface/40 flex-shrink-0" />}
        {locationLabel && !submitting && (
          <button
            type="button"
            onClick={() => { setLocationLabel(''); setPickedLocation(null); setLocationSuggestions([]); }}
            className="hit-44 w-6 h-6 rounded-full bg-on-surface/[0.08] hover:bg-on-surface/[0.15] active:bg-on-surface/[0.15] flex items-center justify-center text-on-surface/55 flex-shrink-0"
            aria-label="Clear location"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <AnimatePresence>
        {locationFocused && !pickedLocation && (locationSuggestions.length > 0 || (locationSearching && locationLabel.trim().length >= 2)) && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute z-30 left-0 right-0 mt-1 rounded-2xl bg-surface border border-on-surface/[0.08] shadow-xl overflow-hidden"
          >
            {locationSuggestions.length === 0 ? (
              <div className="px-4 py-3 text-[12px] text-on-surface/45 inline-flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" /> Searching…
              </div>
            ) : (
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
                      className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-on-surface/[0.05] active:bg-on-surface/[0.05] text-left"
                    >
                      <MapPin size={14} className="text-on-surface/40 flex-shrink-0 mt-0.5" />
                      <span className="min-w-0 flex-1 text-sm text-on-surface truncate">{s.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!pickedLocation && locationLabel.trim().length > 0 && !locationSearching && locationSuggestions.length === 0 && (
        <p className="text-[11px] text-on-surface/45 mt-1.5">
          Pick a result from the list to attach it. Free-text won't be saved.
        </p>
      )}
    </section>
  );

  // "Create another" from the success overlay — back to a clean slate.
  const resetForCreate = () => {
    clearVideo();
    setVideoEdits(DEFAULT_EDIT_STATE);
    setCaption('');
    setAudio('');
    setLocationLabel('');
    setPickedLocation(null);
    setLocationSuggestions([]);
    setIsPublic(true);
    setPickedRestaurant(null);
    setPickedRecipe(null);
    setPickerOpen(null);
    setRestaurantSearch('');
    setRecipeSearch('');
    setEditTab('trim');
    setSelectedTextId(null);
    setStageNatural(undefined);
    setErrorMsg(null);
    setValidationMsg(null);
    setProgress(0);
    setSharedReel(null);
    setStep(1);
  };

  // Animated share-success overlay — used by both layouts.
  const successOverlay = (
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
              className="h-[42px] px-5 rounded-full border-[1.5px] border-on-surface/15 text-[13.5px] font-bold text-on-surface/70 hover:bg-on-surface/[0.05] active:bg-on-surface/[0.05] transition-colors"
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
              className="h-[42px] px-6 rounded-full bg-on-surface text-surface text-[13.5px] font-bold hover:opacity-90 active:opacity-90 transition-opacity"
            >
              View reel
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <AnimatePresence>
      {addReelModalOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className={cn(
            'fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex justify-center',
            phoneMode ? 'items-end' : 'items-center p-5',
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
            className="relative w-full h-full bg-media-canvas text-white flex flex-col overflow-hidden"
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
              <GlassButton
                id="reel-composer-back"
                symbol={canGoBack && !submitting ? 'chevron.left' : 'xmark'}
                label={submitting && !isEditing ? 'Cancel upload' : canGoBack ? 'Back' : 'Close'}
                tint="white"
                disabled={submitting && isEditing}
                onClick={onBackTap}
                className="w-9 h-9 rounded-full flex items-center justify-center text-white disabled:opacity-40 flex-shrink-0 transition-colors"
              >
                {canGoBack && !submitting ? <ChevronLeft size={17} strokeWidth={2.4} /> : <X size={16} strokeWidth={2.4} />}
              </GlassButton>

              {/* Centered title + step dots */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 mt-[calc(env(safe-area-inset-top,0px)/2)] flex flex-col items-center gap-[5px]">
                <h2 className="font-serif font-bold text-[17px] leading-none whitespace-nowrap">
                  {sharedReel ? 'Reel shared' : composerTitle}
                </h2>
                <div className="flex gap-1">
                  {dotSteps.map((s) => (
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
                  onClick={primary.onClick}
                  disabled={primary.disabled}
                  className="ml-auto h-9 pl-4 pr-3.5 rounded-full bg-surface text-on-surface inline-flex items-center gap-1 text-[13px] font-bold active:scale-95 transition-transform disabled:opacity-35"
                >
                  {primary.label}
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
                <>
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
                  {step === 3 && hasFeatured && (
                    <div className="absolute left-5 top-2 inline-flex items-center gap-1.5 rounded-full bg-primary text-white px-2.5 py-1 text-[10.5px] font-bold shadow-lg pointer-events-none z-10">
                      {kind === 'restaurant' ? <MapPin size={10} /> : <ChefHat size={10} />}
                      <span className="max-w-[180px] truncate">
                        {kind === 'restaurant' ? pickedRestaurant?.name : pickedRecipe?.title}
                      </span>
                    </div>
                  )}
                </>
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
                  {/* One call to action, and it lives in the sheet below —
                      a button here as well left two identical CTAs on the
                      same screen. */}
                  <p className="text-[14px] font-semibold text-white/75 mt-3">
                    {canUseNativePhotoLibrary()
                      ? 'Pick a video from your camera roll below'
                      : 'Choose a video below'}
                  </p>
                  <p className="text-[12px] text-white/40 mt-1 leading-relaxed">
                    Vertical works best · up to {REEL_MAX_DURATION_SECONDS}s
                  </p>
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
              // Step 1 only needs the tall detent when the native camera
              // roll fills it; on web it's a single button, so hug it
              // rather than leaving a blank half-screen of sheet.
              fit={step !== 1 || !canUseNativePhotoLibrary()}
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
                        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/40">
                          {canUseNativePhotoLibrary() ? 'Recents' : 'Video'}
                        </span>
                        <span className="text-[12px] font-semibold text-on-surface/45">
                          Up to {REEL_MAX_DURATION_SECONDS}s
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
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="mt-3 w-full flex items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-on-surface/20 py-4 text-[13px] font-bold text-primary active:bg-primary/[0.05] transition-colors"
                        >
                          <Film size={15} strokeWidth={2.4} />
                          Choose a video
                        </button>
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
                        variant="sheet"
                      />
                    </div>
                  )}

                  {/* ── STEP 3 · Featured ── */}
                  {step === 3 && featuredPanel}

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

                      {locationField}

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
                          {VISIBILITY_OPTIONS.map((opt) => {
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
                                <span className="text-[11.5px] text-on-surface/45 leading-snug">{opt.subShort}</span>
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
            {successOverlay}
          </motion.div>
          ) : (

          /* ═════════ Desktop split composer ═════════
             Instagram-style, identical in shape to the post composer:
             dark media canvas left, 380px control panel right, centered
             serif title + clickable step dots up top. */
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="relative bg-surface w-[min(1180px,96vw)] h-[min(700px,92vh)] rounded-[24px] overflow-hidden flex flex-col shadow-[0_30px_90px_rgba(0,0,0,0.45)]"
          >
            {/* ── Header ── */}
            <div className="h-[60px] flex-shrink-0 border-b border-on-surface/[0.07] flex items-center px-3.5 relative">
              <button
                type="button"
                onClick={() => {
                  // Doubles as Cancel while a create upload is in flight.
                  if (submitting) { if (!isEditing) cancelUpload(); return; }
                  closeAddReelModal();
                }}
                disabled={submitting && isEditing}
                className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center text-on-surface/70 disabled:opacity-40 flex-shrink-0 transition-colors"
                aria-label={submitting && !isEditing ? 'Cancel upload' : 'Close'}
              >
                <X size={17} />
              </button>

              {/* Centered title + step dots */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-[7px]">
                <h2 className="font-serif font-bold text-[17px] leading-none">
                  {sharedReel ? 'Reel shared' : composerTitle}
                </h2>
                <div className="flex gap-1.5">
                  {dotSteps.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { if (!submitting && !sharedReel && canJumpTo(s)) goToStep(s); }}
                      className={cn(
                        'w-[22px] h-[3px] rounded-full transition-colors',
                        s === step ? 'bg-primary' : s < step ? 'bg-primary/40' : 'bg-on-surface/15',
                        canJumpTo(s) && !sharedReel ? 'hover:bg-primary/60' : 'cursor-default',
                      )}
                      aria-label={`Go to step ${s}`}
                    />
                  ))}
                </div>
              </div>

              {/* Back + primary */}
              {!sharedReel && (
                <div className="ml-auto flex items-center gap-2">
                  {canGoBack && (
                    <button
                      type="button"
                      onClick={() => { if (!submitting) goToStep((step - 1) as Step); }}
                      disabled={submitting}
                      className="h-9 px-4 rounded-full text-[13px] font-bold text-on-surface/60 hover:bg-on-surface/[0.05] transition-colors disabled:opacity-40"
                    >
                      Back
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={primary.onClick}
                    disabled={primary.disabled}
                    className="h-9 pl-5 pr-4 rounded-full bg-on-surface text-surface inline-flex items-center gap-1.5 text-[13px] font-bold transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-30 disabled:active:scale-100"
                  >
                    {primary.label}
                  </button>
                </div>
              )}
            </div>

            {/* ── Body: canvas + panel ── */}
            <div
              className="flex-1 flex min-h-0"
              onDragEnter={onDragEnter}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
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

              {/* Media canvas (left) */}
              <div className="flex-1 min-w-0 relative bg-media-canvas flex items-center justify-center overflow-hidden">
                {stageItem ? (
                  <>
                    <motion.div
                      key={stageItem.key}
                      initial={{ opacity: 0.35, scale: 0.995 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.22, ease: 'easeOut' }}
                      className="absolute inset-6"
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

                    {videoDuration != null && (
                      <div className="absolute left-4 top-4 rounded-full bg-black/55 backdrop-blur px-2.5 py-1 text-[11px] font-bold text-white pointer-events-none">
                        {fmtDuration(videoDuration)}
                      </div>
                    )}

                    {step === 3 && hasFeatured && (
                      <div className="absolute left-4 bottom-4 inline-flex items-center gap-1.5 rounded-full bg-primary text-white px-3 py-1.5 text-[11px] font-bold shadow-lg pointer-events-none">
                        {kind === 'restaurant' ? <MapPin size={11} /> : <ChefHat size={11} />}
                        <span className="max-w-[220px] truncate">
                          {kind === 'restaurant' ? pickedRestaurant?.name : pickedRecipe?.title}
                        </span>
                      </div>
                    )}

                    {dragActive && step === 1 && (
                      <div className="absolute inset-4 rounded-2xl border-2 border-dashed border-primary bg-primary/15 flex items-center justify-center pointer-events-none">
                        <span className="text-[15px] font-bold text-white drop-shadow">Drop to replace</span>
                      </div>
                    )}
                  </>
                ) : isEditing && editingReel?.videoUrl ? (
                  <>
                    <div className="absolute inset-6">
                      <video
                        src={editingReel.videoUrl}
                        muted
                        autoPlay
                        loop
                        playsInline
                        className="w-full h-full object-contain"
                      />
                    </div>
                    {step === 3 && hasFeatured && (
                      <div className="absolute left-4 bottom-4 inline-flex items-center gap-1.5 rounded-full bg-primary text-white px-3 py-1.5 text-[11px] font-bold shadow-lg pointer-events-none">
                        {kind === 'restaurant' ? <MapPin size={11} /> : <ChefHat size={11} />}
                        <span className="max-w-[220px] truncate">
                          {kind === 'restaurant' ? pickedRestaurant?.name : pickedRecipe?.title}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  /* Empty canvas — browse / drop CTA */
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      'flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed px-16 py-20 transition-colors',
                      dragActive
                        ? 'border-primary bg-primary/15 text-white'
                        : 'border-white/20 text-white/60 hover:border-white/45 hover:text-white/85',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Film size={30} />
                      <VideoIcon size={30} />
                    </div>
                    <span className="text-[15px] font-semibold">
                      {dragActive ? 'Drop your video' : 'Drag your video here'}
                    </span>
                    <span className="text-[12px] opacity-75">
                      or click to browse · vertical works best · up to {REEL_MAX_DURATION_SECONDS}s
                    </span>
                  </button>
                )}
              </div>

              {/* Control panel (right) */}
              <div className="w-[380px] flex-shrink-0 border-l border-on-surface/[0.07] flex flex-col min-h-0 bg-surface">
                <div className="flex-1 overflow-y-auto">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={step}
                      initial={{ opacity: 0, x: 14 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                      className="px-6 py-5"
                    >
                      {/* ── STEP 1 · Media ── */}
                      {step === 1 && !isEditing && (
                        <div>
                          <div className="flex items-baseline justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/40">Video</span>
                            <span className="text-[12px] font-semibold text-on-surface/45 tabular-nums">
                              {videoUrl ? '1 / 1' : `0 / 1`}
                            </span>
                          </div>

                          {videoUrl ? (
                            <div className="group flex items-center gap-3 rounded-2xl border-[1.5px] border-primary bg-white p-2 pr-3 mt-3 shadow-[0_0_0_3px_rgba(159,48,18,0.08)]">
                              <div className="w-[46px] h-[46px] rounded-[10px] overflow-hidden flex-shrink-0 bg-on-surface/[0.06] relative">
                                <video src={videoUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                                <VideoIcon size={11} className="absolute bottom-1 right-1 text-white drop-shadow" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-bold leading-tight">Your video</p>
                                <p className="text-[11.5px] text-on-surface/45 mt-0.5 truncate">{videoRowSub}</p>
                              </div>
                              <div className="flex items-center gap-0.5 flex-shrink-0">
                                <button
                                  type="button"
                                  onClick={() => fileInputRef.current?.click()}
                                  disabled={submitting}
                                  className="w-8 h-8 rounded-full hover:bg-on-surface/[0.06] flex items-center justify-center text-on-surface/55 disabled:opacity-25"
                                  aria-label="Replace video"
                                >
                                  <ImageIcon size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={clearVideo}
                                  disabled={submitting}
                                  className="w-8 h-8 rounded-full hover:bg-rose-50 flex items-center justify-center text-rose-500 disabled:opacity-25"
                                  aria-label="Remove video"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="mt-3 w-full flex items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-on-surface/20 py-3.5 text-[13px] font-bold text-primary hover:border-primary hover:bg-primary/[0.03] transition-colors"
                            >
                              <Plus size={15} strokeWidth={2.4} />
                              Add a video
                            </button>
                          )}

                          {validationMsg && (
                            <div className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-[12px] text-rose-700">
                              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                              <span>{validationMsg}</span>
                            </div>
                          )}

                          <p className="text-[12px] leading-relaxed text-on-surface/40 mt-4">
                            Reels play full-bleed, so a vertical 9:16 clip fills the frame best. You can crop and trim on the next step.
                          </p>
                        </div>
                      )}

                      {/* ── STEP 2 · Edit ── */}
                      {step === 2 && !isEditing && stageItem && (
                        <div>
                          <div className="flex items-baseline justify-between mb-4">
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

                      {/* ── STEP 3 · Featured ── */}
                      {step === 3 && featuredPanel}

                      {/* ── STEP 4 · Details ── */}
                      {step === 4 && (
                        <div className="space-y-5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-full bg-on-surface/[0.08] flex items-center justify-center text-[12px] font-bold text-on-surface/60 flex-shrink-0">
                              {authorInitials}
                            </div>
                            <span className="text-[13.5px] font-bold truncate">{authorName}</span>
                          </div>

                          <section>
                            <textarea
                              value={caption}
                              onChange={(e) => setCaption(e.target.value.slice(0, 280))}
                              placeholder="Write a caption…"
                              rows={5}
                              disabled={submitting}
                              className="w-full rounded-2xl bg-white border-[1.5px] border-on-surface/[0.08] px-3.5 py-3 text-sm leading-relaxed placeholder:text-on-surface/35 focus:outline-none focus:border-primary/50 focus:shadow-[0_0_0_3px_rgba(159,48,18,0.07)] resize-none disabled:opacity-50 transition-all"
                            />
                            <div className="text-right text-[11px] font-semibold text-on-surface/35 mt-1 tabular-nums">{caption.length} / 280</div>
                          </section>

                          {locationField}

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
                            <div className="flex flex-col gap-2">
                              {VISIBILITY_OPTIONS.map((opt) => {
                                const active = isPublic === opt.value;
                                return (
                                  <button
                                    key={opt.label}
                                    type="button"
                                    onClick={() => setIsPublic(opt.value)}
                                    disabled={submitting}
                                    className={cn(
                                      'flex items-center gap-3 rounded-2xl border-[1.5px] px-3.5 py-3 text-left transition-all disabled:opacity-40',
                                      active
                                        ? 'border-primary bg-white shadow-[0_0_0_3px_rgba(159,48,18,0.08)]'
                                        : 'border-on-surface/[0.09] hover:border-on-surface/20',
                                    )}
                                  >
                                    <span className={cn(
                                      'w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                                      active ? 'border-primary' : 'border-on-surface/25',
                                    )}>
                                      <span className={cn('w-2 h-2 rounded-full transition-colors', active ? 'bg-primary' : 'bg-transparent')} />
                                    </span>
                                    <span className="flex-1 min-w-0">
                                      <span className="block text-[13px] font-bold leading-tight">{opt.label}</span>
                                      <span className="block text-[11.5px] text-on-surface/45 leading-tight mt-0.5">{opt.sub}</span>
                                    </span>
                                    <opt.Icon size={15} className={cn('flex-shrink-0', active ? 'text-primary' : 'text-on-surface/30')} />
                                  </button>
                                );
                              })}
                            </div>
                          </section>
                        </div>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>

                {/* Notices pinned to the panel bottom */}
                {(!user?.id || errorMsg) && !sharedReel && (
                  <div className="px-6 pb-4 pt-2 space-y-2 flex-shrink-0">
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
              </div>
            </div>

            {/* ── Success overlay ── */}
            {successOverlay}
          </motion.div>
          )}

          {/* ── Featured picker (restaurant or recipe) ──
              One shared surface for both layouts: a draggable bottom
              sheet on phones, a centred dialog on desktop. */}
          <FeaturedPickerOverlay
            open={!!pickerOpen}
            kind={pickerOpen ?? kind}
            phoneMode={phoneMode}
            onClose={() => setPickerOpen(null)}
            search={pickerOpen === 'recipe' ? recipeSearch : restaurantSearch}
            onSearchChange={(v) => pickerOpen === 'recipe' ? setRecipeSearch(v) : setRestaurantSearch(v)}
            searching={pickerOpen === 'restaurant' && searchingPlaces}
            restaurants={restaurantPickList}
            recipes={recipePickList}
            selectedId={pickerOpen === 'recipe' ? pickedRecipe?.id ?? null : pickedRestaurant?.id ?? null}
            onPickRestaurant={(r) => {
              setPickedRestaurant(r);
              setPickedRecipe(null);
              setPickerOpen(null);
            }}
            onPickRecipe={(r) => {
              setPickedRecipe(r);
              setPickedRestaurant(null);
              setPickerOpen(null);
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
