/**
 * Client-side video poster capture.
 *
 * Reels/post videos live in private buckets and have no stored thumbnail, so a
 * never-before-seen video shows only the gradient placeholder until it buffers
 * enough to paint a frame. To make cold first-views feel instant (Instagram
 * shows a frame immediately), we grab the video's first frame at upload time,
 * downscale it to a small JPEG, and store it alongside the video. The feed then
 * renders it as the <video poster>, which paints the instant the element mounts.
 *
 * This is strictly best-effort: every failure path resolves to `null` so a
 * missing/failed poster can never block or break an upload — the caller simply
 * skips the poster and falls back to today's behaviour.
 */

export interface CapturePosterOptions {
  /** Longest edge of the output, in px. Small — it's just a placeholder. */
  maxWidth?: number;
  /** JPEG quality 0..1. */
  quality?: number;
  /** Seconds into the clip to grab (a hair past 0 dodges black lead-in frames). */
  seekTo?: number;
  /** Hard cap so a pathological file can't hang the upload flow. */
  timeoutMs?: number;
}

/**
 * Capture a downscaled JPEG poster from a video. The source can be a local
 * File/Blob (upload time) or a remote URL string (backfilling an already-stored
 * video — requires the host to allow CORS, which Supabase Storage does).
 * Resolves to the Blob on success, or `null` on any failure/timeout. Never
 * throws.
 */
export async function captureVideoPoster(
  source: File | Blob | string,
  opts: CapturePosterOptions = {},
): Promise<Blob | null> {
  const { maxWidth = 720, quality = 0.7, seekTo = 0.1, timeoutMs = 8000 } = opts;
  if (typeof document === 'undefined') return null;

  const isUrl = typeof source === 'string';

  return new Promise<Blob | null>((resolve) => {
    let settled = false;
    const url = isUrl ? source : URL.createObjectURL(source);
    const v = document.createElement('video');

    const cleanup = () => {
      if (!isUrl) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }
      v.removeAttribute('src');
      try { v.load(); } catch { /* ignore */ }
    };
    const done = (val: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(val);
    };
    const timer = setTimeout(() => done(null), timeoutMs);

    v.muted = true;
    v.playsInline = true;
    // Remote backfill: only pull metadata + the seeked range (range requests),
    // not the whole file. Local file: it's free, so grab it all.
    v.preload = isUrl ? 'metadata' : 'auto';
    v.crossOrigin = 'anonymous';

    v.onloadeddata = () => {
      try {
        const dur = Number.isFinite(v.duration) ? v.duration : 0;
        v.currentTime = dur > 0 ? Math.min(seekTo, dur / 2) : seekTo;
      } catch {
        done(null);
      }
    };
    v.onseeked = () => {
      try {
        const sw = v.videoWidth;
        const sh = v.videoHeight;
        if (!sw || !sh) return done(null);
        const scale = Math.min(1, maxWidth / sw);
        const w = Math.max(1, Math.round(sw * scale));
        const h = Math.max(1, Math.round(sh * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return done(null);
        ctx.drawImage(v, 0, 0, w, h);
        canvas.toBlob((blob) => done(blob), 'image/jpeg', quality);
      } catch {
        done(null);
      }
    };
    v.onerror = () => done(null);

    // For remote URLs, a #t= media fragment hints the browser to fetch the
    // frame's byte range up front. (No fragment for blob: URLs — not needed.)
    v.src = isUrl && !url.includes('#') ? `${url}#t=${seekTo}` : url;
  });
}

/** The storage path a video's poster lives at — derived, so no DB column. */
export function posterPathFor(mediaPath: string): string {
  return mediaPath ? `${mediaPath}.jpg` : '';
}
