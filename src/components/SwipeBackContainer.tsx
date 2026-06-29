import { useEffect, useRef, type ReactNode } from 'react';

/**
 * iOS / Instagram-style swipe-back for the phone layout.
 *
 * The drag is driven **off React's render path**: touch handlers write the
 * page's `transform` directly (coalesced in a rAF), so there is no per-frame
 * setState. On release the page settles with the Web Animations API (a single
 * GPU-composited animation, no setTimeout choreography).
 *
 * Activation has two zones:
 *   • an always-back left edge (<= EDGE px) that arms immediately, and
 *   • an intent zone everywhere else that only claims the gesture once the
 *     motion clearly reads as a rightward horizontal swipe.
 * Once claimed the axis is locked. Vertical drags and horizontally-scrollable
 * children (carousels, filter rows) keep their scroll — we defer to a
 * horizontal scroller that can still scroll right and only claim when back
 * intent is unambiguous.
 *
 * Commit is distance OR velocity (a quick flick commits on a short drag). The
 * page lives inside the route `AnimatePresence`; to avoid the two systems
 * fighting we lock route transitions to instant (`onLockTransition(true)`)
 * around the `onBack()` swap.
 *
 * This commit keeps the old app-surface reveal behind the page; the live
 * snapshot parallax is layered on in a following step.
 */

// Activation
const EDGE = 28;            // always-back left-edge zone (px)
const SLOP = 10;           // travel before we decide the axis (px)
const ANGLE_TAN = Math.tan((30 * Math.PI) / 180); // within ~30° of horizontal
// Commit
const COMMIT_RATIO = 0.4;  // fraction of width that commits the back
const FLICK_VELOCITY = 0.35; // px/ms — a fast flick commits regardless of distance
// Settle
const SETTLE_MS = 320;
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'; // iOS-like

interface Props {
  enabled: boolean;
  onBack: () => void;
  onLockTransition: (locked: boolean) => void;
  children: ReactNode;
}

function findHScrollable(start: EventTarget | null, root: Element): HTMLElement | null {
  let el = start as HTMLElement | null;
  while (el && el !== root && el.nodeType === 1) {
    if (el.scrollWidth > el.clientWidth + 2) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === 'auto' || ox === 'scroll') return el;
    }
    el = el.parentElement;
  }
  return null;
}

