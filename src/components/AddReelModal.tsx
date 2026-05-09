import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X, Film, ChefHat, MapPin, Search, Check, Upload, Music2, Trash2, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  useReels,
  readVideoDuration,
  REEL_MAX_DURATION_SECONDS,
  REEL_MAX_BYTES,
  type ReelKind,
} from '../contexts/ReelsContext';
import { useLists } from '../contexts/ListsContext';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { searchPlacesByText, priceLevelToString, CUISINE_TYPES, type PlaceResult } from '../lib/places';

// Build a Google Places type → human label lookup once (e.g.
// "italian_restaurant" → "Italian"). The first matching type on a
// Places result becomes the cuisine label we display.
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

// Default location bias for the Places search if we can't read geolocation.
// (Mid-NYC; matches the rest of the app's default.)
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

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/* ── Modal ──────────────────────────────────────────────────────────── */

export const AddReelModal: React.FC = () => {
  const { addReelModalOpen, addReelInitialKind, closeAddReelModal, postReel } = useReels();
  const { ratings, wishlist, restaurantMeta, homeMeals } = useLists();
  const { profile, user } = useAuth();
  const { phoneMode } = useSettings();
  const { showToast } = useToast();

  const [kind, setKind] = useState<ReelKind>(addReelInitialKind ?? 'restaurant');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [caption, setCaption] = useState('');
  const [audio, setAudio] = useState('Original audio');
  const [pickedRestaurantId, setPickedRestaurantId] = useState<string | null>(null);
  const [pickedRecipeId, setPickedRecipeId] = useState<string | null>(null);
  const [restaurantSearch, setRestaurantSearch] = useState('');
  const [recipeSearch, setRecipeSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  // Drag depth counter — dragenter / dragleave fire for child elements too,
  // so we keep a counter to know when the cursor is *really* outside the zone.
  const [dragDepth, setDragDepth] = useState(0);
  const dragActive = dragDepth > 0;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Restaurant search (Google Places) ──
  // Lets the user attach ANY restaurant, not just ones they've rated. We
  // bias the query by the user's location when available so local matches
  // float to the top, but Google still returns global results.
  const [userLat, setUserLat] = useState<number>(DEFAULT_LAT);
  const [userLng, setUserLng] = useState<number>(DEFAULT_LNG);
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const placeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPlaceQueryRef = useRef<string>('');

  // Reset state whenever the modal is reopened.
  useEffect(() => {
    if (!addReelModalOpen) return;
    setKind(addReelInitialKind ?? 'restaurant');
    setVideoFile(null);
    setVideoUrl(null);
    setVideoDuration(null);
    setCaption('');
    setAudio('Original audio');
    setPickedRestaurantId(null);
    setPickedRecipeId(null);
    setRestaurantSearch('');
    setRecipeSearch('');
    setPlaceResults([]);
    setSearchingPlaces(false);
    setSubmitting(false);
    setProgress(0);
    setErrorMsg(null);
    setValidationMsg(null);
    setDragDepth(0);
  }, [addReelModalOpen, addReelInitialKind]);

  // Revoke the preview URL when it's replaced or the modal closes.
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  // Best-effort geolocation lookup for biasing the Places query — runs once
  // per modal-open so we don't spam permission prompts. Failure is silent;
  // we just keep the NYC-default bias.
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
      () => { /* permission denied or timeout — keep default bias */ },
      { timeout: 5000 },
    );
    return () => { cancelled = true; };
  }, [addReelModalOpen]);

  // Debounced Places API search. Runs only when the user is on the
  // Restaurant tab and has typed at least 2 chars. Results are merged
  // with the local rated/wishlisted set in restaurantPickList below.
  useEffect(() => {
    if (!addReelModalOpen || kind !== 'restaurant') return;
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
        // Discard stale responses if the query changed mid-flight.
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
  }, [addReelModalOpen, kind, restaurantSearch, userLat, userLng]);

  // Strip base64 data: URLs from the picker — rendering 20+ of them in a
  // dropdown decodes/rasterizes hundreds of megabytes simultaneously, which
  // is what was making the modal lag and crash on lower-spec devices. The
  // attached snapshot also keeps these out of the JSONB column we send to
  // Supabase, which keeps reel rows small.
  const safePickerImage = (url: string | undefined | null): string | undefined => {
    if (!url || typeof url !== 'string') return undefined;
    if (url.startsWith('data:')) return undefined;
    return url;
  };

  const PICKER_LIMIT = 20;

  // ── Restaurant pick list ──
  // Combines the user's local rated/wishlisted/seen restaurants with live
  // Google Places results so they can attach ANY restaurant. Score is only
  // attached when the user has rated that specific place — Places API's own
  // public rating is intentionally not surfaced here (the reel card shows
  // the *poster's* rating, not Google's average).
  const restaurantPickList = useMemo(() => {
    type Item = { id: string; name: string; cuisine: string; price: string; address: string; image?: string; score?: number; fromUser: boolean };
    if (!addReelModalOpen) return [] as Item[];

    const q = restaurantSearch.trim().toLowerCase();
    const seen = new Set<string>();
    const items: Item[] = [];

    // Step 1: local items (rated → wishlist → meta), filtered by query.
    const ratingScoreById = new Map<string, number>();
    for (const r of ratings) {
      ratingScoreById.set(r.restaurantId, r.score);
      if (seen.has(r.restaurantId)) continue;
      const passesQ = !q || `${r.name} ${r.cuisine} ${r.address}`.toLowerCase().includes(q);
      if (!passesQ) continue;
      seen.add(r.restaurantId);
      items.push({
        id: r.restaurantId,
        name: r.name,
        cuisine: r.cuisine,
        price: r.price,
        address: r.address,
        image: safePickerImage(r.image),
        score: r.score,
        fromUser: true,
      });
    }
    for (const w of wishlist) {
      if (seen.has(w.restaurantId)) continue;
      const passesQ = !q || `${w.name} ${w.cuisine} ${w.address}`.toLowerCase().includes(q);
      if (!passesQ) continue;
      seen.add(w.restaurantId);
      items.push({
        id: w.restaurantId,
        name: w.name,
        cuisine: w.cuisine,
        price: w.price,
        address: w.address,
        image: safePickerImage(w.image),
        score: ratingScoreById.get(w.restaurantId),
        fromUser: true,
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
        id,
        name: meta.name,
        cuisine: meta.cuisine || '',
        price: meta.price || '',
        address: meta.address || '',
        image: safePickerImage(meta.image),
        score: ratingScoreById.get(id),
        fromUser: true,
      });
    }

    // Step 2: Places API results — only when the user is searching. Skip any
    // ids we already have locally (the local entry wins so the user's score
    // is preserved).
    if (q) {
      for (const p of placeResults) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        items.push({
          id: p.id,
          name: p.name,
          cuisine: cuisineFromTypes(p.types),
          price: priceLevelToString(p.priceLevel) || '',
          address: p.address || p.fullAddress || '',
          image: undefined,
          // Score = user's own rating only. If they haven't rated this
          // place, leave it undefined so the reel card hides the chip.
          score: ratingScoreById.get(p.id),
          fromUser: false,
        });
      }
    }

    return items.slice(0, q ? 30 : PICKER_LIMIT);
  }, [addReelModalOpen, ratings, wishlist, restaurantMeta, restaurantSearch, placeResults]);

  // ── Recipe pick list ──
  // Source: only the user's Home Cooking entries (homeMeals). The cloud
  // `myRecipes` table sometimes contains rows that look like restaurants
  // (legacy import data) and confuses the picker — the user explicitly
  // wants this list to mirror the Pantry's "Home Cooking" view.
  const recipePickList = useMemo(() => {
    type Item = { id: string; title: string; prepTime: number; cookTime: number; servings: number; difficulty: 'Easy' | 'Medium' | 'Hard'; image?: string };
    if (!addReelModalOpen) return [] as Item[];
    const items: Item[] = homeMeals.map((m) => ({
      id: m.id,
      title: m.name,
      prepTime: m.prepTime ?? 0,
      cookTime: m.cookTime ?? 0,
      servings: m.servings ?? 0,
      difficulty: m.difficulty ?? 'Easy',
      image: safePickerImage(m.coverPhoto || m.photos?.[0]?.url),
    }));
    const q = recipeSearch.trim().toLowerCase();
    if (!q) return items.slice(0, PICKER_LIMIT);
    return items.filter((it) => it.title.toLowerCase().includes(q)).slice(0, PICKER_LIMIT);
  }, [addReelModalOpen, homeMeals, recipeSearch]);

  const pickedRestaurant = useMemo(
    () => restaurantPickList.find((r) => r.id === pickedRestaurantId) ?? null,
    [restaurantPickList, pickedRestaurantId],
  );
  const pickedRecipe = useMemo(
    () => recipePickList.find((r) => r.id === pickedRecipeId) ?? null,
    [recipePickList, pickedRecipeId],
  );

  // ── Drag-and-drop handlers ──
  // Applied to the modal scroll container so the user can drop the video
  // anywhere inside the dialog. We still highlight only the dedicated
  // drop zone visually so the intent is unambiguous.
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
    const file = e.dataTransfer?.files?.[0];
    if (file) onPickFile(file);
  };

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    setValidationMsg(null);
    setErrorMsg(null);
    // Some OS pickers (Finder, certain Linux desktops) hand us a File whose
    // .type is empty even for clearly-video extensions. Accept anything
    // that's either MIME-tagged video or has a known video extension —
    // readVideoDuration() below is the real arbiter.
    const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|mkv|avi|3gp|qt|hevc)$/i;
    const looksLikeVideo = file.type.startsWith('video/') || VIDEO_EXT_RE.test(file.name);
    if (!looksLikeVideo) {
      setValidationMsg('Please pick a video file.');
      return;
    }
    if (file.size > REEL_MAX_BYTES) {
      setValidationMsg(`Video is ${formatBytes(file.size)} — max ${formatBytes(REEL_MAX_BYTES)}.`);
      return;
    }

    // Probe duration before accepting the file. If the browser can't decode
    // it (rare HEVC/.mov containers, codec issues), we fail with a useful
    // error so the user can re-encode.
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

  const canSubmit =
    !!videoFile
    && !!user?.id
    && (kind === 'restaurant' ? !!pickedRestaurant : !!pickedRecipe)
    && !submitting;

  const onSubmit = async () => {
    if (!canSubmit || !videoFile || !user?.id) return;
    setErrorMsg(null);
    setSubmitting(true);
    setProgress(0.05);
    try {
      const bgGradient = pickFromPool(BG_GRADIENT_POOL, videoFile.name + user.id);
      const reel = await postReel({
        file: videoFile,
        kind,
        caption: caption.trim(),
        audioLabel: audio.trim() || 'Original audio',
        bgGradient,
        durationSeconds: videoDuration ?? 0,
        restaurant: kind === 'restaurant' && pickedRestaurant
          ? {
            id: pickedRestaurant.id,
            name: pickedRestaurant.name,
            cuisine: pickedRestaurant.cuisine,
            price: pickedRestaurant.price,
            address: pickedRestaurant.address,
            image: pickedRestaurant.image,
            score: pickedRestaurant.score,
          }
          : undefined,
        recipe: kind === 'recipe' && pickedRecipe
          ? {
            id: pickedRecipe.id,
            title: pickedRecipe.title,
            prepTime: pickedRecipe.prepTime,
            cookTime: pickedRecipe.cookTime,
            servings: pickedRecipe.servings,
            difficulty: pickedRecipe.difficulty,
            image: pickedRecipe.image,
          }
          : undefined,
        onProgress: (n) => setProgress(n),
      });
      if (!reel) throw new Error("Couldn't create the reel — try again.");
      showToast('Reel posted', { subtitle: 'It\'s live in the feed' });
      closeAddReelModal();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setErrorMsg(msg);
      setProgress(0);
    } finally {
      setSubmitting(false);
    }
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
            <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-on-surface/[0.06] flex-shrink-0">
              <div>
                <h2 className="font-serif font-bold text-lg leading-tight">Post a reel</h2>
                <p className="text-[12px] text-on-surface/45 mt-0.5">
                  Up to {REEL_MAX_DURATION_SECONDS}s. Public to everyone.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { if (!submitting) closeAddReelModal(); }}
                disabled={submitting}
                className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center text-on-surface/70 transition-colors disabled:opacity-40"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div
              className="flex-1 min-h-0 overflow-y-auto px-5 pt-4 pb-32 space-y-6 relative"
              onDragEnter={onDragEnter}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              {/* Kind toggle */}
              <div className="flex p-1 rounded-full bg-on-surface/[0.06]">
                {(['restaurant', 'recipe'] as const).map((k) => {
                  const active = kind === k;
                  const Icon = k === 'restaurant' ? MapPin : ChefHat;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      disabled={submitting}
                      className={cn(
                        'flex-1 h-10 rounded-full text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-40',
                        active ? 'bg-white shadow text-on-surface' : 'text-on-surface/55',
                      )}
                    >
                      <Icon size={15} />
                      {k === 'restaurant' ? 'Restaurant' : 'Recipe'}
                    </button>
                  );
                })}
              </div>

              {/* Video upload */}
              <section>
                <div className="flex items-baseline justify-between mb-2">
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface/45">Video</label>
                  {videoDuration != null && (
                    <span className="text-[11px] text-on-surface/40 tabular-nums">
                      {videoDuration.toFixed(1)}s · max {REEL_MAX_DURATION_SECONDS}s
                    </span>
                  )}
                </div>
                {/*
                  Some OS file dialogs (especially macOS Finder) match files
                  against `accept` *only* by MIME and gray out anything they
                  can't classify — that's why .mov files from Photos can show
                  up disabled. Listing common extensions explicitly lets the
                  picker fall back to extension matching, then we still
                  validate it's actually a video in onPickFile().
                */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi,.3gp,.qt,.hevc"
                  className="hidden"
                  onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                />
                {videoUrl ? (
                  <div className="relative rounded-2xl overflow-hidden bg-black aspect-[9/16] max-h-[420px] mx-auto">
                    <video src={videoUrl} className="w-full h-full object-cover" controls playsInline muted />
                    <button
                      type="button"
                      onClick={() => {
                        if (videoUrl) URL.revokeObjectURL(videoUrl);
                        setVideoUrl(null);
                        setVideoFile(null);
                        setVideoDuration(null);
                      }}
                      disabled={submitting}
                      className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 backdrop-blur flex items-center justify-center text-white disabled:opacity-40"
                      aria-label="Remove video"
                    >
                      <Trash2 size={15} />
                    </button>
                    {/* Drop overlay so a user dragging a new video over an
                        already-picked one knows the drop will replace it. */}
                    {dragActive && !submitting && (
                      <div className="absolute inset-0 bg-primary/60 backdrop-blur-sm flex flex-col items-center justify-center gap-1 text-white pointer-events-none">
                        <Film size={28} />
                        <span className="text-sm font-bold">Drop to replace</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      'w-full rounded-2xl border-2 border-dashed transition-colors',
                      'flex flex-col items-center justify-center gap-2 py-12',
                      dragActive
                        ? 'border-primary bg-primary/[0.08] text-primary'
                        : 'border-on-surface/15 text-on-surface/55 hover:border-primary/50 hover:bg-primary/[0.03]',
                    )}
                  >
                    <Film
                      size={28}
                      className={cn(dragActive ? 'text-primary' : 'text-on-surface/40')}
                    />
                    <span className="text-sm font-semibold">
                      {dragActive ? 'Drop your video' : 'Choose or drag a video'}
                    </span>
                    <span className={cn('text-[11px]', dragActive ? 'text-primary/80' : 'text-on-surface/40')}>
                      MP4, MOV — up to {REEL_MAX_DURATION_SECONDS}s · {formatBytes(REEL_MAX_BYTES)}
                    </span>
                  </button>
                )}

                {validationMsg && (
                  <div className="mt-2 flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-[12px] text-rose-700">
                    <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                    <span>{validationMsg}</span>
                  </div>
                )}
              </section>

              {/* Caption */}
              <section>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface/45 mb-2">Caption</label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="What's the story? Why should people pull up?"
                  rows={3}
                  maxLength={280}
                  disabled={submitting}
                  className="w-full rounded-2xl bg-on-surface/[0.04] border border-on-surface/[0.06] px-4 py-3 text-sm placeholder:text-on-surface/35 focus:outline-none focus:border-primary/40 resize-none disabled:opacity-50"
                />
                <div className="text-right text-[11px] text-on-surface/35 mt-1 tabular-nums">{caption.length} / 280</div>
              </section>

              {/* Audio label */}
              <section>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface/45 mb-2">Audio</label>
                <div className="flex items-center gap-2 rounded-full bg-on-surface/[0.04] border border-on-surface/[0.06] px-4 h-11">
                  <Music2 size={15} className="text-on-surface/45 flex-shrink-0" />
                  <input
                    value={audio}
                    onChange={(e) => setAudio(e.target.value)}
                    placeholder="Original audio"
                    disabled={submitting}
                    className="flex-1 bg-transparent text-sm placeholder:text-on-surface/35 focus:outline-none disabled:opacity-50"
                    maxLength={60}
                  />
                </div>
              </section>

              {/* Restaurant or recipe picker */}
              {kind === 'restaurant' ? (
                <section>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface/45 mb-2">Featured restaurant</label>
                  {pickedRestaurant ? (
                    <PickedPill
                      name={pickedRestaurant.name}
                      meta={[pickedRestaurant.cuisine, pickedRestaurant.price].filter(Boolean).join(' · ')}
                      image={pickedRestaurant.image}
                      onClear={() => setPickedRestaurantId(null)}
                      disabled={submitting}
                    />
                  ) : (
                    <>
                      <div className="flex items-center gap-2 rounded-full bg-on-surface/[0.04] border border-on-surface/[0.06] px-4 h-11 mb-2">
                        <Search size={15} className="text-on-surface/45 flex-shrink-0" />
                        <input
                          value={restaurantSearch}
                          onChange={(e) => setRestaurantSearch(e.target.value)}
                          placeholder="Search any restaurant…"
                          className="flex-1 bg-transparent text-sm placeholder:text-on-surface/35 focus:outline-none"
                        />
                        {searchingPlaces && (
                          <Loader2 size={14} className="text-on-surface/40 animate-spin flex-shrink-0" />
                        )}
                      </div>
                      {restaurantPickList.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-on-surface/10 px-4 py-6 text-center text-[12px] text-on-surface/45">
                          {searchingPlaces ? 'Searching…' : restaurantSearch.trim().length === 0
                            ? 'Rate or wishlist a restaurant to start, or just type to search any place.'
                            : 'No matches.'}
                        </div>
                      ) : (
                        <ul className="rounded-2xl border border-on-surface/[0.06] divide-y divide-on-surface/[0.06] max-h-[260px] overflow-y-auto">
                          {restaurantPickList.map((r) => (
                            <li key={r.id}>
                              <button
                                type="button"
                                onClick={() => setPickedRestaurantId(r.id)}
                                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-on-surface/[0.04] text-left"
                              >
                                <div className="w-10 h-10 rounded-xl bg-on-surface/[0.06] overflow-hidden flex-shrink-0 flex items-center justify-center">
                                  {r.image ? (
                                    <img
                                      src={r.image}
                                      alt=""
                                      loading="lazy"
                                      decoding="async"
                                      className="w-full h-full object-cover"
                                      referrerPolicy="no-referrer"
                                    />
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
                      )}
                    </>
                  )}
                </section>
              ) : (
                <section>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface/45 mb-2">Featured recipe</label>
                  {pickedRecipe ? (
                    <PickedPill
                      name={pickedRecipe.title}
                      meta={`${(pickedRecipe.prepTime + pickedRecipe.cookTime) || 0} min · ${pickedRecipe.servings || 0} servings · ${pickedRecipe.difficulty}`}
                      image={pickedRecipe.image}
                      onClear={() => setPickedRecipeId(null)}
                      disabled={submitting}
                    />
                  ) : (
                    <>
                      <div className="flex items-center gap-2 rounded-full bg-on-surface/[0.04] border border-on-surface/[0.06] px-4 h-11 mb-2">
                        <Search size={15} className="text-on-surface/45 flex-shrink-0" />
                        <input
                          value={recipeSearch}
                          onChange={(e) => setRecipeSearch(e.target.value)}
                          placeholder="Search your home cooking…"
                          className="flex-1 bg-transparent text-sm placeholder:text-on-surface/35 focus:outline-none"
                        />
                      </div>
                      {recipePickList.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-on-surface/10 px-4 py-6 text-center text-[12px] text-on-surface/45">
                          No home cooking entries yet. Add one in the Pantry's Home Cooking list first to attach it here.
                        </div>
                      ) : (
                        <ul className="rounded-2xl border border-on-surface/[0.06] divide-y divide-on-surface/[0.06] max-h-[260px] overflow-y-auto">
                          {recipePickList.map((r) => (
                            <li key={r.id}>
                              <button
                                type="button"
                                onClick={() => setPickedRecipeId(r.id)}
                                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-on-surface/[0.04] text-left"
                              >
                                <div className="w-10 h-10 rounded-xl bg-blue-50 overflow-hidden flex-shrink-0 flex items-center justify-center">
                                  {r.image ? (
                                    <img
                                      src={r.image}
                                      alt=""
                                      loading="lazy"
                                      decoding="async"
                                      className="w-full h-full object-cover"
                                    />
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
                      )}
                    </>
                  )}
                </section>
              )}

              {/* Auth notice */}
              {!user?.id && (
                <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                  <span>Sign in to post reels.</span>
                </div>
              )}

              {/* Submit error */}
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
                onClick={closeAddReelModal}
                disabled={submitting}
                className="px-4 h-11 rounded-full text-sm font-semibold text-on-surface/65 hover:bg-on-surface/[0.05] transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
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
                    Uploading… {Math.round(progress * 100)}%
                  </>
                ) : (
                  <>
                    <Upload size={15} />
                    Post reel
                  </>
                )}
                {submitting && (
                  <span
                    className="absolute left-0 bottom-0 h-0.5 bg-white/40"
                    style={{ width: `${Math.round(progress * 100)}%`, transition: 'width 200ms ease-out' }}
                  />
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ── Picked-pill chip used for both restaurant and recipe ──────────── */

const PickedPill: React.FC<{ name: string; meta: string; image?: string; onClear: () => void; disabled?: boolean }> = ({ name, meta, image, onClear, disabled }) => (
  <div className="flex items-center gap-3 rounded-2xl bg-primary/[0.06] border border-primary/15 px-3 py-2.5">
    <div className="w-10 h-10 rounded-xl overflow-hidden bg-on-surface/[0.06] flex-shrink-0 flex items-center justify-center">
      {image && !image.startsWith('data:') ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
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
