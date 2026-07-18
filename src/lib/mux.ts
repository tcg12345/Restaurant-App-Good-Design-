/**
 * Mux client helpers.
 *
 * Reels upload straight from the browser to Mux: we ask the `mux-upload-init`
 * Edge Function for a one-time direct-upload URL (it holds the Mux API
 * credentials), PUT the raw file to it, and Mux transcodes to adaptive HLS
 * asynchronously. The `mux-webhook` function writes the resulting playback id
 * back onto the reel row; playback then uses Mux Player with that id.
 *
 * Visibility maps to the asset's playback policy: public reels/posts use
 * PUBLIC playback ids (plain URLs), followers-only ones use SIGNED ids whose
 * stream/thumbnail URLs only work with a short-lived token minted by the
 * `mux-playback-token` function (which enforces owner/follower access).
 *
 * Only non-secret values live here (playback ids, tokens scoped to the
 * signed-in viewer, stream/image hosts). The Mux API credentials + signing
 * key stay in Edge Function secrets and never reach this bundle.
 */
import { supabase } from './supabase';

const MUX_STREAM_HOST = 'https://stream.mux.com';
const MUX_IMAGE_HOST = 'https://image.mux.com';

/** HLS manifest URL for a playback id; pass the viewer's playback token for
 *  signed (followers-only) assets. */
export function muxPlaybackUrl(playbackId: string, token?: string): string {
  return `${MUX_STREAM_HOST}/${playbackId}.m3u8${token ? `?token=${token}` : ''}`;
}

/** A Mux-generated poster frame (WebP). Paints instantly as the <video> poster
 *  and as the still thumbnail in grids/share sheets. For signed assets pass
 *  the thumbnail token — it must be the ONLY query param (size/time options
 *  ride inside the token's claims instead). */
export function muxPosterUrl(playbackId: string, opts: { width?: number; time?: number; token?: string } = {}): string {
  const { width = 1080, time, token } = opts;
  if (token) return `${MUX_IMAGE_HOST}/${playbackId}/thumbnail.webp?token=${token}`;
  const params = new URLSearchParams({ width: String(width) });
  if (time != null) params.set('time', String(time));
  return `${MUX_IMAGE_HOST}/${playbackId}/thumbnail.webp?${params.toString()}`;
}

export type MuxPlaybackPolicy = 'public' | 'signed';

export interface MuxUploadTicket {
  uploadUrl: string;
  uploadId: string;
  /** Policy the asset was created with — recorded on the row so render time
   *  knows whether playback needs tokens. */
  playbackPolicy: MuxPlaybackPolicy;
}

/**
 * Ask the Edge Function for a fresh Mux direct-upload URL. `passthrough` is
 * echoed back on every Mux webhook for this asset, so we pass the reel's id to
 * tie the asset to its row race-free. `isPublic: false` requests the signed
 * playback policy (the server may fall back to public if signing keys aren't
 * provisioned — the returned playbackPolicy says what actually happened).
 */
export async function requestMuxUpload(opts: { passthrough: string; isPublic?: boolean }): Promise<MuxUploadTicket> {
  const { data, error } = await supabase.functions.invoke('mux-upload-init', {
    body: {
      passthrough: opts.passthrough,
      corsOrigin: typeof window !== 'undefined' ? window.location.origin : '*',
      isPublic: opts.isPublic !== false,
    },
  });
  if (error) throw new Error(error.message || 'Could not start the upload.');
  if (!data?.uploadUrl || !data?.uploadId) throw new Error('Upload service returned no URL.');
  return {
    uploadUrl: data.uploadUrl as string,
    uploadId: data.uploadId as string,
    playbackPolicy: data.playbackPolicy === 'signed' ? 'signed' : 'public',
  };
}

/* ── Signed-playback tokens ─────────────────────────────────────────── */

export interface MuxPlaybackTokens {
  playback: string;
  thumbnail: string;
  storyboard: string;
  /** Unix seconds. The cache refreshes tokens well before this. */
  expiresAt: number;
}

// Session-scoped token cache, keyed by `${kind}:${rowId}`. Tokens are minted
// per-viewer with a multi-hour TTL, so a feed refresh doesn't re-hit the
// function for reels it already holds fresh tokens for.
const tokenCache = new Map<string, MuxPlaybackTokens>();
const TOKEN_REFRESH_MARGIN_S = 10 * 60;
const TOKEN_BATCH_MAX = 60; // mirror of the Edge Function's per-call cap

/**
 * Fetch playback tokens for the given signed reels / post video items,
 * returning a map keyed by row id. Rows the viewer isn't allowed to see (or
 * that failed) are simply absent — callers render those without media.
 */
export async function fetchMuxTokens(
  items: Array<{ kind: 'reel' | 'post_item'; id: string }>,
): Promise<Map<string, MuxPlaybackTokens>> {
  const out = new Map<string, MuxPlaybackTokens>();
  const now = Date.now() / 1000;
  const missing: Array<{ kind: 'reel' | 'post_item'; id: string }> = [];
  for (const it of items) {
    const hit = tokenCache.get(`${it.kind}:${it.id}`);
    if (hit && hit.expiresAt - TOKEN_REFRESH_MARGIN_S > now) out.set(it.id, hit);
    else missing.push(it);
  }

  for (let i = 0; i < missing.length; i += TOKEN_BATCH_MAX) {
    const batch = missing.slice(i, i + TOKEN_BATCH_MAX);
    try {
      const { data, error } = await supabase.functions.invoke('mux-playback-token', {
        body: { items: batch },
      });
      if (error || !data?.tokens) {
        if (error) console.warn('[Mux] token fetch failed:', error.message);
        continue;
      }
      for (const it of batch) {
        const t = (data.tokens as Record<string, MuxPlaybackTokens>)[it.id];
        if (t?.playback) {
          tokenCache.set(`${it.kind}:${it.id}`, t);
          out.set(it.id, t);
        }
      }
    } catch (err) {
      console.warn('[Mux] token fetch failed:', err);
    }
  }
  return out;
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
