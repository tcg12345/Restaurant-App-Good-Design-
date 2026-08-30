/**
 * Canonical photo pipeline for the rating / recipe / meal / guide modals.
 *
 * Replaces four+ copy-pasted `compressImage` helpers that each:
 *   - had NO reader.onerror / img.onerror, so an undecodable file (an iOS
 *     HEIC that slips past the `image/*` filter) never settled the promise
 *     and hung the whole upload loop, silently dropping every selected photo;
 *   - re-encoded to JPEG without filling the canvas, so a transparent PNG
 *     came out with a black background.
 *
 * `compressImage` fixes both (createImageBitmap first for HEIC tolerance, a
 * FileReader+<img> fallback WITH error handlers, and a white canvas fill),
 * and returns a data URL. `uploadPhoto` pushes bytes to the public `photos`
 * Storage bucket and returns the public URL, so rows store a short URL
 * instead of a multi-MB base64 blob. `processPhoto` composes the two with a
 * graceful fallback to the inline data URL when the user isn't signed in or
 * the upload fails — so photos always render, online or off.
 */
import { supabase, supabaseConfigured } from './supabase';
import { uploadFileWithProgress } from './storage-upload';

export interface CompressImageOptions {
  /** Longest output edge in px (default 800 — matches the legacy modals). */
  maxDim?: number;
  /** JPEG quality 0..1 (default 0.6). */
  quality?: number;
}

const PHOTOS_BUCKET = 'photos';
/** Skip (don't store) any single photo whose encoded payload exceeds this.
 *  A safety net only — real photos go to Storage and come back as short URLs. */
export const MAX_INLINE_PHOTO_BYTES = 100_000;

/** Decode a data: URL to a Blob without fetch() (works offline / in tests). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) throw new Error('not a data URL');
  const header = dataUrl.slice(0, comma);
  const isBase64 = /;base64/i.test(header);
  const mimeMatch = /^data:([^;,]+)/i.exec(header);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const body = dataUrl.slice(comma + 1);
  if (!isBase64) {
    return new Blob([decodeURIComponent(body)], { type: mime });
  }
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Draw a decoded source onto a JPEG data URL at the requested size, over a
 *  WHITE background (JPEG has no alpha — without this, transparent PNG pixels
 *  encode as black). */
