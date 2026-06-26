/**
 * Self-healing poster backfill for videos uploaded before poster thumbnails
 * existed. Those videos have no stored `<path>.jpg`, so the feed falls back to
 * a gradient while they buffer. Here we grab each one's first frame from its
 * signed playback URL (CORS-enabled on Supabase Storage), upload it as the
 * poster, and hand back a local object URL so the current session can swap the
 * gradient for a real frame immediately. Next load, the stored poster is signed
 * normally and the reel/post is instant — like a freshly-uploaded one.
 *
 * Strictly best-effort and bandwidth-aware: low concurrency, capped per run,
 * each video tried at most once per session, and every failure is swallowed.
 */
import { uploadFileWithProgress } from './storage-upload';
import { captureVideoPoster, posterPathFor } from './video-poster';

export interface BackfillTarget {
  /** Opaque id echoed back to onPoster so the caller updates the right row. */
  id: string;
  bucket: string;
  videoPath: string;
  videoUrl: string;
}

// Videos attempted this session (keyed by bucket:path) — never retried within
// a session, so a repeated feed refresh can't re-run work or loop.
const attempted = new Set<string>();

/**
 * Generate + upload posters for the given videos that lack one. Calls
 * `onPoster(id, localUrl)` as each succeeds. Resolves when the run is done.
 */
export async function backfillPosters(
  targets: BackfillTarget[],
  onPoster: (id: string, localUrl: string) => void,
  opts: { concurrency?: number; max?: number } = {},
): Promise<void> {
  const { concurrency = 2, max = 30 } = opts;

  const queue: BackfillTarget[] = [];
  for (const t of targets) {
    if (!t.videoUrl || !t.videoPath) continue;
    const key = `${t.bucket}:${t.videoPath}`;
    if (attempted.has(key)) continue;
    attempted.add(key);
    queue.push(t);
    if (queue.length >= max) break; // progressive — the rest heal next session
  }
  if (queue.length === 0) return;

  let idx = 0;
  const worker = async () => {
    while (idx < queue.length) {
      const t = queue[idx++];
      try {
        const blob = await captureVideoPoster(t.videoUrl);
        if (!blob) continue;
        await uploadFileWithProgress({
          bucket: t.bucket,
          path: posterPathFor(t.videoPath),
          file: blob,
          contentType: 'image/jpeg',
          upsert: true,
          cacheControlSeconds: 60 * 60 * 24 * 7, // 1 week
        });
        try { onPoster(t.id, URL.createObjectURL(blob)); } catch { /* ignore */ }
      } catch { /* best-effort — leave the gradient fallback in place */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}
