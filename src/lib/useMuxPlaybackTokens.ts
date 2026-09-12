import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { fetchMuxTokens, type MuxPlaybackTokens } from './mux';
import { mediaAccessVersion, onMediaAccessChange } from './media-access-scope';

/** Keep a nearby signed player authorized during long sessions and resumes. */
export function useMuxPlaybackTokens(kind: 'reel' | 'post_item', id: string | undefined, enabled: boolean) {
  const version = useSyncExternalStore(onMediaAccessChange, mediaAccessVersion, mediaAccessVersion);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ id?: string; version: number; tokens?: MuxPlaybackTokens; failed: boolean }>({ version, failed: false });
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!enabled || !id) return;
    let cancelled = false;
    let busy = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (busy || cancelled) return;
      busy = true;
      clearTimeout(timer);
      try {
        const next = (await fetchMuxTokens([{ kind, id }])).get(id);
        if (cancelled || version !== mediaAccessVersion()) return;
        const valid = next && next.expiresAt > Date.now() / 1000 + 5 ? next : undefined;
        setState({ id, version, tokens: valid, failed: !valid });
        // Match the shared cache's two-minute refresh margin.
        timer = setTimeout(refresh, valid ? Math.max(1000, (valid.expiresAt - Date.now() / 1000 - 120) * 1000) : 30000);
      } catch {
        if (!cancelled && version === mediaAccessVersion()) {
          setState({ id, version, failed: true });
          timer = setTimeout(refresh, 30000);
        }
      } finally { busy = false; }
    };
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    void refresh();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    return () => { cancelled = true; clearTimeout(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('focus', resume); };
  }, [kind, id, enabled, version, attempt]);
  const current = enabled && state.id === id && state.version === version ? state : undefined;
  return { tokens: current?.tokens, failed: current?.failed ?? false, retry };
}
