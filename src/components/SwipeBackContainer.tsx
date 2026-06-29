import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * iOS / Instagram-style edge swipe-back for the phone layout.
 *
 * A drag that starts within `EDGE` px of the left edge follows the finger,
 * sliding the current page to the right. Past the commit threshold (or a quick
 * flick) it finishes the slide and calls `onBack()`; otherwise it springs back.
 *
 * The page lives inside the app's `AnimatePresence` route transition, so to
 * avoid the two animation systems fighting we briefly lock route transitions
 * to instant (`onLockTransition(true)`) around the `onBack()` call and drive
 * the whole motion ourselves: current slides off right, the destination slides
 * in from the left.
 *
 * The gesture only arms from the very left edge, so it never steals horizontal
 * swipes from carousels / scroll-rails elsewhere on the page, and vertical
 * drags fall straight through to normal page scroll.
 */
const EDGE = 28;
const COMMIT_RATIO = 0.32; // fraction of width that commits the back
const FLICK_VELOCITY = 0.4; // px/ms — a fast flick commits regardless of distance

interface Props {
  enabled: boolean;
  onBack: () => void;
  onLockTransition: (locked: boolean) => void;
  children: ReactNode;
}

export const SwipeBackContainer: React.FC<Props> = ({ enabled, onBack, onLockTransition, children }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragX, setDragX] = useState(0);
  const [animating, setAnimating] = useState(false);

  const dragXRef = useRef(0);
  const setDrag = (x: number) => { dragXRef.current = x; setDragX(x); };

  // Long-lived touch handlers read the latest props/state through refs.
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const onBackRef = useRef(onBack); onBackRef.current = onBack;
  const onLockRef = useRef(onLockTransition); onLockRef.current = onLockTransition;
  const g = useRef({ active: false, decided: false, horizontal: false, sx: 0, sy: 0, lx: 0, lt: 0, vx: 0, busy: false });

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const width = () => el.clientWidth || window.innerWidth;

    const start = (e: TouchEvent) => {
      const s = g.current;
      if (s.busy || !enabledRef.current || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE) { s.active = false; return; }
      s.active = true; s.decided = false; s.horizontal = false;
      s.sx = t.clientX; s.sy = t.clientY; s.lx = t.clientX; s.lt = Date.now(); s.vx = 0;
    };
    const move = (e: TouchEvent) => {
      const s = g.current;
      if (!s.active || s.busy) return;
      const t = e.touches[0];
      const dx = t.clientX - s.sx;
      const dy = t.clientY - s.sy;
      if (!s.decided) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        s.decided = true;
        s.horizontal = dx > 0 && Math.abs(dx) > Math.abs(dy);
        if (!s.horizontal) { s.active = false; return; } // vertical → let the page scroll
      }
      e.preventDefault(); // own the horizontal gesture
      const now = Date.now();
      const dt = now - s.lt;
      if (dt > 0) s.vx = (t.clientX - s.lx) / dt;
      s.lx = t.clientX; s.lt = now;
      setDrag(Math.max(0, Math.min(width(), dx)));
    };
    const end = () => {
      const s = g.current;
      if (!s.active) return;
      s.active = false;
      if (!s.horizontal) return;
      const w = width();
      const commit = dragXRef.current > w * COMMIT_RATIO || s.vx > FLICK_VELOCITY;
      if (commit) {
        s.busy = true;
        setAnimating(true);
        setDrag(w); // 1) current page slides off to the right
        window.setTimeout(() => {
          onLockRef.current(true); // 2) swap the route with no transition…
          onBackRef.current();
          setAnimating(false);
          setDrag(-Math.round(w * 0.22)); // …and park the destination just off-screen left
          requestAnimationFrame(() => {
            setAnimating(true);
            setDrag(0); // 3) destination slides in from the left
            window.setTimeout(() => {
              setAnimating(false);
              onLockRef.current(false);
              s.busy = false;
            }, 230);
          });
        }, 210);
      } else if (dragXRef.current > 0) {
        setAnimating(true);
        setDrag(0); // spring back
        window.setTimeout(() => setAnimating(false), 230);
      }
    };

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', end, { passive: true });
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, []);

  // A `translateX(0px)` would still create a containing block and break any
  // `position: fixed` descendants, so fall back to `none` whenever idle.
  const idle = dragX === 0 && !animating;
  return (
    <div ref={rootRef} className="relative" style={{ minHeight: '100dvh' }}>
      <div
        style={{
          transform: idle ? 'none' : `translateX(${dragX}px)`,
          transition: animating ? 'transform 0.23s cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
          boxShadow: dragX > 0 ? '-14px 0 34px rgba(0,0,0,0.28)' : 'none',
          background: 'var(--color-surface)',
          minHeight: '100dvh',
          willChange: idle ? 'auto' : 'transform',
        }}
      >
        {children}
      </div>
    </div>
  );
};
