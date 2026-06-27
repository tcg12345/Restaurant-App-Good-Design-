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

/** Mux storyboard VTT — maps each time range to a tile in a single sprite
 *  image. Used to render a smooth scrub-preview without a network request per
 *  frame (the sprite is loaded once, then we just offset to the right tile). */
export function muxStoryboardVttUrl(playbackId: string): string {
  return `${MUX_IMAGE_HOST}/${playbackId}/storyboard.vtt`;
}

export interface MuxStoryboardTile { time: number; x: number; y: number; w: number; h: number }
export interface MuxStoryboard { spriteUrl: string; tiles: MuxStoryboardTile[] }

function parseVttTimestamp(ts: string): number {
  // "HH:MM:SS.mmm" or "MM:SS.mmm" → seconds.
  const parts = ts.trim().split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Fetch + parse a Mux storyboard VTT into a sprite URL and its tiles. Returns
 *  null on any failure (caller falls back to no preview). */
export async function loadMuxStoryboard(vttUrl: string): Promise<MuxStoryboard | null> {
  try {
    const res = await fetch(vttUrl);
    if (!res.ok) return null;
    const lines = (await res.text()).split(/\r?\n/);
    const tiles: MuxStoryboardTile[] = [];
    let spriteUrl = '';
    for (let i = 0; i < lines.length; i++) {
      const arrow = lines[i].indexOf('-->');
      if (arrow === -1) continue;
      const start = parseVttTimestamp(lines[i].slice(0, arrow));
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const payload = (lines[j] || '').trim();
      const hash = payload.indexOf('#xywh=');
      if (hash === -1 || !Number.isFinite(start)) continue;
      if (!spriteUrl) spriteUrl = payload.slice(0, hash);
      const c = payload.slice(hash + 6).split(',').map(Number);
      if (c.length === 4 && !c.some((n) => Number.isNaN(n))) {
        tiles.push({ time: start, x: c[0], y: c[1], w: c[2], h: c[3] });
      }
    }
    if (!spriteUrl || tiles.length === 0) return null;
    return { spriteUrl, tiles };
  } catch {
    return null;
  }
}

/** The tile whose range covers time `t` (nearest preceding). Tiles are in
 *  ascending time order, so a binary search keeps per-move lookups cheap. */
export function storyboardTileAt(sb: MuxStoryboard, t: number): MuxStoryboardTile {
  const { tiles } = sb;
  let lo = 0, hi = tiles.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tiles[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return tiles[ans];
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
