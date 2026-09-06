import { useEffect, useLayoutEffect, useRef, type FC } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { getPrimaryScroller, setPageScroll, maxPageScroll, isOffscreenScrollTarget } from '../lib/page-scroll';
import { isKeepAlivePath } from '../lib/keep-alive';
import { isOverlayOpen } from '../lib/overlay-registry';

const positions = new Map<number, number>();
const windowPositions = new Map<number, number>();
const histIdx = () => typeof window.history.state?.idx === 'number' ? window.history.state.idx : 0;
export function savedScrollFor(idx: number): number { return positions.get(idx) ?? 0; }

/** Restore the presenting screen before revealing it. Ignore cloned pages,
 * closing routes and modal scrollers; none owns the active history entry. */
export const ScrollRestoration: FC = () => {
  const location = useLocation();
  const navType = useNavigationType();
  const restoring = useRef(false);
  const primary = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    const save = (event: Event) => {
      if (restoring.current || isOverlayOpen() || isOffscreenScrollTarget(event.target)) return;
      const target = event.target;
      const idx = histIdx();
      if (target === document || target === document.documentElement || target === document.body) {
        windowPositions.set(idx, window.scrollY);
        if (!primary.current) positions.set(idx, window.scrollY);
      } else if (target instanceof HTMLElement) {
        if (!primary.current?.isConnected) primary.current = getPrimaryScroller();
        if (target === primary.current) positions.set(idx, target.scrollTop);
      }
      for (const store of [positions, windowPositions]) if (store.size > 150) store.delete(store.keys().next().value!);
    };
    document.addEventListener('scroll', save, { capture: true, passive: true });
    return () => {
      window.history.scrollRestoration = previous;
      document.removeEventListener('scroll', save, true);
    };
  }, []);

  useLayoutEffect(() => {
    let timer = 0, frame = 0, stopped = false;
    restoring.current = true;
    primary.current = null;
    const finish = () => { stopped = true; clearTimeout(timer); cancelAnimationFrame(frame); restoring.current = false; };
    // Never pull the reader back after they have started interacting.
    for (const event of ['touchstart', 'pointerdown', 'wheel']) document.addEventListener(event, finish, { passive: true, capture: true });
    const release = () => { frame = requestAnimationFrame(() => { frame = requestAnimationFrame(finish); }); };
    const idx = histIdx();
    const target = positions.get(idx) ?? 0;
    if (isKeepAlivePath(location.pathname)) {
      if (navType === 'POP') window.scrollTo(0, windowPositions.get(idx) ?? 0);
      release();
    } else if (navType !== 'POP') {
      window.scrollTo(0, 0);
      positions.set(idx, 0); windowPositions.set(idx, 0);
      release();
    } else {
      let attempts = 0;
      const apply = () => {
        if (stopped) return;
        const wrapper = document.querySelector<HTMLElement>(`[data-route-entry="${CSS.escape(location.key)}"]`);
        if (wrapper) {
          const available = maxPageScroll(wrapper);
          setPageScroll(Math.min(target, available), wrapper);
          if (available >= target - 1) { release(); return; }
        }
        if (++attempts < 24) timer = window.setTimeout(apply, 80);
        else release();
      };
      apply();
    }
    return () => {
      finish();
      for (const event of ['touchstart', 'pointerdown', 'wheel']) document.removeEventListener(event, finish, true);
    };
  }, [location.key, location.pathname, navType]);
  return null;
};
export { getPrimaryScroller };
