/**
 * Mux client helpers.
 *
 * Reels upload straight from the browser to Mux: we ask the `mux-upload-init`
 * Edge Function for a one-time direct-upload URL (it holds the Mux API
 * credentials), PUT the raw file to it, and Mux transcodes to adaptive HLS
 * asynchronously. The `mux-webhook` function writes the resulting playback id
 * back onto the reel row; playback then uses Mux Player with that public id.
 *
 * Only public, non-secret values live here (playback ids, stream/image hosts).
 * The Mux token id/secret + webhook signing secret stay in Edge Function
 * secrets and never reach this bundle.
 */
import { supabase } from './supabase';

const MUX_STREAM_HOST = 'https://stream.mux.com';
const MUX_IMAGE_HOST = 'https://image.mux.com';

/** HLS manifest URL for a public playback id (used by Mux Player). */
export function muxPlaybackUrl(playbackId: string): string {
  return `${MUX_STREAM_HOST}/${playbackId}.m3u8`;
}

/** A Mux-generated poster frame (WebP). Paints instantly as the <video> poster
 *  and as the still thumbnail in grids/share sheets. */
export function muxPosterUrl(playbackId: string, opts: { width?: number; time?: number } = {}): string {
  const { width = 1080, time } = opts;
  const params = new URLSearchParams({ width: String(width) });
  if (time != null) params.set('time', String(time));
  return `${MUX_IMAGE_HOST}/${playbackId}/thumbnail.webp?${params.toString()}`;
}

export interface MuxUploadTicket {
  uploadUrl: string;
  uploadId: string;
}

/**
 * Ask the Edge Function for a fresh Mux direct-upload URL. `passthrough` is
 * echoed back on every Mux webhook for this asset, so we pass the reel's id to
 * tie the asset to its row race-free.
 */
export async function requestMuxUpload(opts: { passthrough: string }): Promise<MuxUploadTicket> {
  const { data, error } = await supabase.functions.invoke('mux-upload-init', {
    body: {
      passthrough: opts.passthrough,
      corsOrigin: typeof window !== 'undefined' ? window.location.origin : '*',
    },
  });
  if (error) throw new Error(error.message || 'Could not start the upload.');
  if (!data?.uploadUrl || !data?.uploadId) throw new Error('Upload service returned no URL.');
  return { uploadUrl: data.uploadUrl as string, uploadId: data.uploadId as string };
}

/**
 * PUT the file straight to Mux's direct-upload URL with real byte-level
 * progress. Resolves once Mux has the bytes (transcoding then happens async).
 */
export async function uploadToMux(
  uploadUrl: string,
  file: File | Blob,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  const { onProgress, signal } = opts;
  if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);

    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort);
    const cleanup = () => signal?.removeEventListener('abort', onAbort);

    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable && e.total > 0) {
        onProgress(Math.min(1, e.loaded / e.total));
      }
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => { cleanup(); reject(new Error('Network error during upload')); };
    xhr.onabort = () => { cleanup(); reject(new DOMException('Upload aborted', 'AbortError')); };

    xhr.send(file);
  });
}
