/**
 * AddPostModal — create a multi-media post (1–15 photos / videos, mixed)
 * with per-item captions and per-item featured restaurant or recipe.
 *
 * UX:
 *   1. Empty state: a drop zone for files (multi-select, drag-and-drop).
 *   2. With items present: a horizontal strip of thumbnails. Tap one to
 *      make it the "active" item. The strip has a "+" tile to add more.
 *   3. The active-item editor shows below the strip:
 *        • Per-item caption.
 *        • Per-item featured attachment (restaurant or recipe). Once an
 *          item has an attachment, an "Apply to all" pill appears so the
 *          user can clone it onto the rest in one tap. There's also an
 *          "Apply to next…" affordance for partial cloning.
 *        • Reorder buttons + remove.
 *   4. Post-level fields below: location (free-text label that surfaces
 *      under the caption when viewing), audio label, post-level caption,
 *      visibility toggle.
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
  key: string;            // local id
  file: File;
  mediaType: PostMediaType;
  previewUrl: string;     // object URL
  caption: string;
  durationSeconds: number | null;
  attachedKind: PostAttachedKind | null;
  restaurant?: PostRestaurantSnapshot;
  recipe?: PostRecipeSnapshot;
  bgGradient: string;
}

const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|mkv|avi|3gp|qt|hevc)$/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|heic|heif|avif)$/i;

function detectMediaType(file: File): PostMediaType | null {
  if (file.type.startsWith('video/') || VIDEO_EXT_RE.test(file.name)) return 'video';
  if (file.type.startsWith('image/') || IMAGE_EXT_RE.test(file.name)) return 'photo';
  return null;
}

/* ── The modal ──────────────────────────────────────────────────────── */