export const SwipeBackContainer: React.FC<Props> = ({ enabled, onBack, onLockTransition, children }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const onBackRef = useRef(onBack); onBackRef.current = onBack;
  const onLockRef = useRef(onLockTransition); onLockRef.current = onLockTransition;

  const g = useRef({
    tracking: false,   // a touch is down and a candidate gesture
    claimed: false,    // we own the gesture (driving the page)
    busy: false,       // settle/commit in flight — ignore new touches
    sx: 0, sy: 0, lx: 0, lt: 0, vx: 0,
    claimDx: 0,        // dx at the moment we claimed (removes the slop jump)
    w: 0,
    fromEdge: false,
    deferEl: null as HTMLElement | null,
    x: 0,              // current translate
    raf: 0,
  });

  useEffect(() => {
    const root = rootRef.current;
    const page = pageRef.current;
    if (!root || !page) return;
    const width = () => root.clientWidth || window.innerWidth;

    const flush = () => {
      g.current.raf = 0;
      const x = g.current.x;
      page.style.transform = x === 0 ? '' : `translateX(${x}px)`;
      page.style.boxShadow = x > 0 ? '-14px 0 38px rgba(0,0,0,0.26)' : '';
    };
    const schedule = (x: number) => {
      g.current.x = x;
      if (!g.current.raf) g.current.raf = requestAnimationFrame(flush);
    };

    const reset = () => {
      const s = g.current;
      s.tracking = false; s.claimed = false; s.deferEl = null;
    };

    const start = (e: TouchEvent) => {
      const s = g.current;
      if (s.busy || !enabledRef.current || e.touches.length !== 1) { s.tracking = false; return; }
      const t = e.touches[0];
      s.tracking = true; s.claimed = false;
      s.sx = t.clientX; s.sy = t.clientY; s.lx = t.clientX; s.lt = e.timeStamp || Date.now();
      s.vx = 0; s.claimDx = 0; s.w = width();
      s.fromEdge = t.clientX <= EDGE;
      // A horizontal scroller under the finger gets first dibs on a rightward
      // swipe while it can still scroll right (scrollLeft > 0).
      s.deferEl = findHScrollable(e.target, root);
    };

    const move = (e: TouchEvent) => {
      const s = g.current;
      if (!s.tracking || s.busy) return;
      if (e.touches.length !== 1) { reset(); return; } // multi-touch → cancel
      const t = e.touches[0];
      const dx = t.clientX - s.sx;
      const dy = t.clientY - s.sy;

      if (!s.claimed) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return; // not enough travel yet
        const horizontalRight = dx > 0 && Math.abs(dy) <= dx * ANGLE_TAN;
        if (!horizontalRight) { s.tracking = false; return; } // vertical / leftward → let the page handle it
        // Intent zone defers to a horizontal scroller that can still scroll
        // right; the left edge always wins (guaranteed back).
        if (!s.fromEdge && s.deferEl && s.deferEl.scrollLeft > 0) { s.tracking = false; return; }
        s.claimed = true;
        s.claimDx = dx; // start the page from here, no jump
        page.style.willChange = 'transform';
      }

      e.preventDefault(); // own the horizontal gesture
      const now = e.timeStamp || Date.now();
      const dt = now - s.lt;
      if (dt > 0) s.vx = (t.clientX - s.lx) / dt;
      s.lx = t.clientX; s.lt = now;
      schedule(Math.max(0, Math.min(s.w, dx - s.claimDx)));
    };

    // Run `body` exactly once when the animation settles. We null the
    // listeners and guard with a flag before calling anim.cancel() inside —
    // cancelling a finished WAAPI animation re-fires `oncancel`, which would
    // otherwise double-run the handler (and double-pop history).
    const onSettle = (anim: Animation, body: () => void) => {
      let done = false;
      const run = () => {
        if (done) return; done = true;
        anim.onfinish = null; anim.oncancel = null;
        body();
      };
      anim.onfinish = run; anim.oncancel = run;
    };

    const settleBack = () => {
      // Spring back to 0 and release.
      const from = g.current.x;
      if (g.current.raf) { cancelAnimationFrame(g.current.raf); g.current.raf = 0; }
      g.current.busy = true;
      const anim = page.animate(
        [{ transform: `translateX(${from}px)` }, { transform: 'translateX(0px)' }],
        { duration: SETTLE_MS, easing: EASE, fill: 'both' },
      );
      onSettle(anim, () => {
        page.style.transform = '';
        page.style.boxShadow = '';
        page.style.willChange = '';
        anim.cancel();
        g.current.x = 0;
        g.current.busy = false;
      });
    };

    const commitBack = () => {
      const w = g.current.w || width();
      if (g.current.raf) { cancelAnimationFrame(g.current.raf); g.current.raf = 0; }
      g.current.busy = true;
      const anim = page.animate(
        [{ transform: `translateX(${g.current.x}px)` }, { transform: `translateX(${w}px)` }],
        { duration: SETTLE_MS, easing: EASE, fill: 'both' },
      );
      onSettle(anim, () => {
        // Swap the route with no transition, then drop the page back to 0 so
        // the destination shows at rest. (The live snapshot reveal lands next.)
        onLockRef.current(true);
        onBackRef.current();
        page.style.transform = '';
        page.style.boxShadow = '';
        page.style.willChange = '';
        anim.cancel();
        g.current.x = 0;
        requestAnimationFrame(() => {
          onLockRef.current(false);
          g.current.busy = false;
        });
      });
    };

    const end = () => {
      const s = g.current;
      if (!s.claimed) { reset(); return; }
      reset();
      const commit = s.x > s.w * COMMIT_RATIO || s.vx > FLICK_VELOCITY;
      if (commit) commitBack();
      else settleBack();
    };

    const cancel = () => {
      const s = g.current;
      if (s.claimed) { reset(); settleBack(); }
      else reset();
    };

    root.addEventListener('touchstart', start, { passive: true });
    root.addEventListener('touchmove', move, { passive: false });
    root.addEventListener('touchend', end, { passive: true });
    root.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      root.removeEventListener('touchstart', start);
      root.removeEventListener('touchmove', move);
      root.removeEventListener('touchend', end);
      root.removeEventListener('touchcancel', cancel);
      if (g.current.raf) cancelAnimationFrame(g.current.raf);
    };
  }, []);

  return (
    <div ref={rootRef} className="relative" style={{ minHeight: '100dvh', background: 'var(--color-surface)' }}>
      <div ref={pageRef} style={{ minHeight: '100dvh', background: 'var(--color-surface)' }}>
        {children}
      </div>
    </div>
  );
};
