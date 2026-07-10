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
import { Crop, Sun, Contrast, Droplet, Scissors, Sparkles, Wand2, Check, Loader2, Play } from 'lucide-react';
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

  // Prefer MP4/H.264 — it's the ONLY thing iOS WKWebView's MediaRecorder
  // supports (the old WebM-only list threw NotSupportedError there, and the
  // caller's catch silently uploaded the unedited original). Mirrors
  // pickVideoMime in lib/media-compress.
  const preferredMimes = [
    'video/mp4;codecs=h264',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  const mimeType = preferredMimes.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));
  if (!mimeType) throw new Error('Video re-encoding not supported in this browser.');
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
  const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  return new File([blob], `${baseName}-edited.${ext}`, { type: mimeType });
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
  const work = items.filter((it) => isEdited(it.edits, it.durationSeconds) && !!it.file && it.previewUrl.startsWith('blob:'));
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

export function isEdited(edits: EditState, durationSeconds?: number | null): boolean {
  // A trim only counts as an edit when it actually narrows the window —
  // `end > 0` held for EVERY set trim (merely touching a handle forced the
  // destructive re-encode even after dragging it back to the full range).
  const trimActive =
    edits.trim != null &&
    (edits.trim.start > 0.05 ||
      (durationSeconds != null
        ? edits.trim.end < durationSeconds - 0.05
        : edits.trim.end > 0));
  return (
    edits.brightness !== 100 ||
    edits.contrast !== 100 ||
    edits.saturation !== 100 ||
    edits.filterPreset !== 'none' ||
    hasCustomCrop(edits) ||
    trimActive
  );
}

/** True when the crop diverges from the default full-frame
 *  selection. Used to decide whether to render the static crop
 *  overlay on peeks / non-crop tabs. */
export function hasCustomCrop(edits: EditState): boolean {
  return (
    edits.aspectRatio !== 'free' ||
    edits.crop.x > 0.001 ||
    edits.crop.y > 0.001 ||
    edits.crop.width < 0.999 ||
    edits.crop.height < 0.999
  );
}

/** Compute the on-screen pixel rectangle of an `object-contain`
 *  media element inside its container. Used by both the static and
 *  interactive crop overlays so the crop rect anchors to the photo
 *  itself, not the slide's letterboxed area. */
