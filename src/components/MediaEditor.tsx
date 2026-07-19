/**
 * MediaEditor — Instagram-style per-item editor for photos and videos.
 *
 *   Photos: crop with aspect-ratio chips + pan, brightness / contrast /
 *           saturation / warmth / vignette controls, a strip of preset
 *           filters, and draggable text overlays (font, style, color,
 *           optional solid background). On apply, we re-render the photo
 *           through a canvas pipeline and hand back an edited JPEG.
 *   Videos: trim handles on a frame timeline plus the same color
 *           controls, presets and text overlays. On apply, we re-encode
 *           the trimmed + color-graded video (text baked into every
 *           frame) through canvas → MediaRecorder and hand back a WebM.
 *
 * The editor is content-agnostic: parents pass an array of EditableItem
 * (one per photo/video) and receive back the same items with their
 * `edits` state mutated and (after `applyAllEdits()`) an `editedFile`.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Crop, Sun, Contrast, Droplet, Scissors, Sparkles, Wand2, Check, Loader2, Play,
  Type, Bold, Italic, AlignLeft, AlignCenter, AlignRight, Plus, Trash2, Thermometer, Aperture,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { captureSourceAudio, mergeCanvasAndAudio, sourceHadAudio, pickVideoMime } from '../lib/media-audio';

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
  { id: 'golden',  label: 'Golden',  filter: 'sepia(0.3) saturate(1.35) contrast(1.05) brightness(1.06)' },
  { id: 'cool',    label: 'Cool',    filter: 'saturate(1.15) hue-rotate(8deg) brightness(0.98)' },
  { id: 'crisp',   label: 'Crisp',   filter: 'contrast(1.15) saturate(1.1) brightness(1.02)' },
  { id: 'pop',     label: 'Pop',     filter: 'saturate(1.45) contrast(1.08)' },
  { id: 'bw',      label: 'B & W',   filter: 'grayscale(1) contrast(1.05) brightness(1.02)' },
  { id: 'mono',    label: 'Mono',    filter: 'grayscale(1) brightness(1.05) contrast(1.1)' },
  { id: 'noir',    label: 'Noir',    filter: 'grayscale(1) contrast(1.3) brightness(0.94)' },
  { id: 'fade',    label: 'Fade',    filter: 'saturate(0.8) contrast(0.92) brightness(1.06)' },
];

/** Normalised crop rect within the source. (0..1 in each dimension.) */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A user-placed text box, baked into the exported media on apply. */
export interface TextOverlay {
  id: string;
  /** Content; supports newlines. */
  text: string;
  /** Normalised centre position within the FULL (uncropped) source. */
  x: number;
  y: number;
  /** Font size as a fraction of the source width (e.g. 0.07). */
  size: number;
  /** Text color (hex). */
  color: string;
  /** Solid background behind the text box, or null for none. */
  bg: string | null;
  font: 'serif' | 'sans' | 'mono';
  weight: 'normal' | 'bold';
  italic: boolean;
  align: 'left' | 'center' | 'right';
}

/** Fonts offered for text overlays — the app's own loaded families, so
 *  the canvas bake renders exactly what the preview shows. */
export const TEXT_FONTS: { id: TextOverlay['font']; label: string; stack: string }[] = [
  { id: 'serif', label: 'Serif', stack: '"Fraunces", "Noto Serif", serif' },
  { id: 'sans',  label: 'Sans',  stack: '"Manrope", sans-serif' },
  { id: 'mono',  label: 'Mono',  stack: '"JetBrains Mono", ui-monospace, monospace' },
];

/** Swatches for overlay text + backgrounds — brand-adjacent palette. */
export const TEXT_COLORS = [
  '#ffffff', '#1d1a16', '#fbf4f0', '#9f3012',
  '#d97706', '#1e7a55', '#2563eb', '#e11d48',
] as const;

export interface EditState {
  /** Normalised crop rectangle. The source extent is implicitly 0..1. */
  crop: CropRect;
  aspectRatio: AspectRatio;
  brightness: number;   // 100 = neutral, range 50..150
  contrast: number;     // 100 = neutral
  saturation: number;   // 100 = neutral
  /** 100 = neutral; >100 shifts warmer (amber), <100 cooler (blue). */
  warmth: number;
  /** 0 = off, 100 = strongest edge darkening. */
  vignette: number;
  filterPreset: string; // FilterPreset.id
  /** User-placed text boxes, drawn over the media on apply. */
  texts: TextOverlay[];
  /** Video-only — trim window in seconds. Null when untouched. */
  trim?: { start: number; end: number } | null;
}

