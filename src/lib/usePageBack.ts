import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { backTargetFor } from './nav-stack';

/** Match the edge-swipe's stack semantics. Going to a fallback replaces
 * the current entry, so a Back button never adds a return loop. */
export function usePageBack(fallback: string) {
  const location = useLocation();
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = typeof window.history.state?.idx === 'number' ? window.history.state.idx : 0;
    const perform = () => {
      const target = backTargetFor(idx, location.pathname, location.search, fallback);
      if (target?.kind === 'pop') navigate(-1);
      else navigate(target?.to || fallback, { replace: true, state: { navigationDirection: 'back' } });
    };
    const request = new CustomEvent('app:request-back', { cancelable: true, detail: { perform } });
    window.dispatchEvent(request);
    if (!request.defaultPrevented) perform();
  }, [navigate, location.pathname, location.search, fallback]);
}