function computeMediaRect(
  containerW: number,
  containerH: number,
  mediaW: number | undefined,
  mediaH: number | undefined,
): { left: number; top: number; width: number; height: number } {
  if (!containerW || !containerH) return { left: 0, top: 0, width: containerW, height: containerH };
  if (!mediaW || !mediaH) return { left: 0, top: 0, width: containerW, height: containerH };
  const containerAspect = containerW / containerH;
  const mediaAspect = mediaW / mediaH;
  if (mediaAspect > containerAspect) {
    // Media is wider — letterbox top + bottom.
    const w = containerW;
    const h = containerW / mediaAspect;
    return { left: 0, top: (containerH - h) / 2, width: w, height: h };
  }
  // Media is taller (or equal) — letterbox left + right.
  const h = containerH;
  const w = containerH * mediaAspect;
  return { left: (containerW - w) / 2, top: 0, width: w, height: h };
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
  // Set on the same tick as the user-driven activeKey change so the
  // smooth-scroll effect below doesn't fight the native snap. Reset
  // the moment that effect skips its scrollTo.
  const userScrollChangeRef = useRef(false);
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) return;
    // Skip the programmatic snap when the active item changed because
    // the user swiped — the browser's native snap is already in
    // motion, and a competing smooth-scroll causes the visible
    // jitter.
    if (userScrollChangeRef.current) {
      userScrollChangeRef.current = false;
      return;
    }
    const slide = slideRefs.current.get(active.key);
    const carousel = carouselRef.current;
    if (!slide || !carousel) return;
    const desired = slide.offsetLeft - (carousel.clientWidth - slide.offsetWidth) / 2;
    // Larger threshold tolerates the fractional offset the browser
    // leaves at the end of a snap; only trigger a real correction when
    // we're far enough away to matter.
    if (Math.abs(carousel.scrollLeft - desired) > 24) {
      carousel.scrollTo({ left: desired, behavior: 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.key, items.length]);

  useEffect(() => () => {
    if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current);
  }, []);

  useEffect(() => {
    if (!active) return;
    videoRefs.current.forEach((v, key) => {
      if (key === active.key) return;
      try { v.pause(); } catch { /* ignore */ }
    });
  }, [active?.key]);

  // Keep the active video's playback in sync with its trim window —
  // seek to start when the trim moves the playhead out of range, and
  // loop back to start when playback hits trim.end so the preview
  // always shows just the trimmed range. Re-runs whenever the active
  // item or its trim values change.
  useEffect(() => {
    if (!active || active.mediaType !== 'video') return;
    const video = videoRefs.current.get(active.key);
    if (!video) return;
    const trim = active.edits.trim;
    if (!trim) return;
    // Snap the playhead inside the new window. Small tolerance so we
    // don't fight the user mid-frame when they barely nudge a handle.
    if (video.currentTime < trim.start - 0.05 || video.currentTime > trim.end + 0.05) {
      try { video.currentTime = trim.start; } catch { /* ignore */ }
    }
    const onTimeUpdate = () => {
      if (video.currentTime >= trim.end) {
        try { video.currentTime = trim.start; } catch { /* ignore */ }
      }
    };
    video.addEventListener('timeupdate', onTimeUpdate);
    return () => video.removeEventListener('timeupdate', onTimeUpdate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.key, active?.mediaType, active?.edits.trim?.start, active?.edits.trim?.end]);

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
          {isEdited(active.edits, active.durationSeconds) && (
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
          className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide gap-3 pb-1"
          onScroll={() => {
            // Debounce until the scroll has actually settled. Without
            // this, mid-snap onScroll events flip activeKey back and
            // forth as the dominant slide changes, and the slide
            // scale/opacity transitions look jittery.
            if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current);
            scrollEndTimerRef.current = setTimeout(() => {
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
              if (bestKey && bestKey !== active.key) {
                userScrollChangeRef.current = true;
                onActiveChange(bestKey);
              }
            }, 90);
          }}
        >
          {/* Leading spacer — eats the 9% peek area as real layout so
              `w-[82%]` resolves against the full container width and a
              single slide can snap-center exactly. */}
          <div className="flex-shrink-0 w-[9%]" aria-hidden />
          {items.map((it, idx) => {
            const isActive = it.key === active.key;
            const filter = cssFilterFor(it.edits);
            const touched = isEdited(it.edits, it.durationSeconds);
            return (
              <div
                key={it.key}
                ref={(el) => {
                  if (el) slideRefs.current.set(it.key, el);
                  else slideRefs.current.delete(it.key);
                }}
                className={cn(
                  // sm:max-h caps the slide on desktop so the trim
                  // strip / filter chips / Next button stay visible
                  // without scrolling.
                  'relative flex-shrink-0 w-[82%] aspect-[3/4] sm:max-h-[48vh] rounded-2xl overflow-hidden snap-center transition-[opacity,transform] duration-200 ease-out will-change-transform',
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
                  <VideoPreview
                    itemKey={it.key}
                    src={it.previewUrl}
                    filter={filter}
                    isActive={isActive}
                    onRefChange={(el) => {
                      if (el) videoRefs.current.set(it.key, el);
                      else videoRefs.current.delete(it.key);
                    }}
                    onNatural={onNatural}
                  />
                )}
                {/* Crop overlay.
                    - The active slide on the Crop tab gets the
                      interactive overlay so the user can drag the
                      corners / sides / interior.
                    - Other slides (peeks) and the active slide on
                      other tabs fall back to the static read-only
                      overlay so the user still sees what their crop
                      looks like, but without grab handles getting
                      in the way of the photo. */}
                {isActive && tab === 'crop' && it.mediaType === 'photo' ? (
                  <InteractiveCropOverlay
                    crop={it.edits.crop}
                    natural={naturalSizes[it.key]}
                    onChange={(nextCrop) => onEditsChange(it.key, { ...it.edits, crop: nextCrop, aspectRatio: 'free' })}
                  />
                ) : (
                  hasCustomCrop(it.edits) && <CropOverlay edits={it.edits} natural={naturalSizes[it.key]} />
                )}
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
          {/* Trailing spacer — mirrors the leading one so the last
              slide can snap-center without overshoot. */}
          <div className="flex-shrink-0 w-[9%]" aria-hidden />
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

/* ── Static crop overlay — read-only ──────────────────────────────────
 *
 * Anchored to the on-screen rect of the media itself (computed from
 * the natural size) so the crop indicator lands on the photo, not on
 * any letterbox area inside the slide. */

/** Instagram-style in-app video preview. No native controls bar — those
 *  would expose fullscreen / AirPlay / PiP affordances and a scrubber the
 *  user can drag past the trim window, defeating the whole editor. We
 *  instead overlay a tap-to-play/pause surface and show a play glyph
 *  when paused.
 *
 *  Trim enforcement lives in the parent (a timeupdate effect that loops
 *  the playhead back to trim.start when it crosses trim.end); without the
 *  exposed scrubber, the user can't break out of the trimmed range. */
const VideoPreview: React.FC<{
  itemKey: string;
  src: string;
  filter: string;
  isActive: boolean;
  onRefChange: (el: HTMLVideoElement | null) => void;
  onNatural: (key: string, w: number, h: number) => void;
}> = ({ itemKey, src, filter, isActive, onRefChange, onNatural }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [paused, setPaused] = useState(!isActive);

  const togglePlayPause = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => { /* user-gesture loss, harmless */ });
    else v.pause();
  };

  // Reflect external pause/play state changes (autoPlay on becoming
  // active, looping back inside the trim window) into the local UI.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, []);

  return (
    <>
      <video
        ref={(el) => {
          videoRef.current = el;
          onRefChange(el);
        }}
        src={src}
        muted
        loop
        autoPlay={isActive}
        playsInline
        preload="metadata"
        // Strip every browser-supplied affordance: no controls bar, no
        // fullscreen / PiP / AirPlay buttons, no remote-playback handoff.
        // controlsList is iOS-Safari-honoured; the others belt-and-brace.
        controls={false}
        disablePictureInPicture
        disableRemotePlayback
        controlsList="nodownload noplaybackrate nofullscreen noremoteplayback"
        // iOS-specific: keep playback inline (not the legacy fullscreen
        // auto-launch) and block AirPlay route discovery.
        webkit-playsinline="true"
        x-webkit-airplay="deny"
        className="absolute inset-0 w-full h-full object-contain"
        style={{ filter }}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          onNatural(itemKey, v.videoWidth, v.videoHeight);
        }}
      />
      {/* Full-bleed tap target. Catches clicks before they reach the
          underlying <video> (which would otherwise toggle play on its
          own on some platforms) so the paused-icon state stays
          consistent with reality. */}
      <button
        type="button"
        onClick={togglePlayPause}
        className="absolute inset-0 flex items-center justify-center bg-transparent"
        aria-label={paused ? 'Play' : 'Pause'}
      >
        {paused && (
          <span className="w-14 h-14 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center text-white pointer-events-none">
            <Play size={26} className="fill-white translate-x-[1.5px]" />
          </span>
        )}
      </button>
    </>
  );
};

const CropOverlay: React.FC<{ edits: EditState; natural?: { w: number; h: number } }> = ({ edits, natural }) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const mediaRect = computeMediaRect(size.w, size.h, natural?.w, natural?.h);
  const { x, y, width, height } = edits.crop;
  const cropPx = {
    left: mediaRect.left + x * mediaRect.width,
    top: mediaRect.top + y * mediaRect.height,
    width: width * mediaRect.width,
    height: height * mediaRect.height,
  };
  return (
    <div ref={wrapRef} className="absolute inset-0 pointer-events-none">
      {/* Dim every pixel outside the crop, anchored to the media rect. */}
      <div className="absolute bg-black/45" style={{ left: mediaRect.left, top: mediaRect.top, width: mediaRect.width, height: cropPx.top - mediaRect.top }} />
      <div className="absolute bg-black/45" style={{ left: mediaRect.left, top: cropPx.top + cropPx.height, width: mediaRect.width, height: (mediaRect.top + mediaRect.height) - (cropPx.top + cropPx.height) }} />
      <div className="absolute bg-black/45" style={{ left: mediaRect.left, top: cropPx.top, width: cropPx.left - mediaRect.left, height: cropPx.height }} />
      <div className="absolute bg-black/45" style={{ left: cropPx.left + cropPx.width, top: cropPx.top, width: (mediaRect.left + mediaRect.width) - (cropPx.left + cropPx.width), height: cropPx.height }} />
      <div
        className="absolute border border-white/85 rounded-sm"
        style={{ left: cropPx.left, top: cropPx.top, width: cropPx.width, height: cropPx.height }}
      />
    </div>
  );
};

/* ── Interactive crop overlay ─────────────────────────────────────────
 *
 * Drag the crop window or its 4 corner + 4 side handles to set a
 * custom crop. Every drag normalises against the media's on-screen
 * rect so the stored coords map cleanly back to the source pixels
 * regardless of how the media is letterboxed inside the slide.
 * Manual edits set aspectRatio: 'free' upstream so the aspect chips
 * stop highlighting until the user re-picks one. */

type CropDragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 'e' | 's' | 'w';

const MIN_CROP_FRACTION = 0.08;

const InteractiveCropOverlay: React.FC<{
  crop: CropRect;
  natural?: { w: number; h: number };
  onChange: (next: CropRect) => void;
}> = ({ crop, natural, onChange }) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const mediaRect = computeMediaRect(size.w, size.h, natural?.w, natural?.h);

  const dragRef = useRef<{
    mode: CropDragMode;
    pointerId: number;
    startCrop: CropRect;
    startClient: { x: number; y: number };
  } | null>(null);

  const onPointerDown = (mode: CropDragMode) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = {
      mode,
      pointerId: e.pointerId,
      startCrop: { ...crop },
      startClient: { x: e.clientX, y: e.clientY },
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!mediaRect.width || !mediaRect.height) return;
    const dx = (e.clientX - d.startClient.x) / mediaRect.width;
    const dy = (e.clientY - d.startClient.y) / mediaRect.height;
    const c = d.startCrop;
    let nx = c.x, ny = c.y, nw = c.width, nh = c.height;
    switch (d.mode) {
      case 'move':
        nx = Math.max(0, Math.min(c.x + dx, 1 - c.width));
        ny = Math.max(0, Math.min(c.y + dy, 1 - c.height));
        break;
      case 'nw':
        nx = Math.max(0, Math.min(c.x + dx, c.x + c.width - MIN_CROP_FRACTION));
        ny = Math.max(0, Math.min(c.y + dy, c.y + c.height - MIN_CROP_FRACTION));
        nw = c.x + c.width - nx;
        nh = c.y + c.height - ny;
        break;
      case 'ne':
        ny = Math.max(0, Math.min(c.y + dy, c.y + c.height - MIN_CROP_FRACTION));
        nh = c.y + c.height - ny;
        nw = Math.max(MIN_CROP_FRACTION, Math.min(c.width + dx, 1 - c.x));
        break;
      case 'sw':
        nx = Math.max(0, Math.min(c.x + dx, c.x + c.width - MIN_CROP_FRACTION));
        nw = c.x + c.width - nx;
        nh = Math.max(MIN_CROP_FRACTION, Math.min(c.height + dy, 1 - c.y));
        break;
      case 'se':
        nw = Math.max(MIN_CROP_FRACTION, Math.min(c.width + dx, 1 - c.x));
        nh = Math.max(MIN_CROP_FRACTION, Math.min(c.height + dy, 1 - c.y));
        break;
      case 'n':
        ny = Math.max(0, Math.min(c.y + dy, c.y + c.height - MIN_CROP_FRACTION));
        nh = c.y + c.height - ny;
        break;
      case 's':
        nh = Math.max(MIN_CROP_FRACTION, Math.min(c.height + dy, 1 - c.y));
        break;
      case 'w':
        nx = Math.max(0, Math.min(c.x + dx, c.x + c.width - MIN_CROP_FRACTION));
        nw = c.x + c.width - nx;
        break;
      case 'e':
        nw = Math.max(MIN_CROP_FRACTION, Math.min(c.width + dx, 1 - c.x));
        break;
    }
    onChange({ x: nx, y: ny, width: nw, height: nh });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  };

  const cropPx = {
    left: mediaRect.left + crop.x * mediaRect.width,
    top: mediaRect.top + crop.y * mediaRect.height,
    width: crop.width * mediaRect.width,
    height: crop.height * mediaRect.height,
  };

  return (
    <div ref={wrapRef} className="absolute inset-0 select-none">
      {/* Dim outside the crop, anchored to the media's on-screen rect. */}
      <div className="absolute bg-black/45 pointer-events-none" style={{ left: mediaRect.left, top: mediaRect.top, width: mediaRect.width, height: Math.max(0, cropPx.top - mediaRect.top) }} />
      <div className="absolute bg-black/45 pointer-events-none" style={{ left: mediaRect.left, top: cropPx.top + cropPx.height, width: mediaRect.width, height: Math.max(0, (mediaRect.top + mediaRect.height) - (cropPx.top + cropPx.height)) }} />
      <div className="absolute bg-black/45 pointer-events-none" style={{ left: mediaRect.left, top: cropPx.top, width: Math.max(0, cropPx.left - mediaRect.left), height: cropPx.height }} />
      <div className="absolute bg-black/45 pointer-events-none" style={{ left: cropPx.left + cropPx.width, top: cropPx.top, width: Math.max(0, (mediaRect.left + mediaRect.width) - (cropPx.left + cropPx.width)), height: cropPx.height }} />

      {/* Crop rect frame + thirds rule-of-thirds guides. */}
      <div
        className="absolute border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
        style={{ left: cropPx.left, top: cropPx.top, width: cropPx.width, height: cropPx.height }}
      >
        {/* Move handle: interior of the crop window. */}
        <div
          onPointerDown={onPointerDown('move')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute inset-0 cursor-move touch-none"
          aria-label="Drag crop"
        />
        {/* Rule-of-thirds guides. Pointer events disabled so the
            interior move handle keeps receiving drags. */}
        <div className="absolute inset-y-0 left-1/3 w-px bg-white/35 pointer-events-none" />
        <div className="absolute inset-y-0 left-2/3 w-px bg-white/35 pointer-events-none" />
        <div className="absolute inset-x-0 top-1/3 h-px bg-white/35 pointer-events-none" />
        <div className="absolute inset-x-0 top-2/3 h-px bg-white/35 pointer-events-none" />

        {/* Corner handles — square knobs that sit on the corners. */}
        {([
          { mode: 'nw', cls: '-top-2 -left-2 cursor-nwse-resize' },
          { mode: 'ne', cls: '-top-2 -right-2 cursor-nesw-resize' },
          { mode: 'sw', cls: '-bottom-2 -left-2 cursor-nesw-resize' },
          { mode: 'se', cls: '-bottom-2 -right-2 cursor-nwse-resize' },
        ] as const).map((h) => (
          <div
            key={h.mode}
            onPointerDown={onPointerDown(h.mode)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className={cn('absolute w-4 h-4 touch-none', h.cls)}
            aria-label={`Resize ${h.mode}`}
          >
            <span className="block w-full h-full bg-white rounded-[3px] shadow-[0_1px_3px_rgba(0,0,0,0.5)] border border-on-surface/30" />
          </div>
        ))}

        {/* Side handles — thin pills for nudging one edge at a time. */}
        {([
          { mode: 'n', cls: '-top-1.5 left-1/2 -translate-x-1/2 w-8 h-1.5 cursor-ns-resize' },
          { mode: 's', cls: '-bottom-1.5 left-1/2 -translate-x-1/2 w-8 h-1.5 cursor-ns-resize' },
          { mode: 'w', cls: '-left-1.5 top-1/2 -translate-y-1/2 h-8 w-1.5 cursor-ew-resize' },
          { mode: 'e', cls: '-right-1.5 top-1/2 -translate-y-1/2 h-8 w-1.5 cursor-ew-resize' },
        ] as const).map((h) => (
          <div
            key={h.mode}
            onPointerDown={onPointerDown(h.mode)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className={cn('absolute touch-none', h.cls)}
            aria-label={`Resize ${h.mode}`}
          >
            <span className="block w-full h-full bg-white rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.5)]" />
          </div>
        ))}
      </div>
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
      <p className="text-[11px] text-on-surface/45 mt-2 leading-relaxed">
        {edits.aspectRatio !== 'free'
          ? 'The crop is centred. Drag the corners or sides on the photo above to fine-tune — that switches you to a free crop.'
          : 'Drag the corners or sides on the photo above to crop. Pick a chip above to snap to a preset aspect ratio.'}
      </p>
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

/** Minimum trim duration so we never collapse the handles. */
const MIN_TRIM_SECONDS = 0.5;
const FRAME_COUNT = 8;
const STRIP_HEIGHT_PX = 64;

function formatTrimTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = safe - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/**
 * Extract `FRAME_COUNT` evenly-spaced thumbnails from a video by
 * seeking + drawing each frame to a canvas. Cached per source URL so
 * tab switches and remounts don't pay the seek cost again.
 *
 * Streaming-incremental: each thumbnail is handed to `onFrame` as soon
 * as its seek + paint completes. Seeks are inherently serial on the same
 * <video> element and each one can take 100-500 ms on iOS WebView for
 * HEVC clips coming straight from PhotoKit, so a "wait for all 8" model
 * stares at a black spinner for seconds. Streaming lets the strip paint
 * left-to-right in real time.
 */
const framesCache = new Map<string, string[]>();
async function extractFrames(
  src: string,
  duration: number,
  onFrame: (i: number, dataUrl: string) => void,
): Promise<string[]> {
  const cached = framesCache.get(src);
  if (cached) {
    cached.forEach((url, i) => onFrame(i, url));
    return cached;
  }
  const v = document.createElement('video');
  v.src = src;
  v.crossOrigin = 'anonymous';
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  await new Promise<void>((resolve, reject) => {
    v.onloadedmetadata = () => resolve();
    v.onerror = () => reject(new Error('video metadata load failed'));
  });
  // Match the actual displayed strip height — encoding at 96 px when the
  // strip renders at 64 px just burns CPU for no visible difference.
  const ratio = (v.videoWidth || 16) / (v.videoHeight || 9);
  const h = 72;
  const w = Math.max(48, Math.round(h * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');
  const out: string[] = [];
  const total = Math.max(1, duration);
  for (let i = 0; i < FRAME_COUNT; i++) {
    const t = (total * (i + 0.5)) / FRAME_COUNT;
    v.currentTime = Math.min(total - 0.05, t);
    await new Promise<void>((resolve) => { v.onseeked = () => resolve(); });
    ctx.drawImage(v, 0, 0, w, h);
    const url = canvas.toDataURL('image/jpeg', 0.6);
    out.push(url);
    onFrame(i, url);
  }
  framesCache.set(src, out);
  return out;
}

const TrimTab: React.FC<{ item: EditableItem; edits: EditState; setEdits: (n: Partial<EditState>) => void }> = ({ item, edits, setEdits }) => {
  const duration = Math.max(MIN_TRIM_SECONDS, item.durationSeconds ?? 0);
  const trim = edits.trim ?? { start: 0, end: duration };
  const start = Math.max(0, Math.min(trim.start, duration - MIN_TRIM_SECONDS));
  const end = Math.max(start + MIN_TRIM_SECONDS, Math.min(trim.end || duration, duration));

  // Extract filmstrip thumbnails for the current source. Slots are
  // pre-allocated and filled in left-to-right as each seek + paint
  // completes, so the user sees the strip materialize incrementally
  // instead of staring at a spinner for the full N×seekTime window.
  // Cached per URL so tab/back-forth doesn't re-seek the whole video.
  const [frames, setFrames] = useState<(string | null)[]>(() => {
    const cached = framesCache.get(item.previewUrl);
    return cached ? cached.slice() : new Array(FRAME_COUNT).fill(null);
  });
  const [framesError, setFramesError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFramesError(false);
    const cached = framesCache.get(item.previewUrl);
    if (cached) { setFrames(cached.slice()); return; }
    setFrames(new Array(FRAME_COUNT).fill(null));
    extractFrames(item.previewUrl, duration, (i, url) => {
      if (cancelled) return;
      setFrames((prev) => {
        const next = prev.slice();
        next[i] = url;
        return next;
      });
    }).catch(() => { if (!cancelled) setFramesError(true); });
    return () => { cancelled = true; };
  }, [item.previewUrl, duration]);

  // Drag state — `dragging` is which handle (or the whole window) is
  // being dragged, along with the offset between the pointer and the
  // handle so the user feels precise control instead of the handle
  // snapping under their finger.
  const stripRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<{ which: 'start' | 'end' | 'window'; pointerId: number; grabOffsetSec: number } | null>(null);

  const pointerXToTime = (clientX: number): number => {
    const el = stripRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  const onPointerDown = (which: 'start' | 'end' | 'window') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const t = pointerXToTime(e.clientX);
    const anchor = which === 'start' ? start : which === 'end' ? end : start;
    draggingRef.current = { which, pointerId: e.pointerId, grabOffsetSec: t - anchor };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = draggingRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const t = pointerXToTime(e.clientX) - d.grabOffsetSec;
    if (d.which === 'start') {
      const next = Math.max(0, Math.min(t, end - MIN_TRIM_SECONDS));
      if (Math.abs(next - start) > 0.02) setEdits({ trim: { start: next, end } });
    } else if (d.which === 'end') {
      const next = Math.max(start + MIN_TRIM_SECONDS, Math.min(t, duration));
      if (Math.abs(next - end) > 0.02) setEdits({ trim: { start, end: next } });
    } else {
      // Dragging the trim window — move both handles together.
      const len = end - start;
      const nextStart = Math.max(0, Math.min(t, duration - len));
      const nextEnd = nextStart + len;
      if (Math.abs(nextStart - start) > 0.02) setEdits({ trim: { start: nextStart, end: nextEnd } });
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = draggingRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    draggingRef.current = null;
  };

  const startPct = (start / duration) * 100;
  const endPct = (end / duration) * 100;
  const trimDuration = end - start;
  const isTouched = trim !== null && (trim.start > 0.05 || trim.end < duration - 0.05);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45">Trim</p>
        <p className="text-[13px] font-mono tabular-nums font-bold text-on-surface/85">
          {formatTrimTime(trimDuration)}
        </p>
      </div>

      {/* Filmstrip with draggable handles. */}
      <div className="relative rounded-lg bg-black overflow-hidden select-none" style={{ height: STRIP_HEIGHT_PX }}>
        {/* Thumbnail frames row. Each slot renders a frame as soon as
            extractFrames hands it off, with a subtle shimmer placeholder
            in slots that haven't decoded yet — so the strip paints
            left-to-right instead of waiting for the whole filmstrip. */}
        <div
          ref={stripRef}
          className="absolute inset-0 flex touch-none"
        >
          {frames.map((src, i) => (
            <div key={i} className="flex-1 min-w-0 h-full overflow-hidden pointer-events-none">
              {src ? (
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-white/[0.06] animate-pulse" />
              )}
            </div>
          ))}
          {framesError && (
            <div className="absolute inset-0 flex items-center justify-center text-[11px] text-white/60 bg-black/40">
              Couldn&apos;t preview frames
            </div>
          )}
        </div>

        {/* Dimmed regions outside the selection. */}
        <div className="absolute inset-y-0 left-0 bg-black/60 pointer-events-none" style={{ width: `${startPct}%` }} />
        <div className="absolute inset-y-0 right-0 bg-black/60 pointer-events-none" style={{ width: `${100 - endPct}%` }} />

        {/* Trim window — top + bottom borders + a draggable middle
            area that lets the user reposition the whole selection. */}
        <div
          className="absolute inset-y-0 border-y-[3px] border-primary"
          style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
        >
          <div
            onPointerDown={onPointerDown('window')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="absolute inset-0 cursor-grab active:cursor-grabbing touch-none"
            aria-label="Drag trim window"
          />
        </div>

        {/* Start handle */}
        <div
          onPointerDown={onPointerDown('start')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="slider"
          aria-label="Trim start"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={start}
          tabIndex={0}
          className="absolute top-0 bottom-0 flex items-center justify-center cursor-ew-resize touch-none z-10"
          style={{
            left: `calc(${startPct}% - 10px)`,
            width: 20,
          }}
        >
          <span className="block w-2.5 h-full bg-primary rounded-l-md flex items-center justify-center">
            <span className="block w-0.5 h-5 bg-white/85 rounded-full" />
          </span>
        </div>

        {/* End handle */}
        <div
          onPointerDown={onPointerDown('end')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="slider"
          aria-label="Trim end"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={end}
          tabIndex={0}
          className="absolute top-0 bottom-0 flex items-center justify-center cursor-ew-resize touch-none z-10"
          style={{
            left: `calc(${endPct}% - 10px)`,
            width: 20,
          }}
        >
          <span className="block w-2.5 h-full bg-primary rounded-r-md flex items-center justify-center">
            <span className="block w-0.5 h-5 bg-white/85 rounded-full" />
          </span>
        </div>
      </div>

      {/* Start / end timestamps below the strip. */}
      <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-on-surface/55">
        <span>{formatTrimTime(start)}</span>
        <span>of {formatTrimTime(duration)}</span>
        <span>{formatTrimTime(end)}</span>
      </div>

      {isTouched && (
        <button
          type="button"
          onClick={() => setEdits({ trim: null })}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-on-surface/55 hover:text-on-surface"
        >
          <Wand2 size={12} /> Reset trim
        </button>
      )}
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