function encodeToJpegDataUrl(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxDim: number,
  quality: number,
): string {
  let w = srcW;
  let h = srcH;
  if (w > maxDim || h > maxDim) {
    const r = Math.min(maxDim / w, maxDim / h);
    w = Math.round(w * r);
    h = Math.round(h * r);
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

/** FileReader + <img> path, WITH error handlers so an undecodable file
 *  rejects instead of hanging forever. */
function compressViaImgElement(file: File, maxDim: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('file read failed'));
    reader.onload = () => {
      const img = document.createElement('img');
      img.onerror = () => reject(new Error('image decode failed'));
      img.onload = () => {
        try {
          resolve(encodeToJpegDataUrl(img, img.naturalWidth || img.width, img.naturalHeight || img.height, maxDim, quality));
        } catch (err) {
          reject(err instanceof Error ? err : new Error('encode failed'));
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Compress + re-encode an image file to a JPEG data URL. Rejects (never hangs)
 * on an undecodable file, so a caller's `try/catch { skip }` actually works.
 * Tries `createImageBitmap` first — it decodes HEIC on Safari and respects
 * EXIF orientation — then falls back to a FileReader+<img> decode.
 */
export async function compressImage(file: File, opts: CompressImageOptions = {}): Promise<string> {
  const { maxDim = 800, quality = 0.6 } = opts;
  if (typeof document === 'undefined') throw new Error('no DOM');

  // createImageBitmap decodes more formats than <img> (notably HEIC on
  // Safari) and honors EXIF orientation. Fall back to <img> if unavailable
  // or it can't decode this file.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      try {
        if (bitmap.width && bitmap.height) {
          return encodeToJpegDataUrl(bitmap, bitmap.width, bitmap.height, maxDim, quality);
        }
      } finally {
        bitmap.close?.();
      }
    } catch {
      /* fall through to the <img> path */
    }
  }
  return compressViaImgElement(file, maxDim, quality);
}

/**
 * Upload a photo (data URL or Blob) to the public `photos` bucket under the
 * signed-in user's folder and return its public URL. If the input is already
 * an http(s) URL it's returned unchanged (idempotent / backward compatible).
 * Throws when there's no session or the upload fails, so callers can fall
 * back to an inline data URL.
 */
export async function uploadPhoto(input: string | Blob): Promise<string> {
  if (typeof input === 'string' && /^https?:\/\//i.test(input)) return input; // already uploaded
  if (!supabaseConfigured) throw new Error('supabase not configured');

  const blob = typeof input === 'string' ? dataUrlToBlob(input) : input;

  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user?.id;
  if (!uid) throw new Error('not signed in');

  // App-generated path: <uid>/<time>-<rand>.jpg. RLS gates writes to the
  // caller's own folder (see migration 039).
  const rand = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  const path = `${uid}/${Date.now()}-${rand}.jpg`;
  await uploadFileWithProgress({
    bucket: PHOTOS_BUCKET,
    path,
    file: blob,
    contentType: 'image/jpeg',
    cacheControlSeconds: 60 * 60 * 24 * 365, // immutable object — cache a year
  });
  const { data } = supabase.storage.from(PHOTOS_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('no public URL');
  return data.publicUrl;
}

/**
 * Delete photo objects from Storage by their public URL.
 *
 * The upload side has existed since migration 039; this is its missing
 * counterpart. Without it a deleted rating left every one of its photos
 * sitting in the bucket forever — invisible to the app, still costing
 * storage, and still reachable by anyone who kept the URL.
 *
 * Only paths inside the caller's own `<uid>/` folder are attempted: that's
 * what the bucket's RLS allows, and a public URL is not proof of ownership
 * (a community photo from another user resolves to their folder). Anything
 * that isn't one of our own Storage URLs — a `data:` URL, a Google Places
 * photo, another user's object — is skipped rather than failed on.
 */
export async function deletePhotoObjects(urls: string[]): Promise<number> {
  if (!supabaseConfigured || urls.length === 0) return 0;
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user?.id;
  if (!uid) return 0;
  // Public URLs look like …/storage/v1/object/public/photos/<uid>/<file>.
  const marker = `/storage/v1/object/public/${PHOTOS_BUCKET}/`;
  const paths: string[] = [];
  for (const url of urls) {
    if (typeof url !== 'string') continue;
    const at = url.indexOf(marker);
    if (at === -1) continue;
    const path = decodeURIComponent(url.slice(at + marker.length).split('?')[0]);
    if (path.startsWith(`${uid}/`)) paths.push(path);
  }
  if (paths.length === 0) return 0;
  const { error } = await supabase.storage.from(PHOTOS_BUCKET).remove(paths);
  if (error) {
    console.warn('[Photos] Storage delete failed:', error.message);
    return 0;
  }
  return paths.length;
}

/** Decode an existing data/blob/URL string via <img> (with an error handler,
 *  so an undecodable source rejects instead of hanging), then re-encode it to
 *  a size-capped JPEG data URL over a white background. Used for
 *  already-in-memory images (e.g. an AI-generated hero photo). */
export function compressDataUrl(src: string, opts: CompressImageOptions = {}): Promise<string> {
  const { maxDim = 800, quality = 0.6 } = opts;
  return new Promise((resolve, reject) => {
    const img = document.createElement('img');
    img.onerror = () => reject(new Error('image decode failed'));
    img.onload = () => {
      try {
        resolve(encodeToJpegDataUrl(img, img.naturalWidth || img.width, img.naturalHeight || img.height, maxDim, quality));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('encode failed'));
      }
    };
    img.src = src;
  });
}

/** compressDataUrl + upload, with the same data-URL fallback as processPhoto. */
export async function processDataUrl(src: string, opts: CompressImageOptions = {}): Promise<string> {
  const dataUrl = await compressDataUrl(src, opts);
  try {
    return await uploadPhoto(dataUrl);
  } catch (err) {
    console.warn('[images] upload failed — keeping inline data URL:', err);
    return dataUrl;
  }
}

/**
 * Compress a selected file and upload it, returning a public Storage URL.
 * Falls back to the inline data URL when the user isn't signed in or the
 * upload fails (photo still renders; it just rides inline until a later
 * sync). Rejects only when the file itself can't be decoded — so the
 * caller's per-file `try/catch { skip }` drops exactly the bad files.
 */
export async function processPhoto(file: File, opts: CompressImageOptions = {}): Promise<string> {
  const dataUrl = await compressImage(file, opts); // throws on undecodable → caller skips
  try {
    return await uploadPhoto(dataUrl);
  } catch (err) {
    console.warn('[images] upload failed — keeping inline data URL:', err);
    return dataUrl;
  }
}
