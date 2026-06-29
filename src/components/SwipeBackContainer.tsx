import React, { useEffect, useRef, type ReactNode } from 'react';
import { isOverlayOpen } from '../lib/overlay-registry';
import { getPageScroll, setPageScroll, getPrimaryScroller } from '../lib/page-scroll';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * iOS / Instagram-style swipe-back for the phone layout.
 *
 * The drag runs **off React's render path**: touch handlers write the page's
 * `transform` directly (coalesced in a rAF), no per-frame setState. Release
 * settles with the Web Animations API (GPU-composited).
 *
 * Activation has two zones — an always-back left edge (<= EDGE px) and an
 * intent zone everywhere else that only claims on a clear rightward swipe.
 * Vertical scroll and horizontal scrollers (carousels) keep their gestures;
 * we defer to a horizontal scroller while it can still scroll right.
 * Commit is distance OR velocity (a flick commits a short drag).
 *
 * Reveal — true iOS live parallax. We keep an inert `cloneNode` snapshot of
 * each page as it is left (captured in `getSnapshotBeforeUpdate`, before React
 * mutates the DOM), keyed by history index. During a back-swipe the
 * destination's snapshot is shown underneath the sliding page, offset left and
 * moving at a fraction of the page (parallax), with a leading-edge shadow and a
 * scrim that lightens to 0. On commit the real `navigate(-1)` restores the live
 * page (state preserved); nothing remounts during the gesture. Screens we can't
 * clone faithfully (map / reels — live canvas/video) simply have no snapshot and
 * fall back to the plain app-surface reveal.
 */

// Activation
const EDGE = 28;
const SLOP = 10;
const ANGLE_TAN = Math.tan((30 * Math.PI) / 180);
// Commit
const COMMIT_RATIO = 0.4;
const FLICK_VELOCITY = 0.35;
// Settle
const SETTLE_MS = 320;
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
// Reveal
const PARALLAX = 0.3;   // destination moves at 30% of the page's travel
const SCRIM_MAX = 0.28; // darkest scrim over the destination at rest

// ── Snapshot store ──────────────────────────────────────────────────────────
// Inert clones of pages we've left, keyed by history index. We only ever need
// one level (the immediate previous page) but keep a few so quick multi-back
// stays live; pruned aggressively to bound memory.
interface Snap { node: HTMLElement; scrollY: number }
const snapStore = new Map<number, Snap>();
const KEEP = 3;

/** Clones the live page into the store *before* React mutates the DOM. */
class LeaveSnapshot extends React.Component<{ navKey: number; snapshotable: boolean; getNode: () => HTMLElement | null }> {
  getSnapshotBeforeUpdate(prev: Readonly<{ navKey: number; snapshotable: boolean }>) {
    if (prev.navKey !== this.props.navKey && prev.snapshotable) {
      const node = this.props.getNode();
      if (node) {
        const clone = node.cloneNode(true) as HTMLElement;
        clone.style.transform = '';
        clone.style.transition = 'none';
        clone.style.boxShadow = '';
        clone.style.willChange = '';
        snapStore.set(prev.navKey, { node: clone, scrollY: getPageScroll() });
        const keys = [...snapStore.keys()].sort((a, b) => b - a);
        for (const k of keys.slice(KEEP)) snapStore.delete(k);
      }
    }
    return null;
  }
  componentDidUpdate() { /* required alongside getSnapshotBeforeUpdate */ }
  render() { return null; }
}

interface Props {
  enabled: boolean;
  navKey: number;        // history index of the current page
  snapshotable: boolean; // false for screens we can't clone (map/reels)
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

export const SwipeBackContainer: React.FC<Props> = ({ enabled, navKey, snapshotable, onBack, onLockTransition, children }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);

  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const onBackRef = useRef(onBack); onBackRef.current = onBack;
  const onLockRef = useRef(onLockTransition); onLockRef.current = onLockTransition;
  // Latest history index, readable inside the long-lived touch handlers.
  const navKeyRef = useRef(navKey); navKeyRef.current = navKey;

  const g = useRef({
    tracking: false, claimed: false, busy: false,
    sx: 0, sy: 0, lx: 0, lt: 0, vx: 0, claimDx: 0, w: 0,
    fromEdge: false, deferEl: null as HTMLElement | null,
    x: 0, raf: 0, reduce: false,
    revealActive: false,
    destWrap: null as HTMLElement | null,
    scrim: null as HTMLElement | null,
    destIdx: -1, destScrollY: 0,
  });

