/**
 * Direct-to-Storage uploader with real progress.
 *
 * The `@supabase/supabase-js` storage client uploads with `fetch`, which
 * gives no byte-level progress — so our composer modals could only fake a
 * progress bar with a couple of hardcoded ticks (it froze mid-upload, then
 * snapped to done). This helper POSTs the file straight to the Storage REST
 * endpoint with `XMLHttpRequest`, whose `upload.onprogress` events report the
 * exact bytes flushed to the wire. That makes the composer's progress bar both
 * smooth and accurate, especially for longer videos where the freeze was worst.
 *
 * It talks to the same endpoint, with the same auth, that supabase-js uses, so
 * Storage RLS (uploads gated to the caller's own folder) is unchanged. We send
 * the raw binary body (not multipart) to keep overhead minimal for big files.
 */
import { supabase, supabaseUrl, supabaseAnonKey } from './supabase';

export interface UploadProgress {
  /** Bytes flushed to the wire so far. */
  loaded: number;
  /** Total bytes to send (the file size). */
  total: number;
  /** loaded / total, clamped to 0..1. */
  fraction: number;
}

export interface UploadFileOptions {
  bucket: string;
  /** Object path within the bucket, e.g. `<userId>/<filename>`. */
  path: string;
  file: File | Blob;
  contentType?: string;
  upsert?: boolean;
  /** Browser/CDN cache lifetime in seconds (matches supabase-js default). */
  cacheControlSeconds?: number;
  onProgress?: (progress: UploadProgress) => void;
  /** Abort the in-flight upload (e.g. the user closed the modal). */
  signal?: AbortSignal;
}

function parseError(xhr: XMLHttpRequest): string {
  try {
    const body = JSON.parse(xhr.responseText) as { message?: string; error?: string };
    return body.message || body.error || `Upload failed (${xhr.status || 'network'})`;
  } catch {
    return xhr.responseText || `Upload failed (${xhr.status || 'network'})`;
  }
}

/**
 * Upload a single file to Supabase Storage, reporting real upload progress.
 * Resolves once the object is committed; rejects with a readable message on
 * any HTTP error, network failure, or abort.
 */
export async function uploadFileWithProgress(opts: UploadFileOptions): Promise<void> {
  const {
    bucket,
    path,
    file,
    contentType,
    upsert = false,
    cacheControlSeconds = 3600,
    onProgress,
    signal,
  } = opts;

  if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');

  // The caller's JWT is required — Storage RLS scopes writes to the user's
  // own folder. Anon is only a fallback so a missing session surfaces as a
  // clean 401 rather than a confusing network error.
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token || supabaseAnonKey;

  const size = (file as File).size || 0;
  // Path segments are app-generated (UUID folder + timestamp filename), but
  // encode defensively so any stray character can't break the URL.
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const endpoint = `${supabaseUrl}/storage/v1/object/${bucket}/${encodedPath}`;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint, true);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', supabaseAnonKey);
    xhr.setRequestHeader('x-upsert', upsert ? 'true' : 'false');
    xhr.setRequestHeader('cache-control', `max-age=${cacheControlSeconds}`);
    if (contentType) xhr.setRequestHeader('content-type', contentType);

    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort);
    const cleanup = () => signal?.removeEventListener('abort', onAbort);

    xhr.upload.onprogress = (e) => {
      if (!onProgress) return;
      const total = e.lengthComputable && e.total > 0 ? e.total : size;
      const fraction = total > 0 ? Math.min(1, e.loaded / total) : 0;
      onProgress({ loaded: e.loaded, total, fraction });
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        // Guarantee a terminal 100% tick even if the last progress event
        // landed a hair short of total.
        onProgress?.({ loaded: size, total: size, fraction: 1 });
        resolve();
      } else {
        reject(new Error(parseError(xhr)));
      }
    };
    xhr.onerror = () => { cleanup(); reject(new Error('Network error during upload')); };
    xhr.onabort = () => { cleanup(); reject(new DOMException('Upload aborted', 'AbortError')); };

    xhr.send(file);
  });
}
