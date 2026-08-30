import { useEffect, useRef, useState, type FC } from 'react';
import { subscribeOverlay } from '../lib/overlay-registry';

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
 * (not inside an inner overflow-y container) AND no overlay is open. `enabled`
 * is turned off on routes where a vertical drag means something else (reels,
 * map, messages…).
 *
 * The overlay check is not redundant with the inner-scroller one. A sheet's
 * list only counts as an inner scroller once it actually overflows, so a
 * comment popup with two comments in it looks exactly like the page to that
 * test — and the body is scroll-locked underneath, so `scrollTop()` reads 0
 * and every guard passes. Pulling down on the sheet fired a page refresh.
 * Standing down on the same signal the swipe-back gesture uses is the fix:
 * while a sheet owns the screen, a downward drag is the sheet's to interpret.
 */
const THRESHOLD = 68; // px of (resisted) pull needed to trigger a refresh
const MAX_PULL = 96; // visual cap so the bubble never wanders too far down
const RESISTANCE = 0.5; // finger travel → bubble travel (rubber-band feel)
const MIN_SPIN = 600; // ms the spinner stays up even if the refresh is instant

interface Props {
  enabled: boolean;
  /** Runs the soft refresh; the spinner stays until it (and MIN_SPIN) resolve. */
  onRefresh: () => void | Promise<void>;
  /** Scope the gesture to one scroll container instead of the document.
   *  For a page embedded inside another route's own scroller (the Search
   *  tab's Recipes pill, sitting over the Discover map) the document never
   *  scrolls there, so the document-scoped instance can't see this gesture
   *  at all -- the map showing through a plain overscroll bounce reads as
   *  a bug rather than as "there is a page under this one". Giving the
   *  gesture a real refresh is both the fix and the more honest read.
   *
   *  A DOM node, not a ref object: the effect below needs to know the
   *  instant it's mounted, and a `RefObject` doesn't cause a re-render
   *  when `.current` changes. The caller supplies it with the ordinary
   *  `useState<HTMLElement|null>` + callback-ref pattern. */
  container?: HTMLElement | null;
  /** Resting distance from the viewport top. The document instance sits at
   *  the safe-area inset; a scoped instance nested under floating chrome
   *  (a tab pill, a search field) needs to clear it instead. */
  topOffset?: string;
}

export const PullToRefresh: FC<Props> = ({ enabled, onRefresh, container, topOffset }) => {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<SVGSVGElement>(null);
  // Keep the latest onRefresh reachable from the long-lived touch handlers
  // without re-subscribing them on every render.
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  // Any open sheet/modal parks the gesture entirely — see the note above.
  const [overlayOpen, setOverlayOpen] = useState(false);
  useEffect(() => subscribeOverlay(setOverlayOpen), []);

  useEffect(() => {
    if (!enabled || overlayOpen) return;
    if (container === null) return; // scoped instance whose node isn't mounted yet
    const bubble = bubbleRef.current;
    const ring = ringRef.current;
    if (!bubble || !ring) return;
    // Listeners bind to this — the document instance still wants `window`
    // (touches over position:fixed chrome outside the scroller need to
    // count too; a scoped instance's chrome is all inside its own box).
    const target: EventTarget = container ?? window;

    let startY = 0;
    let startX = 0;
    let tracking = false; // gesture began somewhere valid (top of page)
    let pulling = false; // actively pulling — preventDefault is engaged
    let dist = 0;
    let refreshing = false;

    const scrollTop = () =>
      container
        ? container.scrollTop
        : window.scrollY || document.documentElement.scrollTop || 0;
    // Ceiling for the inner-scroller climb below: the document instance
    // climbs to the document root; a scoped instance climbs only up to
    // its OWN container, because that container is the intended target,
    // not something to stand down for.
    const ceiling: Element = container ?? document.documentElement;

    // Climb from the touch target to the nearest vertically scrollable
    // ancestor (stopping at `ceiling`). Returns it if found (→ inner
    // container, skip PTR) or null when the gesture belongs to the target.
    const innerScroller = (node: EventTarget | null): Element | null => {
      let el = node instanceof Element ? node : null;
      while (el && el !== ceiling && el !== document.body && el !== document.documentElement) {
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

    // The non-passive touchmove is bound ONLY while a qualifying gesture is
    // being tracked (started at the top of the page scroller) and unbound
    // on end/cancel/disqualification — same pattern as SwipeBackContainer.
    // A permanently-bound non-passive window listener forced EVERY scroll
    // frame app-wide through the main thread, killing threaded scrolling.
    let moveBound = false;
    const bindMove = () => {
      if (moveBound) return;
      moveBound = true;
      target.addEventListener('touchmove', onMove as EventListener, { passive: false });
    };
    const unbindMove = () => {
      if (!moveBound) return;
      moveBound = false;
      target.removeEventListener('touchmove', onMove as EventListener);
    };
    const stopTracking = () => {
      tracking = false;
      unbindMove();
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
      bindMove();
    };

    function onMove(e: TouchEvent) {
      if (!tracking || refreshing) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      if (!pulling) {
        if (dy <= 0) { stopTracking(); return; } // scrolling up → release
        if (Math.abs(dx) > Math.abs(dy)) { stopTracking(); return; } // horizontal swipe
        if (dy < 6) return; // wait until the intent is clearly vertical
        if (scrollTop() > 0) { stopTracking(); return; } // drifted off the top
        pulling = true;
      }
      e.preventDefault(); // own the gesture; stop any page movement
      dist = Math.min(MAX_PULL, dy * RESISTANCE);
      paint(dist);
    }

    const onEnd = () => {
      unbindMove();
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

    target.addEventListener('touchstart', onStart as EventListener, { passive: true });
    target.addEventListener('touchend', onEnd, { passive: true });
    target.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      target.removeEventListener('touchstart', onStart as EventListener);
      unbindMove();
      target.removeEventListener('touchend', onEnd);
      target.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled, overlayOpen, container]);

  return (
    <div
      ref={bubbleRef}
      aria-hidden
      style={{
        position: 'fixed',
        top: topOffset ?? 'calc(env(safe-area-inset-top) + 6px)',
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