export const DEFAULT_EDIT_STATE: EditState = {
  crop: { x: 0, y: 0, width: 1, height: 1 },
  aspectRatio: 'free',
  brightness: 100,
  contrast: 100,
  saturation: 100,
  warmth: 100,
  vignette: 0,
  filterPreset: 'none',
  texts: [],
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
  const parts = [
    `brightness(${edits.brightness / 100})`,
    `contrast(${edits.contrast / 100})`,
    `saturate(${edits.saturation / 100})`,
  ];
  // Warmth: piecewise approximation with plain CSS filters (shared by the
  // live preview and the canvas bake, so both stay pixel-identical).
  const wd = ((edits.warmth ?? 100) - 100) / 50; // -1..1
  if (wd > 0.001) {
    parts.push(`sepia(${(wd * 0.32).toFixed(3)}) saturate(${(1 + wd * 0.18).toFixed(3)}) hue-rotate(${(-wd * 6).toFixed(1)}deg)`);
  } else if (wd < -0.001) {
    parts.push(`hue-rotate(${(-wd * 10).toFixed(1)}deg) saturate(${(1 + wd * 0.12).toFixed(3)})`);
  }
  const tweaks = parts.join(' ');
  return preset === 'none' ? tweaks : `${preset} ${tweaks}`;
}

/* ── Overlay drawing (vignette + text) — shared by photo & video bake ── */

function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number, strength: number): void {
  if (strength <= 0) return;
  const cx = w / 2;
  const cy = h / 2;
  // Outer radius = farthest corner, matching the CSS preview's default
  // `radial-gradient(circle, …)` extent.
  const outer = Math.hypot(w, h) / 2;
  const g = ctx.createRadialGradient(cx, cy, outer * 0.55, cx, cy, outer);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${(0.72 * strength) / 100})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

const TEXT_LINE_HEIGHT = 1.25;
const TEXT_PAD_X = 0.5;  // × font size, when a background is set
const TEXT_PAD_Y = 0.32;
const TEXT_BG_RADIUS = 0.3;

/**
 * Draw the text overlays into a canvas whose origin is offset (offX, offY)
 * pixels into the full source of (sw × sh) pixels — i.e. the crop window.
 * Overlay coords are normalised against the FULL source so this maps the
 * preview (which shows the uncropped media) onto the cropped output; text
 * dragged outside the crop simply falls off the canvas, mirroring the
 * dimmed regions the user saw.
 */
function drawTextOverlays(
  ctx: CanvasRenderingContext2D,
  texts: TextOverlay[],
  sw: number,
  sh: number,
  offX: number,
  offY: number,
): void {
  for (const t of texts) {
    const content = t.text.trim();
    if (!content) continue;
    const px = Math.max(8, t.size * sw);
    const lineHeight = px * TEXT_LINE_HEIGHT;
    const fontStack = TEXT_FONTS.find((f) => f.id === t.font)?.stack ?? TEXT_FONTS[0].stack;
    ctx.font = `${t.italic ? 'italic ' : ''}${t.weight === 'bold' ? '700' : '400'} ${px}px ${fontStack}`;
    const lines = t.text.split('\n');
    const widths = lines.map((l) => ctx.measureText(l).width);
    const maxW = Math.max(1, ...widths);
    const totalH = lines.length * lineHeight;
    const cx = t.x * sw - offX;
    const cy = t.y * sh - offY;
    if (t.bg) {
      const padX = px * TEXT_PAD_X;
      const padY = px * TEXT_PAD_Y;
      ctx.fillStyle = t.bg;
      roundedRectPath(ctx, cx - maxW / 2 - padX, cy - totalH / 2 - padY, maxW + padX * 2, totalH + padY * 2, px * TEXT_BG_RADIUS);
      ctx.fill();
    }
    ctx.fillStyle = t.color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = t.align;
    const lineX = t.align === 'left' ? cx - maxW / 2 : t.align === 'right' ? cx + maxW / 2 : cx;
    lines.forEach((line, i) => {
      ctx.fillText(line, lineX, cy - totalH / 2 + lineHeight * (i + 0.5));
    });
  }
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
  // Make sure the overlay fonts are decoded before we measure/draw text,
  // otherwise the canvas silently falls back to a default face.
  try { await document.fonts.ready; } catch { /* non-blocking */ }
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
  // Overlays draw unfiltered — the vignette darkens the graded pixels and
  // the text keeps its exact chosen colors.
  ctx.filter = 'none';
  drawVignette(ctx, cropW, cropH, item.edits.vignette ?? 0);
  drawTextOverlays(ctx, item.edits.texts ?? [], sw, sh, cropX, cropY);
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.92),
  );
  const originalName = item.file?.name ?? 'edited.jpg';
  const baseName = originalName.replace(/\.[a-z0-9]+$/i, '') || 'edited';
  return new File([blob], `${baseName}-edited.jpg`, { type: 'image/jpeg' });
}

/* ── Video apply (MediaRecorder) ─────────────────────────────────────── */

