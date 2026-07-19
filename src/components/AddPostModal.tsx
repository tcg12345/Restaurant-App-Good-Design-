/**
 * AddPostModal — four-step flow for creating a multi-media post.
 *
 *   Step 1: Media — pick / arrange 1–15 photos and videos.
 *   Step 2: Edit — crop / trim / adjust / filters / text per item.
 *   Step 3: Tag — per-item caption + featured restaurant or recipe
 *           attachment, with apply-to-all / apply-to-specific tools.
 *   Step 4: Details — post-level caption, location, audio, visibility.
 *
 * Edit mode jumps straight to step 3 (media is immutable on existing
 * posts).
 *
 * Two layouts share one state machine:
 *   Phone   — full-screen sheet, steps slide horizontally, floating
 *             action bar at the bottom.
 *   Desktop — Instagram-style split composer: dark media canvas on the
 *             left (live filter / crop / text overlays, carousel arrows,
 *             thumb strip), a 380px control panel on the right, centered
 *             serif title + clickable step dots in the header, and an
 *             animated success overlay after sharing.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X, Film, ChefHat, MapPin, Search, Check, Upload, Music2, Trash2, AlertCircle, Loader2, Globe, Users as UsersIcon, Plus, Image as ImageIcon, Video as VideoIcon, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Link2 } from 'lucide-react';
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
import { PhotoLibrary, canUseNativePhotoLibrary, nativePathToFile, type MediaItem } from '../lib/native-photos';
import { PhotoLibraryGrid } from './PhotoLibraryGrid';
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

/** "0:12" from seconds. */
function fmtDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Row subtitle for the desktop media list — "0:12 · MP4" / "JPG · 2.4 MB". */
function mediaRowSub(item: { file?: File; mediaType: PostMediaType; durationSeconds: number | null }): string {
  const ext = item.file
    ? (item.file.name.split('.').pop() || '').toUpperCase().slice(0, 5)
    : '';
  if (item.mediaType === 'video') {
    return [fmtDuration(item.durationSeconds), ext].filter(Boolean).join(' · ') || 'Video';
  }
  const size = item.file ? `${(item.file.size / (1024 * 1024)).toFixed(1)} MB` : '';
  return [ext, size].filter(Boolean).join(' · ') || 'Photo';
}

/** Release the blob: previews we created via URL.createObjectURL. Edit-mode
 *  tiles carry signed https URLs — those pass through untouched. */