  useEffect(() => {
    const root = rootRef.current;
    const page = pageRef.current;
    const reveal = revealRef.current;
    if (!root || !page || !reveal) return;
    const width = () => root.clientWidth || window.innerWidth;

    const paintReveal = (x: number) => {
      const s = g.current;
      if (!s.revealActive || !s.destWrap || !s.scrim) return;
      const w = s.w || 1;
      const p = Math.max(0, Math.min(1, x / w));
      s.destWrap.style.transform = `translateX(${-PARALLAX * w * (1 - p)}px)`;
      s.scrim.style.opacity = String(SCRIM_MAX * (1 - p));
    };

    const flush = () => {
      g.current.raf = 0;
      const x = g.current.x;
      page.style.transform = x === 0 ? '' : `translateX(${x}px)`;
      paintReveal(x);
    };
    const schedule = (x: number) => {
      g.current.x = x;
      if (!g.current.raf) g.current.raf = requestAnimationFrame(flush);
    };

    const openReveal = () => {
      const s = g.current;
      // Reduced motion: skip the live parallax/scrim entirely, keep a plain slide.
      if (s.reduce) { s.revealActive = false; return; }
      s.destIdx = navKeyRef.current - 1;
      const snap = snapStore.get(s.destIdx);
      if (!snap) { s.revealActive = false; return; }
      s.destScrollY = snap.scrollY;
      reveal.textContent = '';
      const destWrap = document.createElement('div');
      destWrap.style.cssText = 'position:absolute;inset:0;will-change:transform;background:var(--color-surface);';
      const host = snap.node;
      host.style.position = 'absolute';
      host.style.top = '0'; host.style.left = '0'; host.style.right = '0';
      host.style.transform = '';
      destWrap.appendChild(host);
      const scrim = document.createElement('div');
      scrim.style.cssText = `position:absolute;inset:0;background:#000;opacity:${SCRIM_MAX};pointer-events:none;`;
      reveal.appendChild(destWrap);
      reveal.appendChild(scrim);
      reveal.style.display = 'block';
      destWrap.style.transform = `translateX(${-PARALLAX * s.w}px)`;
      // Replay the destination's scroll onto the clone so the reveal matches
      // where the page was left: an inner scroller gets its scrollTop; a
      // window-scrolled page gets a translateY on the clone.
      if (snap.scrollY > 0) {
        const innerScroller = getPrimaryScroller(host);
        if (innerScroller) innerScroller.scrollTop = snap.scrollY;
        else host.style.transform = `translateY(${-snap.scrollY}px)`;
      }
      s.destWrap = destWrap; s.scrim = scrim; s.revealActive = true;
    };

    const closeReveal = () => {
      const s = g.current;
      reveal.style.display = 'none';
      reveal.textContent = ''; // detaches the stored node (store keeps the ref)
      s.destWrap = null; s.scrim = null; s.revealActive = false;
    };

    const reset = () => {
      const s = g.current;
      s.tracking = false; s.claimed = false; s.deferEl = null;
    };

    // Run cb after a few paints, with a timeout fallback so cleanup never
    // stalls if rAF is throttled (backgrounded tab). The extra frames give the
    // destination (which was visibility:hidden and must repaint when it becomes
    // active) time to paint while the snapshot still covers it — no flash.
    const nextFrame = (cb: () => void) => {
      let done = false;
      const run = () => { if (done) return; done = true; cb(); };
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(run)));
      setTimeout(run, 140);
    };

    // Run `body` exactly once on settle. We null the listeners before the
    // anim.cancel() inside `body` — cancelling a finished WAAPI animation
    // re-fires `oncancel`, which would otherwise double-run (double-pop).
    const onSettle = (anim: Animation, body: () => void) => {
      let done = false;
      const run = () => { if (done) return; done = true; anim.onfinish = null; anim.oncancel = null; body(); };
      anim.onfinish = run; anim.oncancel = run;
      // Safety net: if the compositor stalls (tab backgrounded mid-settle) the
      // WAAPI finish event may never fire — force completion so we never get
      // stuck with the page parked off-screen.
      setTimeout(run, SETTLE_MS + 80);
    };

