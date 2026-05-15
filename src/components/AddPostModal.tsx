/**
 * AddPostModal — three-step flow for creating a multi-media post.
 *
 *   Step 1: Media — pick / arrange 1–15 photos and videos.
 *   Step 2: Tag — per-item caption + featured restaurant or recipe
 *           attachment, with the same apply-to-all / apply-to-specific
 *           power-tools from the previous single-page flow.
 *   Step 3: Details — post-level caption, location, audio, visibility.
 *
 * Edit mode jumps straight to step 2 (media is immutable on existing
 * posts) and the back button on step 2 closes the modal.
 *
 * The step body slides horizontally between steps via motion's
 * direction variant. Phone shows a compact pip indicator in the
 * header; wide viewports get a full YouTube-style labelled stepper.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X, Film, ChefHat, MapPin, Search, Check, Upload, Music2, Trash2, AlertCircle, Loader2, Globe, Users as UsersIcon, Plus, Image as ImageIcon, Video as VideoIcon, ChevronLeft, ChevronRight, Link2 } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  usePosts,
  readVideoDuration,
  POST_MAX_ITEMS,
  POST_VIDEO_MAX_DURATION_SECONDS,
  type PostMediaType,
  type PostAttachedKind,
  type PostRestaurantSnapshot,
  type PostRecipeSnapshot,
  type NewPostItem,
} from '../contexts/PostsContext';
import { useLists } from '../contexts/ListsContext';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { searchPlacesByText, priceLevelToString, CUISINE_TYPES, type PlaceResult } from '../lib/places';
import { searchLocations, type HomeLocation } from './HomeLocationBar';
import {
  MediaEditor,
  applyAllEdits,
  DEFAULT_EDIT_STATE,
  isEdited,
  type EditState,
} from './MediaEditor';

const PLACE_TYPE_TO_CUISINE: Record<string, string> = {};
for (const c of CUISINE_TYPES) {
  if (c.type) PLACE_TYPE_TO_CUISINE[c.type] = c.label;
}
const cuisineFromTypes = (types: string[] | undefined): string => {
  if (!types) return '';
  for (const t of types) if (PLACE_TYPE_TO_CUISINE[t]) return PLACE_TYPE_TO_CUISINE[t];
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

/* ── Working item type — kept in component state. */
interface WorkingItem {
  key: string;            // local id (used as React key + for diffing)
  /** Set when this item was added in this session (we'll upload it).
   *  Absent when the modal is editing an existing post — those items are
   *  already on the server and only their caption/attachment can change. */
  file?: File;
  /** Set when editing — points at the existing post_items row id so the
   *  PATCH targets the right record. */
  existingItemId?: string;
  mediaType: PostMediaType;
  previewUrl: string;     // object URL or signed URL
  caption: string;
  durationSeconds: number | null;
  attachedKind: PostAttachedKind | null;
  restaurant?: PostRestaurantSnapshot;
  recipe?: PostRecipeSnapshot;
  bgGradient: string;
  /** Per-item editor state — crop, trim, colour adjustments, filter
   *  preset. Lazily applied to produce an edited File during submit. */
  edits: EditState;
  /** Snapshot of attached/caption from the original post — used to diff
   *  on submit so we only PATCH items that actually changed. */
  original?: {
    caption: string;
    attachedKind: PostAttachedKind | null;
    restaurantId?: string;
    recipeId?: string;
  };
}

const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|mkv|avi|3gp|qt|hevc)$/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|heic|heif|avif)$/i;

function detectMediaType(file: File): PostMediaType | null {
  if (file.type.startsWith('video/') || VIDEO_EXT_RE.test(file.name)) return 'video';
  if (file.type.startsWith('image/') || IMAGE_EXT_RE.test(file.name)) return 'photo';
  return null;
}

/* ── Step machine type ───────────────────────────────────────────────── */

type Step = 1 | 2 | 3 | 4;

const stepVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 32 : -32, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -32 : 32, opacity: 0 }),
};

/* ── The modal ──────────────────────────────────────────────────────── */

