import { useEffect, useRef, type RefObject } from 'react';

/** Both back buttons and route gestures consult the visible flow first. */
export function allowBackNavigation(): boolean {
  return window.dispatchEvent(new Event('app:before-back', { cancelable: true }));
}
/** An in-page step returns through its own close action before leaving the route.
 * Retained, hidden pages must never intercept a different page's navigation. */
export function useLocalBack(enabled: boolean, onBack: () => void, owner: RefObject<HTMLElement | null>) {
  const callback = useRef(onBack); callback.current = onBack;
  useEffect(() => {
    if (!enabled) return;
    const handle = (event: Event) => {
      if (event.defaultPrevented || !owner.current?.isConnected || owner.current.closest('[inert], [aria-hidden="true"]')) return;
      event.preventDefault(); callback.current();
    };
    window.addEventListener('app:before-back', handle);
    return () => window.removeEventListener('app:before-back', handle);
  }, [enabled, owner]);
}