function revokeItemPreviews(list: WorkingItem[]): void {
  for (const it of list) {
    if (it.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(it.previewUrl);
  }
}

/* ── Step machine type ───────────────────────────────────────────────── */

type Step = 1 | 2 | 3 | 4;

/* ── The modal ──────────────────────────────────────────────────────── */

export const AddPostModal: React.FC = () => {
  const { addPostModalOpen, editingPostId, closeAddPostModal, createPost, updatePost, setPostVisibility, posts, consumePendingPostDraft } = usePosts();
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
  const goToStep = (next: Step) => setStep(next);

  const [items, setItems] = useState<WorkingItem[]>([]);
  // Latest items for the cleanup paths that can't read state directly: the
  // unmount effect's [] closure, and the open-reset effect, which must
  // revoke the PREVIOUS session's previews before replacing them.
  const itemsRef = useRef<WorkingItem[]>([]);
  useEffect(() => { itemsRef.current = items; }, [items]);
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
  // In-flight media uploads — lets the close button double as Cancel while
  // a create upload runs (abort → createPost tears the whole post down).
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState(0);
  const [finalizingEdits, setFinalizingEdits] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const dragActive = dragDepth > 0;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // ── Desktop split-composer state ──
  // The Edit step's tab + text-overlay selection live here (not in
  // MediaEditor) so the left canvas can make the matching overlay
  // interactive. `stageNatural` is the active media's natural pixel
  // size, reported by EditorStage and consumed by the crop controls.
  const [editTab, setEditTab] = useState<EditorTab>('crop');
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [stageNatural, setStageNatural] = useState<{ w: number; h: number } | undefined>(undefined);
  // Set after a successful desktop share — drives the animated success
  // overlay ("Create another" / "View post") instead of closing.
  const [sharedPost, setSharedPost] = useState<{ id: string } | null>(null);
  // Canvas space reserved behind the phone composer's bottom sheet —
  // the sheet is an overlay, so drags never reflow the canvas; only
  // settled positions commit here (animated by the spacer's transition).
  const [sheetReserve, setSheetReserve] = useState(360);

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
    // This component never unmounts (only the open subtree does), so the
    // PREVIOUS session's items are still sitting in state right now —
    // release their blob previews before the seed/clear below drops the
    // last references. Without this, every compose session leaked its
    // object URLs (up to ten apiece) for the life of the page.
    revokeItemPreviews(itemsRef.current);
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
      // Prefill handed off from the Create page's embedded surface —
      // media runs through the normal intake pipeline; suppressing the
      // auto-opened OS picker so it doesn't pop over prefilled media.
      const draft = consumePendingPostDraft();
      if (draft) {
        if (draft.caption) setPostCaption(draft.caption);
        if (draft.files.length > 0) {
          autoOpenedRef.current = true;
          // Media was already chosen on the Create page's picker — jump
          // straight to Edit once intake (validation + probing) lands.
          void onPickFiles(draft.files).then((accepted) => {
            if (accepted > 0) setStep(2);
          });
        }
      }
    }
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
    setNativePicks([]);
    setNativeMaterializing(false);
    setSharedPost(null);
    setEditTab('crop');
    setSelectedTextId(null);
    setStageNatural(undefined);
  }, [addPostModalOpen, editingPostId]);

  // Desktop composer: reset the text selection + cached natural size
  // when the active item changes, and keep the edit tab valid for the
  // active media type (videos trim, photos crop).
  useEffect(() => {
    setSelectedTextId(null);
    setStageNatural(undefined);
  }, [activeKey]);
  useEffect(() => {
    const it = items.find((i) => i.key === activeKey) ?? items[0];
    if (!it) return;
    if (it.mediaType === 'video' && editTab === 'crop') setEditTab('trim');
    if (it.mediaType === 'photo' && editTab === 'trim') setEditTab('crop');
  }, [activeKey, items, editTab]);

  // Revoke object URLs on unmount, reading the LIVE items via the ref —
  // the old [] closure captured the initial empty array, so even if this
  // ever unmounted it revoked nothing. (In practice the real cleanup work
  // happens in the open-reset effect and resetForCreate above/below; this
  // is the backstop for an actual teardown.)
  useEffect(() => () => revokeItemPreviews(itemsRef.current), []);

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
    // On native iOS the page renders an inline PhotoLibraryGrid; the
    // OS picker would be a redundant second UI.
    if (canUseNativePhotoLibrary()) { autoOpenedRef.current = true; return; }
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

  // Native iOS: ordered list of MediaItems the user has tapped on the
  // PhotoLibraryGrid but hasn't materialized yet. They're flushed to
  // `items` (via getMedia + onPickFiles) when the user presses Next.
  const [nativePicks, setNativePicks] = useState<MediaItem[]>([]);
  const [nativeMaterializing, setNativeMaterializing] = useState(false);
  const useNativeGrid = canUseNativePhotoLibrary();

  const onPickFiles = async (incoming: File[]): Promise<number> => {
    // Editing an existing post — media is locked. Bail.
    if (isEditing) return 0;
    // Media can only be added on step 1; ignore drops that arrive while
    // the user is on the tagging or details step.
    if (step !== 1) return 0;
    setValidationMsg(null);
    setErrorMsg(null);

    const room = POST_MAX_ITEMS - items.length;
    if (room <= 0) {
      setValidationMsg(`A post can have at most ${POST_MAX_ITEMS} items.`);
      return 0;
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
    if (accepted.length === 0) return 0;
    setItems((prev) => [...prev, ...accepted]);
    if (!activeKey) setActiveKey(accepted[0].key);
    return accepted.length;
  };

  // Toggle a thumbnail in/out of the native pre-selection. Enforces the
  // POST_MAX_ITEMS cap silently — taps past the cap are ignored on
  // not-yet-selected thumbs so the UI doesn't need a separate disabled
  // state and the existing 1-based badges stay contiguous.
  const onNativeToggle = (item: MediaItem) => {
    setNativePicks((prev) => {
      const idx = prev.findIndex((p) => p.id === item.id);
      if (idx >= 0) {
        const next = [...prev];
        next.splice(idx, 1);
        return next;
      }
      if (prev.length >= POST_MAX_ITEMS) {
        setValidationMsg(`A post can have at most ${POST_MAX_ITEMS} items.`);
        return prev;
      }
      setValidationMsg(null);
      return [...prev, item];
    });
  };

  // Pull each staged MediaItem off PhotoKit into a File. Doesn't touch
  // items / state — leaves that to the caller so it can bundle the
  // resulting files with other sources (e.g. a camera capture).
  const readStagedNativeFiles = async (): Promise<File[]> => {
    const files: File[] = [];
    for (const item of nativePicks) {
      const { path, mimeType } = await PhotoLibrary.getMedia({ id: item.id });
      const ext = mimeType.split('/')[1] || (item.type === 'video' ? 'mov' : 'jpg');
      files.push(await nativePathToFile(path, `${item.type}-${item.id}.${ext}`, mimeType));
    }
    return files;
  };

  // Run on Next-button tap: materialize every staged MediaItem and hand
  // the resulting Files to onPickFiles (which validates videos, appends
  // to items, and is followed by an explicit advance). Returns true if
  // we got at least as far as calling onPickFiles.
  const materializeNativePicks = async (): Promise<boolean> => {
    if (nativePicks.length === 0) return false;
    setNativeMaterializing(true);
    try {
      const files = await readStagedNativeFiles();
      await onPickFiles(files);
      setNativePicks([]);
      return true;
    } catch (err) {
      console.warn('[AddPost] native materialize failed:', err);
      setValidationMsg("Couldn't load one of the selected items — try again.");
      return false;
    } finally {
      setNativeMaterializing(false);
    }
  };

  // Camera-capture handler for the in-grid Camera tile. We also flush any
  // staged native picks in the same shot so the user doesn't silently
  // lose them when the grid disappears post-capture.
  const onCameraTap = async () => {
    setNativeMaterializing(true);
    try {
      const res = await PhotoLibrary.pickCamera({ mediaType: 'all' });
      if (res.cancelled || !res.path || !res.mimeType) return;
      const files: File[] = [];
      if (nativePicks.length > 0) {
        files.push(...(await readStagedNativeFiles()));
        setNativePicks([]);
      }
      const ext = res.mimeType.split('/')[1] || (res.mediaType === 'video' ? 'mov' : 'jpg');
      files.push(await nativePathToFile(res.path, `camera-${Date.now()}.${ext}`, res.mimeType));
      await onPickFiles(files);
    } catch (err) {
      console.warn('[AddPost] camera failed:', err);
      setValidationMsg("Couldn't open the camera. Check camera permission in Settings.");
    } finally {
      setNativeMaterializing(false);
    }
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
      const editable = items.filter((it) => isEdited(it.edits, it.durationSeconds) && it.file && it.previewUrl.startsWith('blob:'));
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
          })), undefined, () => showToast('Audio couldn’t be kept', {
            subtitle: 'This device dropped sound from an edited video',
          }));
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
      const controller = new AbortController();
      uploadAbortRef.current = controller;
      const post = await createPost({
        caption: postCaption.trim(),
        // Only use the actual picked location — free-text typing without
        // a selection is treated as "no location attached", per spec.
        locationLabel: pickedLocation?.label ?? '',
        audioLabel: audio.trim() || 'Original audio',
        isPublic,
        items: newItems,
        onProgress: (n) => setProgress(n),
        signal: controller.signal,
      });
      if (!post) throw new Error("Couldn't create the post — try again.");
      // Hold the modal open on the animated success screen with
      // "Create another" / "View post" actions.
      setProgress(1);
      setSharedPost({ id: post.id });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        // User tapped Cancel — createPost already tore the post down.
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

  // Abort the in-flight media uploads (the close button's Cancel role).
  const cancelUpload = () => uploadAbortRef.current?.abort();

  const activeItem = items.find((it) => it.key === activeKey) ?? items[0] ?? null;
  const activeIdx = activeItem ? items.findIndex((it) => it.key === activeItem.key) : -1;

  /* ── Desktop composer derivations ── */

  // "Create another" from the success overlay — back to a fresh step 1.
  const resetForCreate = () => {
    revokeItemPreviews(items);
    setItems([]);
    setActiveKey(null);
    setPostCaption('');
    setLocationLabel('');
    setPickedLocation(null);
    setAudio('Original audio');
    setIsPublic(true);
    setStep(1);
    setSharedPost(null);
    setErrorMsg(null);
    setValidationMsg(null);
    setProgress(0);
    setEditTab('crop');
    setSelectedTextId(null);
    setStageNatural(undefined);
    setMultiApply(null);
    setPickerOpen(null);
  };

  const desktopTitle = isEditing
    ? (step === 3 ? 'Edit post' : 'Details')
    : step === 1 ? 'New post' : step === 2 ? 'Edit' : step === 3 ? 'Tag items' : 'Details';
  const dotSteps: Step[] = isEditing ? [3, 4] : [1, 2, 3, 4];
  const canJumpTo = (s: Step) => (isEditing ? s >= 3 : s === 1 || items.length > 0);
  const showDesktopBack = step > (isEditing ? 3 : 1) && !sharedPost;
  const desktopPrimary = step < 4
    ? {
        label: <>Next <ChevronRight size={14} strokeWidth={2.6} /></>,
        onClick: () => goToStep((step + 1) as Step),
        disabled: items.length === 0,
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

  // ── Phone composer derivations ──
  // Bottom-sheet geometry: a resting height per step, plus a full-screen
  // detent for the camera-roll step (drag the handle to expand).
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const phoneSheetH = Math.round(
    step === 1 ? Math.min(Math.max(winH * 0.46, 320), 480)
    : step === 2 ? Math.min(Math.max(winH * 0.52, 380), 540)
    : step === 3 ? Math.min(Math.max(winH * 0.48, 350), 500)
    : Math.min(Math.max(winH * 0.58, 430), 600),
  );
  // Full detent reaches the header's bottom edge, so a fully-raised
  // gallery completely covers the canvas (and the selection preview).
  const phoneSheetMax = winH - 108;

  // Same as desktopPrimary except the media step, which may need to
  // materialize staged native camera-roll picks before advancing.
  const phonePrimary = step !== 1 ? desktopPrimary : {
    label: nativeMaterializing ? (
      <><Loader2 size={14} className="animate-spin" /> Loading…</>
    ) : (
      <>
        Next
        {nativePicks.length > 0 && items.length === 0 && (
          <span className="opacity-75">· {nativePicks.length}</span>
        )}
        <ChevronRight size={13} strokeWidth={2.8} />
      </>
    ),
    onClick: () => {
      if (nativeMaterializing) return;
      if (nativePicks.length > 0) {
        void materializeNativePicks().then((ok) => { if (ok) goToStep(2); });
      } else if (items.length > 0) {
        goToStep(2);
      }
    },
    disabled: (items.length === 0 && nativePicks.length === 0) || nativeMaterializing,
  };
  const lastNativePick = nativePicks[nativePicks.length - 1];

  const authorName = profile?.display_name || profile?.username || 'You';
  const authorInitials = (authorName.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('') || 'Y').toUpperCase();

  // Location search field — one instance of the state-heavy JSX, used by
  // both the phone step-4 body and the desktop details panel (only one
  // layout renders at a time, so the shared ref stays valid).
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
            // pick from suggestions again.
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

      {/* Suggestions dropdown — only when the user is editing and there's
          no current pick. */}
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

      {/* Helper text — surfaces the rule that you must pick from
          suggestions to actually attach a location. */}
      {!pickedLocation && locationLabel.trim().length > 0 && !locationSearching && locationSuggestions.length === 0 && (
        <p className="text-[11px] text-on-surface/45 mt-1.5">
          Pick a result from the list to attach it. Free-text won't be saved.
        </p>
      )}
    </section>
  );

  // Animated share-success overlay — used by both the phone and the
  // desktop cards (only one renders at a time).
  const successOverlay = (
    <AnimatePresence>
      {sharedPost && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="absolute inset-0 z-40 bg-surface flex flex-col items-center justify-center"
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
            Your post is live
          </motion.h3>
          <motion.p
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.28, duration: 0.3 }}
            className="text-[13.5px] text-on-surface/50 mt-2"
          >
            {isPublic ? "Shared publicly — it's on your profile now" : 'Shared with your followers'}
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.36, duration: 0.3 }}
            className="flex items-center gap-2.5 mt-7"
          >
            <button
              type="button"
              onClick={resetForCreate}
              className="h-[42px] px-5 rounded-full border-[1.5px] border-on-surface/15 text-[13.5px] font-bold text-on-surface/70 hover:bg-on-surface/[0.05] transition-colors"
            >
              Create another
            </button>
            <button
              type="button"
              onClick={() => {
                const id = sharedPost.id;
                closeAddPostModal();
                navigate(`/r/post-${id}`);
              }}
              className="h-[42px] px-6 rounded-full bg-on-surface text-surface text-[13.5px] font-bold hover:opacity-90 transition-opacity"
            >
              View post
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <AnimatePresence>
      {addPostModalOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className={cn(
            'fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex justify-center',
            phoneMode ? 'items-end' : 'items-center p-5',
          )}
          onClick={() => { if (!submitting) closeAddPostModal(); }}
        >
          {phoneMode ? (

          /* ═════════ Phone composer ═════════
             Full-screen dark canvas with a draggable bottom sheet: the
             camera roll lives in the sheet on the media step (pull the
             handle up for a full-screen gallery, down to see what's
             selected on the canvas); later steps swap the sheet's
             contents and glide its height. */
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full h-full bg-[#16120e] text-white flex flex-col overflow-hidden"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi,.heic,.heif"
              multiple
              className="hidden"
              onChange={(e) => onPickFiles(Array.from(e.target.files || []))}
            />

            {/* ── Header ── */}
            <div className="pt-safe-4 px-4 pb-2.5 flex items-center relative flex-shrink-0 z-10">
              <button
                type="button"
                onClick={() => {
                  // While a create upload runs this doubles as Cancel —
                  // aborts the uploads; createPost tears the post down.
                  if (submitting) { if (!isEditing) cancelUpload(); return; }
                  if (step > (isEditing ? 3 : 1) && !sharedPost) goToStep((step - 1) as Step);
                  else closeAddPostModal();
                }}
                disabled={submitting && isEditing}
                className="w-9 h-9 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white disabled:opacity-40 flex-shrink-0 transition-colors"
                aria-label={submitting && !isEditing ? 'Cancel upload' : step > (isEditing ? 3 : 1) && !sharedPost ? 'Back' : 'Close'}
              >
                {step > (isEditing ? 3 : 1) && !sharedPost ? <ChevronLeft size={17} strokeWidth={2.4} /> : <X size={16} strokeWidth={2.4} />}
              </button>

              {/* Centered title + step dots */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 mt-[calc(env(safe-area-inset-top,0px)/2)] flex flex-col items-center gap-[5px]">
                <h2 className="font-serif font-bold text-[17px] leading-none whitespace-nowrap">
                  {sharedPost ? 'Post shared' : desktopTitle}
                </h2>
                <div className="flex gap-1">
                  {dotSteps.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { if (!submitting && !sharedPost && canJumpTo(s)) goToStep(s); }}
                      className={cn(
                        'w-[16px] h-[3px] rounded-full transition-colors',
                        s === step ? 'bg-primary' : s < step ? 'bg-primary/60' : 'bg-white/25',
                      )}
                      aria-label={`Go to step ${s}`}
                    />
                  ))}
                </div>
              </div>

              {!sharedPost && (
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

            {/* ── Media canvas ── */}
            <div className="flex-1 min-h-0 relative">
              {activeItem ? (
                <>
                  <motion.div
                    key={activeItem.key}
                    initial={{ opacity: 0.35, scale: 0.99 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className="absolute inset-x-3 top-0.5 bottom-2"
                  >
                    <EditorStage
                      item={{
                        key: activeItem.key,
                        mediaType: activeItem.mediaType,
                        file: activeItem.file,
                        previewUrl: activeItem.previewUrl,
                        durationSeconds: activeItem.durationSeconds,
                        edits: activeItem.edits,
                      }}
                      tab={step === 2 ? editTab : null}
                      selectedTextId={selectedTextId}
                      onSelectText={(id) => setSelectedTextId(id)}
                      onEditsChange={step === 2 && !isEditing
                        ? (edits) => setItems((prev) => prev.map((it) => it.key === activeItem.key ? { ...it, edits } : it))
                        : undefined}
                      onNatural={(size) => setStageNatural(size)}
                    />
                  </motion.div>

                  {/* Edge tap zones flip the carousel (not on the Edit
                      step — they'd swallow crop/text drags). */}
                  {items.length > 1 && step !== 2 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setActiveKey(items[(activeIdx - 1 + items.length) % items.length].key)}
                        className="absolute left-0 top-0 bottom-0 w-[22%] z-10"
                        aria-label="Previous item"
                      />
                      <button
                        type="button"
                        onClick={() => setActiveKey(items[(activeIdx + 1) % items.length].key)}
                        className="absolute right-0 top-0 bottom-0 w-[22%] z-10"
                        aria-label="Next item"
                      />
                    </>
                  )}
                  {items.length > 1 && (
                    <>
                      <div className="absolute top-2 right-5 rounded-full bg-black/60 backdrop-blur px-2.5 py-1 text-[11px] font-bold text-white tabular-nums pointer-events-none z-10">
                        {activeIdx + 1} / {items.length}
                      </div>
                      {/* Position dots — not on Edit, where they'd sit on
                          the crop's bottom handle. */}
                      {step !== 2 && (
                      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-[5px] pointer-events-none z-10">
                        {items.map((it) => (
                          <span
                            key={it.key}
                            className={cn(
                              'hit-44-y w-1.5 h-1.5 rounded-full transition-colors',
                              it.key === activeKey ? 'bg-media-white' : 'bg-white/35',
                            )}
                          />
                        ))}
                      </div>
                      )}
                    </>
                  )}
                  {activeItem.mediaType === 'video' && activeItem.durationSeconds != null && (
                    <div className="absolute left-5 bottom-4 rounded-full bg-black/60 backdrop-blur px-2.5 py-1 text-[11px] font-bold text-white pointer-events-none z-10">
                      {fmtDuration(activeItem.durationSeconds)}
                    </div>
                  )}
                  {step === 3 && activeItem.attachedKind && (
                    <div className="absolute left-5 top-2 inline-flex items-center gap-1.5 rounded-full bg-primary text-white px-2.5 py-1 text-[10.5px] font-bold shadow-lg pointer-events-none z-10">
                      {activeItem.attachedKind === 'restaurant' ? <MapPin size={10} /> : <ChefHat size={10} />}
                      <span className="max-w-[180px] truncate">
                        {activeItem.attachedKind === 'restaurant' ? activeItem.restaurant?.name : activeItem.recipe?.title}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                /* Empty canvas — preview the last staged camera-roll pick,
                   or nudge toward the gallery below. */
                <div className="absolute inset-0 flex flex-col items-center justify-center px-10 text-center">
                  {lastNativePick?.thumbnailDataUrl ? (
                    <motion.div
                      key={lastNativePick.id}
                      initial={{ opacity: 0.4, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.2 }}
                      className="relative h-full w-full py-2"
                    >
                      <img
                        src={lastNativePick.thumbnailDataUrl}
                        alt=""
                        className="w-full h-full object-contain"
                      />
                      <div className="absolute top-2 right-2 rounded-full bg-black/60 backdrop-blur px-2.5 py-1 text-[11px] font-bold text-white tabular-nums">
                        {nativePicks.length} selected
                      </div>
                    </motion.div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2.5 text-white/40">
                        <ImageIcon size={26} />
                        <VideoIcon size={26} />
                      </div>
                      <p className="text-[14px] font-semibold text-white/75 mt-3">
                        {useNativeGrid ? 'Pick from your camera roll below' : 'Add photos or a video'}
                      </p>
                      <p className="text-[12px] text-white/40 mt-1 leading-relaxed">
                        Up to {POST_MAX_ITEMS} items · videos up to {POST_VIDEO_MAX_DURATION_SECONDS}s
                      </p>
                      {!useNativeGrid && (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="mt-4 h-10 px-5 rounded-full bg-surface text-on-surface text-[13px] font-bold active:scale-95 transition-transform"
                        >
                          Open camera roll
                        </button>
                      )}
                    </>
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
              draggable={!sharedPost}
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
                  {step === 1 && (
                    <div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/40">Recents</span>
                        <span className="text-[12px] font-semibold text-on-surface/45 tabular-nums">
                          {items.length + nativePicks.length} / {POST_MAX_ITEMS}
                        </span>
                      </div>

                      {/* Already-added items (hand-off from the Create page,
                          or coming back from Edit) — tap to remove. */}
                      {items.length > 0 && (
                        <div className="flex gap-2 overflow-x-auto scrollbar-hide mt-3 pb-1">
                          {items.map((it, idx) => (
                            <button
                              key={it.key}
                              type="button"
                              onClick={() => { if (!isEditing) onRemoveItem(it.key); }}
                              className="relative w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 ring-1 ring-on-surface/[0.08]"
                              aria-label={`Remove item ${idx + 1}`}
                            >
                              {it.mediaType === 'photo' ? (
                                <img src={it.previewUrl} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <video src={it.previewUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                              )}
                              <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary border-2 border-white text-white text-[10px] font-bold flex items-center justify-center">
                                {idx + 1}
                              </span>
                              {!isEditing && (
                                <span className="absolute inset-x-0 bottom-0 bg-black/55 text-white/90 text-[9px] font-bold py-0.5">
                                  Remove
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}

                      {useNativeGrid ? (
                        /* Native camera roll — auto-loaded, multi-select
                           with numbered badges; drag the sheet up for the
                           full-screen gallery. */
                        <div className="-mx-5 mt-2">
                          <PhotoLibraryGrid
                            mediaType="all"
                            onSelect={onNativeToggle}
                            selectedIds={nativePicks.map((p) => p.id)}
                            selectionMode="multi"
                            onCameraTap={onCameraTap}
                          />
                        </div>
                      ) : (
                        /* Web fallback — the OS picker is the camera roll;
                           picked media shows as a grid here. */
                        <div className="grid grid-cols-3 gap-1.5 mt-3">
                          {!isEditing && items.length < POST_MAX_ITEMS && (
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="aspect-square rounded-[10px] border-[1.5px] border-dashed border-on-surface/20 flex flex-col items-center justify-center gap-1 text-on-surface/45 active:bg-on-surface/[0.04] transition-colors"
                            >
                              <Plus size={17} strokeWidth={2.4} />
                              <span className="text-[10.5px] font-bold uppercase tracking-wider">Add</span>
                            </button>
                          )}
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
                  {step === 2 && activeItem && (
                    <div>
                      <div className="flex items-baseline justify-between mb-3.5">
                        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/40">
                          Item #{activeIdx + 1}
                        </span>
                        {isEdited(activeItem.edits, activeItem.durationSeconds) && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                            <Check size={10} /> Edited
                          </span>
                        )}
                      </div>
                      <EditorControls
                        item={{
                          key: activeItem.key,
                          mediaType: activeItem.mediaType,
                          file: activeItem.file,
                          previewUrl: activeItem.previewUrl,
                          durationSeconds: activeItem.durationSeconds,
                          edits: activeItem.edits,
                        }}
                        tab={editTab}
                        onTabChange={setEditTab}
                        onEditsChange={(edits) => setItems((prev) => prev.map((it) => it.key === activeItem.key ? { ...it, edits } : it))}
                        selectedTextId={selectedTextId}
                        onSelectTextId={setSelectedTextId}
                        natural={stageNatural}
                      />
                    </div>
                  )}

                  {/* ── STEP 3 · Tag ── */}
                  {step === 3 && activeItem && (
                    <div>
                      {/* Current-item header + prev/next */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0 bg-on-surface/[0.06]">
                            {activeItem.mediaType === 'photo' ? (
                              <img src={activeItem.previewUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <video src={activeItem.previewUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[13.5px] font-bold leading-tight">Item #{activeIdx + 1}</p>
                            <p className="text-[10.5px] font-bold tracking-[0.08em] uppercase text-on-surface/35 mt-0.5">
                              {activeItem.mediaType}{items.length > 1 ? ` · ${activeIdx + 1} of ${items.length}` : ''}
                            </p>
                          </div>
                        </div>
                        {items.length > 1 && !multiApply && (
                          <div className="flex gap-1.5 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => setActiveKey(items[(activeIdx - 1 + items.length) % items.length].key)}
                              className="w-8 h-8 rounded-full bg-on-surface/[0.06] active:bg-on-surface/[0.12] flex items-center justify-center text-on-surface/65"
                              aria-label="Previous item"
                            >
                              <ChevronLeft size={14} strokeWidth={2.4} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setActiveKey(items[(activeIdx + 1) % items.length].key)}
                              className="w-8 h-8 rounded-full bg-on-surface/[0.06] active:bg-on-surface/[0.12] flex items-center justify-center text-on-surface/65"
                              aria-label="Next item"
                            >
                              <ChevronRight size={14} strokeWidth={2.4} />
                            </button>
                          </div>
                        )}
                      </div>

                      {multiApply ? (
                        /* Multi-apply — pick target items via thumbnails. */
                        <div className="mt-3.5 rounded-2xl border border-primary/30 bg-primary/[0.05] p-3.5">
                          <p className="text-[12.5px] font-bold leading-tight">Copy this featured to other items</p>
                          <p className="text-[11.5px] text-on-surface/55 mt-1 leading-snug">
                            Tap thumbnails to pick targets — green is the source.
                          </p>
                          <div className="flex gap-2 overflow-x-auto scrollbar-hide mt-3 pb-1">
                            {items.map((it) => {
                              const isSource = it.key === multiApply.sourceKey;
                              const isTarget = multiApply.targets.has(it.key);
                              return (
                                <button
                                  key={it.key}
                                  type="button"
                                  onClick={() => toggleMultiApplyTarget(it.key)}
                                  className={cn(
                                    'relative w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 transition-all',
                                    isSource && 'ring-2 ring-emerald-500',
                                    isTarget && 'ring-2 ring-primary',
                                    !isSource && !isTarget && 'ring-1 ring-on-surface/[0.1] opacity-60',
                                  )}
                                >
                                  {it.mediaType === 'photo' ? (
                                    <img src={it.previewUrl} alt="" className="w-full h-full object-cover" />
                                  ) : (
                                    <video src={it.previewUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                                  )}
                                  {isTarget && (
                                    <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-primary text-white flex items-center justify-center">
                                      <Check size={9} strokeWidth={3.2} />
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-2.5">
                            <span className="text-[12px] font-semibold text-on-surface/65 tabular-nums">
                              {multiApply.targets.size} selected
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={cancelMultiApply}
                                className="px-3 h-8 rounded-full text-[12px] font-bold text-on-surface/70 active:bg-on-surface/[0.06]"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={confirmMultiApply}
                                disabled={multiApply.targets.size === 0}
                                className={cn(
                                  'inline-flex items-center gap-1 px-3.5 h-8 rounded-full text-[12px] font-bold transition-colors',
                                  multiApply.targets.size > 0
                                    ? 'bg-primary text-white'
                                    : 'bg-on-surface/10 text-on-surface/35',
                                )}
                              >
                                <Check size={12} /> Apply
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <input
                            type="text"
                            value={activeItem.caption}
                            onChange={(e) => setItems((prev) => prev.map((it) => it.key === activeItem.key ? { ...it, caption: e.target.value } : it))}
                            placeholder="Caption this item (optional)"
                            maxLength={280}
                            disabled={submitting}
                            className="w-full mt-3.5 rounded-xl bg-white border-[1.5px] border-on-surface/[0.08] px-3.5 py-3 text-[14px] placeholder:text-on-surface/35 focus:outline-none focus:border-primary/50 disabled:opacity-50 transition-colors"
                          />

                          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/40 mt-4">Feature on this item</p>
                          <div className="flex items-center gap-2 mt-2.5">
                            <button
                              type="button"
                              onClick={() => { setPickerOpen('restaurant'); setRestaurantSearch(''); }}
                              disabled={submitting}
                              className={cn(
                                'flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 h-10 rounded-full text-[12.5px] font-bold border-[1.5px] transition-colors disabled:opacity-40',
                                activeItem.attachedKind === 'restaurant'
                                  ? 'bg-primary/[0.08] border-primary text-primary'
                                  : 'bg-on-surface/[0.03] border-on-surface/[0.09] text-on-surface/60',
                              )}
                            >
                              <MapPin size={12} className="flex-shrink-0" />
                              <span className="truncate">
                                {activeItem.attachedKind === 'restaurant' ? activeItem.restaurant?.name || 'Restaurant' : 'Restaurant'}
                              </span>
                              {activeItem.attachedKind === 'restaurant' && <Check size={12} className="flex-shrink-0" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setPickerOpen('recipe'); setRecipeSearch(''); }}
                              disabled={submitting}
                              className={cn(
                                'flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 h-10 rounded-full text-[12.5px] font-bold border-[1.5px] transition-colors disabled:opacity-40',
                                activeItem.attachedKind === 'recipe'
                                  ? 'bg-primary/[0.08] border-primary text-primary'
                                  : 'bg-on-surface/[0.03] border-on-surface/[0.09] text-on-surface/60',
                              )}
                            >
                              <ChefHat size={12} className="flex-shrink-0" />
                              <span className="truncate">
                                {activeItem.attachedKind === 'recipe' ? activeItem.recipe?.title || 'Recipe' : 'Recipe'}
                              </span>
                              {activeItem.attachedKind === 'recipe' && <Check size={12} className="flex-shrink-0" />}
                            </button>
                            {activeItem.attachedKind && (
                              <button
                                type="button"
                                onClick={() => clearAttachment(activeItem.key)}
                                disabled={submitting}
                                className="w-9 h-9 rounded-full bg-on-surface/[0.05] active:bg-on-surface/10 flex items-center justify-center text-on-surface/55 flex-shrink-0"
                                aria-label="Clear featured"
                              >
                                <X size={13} />
                              </button>
                            )}
                          </div>

                          {/* Shortcuts */}
                          {!activeItem.attachedKind && activeIdx > 0 && items[activeIdx - 1].attachedKind && (
                            <button
                              type="button"
                              onClick={() => {
                                const prev = items[activeIdx - 1];
                                applyAttachmentToItem(activeItem.key, prev.attachedKind!, { restaurant: prev.restaurant, recipe: prev.recipe });
                              }}
                              disabled={submitting}
                              className="mt-2.5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary/90"
                            >
                              <Link2 size={12} />
                              Use the same as #{activeIdx}
                            </button>
                          )}
                          {activeItem.attachedKind && items.length > 1 && (
                            <div className="flex items-center gap-4 mt-2.5">
                              <button
                                type="button"
                                onClick={() => applyAttachmentToAll(activeItem.key)}
                                disabled={submitting}
                                className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary"
                              >
                                <Link2 size={12} /> Apply to all
                              </button>
                              <button
                                type="button"
                                onClick={() => startMultiApply(activeItem.key)}
                                disabled={submitting}
                                className="text-[12px] font-semibold text-on-surface/55"
                              >
                                Apply to specific…
                              </button>
                            </div>
                          )}

                          <p className="text-[12px] leading-relaxed text-on-surface/40 mt-3.5">
                            Items without a caption use the post caption. Tap the edges of the photo above to flip between items.
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  {/* ── STEP 4 · Details ── */}
                  {step === 4 && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-on-surface/[0.08] flex items-center justify-center text-[11px] font-bold text-on-surface/60 flex-shrink-0">
                          {authorInitials}
                        </div>
                        <span className="text-[13.5px] font-bold truncate">{authorName}</span>
                      </div>

                      <section>
                        <textarea
                          value={postCaption}
                          onChange={(e) => setPostCaption(e.target.value)}
                          placeholder="Write a caption…"
                          rows={3}
                          maxLength={280}
                          disabled={submitting}
                          className="w-full rounded-2xl bg-white border-[1.5px] border-on-surface/[0.08] px-3.5 py-3 text-[14px] leading-relaxed placeholder:text-on-surface/35 focus:outline-none focus:border-primary/50 focus:shadow-[0_0_0_3px_rgba(159,48,18,0.07)] resize-none disabled:opacity-50 transition-all"
                        />
                        <div className="text-right text-[11px] font-semibold text-on-surface/35 mt-1 tabular-nums">{postCaption.length} / 280</div>
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
                  {(!user?.id || errorMsg) && !sharedPost && (
                    <div className="mt-3.5 space-y-2">
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
                </motion.div>
              </AnimatePresence>
            </DraggableSheet>

            {/* ── Success overlay ── */}
            {successOverlay}
          </motion.div>
          ) : (

          /* ═════════ Desktop split composer ═════════
             Instagram-style: dark media canvas left, 380px control panel
             right, centered serif title + clickable step dots up top. */
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
                  closeAddPostModal();
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
                  {sharedPost ? 'Post shared' : desktopTitle}
                </h2>
                <div className="flex gap-1.5">
                  {dotSteps.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { if (!submitting && !sharedPost && canJumpTo(s)) goToStep(s); }}
                      className={cn(
                        'w-[22px] h-[3px] rounded-full transition-colors',
                        s === step ? 'bg-primary' : s < step ? 'bg-primary/40' : 'bg-on-surface/15',
                        canJumpTo(s) && !sharedPost ? 'hover:bg-primary/60' : 'cursor-default',
                      )}
                      aria-label={`Go to step ${s}`}
                    />
                  ))}
                </div>
              </div>

              {/* Back + primary */}
              {!sharedPost && (
                <div className="ml-auto flex items-center gap-2">
                  {showDesktopBack && (
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
                    onClick={desktopPrimary.onClick}
                    disabled={desktopPrimary.disabled}
                    className="h-9 pl-5 pr-4 rounded-full bg-on-surface text-surface inline-flex items-center gap-1.5 text-[13px] font-bold transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-30 disabled:active:scale-100"
                  >
                    {desktopPrimary.label}
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
                accept="image/*,video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi,.heic,.heif"
                multiple
                className="hidden"
                onChange={(e) => onPickFiles(Array.from(e.target.files || []))}
              />

              {/* Media canvas (left) */}
              <div className="flex-1 min-w-0 relative bg-[#16120e] flex items-center justify-center overflow-hidden">
                {activeItem ? (
                  <>
                    <motion.div
                      key={activeItem.key}
                      initial={{ opacity: 0.35, scale: 0.995 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.22, ease: 'easeOut' }}
                      className={cn('absolute inset-6', step === 1 && items.length > 0 && 'bottom-24')}
                    >
                      <EditorStage
                        item={{
                          key: activeItem.key,
                          mediaType: activeItem.mediaType,
                          file: activeItem.file,
                          previewUrl: activeItem.previewUrl,
                          durationSeconds: activeItem.durationSeconds,
                          edits: activeItem.edits,
                        }}
                        tab={step === 2 ? editTab : null}
                        selectedTextId={selectedTextId}
                        onSelectText={(id) => setSelectedTextId(id)}
                        onEditsChange={step === 2 && !isEditing
                          ? (edits) => setItems((prev) => prev.map((it) => it.key === activeItem.key ? { ...it, edits } : it))
                          : undefined}
                        onNatural={(size) => setStageNatural(size)}
                      />
                    </motion.div>

                    {/* Video duration pill */}
                    {activeItem.mediaType === 'video' && activeItem.durationSeconds != null && (
                      <div className="absolute left-4 top-4 rounded-full bg-black/55 backdrop-blur px-2.5 py-1 text-[11px] font-bold text-white pointer-events-none">
                        {fmtDuration(activeItem.durationSeconds)}
                      </div>
                    )}

                    {/* Featured pill (tag step) */}
                    {step === 3 && activeItem.attachedKind && (
                      <div className="absolute left-4 bottom-4 inline-flex items-center gap-1.5 rounded-full bg-primary text-white px-3 py-1.5 text-[11px] font-bold shadow-lg pointer-events-none">
                        {activeItem.attachedKind === 'restaurant' ? <MapPin size={11} /> : <ChefHat size={11} />}
                        <span className="max-w-[220px] truncate">
                          {activeItem.attachedKind === 'restaurant' ? activeItem.restaurant?.name : activeItem.recipe?.title}
                        </span>
                      </div>
                    )}

                    {/* Carousel arrows + counter */}
                    {items.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={() => setActiveKey(items[(activeIdx - 1 + items.length) % items.length].key)}
                          className="absolute left-4 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-surface/95 text-on-surface shadow-lg flex items-center justify-center transition-transform hover:scale-110"
                          aria-label="Previous item"
                        >
                          <ChevronLeft size={16} strokeWidth={2.4} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveKey(items[(activeIdx + 1) % items.length].key)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-surface/95 text-on-surface shadow-lg flex items-center justify-center transition-transform hover:scale-110"
                          aria-label="Next item"
                        >
                          <ChevronRight size={16} strokeWidth={2.4} />
                        </button>
                        <div className="absolute top-4 right-4 rounded-full bg-black/55 backdrop-blur px-3 py-1.5 text-[12px] font-bold text-white tabular-nums pointer-events-none">
                          {activeIdx + 1} / {items.length}
                        </div>
                      </>
                    )}

                    {/* Thumb strip (media step) */}
                    {step === 1 && (
                      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 max-w-[calc(100%-32px)] flex items-center gap-2 rounded-2xl bg-black/55 backdrop-blur-md p-2 overflow-x-auto scrollbar-hide">
                        {items.map((it) => (
                          <button
                            key={it.key}
                            type="button"
                            onClick={() => setActiveKey(it.key)}
                            className={cn(
                              'w-[52px] h-[52px] rounded-[10px] overflow-hidden flex-shrink-0 border-2 transition-colors',
                              it.key === activeKey ? 'border-primary' : 'border-transparent hover:border-white/40',
                            )}
                          >
                            {it.mediaType === 'photo' ? (
                              <img src={it.previewUrl} alt="" draggable={false} className="w-full h-full object-cover" />
                            ) : (
                              <video src={it.previewUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                            )}
                          </button>
                        ))}
                        {!isEditing && items.length < POST_MAX_ITEMS && (
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="w-[52px] h-[52px] rounded-[10px] border-[1.5px] border-dashed border-white/45 hover:border-white text-white/85 flex items-center justify-center flex-shrink-0 transition-colors"
                            aria-label="Add media"
                          >
                            <Plus size={15} strokeWidth={2.4} />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Carousel dots — tag/details steps only (they'd
                        collide with the crop handles on the edit step,
                        and the thumb strip covers the media step). */}
                    {step >= 3 && items.length > 1 && (
                      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 pointer-events-none">
                        {items.map((it) => (
                          <span
                            key={it.key}
                            className={cn(
                              'w-[7px] h-[7px] rounded-full transition-colors',
                              it.key === activeKey ? 'bg-media-white' : 'bg-white/35',
                            )}
                          />
                        ))}
                      </div>
                    )}

                    {/* Drag highlight while media is being dropped in */}
                    {dragActive && step === 1 && (
                      <div className="absolute inset-4 rounded-2xl border-2 border-dashed border-primary bg-primary/15 flex items-center justify-center pointer-events-none">
                        <span className="text-[15px] font-bold text-white drop-shadow">Drop to add</span>
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
                      <ImageIcon size={30} />
                      <VideoIcon size={30} />
                    </div>
                    <span className="text-[15px] font-semibold">
                      {dragActive ? 'Drop your photos and videos' : 'Drag photos and videos here'}
                    </span>
                    <span className="text-[12px] opacity-75">
                      or click to browse · up to {POST_MAX_ITEMS} items · videos up to {POST_VIDEO_MAX_DURATION_SECONDS}s
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
                      {step === 1 && (
                        <div>
                          <div className="flex items-baseline justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/40">Media</span>
                            <span className="text-[12px] font-semibold text-on-surface/45 tabular-nums">{items.length} / {POST_MAX_ITEMS}</span>
                          </div>

                          <div className="flex flex-col gap-2 mt-3">
                            {items.map((it, idx) => {
                              const isActive = it.key === activeKey;
                              return (
                                <div
                                  key={it.key}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => setActiveKey(it.key)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') setActiveKey(it.key); }}
                                  className={cn(
                                    'group flex items-center gap-3 rounded-2xl border-[1.5px] bg-white p-2 pr-3 cursor-pointer transition-all',
                                    isActive
                                      ? 'border-primary shadow-[0_0_0_3px_rgba(159,48,18,0.08)]'
                                      : 'border-on-surface/[0.08] hover:border-on-surface/20',
                                  )}
                                >
                                  <div className="w-[46px] h-[46px] rounded-[10px] overflow-hidden flex-shrink-0 bg-on-surface/[0.06] relative">
                                    {it.mediaType === 'photo' ? (
                                      <img src={it.previewUrl} alt="" draggable={false} className="w-full h-full object-cover" />
                                    ) : (
                                      <video src={it.previewUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                                    )}
                                    {it.mediaType === 'video' && (
                                      <VideoIcon size={11} className="absolute bottom-1 right-1 text-white drop-shadow" />
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-bold leading-tight">
                                      {it.mediaType === 'video' ? 'Video' : 'Photo'} #{idx + 1}
                                    </p>
                                    <p className="text-[11.5px] text-on-surface/45 mt-0.5 truncate">{mediaRowSub(it)}</p>
                                  </div>
                                  {idx === 0 && (
                                    <span className="text-[9.5px] font-bold tracking-[0.08em] text-primary bg-primary/[0.09] rounded-full px-2 py-1 flex-shrink-0">
                                      COVER
                                    </span>
                                  )}
                                  {!isEditing && (
                                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex-shrink-0">
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); onMoveItem(it.key, -1); }}
                                        disabled={idx === 0 || submitting}
                                        className="w-7 h-7 rounded-full hover:bg-on-surface/[0.06] flex items-center justify-center text-on-surface/55 disabled:opacity-25"
                                        aria-label="Move up"
                                      >
                                        <ChevronUp size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); onMoveItem(it.key, 1); }}
                                        disabled={idx === items.length - 1 || submitting}
                                        className="w-7 h-7 rounded-full hover:bg-on-surface/[0.06] flex items-center justify-center text-on-surface/55 disabled:opacity-25"
                                        aria-label="Move down"
                                      >
                                        <ChevronDown size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); onRemoveItem(it.key); }}
                                        disabled={submitting}
                                        className="w-7 h-7 rounded-full hover:bg-rose-50 flex items-center justify-center text-rose-500 disabled:opacity-25"
                                        aria-label="Remove"
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {!isEditing && items.length < POST_MAX_ITEMS && (
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="mt-2.5 w-full flex items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-on-surface/20 py-3.5 text-[13px] font-bold text-primary hover:border-primary hover:bg-primary/[0.03] transition-colors"
                            >
                              <Plus size={15} strokeWidth={2.4} />
                              Add photos &amp; videos
                            </button>
                          )}

                          {validationMsg && (
                            <div className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-[12px] text-rose-700">
                              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                              <span>{validationMsg}</span>
                            </div>
                          )}

                          <p className="text-[12px] leading-relaxed text-on-surface/40 mt-4">
                            The first item is your cover — it's what people see in the feed. Hover a row to reorder or remove it.
                          </p>
                        </div>
                      )}

                      {/* ── STEP 2 · Edit ── */}
                      {step === 2 && activeItem && (
                        <div>
                          <div className="flex items-baseline justify-between mb-4">
                            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/40">
                              Item #{activeIdx + 1}
                            </span>
                            {isEdited(activeItem.edits, activeItem.durationSeconds) && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                                <Check size={10} /> Edited
                              </span>
                            )}
                          </div>
                          <EditorControls
                            item={{
                              key: activeItem.key,
                              mediaType: activeItem.mediaType,
                              file: activeItem.file,
                              previewUrl: activeItem.previewUrl,
                              durationSeconds: activeItem.durationSeconds,
                              edits: activeItem.edits,
                            }}
                            tab={editTab}
                            onTabChange={setEditTab}
                            onEditsChange={(edits) => setItems((prev) => prev.map((it) => it.key === activeItem.key ? { ...it, edits } : it))}
                            selectedTextId={selectedTextId}
                            onSelectTextId={setSelectedTextId}
                            natural={stageNatural}
                          />
                        </div>
                      )}

                      {/* ── STEP 3 · Tag ── */}
                      {step === 3 && (
                        <div>
                          <div className="flex items-baseline justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/40">Per-item details</span>
                            {activeIdx >= 0 && (
                              <span className="text-[12px] font-semibold text-on-surface/45 tabular-nums">#{activeIdx + 1} / {items.length}</span>
                            )}
                          </div>

                          {multiApply && (
                            <div className="mt-3 rounded-2xl border border-primary/30 bg-primary/[0.05] p-3.5">
                              <p className="text-[12.5px] font-bold leading-tight">Copy this featured to other items</p>
                              <p className="text-[11.5px] text-on-surface/55 mt-1 leading-snug">
                                Click cards below to pick targets — the green one is the source.
                              </p>
                              <div className="flex items-center justify-between gap-2 mt-2.5">
                                <span className="text-[12px] font-semibold text-on-surface/65 tabular-nums">
                                  {multiApply.targets.size} selected
                                </span>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={cancelMultiApply}
                                    className="px-3 h-8 rounded-full text-[12px] font-bold text-on-surface/70 hover:bg-on-surface/[0.05]"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={confirmMultiApply}
                                    disabled={multiApply.targets.size === 0}
                                    className={cn(
                                      'inline-flex items-center gap-1 px-3.5 h-8 rounded-full text-[12px] font-bold transition-colors',
                                      multiApply.targets.size > 0
                                        ? 'bg-primary text-white hover:bg-primary/90'
                                        : 'bg-on-surface/10 text-on-surface/35 cursor-not-allowed',
                                    )}
                                  >
                                    <Check size={12} /> Apply
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="flex flex-col gap-2.5 mt-3">
                            {items.map((it, idx) => {
                              const isActive = it.key === activeKey;
                              const inMulti = !!multiApply;
                              const isSource = inMulti && it.key === multiApply.sourceKey;
                              const isTarget = inMulti && multiApply.targets.has(it.key);
                              const featuredName = it.attachedKind === 'restaurant' ? it.restaurant?.name : it.recipe?.title;
                              const prev = idx > 0 ? items[idx - 1] : null;
                              return (
                                <div
                                  key={it.key}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => { if (inMulti) toggleMultiApplyTarget(it.key); else setActiveKey(it.key); }}
                                  className={cn(
                                    'rounded-2xl border-[1.5px] bg-white p-3 cursor-pointer transition-all',
                                    !inMulti && isActive && 'border-primary shadow-[0_0_0_3px_rgba(159,48,18,0.08)]',
                                    !inMulti && !isActive && 'border-on-surface/[0.08] hover:border-on-surface/20',
                                    inMulti && isSource && 'border-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.1)]',
                                    inMulti && isTarget && 'border-primary shadow-[0_0_0_3px_rgba(159,48,18,0.08)]',
                                    inMulti && !isSource && !isTarget && 'border-on-surface/[0.08] opacity-70',
                                  )}
                                >
                                  <div className="flex items-center gap-2.5">
                                    <div className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0 bg-on-surface/[0.06]">
                                      {it.mediaType === 'photo' ? (
                                        <img src={it.previewUrl} alt="" draggable={false} className="w-full h-full object-cover" />
                                      ) : (
                                        <video src={it.previewUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                                      )}
                                    </div>
                                    <span className="text-[12.5px] font-bold">Item #{idx + 1}</span>
                                    <span className="text-[10px] font-bold tracking-[0.08em] text-on-surface/35 uppercase">{it.mediaType}</span>
                                    {isSource && (
                                      <span className="ml-auto px-2 py-0.5 rounded bg-emerald-600 text-white text-[9px] font-bold uppercase tracking-wider">Source</span>
                                    )}
                                    {inMulti && !isSource && (
                                      <span className={cn(
                                        'ml-auto inline-flex items-center justify-center w-5 h-5 rounded-full transition-colors',
                                        isTarget ? 'bg-primary text-white' : 'bg-on-surface/10 text-transparent',
                                      )}>
                                        <Check size={11} strokeWidth={3} />
                                      </span>
                                    )}
                                  </div>

                                  {!inMulti && (
                                    <>
                                      <input
                                        type="text"
                                        value={it.caption}
                                        onChange={(e) => setItems((prevItems) => prevItems.map((p) => p.key === it.key ? { ...p, caption: e.target.value } : p))}
                                        onClick={(e) => e.stopPropagation()}
                                        placeholder="Caption this item (optional)"
                                        maxLength={280}
                                        disabled={submitting}
                                        className="w-full mt-2.5 rounded-xl bg-on-surface/[0.03] border-[1.5px] border-on-surface/[0.07] px-3 py-2 text-[13px] placeholder:text-on-surface/35 focus:outline-none focus:border-primary/50 disabled:opacity-50 transition-colors"
                                      />
                                      <div className="flex items-center gap-1.5 mt-2">
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); setActiveKey(it.key); setPickerOpen('restaurant'); setRestaurantSearch(''); }}
                                          disabled={submitting}
                                          className={cn(
                                            'flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 h-8 rounded-full text-[11.5px] font-bold border-[1.5px] transition-colors disabled:opacity-40',
                                            it.attachedKind === 'restaurant'
                                              ? 'bg-primary/[0.08] border-primary text-primary'
                                              : 'bg-on-surface/[0.03] border-on-surface/[0.08] text-on-surface/60 hover:border-on-surface/25',
                                          )}
                                        >
                                          <MapPin size={11} className="flex-shrink-0" />
                                          <span className="truncate">
                                            {it.attachedKind === 'restaurant' ? featuredName || 'Restaurant' : 'Restaurant'}
                                          </span>
                                          {it.attachedKind === 'restaurant' && <Check size={11} className="flex-shrink-0" />}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); setActiveKey(it.key); setPickerOpen('recipe'); setRecipeSearch(''); }}
                                          disabled={submitting}
                                          className={cn(
                                            'flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 h-8 rounded-full text-[11.5px] font-bold border-[1.5px] transition-colors disabled:opacity-40',
                                            it.attachedKind === 'recipe'
                                              ? 'bg-primary/[0.08] border-primary text-primary'
                                              : 'bg-on-surface/[0.03] border-on-surface/[0.08] text-on-surface/60 hover:border-on-surface/25',
                                          )}
                                        >
                                          <ChefHat size={11} className="flex-shrink-0" />
                                          <span className="truncate">
                                            {it.attachedKind === 'recipe' ? featuredName || 'Recipe' : 'Recipe'}
                                          </span>
                                          {it.attachedKind === 'recipe' && <Check size={11} className="flex-shrink-0" />}
                                        </button>
                                        {it.attachedKind && (
                                          <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); clearAttachment(it.key); }}
                                            disabled={submitting}
                                            className="w-8 h-8 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center text-on-surface/55 flex-shrink-0"
                                            aria-label="Clear featured"
                                          >
                                            <X size={12} />
                                          </button>
                                        )}
                                      </div>

                                      {/* Shortcuts: same-as-previous / apply-to-all / specific */}
                                      {!it.attachedKind && prev?.attachedKind && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            applyAttachmentToItem(it.key, prev.attachedKind!, { restaurant: prev.restaurant, recipe: prev.recipe });
                                          }}
                                          disabled={submitting}
                                          className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-primary/90 hover:text-primary"
                                        >
                                          <Link2 size={11} />
                                          Use the same as #{idx}
                                        </button>
                                      )}
                                      {it.attachedKind && items.length > 1 && (
                                        <div className="flex items-center gap-3.5 mt-2">
                                          <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); applyAttachmentToAll(it.key); }}
                                            disabled={submitting}
                                            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:text-primary/80"
                                          >
                                            <Link2 size={11} /> Apply to all
                                          </button>
                                          <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); setActiveKey(it.key); startMultiApply(it.key); }}
                                            disabled={submitting}
                                            className="text-[11.5px] font-semibold text-on-surface/55 hover:text-on-surface"
                                          >
                                            Apply to specific…
                                          </button>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          <p className="text-[12px] leading-relaxed text-on-surface/40 mt-4">
                            Items without a caption use the post caption. Feature a restaurant or recipe to link it on the item.
                          </p>
                        </div>
                      )}

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
                              value={postCaption}
                              onChange={(e) => setPostCaption(e.target.value)}
                              placeholder="Write a caption…"
                              rows={5}
                              maxLength={280}
                              disabled={submitting}
                              className="w-full rounded-2xl bg-white border-[1.5px] border-on-surface/[0.08] px-3.5 py-3 text-sm leading-relaxed placeholder:text-on-surface/35 focus:outline-none focus:border-primary/50 focus:shadow-[0_0_0_3px_rgba(159,48,18,0.07)] resize-none disabled:opacity-50 transition-all"
                            />
                            <div className="text-right text-[11px] font-semibold text-on-surface/35 mt-1 tabular-nums">{postCaption.length} / 280</div>
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
                              {([
                                { value: true, label: 'Public', sub: 'Anyone on Gourmet Canvas can see this', Icon: Globe },
                                { value: false, label: 'Followers only', sub: 'Only people who follow you', Icon: UsersIcon },
                              ] as const).map((opt) => {
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
                {(!user?.id || errorMsg) && !sharedPost && (
                  <div className="px-6 pb-4 pt-2 space-y-2 flex-shrink-0">
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
              </div>
            </div>

            {/* ── Success overlay ── */}
            {successOverlay}
          </motion.div>
          )}

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