export const AddPostModal: React.FC = () => {
  const { addPostModalOpen, editingPostId, closeAddPostModal, createPost, updatePost, setPostVisibility, posts } = usePosts();
  // When editing, the modal pre-fills its fields and the submit button
  // updates instead of creating. Media files are immutable — only the
  // text fields and per-item attachments move.
  const editingPost = editingPostId ? posts.find((p) => p.id === editingPostId) ?? null : null;
  const isEditing = !!editingPost;
  const { ratings, wishlist, restaurantMeta, homeMeals } = useLists();
  const { profile, user } = useAuth();
  const { phoneMode } = useSettings();
  const { showToast } = useToast();

  // Step machine. Create flow walks 1 → 2 → 3; edit flow enters at 2
  // (media is locked) and goes 2 → 3.
  const [step, setStep] = useState<Step>(1);
  const [direction, setDirection] = useState<1 | -1>(1);
  const goToStep = (next: Step) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  };

  const [items, setItems] = useState<WorkingItem[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [postCaption, setPostCaption] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  // Location autocomplete state — `pickedLocation` is the source of truth.
  // The text input is for searching; we only let the user "have a location"
  // by picking one of the Mapbox suggestions, never via free-text alone.
  const [pickedLocation, setPickedLocation] = useState<HomeLocation | null>(null);
  const [locationFocused, setLocationFocused] = useState(false);
  const [locationSuggestions, setLocationSuggestions] = useState<HomeLocation[]>([]);
  const [locationSearching, setLocationSearching] = useState(false);
  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLocationQueryRef = useRef('');
  const locationWrapRef = useRef<HTMLDivElement>(null);
  const [audio, setAudio] = useState('Original audio');
  const [isPublic, setIsPublic] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [finalizingEdits, setFinalizingEdits] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const dragActive = dragDepth > 0;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 3 carousel — track scroll position to update the active item
  // when the user swipes, and scroll-into-view when the active item
  // changes from outside (prev / next buttons, multi-apply, etc.).
  const tagCarouselRef = useRef<HTMLDivElement | null>(null);
  const tagSlideRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Flag set when the user swipes — suppresses the smooth-scroll
  // effect that would otherwise fight the browser's native snap.
  const tagUserScrollChangeRef = useRef(false);
  const tagScrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Active <video> element on the Tag carousel — we keep it muted by
  // default but auto-pause neighbours when scrolling so only one clip
  // plays at a time.
  const tagVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  // Picker state — shared between restaurant and recipe.
  const [pickerOpen, setPickerOpen] = useState<PostAttachedKind | null>(null);
  const [restaurantSearch, setRestaurantSearch] = useState('');
  const [recipeSearch, setRecipeSearch] = useState('');
  const [userLat, setUserLat] = useState(DEFAULT_LAT);
  const [userLng, setUserLng] = useState(DEFAULT_LNG);
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const placeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPlaceQueryRef = useRef<string>('');

  // Reset on open. In edit mode we pre-fill every field from the post's
  // existing rows so the modal opens looking like a "modify this post"
  // form, with the strip showing the existing media as read-only tiles.
  useEffect(() => {
    if (!addPostModalOpen) return;
    if (editingPost) {
      const seeded: WorkingItem[] = editingPost.items.map((it) => ({
        key: `existing-${it.id}`,
        existingItemId: it.id,
        mediaType: it.mediaType,
        previewUrl: it.mediaUrl,  // signed URL, fine for <video> / <img>
        caption: it.caption,
        durationSeconds: it.durationSeconds,
        attachedKind: it.attachedKind,
        restaurant: it.restaurant ?? undefined,
        recipe: it.recipe ?? undefined,
        bgGradient: it.bgGradient,
        edits: DEFAULT_EDIT_STATE,
        original: {
          caption: it.caption,
          attachedKind: it.attachedKind,
          restaurantId: it.restaurant?.id,
          recipeId: it.recipe?.id,
        },
      }));
      setItems(seeded);
      setActiveKey(seeded[0]?.key ?? null);
      setPostCaption(editingPost.caption);
      setLocationLabel(editingPost.locationLabel);
      setPickedLocation(editingPost.locationLabel
        ? { label: editingPost.locationLabel, lat: 0, lng: 0 }
        : null);
      setAudio(editingPost.audioLabel);
      setIsPublic(editingPost.isPublic);
      // Edit mode: media + per-item edits are locked, so we start at
      // step 3 (per-item tagging) and let the user advance to step 4
      // (post-level fields).
      setStep(3);
    } else {
      setItems([]);
      setActiveKey(null);
      setPostCaption('');
      setLocationLabel('');
      setPickedLocation(null);
      setAudio('Original audio');
      setIsPublic(true);
      setStep(1);
    }
    setDirection(1);
    setLocationSuggestions([]);
    setLocationFocused(false);
    setLocationSearching(false);
    setSubmitting(false);
    setFinalizingEdits(false);
    setProgress(0);
    setErrorMsg(null);
    setValidationMsg(null);
    setDragDepth(0);
    setPickerOpen(null);
    setMultiApply(null);
    setRestaurantSearch('');
    setRecipeSearch('');
    setPlaceResults([]);
    setSearchingPlaces(false);
  }, [addPostModalOpen, editingPostId]);

  // Revoke object URLs on unmount. Existing items in edit mode use a
  // signed URL (https://…) — those don't need revoking, so we only call
  // revokeObjectURL on blob: URLs we created ourselves.
  useEffect(() => {
    return () => {
      for (const it of items) {
        if (it.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(it.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On phone, auto-open the OS picker the first time step 1 mounts so
  // the user lands on the camera roll without an extra tap. Same
  // best-effort approach as AddReelModal: the "Create" tap that opened
  // the modal keeps the user-gesture context alive on iOS / Android
  // Chrome. Bails out in edit mode (media is locked) or once items
  // exist (going back to add more is an explicit user action).
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!addPostModalOpen) { autoOpenedRef.current = false; return; }
    if (!phoneMode || isEditing || step !== 1 || items.length > 0 || autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    const id = window.setTimeout(() => {
      try { fileInputRef.current?.click(); } catch { /* user gesture lost */ }
    }, 60);
    return () => window.clearTimeout(id);
  }, [addPostModalOpen, phoneMode, isEditing, step, items.length]);

  // Geolocation bias for the Places query.
  useEffect(() => {
    if (!addPostModalOpen) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => { if (!cancelled) { setUserLat(pos.coords.latitude); setUserLng(pos.coords.longitude); } },
      () => {},
      { timeout: 5000 },
    );
    return () => { cancelled = true; };
  }, [addPostModalOpen]);

  // Debounced location search (Mapbox forward-geocoder). Only runs while
  // the user is actively typing — once they pick a suggestion the field
  // is "locked" to that selection until they edit again.
  useEffect(() => {
    if (!addPostModalOpen) return;
    if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
    const q = locationLabel.trim();
    // Skip the search when the input matches the picked location (so we
    // don't show a dropdown the moment the modal restores a selection).
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
        console.warn('[AddPost] location search failed', err);
        if (lastLocationQueryRef.current === q) setLocationSuggestions([]);
      } finally {
        if (lastLocationQueryRef.current === q) setLocationSearching(false);
      }
    }, 250);
    return () => { if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current); };
  }, [addPostModalOpen, locationLabel, pickedLocation]);

  // When the Tag step mounts (or the active item changes for reasons
  // other than scrolling — prev/next button, removal, etc.) make sure
  // the carousel snaps to the active slide. Skip when the carousel
  // is already centred on it so user scrolls aren't fought.
  useEffect(() => {
    if (step !== 3) return;
    if (!activeKey) return;
    // Skip when the change came from the user swiping; the browser is
    // already snapping and a competing smooth-scroll causes jitter.
    if (tagUserScrollChangeRef.current) {
      tagUserScrollChangeRef.current = false;
      return;
    }
    const slide = tagSlideRefs.current.get(activeKey);
    const carousel = tagCarouselRef.current;
    if (!slide || !carousel) return;
    const desiredScrollLeft = slide.offsetLeft - (carousel.clientWidth - slide.offsetWidth) / 2;
    // Wider threshold tolerates the sub-pixel offset the browser
    // leaves at the end of a native snap.
    if (Math.abs(carousel.scrollLeft - desiredScrollLeft) > 24) {
      carousel.scrollTo({ left: desiredScrollLeft, behavior: 'smooth' });
    }
    // activeIdx is included so a reorder (which doesn't change the
    // active key but does shift its position) re-runs the snap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, activeKey, items.findIndex((it) => it.key === activeKey)]);

  // Clean up the debounce timer on unmount.
  useEffect(() => () => {
    if (tagScrollEndTimerRef.current) clearTimeout(tagScrollEndTimerRef.current);
  }, []);

  // Pause every Tag-carousel video that isn't the active one — playing
  // multiple videos at once is choppy and confusing.
  useEffect(() => {
    if (step !== 3) return;
    tagVideoRefs.current.forEach((v, key) => {
      if (key === activeKey) return;
      try { v.pause(); } catch { /* ignore */ }
    });
  }, [step, activeKey]);

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

  // Debounced Places search.
  useEffect(() => {
    if (!addPostModalOpen || pickerOpen !== 'restaurant') return;
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
        console.warn('[AddPost] places search failed', err);
        if (lastPlaceQueryRef.current === q) setPlaceResults([]);
      } finally {
        if (lastPlaceQueryRef.current === q) setSearchingPlaces(false);
      }
    }, 300);
    return () => { if (placeDebounceRef.current) clearTimeout(placeDebounceRef.current); };
  }, [addPostModalOpen, pickerOpen, restaurantSearch, userLat, userLng]);

  /* ── File picking ── */

  const safePickerImage = (url: string | undefined | null): string | undefined => {
    if (!url || typeof url !== 'string') return undefined;
    if (url.startsWith('data:')) return undefined;
    return url;
  };

  const onPickFiles = async (incoming: File[]) => {
    // Editing an existing post — media is locked. Bail.
    if (isEditing) return;
    // Media can only be added on step 1; ignore drops that arrive while
    // the user is on the tagging or details step.
    if (step !== 1) return;
    setValidationMsg(null);
    setErrorMsg(null);

    const room = POST_MAX_ITEMS - items.length;
    if (room <= 0) {
      setValidationMsg(`A post can have at most ${POST_MAX_ITEMS} items.`);
      return;
    }
    const trimmed = incoming.slice(0, room);
    if (incoming.length > room) {
      setValidationMsg(`Only added the first ${room} — posts cap at ${POST_MAX_ITEMS} items.`);
    }

    const accepted: WorkingItem[] = [];
    for (const file of trimmed) {
      const mediaType = detectMediaType(file);
      if (!mediaType) {
        setValidationMsg(`Skipped "${file.name}" — not a photo or video.`);
        continue;
      }
      let durationSeconds: number | null = null;
      if (mediaType === 'video') {
        try {
          const d = await readVideoDuration(file);
          if (d > POST_VIDEO_MAX_DURATION_SECONDS + 0.5) {
            setValidationMsg(`Skipped "${file.name}" — videos are limited to ${POST_VIDEO_MAX_DURATION_SECONDS}s.`);
            continue;
          }
          durationSeconds = d;
        } catch (err) {
          console.warn('[AddPost] probe failed', err);
          setValidationMsg(`Skipped "${file.name}" — couldn't read the video.`);
          continue;
        }
      }
      const key = `it-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${file.name}`;
      accepted.push({
        key,
        file,
        mediaType,
        previewUrl: URL.createObjectURL(file),
        caption: '',
        durationSeconds,
        attachedKind: null,
        bgGradient: pickFromPool(BG_GRADIENT_POOL, key),
        edits: DEFAULT_EDIT_STATE,
      });
    }
    if (accepted.length === 0) return;
    setItems((prev) => {
      const next = [...prev, ...accepted];
      // First pick of the session — auto-advance to the Edit step so
      // the user lands on the editor without an extra tap, matching
      // Instagram. Subsequent picks (via the strip's "+" tile) stay
      // put so the user can keep adding before moving on.
      if (prev.length === 0 && step === 1) {
        setTimeout(() => goToStep(2), 0);
      }
      return next;
    });
    if (!activeKey) setActiveKey(accepted[0].key);
  };

  const onRemoveItem = (key: string) => {
    if (isEditing) return; // media is locked when editing
    setItems((prev) => {
      const next = prev.filter((it) => it.key !== key);
      const removed = prev.find((it) => it.key === key);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      // Keep the active selection sensible.
      if (activeKey === key) {
        const fallback = next[0]?.key ?? null;
        setActiveKey(fallback);
      }
      return next;
    });
  };

  const onMoveItem = (key: string, delta: -1 | 1) => {
    if (isEditing) return; // ordering is locked when editing
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.key === key);
      if (idx < 0) return prev;
      const target = idx + delta;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return copy;
    });
  };

  /* ── Drag-and-drop ── */

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
    if (submitting) return;
    const files = Array.from(e.dataTransfer?.files || []) as File[];
    if (files.length > 0) onPickFiles(files);
  };

  /* ── Restaurant + recipe picker data ── */

  const restaurantPickList = useMemo(() => {
    type Item = { id: string; name: string; cuisine: string; price: string; address: string; image?: string; score?: number };
    if (pickerOpen !== 'restaurant') return [] as Item[];
    const q = restaurantSearch.trim().toLowerCase();
    const seen = new Set<string>();
    const out: Item[] = [];
    const ratingScoreById = new Map<string, number>();
    for (const r of ratings) {
      ratingScoreById.set(r.restaurantId, r.score);
      if (seen.has(r.restaurantId)) continue;
      const passes = !q || `${r.name} ${r.cuisine} ${r.address}`.toLowerCase().includes(q);
      if (!passes) continue;
      seen.add(r.restaurantId);
      out.push({
        id: r.restaurantId, name: r.name, cuisine: r.cuisine, price: r.price,
        address: r.address, image: safePickerImage(r.image), score: r.score,
      });
    }
    for (const w of wishlist) {
      if (seen.has(w.restaurantId)) continue;
      const passes = !q || `${w.name} ${w.cuisine} ${w.address}`.toLowerCase().includes(q);
      if (!passes) continue;
      seen.add(w.restaurantId);
      out.push({
        id: w.restaurantId, name: w.name, cuisine: w.cuisine, price: w.price,
        address: w.address, image: safePickerImage(w.image),
        score: ratingScoreById.get(w.restaurantId),
      });
    }
    for (const [id, m] of Object.entries(restaurantMeta || {})) {
      if (id.startsWith('__') || seen.has(id)) continue;
      const meta = m as { name?: string; cuisine?: string; price?: string; address?: string; image?: string };
      if (!meta?.name) continue;
      const passes = !q || `${meta.name} ${meta.cuisine || ''} ${meta.address || ''}`.toLowerCase().includes(q);
      if (!passes) continue;
      seen.add(id);
      out.push({
        id, name: meta.name, cuisine: meta.cuisine || '', price: meta.price || '',
        address: meta.address || '', image: safePickerImage(meta.image),
        score: ratingScoreById.get(id),
      });
    }
    if (q) {
      for (const p of placeResults) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        out.push({
          id: p.id, name: p.name,
          cuisine: cuisineFromTypes(p.types),
          price: priceLevelToString(p.priceLevel) || '',
          address: p.address || p.fullAddress || '',
          image: undefined,
          score: ratingScoreById.get(p.id),
        });
      }
    }
    return out.slice(0, q ? 30 : 20);
  }, [pickerOpen, ratings, wishlist, restaurantMeta, restaurantSearch, placeResults]);

  const recipePickList = useMemo(() => {
    type Item = { id: string; title: string; prepTime: number; cookTime: number; servings: number; difficulty: 'Easy' | 'Medium' | 'Hard'; image?: string };
    if (pickerOpen !== 'recipe') return [] as Item[];
    const out: Item[] = homeMeals.map((m) => ({
      id: m.id, title: m.name,
      prepTime: m.prepTime ?? 0, cookTime: m.cookTime ?? 0,
      servings: m.servings ?? 0,
      difficulty: m.difficulty ?? 'Easy',
      image: safePickerImage(m.coverPhoto || m.photos?.[0]?.url),
    }));
    const q = recipeSearch.trim().toLowerCase();
    if (!q) return out.slice(0, 20);
    return out.filter((it) => it.title.toLowerCase().includes(q)).slice(0, 20);
  }, [pickerOpen, homeMeals, recipeSearch]);

  /* ── Apply attachment to item(s) ── */

  const applyAttachmentToItem = (
    key: string,
    kind: PostAttachedKind,
    snapshot: { restaurant?: PostRestaurantSnapshot; recipe?: PostRecipeSnapshot },
  ) => {
    setItems((prev) => prev.map((it) => it.key === key ? {
      ...it,
      attachedKind: kind,
      restaurant: snapshot.restaurant,
      recipe: snapshot.recipe,
    } : it));
  };

  const clearAttachment = (key: string) => {
    setItems((prev) => prev.map((it) => it.key === key ? {
      ...it, attachedKind: null, restaurant: undefined, recipe: undefined,
    } : it));
  };

  const applyAttachmentToAll = (key: string) => {
    const source = items.find((it) => it.key === key);
    if (!source || !source.attachedKind) return;
    setItems((prev) => prev.map((it) => ({
      ...it,
      attachedKind: source.attachedKind,
      restaurant: source.restaurant,
      recipe: source.recipe,
    })));
    showToast('Applied to all items');
  };

  // ── Multi-apply mode ──
  // Lets the user copy the active item's featured attachment onto a custom
  // subset of the other items (not just one, not necessarily all). Toggling
  // a thumbnail while in this mode adds/removes it from the target set.
  const [multiApply, setMultiApply] = useState<{ sourceKey: string; targets: Set<string> } | null>(null);
  const startMultiApply = (sourceKey: string) => setMultiApply({ sourceKey, targets: new Set() });
  const cancelMultiApply = () => setMultiApply(null);
  const toggleMultiApplyTarget = (key: string) => {
    setMultiApply((prev) => {
      if (!prev || key === prev.sourceKey) return prev;
      const next = new Set(prev.targets);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, targets: next };
    });
  };
  const confirmMultiApply = () => {
    if (!multiApply) return;
    const source = items.find((it) => it.key === multiApply.sourceKey);
    const targets = multiApply.targets;
    if (!source || !source.attachedKind || targets.size === 0) { setMultiApply(null); return; }
    setItems((prev) => prev.map((it) => targets.has(it.key)
      ? { ...it, attachedKind: source.attachedKind, restaurant: source.restaurant, recipe: source.recipe }
      : it
    ));
    showToast(`Applied to ${targets.size} ${targets.size === 1 ? 'item' : 'items'}`);
    setMultiApply(null);
  };

  // Cancel multi-apply mode if the source item is removed/cleared from
  // attachments mid-flow.
  useEffect(() => {
    if (!multiApply) return;
    const source = items.find((it) => it.key === multiApply.sourceKey);
    if (!source || !source.attachedKind) setMultiApply(null);
  }, [items, multiApply]);

  /* ── Submit ── */

  const canSubmit = items.length > 0 && !!user?.id && !submitting;

  const onSubmit = async () => {
    if (!canSubmit || !user?.id) return;
    setErrorMsg(null);
    setSubmitting(true);

    // ── Edit path ──
    if (isEditing && editingPost) {
      try {
        // Build the per-item patch list, but only for items that actually
        // changed compared to their original snapshot.
        const itemUpdates = items
          .filter((it) => it.existingItemId)
          .map((it) => {
            const orig = it.original;
            const captionChanged = !orig || it.caption.trim() !== orig.caption;
            const kindChanged = !orig || it.attachedKind !== orig.attachedKind;
            const restaurantChanged = !orig || (it.restaurant?.id ?? '') !== (orig.restaurantId ?? '');
            const recipeChanged = !orig || (it.recipe?.id ?? '') !== (orig.recipeId ?? '');
            if (!captionChanged && !kindChanged && !restaurantChanged && !recipeChanged) return null;
            const update: Record<string, unknown> = { itemId: it.existingItemId! };
            if (captionChanged) update.caption = it.caption.trim();
            if (kindChanged) update.attachedKind = it.attachedKind;
            if (it.attachedKind === 'restaurant') {
              update.restaurant = it.restaurant ?? null;
              update.recipe = null;
            } else if (it.attachedKind === 'recipe') {
              update.recipe = it.recipe ?? null;
              update.restaurant = null;
            } else if (kindChanged) {
              update.restaurant = null;
              update.recipe = null;
            }
            return update;
          })
          .filter(Boolean) as { itemId: string; caption?: string; attachedKind?: PostAttachedKind | null; restaurant?: PostRestaurantSnapshot | null; recipe?: PostRecipeSnapshot | null }[];

        const ok = await updatePost(editingPost.id, {
          caption: postCaption.trim(),
          locationLabel: pickedLocation?.label ?? '',
          audioLabel: audio.trim() || 'Original audio',
        }, itemUpdates);
        if (!ok) throw new Error("Couldn't save changes — try again.");
        if (editingPost.isPublic !== isPublic) {
          await setPostVisibility(editingPost.id, isPublic);
        }
        showToast('Post updated');
        closeAddPostModal();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Update failed');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // ── Create path ──
    setProgress(0.05);
    try {
      // Bake the user's per-item edits (crop / trim / colour grading
      // / filter) into new files before uploading. Items the user
      // didn't touch in step 2 fall through unchanged.
      const editable = items.filter((it) => isEdited(it.edits) && it.file && it.previewUrl.startsWith('blob:'));
      let editedFiles: Record<string, File> = {};
      if (editable.length > 0) {
        setFinalizingEdits(true);
        try {
          editedFiles = await applyAllEdits(editable.map((it) => ({
            key: it.key,
            mediaType: it.mediaType,
            file: it.file,
            previewUrl: it.previewUrl,
            durationSeconds: it.durationSeconds,
            edits: it.edits,
          })));
        } finally {
          setFinalizingEdits(false);
        }
      }
      const newItems: NewPostItem[] = items.map((it) => {
        if (!it.file) throw new Error('Missing file for new item — please re-attach.');
        const edited = editedFiles[it.key];
        const file = edited ?? it.file;
        // If we trimmed a video, the duration must follow.
        const duration = (edited && it.mediaType === 'video' && it.edits.trim)
          ? Math.max(0, it.edits.trim.end - it.edits.trim.start)
          : it.durationSeconds;
        return {
          file,
          mediaType: it.mediaType,
          caption: it.caption.trim(),
          durationSeconds: duration,
          bgGradient: it.bgGradient,
          attachedKind: it.attachedKind,
          restaurant: it.restaurant,
          recipe: it.recipe,
        };
      });
      const post = await createPost({
        caption: postCaption.trim(),
        // Only use the actual picked location — free-text typing without
        // a selection is treated as "no location attached", per spec.
        locationLabel: pickedLocation?.label ?? '',
        audioLabel: audio.trim() || 'Original audio',
        isPublic,
        items: newItems,
        onProgress: (n) => setProgress(n),
      });
      if (!post) throw new Error("Couldn't create the post — try again.");
      showToast('Posted', { subtitle: "It's live in the feed" });
      closeAddPostModal();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setErrorMsg(msg);
      setProgress(0);
    } finally {
      setSubmitting(false);
    }
  };

  const activeItem = items.find((it) => it.key === activeKey) ?? items[0] ?? null;
  const activeIdx = activeItem ? items.findIndex((it) => it.key === activeItem.key) : -1;

  return (
    <AnimatePresence>
      {addPostModalOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className={cn(
            'fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex justify-center',
            phoneMode ? 'items-end' : 'items-end sm:items-center',
          )}
          onClick={() => { if (!submitting) closeAddPostModal(); }}
        >
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'bg-surface w-full overflow-hidden flex flex-col',
              phoneMode
                ? 'h-full rounded-none'
                : 'h-full sm:max-w-2xl sm:max-h-[92vh] sm:h-[92vh] rounded-none sm:rounded-3xl',
            )}
          >
            {/* Header */}
            <div className="px-5 pt-4 pb-3 flex items-center gap-3 border-b border-on-surface/[0.06] flex-shrink-0">
              {/* Back when there's a previous step, else close. Edit mode
                  starts at step 2 so its "back" closes the modal. */}
              {!isEditing && step > 1 ? (
                <button
                  type="button"
                  onClick={() => { if (!submitting) goToStep((step - 1) as Step); }}
                  disabled={submitting}
                  className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center text-on-surface/70 disabled:opacity-40 flex-shrink-0"
                  aria-label="Back"
                >
                  <ChevronLeft size={18} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { if (!submitting) closeAddPostModal(); }}
                  disabled={submitting}
                  className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center text-on-surface/70 disabled:opacity-40 flex-shrink-0"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              )}
              <div className="flex-1 min-w-0">
                <h2 className="font-serif font-bold text-lg leading-tight truncate">
                  {isEditing ? 'Edit post' : (
                    step === 1 ? 'Choose photos & videos' :
                    step === 2 ? 'Edit each item' :
                    step === 3 ? 'Tag each item' :
                    'Final details'
                  )}
                </h2>
                {!isEditing && (
                  <p className="text-[12px] text-on-surface/45 mt-0.5 truncate">
                    {step === 1 && `Up to ${POST_MAX_ITEMS} items.`}
                    {step === 2 && 'Crop, trim, adjust, or pick a filter.'}
                    {step === 3 && 'Add a per-item caption and featured restaurant or recipe.'}
                    {step === 4 && 'Post caption, location, and visibility.'}
                  </p>
                )}
                {isEditing && (
                  <p className="text-[12px] text-on-surface/45 mt-0.5 truncate">
                    {step === 3 && 'Update per-item captions and featured.'}
                    {step === 4 && 'Update caption, location, audio, and visibility.'}
                  </p>
                )}
              </div>
              {/* Compact step pip — phone only. Desktop gets the labelled
                  stepper bar below the header. Edit mode shows just two
                  pips (Tag + Details). */}
              {phoneMode && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {(isEditing ? [3, 4] : [1, 2, 3, 4]).map((s) => (
                    <motion.span
                      key={s}
                      className={cn(
                        'h-1.5 rounded-full',
                        s <= step ? 'bg-primary' : 'bg-on-surface/10',
                      )}
                      animate={{ width: s === step ? 20 : 6 }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Desktop stepper — full-width labelled checkpoints, hidden
                on phone (the header pip is enough). */}
            {!phoneMode && (
              <PostDesktopStepper currentStep={step} isEditing={isEditing} />
            )}

            <div
              className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden relative"
              onDragEnter={onDragEnter}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi,.heic,.heif"
                multiple
                className="hidden"
                onChange={(e) => onPickFiles(Array.from(e.target.files || []))}
              />

              {/* Animated step content. AnimatePresence + key={step} drives
                  the horizontal slide; the inner motion.div uses
                  direction-aware variants so forward swipes right-to-left
                  and back swipes the other way. */}
              <AnimatePresence mode="wait" initial={false} custom={direction}>
                <motion.div
                  key={step}
                  custom={direction}
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  className="px-5 pt-4 pb-6 space-y-5"
                >

              {/* ───────── STEP 1: Media ───────── */}
              {step === 1 && (<>
              {/* Empty state vs items strip */}
              {items.length === 0 ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    'w-full rounded-2xl border-2 border-dashed transition-colors',
                    'flex flex-col items-center justify-center gap-2 py-16',
                    dragActive
                      ? 'border-primary bg-primary/[0.08] text-primary'
                      : 'border-on-surface/15 text-on-surface/55 hover:border-primary/50 hover:bg-primary/[0.03]',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <ImageIcon size={26} className={cn(dragActive ? 'text-primary' : 'text-on-surface/40')} />
                    <VideoIcon size={26} className={cn(dragActive ? 'text-primary' : 'text-on-surface/40')} />
                  </div>
                  <span className="text-sm font-semibold">
                    {dragActive ? 'Drop your photos and videos' : 'Choose or drag photos and videos'}
                  </span>
                  <span className={cn('text-[11px]', dragActive ? 'text-primary/80' : 'text-on-surface/40')}>
                    Mix freely · up to {POST_MAX_ITEMS} items · videos up to {POST_VIDEO_MAX_DURATION_SECONDS}s each
                  </span>
                </button>
              ) : (
                <section>
                  <div className="flex items-baseline justify-between mb-2">
                    <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface/45">
                      Items
                      <span className="text-on-surface/30 font-medium ml-1.5">{items.length} / {POST_MAX_ITEMS}</span>
                    </label>
                    {activeIdx >= 0 && (
                      <span className="text-[11px] text-on-surface/45 font-mono tabular-nums">#{activeIdx + 1}</span>
                    )}
                  </div>
                  {/* Horizontal strip of thumbnails */}
                  <div className="flex gap-2 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide">
                    {items.map((it, idx) => {
                      const isActive = it.key === activeKey;
                      const hasAttach = it.attachedKind !== null;
                      const inMulti = !!multiApply;
                      const isSource = inMulti && it.key === multiApply.sourceKey;
                      const isTarget = inMulti && multiApply.targets.has(it.key);
                      return (
                        <button
                          key={it.key}
                          type="button"
                          onClick={() => {
                            // In multi-apply mode, tapping a thumbnail
                            // toggles its inclusion (except the source).
                            if (inMulti) toggleMultiApplyTarget(it.key);
                            else setActiveKey(it.key);
                          }}
                          className={cn(
                            'relative flex-shrink-0 w-20 aspect-[9/14] rounded-xl overflow-hidden snap-start transition-all',
                            !inMulti && isActive && 'ring-2 ring-primary ring-offset-2 ring-offset-surface',
                            !inMulti && !isActive && 'ring-1 ring-on-surface/[0.08]',
                            inMulti && isSource && 'ring-2 ring-emerald-500 ring-offset-2 ring-offset-surface',
                            inMulti && isTarget && 'ring-2 ring-primary ring-offset-2 ring-offset-surface',
                            inMulti && !isSource && !isTarget && 'ring-1 ring-on-surface/[0.08] opacity-70',
                          )}
                        >
                          {it.mediaType === 'photo' ? (
                            <img src={it.previewUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                          ) : (
                            <video src={it.previewUrl} muted playsInline preload="metadata" className="absolute inset-0 w-full h-full object-cover" />
                          )}
                          <div className="absolute inset-x-0 bottom-0 p-1 bg-gradient-to-t from-black/70 to-transparent flex items-center justify-between gap-1">
                            <span className="text-[10px] font-bold text-white/90 tabular-nums">#{idx + 1}</span>
                            {it.mediaType === 'video' && <VideoIcon size={10} className="text-white/85" />}
                          </div>
                          {hasAttach && !inMulti && (
                            <span className="absolute top-1 left-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-white">
                              {it.attachedKind === 'restaurant' ? <MapPin size={10} /> : <ChefHat size={10} />}
                            </span>
                          )}
                          {/* Multi-apply: source pill */}
                          {isSource && (
                            <span className="absolute top-1 left-1 px-1.5 h-4 inline-flex items-center rounded bg-emerald-600 text-white text-[8px] font-bold uppercase tracking-wider">
                              Source
                            </span>
                          )}
                          {/* Multi-apply: selection indicator overlay */}
                          {inMulti && !isSource && (
                            <span className={cn(
                              'absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded-full transition-colors',
                              isTarget ? 'bg-primary text-white' : 'bg-black/55 text-white border border-white/40',
                            )}>
                              {isTarget && <Check size={11} strokeWidth={3} />}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {!isEditing && items.length < POST_MAX_ITEMS && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex-shrink-0 w-20 aspect-[9/14] rounded-xl border-2 border-dashed border-on-surface/15 flex flex-col items-center justify-center gap-1 text-on-surface/45 hover:border-primary/50 hover:text-primary transition-colors"
                        title="Add more"
                      >
                        <Plus size={18} />
                        <span className="text-[10px] font-bold">Add</span>
                      </button>
                    )}
                  </div>

                  {validationMsg && (
                    <div className="mt-2 flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-[12px] text-rose-700">
                      <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                      <span>{validationMsg}</span>
                    </div>
                  )}
                </section>
              )}
              </>)}

              {/* ───────── STEP 2: Edit each item (crop / trim / filters) ─── */}
              {step === 2 && items.length > 0 && (
                <MediaEditor
                  items={items.map((it) => ({
                    key: it.key,
                    mediaType: it.mediaType,
                    file: it.file,
                    previewUrl: it.previewUrl,
                    durationSeconds: it.durationSeconds,
                    edits: it.edits,
                  }))}
                  activeKey={activeKey ?? items[0].key}
                  onActiveChange={(k) => setActiveKey(k)}
                  onEditsChange={(key, next) => setItems((prev) => prev.map((it) => it.key === key ? { ...it, edits: next } : it))}
                />
              )}

              {/* ───────── STEP 3: Tag each item ───────── */}
              {step === 3 && items.length > 0 && (<>
              {/* Section header — count on the left, current position on
                  the right. */}
              <div className="flex items-baseline justify-between">
                <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface/45">
                  Items
                  <span className="text-on-surface/30 font-medium ml-1.5">{items.length} / {POST_MAX_ITEMS}</span>
                </label>
                {activeIdx >= 0 && (
                  <span className="text-[11px] text-on-surface/45 font-mono tabular-nums">#{activeIdx + 1}</span>
                )}
              </div>

              {/* Media carousel — slides are 82% wide with snap-center so
                  the active slide is in the middle and the neighbours
                  peek in from the sides. Scrolling (or tapping a peek)
                  updates the active key. Each slide is a full media
                  preview; the active one auto-plays for videos. */}
              <div className="-mx-5">
                <div
                  ref={tagCarouselRef}
                  className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide gap-3 pb-1"
                  onScroll={() => {
                    // Debounce until the scroll has settled — mid-snap
                    // onScroll events otherwise flip activeKey back and
                    // forth as the dominant slide changes, making the
                    // scale / opacity transitions stutter.
                    if (tagScrollEndTimerRef.current) clearTimeout(tagScrollEndTimerRef.current);
                    tagScrollEndTimerRef.current = setTimeout(() => {
                      const el = tagCarouselRef.current;
                      if (!el) return;
                      const center = el.scrollLeft + el.clientWidth / 2;
                      let bestKey: string | null = null;
                      let bestDist = Infinity;
                      tagSlideRefs.current.forEach((slide, key) => {
                        const slideCenter = slide.offsetLeft + slide.offsetWidth / 2;
                        const dist = Math.abs(slideCenter - center);
                        if (dist < bestDist) { bestDist = dist; bestKey = key; }
                      });
                      if (bestKey && bestKey !== activeKey) {
                        tagUserScrollChangeRef.current = true;
                        setActiveKey(bestKey);
                      }
                    }, 90);
                  }}
                >
                  {/* Leading spacer — see MediaEditor for the same
                      pattern; makes the 82% slide width resolve
                      against the full container, so single-item /
                      first / last slides snap-center exactly. */}
                  <div className="flex-shrink-0 w-[9%]" aria-hidden />
                  {items.map((it, idx) => {
                    const isActive = it.key === activeKey;
                    const hasAttach = it.attachedKind !== null;
                    const inMulti = !!multiApply;
                    const isSource = inMulti && it.key === multiApply.sourceKey;
                    const isTarget = inMulti && multiApply.targets.has(it.key);
                    return (
                      <div
                        key={it.key}
                        ref={(el) => {
                          if (el) tagSlideRefs.current.set(it.key, el);
                          else tagSlideRefs.current.delete(it.key);
                        }}
                        data-item-key={it.key}
                        className={cn(
                          // sm:max-h caps the slide on desktop so the
                          // caption / featured controls + Next button
                          // below the carousel stay visible without
                          // scrolling.
                          'relative flex-shrink-0 w-[82%] aspect-[3/4] sm:max-h-[48vh] rounded-2xl overflow-hidden snap-center transition-[opacity,transform] duration-200 ease-out will-change-transform',
                          isActive ? 'scale-100 opacity-100' : 'scale-[0.94] opacity-70',
                        )}
                        onClick={() => {
                          if (inMulti) toggleMultiApplyTarget(it.key);
                          else if (!isActive) setActiveKey(it.key);
                        }}
                      >
                        {it.mediaType === 'photo' ? (
                          <img
                            src={it.previewUrl}
                            alt=""
                            loading="lazy"
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        ) : (
                          <video
                            ref={(el) => {
                              if (el) tagVideoRefs.current.set(it.key, el);
                              else tagVideoRefs.current.delete(it.key);
                            }}
                            src={it.previewUrl}
                            // Only show full <video> controls for the
                            // active slide — peeks should look like a
                            // photo with a play hint, not a row of
                            // duelling control bars.
                            controls={isActive}
                            playsInline
                            preload="metadata"
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        )}
                        {/* Index pill + media-type icon, gradient
                            scrim for legibility. */}
                        <div className="absolute inset-x-0 bottom-0 px-3 py-2 bg-gradient-to-t from-black/65 to-transparent flex items-center justify-between gap-2 pointer-events-none">
                          <span className="text-[12px] font-bold text-white/90 tabular-nums">#{idx + 1}</span>
                          {it.mediaType === 'video' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-white/85 uppercase tracking-wider">
                              <VideoIcon size={11} /> Video
                            </span>
                          )}
                        </div>
                        {/* Tap-anywhere overlay for peeks — without it
                            the click would hit the underlying media
                            element first and toggle native controls. */}
                        {!isActive && !inMulti && (
                          <button
                            type="button"
                            onClick={() => setActiveKey(it.key)}
                            className="absolute inset-0 z-10"
                            aria-label={`Go to item ${idx + 1}`}
                          />
                        )}
                        {/* Featured indicator pill. */}
                        {hasAttach && !inMulti && (
                          <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary text-white text-[10px] font-bold uppercase tracking-wider shadow-sm">
                            {it.attachedKind === 'restaurant' ? <MapPin size={10} /> : <ChefHat size={10} />}
                            Featured
                          </span>
                        )}
                        {/* Multi-apply visuals. */}
                        {isSource && (
                          <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider">Source</span>
                        )}
                        {inMulti && !isSource && (
                          <span className={cn(
                            'absolute top-2.5 right-2.5 inline-flex items-center justify-center w-6 h-6 rounded-full transition-colors',
                            isTarget ? 'bg-primary text-white' : 'bg-black/55 text-white border border-white/40',
                          )}>
                            {isTarget && <Check size={13} strokeWidth={3} />}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {/* Trailing spacer — pairs with the leading one. */}
                  <div className="flex-shrink-0 w-[9%]" aria-hidden />
                </div>
              </div>

              {/* Pagination dots — small visual hint to the user that
                  there's a carousel here. */}
              {items.length > 1 && (
                <div className="flex items-center justify-center gap-1.5">
                  {items.map((it) => (
                    <motion.span
                      key={it.key}
                      className={cn(
                        'h-1.5 rounded-full',
                        it.key === activeKey ? 'bg-primary' : 'bg-on-surface/15',
                      )}
                      animate={{ width: it.key === activeKey ? 18 : 5 }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                    />
                  ))}
                </div>
              )}

              {/* Multi-apply banner — replaces the active-item editor while
                  the user is selecting which thumbnails to copy the
                  featured attachment onto. */}
              {multiApply && (
                <section className="rounded-2xl border border-primary/30 bg-primary/[0.04] p-4">
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-on-surface leading-tight">
                        Apply this featured to specific items
                      </p>
                      <p className="text-[11px] text-on-surface/55 leading-snug mt-0.5">
                        Tap thumbnails above to add or remove them. The green-ringed
                        item is the source — it already has this featured.
                      </p>
                    </div>
                    <Link2 size={16} className="text-primary flex-shrink-0 mt-0.5" />
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-3">
                    <span className="text-[12px] font-semibold text-on-surface/65 tabular-nums">
                      {multiApply.targets.size} {multiApply.targets.size === 1 ? 'item' : 'items'} selected
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={cancelMultiApply}
                        className="px-3 h-9 rounded-full text-[12px] font-bold text-on-surface/70 hover:bg-on-surface/[0.05]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={confirmMultiApply}
                        disabled={multiApply.targets.size === 0}
                        className={cn(
                          'inline-flex items-center gap-1 px-4 h-9 rounded-full text-[12px] font-bold transition-colors',
                          multiApply.targets.size > 0
                            ? 'bg-primary text-white hover:bg-primary/90'
                            : 'bg-on-surface/10 text-on-surface/35 cursor-not-allowed',
                        )}
                      >
                        <Check size={12} />
                        Apply to {multiApply.targets.size}
                      </button>
                    </div>
                  </div>
                </section>
              )}

              {/* Active item editor — hidden while multi-applying so the
                  user focuses on picking targets. */}
              {activeItem && !multiApply && (
                <section className="rounded-2xl border border-on-surface/[0.08] p-4 space-y-4 bg-on-surface/[0.02]">
                  {/* Reorder + remove — hidden when editing (the post's
                      media set is locked). */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-on-surface/45">
                      Item #{activeIdx + 1}
                      <span className="ml-1 text-on-surface/30 font-medium">— {activeItem.mediaType}</span>
                    </div>
                    {!isEditing && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onMoveItem(activeItem.key, -1)}
                          disabled={activeIdx === 0 || submitting}
                          className="w-8 h-8 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center disabled:opacity-30"
                          aria-label="Move left"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onMoveItem(activeItem.key, 1)}
                          disabled={activeIdx === items.length - 1 || submitting}
                          className="w-8 h-8 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center disabled:opacity-30"
                          aria-label="Move right"
                        >
                          <ChevronRight size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveItem(activeItem.key)}
                          disabled={submitting}
                          className="w-8 h-8 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center disabled:opacity-30"
                          aria-label="Remove"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Per-item caption */}
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface/45 mb-2">Caption for this item</label>
                    <textarea
                      value={activeItem.caption}
                      onChange={(e) => setItems((prev) => prev.map((it) => it.key === activeItem.key ? { ...it, caption: e.target.value } : it))}
                      placeholder="Leave blank to use the post's caption."
                      rows={2}
                      maxLength={280}
                      disabled={submitting}
                      className="w-full rounded-xl bg-on-surface/[0.04] border border-on-surface/[0.06] px-3 py-2 text-sm placeholder:text-on-surface/35 focus:outline-none focus:border-primary/40 resize-none disabled:opacity-50"
                    />
                  </div>

                  {/* Per-item attachment */}
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface/45 mb-2">Featured for this item</label>
                    {activeItem.attachedKind ? (
                      <div className="flex items-center gap-3 rounded-2xl bg-primary/[0.06] border border-primary/15 px-3 py-2.5">
                        <div className="w-10 h-10 rounded-xl overflow-hidden bg-on-surface/[0.06] flex-shrink-0 flex items-center justify-center">
                          {activeItem.attachedKind === 'restaurant' && activeItem.restaurant?.image && !activeItem.restaurant.image.startsWith('data:') ? (
                            <img src={activeItem.restaurant.image} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : activeItem.attachedKind === 'recipe' && activeItem.recipe?.image && !activeItem.recipe.image.startsWith('data:') ? (
                            <img src={activeItem.recipe.image} alt="" className="w-full h-full object-cover" />
                          ) : activeItem.attachedKind === 'restaurant' ? (
                            <MapPin size={14} className="text-primary" />
                          ) : (
                            <ChefHat size={14} className="text-primary" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate">
                            {activeItem.attachedKind === 'restaurant' ? activeItem.restaurant?.name : activeItem.recipe?.title}
                          </p>
                          <p className="text-[11px] text-on-surface/55 truncate">
                            {activeItem.attachedKind === 'restaurant'
                              ? [activeItem.restaurant?.cuisine, activeItem.restaurant?.price].filter(Boolean).join(' · ')
                              : `${(activeItem.recipe?.prepTime ?? 0) + (activeItem.recipe?.cookTime ?? 0)} min · ${activeItem.recipe?.servings ?? 0} servings · ${activeItem.recipe?.difficulty}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => clearAttachment(activeItem.key)}
                          disabled={submitting}
                          className="text-[11px] font-semibold text-on-surface/55 hover:text-on-surface px-2 h-8 rounded-full hover:bg-on-surface/[0.05]"
                        >
                          Clear
                        </button>
                      </div>
                    ) : (
                      <>
                        {/* When the user just navigated and the
                            previous item has a featured, offer a
                            one-tap "use the same one" shortcut. */}
                        {(() => {
                          const prev = activeIdx > 0 ? items[activeIdx - 1] : null;
                          if (!prev || !prev.attachedKind) return null;
                          const prevName = prev.attachedKind === 'restaurant'
                            ? prev.restaurant?.name
                            : prev.recipe?.title;
                          return (
                            <button
                              type="button"
                              onClick={() => applyAttachmentToItem(
                                activeItem.key,
                                prev.attachedKind!,
                                { restaurant: prev.restaurant, recipe: prev.recipe },
                              )}
                              disabled={submitting}
                              className="w-full mb-2 inline-flex items-center gap-2 rounded-2xl bg-primary/[0.06] border border-primary/15 px-3 py-2.5 text-left transition-colors hover:bg-primary/[0.1] disabled:opacity-40"
                            >
                              <Link2 size={14} className="text-primary flex-shrink-0" />
                              <span className="flex-1 min-w-0 text-[12.5px] text-on-surface/75 truncate">
                                Use the same as <span className="font-semibold text-on-surface">#{activeIdx}</span>
                                {prevName && <> — <span className="font-bold text-on-surface">{prevName}</span></>}
                              </span>
                              <Check size={14} className="text-primary/60 flex-shrink-0" />
                            </button>
                          );
                        })()}
                        <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => { setPickerOpen('restaurant'); setRestaurantSearch(''); }}
                          disabled={submitting}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/[0.08] text-sm font-semibold text-on-surface/75 transition-colors disabled:opacity-40"
                        >
                          <MapPin size={13} /> Restaurant
                        </button>
                        <button
                          type="button"
                          onClick={() => { setPickerOpen('recipe'); setRecipeSearch(''); }}
                          disabled={submitting}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/[0.08] text-sm font-semibold text-on-surface/75 transition-colors disabled:opacity-40"
                        >
                          <ChefHat size={13} /> Recipe
                        </button>
                        </div>
                      </>
                    )}

                    {/* Apply-to-all + Apply-to-specific. The latter
                        enters multi-select mode where the user taps the
                        thumbnails they want to copy this featured to. */}
                    {activeItem.attachedKind && items.length > 1 && !multiApply && (
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                        <button
                          type="button"
                          onClick={() => applyAttachmentToAll(activeItem.key)}
                          disabled={submitting}
                          className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:text-primary/80 transition-colors"
                        >
                          <Link2 size={12} />
                          Apply to all {items.length} items
                        </button>
                        <button
                          type="button"
                          onClick={() => startMultiApply(activeItem.key)}
                          disabled={submitting}
                          className="inline-flex items-center gap-1 text-[12px] font-semibold text-on-surface/65 hover:text-on-surface transition-colors"
                        >
                          <Link2 size={12} />
                          Apply to specific items…
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              )}
              </>)}

              {/* ───────── STEP 4: Final details ───────── */}
              {step === 4 && items.length > 0 && (
                <>
                  <section>
                    <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface/45 mb-2">Post caption</label>
                    <textarea
                      value={postCaption}
                      onChange={(e) => setPostCaption(e.target.value)}
                      placeholder="Tell the story (used as the default when an item has no caption of its own)."
                      rows={2}
                      maxLength={280}
                      disabled={submitting}
                      className="w-full rounded-2xl bg-on-surface/[0.04] border border-on-surface/[0.06] px-4 py-3 text-sm placeholder:text-on-surface/35 focus:outline-none focus:border-primary/40 resize-none disabled:opacity-50"
                    />
                    <div className="text-right text-[11px] text-on-surface/35 mt-1 tabular-nums">{postCaption.length} / 280</div>
                  </section>

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
                          // Editing invalidates a previous selection — the
                          // user has to pick from suggestions again.
                          if (pickedLocation) setPickedLocation(null);
                        }}
                        onFocus={() => setLocationFocused(true)}
                        placeholder="Search a city, neighborhood, or country…"
                        disabled={submitting}
                        maxLength={100}
                        className="flex-1 bg-transparent text-sm placeholder:text-on-surface/35 focus:outline-none disabled:opacity-50"
                      />
                      {locationSearching && <Loader2 size={14} className="animate-spin text-on-surface/40 flex-shrink-0" />}
                      {locationLabel && !submitting && (
                        <button
                          type="button"
                          onClick={() => { setLocationLabel(''); setPickedLocation(null); setLocationSuggestions([]); }}
                          className="w-6 h-6 rounded-full bg-on-surface/[0.08] hover:bg-on-surface/[0.15] flex items-center justify-center text-on-surface/55 flex-shrink-0"
                          aria-label="Clear location"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>

                    {/* Suggestions dropdown — only when the user is editing
                        and there's no current pick. */}
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
                                    className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-on-surface/[0.05] text-left"
                                  >
                                    <MapPin size={14} className="text-on-surface/40 flex-shrink-0 mt-0.5" />
                                    <span className="min-w-0 flex-1 text-sm text-on-surface truncate">
                                      {s.label}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Helper text — surfaces the rule that you must pick
                        from suggestions to actually attach a location. */}
                    {!pickedLocation && locationLabel.trim().length > 0 && !locationSearching && locationSuggestions.length === 0 && (
                      <p className="text-[11px] text-on-surface/45 mt-1.5">
                        Pick a result from the list to attach it. Free-text won't be saved.
                      </p>
                    )}
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
                    <div className="flex p-1 rounded-2xl bg-on-surface/[0.06]">
                      {([
                        { value: true, label: 'Public', sub: 'Anyone can see this post', icon: Globe },
                        { value: false, label: 'Followers only', sub: 'Only people who follow you', icon: UsersIcon },
                      ] as const).map((opt) => {
                        const active = isPublic === opt.value;
                        const Icon = opt.icon;
                        return (
                          <button
                            key={opt.label}
                            type="button"
                            onClick={() => setIsPublic(opt.value)}
                            disabled={submitting}
                            className={cn(
                              'flex-1 flex items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors disabled:opacity-40',
                              active ? 'bg-white shadow' : 'hover:bg-on-surface/[0.03]',
                            )}
                          >
                            <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', active ? 'bg-primary/10 text-primary' : 'bg-on-surface/[0.06] text-on-surface/55')}>
                              <Icon size={15} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={cn('block text-[13px] font-bold leading-tight', active ? 'text-on-surface' : 'text-on-surface/65')}>{opt.label}</span>
                              <span className="block text-[11px] text-on-surface/45 leading-tight truncate">{opt.sub}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                </>
              )}

                </motion.div>
              </AnimatePresence>
            </div>

            {/* Auth + submit-error banners — pinned between the body and
                the footer so they stay visible across all steps. */}
            {(!user?.id || errorMsg) && (
              <div className="px-5 pb-2 flex-shrink-0 space-y-2">
                {!user?.id && (
                  <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800">
                    <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                    <span>Sign in to post.</span>
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
              {/* Step 1 (Media): Next, gated on at least one item. */}
              {!isEditing && step === 1 && (
                <button
                  type="button"
                  onClick={() => goToStep(2)}
                  disabled={items.length === 0}
                  className={cn(
                    'flex-1 h-11 rounded-full text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors',
                    items.length > 0
                      ? 'bg-primary text-white hover:bg-primary/90'
                      : 'bg-on-surface/10 text-on-surface/35 cursor-not-allowed',
                  )}
                >
                  Next <ChevronRight size={15} />
                </button>
              )}
              {/* Step 2 (Edit): Next — editing is always optional. */}
              {!isEditing && step === 2 && (
                <button
                  type="button"
                  onClick={() => goToStep(3)}
                  className="flex-1 h-11 rounded-full text-sm font-bold inline-flex items-center justify-center gap-2 bg-primary text-white hover:bg-primary/90 transition-colors"
                >
                  Next <ChevronRight size={15} />
                </button>
              )}
              {/* Step 3 (Tag): Next — captions and featured are optional. */}
              {step === 3 && (
                <button
                  type="button"
                  onClick={() => goToStep(4)}
                  className="flex-1 h-11 rounded-full text-sm font-bold inline-flex items-center justify-center gap-2 bg-primary text-white hover:bg-primary/90 transition-colors"
                >
                  Next <ChevronRight size={15} />
                </button>
              )}
              {/* Step 4 (Details): Post / Save changes. */}
              {step === 4 && (
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={!canSubmit}
                  className={cn(
                    'flex-1 h-11 rounded-full text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors relative overflow-hidden',
                    canSubmit
                      ? 'bg-primary text-white hover:bg-primary/90'
                      : 'bg-on-surface/10 text-on-surface/35 cursor-not-allowed',
                  )}
                >
                  {submitting ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      {isEditing ? 'Saving…' : finalizingEdits ? 'Finishing edits…' : `Uploading… ${Math.round(progress * 100)}%`}
                    </>
                  ) : (
                    <>
                      <Upload size={15} />
                      {isEditing
                        ? 'Save changes'
                        : items.length === 0 ? 'Post' : `Post ${items.length} ${items.length === 1 ? 'item' : 'items'}`}
                    </>
                  )}
                  {submitting && !isEditing && !finalizingEdits && (
                    <span className="absolute left-0 bottom-0 h-0.5 bg-white/40" style={{ width: `${Math.round(progress * 100)}%`, transition: 'width 200ms ease-out' }} />
                  )}
                </button>
              )}
            </div>
          </motion.div>

          {/* ── Picker overlay (restaurant or recipe) ── */}
          <AnimatePresence>
            {pickerOpen && activeItem && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
                onClick={() => setPickerOpen(null)}
              >
                <motion.div
                  initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                  transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full sm:max-w-md sm:max-h-[80vh] sm:rounded-3xl rounded-t-3xl bg-surface flex flex-col overflow-hidden"
                  style={{ height: '80vh' }}
                >
                  <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-on-surface/[0.06] flex-shrink-0">
                    <h3 className="font-serif font-bold text-base">
                      Featured {pickerOpen}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setPickerOpen(null)}
                      className="w-8 h-8 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center text-on-surface/65"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {/* Search */}
                  <div className="px-5 pt-3 flex-shrink-0">
                    <div className="flex items-center gap-2 rounded-full bg-on-surface/[0.04] border border-on-surface/[0.06] px-4 h-11">
                      <Search size={14} className="text-on-surface/45 flex-shrink-0" />
                      <input
                        value={pickerOpen === 'restaurant' ? restaurantSearch : recipeSearch}
                        onChange={(e) => pickerOpen === 'restaurant' ? setRestaurantSearch(e.target.value) : setRecipeSearch(e.target.value)}
                        placeholder={pickerOpen === 'restaurant' ? 'Search any restaurant…' : 'Search your home cooking…'}
                        className="flex-1 bg-transparent text-sm placeholder:text-on-surface/35 focus:outline-none"
                      />
                      {pickerOpen === 'restaurant' && searchingPlaces && <Loader2 size={14} className="animate-spin text-on-surface/40" />}
                    </div>
                  </div>

                  {/* List */}
                  <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
                    {pickerOpen === 'restaurant' ? (
                      restaurantPickList.length === 0 ? (
                        <div className="text-center py-8 text-[12px] text-on-surface/45">
                          {searchingPlaces ? 'Searching…' : restaurantSearch.trim().length === 0 ? 'Type to search any restaurant.' : 'No matches.'}
                        </div>
                      ) : (
                        <ul className="space-y-1">
                          {restaurantPickList.map((r) => (
                            <li key={r.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  applyAttachmentToItem(activeItem.key, 'restaurant', {
                                    restaurant: {
                                      id: r.id, name: r.name, cuisine: r.cuisine,
                                      price: r.price, address: r.address, image: r.image,
                                      score: r.score,
                                    },
                                  });
                                  setPickerOpen(null);
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-on-surface/[0.05] rounded-xl text-left"
                              >
                                <div className="w-10 h-10 rounded-xl bg-on-surface/[0.06] overflow-hidden flex-shrink-0 flex items-center justify-center">
                                  {r.image ? (
                                    <img src={r.image} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                  ) : (
                                    <MapPin size={14} className="text-on-surface/35" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold truncate">{r.name}</p>
                                  <p className="text-[11px] text-on-surface/45 truncate">
                                    {[r.cuisine, r.price, r.address].filter(Boolean).join(' · ')}
                                  </p>
                                </div>
                                {r.score != null && (
                                  <span className="text-xs font-bold tabular-nums text-on-surface/55 flex-shrink-0">
                                    {Number(r.score).toFixed(1)}
                                  </span>
                                )}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )
                    ) : (
                      recipePickList.length === 0 ? (
                        <div className="text-center py-8 text-[12px] text-on-surface/45">
                          {recipeSearch.trim().length === 0
                            ? 'No home cooking entries yet. Add one in the Pantry first.'
                            : 'No matches.'}
                        </div>
                      ) : (
                        <ul className="space-y-1">
                          {recipePickList.map((r) => (
                            <li key={r.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  applyAttachmentToItem(activeItem.key, 'recipe', {
                                    recipe: {
                                      id: r.id, title: r.title,
                                      prepTime: r.prepTime, cookTime: r.cookTime,
                                      servings: r.servings, difficulty: r.difficulty,
                                      image: r.image,
                                    },
                                  });
                                  setPickerOpen(null);
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-on-surface/[0.05] rounded-xl text-left"
                              >
                                <div className="w-10 h-10 rounded-xl bg-blue-50 overflow-hidden flex-shrink-0 flex items-center justify-center">
                                  {r.image ? (
                                    <img src={r.image} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                                  ) : (
                                    <ChefHat size={16} className="text-blue-600" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold truncate">{r.title}</p>
                                  <p className="text-[11px] text-on-surface/45 truncate">
                                    {(r.prepTime + r.cookTime) || 0} min · {r.servings || 0} servings · {r.difficulty}
                                  </p>
                                </div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )
                    )}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ── Desktop stepper ──────────────────────────────────────────────────
   Mirrors the YouTube-style stepper used in AddReelModal — three
   labelled checkpoints (Media · Tag · Details) with a primary-filled
   circle + check for completed steps, a primary ring for the current
   step, and outlined circles for upcoming ones. The connector between
   each pair fills with primary color as the user advances. Edit mode
   collapses to two checkpoints since the media step is hidden. */

const POST_STEPPER_LABELS: { label: string }[] = [
  { label: 'Media' },
  { label: 'Edit' },
  { label: 'Tag' },
  { label: 'Details' },
];

const PostDesktopStepper: React.FC<{ currentStep: Step; isEditing: boolean }> = ({ currentStep, isEditing }) => {
  // Edit mode hides the media + edit steps entirely; the stepper
  // collapses to a two-checkpoint bar (Tag + Details).
  const entries = isEditing ? POST_STEPPER_LABELS.slice(2) : POST_STEPPER_LABELS;
  const offset = isEditing ? 3 : 1; // step number of the first visible entry
  return (
    <div className="border-b border-on-surface/[0.06] px-8 py-2.5 flex-shrink-0 bg-surface">
      <div className="relative flex items-center justify-between gap-2">
        {entries.map((entry, i) => {
          const stepNum = (offset + i) as Step;
          const status: 'done' | 'current' | 'upcoming' =
            stepNum < currentStep ? 'done' : stepNum === currentStep ? 'current' : 'upcoming';
          const isLast = i === entries.length - 1;
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
