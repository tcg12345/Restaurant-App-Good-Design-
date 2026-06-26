/**
 * Client-side media compression for uploads.
 *
 * Phone cameras produce huge files — multi-MB photos (3–4000px) and
 * high-bitrate 1080p video. Shrinking them before upload means smaller stored
 * files, which upload faster, start playing faster in the feed, and decode
 * without the "loads a third at a time" banding on photos.
 *
 * Everything here is best-effort: any failure (or a file that's already small
 * enough) returns the ORIGINAL file unchanged, so compression can never block
 * or break an upload.
 */

/* ── Photos ─────────────────────────────────────────────────────────── */

export interface CompressImageOptions {
  /** Longest edge of the output in px. */
  maxDim?: number;
  /** JPEG quality 0..1. */
  quality?: number;
}

/** Resize + re-encode a photo to a sane size/quality. Returns the original on
 *  any failure or when it wouldn't actually get smaller. */
export async function compressImage(file: File, opts: CompressImageOptions = {}): Promise<File> {
  const { maxDim = 1920, quality = 0.82 } = opts;
  if (typeof document === 'undefined' || !file.type.startsWith('image/')) return file;
  if (file.type === 'image/gif') return file; // don't flatten animations
  try {
    // `from-image` respects EXIF orientation so portrait photos don't end up
    // rotated after we draw them to a canvas.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
    if (!bitmap) return file;
    const { width: w, height: h } = bitmap;
    if (!w || !h) { bitmap.close?.(); return file; }
    // Already modest in both dimensions and bytes → leave it alone.
    if (Math.max(w, h) <= maxDim && file.size < 600 * 1024) { bitmap.close?.(); return file; }
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const nw = Math.max(1, Math.round(w * scale));
    const nh = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close?.(); return file; }
    ctx.drawImage(bitmap, 0, 0, nw, nh);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file; // no real gain — keep original
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

/* ── Videos ─────────────────────────────────────────────────────────── */

export interface CompressVideoOptions {
  /** Cap the longest edge to this many px (downscale only, never upscale). */
  maxDim?: number;
  /** Target video bitrate for the re-encode. */
  bitsPerSecond?: number;
  /** 0..1 progress over the (real-time) re-encode. */
  onProgress?: (fraction: number) => void;
}

interface VideoMeta { width: number; height: number; duration: number }

async function probeVideo(url: string): Promise<VideoMeta | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => resolve({
      width: v.videoWidth,
      height: v.videoHeight,
      duration: Number.isFinite(v.duration) ? v.duration : 0,
    });
    v.onerror = () => resolve(null);
    v.src = url;
  });
}

function pickVideoMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  // Prefer MP4/H.264 (Safari can record it — plays everywhere); fall back to
  // WebM on Chromium. If none are supported we can't re-encode → skip.
  const candidates = [
    'video/mp4;codecs=h264',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

/**
 * Downscale + re-encode a video at a lower bitrate. Real-time (it plays the
 * clip through a canvas), so it adds roughly the clip's duration to the upload.
 * Skips files that are already small/low-bitrate, already-re-encoded WebM (the
 * edit pipeline's output — avoids a wasteful double encode), or whenever the
 * browser can't record. Returns the original on any failure.
 */
export async function compressVideo(file: File, opts: CompressVideoOptions = {}): Promise<File> {
  const { maxDim = 1080, bitsPerSecond = 3_800_000, onProgress } = opts;
  if (typeof document === 'undefined' || !file.type.startsWith('video/')) return file;
  // The editor already re-encodes (and now downscales) to WebM — don't compress
  // that a second time.
  if (file.type.includes('webm')) return file;

  const url = URL.createObjectURL(file);
  try {
    const meta = await probeVideo(url);
    if (!meta || !meta.width || !meta.height || !meta.duration) return file;

    const longest = Math.max(meta.width, meta.height);
    const estBitrate = (file.size * 8) / meta.duration;
    // Already within target envelope → not worth a real-time re-encode.
    if (longest <= maxDim && estBitrate < bitsPerSecond * 1.25) return file;

    const mimeType = pickVideoMime();
    if (!mimeType) return file;

    const scale = Math.min(1, maxDim / longest);
    const w = Math.max(2, Math.round(meta.width * scale) & ~1);  // even dims for codecs
    const h = Math.max(2, Math.round(meta.height * scale) & ~1);

    const blob = await encodeDownscaled(url, w, h, mimeType, bitsPerSecond, meta.duration, onProgress);
    if (!blob || blob.size >= file.size) return file; // no gain — keep original
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const base = file.name.replace(/\.[^.]+$/, '') || 'video';
    return new File([blob], `${base}-opt.${ext}`, { type: mimeType.split(';')[0] });
  } catch {
    return file;
  } finally {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
}

/** Play the source through a canvas and capture it with MediaRecorder. */
async function encodeDownscaled(
  url: string,
  w: number,
  h: number,
  mimeType: string,
  bitsPerSecond: number,
  duration: number,
  onProgress?: (f: number) => void,
): Promise<Blob | null> {
  const v = document.createElement('video');
  v.src = url;
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  await new Promise<void>((resolve, reject) => {
    v.onloadeddata = () => resolve();
    v.onerror = () => reject(new Error('decode failed'));
  });

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const stream = (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream?.(30);
  if (!stream) return null;
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitsPerSecond });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  const total = duration || 1;
  let raf = 0;
  const draw = () => {
    if (v.ended || v.paused) return;
    ctx.drawImage(v, 0, 0, w, h);
    onProgress?.(Math.max(0, Math.min(1, v.currentTime / total)));
    raf = requestAnimationFrame(draw);
  };

  recorder.start();
  await v.play().catch(() => { /* may be blocked — handled by the end check */ });
  raf = requestAnimationFrame(draw);

  await new Promise<void>((resolve) => {
    v.onended = () => resolve();
    // Safety net in case 'ended' never fires (some codecs/streams).
    const guard = setTimeout(resolve, (total + 5) * 1000);
    v.addEventListener('ended', () => clearTimeout(guard), { once: true });
  });

  cancelAnimationFrame(raf);
  await new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
    if (recorder.state !== 'inactive') recorder.stop();
    else resolve();
  });
  stream.getTracks().forEach((t) => t.stop());
  onProgress?.(1);
  return new Blob(chunks, { type: mimeType });
}
