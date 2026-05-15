/**
 * MediaEditor — Instagram-style per-item editor for photos and videos.
 *
 *   Photos: crop with aspect-ratio chips + pan, brightness / contrast /
 *           saturation sliders, and a strip of preset filters. On apply,
 *           we re-render the photo through a canvas pipeline and hand
 *           back an edited JPEG.
 *   Videos: trim handles on a frame timeline plus the same color
 *           sliders and presets. On apply, we re-encode the trimmed +
 *           color-graded video through canvas → MediaRecorder and hand
 *           back a WebM.
 *
 * The editor is content-agnostic: parents pass an array of EditableItem
 * (one per photo/video) and receive back the same items with their
 * `edits` state mutated and (after `applyAllEdits()`) an `editedFile`.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Crop, Sun, Contrast, Droplet, Scissors, Sparkles, Wand2, Check } from 'lucide-react';
import { cn } from '../lib/utils';

/* ── Types ───────────────────────────────────────────────────────────── */

export type EditMediaType = 'photo' | 'video';

export type AspectRatio = 'free' | '1:1' | '4:5' | '9:16' | '16:9';

export interface FilterPreset {
  /** Identifier persisted on the item. */
  id: string;
  label: string;
  /** CSS filter string applied to the preview and baked into the canvas
   *  output when this preset is active. */
  filter: string;
}

export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'none',    label: 'None',    filter: 'none' },
  { id: 'vintage', label: 'Vintage', filter: 'sepia(0.45) saturate(1.2) contrast(0.95) brightness(1.05)' },
  { id: 'warm',    label: 'Warm',    filter: 'saturate(1.25) hue-rotate(-8deg) brightness(1.05)' },
  { id: 'cool',    label: 'Cool',    filter: 'saturate(1.15) hue-rotate(8deg) brightness(0.98)' },
  { id: 'bw',      label: 'B & W',   filter: 'grayscale(1) contrast(1.05) brightness(1.02)' },
  { id: 'mono',    label: 'Mono',    filter: 'grayscale(1) brightness(1.05) contrast(1.1)' },
  { id: 'fade',    label: 'Fade',    filter: 'saturate(0.8) contrast(0.92) brightness(1.06)' },
];

/** Normalised crop rect within the source. (0..1 in each dimension.) */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditState {
  /** Normalised crop rectangle. The source extent is implicitly 0..1. */
  crop: CropRect;
  aspectRatio: AspectRatio;
  brightness: number;   // 100 = neutral, range 50..150
  contrast: number;     // 100 = neutral
  saturation: number;   // 100 = neutral
  filterPreset: string; // FilterPreset.id
  /** Video-only — trim window in seconds. Null when untouched. */
  trim?: { start: number; end: number } | null;
}

export const DEFAULT_EDIT_STATE: EditState = {
  crop: { x: 0, y: 0, width: 1, height: 1 },
  aspectRatio: 'free',
  brightness: 100,
  contrast: 100,
  saturation: 100,
  filterPreset: 'none',
  trim: null,
};

export interface EditableItem {
  key: string;
  mediaType: EditMediaType;
  file?: File;
  /** Either a blob: URL (for new picks) or an https: URL (for existing
   *  items being edited). When the source is https we can't re-encode
   *  it without CORS access, so the editor falls back to a "skip
   *  editing — keep as-is" mode for that item. */
  previewUrl: string;
  /** Caller's previous edits, or DEFAULT_EDIT_STATE for fresh items. */
  edits: EditState;
  /** Total duration in seconds for videos; ignored for photos. */
  durationSeconds?: number | null;
}

/* ── CSS filter string ───────────────────────────────────────────────── */

export function cssFilterFor(edits: EditState): string {
  const preset = FILTER_PRESETS.find((p) => p.id === edits.filterPreset)?.filter ?? 'none';
  const tweaks = [
    `brightness(${edits.brightness / 100})`,
    `contrast(${edits.contrast / 100})`,
    `saturate(${edits.saturation / 100})`,
  ].join(' ');
  return preset === 'none' ? tweaks : `${preset} ${tweaks}`;
}

/* ── Crop / aspect helpers ───────────────────────────────────────────── */

function ratioValue(ratio: AspectRatio): number | null {
  switch (ratio) {
    case '1:1': return 1;
    case '4:5': return 4 / 5;
    case '9:16': return 9 / 16;
    case '16:9': return 16 / 9;
    default: return null;
  }
}

