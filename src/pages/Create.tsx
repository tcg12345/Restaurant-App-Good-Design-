import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import {
  X, Film, ChefHat, Link2, Camera, PenLine, ClipboardType,
  Sparkles, ChevronRight, MapPin, Plus, Loader2, Image as ImageIcon, Video as VideoIcon,
  Search, ScanLine, BookOpen, Star, ArrowLeft,
} from 'lucide-react';
import { useGuideCreator } from '../contexts/GuideCreatorContext';
import { useLists, type HomeMealMethod } from '../contexts/ListsContext';
import { searchPlacesByText, priceLevelToString, extractCityState } from '../lib/places';
import { RestaurantCard } from '../components/cards';
import { getCuisineLabel } from './useRestaurantDetail';
import { useUnifiedComposer } from '../components/useUnifiedComposer';
import { DraggableSheet, type SheetPos } from '../components/DraggableSheet';
import { PhotoLibraryGrid } from '../components/PhotoLibraryGrid';
import { PhotoLibrary, canUseNativePhotoLibrary, nativePathToFile, type MediaItem } from '../lib/native-photos';
import { POST_MAX_ITEMS } from '../contexts/PostsContext';
import { cn } from '../lib/utils';
import { GlassButton } from '../lib/glass-buttons';
import { SearchField } from '../components/SearchField';
import { usePageBack } from '../lib/usePageBack';
import './Create.css';

type Mode = 'post' | 'rate' | 'guide' | 'recipe';
const MODES: Mode[] = ['post', 'rate', 'guide', 'recipe'];

/* ── Shared surface bits ─────────────────────────────────────────── */

const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/40 mb-3">{children}</div>
);

/* ── Post surface — the composer's media page, embedded ───────────
   Mirrors the composer modal's media step: the dark canvas previews
   the selection, and the sheet below holds RECENTS with the selected
   strip (numbered, tap to remove) above the camera roll. Picks
   materialize into real files as they're tapped so the canvas preview
   is crisp and Next is instant. The sheet drags all the way up to a
   full-screen gallery — covering the canvas completely — and back
   down. Next routes Instagram-style: exactly one video continues into
   the reel editor, anything else into the post composer's Edit step. */

interface SurfacePick {
  /** PHAsset id for camera-roll picks; synthetic for web/camera files. */
  id: string;
  kind: 'photo' | 'video';
  /** Native thumbnail (instant, low-res) while the full file loads. */
  thumb?: string;
  /** Object URL of the materialized file. */
  previewUrl?: string;
  file?: File;
  loading: boolean;
}

