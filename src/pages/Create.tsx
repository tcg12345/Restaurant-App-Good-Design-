// /create — the plus-button page. YouTube-Shorts-style creation hub:
// the bottom is an infinite wheel carousel of the three actions (Post,
// Guide, Recipe — momentum, always-centered selection, faded
// neighbors), and the area above it IS the selected action's surface,
// live and usable immediately — no "Start X" button:
//
//   Post   — the composer's media page, embedded: a dark canvas
//            previewing the selection with the camera roll in a
//            draggable bottom sheet (pull up for a full-screen
//            gallery). Next routes Instagram-style — one video becomes
//            a reel, anything else a post — into the full composer.
//   Guide  — choose the guide type and name it; Continue opens the
//            wizard pre-filled.
//   Recipe — the four ways in (link / photo / scratch / AI), one tap
//            deep-links into that flow.
//
// All surfaces stay mounted so half-written input survives wheel
// spins. The full flows open as the usual overlays above this page.

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  X, Film, ChefHat, ArrowRight, Link2, Camera, PenLine,
  Sparkles, ChevronRight, MapPin, Plus, Loader2, Image as ImageIcon, Video as VideoIcon,
} from 'lucide-react';
import { useGuideCreator } from '../contexts/GuideCreatorContext';
import { useLists } from '../contexts/ListsContext';
import { useUnifiedComposer } from '../components/useUnifiedComposer';
import { DraggableSheet } from '../components/DraggableSheet';
import { PhotoLibraryGrid } from '../components/PhotoLibraryGrid';
import { PhotoLibrary, canUseNativePhotoLibrary, nativePathToFile, type MediaItem } from '../lib/native-photos';
import { POST_MAX_ITEMS } from '../contexts/PostsContext';
import type { GuideType } from '../lib/supabase-guides';
import { cn } from '../lib/utils';

type Mode = 'post' | 'guide' | 'recipe';
const MODES: Mode[] = ['post', 'guide', 'recipe'];
const MODE_LABELS: Record<Mode, string> = { post: 'Post', guide: 'Guide', recipe: 'Recipe' };

const mod = (n: number, m: number) => ((n % m) + m) % m;

/* ── Infinite mode wheel ──────────────────────────────────────────
   Horizontal looping carousel, iOS-camera-style: drag with momentum,
   the selected label always snaps to center, neighbors fade + shrink,
   tapping a side label glides to it. Pointer-driven (not native
   scroll) so the loop is seamless in both directions.               */

const ITEM_W = 92;
const WHEEL_MASK =
  'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.5) 18%, black 34%, black 66%, rgba(0,0,0,0.5) 82%, transparent 100%)';