/** Centre-crop the source to the requested aspect ratio, returning the
 *  normalised CropRect (0..1 in each dimension). */
function defaultCropForRatio(ratio: AspectRatio, sourceWidth: number, sourceHeight: number): CropRect {
  const r = ratioValue(ratio);
  if (r == null) return { x: 0, y: 0, width: 1, height: 1 };
  const sourceRatio = sourceWidth / sourceHeight;
  let w = 1, h = 1;
  if (sourceRatio > r) {
    // Source is wider than target — crop horizontally.
    w = r / sourceRatio;
  } else {
    // Source is taller than target — crop vertically.
    h = sourceRatio / r;
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, width: w, height: h };
}

/* ── Photo apply (canvas) ────────────────────────────────────────────── */

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

async function applyPhotoEdits(item: EditableItem): Promise<File> {
  const img = await loadImage(item.previewUrl);
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const crop = item.edits.crop;
  const cropX = Math.round(crop.x * sw);
  const cropY = Math.round(crop.y * sh);
  const cropW = Math.max(1, Math.round(crop.width * sw));
  const cropH = Math.max(1, Math.round(crop.height * sh));
  const canvas = document.createElement('canvas');
  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  // Apply the CSS filter on the canvas so the colour adjustments and
  // the chosen preset get baked into the output pixels.
  ctx.filter = cssFilterFor(item.edits);
  ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.92),
  );
  const originalName = item.file?.name ?? 'edited.jpg';
  const baseName = originalName.replace(/\.[a-z0-9]+$/i, '') || 'edited';
  return new File([blob], `${baseName}-edited.jpg`, { type: 'image/jpeg' });
}

/* ── Video apply (MediaRecorder) ─────────────────────────────────────── */

async function applyVideoEdits(item: EditableItem, onProgress?: (n: number) => void): Promise<File> {
  // Bring up an off-screen video element pointed at the source. We
  // need to seek to the trim start and play through to the trim end
  // while a canvas + MediaRecorder captures the cropped, colour-graded
  // frames.
  const v = document.createElement('video');
  v.src = item.previewUrl;
  v.muted = true; // required for playback without user gesture on some browsers
  v.playsInline = true;
  v.preload = 'auto';
  await new Promise<void>((resolve, reject) => {
    v.onloadedmetadata = () => resolve();
    v.onerror = () => reject(new Error("Couldn't load video for editing."));
  });
  const sw = v.videoWidth;
  const sh = v.videoHeight;
  const crop = item.edits.crop;
  const cropX = Math.round(crop.x * sw);
  const cropY = Math.round(crop.y * sh);
  const cropW = Math.max(2, Math.round(crop.width * sw) & ~1); // keep even for codecs
  const cropH = Math.max(2, Math.round(crop.height * sh) & ~1);
  const canvas = document.createElement('canvas');
  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.filter = cssFilterFor(item.edits);

  const trim = item.edits.trim;
  const start = trim?.start ?? 0;
  const end = trim?.end ?? (item.durationSeconds ?? v.duration);
  const totalSeconds = Math.max(0.05, end - start);

  v.currentTime = start;
  await new Promise<void>((resolve) => { v.onseeked = () => resolve(); });

  const stream = (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream?.(30);
  if (!stream) throw new Error('Canvas capture not supported in this browser.');

  // Pick the best WebM codec the browser actually supports.
  const preferredMimes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mimeType = preferredMimes.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) || 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  const stopRecorder = () => new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
    if (recorder.state !== 'inactive') recorder.stop();
    else resolve();
  });

  recorder.start();

  // Draw frames as they come in. Use rAF and check currentTime; stop
  // when we hit the trim end.
  let cancelled = false;
  const drawLoop = () => {
    if (cancelled) return;
    if (v.currentTime >= end || v.ended) {
      v.pause();
      return;
    }
    ctx.drawImage(v, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    const elapsed = Math.min(totalSeconds, v.currentTime - start);
    onProgress?.(Math.max(0, Math.min(1, elapsed / totalSeconds)));
    requestAnimationFrame(drawLoop);
  };

  await v.play();
  requestAnimationFrame(drawLoop);

  // Wait for playback to reach the trim end (or natural end).
  await new Promise<void>((resolve) => {
    const handler = () => {
      if (v.currentTime >= end || v.ended) {
        cancelled = true;
        v.removeEventListener('timeupdate', handler);
        v.removeEventListener('ended', handler);
        resolve();
      }
    };
    v.addEventListener('timeupdate', handler);
    v.addEventListener('ended', handler);
  });

  await stopRecorder();
  stream.getTracks().forEach((t) => t.stop());
  const blob = new Blob(chunks, { type: mimeType });
  const baseName = (item.file?.name ?? 'video').replace(/\.[a-z0-9]+$/i, '') || 'video';
  return new File([blob], `${baseName}-edited.webm`, { type: mimeType });
}