export const AddPostModal: React.FC = () => {
  const { addPostModalOpen, closeAddPostModal, createPost } = usePosts();
  const { ratings, wishlist, restaurantMeta, homeMeals } = useLists();
  const { profile, user } = useAuth();
  const { phoneMode } = useSettings();
  const { showToast } = useToast();

  const [items, setItems] = useState<WorkingItem[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [postCaption, setPostCaption] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [audio, setAudio] = useState('Original audio');
  const [isPublic, setIsPublic] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const dragActive = dragDepth > 0;
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Reset on open
  useEffect(() => {
    if (!addPostModalOpen) return;
    setItems([]);
    setActiveKey(null);
    setPostCaption('');
    setLocationLabel('');
    setAudio('Original audio');
    setIsPublic(true);
    setSubmitting(false);
    setProgress(0);
    setErrorMsg(null);
    setValidationMsg(null);
    setDragDepth(0);
    setPickerOpen(null);
    setRestaurantSearch('');
    setRecipeSearch('');
    setPlaceResults([]);
    setSearchingPlaces(false);
  }, [addPostModalOpen]);

  // Revoke any object URLs on unmount or when items shrink.
  useEffect(() => {
    return () => {
      for (const it of items) URL.revokeObjectURL(it.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      });
    }
    if (accepted.length === 0) return;
    setItems((prev) => [...prev, ...accepted]);
    if (!activeKey) setActiveKey(accepted[0].key);
  };

  const onRemoveItem = (key: string) => {
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

  /* ── Submit ── */

  const canSubmit = items.length > 0 && !!user?.id && !submitting;

  const onSubmit = async () => {
    if (!canSubmit || !user?.id) return;
    setErrorMsg(null);
    setSubmitting(true);
    setProgress(0.05);
    try {
      const newItems: NewPostItem[] = items.map((it) => ({
        file: it.file,
        mediaType: it.mediaType,
        caption: it.caption.trim(),
        durationSeconds: it.durationSeconds,
        bgGradient: it.bgGradient,
        attachedKind: it.attachedKind,
        restaurant: it.restaurant,
        recipe: it.recipe,
      }));
      const post = await createPost({
        caption: postCaption.trim(),
        locationLabel: locationLabel.trim(),
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
                : 'h-full sm:max-w-xl sm:max-h-[92vh] sm:h-[92vh] rounded-none sm:rounded-3xl',
            )}
          >
            {/* Header */}
            <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-on-surface/[0.06] flex-shrink-0">
              <div>
                <h2 className="font-serif font-bold text-lg leading-tight">New post</h2>
                <p className="text-[12px] text-on-surface/45 mt-0.5">
                  Up to {POST_MAX_ITEMS} photos / videos. Each can have its own caption + featured.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { if (!submitting) closeAddPostModal(); }}
                disabled={submitting}
                className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center text-on-surface/70 disabled:opacity-40"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div
              className="flex-1 min-h-0 overflow-y-auto px-5 pt-4 pb-32 space-y-5 relative"
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
                      return (
                        <button
                          key={it.key}
                          type="button"
                          onClick={() => setActiveKey(it.key)}
                          className={cn(
                            'relative flex-shrink-0 w-20 aspect-[9/14] rounded-xl overflow-hidden snap-start transition-all',
                            isActive
                              ? 'ring-2 ring-primary ring-offset-2 ring-offset-surface'
                              : 'ring-1 ring-on-surface/[0.08]',
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
                          {hasAttach && (
                            <span className="absolute top-1 left-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-white">
                              {it.attachedKind === 'restaurant' ? <MapPin size={10} /> : <ChefHat size={10} />}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {items.length < POST_MAX_ITEMS && (
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

              {/* Active item editor */}
              {activeItem && (
                <section className="rounded-2xl border border-on-surface/[0.08] p-4 space-y-4 bg-on-surface/[0.02]">
                  {/* Reorder + remove */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-on-surface/45">
                      Item #{activeIdx + 1}
                      <span className="ml-1 text-on-surface/30 font-medium">— {activeItem.mediaType}</span>
                    </div>
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
                    )}

                    {/* Apply-to-all */}
                    {activeItem.attachedKind && items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => applyAttachmentToAll(activeItem.key)}
                        disabled={submitting}
                        className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:text-primary/80 transition-colors"
                      >
                        <Link2 size={12} />
                        Apply to all {items.length} items
                      </button>
                    )}
                  </div>
                </section>
              )}

              {/* Post-level fields */}
              {items.length > 0 && (
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

                  <section>
                    <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface/45 mb-2">Location</label>
                    <div className="flex items-center gap-2 rounded-full bg-on-surface/[0.04] border border-on-surface/[0.06] px-4 h-11">
                      <MapPin size={15} className="text-on-surface/45 flex-shrink-0" />
                      <input
                        value={locationLabel}
                        onChange={(e) => setLocationLabel(e.target.value)}
                        placeholder="e.g. West Village, Manhattan"
                        disabled={submitting}
                        maxLength={100}
                        className="flex-1 bg-transparent text-sm placeholder:text-on-surface/35 focus:outline-none disabled:opacity-50"
                      />
                    </div>
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

              {/* Auth notice */}
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

            {/* Footer */}
            <div className="border-t border-on-surface/[0.06] px-5 py-3 bg-surface flex items-center gap-3 flex-shrink-0">
              <button
                type="button"
                onClick={() => { if (!submitting) closeAddPostModal(); }}
                disabled={submitting}
                className="px-4 h-11 rounded-full text-sm font-semibold text-on-surface/65 hover:bg-on-surface/[0.05] disabled:opacity-40"
              >
                Cancel
              </button>
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
                    Uploading… {Math.round(progress * 100)}%
                  </>
                ) : (
                  <>
                    <Upload size={15} />
                    {items.length === 0 ? 'Post' : `Post ${items.length} ${items.length === 1 ? 'item' : 'items'}`}
                  </>
                )}
                {submitting && (
                  <span className="absolute left-0 bottom-0 h-0.5 bg-white/40" style={{ width: `${Math.round(progress * 100)}%`, transition: 'width 200ms ease-out' }} />
                )}
              </button>
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