async function applyVideoEdits(
  item: EditableItem,
  onProgress?: (n: number) => void,
  onAudioDropped?: () => void,
): Promise<File> {
  // Bring up an off-screen video element pointed at the source. We
  // need to seek to the trim start and play through to the trim end
  // while a canvas + MediaRecorder captures the cropped, colour-graded
  // frames.
  const v = document.createElement('video');
  v.src = item.previewUrl;
  v.muted = true; // required for playback without user gesture on some browsers
  v.playsInline = true;
  v.preload = 'auto';

  // Drop the element's decoder/buffer hold on the blob so a failed run
  // doesn't pin the source bytes in memory.
  const releaseVideo = () => {
    try { v.removeAttribute('src'); v.load(); } catch { /* best-effort */ }
  };

  // Every wait below (metadata, seek, playback) can stall FOREVER on a
  // corrupt or codec-unsupported source — some engines never fire 'error'
  // for a decode that silently goes nowhere. Race each wait against the
  // element's 'error' event and a hard timeout, so a bad clip rejects and
  // applyAllEdits' catch falls back to uploading the original file instead
  // of hanging the whole submit.
  const raceDecode = <T,>(p: Promise<T>, ms: number, what: string) =>
    new Promise<T>((resolve, reject) => {
      let timer = 0;
      const finish = (fn: () => void) => {
        window.clearTimeout(timer);
        v.removeEventListener('error', onError);
        fn();
      };
      const onError = () => finish(() => reject(new Error(`Couldn't decode video (${what}).`)));
      timer = window.setTimeout(() => finish(() => reject(new Error(`Video ${what} timed out.`))), ms);
      v.addEventListener('error', onError);
      p.then((val) => finish(() => resolve(val)), (err: unknown) => finish(() => reject(err)));
    });

  try {
    await raceDecode(new Promise<void>((resolve) => { v.onloadedmetadata = () => resolve(); }), 15_000, 'metadata load');
  } catch (err) {
    releaseVideo();
    throw err;
  }
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
  try {
    await raceDecode(new Promise<void>((resolve) => { v.onseeked = () => resolve(); }), 15_000, 'seek');
  } catch (err) {
    releaseVideo();
    throw err;
  }

  const canvasStream = (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream?.(30);
  if (!canvasStream) throw new Error('Canvas capture not supported in this browser.');

  // Merge the source's AUDIO in — a canvas stream is video-only, so without
  // this every edited clip would upload silent. captureStream() ignores the
  // element's `muted` flag (that only gates the speaker), so the recorded
  // audio is intact even though playback below is muted for autoplay.
  const audio = captureSourceAudio(v);
  const { stream, audioAttached } = mergeCanvasAndAudio(canvasStream, audio.tracks);

  // AAC/Opus-audio mime variants first so the recorder actually muxes audio;
  // MP4/H.264 also happens to be the only thing iOS WKWebView records.
  const mimeType = pickVideoMime();
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
  // when we hit the trim end. Vignette + text overlays are re-drawn on
  // every frame (unfiltered) so they bake into the output.
  const vignette = item.edits.vignette ?? 0;
  const texts = item.edits.texts ?? [];
  const hasOverlays = vignette > 0 || texts.length > 0;
  if (hasOverlays) {
    try { await document.fonts.ready; } catch { /* non-blocking */ }
  }
  let cancelled = false;
  const drawLoop = () => {
    if (cancelled) return;
    if (v.currentTime >= end || v.ended) {
      v.pause();
      return;
    }
    ctx.drawImage(v, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    if (hasOverlays) {
      ctx.save();
      ctx.filter = 'none';
      drawVignette(ctx, cropW, cropH, vignette);
      drawTextOverlays(ctx, texts, sw, sh, cropX, cropY);
      ctx.restore();
    }
    const elapsed = Math.min(totalSeconds, v.currentTime - start);
    onProgress?.(Math.max(0, Math.min(1, elapsed / totalSeconds)));
    requestAnimationFrame(drawLoop);
  };

  try {
    await v.play();
    requestAnimationFrame(drawLoop);

    // Wait for playback to reach the trim end (or natural end). Recording
    // runs in real time, so budget ~3× the clip length (buffering, slow
    // devices) plus slack before calling it stuck.
    const playbackTimeoutMs = Math.min(10 * 60_000, totalSeconds * 3_000 + 20_000);
    await raceDecode(new Promise<void>((resolve) => {
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
    }), playbackTimeoutMs, 'playback');
  } catch (err) {
    // Kill the rAF loop and the recorder before surfacing the error —
    // otherwise they'd keep drawing/recording off a dead video forever.
    cancelled = true;
    try { v.pause(); } catch { /* already broken */ }
    await stopRecorder();
    canvasStream.getTracks().forEach((t) => t.stop());
    audio.cleanup();
    releaseVideo();
    throw err;
  }

  await stopRecorder();
  canvasStream.getTracks().forEach((t) => t.stop());
  audio.cleanup();

  // If we couldn't attach audio but the source actually had some (checked
  // after playthrough, when webkitAudioDecodedByteCount is populated), tell
  // the caller so it can warn the user instead of silently dropping sound.
  if (!audioAttached && sourceHadAudio(v) === true) onAudioDropped?.();
  releaseVideo();

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
  onAudioDropped?: () => void,
): Promise<Record<string, File>> {
  const out: Record<string, File> = {};
  const work = items.filter((it) => isEdited(it.edits, it.durationSeconds) && !!it.file && it.previewUrl.startsWith('blob:'));
  if (work.length === 0) {
    onProgress?.(1);
    return out;
  }
  // Warn at most once per apply-all run even if several clips drop audio.
  let audioWarned = false;
  const notifyAudioDropped = () => {
    if (audioWarned) return;
    audioWarned = true;
    onAudioDropped?.();
  };
  for (let i = 0; i < work.length; i++) {
    const it = work[i];
    try {
      if (it.mediaType === 'photo') {
        out[it.key] = await applyPhotoEdits(it);
      } else {
        out[it.key] = await applyVideoEdits(it, (n) => onProgress?.((i + n) / work.length), notifyAudioDropped);
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
    (edits.warmth ?? 100) !== 100 ||
    (edits.vignette ?? 0) > 0 ||
    (edits.texts ?? []).some((t) => t.text.trim().length > 0) ||
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

type Tab = 'crop' | 'adjust' | 'filter' | 'text' | 'trim';

/** Exported for split-layout hosts (desktop composer) that own the tab
 *  state themselves and compose EditorStage + EditorControls. */
export type EditorTab = Tab;

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

  // Filter-swatch preview: the source for photos, the first extracted
  // frame for videos (videos used to show a generic gradient).
  const swatchPreview = useSwatchPreview(active);

  // Which text overlay is selected for editing (Text tab). Reset when
  // the active item changes so we never edit a stale overlay.
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  useEffect(() => { setSelectedTextId(null); }, [active?.key]);

  // When the active media type changes, snap off tabs the new type
  // doesn't have (photos have no trim; crop applies to both).
  useEffect(() => {
    if (!active) return;
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
                {isActive && tab === 'crop' ? (
                  <InteractiveCropOverlay
                    crop={it.edits.crop}
                    natural={naturalSizes[it.key]}
                    onChange={(nextCrop) => onEditsChange(it.key, { ...it.edits, crop: nextCrop, aspectRatio: 'free' })}
                  />
                ) : (
                  hasCustomCrop(it.edits) && <CropOverlay edits={it.edits} natural={naturalSizes[it.key]} />
                )}
                {/* Vignette + text overlays. Read-only everywhere so the
                    preview always mirrors the final output; interactive
                    (drag to reposition, tap to select) on the active
                    slide while the Text tab is open. */}
                <MediaOverlays
                  edits={it.edits}
                  natural={naturalSizes[it.key]}
                  interactive={isActive && tab === 'text'}
                  selectedId={isActive ? selectedTextId : null}
                  onSelect={(id) => setSelectedTextId(id)}
                  onTextsChange={(texts) => onEditsChange(it.key, { ...it.edits, texts })}
                />
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
          { id: 'crop',   icon: Crop,    label: 'Crop',    show: true },
          { id: 'trim',   icon: Scissors,label: 'Trim',    show: active.mediaType === 'video' },
          { id: 'adjust', icon: Sun,     label: 'Adjust',  show: true },
          { id: 'filter', icon: Sparkles,label: 'Filters', show: true },
          { id: 'text',   icon: Type,    label: 'Text',    show: true },
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
            <FilterTab
              edits={edits}
              setEdits={setEdits}
              previewUrl={swatchPreview}
            />
          )}
          {tab === 'text' && (
            <TextTab
              edits={edits}
              setEdits={setEdits}
              selectedId={selectedTextId}
              onSelect={setSelectedTextId}
            />
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

/* ── Vignette + text overlay layer (preview) ──────────────────────────
 *
 * Anchored to the media's on-screen rect (like the crop overlays) so
 * overlay coords map 1:1 onto source pixels. Read-only by default; when
 * `interactive` the text boxes can be dragged to reposition and tapped
 * to select for editing in the Text tab. */

const MediaOverlays: React.FC<{
  edits: EditState;
  natural?: { w: number; h: number };
  interactive?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onTextsChange?: (texts: TextOverlay[]) => void;
}> = ({ edits, natural, interactive = false, selectedId, onSelect, onTextsChange }) => {
  // Callback-ref + state so the ResizeObserver attaches whenever the
  // wrapper (re)mounts — this component returns null until there's an
  // overlay to draw, so a mount-once effect would observe nothing and
  // every overlay would render at 0×0.
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!wrapEl) return;
    const update = () => {
      const r = wrapEl.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapEl);
    return () => ro.disconnect();
  }, [wrapEl]);
  const mediaRect = computeMediaRect(size.w, size.h, natural?.w, natural?.h);

  const texts = edits.texts ?? [];
  const vignette = edits.vignette ?? 0;

  const dragRef = useRef<{
    id: string;
    pointerId: number;
    start: { x: number; y: number };
    startClient: { x: number; y: number };
    moved: boolean;
  } | null>(null);

  const onPointerDown = (t: TextOverlay) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect?.(t.id);
    dragRef.current = {
      id: t.id,
      pointerId: e.pointerId,
      start: { x: t.x, y: t.y },
      startClient: { x: e.clientX, y: e.clientY },
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!mediaRect.width || !mediaRect.height) return;
    const dx = (e.clientX - d.startClient.x) / mediaRect.width;
    const dy = (e.clientY - d.startClient.y) / mediaRect.height;
    if (Math.abs(dx) > 0.002 || Math.abs(dy) > 0.002) d.moved = true;
    const nx = Math.max(0.02, Math.min(0.98, d.start.x + dx));
    const ny = Math.max(0.02, Math.min(0.98, d.start.y + dy));
    onTextsChange?.(texts.map((t) => (t.id === d.id ? { ...t, x: nx, y: ny } : t)));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  };

  if (vignette <= 0 && texts.length === 0) return null;

  return (
    <div ref={setWrapEl} className="absolute inset-0 pointer-events-none">
      {vignette > 0 && (
        <div
          className="absolute"
          style={{
            left: mediaRect.left,
            top: mediaRect.top,
            width: mediaRect.width,
            height: mediaRect.height,
            background: `radial-gradient(circle, rgba(0,0,0,0) 55%, rgba(0,0,0,${(0.72 * vignette) / 100}) 100%)`,
          }}
        />
      )}
      {texts.map((t) => {
        const fz = Math.max(6, t.size * mediaRect.width);
        const fontStack = TEXT_FONTS.find((f) => f.id === t.font)?.stack ?? TEXT_FONTS[0].stack;
        const isSelected = interactive && selectedId === t.id;
        return (
          <div
            key={t.id}
            onPointerDown={onPointerDown(t)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className={cn(
              'absolute max-w-none',
              interactive && 'cursor-move touch-none pointer-events-auto',
            )}
            style={{
              left: mediaRect.left + t.x * mediaRect.width,
              top: mediaRect.top + t.y * mediaRect.height,
              transform: 'translate(-50%, -50%)',
              fontFamily: fontStack,
              fontSize: fz,
              lineHeight: TEXT_LINE_HEIGHT,
              fontWeight: t.weight === 'bold' ? 700 : 400,
              fontStyle: t.italic ? 'italic' : 'normal',
              textAlign: t.align,
              color: t.color,
              whiteSpace: 'pre',
              background: t.bg ?? 'transparent',
              padding: t.bg ? `${fz * TEXT_PAD_Y}px ${fz * TEXT_PAD_X}px` : 0,
              borderRadius: t.bg ? fz * TEXT_BG_RADIUS : 0,
              outline: isSelected ? '1.5px dashed rgba(255,255,255,0.9)' : 'none',
              outlineOffset: 3,
              filter: isSelected ? 'drop-shadow(0 0 6px rgba(0,0,0,0.35))' : 'none',
            }}
          >
            {t.text || ' '}
          </div>
        );
      })}
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
      <Slider
        icon={<Thermometer size={14} />}
        label="Warmth"
        value={edits.warmth ?? 100}
        onChange={(v) => setEdits({ warmth: v })}
      />
      <Slider
        icon={<Aperture size={14} />}
        label="Vignette"
        value={edits.vignette ?? 0}
        min={0}
        max={100}
        format={(v) => String(v)}
        onChange={(v) => setEdits({ vignette: v })}
      />
      <button
        type="button"
        onClick={() => setEdits({ brightness: 100, contrast: 100, saturation: 100, warmth: 100, vignette: 0 })}
        className="inline-flex items-center gap-1 text-[12px] font-semibold text-on-surface/55 hover:text-on-surface"
      >
        <Wand2 size={12} /> Reset adjustments
      </button>
    </div>
  );
};

/* ── Text tab ────────────────────────────────────────────────────────── */

const newTextOverlay = (): TextOverlay => ({
  id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `t-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  text: 'Your text',
  x: 0.5,
  y: 0.5,
  size: 0.07,
  color: '#ffffff',
  bg: null,
  font: 'serif',
  weight: 'bold',
  italic: false,
  align: 'center',
});

/** Sensible default background for the chosen text color — dark ink
 *  behind light text, white behind everything else. */
const defaultBgFor = (color: string): string =>
  color === '#ffffff' || color === '#fbf4f0' ? '#1d1a16' : '#ffffff';

const SwatchRow: React.FC<{
  value: string | null;
  onPick: (color: string) => void;
}> = ({ value, onPick }) => (
  <div className="flex gap-1.5 flex-wrap">
    {TEXT_COLORS.map((c) => (
      <button
        key={c}
        type="button"
        onClick={() => onPick(c)}
        className={cn(
          'w-7 h-7 rounded-full border transition-transform',
          value === c ? 'scale-110 border-primary ring-2 ring-primary/30' : 'border-on-surface/15 hover:scale-105',
        )}
        style={{ background: c }}
        aria-label={`Color ${c}`}
      />
    ))}
  </div>
);

const TextTab: React.FC<{
  edits: EditState;
  setEdits: (n: Partial<EditState>) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}> = ({ edits, setEdits, selectedId, onSelect }) => {
  const texts = edits.texts ?? [];
  const selected = texts.find((t) => t.id === selectedId) ?? texts[texts.length - 1] ?? null;

  const addText = () => {
    const nt = newTextOverlay();
    setEdits({ texts: [...texts, nt] });
    onSelect(nt.id);
  };
  const patch = (p: Partial<TextOverlay>) => {
    if (!selected) return;
    setEdits({ texts: texts.map((t) => (t.id === selected.id ? { ...t, ...p } : t)) });
  };
  const removeSelected = () => {
    if (!selected) return;
    setEdits({ texts: texts.filter((t) => t.id !== selected.id) });
    onSelect(null);
  };

  if (texts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2.5 py-4 text-center">
        <p className="text-[12.5px] text-on-surface/55 leading-relaxed max-w-[280px]">
          Add a caption, a title, or a label right on the photo. Drag it anywhere once it&apos;s placed.
        </p>
        <button
          type="button"
          onClick={addText}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-primary text-white text-[12.5px] font-bold hover:opacity-90 transition-opacity"
        >
          <Plus size={14} strokeWidth={2.6} /> Add text
        </button>
      </div>
    );
  }

  const alignIcons = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const;
  const AlignIcon = selected ? alignIcons[selected.align] : AlignCenter;
  const cycleAlign = () => {
    if (!selected) return;
    const order: TextOverlay['align'][] = ['left', 'center', 'right'];
    patch({ align: order[(order.indexOf(selected.align) + 1) % order.length] });
  };

  return (
    <div className="space-y-3.5">
      {/* Overlay switcher + add. */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {texts.map((t, i) => {
          const label = t.text.trim().replace(/\s+/g, ' ').slice(0, 14) || `Text ${i + 1}`;
          const isSel = selected?.id === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              className={cn(
                'px-3 h-8 rounded-full text-[12px] font-bold transition-colors max-w-[140px] truncate',
                isSel ? 'bg-primary text-white' : 'bg-on-surface/[0.05] text-on-surface/65 hover:bg-on-surface/10',
              )}
            >
              {label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={addText}
          className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-on-surface/[0.05] text-on-surface/65 hover:bg-on-surface/10 transition-colors"
          aria-label="Add another text box"
        >
          <Plus size={14} strokeWidth={2.6} />
        </button>
      </div>

      {selected && (
        <>
          {/* Content */}
          <textarea
            value={selected.text}
            onChange={(e) => patch({ text: e.target.value })}
            rows={2}
            placeholder="Type something…"
            className="w-full rounded-xl border border-on-surface/10 bg-on-surface/[0.03] px-3 py-2.5 text-[14px] text-on-surface placeholder:text-on-surface/35 focus:outline-none focus:border-primary/50 resize-none"
          />

          {/* Font + style row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {TEXT_FONTS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => patch({ font: f.id })}
                className={cn(
                  'px-3 h-8 rounded-full text-[12.5px] transition-colors',
                  selected.font === f.id ? 'bg-primary text-white' : 'bg-on-surface/[0.05] text-on-surface/65 hover:bg-on-surface/10',
                )}
                style={{ fontFamily: f.stack }}
              >
                {f.label}
              </button>
            ))}
            <span className="w-px h-5 bg-on-surface/10 mx-0.5" />
            <button
              type="button"
              onClick={() => patch({ weight: selected.weight === 'bold' ? 'normal' : 'bold' })}
              className={cn(
                'inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors',
                selected.weight === 'bold' ? 'bg-primary text-white' : 'bg-on-surface/[0.05] text-on-surface/65 hover:bg-on-surface/10',
              )}
              aria-label="Bold"
            >
              <Bold size={14} />
            </button>
            <button
              type="button"
              onClick={() => patch({ italic: !selected.italic })}
              className={cn(
                'inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors',
                selected.italic ? 'bg-primary text-white' : 'bg-on-surface/[0.05] text-on-surface/65 hover:bg-on-surface/10',
              )}
              aria-label="Italic"
            >
              <Italic size={14} />
            </button>
            <button
              type="button"
              onClick={cycleAlign}
              className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-on-surface/[0.05] text-on-surface/65 hover:bg-on-surface/10 transition-colors"
              aria-label={`Text alignment: ${selected.align}`}
            >
              <AlignIcon size={14} />
            </button>
          </div>

          {/* Size */}
          <Slider
            icon={<Type size={14} />}
            label="Size"
            value={Math.round(selected.size * 100)}
            min={3}
            max={16}
            format={(v) => String(v)}
            onChange={(v) => patch({ size: v / 100 })}
          />

          {/* Text color */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1.5">Text color</p>
            <SwatchRow value={selected.color} onPick={(c) => patch({ color: c })} />
          </div>

          {/* Background */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1.5">Background</p>
            <div className="flex items-center gap-1.5 mb-2">
              <button
                type="button"
                onClick={() => patch({ bg: null })}
                className={cn(
                  'px-3 h-8 rounded-full text-[12px] font-bold transition-colors',
                  selected.bg === null ? 'bg-primary text-white' : 'bg-on-surface/[0.05] text-on-surface/65 hover:bg-on-surface/10',
                )}
              >
                None
              </button>
              <button
                type="button"
                onClick={() => patch({ bg: selected.bg ?? defaultBgFor(selected.color) })}
                className={cn(
                  'px-3 h-8 rounded-full text-[12px] font-bold transition-colors',
                  selected.bg !== null ? 'bg-primary text-white' : 'bg-on-surface/[0.05] text-on-surface/65 hover:bg-on-surface/10',
                )}
              >
                Solid
              </button>
            </div>
            {selected.bg !== null && (
              <SwatchRow value={selected.bg} onPick={(c) => patch({ bg: c })} />
            )}
          </div>

          <button
            type="button"
            onClick={removeSelected}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-700/80 hover:text-red-700"
          >
            <Trash2 size={12} /> Delete this text
          </button>
        </>
      )}
    </div>
  );
};

const FilterTab: React.FC<{
  edits: EditState;
  setEdits: (n: Partial<EditState>) => void;
  /** When set (photos), each preset swatch shows the actual photo with
   *  that preset applied instead of a generic gradient. */
  previewUrl?: string;
  /** 3-column grid layout (desktop side panel) instead of the strip. */
  grid?: boolean;
}> = ({ edits, setEdits, previewUrl, grid = false }) => {
  const swatchInner = (filter: string) => previewUrl ? (
    <img src={previewUrl} alt="" draggable={false} className="w-full h-full object-cover" style={{ filter }} />
  ) : (
    <div className="w-full h-full bg-gradient-to-br from-amber-200 to-rose-300" style={{ filter }} />
  );
  if (grid) {
    return (
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-2.5">Preset</p>
        <div className="grid grid-cols-3 gap-2.5">
          {FILTER_PRESETS.map((preset) => {
            const active = edits.filterPreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setEdits({ filterPreset: preset.id })}
                className="group"
              >
                <div className={cn(
                  'aspect-square rounded-xl overflow-hidden border-2 transition-colors',
                  active ? 'border-primary' : 'border-transparent group-hover:border-on-surface/15',
                )}>
                  {swatchInner(preset.filter)}
                </div>
                <span className={cn(
                  'block text-center text-[11px] mt-1.5 transition-colors',
                  active ? 'font-bold text-primary' : 'font-semibold text-on-surface/55 group-hover:text-on-surface/80',
                )}>
                  {preset.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }
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
              <div className={cn(
                'w-14 h-14 rounded-xl overflow-hidden border-2 transition-colors',
                active ? 'border-primary' : 'border-transparent',
              )}>
                {swatchInner(preset.filter)}
              </div>
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
// Bounded LRU — each entry is FRAME_COUNT jpeg data-URLs (~hundreds of KB
// per video), and an unbounded per-URL map kept every clip ever opened in
// the editor alive for the whole page session. Map iterates in insertion
// order, so re-inserting on hit makes the first key the least recent.
const FRAMES_CACHE_MAX = 12;
const framesCache = new Map<string, string[]>();
function framesCacheGet(src: string): string[] | undefined {
  const hit = framesCache.get(src);
  if (hit) {
    framesCache.delete(src);
    framesCache.set(src, hit);
  }
  return hit;
}
function framesCachePut(src: string, frames: string[]): void {
  framesCache.delete(src);
  framesCache.set(src, frames);
  while (framesCache.size > FRAMES_CACHE_MAX) {
    const oldest = framesCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    framesCache.delete(oldest);
  }
}
async function extractFrames(
  src: string,
  duration: number,
  onFrame: (i: number, dataUrl: string) => void,
): Promise<string[]> {
  const cached = framesCacheGet(src);
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
  framesCachePut(src, out);
  return out;
}

/** Preview URL for swatches/chips: photos use the source directly; videos
 *  use the first extracted filmstrip frame (shared cache with TrimTab). */
function useSwatchPreview(item: EditableItem | null | undefined): string | undefined {
  const isVideo = item?.mediaType === 'video';
  const previewUrl = item?.previewUrl;
  const durationSeconds = item?.durationSeconds;
  const [frame, setFrame] = useState<string | undefined>(() => (
    isVideo && previewUrl ? framesCacheGet(previewUrl)?.[0] : undefined
  ));
  useEffect(() => {
    if (!isVideo || !previewUrl) { setFrame(undefined); return; }
    const cached = framesCacheGet(previewUrl);
    if (cached?.[0]) { setFrame(cached[0]); return; }
    setFrame(undefined);
    let cancelled = false;
    extractFrames(previewUrl, Math.max(MIN_TRIM_SECONDS, durationSeconds ?? 0), (i, url) => {
      if (!cancelled && i === 0) setFrame(url);
    }).catch(() => { /* swatches fall back to the gradient */ });
    return () => { cancelled = true; };
  }, [isVideo, previewUrl, durationSeconds]);
  return isVideo ? frame : previewUrl;
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
    const cached = framesCacheGet(item.previewUrl);
    return cached ? cached.slice() : new Array(FRAME_COUNT).fill(null);
  });
  const [framesError, setFramesError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFramesError(false);
    const cached = framesCacheGet(item.previewUrl);
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
  min?: number;
  max?: number;
  /** Value display — defaults to a signed offset from the 100 neutral. */
  format?: (v: number) => string;
}> = ({ icon, label, value, onChange, min = 50, max = 150, format }) => (
  <div>
    <div className="flex items-center justify-between mb-1">
      <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-on-surface/75">
        <span className="text-on-surface/55">{icon}</span>
        {label}
      </span>
      <span className="text-[11.5px] tabular-nums text-on-surface/55">
        {format ? format(value) : `${value - 100 >= 0 ? '+' : ''}${value - 100}`}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={1}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full accent-primary"
    />
  </div>
);

/* ── Split-layout pieces ──────────────────────────────────────────────
 *
 * The desktop composer lays the editor out Instagram-style: the media
 * canvas on the left, the controls in a side panel on the right. These
 * two components expose the same behaviour as the stacked MediaEditor
 * (live filter, interactive crop, draggable text, trim-window playback)
 * but let the host own the layout, active item and tab state. */

/**
 * EditorStage — one item's live preview. Renders the media letterboxed
 * (object-contain) inside whatever box the host gives it, with the CSS
 * filter chain applied and the crop / vignette / text overlays anchored
 * to the media rect. Pass `tab` to enable the interactive overlays
 * (crop drag on 'crop', text drag/select on 'text'); pass null for a
 * static preview that still reflects every edit.
 */
export const EditorStage: React.FC<{
  item: EditableItem;
  tab?: Tab | null;
  selectedTextId?: string | null;
  onSelectText?: (id: string) => void;
  onEditsChange?: (edits: EditState) => void;
  /** Autoplay (muted) when the item is a video. */
  active?: boolean;
  /** Reports the media's natural pixel size once known — the host can
   *  hand it to EditorControls so aspect-chip crops centre correctly. */
  onNatural?: (size: { w: number; h: number }) => void;
  className?: string;
}> = ({ item, tab = null, selectedTextId = null, onSelectText, onEditsChange, active = true, onNatural, className }) => {
  const [natural, setNatural] = useState<{ w: number; h: number } | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // New media → forget the previous item's dimensions until load fires.
  useEffect(() => { setNatural(undefined); }, [item.key]);

  const handleNatural = (_key: string, w: number, h: number) => {
    setNatural((prev) => (prev?.w === w && prev?.h === h ? prev : { w, h }));
    onNatural?.({ w, h });
  };

  // Keep video playback inside the trim window — same behaviour as the
  // stacked editor's carousel.
  useEffect(() => {
    if (item.mediaType !== 'video') return;
    const video = videoRef.current;
    const trim = item.edits.trim;
    if (!video || !trim) return;
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
  }, [item.key, item.mediaType, item.edits.trim?.start, item.edits.trim?.end]);

  const filter = cssFilterFor(item.edits);

  return (
    <div className={cn('relative w-full h-full', className)}>
      {item.mediaType === 'photo' ? (
        <img
          src={item.previewUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 w-full h-full object-contain"
          style={{ filter }}
          onLoad={(e) => handleNatural(item.key, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
        />
      ) : (
        <VideoPreview
          itemKey={item.key}
          src={item.previewUrl}
          filter={filter}
          isActive={active}
          onRefChange={(el) => { videoRef.current = el; }}
          onNatural={handleNatural}
        />
      )}
      {tab === 'crop' && onEditsChange ? (
        <InteractiveCropOverlay
          crop={item.edits.crop}
          natural={natural}
          onChange={(nextCrop) => onEditsChange({ ...item.edits, crop: nextCrop, aspectRatio: 'free' })}
        />
      ) : (
        hasCustomCrop(item.edits) && <CropOverlay edits={item.edits} natural={natural} />
      )}
      <MediaOverlays
        edits={item.edits}
        natural={natural}
        interactive={tab === 'text' && !!onEditsChange}
        selectedId={selectedTextId}
        onSelect={onSelectText}
        onTextsChange={(texts) => onEditsChange?.({ ...item.edits, texts })}
      />
    </div>
  );
};

/**
 * EditorControls — the tab bar + active tab body for one item, sized
 * for a narrow side panel. The host owns `tab` (so EditorStage can make
 * the matching overlay interactive) and the text-overlay selection.
 */
export const EditorControls: React.FC<{
  item: EditableItem;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  onEditsChange: (edits: EditState) => void;
  selectedTextId: string | null;
  onSelectTextId: (id: string | null) => void;
  /** Media natural size, as reported by EditorStage.onNatural. */
  natural?: { w: number; h: number };
}> = ({ item, tab, onTabChange, onEditsChange, selectedTextId, onSelectTextId, natural }) => {
  const edits = item.edits;
  const setEdits = (next: Partial<EditState>) => onEditsChange({ ...edits, ...next });
  const swatchPreview = useSwatchPreview(item);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-1 rounded-full bg-on-surface/[0.05] p-1">
        {([
          { id: 'crop',   icon: Crop,     label: 'Crop',    show: true },
          { id: 'trim',   icon: Scissors, label: 'Trim',    show: item.mediaType === 'video' },
          { id: 'adjust', icon: Sun,      label: 'Adjust',  show: true },
          { id: 'filter', icon: Sparkles, label: 'Filters', show: true },
          { id: 'text',   icon: Type,     label: 'Text',    show: true },
        ] as const).filter((t) => t.show).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              className={cn(
                'flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-full text-[12px] font-bold transition-colors',
                tab === t.id ? 'bg-white shadow text-on-surface' : 'text-on-surface/55 hover:text-on-surface',
              )}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab + item.key}
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
            <FilterTab
              edits={edits}
              setEdits={setEdits}
              previewUrl={swatchPreview}
              grid
            />
          )}
          {tab === 'text' && (
            <TextTab
              edits={edits}
              setEdits={setEdits}
              selectedId={selectedTextId}
              onSelect={onSelectTextId}
            />
          )}
          {tab === 'trim' && item.mediaType === 'video' && (
            <TrimTab item={item} edits={edits} setEdits={setEdits} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