/* ── Apply-all entry point used by parents ───────────────────────────── */

/**
 * Produce edited Files for every item that has non-default edits.
 * Items whose edits are still defaults are returned untouched so we
 * don't waste time re-encoding when the user just clicked through the
 * step without touching anything.
 */
export async function applyAllEdits(
  items: EditableItem[],
  onProgress?: (fraction: number) => void,
): Promise<Record<string, File>> {
  const out: Record<string, File> = {};
  const work = items.filter((it) => isEdited(it.edits) && !!it.file && it.previewUrl.startsWith('blob:'));
  if (work.length === 0) {
    onProgress?.(1);
    return out;
  }
  for (let i = 0; i < work.length; i++) {
    const it = work[i];
    try {
      if (it.mediaType === 'photo') {
        out[it.key] = await applyPhotoEdits(it);
      } else {
        out[it.key] = await applyVideoEdits(it, (n) => onProgress?.((i + n) / work.length));
      }
    } catch (err) {
      console.warn('[MediaEditor] failed to apply edits for', it.key, err);
      // Skip this one — caller will fall back to the original file.
    }
    onProgress?.((i + 1) / work.length);
  }
  return out;
}

export function isEdited(edits: EditState): boolean {
  return (
    edits.brightness !== 100 ||
    edits.contrast !== 100 ||
    edits.saturation !== 100 ||
    edits.filterPreset !== 'none' ||
    edits.aspectRatio !== 'free' ||
    edits.crop.x !== 0 || edits.crop.y !== 0 ||
    edits.crop.width !== 1 || edits.crop.height !== 1 ||
    (edits.trim != null && (edits.trim.start > 0.05 || (edits.trim.end != null && edits.trim.end > 0)))
  );
}

/* ── Editor UI ───────────────────────────────────────────────────────── */

type Tab = 'crop' | 'adjust' | 'filter' | 'trim';

interface MediaEditorProps {
  items: EditableItem[];
  /** Currently focused item key. */
  activeKey: string;
  onActiveChange: (key: string) => void;
  /** Push edits for the active item back up. */
  onEditsChange: (key: string, edits: EditState) => void;
}

