import { useEffect, useRef, type FC } from 'react';

/**
 * Instagram-style pull-to-refresh for the phone layout.
 *
 * The native WKWebView rubber-band is disabled (MainViewController.swift), so
 * this is a pure touch/JS gesture: when the user drags down while the page is
 * already at the very top, a floating spinner follows the finger; releasing
 * past the threshold spins it while `onRefresh()` runs, then retracts in place
 * — a soft refresh with no full page reload / loading flash.
 *
 * It only engages when the gesture starts at the top of the *document* scroller
 * (not inside an inner overflow-y container), which keeps it off modals,
 * bottom-sheets and inner scroll lists automatically. `enabled` is turned off
 * on routes where a vertical drag means something else (reels, map, messages…).
 */
const THRESHOLD = 68; // px of (resisted) pull needed to trigger a refresh
const MAX_PULL = 96; // visual cap so the bubble never wanders too far down
const RESISTANCE = 0.5; // finger travel → bubble travel (rubber-band feel)
const MIN_SPIN = 600; // ms the spinner stays up even if the refresh is instant

interface Props {
  enabled: boolean;
  /** Runs the soft refresh; the spinner stays until it (and MIN_SPIN) resolve. */
  onRefresh: () => void | Promise<void>;
}

export const PullToRefresh: FC<Props> = ({ enabled, onRefresh }) => {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<SVGSVGElement>(null);
  // Keep the latest onRefresh reachable from the long-lived touch handlers
  // without re-subscribing them on every render.
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled) return;
    const bubble = bubbleRef.current;
    const ring = ringRef.current;
    if (!bubble || !ring) return;

    let startY = 0;
    let startX = 0;
    let tracking = false; // gesture began somewhere valid (top of page)
    let pulling = false; // actively pulling — preventDefault is engaged
    let dist = 0;
    let refreshing = false;

    const scrollTop = () =>
      window.scrollY || document.documentElement.scrollTop || 0;

    // Climb from the touch target to the nearest vertically scrollable
    // ancestor. Returns it if found (→ inner container, skip PTR) or null
    // when the gesture belongs to the page itself.
    const innerScroller = (node: EventTarget | null): Element | null => {
      let el = node instanceof Element ? node : null;
      while (el && el !== document.body && el !== document.documentElement) {
        const s = getComputedStyle(el);
        if (
          (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 1
        )
          return el;
        el = el.parentElement;
      }
      return null;
    };

    const paint = (d: number) => {
      const p = Math.max(0, d);
      const shown = Math.min(1, p / THRESHOLD);
      bubble.style.opacity = String(shown);
      bubble.style.transform = `translate(-50%, ${p}px) scale(${0.7 + 0.3 * shown})`;
      ring.style.transform = `rotate(${p * 2.6}deg)`;
    };

    const settle = () => {
      dist = 0;
      pulling = false;
      tracking = false;
      bubble.style.transition = 'transform .28s ease, opacity .25s ease';
      bubble.style.transform = 'translate(-50%, 0px) scale(0.7)';
      bubble.style.opacity = '0';
      ring.classList.remove('ptr-spin');
      window.setTimeout(() => {
        if (bubbleRef.current) bubbleRef.current.style.transition = '';
      }, 300);
    };

    const onStart = (e: TouchEvent) => {
      if (refreshing || e.touches.length !== 1) return;
      if (scrollTop() > 0) return; // not at the top
      if (innerScroller(e.target)) return; // inside a modal / inner list
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      tracking = true;
      pulling = false;
      dist = 0;
      bubble.style.transition = '';
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking || refreshing) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      if (!pulling) {
        if (dy <= 0) { tracking = false; return; } // scrolling up → release
        if (Math.abs(dx) > Math.abs(dy)) { tracking = false; return; } // horizontal swipe
        if (dy < 6) return; // wait until the intent is clearly vertical
        if (scrollTop() > 0) { tracking = false; return; } // drifted off the top
        pulling = true;
      }
      e.preventDefault(); // own the gesture; stop any page movement
      dist = Math.min(MAX_PULL, dy * RESISTANCE);
      paint(dist);
    };

    const onEnd = () => {
      if (!tracking || refreshing) return;
      if (pulling && dist >= THRESHOLD) {
        refreshing = true;
        bubble.style.transition = 'transform .2s ease';
        bubble.style.transform = `translate(-50%, ${THRESHOLD}px) scale(1)`;
        bubble.style.opacity = '1';
        ring.style.transform = '';
        ring.classList.add('ptr-spin');
        const work = Promise.resolve().then(() => onRefreshRef.current()).catch(() => {});
        const floor = new Promise<void>((r) => window.setTimeout(r, MIN_SPIN));
        Promise.all([work, floor]).then(() => {
          refreshing = false;
          settle();
        });
      } else {
        settle();
      }
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled]);

  return (
    <div
      ref={bubbleRef}
      aria-hidden
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top) + 6px)',
        left: '50%',
        transform: 'translate(-50%, 0px) scale(0.7)',
        opacity: 0,
        zIndex: 55,
        pointerEvents: 'none',
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: 'var(--color-paper)',
        boxShadow: '0 6px 20px rgba(0,0,0,0.20)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        willChange: 'transform, opacity',
      }}
    >
      <svg
        ref={ringRef}
        width="22"
        height="22"
        viewBox="0 0 22 22"
        className="ptr-ring"
        style={{ transformOrigin: 'center' }}
      >
        <circle cx="11" cy="11" r="8.5" fill="none" stroke="var(--color-on-surface)" strokeOpacity="0.15" strokeWidth="2.5" />
        <circle cx="11" cy="11" r="8.5" fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="15 40" />
      </svg>
    </div>
  );
};
