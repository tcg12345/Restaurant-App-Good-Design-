import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { cachedPhotoUrl, invalidatePhotoUrl, photoReference, PHOTO_URL_TTL_SECONDS, resolvePhotoUrl } from './photo-access';
import { mediaAccessVersion, onMediaAccessChange } from './media-access-scope';
const noSubscribe = () => () => {};
const noVersion = () => 0;
export function usePhotoUrl(source?: string | null) {
  const managed = !!photoReference(source);
  const generation = useSyncExternalStore(managed ? onMediaAccessChange : noSubscribe, managed ? mediaAccessVersion : noVersion, noVersion);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{source:string; generation:number; url:string|null; attempt:number} | null>(null);
  const retry = useCallback(() => {
    if (source) invalidatePhotoUrl(source);
    setAttempt(n => n + 1);
  }, [source]);
  useEffect(() => {
    if (!managed || !source) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const resolve = async () => {
      const url = await resolvePhotoUrl(source);
      if (!alive || generation !== mediaAccessVersion()) return;
      if (!url && failures < 2) {
        // Do not turn a temporary signing failure into an img error that
        // makes its parent permanently remove the photo. Stay a placeholder
        // during bounded retries; reconnect also restarts this effect.
        if (navigator.onLine !== false) timer = setTimeout(() => { void resolve(); }, ++failures * 750);
        return;
      }
      setResult({source, generation, url, attempt});
      if (url) timer = setTimeout(retry, (PHOTO_URL_TTL_SECONDS - 90) * 1000);
    };
    void resolve();
    const reconnect = () => { retry(); };
    window.addEventListener('online', reconnect);
    return () => { alive = false; clearTimeout(timer); window.removeEventListener('online', reconnect); };
  }, [source, managed, generation, attempt, retry]);
  if (!managed) return {url:source || undefined, pending:false, managed:false, retry};
  const current = result?.source === source && result.generation === generation && result.attempt === attempt ? result : null;
  return {url: current?.url ?? cachedPhotoUrl(source!) ?? undefined, pending:!current && !cachedPhotoUrl(source!), managed:true, retry};
}