export const MediaEditor: React.FC<MediaEditorProps> = ({ items, activeKey, onActiveChange, onEditsChange }) => {
  const active = items.find((it) => it.key === activeKey) ?? items[0];
  const activeIdx = active ? items.findIndex((it) => it.key === active.key) : -1;

  // Per-item natural source size — needed to convert pan deltas into
  // normalised crop offsets. Stored by key.
  const [naturalSizes, setNaturalSizes] = useState<Record<string, { w: number; h: number }>>({});

  // Peek-carousel refs — mirror the layout used by the post Tag step
  // so the Edit step feels like one continuous flow. The scroll
  // handler tracks which slide is centered and sync-snaps when the
  // active key changes from outside.
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  useEffect(() => {
    if (!active) return;
    const slide = slideRefs.current.get(active.key);
    const carousel = carouselRef.current;
    if (!slide || !carousel) return;
    const desired = slide.offsetLeft - (carousel.clientWidth - slide.offsetWidth) / 2;
    if (Math.abs(carousel.scrollLeft - desired) > 6) {
      carousel.scrollTo({ left: desired, behavior: 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.key, items.length]);

  useEffect(() => {
    if (!active) return;
    videoRefs.current.forEach((v, key) => {
      if (key === active.key) return;
      try { v.pause(); } catch { /* ignore */ }
    });
  }, [active?.key]);

  // Default the tab to the most useful one for the media type.
  const [tab, setTab] = useState<Tab>(active?.mediaType === 'video' ? 'trim' : 'crop');

  // When the active media type changes, snap to a sensible default tab.
  useEffect(() => {
    if (!active) return;
    if (active.mediaType === 'video' && (tab === 'crop')) setTab('trim');
    if (active.mediaType === 'photo' && tab === 'trim') setTab('crop');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.key, active?.mediaType]);

  const onNatural = (key: string, w: number, h: number) => {
    setNaturalSizes((prev) => prev[key]?.w === w && prev[key]?.h === h ? prev : { ...prev, [key]: { w, h } });
  };

  if (!active) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-on-surface/45">
        <Sparkles size={26} className="mb-2 text-on-surface/30" />
        <p className="text-[13px]">Nothing to edit — go back and pick some media first.</p>
      </div>
    );
  }

  const edits = active.edits;
  const setEdits = (next: Partial<EditState>) => onEditsChange(active.key, { ...edits, ...next });
  const natural = naturalSizes[active.key];

  return (
    <div className="space-y-4">
      {/* Items header — count + active position, mirrors the Tag step
          so the two steps feel visually continuous. */}
      {items.length > 1 && (
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface/45">
            Items <span className="text-on-surface/30 font-medium ml-1.5">{activeIdx + 1} / {items.length}</span>
          </p>
          {isEdited(active.edits) && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700">
              <Check size={10} /> Edited
            </span>
          )}
        </div>
      )}

      {/* Peek carousel — 82% width slides with snap-center. The active
          slide renders the live edit preview (CSS filter chain + crop
          overlay); peeks dim and scale down so the active item reads
          as the focus. Videos auto-play (muted, looping) on the active
          slide only. */}
      <div className="-mx-5">
        <div
          ref={carouselRef}
          className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide gap-3 px-[9%] pb-1"
          onScroll={() => {
            const el = carouselRef.current;
            if (!el) return;
            const center = el.scrollLeft + el.clientWidth / 2;
            let bestKey: string | null = null;
            let bestDist = Infinity;
            slideRefs.current.forEach((slide, key) => {
              const slideCenter = slide.offsetLeft + slide.offsetWidth / 2;
              const dist = Math.abs(slideCenter - center);
              if (dist < bestDist) { bestDist = dist; bestKey = key; }
            });
            if (bestKey && bestKey !== active.key) onActiveChange(bestKey);
          }}
        >
          {items.map((it, idx) => {
            const isActive = it.key === active.key;
            const filter = cssFilterFor(it.edits);
            const touched = isEdited(it.edits);
            return (
              <div
                key={it.key}
                ref={(el) => {
                  if (el) slideRefs.current.set(it.key, el);
                  else slideRefs.current.delete(it.key);
                }}
                className={cn(
                  'relative flex-shrink-0 w-[82%] aspect-[3/4] rounded-2xl overflow-hidden snap-center bg-black transition-all duration-300',
                  isActive ? 'scale-100 opacity-100' : 'scale-[0.94] opacity-70',
                )}
              >
                {it.mediaType === 'photo' ? (
                  <img
                    src={it.previewUrl}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-contain"
                    style={{ filter }}
                    onLoad={(e) => {
                      const t = e.currentTarget;
                      onNatural(it.key, t.naturalWidth, t.naturalHeight);
                    }}
                  />
                ) : (
                  <video
                    ref={(el) => {
                      if (el) videoRefs.current.set(it.key, el);
                      else videoRefs.current.delete(it.key);
                    }}
                    src={it.previewUrl}
                    muted
                    loop
                    autoPlay={isActive}
                    playsInline
                    preload="metadata"
                    className="absolute inset-0 w-full h-full object-contain"
                    style={{ filter }}
                    onLoadedMetadata={(e) => {
                      const v = e.currentTarget;
                      onNatural(it.key, v.videoWidth, v.videoHeight);
                    }}
                  />
                )}
                {/* Crop overlay — same dimmed-outside-the-rect look as
                    the original viewport. Only renders when the user
                    has picked a non-free aspect. */}
                {it.edits.aspectRatio !== 'free' && <CropOverlay edits={it.edits} />}
                {/* Index pill + edit indicator on the corner. */}
                <div className="absolute inset-x-0 bottom-0 px-3 py-2 bg-gradient-to-t from-black/65 to-transparent flex items-center justify-between gap-2 pointer-events-none">
                  <span className="text-[12px] font-bold text-white/90 tabular-nums">#{idx + 1}</span>
                </div>
                {touched && (
                  <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary text-white text-[10px] font-bold uppercase tracking-wider shadow-sm">
                    <Check size={10} strokeWidth={3} /> Edited
                  </span>
                )}
                {/* Tap-anywhere overlay for peeks — selects the slide
                    without triggering the underlying media. */}
                {!isActive && (
                  <button
                    type="button"
                    onClick={() => onActiveChange(it.key)}
                    className="absolute inset-0 z-10"
                    aria-label={`Edit item ${idx + 1}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pagination dots — only render when there's more than one
          item; same primary-pip style as the Tag step. */}
      {items.length > 1 && (
        <div className="flex items-center justify-center gap-1.5">
          {items.map((it) => (
            <motion.span
              key={it.key}
              className={cn(
                'h-1.5 rounded-full',
                it.key === active.key ? 'bg-primary' : 'bg-on-surface/15',
              )}
              animate={{ width: it.key === active.key ? 18 : 5 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            />
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center justify-center gap-1 rounded-full bg-on-surface/[0.05] p-1">
        {([
          { id: 'crop',   icon: Crop,    label: 'Crop',    show: active.mediaType === 'photo' },
          { id: 'trim',   icon: Scissors,label: 'Trim',    show: active.mediaType === 'video' },
          { id: 'adjust', icon: Sun,     label: 'Adjust',  show: true },
          { id: 'filter', icon: Sparkles,label: 'Filters', show: true },
        ] as const).filter((t) => t.show).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-full text-[12.5px] font-bold transition-colors',
                tab === t.id ? 'bg-white shadow text-on-surface' : 'text-on-surface/55 hover:text-on-surface',
              )}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab body */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab + active.key}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          {tab === 'crop' && (
            <CropTab edits={edits} setEdits={setEdits} natural={natural} />
          )}
          {tab === 'adjust' && (
            <AdjustTab edits={edits} setEdits={setEdits} />
          )}
          {tab === 'filter' && (
            <FilterTab edits={edits} setEdits={setEdits} />
          )}
          {tab === 'trim' && active.mediaType === 'video' && (
            <TrimTab item={active} edits={edits} setEdits={setEdits} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

/* ── Viewport — preview with crop overlay + pan ──────────────────────── */


const CropOverlay: React.FC<{ edits: EditState }> = ({ edits }) => {
  const { x, y, width, height } = edits.crop;
  // Top, right, bottom, left dim rectangles plus the boundary.
  return (
    <div className="absolute inset-0 pointer-events-none">
      <div className="absolute inset-x-0 top-0 bg-black/45" style={{ height: `${y * 100}%` }} />
      <div className="absolute inset-x-0 bottom-0 bg-black/45" style={{ height: `${(1 - y - height) * 100}%` }} />
      <div className="absolute bg-black/45" style={{ left: 0, top: `${y * 100}%`, height: `${height * 100}%`, width: `${x * 100}%` }} />
      <div className="absolute bg-black/45" style={{ right: 0, top: `${y * 100}%`, height: `${height * 100}%`, width: `${(1 - x - width) * 100}%` }} />
      <div
        className="absolute border border-white/85 rounded-sm"
        style={{
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          width: `${width * 100}%`,
          height: `${height * 100}%`,
        }}
      />
    </div>
  );
};

/* ── Tabs ────────────────────────────────────────────────────────────── */

const ASPECT_CHIPS: { value: AspectRatio; label: string }[] = [
  { value: 'free',  label: 'Original' },
  { value: '1:1',   label: '1:1' },
  { value: '4:5',   label: '4:5' },
  { value: '9:16',  label: '9:16' },
  { value: '16:9',  label: '16:9' },
];

const CropTab: React.FC<{ edits: EditState; setEdits: (n: Partial<EditState>) => void; natural?: { w: number; h: number } }> = ({ edits, setEdits, natural }) => {
  const pickAspect = (ratio: AspectRatio) => {
    const w = natural?.w ?? 1;
    const h = natural?.h ?? 1;
    const crop = defaultCropForRatio(ratio, w, h);
    setEdits({ aspectRatio: ratio, crop });
  };
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-2">Aspect ratio</p>
      <div className="flex gap-1.5 flex-wrap">
        {ASPECT_CHIPS.map((chip) => {
          const active = edits.aspectRatio === chip.value;
          return (
            <button
              key={chip.value}
              type="button"
              onClick={() => pickAspect(chip.value)}
              className={cn(
                'px-3 h-8 rounded-full text-[12px] font-bold transition-colors',
                active
                  ? 'bg-primary text-white'
                  : 'bg-on-surface/[0.05] text-on-surface/65 hover:bg-on-surface/10',
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
      {edits.aspectRatio !== 'free' && (
        <p className="text-[11px] text-on-surface/45 mt-2 leading-relaxed">
          The crop is centred. Pick "Original" to keep the full frame.
        </p>
      )}
    </div>
  );
};

const AdjustTab: React.FC<{ edits: EditState; setEdits: (n: Partial<EditState>) => void }> = ({ edits, setEdits }) => {
  return (
    <div className="space-y-3.5">
      <Slider
        icon={<Sun size={14} />}
        label="Brightness"
        value={edits.brightness}
        onChange={(v) => setEdits({ brightness: v })}
      />
      <Slider
        icon={<Contrast size={14} />}
        label="Contrast"
        value={edits.contrast}
        onChange={(v) => setEdits({ contrast: v })}
      />
      <Slider
        icon={<Droplet size={14} />}
        label="Saturation"
        value={edits.saturation}
        onChange={(v) => setEdits({ saturation: v })}
      />
      <button
        type="button"
        onClick={() => setEdits({ brightness: 100, contrast: 100, saturation: 100 })}
        className="inline-flex items-center gap-1 text-[12px] font-semibold text-on-surface/55 hover:text-on-surface"
      >
        <Wand2 size={12} /> Reset adjustments
      </button>
    </div>
  );
};

const FilterTab: React.FC<{ edits: EditState; setEdits: (n: Partial<EditState>) => void }> = ({ edits, setEdits }) => {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-2">Preset</p>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {FILTER_PRESETS.map((preset) => {
          const active = edits.filterPreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => setEdits({ filterPreset: preset.id })}
              className={cn(
                'flex flex-col items-center gap-1 flex-shrink-0 group transition-opacity',
                active ? 'opacity-100' : 'opacity-80 hover:opacity-100',
              )}
            >
              <div
                className={cn(
                  'w-14 h-14 rounded-xl overflow-hidden border-2 transition-colors bg-gradient-to-br from-amber-200 to-rose-300',
                  active ? 'border-primary' : 'border-transparent',
                )}
                style={{ filter: preset.filter }}
              />
              <span className={cn('text-[10.5px] font-bold', active ? 'text-primary' : 'text-on-surface/55')}>{preset.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const TrimTab: React.FC<{ item: EditableItem; edits: EditState; setEdits: (n: Partial<EditState>) => void }> = ({ item, edits, setEdits }) => {
  const duration = item.durationSeconds ?? 0;
  const trim = edits.trim ?? { start: 0, end: duration };
  const start = Math.max(0, Math.min(trim.start, duration));
  const end = Math.max(start + 0.5, Math.min(trim.end || duration, duration));
  const set = (next: Partial<typeof trim>) => setEdits({ trim: { start: next.start ?? start, end: next.end ?? end } });
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45">Trim</p>
      <div className="space-y-2 px-1">
        <RangeRow
          label="Start"
          value={start}
          min={0}
          max={Math.max(0.5, end - 0.5)}
          step={0.1}
          format={(v) => `${v.toFixed(1)}s`}
          onChange={(v) => set({ start: v })}
        />
        <RangeRow
          label="End"
          value={end}
          min={start + 0.5}
          max={duration || 60}
          step={0.1}
          format={(v) => `${v.toFixed(1)}s`}
          onChange={(v) => set({ end: v })}
        />
      </div>
      <p className="text-[12px] text-on-surface/55">
        Final length: <span className="font-bold tabular-nums text-on-surface/75">{(end - start).toFixed(1)}s</span>
      </p>
      <button
        type="button"
        onClick={() => setEdits({ trim: null })}
        className="inline-flex items-center gap-1 text-[12px] font-semibold text-on-surface/55 hover:text-on-surface"
      >
        <Wand2 size={12} /> Reset trim
      </button>
    </div>
  );
};

/* ── Sliders ─────────────────────────────────────────────────────────── */

const Slider: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number;
  onChange: (v: number) => void;
}> = ({ icon, label, value, onChange }) => (
  <div>
    <div className="flex items-center justify-between mb-1">
      <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-on-surface/75">
        <span className="text-on-surface/55">{icon}</span>
        {label}
      </span>
      <span className="text-[11.5px] tabular-nums text-on-surface/55">{value - 100 >= 0 ? '+' : ''}{value - 100}</span>
    </div>
    <input
      type="range"
      min={50}
      max={150}
      step={1}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full accent-primary"
    />
  </div>
);

const RangeRow: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, format, onChange }) => (
  <div>
    <div className="flex items-center justify-between mb-1">
      <span className="text-[12px] font-bold text-on-surface/75">{label}</span>
      <span className="text-[11.5px] tabular-nums text-on-surface/55">{format(value)}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full accent-primary"
    />
  </div>
);
