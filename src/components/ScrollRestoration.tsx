import { useEffect, useLayoutEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { getPrimaryScroller, setPageScroll, maxPageScroll } from '../lib/page-scroll';
import { isKeepAlivePath } from '../lib/keep-alive';

/**
 * Per-history-entry scroll restoration.
 *
 * Routes remount on navigation (the route motion.div is keyed by pathname), so
 * without this, going back lands you at the top of a freshly-mounted page. We
 * remember each entry's scroll offset (keyed by the history index) and restore
 * it on back/forward (POP); a fresh push starts at the top.
 *
 * The app is inconsistent about *what* scrolls (window vs. an inner container),
 * so we save via a capture-phase scroll listener (inner-container scroll events
 * don't bubble to window) and restore through getPrimaryScroller(). The retry
 * loop re-applies while an async page is still filling in.
 */

const positions = new Map<number, number>();
const histIdx = () => (typeof window.history.state?.idx === 'number' ? window.history.state.idx : 0);

/** Saved offset for an entry — also read by the swipe-back gesture. */
export function savedScrollFor(idx: number): number {
  return positions.get(idx) ?? 0;
}

export const ScrollRestoration: React.FC = () => {
  const location = useLocation();
  const navType = useNavigationType(); // 'POP' | 'PUSH' | 'REPLACE'

  useEffect(() => {
    if (!('scrollRestoration' in window.history)) return;
    const prev = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = prev; };
  }, []);

  // Remember the current entry's scroll. Capture phase catches inner-container
  // scroll (which doesn't bubble); we only track vertical scrollers. Saved
  // synchronously (a Map.set is trivial) so it's never lost to rAF throttling.
  useEffect(() => {
    const onScroll = (e: Event) => {
      const t = e.target as Document | HTMLElement;
      let y: number | null = null;
      if (t === document || t === document.documentElement || t === document.body) y = window.scrollY;
      else if (t instanceof HTMLElement && t.scrollHeight > t.clientHeight + 8) y = t.scrollTop;
      if (y == null) return;
      positions.set(histIdx(), y);
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
  }, []);

  useLayoutEffect(() => {
    // Keep-alive tabs keep their own scroll (they're not remounted) — never
    // touch them, or we'd reset a preserved position to 0.
    if (isKeepAlivePath(location.pathname)) return;
    // New page (push) → window stays put only matters for window-scroll pages;
    // inner scrollers mount at the top on their own.
    if (navType !== 'POP') { window.scrollTo(0, 0); return; }
    const target = positions.get(histIdx()) ?? 0;
    if (target <= 0) { setPageScroll(0); return; }
    // The destination remounts and fills in progressively. Wait briefly for it
    // to be tall enough, then jump once. If it never gets there in time (a lazy
    // / virtualized feed scrolled deep), leave it at the top — never worse than
    // before, and no jarring auto-scroll. (A fully seamless back needs the page
    // to stay mounted; this is best-effort restoration.)
    let timer = 0, tries = 0;
    const apply = () => {
      if (maxPageScroll() >= target - 1) { setPageScroll(target); return; }
      if (tries++ < 12) timer = window.setTimeout(apply, 90);
    };
    apply();
    return () => { if (timer) window.clearTimeout(timer); };
    // location.key is unique per entry; navType distinguishes PUSH vs POP.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  return null;
};

export { getPrimaryScroller };
