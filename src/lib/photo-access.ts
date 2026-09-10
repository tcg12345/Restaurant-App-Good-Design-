import { supabase, supabaseConfigured, supabaseUrl } from './supabase';
import { mediaAccessVersion, onMediaAccessChange, resetMediaAccess } from './media-access-scope';

export const PHOTO_URL_TTL_SECONDS = 15 * 60;
const REFRESH_MARGIN_MS = 60_000;
export interface PhotoReference { bucket: 'photos' | 'avatars'; path: string; key: string }
/** Recognize only this project's photo objects, never arbitrary lookalike hosts.
 * Canonical public URLs are identifiers; even an old signed URL is reauthorized. */
export function photoReference(source?: string | null): PhotoReference | null {
  if (!source || !/^https?:\/\//i.test(source)) return null;
  try {
    if (/\/(?:\.|%2e){1,2}(?:\/|$)/i.test(source.split(/[?#]/)[0])) return null;
    const url = new URL(source);
    const match = /^\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/(photos|avatars)\/(.+)$/.exec(url.pathname);
    if (!match || url.origin !== new URL(supabaseUrl).origin || url.username || url.password) return null;
    const bucket = match[1] as PhotoReference['bucket'];
    const path = decodeURIComponent(match[2]);
    if (!path || /[\x00-\x1f\\]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) return null;
    return {bucket, path, key: `${bucket}:${path}`};
  } catch { return null; }
}
export function canonicalPhotoUrl(source: string): string {
  const ref = photoReference(source);
  return ref ? `${supabaseUrl}/storage/v1/object/public/${ref.bucket}/${ref.path.split('/').map(encodeURIComponent).join('/')}` : source;
}
interface Entry { url: string; expiresAt: number }
const cache = new Map<string, Entry>();
interface Job { started?: boolean; ref: PhotoReference; generation: number; resolve: (url: string | null) => void; promise: Promise<string | null> }
const jobs = new Map<string, Job>();
let scheduled = false;
let observing = false;
let viewer: string | null | undefined;
function observeSession() {
  if (observing || !supabaseConfigured) return;
  observing = true;
  supabase.auth.onAuthStateChange((_event, session) => {
    const next = session?.user?.id ?? null;
    if (viewer !== undefined && viewer !== next) resetMediaAccess();
    viewer = next;
  });
}
onMediaAccessChange(() => {
  cache.clear();
  for (const job of jobs.values()) job.resolve(null);
  jobs.clear();
});
export function cachedPhotoUrl(source: string): string | null {
  const ref = photoReference(source);
  if (!ref) return source;
  const value = cache.get(ref.key);
  return value && value.expiresAt - Date.now() > REFRESH_MARGIN_MS ? value.url : null;
}
export function invalidatePhotoUrl(source: string): void {
  const ref = photoReference(source);
  if (ref) cache.delete(ref.key);
}
async function flush() {
  scheduled = false;
  const batch = [...jobs.values()].filter(job => !job.started);
  batch.forEach(job => { job.started = true; });
  for (const bucket of ['photos', 'avatars'] as const) {
    const group = batch.filter(job => job.ref.bucket === bucket);
    for (let i = 0; i < group.length; i += 100) {
      const chunk = group.slice(i, i + 100);
      try {
        if (chunk[0].generation !== mediaAccessVersion()) continue;
        const signing = supabase.storage.from(bucket)
          .createSignedUrls(chunk.map(job => job.ref.path), PHOTO_URL_TTL_SECONDS);
        let timeout: ReturnType<typeof setTimeout>;
        const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Photo signing timed out')), 12_000); });
        const { data, error } = await Promise.race([signing, deadline]).finally(() => clearTimeout(timeout!));
        for (const job of chunk) {
          if (job.generation !== mediaAccessVersion()) { job.resolve(null); continue; }
          const item = !error && data?.find(item => item.path === job.ref.path);
          const url = item && !item.error && item.signedUrl ? item.signedUrl : null;
          if (url) {
            cache.set(job.ref.key, {url, expiresAt: Date.now() + PHOTO_URL_TTL_SECONDS * 1000});
            while (cache.size > 512) cache.delete(cache.keys().next().value!);
          }
          job.resolve(url);
        }
      } catch { for (const job of chunk) job.resolve(null); }
      finally { for (const job of chunk) if (jobs.get(job.ref.key) === job) jobs.delete(job.ref.key); }
    }
  }
}
/** Never falls back to a public URL when authorization/network signing fails. */
export function resolvePhotoUrl(source: string): Promise<string | null> {
  const ref = photoReference(source);
  if (!ref) return Promise.resolve(source);
  if (!supabaseConfigured) return Promise.resolve(null);
  observeSession();
  const cached = cachedPhotoUrl(source);
  if (cached) return Promise.resolve(cached);
  const existing = jobs.get(ref.key);
  if (existing) return existing.promise;
  let resolve!: Job['resolve'];
  const promise = new Promise<string | null>(done => { resolve = done; });
  jobs.set(ref.key, {ref, generation: mediaAccessVersion(), resolve, promise});
  if (!scheduled) { scheduled = true; queueMicrotask(() => { void flush(); }); }
  return promise;
}
/** Fetch/export paths use the same authorization boundary as displayed images. */
export async function fetchPhoto(source: string, init?: RequestInit): Promise<Response> {
  const version = mediaAccessVersion();
  const url = await resolvePhotoUrl(source);
  if (!url || version !== mediaAccessVersion()) throw new Error('Photo is unavailable.');
  const response = await fetch(url, {...init, credentials:'omit'});
  if (version !== mediaAccessVersion()) { await response.body?.cancel(); throw new Error('Photo session changed.'); }
  return response;
}