const PostSurface: React.FC<{
  onClose: () => void;
  /** Reports whether the gallery sheet is raised to full screen — the
   *  page hides the floating mode wheel while it is. */
  onFullChange?: (full: boolean) => void;
}> = ({ onFullChange, onClose }) => {
  const openComposer = useUnifiedComposer();
  const useNative = canUseNativePhotoLibrary();
  // Tracks the sheet's detent so the floating close button can restyle
  // itself for the light sheet when the gallery is fully raised.
  const [sheetPos, setSheetPos] = useState<SheetPos>('default');
  // Canvas space reserved behind the sheet's settled position.
  const [sheetReserve, setSheetReserve] = useState(320);
  const [picks, setPicks] = useState<SurfacePick[]>([]);
  const [handingOff, setHandingOff] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards materialization results landing after the pick was removed.
  const picksRef = useRef(picks);
  picksRef.current = picks;

  // Sheet detents track the surface's real height; the full detent
  // covers the canvas entirely.
  const rootRef = useRef<HTMLDivElement>(null);
  const [rootH, setRootH] = useState(0);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => setRootH(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Revoke preview URLs on unmount.
  useEffect(() => () => {
    picksRef.current.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const count = picks.length;
  const anyLoading = picks.some((p) => p.loading);

  const removePick = (id: string) => {
    setPicks((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  // Native camera-roll tap — toggle, materializing the full asset in
  // the background so the canvas/strip get a crisp preview.
  const toggleNative = (item: MediaItem) => {
    if (picks.some((p) => p.id === item.id)) { removePick(item.id); return; }
    if (count >= POST_MAX_ITEMS) return;
    setPicks((prev) => [...prev, {
      id: item.id,
      kind: item.type,
      thumb: item.thumbnailDataUrl,
      loading: true,
    }]);
    void (async () => {
      try {
        const { path, mimeType } = await PhotoLibrary.getMedia({ id: item.id });
        const ext = mimeType.split('/')[1] || (item.type === 'video' ? 'mov' : 'jpg');
        const file = await nativePathToFile(path, `${item.type}-${item.id}.${ext}`, mimeType);
        if (!picksRef.current.some((p) => p.id === item.id)) return; // unpicked meanwhile
        const url = URL.createObjectURL(file);
        setPicks((prev) => prev.map((p) => p.id === item.id ? { ...p, file, previewUrl: url, loading: false } : p));
      } catch (err) {
        console.warn('[Create] materialize failed:', err);
        setPicks((prev) => prev.filter((p) => p.id !== item.id));
      }
    })();
  };

  // Web / OS-picker files land pre-materialized.
  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const room = Math.max(0, POST_MAX_ITEMS - count);
    const incoming = Array.from(list)
      .filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
      .slice(0, room)
      .map((f, i): SurfacePick => ({
        id: `web-${Date.now()}-${i}-${f.name}`,
        kind: f.type.startsWith('video/') ? 'video' : 'photo',
        previewUrl: URL.createObjectURL(f),
        file: f,
        loading: false,
      }));
    if (incoming.length > 0) setPicks((prev) => [...prev, ...incoming]);
  };

  const onCameraTap = async () => {
    try {
      const res = await PhotoLibrary.pickCamera({ mediaType: 'all' });
      if (res.cancelled || !res.path || !res.mimeType) return;
      const ext = res.mimeType.split('/')[1] || (res.mediaType === 'video' ? 'mov' : 'jpg');
      const file = await nativePathToFile(res.path, `camera-${Date.now()}.${ext}`, res.mimeType);
      setPicks((prev) => prev.length >= POST_MAX_ITEMS ? prev : [...prev, {
        id: `camera-${Date.now()}`,
        kind: res.mediaType === 'video' ? 'video' : 'photo',
        previewUrl: URL.createObjectURL(file),
        file,
        loading: false,
      }]);
    } catch (err) {
      console.warn('[Create] camera failed:', err);
    }
  };

  const handleNext = () => {
    if (handingOff || count === 0 || anyLoading) return;
    const files = picks.map((p) => p.file).filter((f): f is File => !!f);
    if (files.length === 0) return;
    setHandingOff(true);
    openComposer(files);
    // Object URLs stay alive — the composer's own previews are fresh
    // object URLs of the same File objects, so ours can go.
    picks.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
    setPicks([]);
    setHandingOff(false);
  };

  // Canvas preview — the most recently added pick, crisp once loaded.
  const last = picks[picks.length - 1];
  const willBeReel = count === 1 && picks[0].kind === 'video';

  const sheetH = Math.round(Math.min(Math.max(rootH * 0.52, 260), 480));
  const sheetMax = Math.max(sheetH, rootH); // full detent covers the canvas

  return (
    <div ref={rootRef} className="relative h-full flex flex-col bg-media-canvas text-white overflow-hidden">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi,.heic,.heif"
        multiple
        className="hidden"
        onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
      />

      {/* ── Canvas — preview of the selection ── */}
      <div className="flex-1 min-h-0 relative">
        {last ? (
          <motion.div
            key={last.id}
            initial={{ opacity: 0.4, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-x-3 bottom-2"
            style={{ top: 'calc(max(0.5rem, env(safe-area-inset-top, 0px)) + 50px)' }}
          >
            {last.previewUrl && last.kind === 'video' ? (
              <video src={last.previewUrl} muted playsInline autoPlay loop className="w-full h-full object-contain" />
            ) : last.previewUrl || last.thumb ? (
              <img src={last.previewUrl || last.thumb} alt="" className="w-full h-full object-contain" />
            ) : null}
            {count > 1 && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 backdrop-blur px-2.5 py-1 text-[11px] font-bold text-white tabular-nums">
                {count} selected
              </div>
            )}
            {willBeReel && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur px-3 py-1.5 text-[11px] font-bold text-white whitespace-nowrap">
                <Film size={11} />
                One video — continues as a reel
              </div>
            )}
          </motion.div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-10 text-center">
            <div className="flex items-center gap-2.5 text-white/40">
              <ImageIcon size={26} />
              <VideoIcon size={26} />
            </div>
            <p className="text-[14px] font-semibold text-white/75 mt-3">
              {useNative ? 'Pick from your camera roll below' : 'Add photos or a video'}
            </p>
            <p className="text-[12px] text-white/40 mt-1 leading-relaxed">
              One video becomes a reel · up to {POST_MAX_ITEMS} items
            </p>
            {!useNative && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="mt-4 h-10 px-5 rounded-full bg-surface text-on-surface text-[13px] font-bold active:scale-95 transition-transform"
              >
                Open camera roll
              </button>
            )}
          </div>
        )}
      </div>

      {/* Top row — close on the left, Next on the right, floating above
          the sheet (z-30) so both stay reachable with the gallery raised
          to full screen. The close button crossfades from its on-canvas
          style to a light-sheet style when the sheet snaps full, so it
          reads as part of the raised sheet. */}
      <div
        className="absolute inset-x-4 z-30 flex items-center justify-between pointer-events-none"
        style={{ top: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}
      >
        <GlassButton
          id="create-close-post"
          symbol="xmark"
          label="Close"
          // The material re-chromes itself from the backdrop; the glyph can't,
          // so it flips with the same signal the old classes flipped on.
          tint={sheetPos === 'full' ? 'label' : 'white'}
          onClick={onClose}
          className={cn(
            'w-11 h-11 rounded-full flex items-center justify-center pointer-events-auto transition-colors duration-300',
            sheetPos === 'full' ? 'text-on-surface/70' : 'text-white',
          )}
        >
          <X size={16} strokeWidth={2.4} />
        </GlassButton>
        {count > 0 && (
          <motion.button
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            type="button"
            onClick={handleNext}
            disabled={anyLoading || handingOff}
            className="h-9 pl-4 pr-3 rounded-full bg-primary text-on-primary inline-flex items-center gap-1 text-[13px] font-bold shadow-lg pointer-events-auto active:scale-95 transition-transform disabled:opacity-60"
          >
            {anyLoading ? (
              <><Loader2 size={13} className="animate-spin" /> Loading…</>
            ) : (
              <>Next <span className="opacity-80">· {count}</span> <ChevronRight size={13} strokeWidth={2.8} /></>
            )}
          </motion.button>
        )}
      </div>

      {/* Space reserved behind the resting sheet — the sheet itself is
          an overlay, so dragging it never reflows the canvas. */}
      <div
        className="flex-shrink-0 transition-[height] duration-[400ms]"
        style={{ height: sheetReserve, transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)' }}
      />

      {/* ── Camera-roll sheet — drag up for the full-screen gallery ── */}
      <DraggableSheet
        height={sheetH}
        minHeight={128}
        maxHeight={sheetMax}
        draggable
        onSnap={(pos) => {
          setSheetPos(pos);
          onFullChange?.(pos === 'full');
        }}
        onReserveChange={setSheetReserve}
        safeTopAtFull
        className="z-10 bg-surface text-on-surface shadow-[0_-10px_40px_rgba(0,0,0,0.35)]"
      >
        {/* Bottom padding keeps the last gallery rows scrollable above
            the floating mode wheel. */}
        <div className="pb-[calc(env(safe-area-inset-bottom,0px)+92px)]">
          {/* Sticky header — stays put while the gallery scrolls. */}
          <div className={cn(
            'sticky top-0 z-10 bg-surface pb-2 flex items-baseline gap-2 transition-[padding] duration-300',
            // When fully raised, the floating close/Next overlay the top
            // of the sheet — indent the header row so nothing collides.
            sheetPos === 'full' ? 'pl-16 pr-[124px]' : 'px-5',
          )}>
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/40">Recents</span>
            <span className="text-[12px] font-semibold text-on-surface/45 tabular-nums">{count} / {POST_MAX_ITEMS}</span>
          </div>

          {/* Selected strip — numbered, tap to remove. */}
          {count > 0 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide px-5 pb-3">
              {picks.map((p, idx) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => removePick(p.id)}
                  className="relative w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 ring-1 ring-on-surface/[0.08]"
                  aria-label={`Remove item ${idx + 1}`}
                >
                  {p.previewUrl && p.kind === 'video' ? (
                    <video src={p.previewUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                  ) : (
                    <img src={p.previewUrl || p.thumb} alt="" className="w-full h-full object-cover" />
                  )}
                  {p.loading && <span className="absolute inset-0 bg-white/40 animate-pulse" />}
                  <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary border-2 border-white text-on-primary text-[10px] font-bold flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <span className="absolute inset-x-0 bottom-0 bg-black/55 text-white/90 text-[9px] font-bold py-0.5">
                    Remove
                  </span>
                </button>
              ))}
            </div>
          )}

          {useNative ? (
            /* Native camera roll — auto-loaded, numbered multi-select. */
            <PhotoLibraryGrid
              mediaType="all"
              onSelect={toggleNative}
              selectedIds={picks.map((p) => p.id)}
              selectionMode="multi"
              onCameraTap={() => { void onCameraTap(); }}
            />
          ) : (
            /* Web fallback — the OS picker is the camera roll. */
            <div className="grid grid-cols-3 gap-1.5 px-5">
              {count < POST_MAX_ITEMS && (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="aspect-square rounded-[10px] border-[1.5px] border-dashed border-on-surface/20 flex flex-col items-center justify-center gap-1 text-on-surface/45 active:bg-on-surface/[0.04] transition-colors"
                >
                  <Plus size={17} strokeWidth={2.4} />
                  <span className="text-[10.5px] font-bold uppercase tracking-wider">Add</span>
                </button>
              )}
            </div>
          )}
        </div>
      </DraggableSheet>
    </div>
  );
};

/* ── Rate surface — find the place, then the rating flow ──────────
   Rating was the one creation path with no home on this page, so the ＋
   button implicitly taught people that "posting" was how you log a meal.
   Your own rated places and wishlist come first (re-rating a favourite is
   the common case); typing searches everywhere else. */

/** "Brooklyn, NY" from a full address — the row's location line. */
const cityOf = (address?: string): string | undefined => {
  const c = extractCityState(address || '', address || '');
  return c || undefined;
};

interface RatePick {
  id: string;
  name: string;
  cuisine: string;
  price: string;
  address: string;
  image?: string;
  /** Your current score, when you've already rated it. */
  score?: number;
}

const RateSurface: React.FC = () => {
  const { ratings, wishlist, restaurantMeta, openAddRestaurantModal, scoresUnlocked } = useLists();
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<RatePick[]>([]);
  const [searching, setSearching] = useState(false);

  // Live place search, debounced. Each run aborts the previous one so a
  // slow early keystroke can't overwrite fresher results.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) { setRemote([]); setSearching(false); return; }
    const t = setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setSearching(true);
      searchPlacesByText(q, null, null, undefined, false, undefined, ac.signal)
        .then((places) => {
          if (ac.signal.aborted) return;
          setRemote(places.slice(0, 12).map((p) => ({
            id: p.id,
            name: p.name,
            cuisine: getCuisineLabel(p),
            price: priceLevelToString(p.priceLevel) || '',
            address: p.fullAddress || p.address || '',
          })));
        })
        .catch(() => { /* aborted or offline — local matches still show */ })
        .finally(() => { if (!ac.signal.aborted) setSearching(false); });
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const results = useMemo<RatePick[]>(() => {
    const q = query.trim().toLowerCase();
    const seen = new Set<string>();
    const out: RatePick[] = [];
    const scoreById = new Map<string, number>(ratings.map((r) => [r.restaurantId, r.score]));
    const matches = (...parts: (string | undefined)[]) =>
      !q || parts.filter(Boolean).join(' ').toLowerCase().includes(q);

    for (const r of ratings) {
      if (seen.has(r.restaurantId) || !matches(r.name, r.cuisine, r.address)) continue;
      seen.add(r.restaurantId);
      out.push({ id: r.restaurantId, name: r.name, cuisine: r.cuisine, price: r.price, address: r.address, image: r.image, score: r.score });
    }
    for (const w of wishlist) {
      if (seen.has(w.restaurantId) || !matches(w.name, w.cuisine, w.address)) continue;
      seen.add(w.restaurantId);
      out.push({ id: w.restaurantId, name: w.name, cuisine: w.cuisine, price: w.price, address: w.address, image: w.image });
    }
    for (const [id, meta] of Object.entries(restaurantMeta || {})) {
      const m = meta as { name?: string; cuisine?: string; price?: string; address?: string; image?: string };
      if (id.startsWith('__') || seen.has(id) || !m?.name || !matches(m.name, m.cuisine, m.address)) continue;
      seen.add(id);
      out.push({ id, name: m.name, cuisine: m.cuisine || '', price: m.price || '', address: m.address || '', image: m.image, score: scoreById.get(id) });
    }
    for (const p of remote) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({ ...p, score: scoreById.get(p.id) });
    }
    return out.slice(0, q ? 30 : 12);
  }, [query, ratings, wishlist, restaurantMeta, remote]);

  return (
    <div className="w-full max-w-md mx-auto">
      <Eyebrow>Rate a restaurant</Eyebrow>

      <div className="relative">
        <SearchField
          glassId="create-rest-search"
          value={query}
          onChange={setQuery}
          placeholder="Search restaurants"
        />
        {searching && <Loader2 size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-on-surface/35" />}
      </div>

      <div className="mt-1">
        {results.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-on-surface/40">
            {query.trim() ? 'No restaurants match that yet.' : 'Search for a place to rate.'}
          </p>
        ) : (
          <ul className="divide-y divide-on-surface/[0.06]">
            {results.map((r, i) => (
              <motion.li
                key={r.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: Math.min(i * 0.03, 0.24), ease: [0.32, 0.72, 0, 1] }}
              >
                {/* The app's one restaurant row — same typography, same score
                    badge, same hairline rhythm as every other browsing list.
                    Your own score only shows once scores are unlocked. */}
                <RestaurantCard
                  id={r.id}
                  name={r.name}
                  image={r.image}
                  cuisine={r.cuisine}
                  price={r.price}
                  address={r.address}
                  location={cityOf(r.address)}
                  rating={scoresUnlocked ? r.score : undefined}
                  variant="row"
                  surface="flat-row"
                  as="div"
                  onClick={() => openAddRestaurantModal({
                    id: r.id, name: r.name, image: r.image || '',
                    cuisine: r.cuisine, price: r.price, address: r.address,
                  })}
                />
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

/* ── Guide surface — type + title, wizard opens pre-filled ───────── */

/* ── Recipe surface — the four ways in, one tap deep ─────────────── */

const RecipeSurface: React.FC = () => {
  const { openHomeMealModal } = useLists();

  // Mirrors AddHomeMealModal's METHODS — keep the two lists in sync.
  const methods: Array<{ key: HomeMealMethod; icon: React.ReactNode; title: string; sub: string }> = [
    { key: 'custom', icon: <PenLine size={21} />, title: 'Create a custom recipe', sub: 'Your ingredients. Your method. Made by you.' },
    { key: 'link', icon: <Link2 size={17} strokeWidth={2} />, title: 'From a web link', sub: 'Paste a link from any recipe site' },
    { key: 'photo', icon: <ScanLine size={17} strokeWidth={2} />, title: 'Scan a recipe', sub: 'A cookbook page, screenshot, or card' },
    { key: 'text', icon: <ClipboardType size={17} strokeWidth={2} />, title: 'From text', sub: 'Paste a recipe you already have' },

    { key: 'ai', icon: <Sparkles size={17} strokeWidth={2} />, title: 'Create with AI', sub: 'Describe it, get a complete draft' },
    { key: 'dish', icon: <Camera size={17} strokeWidth={2} />, title: 'Recreate a dish', sub: 'Photograph a plate, get the recipe' },
  ];

  return (
    <div className="w-full max-w-md mx-auto">
      <Eyebrow>Choose how to begin</Eyebrow>
      <div>
        {methods.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => openHomeMealModal(undefined, { initialMethod: m.key })}
            className={`create-recipe-method ${m.key === 'custom' ? 'is-featured' : ''}`}
          >
            <span className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
              {m.icon}
            </span>
            <span className="flex flex-col gap-0.5 flex-1 min-w-0">
              <span className="text-[15px] font-semibold">{m.title}</span>
              <span className="text-[12.5px] text-on-surface/45">{m.sub}</span>
            </span>
            <ChevronRight size={15} className="text-on-surface/30 flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
};

/* ── Page ─────────────────────────────────────────────────────────── */

const CREATION_CHOICES = [
  { id: 'recipe' as const, title: 'Recipe', description: 'Make something worth passing down.', icon: ChefHat, tone: 'sage' },
  { id: 'guide' as const, title: 'Guide', description: 'Your favorite places, beautifully collected.', icon: BookOpen, tone: 'sand' },
  { id: 'post' as const, title: 'Post or reel', description: 'Share the moments around the table.', icon: Camera, tone: 'blue' },
  { id: 'rate' as const, title: 'Rating', description: 'Remember a meal. Refine your taste.', icon: Star, tone: 'rose' },
];

export const Create: React.FC = () => {
  const goBack = usePageBack('/');
  const { state } = useLocation() as { state?: { mode?: Mode } };
  const initial = state?.mode && MODES.includes(state.mode) ? state.mode : null;
  const [mode, setMode] = useState<Mode | null>(initial);
  const [visited, setVisited] = useState<Mode[]>(initial && initial !== 'guide' ? [initial] : []);
  const { openGuideCreator } = useGuideCreator();
  const reduced = useReducedMotion();
  const select = (next: Mode) => {
    if (next === 'guide') { openGuideCreator(); return; }
    setVisited(previous => previous.includes(next) ? previous : [...previous, next]);
    setMode(next);
  };
  useEffect(() => { if (initial === 'guide') { setMode(null); openGuideCreator(); } }, []);
  const current = CREATION_CHOICES.find(choice => choice.id === mode);
  return <div className="create-studio">
    {mode !== 'post' && <header className="create-studio-header">
      <GlassButton id="create-back" symbol={mode ? 'chevron.left' : 'xmark'} label={mode ? 'Back to Create' : 'Close Create'} onClick={mode ? () => setMode(null) : goBack} className="create-studio-back">
        {mode ? <ArrowLeft size={21} /> : <X size={22} />}
      </GlassButton>
      <span>{current?.title || 'Create'}</span><span className="create-studio-header-space" />
    </header>}
    <div className="create-studio-workspace">
      {!mode && <motion.main className="create-studio-home" initial={{ opacity: 0, y: reduced ? 0 : 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="create-studio-intro"><span>A LITTLE OF YOUR GOOD TASTE</span><h1>Make it yours.</h1><p>A recipe to keep. A place to remember.<br />Something good to share.</p></div>
        <div className="create-studio-choices">
          {CREATION_CHOICES.map(({id, title, description, icon: Icon, tone}) => <button key={id} className={`create-studio-choice tone-${tone}`} onClick={() => select(id)}>
            <span className="create-studio-choice-icon"><Icon size={25} strokeWidth={1.7} /></span>
            <span><strong>{title}</strong><small>{description}</small></span><ChevronRight size={18} />
          </button>)}
        </div>
        <p className="create-studio-note">Your ideas, your pace. Review before sharing.</p>
      </motion.main>}
      {visited.map(item => <section key={item} hidden={mode !== item} inert={mode !== item} className={`create-studio-surface ${item === 'post' ? 'is-post' : ''}`} aria-label={`Create ${item}`}>
        {item === 'post' && <PostSurface onClose={() => setMode(null)} />}
        {item === 'rate' && <><div className="create-studio-surface-intro"><h1>How was your meal?</h1><p>Find a restaurant to add or update your rating.</p></div><RateSurface /></>}
        {item === 'recipe' && <><div className="create-studio-surface-intro"><h1>Your next great recipe.</h1><p>Start with an idea, or bring a favorite with you.</p></div><RecipeSurface /></>}
      </section>)}
    </div>
  </div>;
};
