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
    void resolvePhotoUrl(source).then(url => {
      if (!alive || generation !== mediaAccessVersion()) return;
      setResult({source, generation, url, attempt});
      if (url) timer = setTimeout(retry, (PHOTO_URL_TTL_SECONDS - 90) * 1000);
    });
    const reconnect = () => { retry(); };
    window.addEventListener('online', reconnect);
    return () => { alive = false; clearTimeout(timer); window.removeEventListener('online', reconnect); };
  }, [source, managed, generation, attempt, retry]);
  if (!managed) return {url:source || undefined, pending:false, managed:false, retry};
  const current = result?.source === source && result.generation === generation && result.attempt === attempt ? result : null;
  return {url: current?.url ?? cachedPhotoUrl(source!) ?? undefined, pending:!current && !cachedPhotoUrl(source!), managed:true, retry};
}