const ModeWheel: React.FC<{
  count: number;
  labels: string[];
  onChange: (idx: number) => void;
}> = ({ count, labels, onChange }) => {
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const lastXRef = useRef(0);
  const movedRef = useRef(0);
  const lastTimeRef = useRef(0);
  const velRef = useRef(0);
  const lastReportedRef = useRef(0);

  const setOff = (v: number) => { offsetRef.current = v; setOffset(v); };

  const reportRef = useRef<(off: number) => void>(() => {});
  reportRef.current = (off: number) => {
    const v = mod(Math.round(off), count);
    if (v !== lastReportedRef.current) {
      lastReportedRef.current = v;
      onChange(v);
    }
  };
  const report = (off: number) => reportRef.current(off);

  const stopAnim = () => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  };

  const settleTo = (target?: number) => {
    const t = target ?? Math.round(offsetRef.current);
    stopAnim();
    const step = () => {
      const diff = t - offsetRef.current;
      if (Math.abs(diff) < 0.004) {
        setOff(t);
        report(t);
        rafRef.current = null;
        return;
      }
      setOff(offsetRef.current + diff * 0.22);
      report(offsetRef.current);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  const momentum = () => {
    stopAnim();
    const step = () => {
      velRef.current *= 0.93;
      const next = offsetRef.current + velRef.current;
      setOff(next);
      report(next);
      if (Math.abs(velRef.current) < 0.02) {
        rafRef.current = null;
        settleTo();
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  useEffect(() => () => stopAnim(), []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    stopAnim();
    lastXRef.current = e.clientX;
    movedRef.current = 0;
    velRef.current = 0;
    lastTimeRef.current = performance.now();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - lastXRef.current;
    lastXRef.current = e.clientX;
    movedRef.current += Math.abs(dx);
    const now = performance.now();
    const dt = Math.max(1, now - lastTimeRef.current);
    lastTimeRef.current = now;
    const dItems = -dx / ITEM_W;
    velRef.current = dItems * (16.7 / dt);
    const next = offsetRef.current + dItems;
    setOff(next);
    report(next);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (movedRef.current < 6) {
      // Tap — glide to the tapped label.
      const rect = e.currentTarget.getBoundingClientRect();
      const delta = Math.round((e.clientX - (rect.left + rect.width / 2)) / ITEM_W);
      settleTo(Math.round(offsetRef.current) + delta);
      return;
    }
    if (Math.abs(velRef.current) > 0.05) momentum();
    else settleTo();
  };

  // Labels around the current position (center ± 3 covers the mask).
  const first = Math.floor(offset) - 3;
  const items: Array<{ k: number; label: string; d: number }> = [];
  for (let k = first; k <= first + 7; k++) {
    items.push({ k, label: labels[mod(k, count)], d: k - offset });
  }

  return (
    <div className="flex flex-col items-center">
      <div
        className="relative w-full max-w-sm h-11 overflow-hidden select-none cursor-ew-resize"
        style={{ touchAction: 'none', WebkitMaskImage: WHEEL_MASK, maskImage: WHEEL_MASK }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="tablist"
        aria-label="Creation mode"
      >
        {items.map(({ k, label, d }) => {
          const dist = Math.min(Math.abs(d), 2.4);
          return (
            <span
              key={k}
              className="absolute top-1/2 left-1/2 flex items-center justify-center uppercase font-bold text-[12.5px] tracking-[0.2em] text-on-surface whitespace-nowrap pointer-events-none"
              style={{
                width: ITEM_W,
                transform: `translate(calc(-50% + ${d * ITEM_W}px), -50%) scale(${1 - dist * 0.07})`,
                opacity: Math.max(0.25, 1 - dist * 0.42),
                willChange: 'transform, opacity',
              }}
              aria-hidden
            >
              {label}
            </span>
          );
        })}
      </div>
      <span className="mt-1 w-1 h-1 rounded-full bg-primary" aria-hidden />
    </div>
  );
};

/* ── Shared surface bits ─────────────────────────────────────────── */

const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/40 mb-3">{children}</div>
);

const ContinueBtn: React.FC<{ label?: string; disabled?: boolean; onClick: () => void }> = ({ label = 'Continue', disabled, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'inline-flex items-center gap-2 px-7 py-3 rounded-full font-semibold text-[14px] transition-all active:scale-[0.98]',
      disabled
        ? 'bg-on-surface/[0.07] text-on-surface/35'
        : 'bg-primary text-white shadow-sm hover:bg-primary/90',
    )}
  >
    {label}
    <ArrowRight size={15} strokeWidth={2.2} />
  </button>
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

const PostSurface: React.FC = () => {
  const navigate = useNavigate();
  const openComposer = useUnifiedComposer();
  const useNative = canUseNativePhotoLibrary();
  // Tracks the sheet's detent so the floating close button can restyle
  // itself for the light sheet when the gallery is fully raised.
  const [sheetPos, setSheetPos] = useState<'default' | 'full'>('default');
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
    <div ref={rootRef} className="relative h-full flex flex-col bg-[#16120e] text-white overflow-hidden">
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
        <button
          type="button"
          onClick={() => navigate('/')}
          aria-label="Close"
          className={cn(
            'w-9 h-9 rounded-full flex items-center justify-center pointer-events-auto transition-colors duration-300',
            sheetPos === 'full'
              ? 'bg-on-surface/[0.06] text-on-surface/70 active:bg-on-surface/[0.12]'
              : 'bg-white/10 text-white active:bg-white/20',
          )}
        >
          <X size={16} strokeWidth={2.4} />
        </button>
        {count > 0 && (
          <motion.button
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            type="button"
            onClick={handleNext}
            disabled={anyLoading || handingOff}
            className="h-9 pl-4 pr-3 rounded-full bg-primary text-white inline-flex items-center gap-1 text-[13px] font-bold shadow-lg pointer-events-auto active:scale-95 transition-transform disabled:opacity-60"
          >
            {anyLoading ? (
              <><Loader2 size={13} className="animate-spin" /> Loading…</>
            ) : (
              <>Next <span className="opacity-80">· {count}</span> <ChevronRight size={13} strokeWidth={2.8} /></>
            )}
          </motion.button>
        )}
      </div>

      {/* ── Camera-roll sheet — drag up for the full-screen gallery ── */}
      <DraggableSheet
        height={sheetH}
        maxHeight={sheetMax}
        draggable
        onSnap={setSheetPos}
        safeTopAtFull
        className="relative z-10 bg-surface text-on-surface shadow-[0_-10px_40px_rgba(0,0,0,0.35)]"
      >
        <div className="pb-safe-6">
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
                  <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary border-2 border-white text-white text-[10px] font-bold flex items-center justify-center">
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

/* ── Guide surface — type + title, wizard opens pre-filled ───────── */

const GuideSurface: React.FC = () => {
  const { openGuideCreator } = useGuideCreator();
  const [type, setType] = useState<GuideType>('restaurants');
  const [title, setTitle] = useState('');

  const handleContinue = () => {
    openGuideCreator(null, { seed: { type, title: title.trim() } });
    setTitle('');
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <Eyebrow>Build a guide</Eyebrow>

      <div className="grid grid-cols-2 gap-2.5">
        {([
          { key: 'restaurants' as GuideType, label: 'Restaurants', sub: 'Places to eat & drink', icon: <MapPin size={16} /> },
          { key: 'recipes' as GuideType, label: 'Recipes', sub: 'Things to cook at home', icon: <ChefHat size={16} /> },
        ]).map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => setType(o.key)}
            className={cn(
              'flex flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-all',
              type === o.key
                ? 'border-primary ring-1 ring-primary bg-primary/[0.04]'
                : 'border-on-surface/[0.1] hover:border-on-surface/25',
            )}
          >
            <span className={cn('mb-1.5 w-9 h-9 rounded-full flex items-center justify-center',
              type === o.key ? 'bg-primary/10 text-primary' : 'bg-on-surface/[0.05] text-on-surface/45')}>
              {o.icon}
            </span>
            <span className="text-[14px] font-semibold">{o.label}</span>
            <span className="text-[11.5px] text-on-surface/45 leading-snug">{o.sub}</span>
          </button>
        ))}
      </div>

      <div className="mt-6">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-on-surface/40 mb-1.5">Title</div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={type === 'recipes' ? 'Weeknight comfort classics' : 'Best pasta in the Village'}
          maxLength={80}
          className="w-full bg-transparent border-0 border-b-[1.5px] border-on-surface/15 focus:border-primary focus:outline-none py-2 font-serif font-semibold text-[21px] placeholder:text-on-surface/25"
        />
      </div>

      <div className="mt-6 flex justify-end">
        <ContinueBtn onClick={handleContinue} />
      </div>
    </div>
  );
};

/* ── Recipe surface — the four ways in, one tap deep ─────────────── */

const RecipeSurface: React.FC = () => {
  const { openHomeMealModal } = useLists();

  const methods: Array<{ key: 'link' | 'photo' | 'custom' | 'ai'; icon: React.ReactNode; title: string; sub: string }> = [
    { key: 'link', icon: <Link2 size={17} strokeWidth={2} />, title: 'From a web link', sub: 'Paste a link from any recipe site' },
    { key: 'photo', icon: <Camera size={17} strokeWidth={2} />, title: 'From a photo', sub: 'A cookbook page, screenshot, or card' },
    { key: 'custom', icon: <PenLine size={17} strokeWidth={2} />, title: 'Start from scratch', sub: 'Build it step by step' },
    { key: 'ai', icon: <Sparkles size={17} strokeWidth={2} />, title: 'Create with AI', sub: 'Describe it, get a complete draft' },
  ];

  return (
    <div className="w-full max-w-md mx-auto">
      <Eyebrow>Add a recipe</Eyebrow>
      <div>
        {methods.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => openHomeMealModal(undefined, { initialMethod: m.key })}
            className="w-full flex items-center gap-3.5 py-3.5 text-left border-b border-on-surface/[0.07] last:border-0 active:bg-on-surface/[0.03] transition-colors"
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

export const Create: React.FC = () => {
  const navigate = useNavigate();
  const [modeIdx, setModeIdx] = useState(0);
  const mode = MODES[modeIdx];

  return (
    <div className="min-h-screen flex flex-col bg-surface text-on-surface">
      {/* Live surfaces — all mounted so half-written input survives
          wheel spins; only the active one is visible + interactive.
          There's no page header: each surface carries its own close
          button so the post composer can run edge-to-edge. */}
      <div className="relative flex-1 min-h-0">
        {MODES.map((m) => {
          const active = m === mode;
          return (
            <div
              key={m}
              className={cn(
                'absolute inset-0 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                // The post surface is a full-bleed composer (dark canvas
                // + its own bottom sheet); the others are padded forms.
                m === 'post' ? 'overflow-hidden' : 'overflow-y-auto px-5 pt-safe-4 pb-6',
                active ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none',
              )}
              aria-hidden={!active}
            >
              {m !== 'post' && (
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  aria-label="Close"
                  className="w-10 h-10 mb-3 rounded-full bg-on-surface/5 hover:bg-on-surface/10 flex items-center justify-center text-on-surface/70 transition-colors"
                >
                  <X size={19} />
                </button>
              )}
              {m === 'post' && <PostSurface />}
              {m === 'guide' && <GuideSurface />}
              {m === 'recipe' && <RecipeSurface />}
            </div>
          );
        })}
      </div>

      {/* Infinite mode wheel */}
      <div className="flex-shrink-0 pt-2 pb-safe-6">
        <ModeWheel
          count={MODES.length}
          labels={MODES.map((m) => MODE_LABELS[m])}
          onChange={setModeIdx}
        />
      </div>
    </div>
  );
};