    const settle = (toX: number, commit: boolean) => {
      const s = g.current;
      const w = s.w || width();
      if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; }
      s.busy = true;
      const pageAnim = page.animate(
        [{ transform: `translateX(${s.x}px)` }, { transform: `translateX(${toX}px)` }],
        { duration: SETTLE_MS, easing: EASE, fill: 'both' },
      );
      if (s.revealActive && s.destWrap && s.scrim) {
        const pFrom = Math.max(0, Math.min(1, s.x / w));
        const pTo = commit ? 1 : 0;
        s.destWrap.animate(
          [{ transform: `translateX(${-PARALLAX * w * (1 - pFrom)}px)` }, { transform: `translateX(${-PARALLAX * w * (1 - pTo)}px)` }],
          { duration: SETTLE_MS, easing: EASE, fill: 'both' },
        );
        s.scrim.animate(
          [{ opacity: SCRIM_MAX * (1 - pFrom) }, { opacity: SCRIM_MAX * (1 - pTo) }],
          { duration: SETTLE_MS, easing: EASE, fill: 'both' },
        );
      }
      onSettle(pageAnim, () => {
        pageAnim.cancel();
        if (commit) {
          // Keep the page off-screen (the snapshot underneath shows the
          // destination) while the real route swaps in instantly, then drop
          // the now-real page to 0 and remove the snapshot — no flash.
          page.style.transform = `translateX(${w}px)`;
          // Lock route transitions to instant FIRST and let the exiting page
          // re-render with that instant transition (one frame) before we
          // navigate — otherwise AnimatePresence replays the page's slide-out
          // exit, which the gesture already did: a second "swipe" flash.
          onLockRef.current(true);
          let swapped = false;
          const swap = () => {
            if (swapped) return; swapped = true;
            onBackRef.current();
            snapStore.delete(s.destIdx);
            nextFrame(() => {
              // Land the real page at the snapshot's scroll before it covers the
              // snapshot, so there's no jump-to-top flash on commit.
              if (s.revealActive) setPageScroll(s.destScrollY);
              page.style.transform = '';
              page.style.boxShadow = '';
              page.style.willChange = '';
              closeReveal();
              onLockRef.current(false);
              s.busy = false;
            });
          };
          requestAnimationFrame(swap);
          setTimeout(swap, 60); // fallback if rAF is throttled
        } else {
          page.style.transform = '';
          page.style.boxShadow = '';
          page.style.willChange = '';
          closeReveal();
          s.x = 0;
          s.busy = false;
        }
      });
    };

    const start = (e: TouchEvent) => {
      const s = g.current;
      // Stand down on the root screen, while settling, with an overlay open,
      // or on multi-touch.
      if (s.busy || !enabledRef.current || isOverlayOpen() || e.touches.length !== 1) { s.tracking = false; return; }
      const t = e.touches[0];
      s.tracking = true; s.claimed = false;
      s.sx = t.clientX; s.sy = t.clientY; s.lx = t.clientX; s.lt = e.timeStamp || Date.now();
      s.vx = 0; s.claimDx = 0; s.w = width();
      s.fromEdge = t.clientX <= EDGE;
      s.reduce = prefersReducedMotion();
      s.deferEl = findHScrollable(e.target, root);
    };

    const move = (e: TouchEvent) => {
      const s = g.current;
      if (!s.tracking || s.busy) return;
      if (e.touches.length !== 1) { reset(); return; }
      const t = e.touches[0];
      const dx = t.clientX - s.sx;
      const dy = t.clientY - s.sy;

      if (!s.claimed) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        const horizontalRight = dx > 0 && Math.abs(dy) <= dx * ANGLE_TAN;
        if (!horizontalRight) { s.tracking = false; return; }
        if (!s.fromEdge && s.deferEl && s.deferEl.scrollLeft > 0) { s.tracking = false; return; }
        s.claimed = true;
        s.claimDx = dx;
        page.style.willChange = 'transform';
        if (!s.reduce) page.style.boxShadow = '-14px 0 38px rgba(0,0,0,0.26)';
        openReveal();
      }

      e.preventDefault();
      const now = e.timeStamp || Date.now();
      const dt = now - s.lt;
      if (dt > 0) s.vx = (t.clientX - s.lx) / dt;
      s.lx = t.clientX; s.lt = now;
      schedule(Math.max(0, Math.min(s.w, dx - s.claimDx)));
    };

    const end = () => {
      const s = g.current;
      if (!s.claimed) { reset(); return; }
      reset();
      const commit = s.x > s.w * COMMIT_RATIO || s.vx > FLICK_VELOCITY;
      settle(commit ? s.w : 0, commit);
    };

    const cancel = () => {
      const s = g.current;
      if (s.claimed) { reset(); settle(0, false); }
      else reset();
    };

    // Cancel cleanly when the app is backgrounded mid-gesture.
    const onVisibility = () => { if (document.hidden && g.current.claimed) cancel(); };

    root.addEventListener('touchstart', start, { passive: true });
    root.addEventListener('touchmove', move, { passive: false });
    root.addEventListener('touchend', end, { passive: true });
    root.addEventListener('touchcancel', cancel, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      root.removeEventListener('touchstart', start);
      root.removeEventListener('touchmove', move);
      root.removeEventListener('touchend', end);
      root.removeEventListener('touchcancel', cancel);
      document.removeEventListener('visibilitychange', onVisibility);
      if (g.current.raf) cancelAnimationFrame(g.current.raf);
    };
  }, []);

  return (
    <div ref={rootRef} style={{ position: 'relative', minHeight: '100dvh', background: 'var(--color-surface)' }}>
      <LeaveSnapshot navKey={navKey} snapshotable={snapshotable} getNode={() => pageRef.current} />
      {/* Destination snapshot lives here during a back-swipe, behind the page. */}
      <div ref={revealRef} style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', display: 'none', background: 'var(--color-surface)', contain: 'layout paint' }} />
      <div ref={pageRef} style={{ position: 'relative', zIndex: 1, minHeight: '100dvh', background: 'var(--color-surface)' }}>
        {children}
      </div>
    </div>
  );
};
