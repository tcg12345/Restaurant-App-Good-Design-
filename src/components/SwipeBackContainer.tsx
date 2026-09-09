import { backCoordinate, backTranslation, backReveal, atVerticalStart, type BackGestureDirection } from '../lib/back-gesture';
import { allowBackNavigation } from '../lib/back-navigation';
import React, { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { isOverlayOpen } from '../lib/overlay-registry';
import { setPageScroll, getPrimaryScroller } from '../lib/page-scroll';
import { holdGlass, releaseGlass, copyGlassToPreview, wakeGlassButtons, flushGlassButtons } from '../lib/glass-buttons';
import { isKeepAlivePath } from '../lib/keep-alive';
import { handoffBackPreview } from '../lib/back-handoff';
import { BACK_SHADOW_WIDTH, backShadowFrames, backShadowOpacity } from '../lib/back-shadow';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * iOS / Instagram-style swipe-back for the phone layout.
 *
 * The drag runs **off React's render path**: touch handlers move a viewport
 * preview directly (coalesced in a rAF), no per-frame setState. Release
 * settles with the Web Animations API (GPU-composited), with the duration
 * scaled to the remaining distance and release velocity.
 *
 * Pushed pages return rightward, Create returns leftward, and route sheets
 * dismiss downward. Horizontal routes reserve their leading return edge;
 * clear directional intent elsewhere leaves nested media gestures alone.
 * Vertical scroll and horizontal scrollers (carousels) keep their gestures;
 * the non-passive touchmove listener is bound per-touch and dropped the
 * moment a touch is ruled out, so ordinary scrolling is never tied to the
 * main thread. Commit is distance OR velocity (a flick commits a short
 * drag; a clear leftward flick cancels even past the distance threshold),
 * and a cancel settle can be re-grabbed mid-bounce like on iOS.
 *
 * Reveal — true iOS live parallax. We keep an inert `cloneNode` snapshot of
 * each page as it is left (captured in `getSnapshotBeforeUpdate`, before
 * React mutates the DOM), keyed by history index. The snapshot for the
 * *current* back destination is attached and laid out during idle time right
 * after each navigation, so claiming a gesture only flips its visibility —
 * no mid-gesture DOM building. During a back-swipe it shows underneath the
 * sliding page, offset left and moving at a fraction of the page (parallax),
 * with a leading-edge shadow and a scrim that lightens to 0.
 *
 * The live document is never transformed during Back: that would reparent
 * fixed headers and reposition them when the window is scrolled. A static
 * front preview covers it until the destination and its scroll are ready.
 *
 * Commit — the route transition is locked to instant when the commit settle
 * *starts* (so React has the whole settle to flush it), the real navigation
 * fires when the page is parked off-screen, and the snapshot stays on top
 * until the destination is verifiably committed and at rest (the
 * [data-route-stack] wrapper present-and-untransformed, or gone), plus a
 * settled frame — not a blind frame count. That's what kills the "previous
 * page flashes back" glitch. Screens we can't clone faithfully (map / reels
 * — live canvas/video) simply have no snapshot and fall back to the plain
 * app-surface reveal.
 */

// Activation
const EDGE = 28;
const SLOP = 10;
const ANGLE_TAN = Math.tan((30 * Math.PI) / 180);
// Commit
const COMMIT_RATIO = 0.35;
const FLICK_VELOCITY = 0.35;    // px/ms rightward — commits a short drag
const CANCEL_VELOCITY = -0.25;  // px/ms leftward — cancels even past the ratio
// Settle
const MIN_SETTLE_MS = 160;
const MAX_SETTLE_MS = 320;
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
// Reveal
const PARALLAX = 0.35;  // destination parks 35% left and moves at 35% of the page's travel (iOS)
const SCRIM_MAX = 0.16; // darkest scrim over the destination at rest
// Commit finalize — how long we'll wait for the destination to paint before
// force-completing (rAF throttling, pathological renders).
const FINALIZE_TIMEOUT_MS = 900;

// ── Snapshot store ──────────────────────────────────────────────────────────
// Inert clones of pages we've left, keyed by history index. We only ever need
// one level (the immediate previous page) but keep a few so quick multi-back
// stays live; pruned aggressively to bound memory.
interface Snap { node: HTMLElement; nav: HTMLElement | null; scrollY: number }
const snapStore = new Map<number, Snap>();
const KEEP = 8;
let snapshotSerial = 0;

/**
 * Clone the bottom nav (if the page being left shows one) so the destination
 * preview carries its tab bar during a back-swipe, exactly like iOS. The nav
 * is `position:fixed`, which inside the transformed preview wrapper resolves
 * against the wrapper's viewport-sized box — same geometry as the real one.
 */
function cloneBottomNav(): HTMLElement | null {
  const nav = document.querySelector<HTMLElement>('[data-bottom-nav]');
  if (!nav) return null;
  // Native bars contribute geometry rather than CSS artwork. The glass
  // sampler uses the marker to reveal the existing UIKit instance.
  if (nav.childElementCount === 0) return null;
  const clone = nav.cloneNode(true) as HTMLElement;
  clone.removeAttribute('data-bottom-nav');
  clone.querySelectorAll<HTMLElement>('[data-native-tab-source]').forEach(el => {
    delete el.dataset.nativeTabSource;
    el.dataset.nativeTabPreview = '';
  });
  // The wrapper (and the nav inside) can be mid-animation when captured —
  // snapshot them at rest.
  clone.style.transform = '';
  clone.style.opacity = '';
  clone.style.transition = 'none';
  clone.style.pointerEvents = 'none';
  const inner = clone.firstElementChild as HTMLElement | null;
  if (inner) { inner.style.transform = ''; inner.style.opacity = ''; }
  return clone;
}

/**
 * Clone the page for a snapshot. Skips `aria-hidden` children — the hidden
 * keep-alive tab layers (every visited tab stays mounted) and the edge-shadow
 * strip — so the clone holds one page's DOM, not four tabs' worth.
 */
function clonePageNode(node: HTMLElement): HTMLElement {
  const clone = node.cloneNode(false) as HTMLElement;
  for (const child of Array.from(node.children) as HTMLElement[]) {
    if (child.getAttribute('aria-hidden') === 'true') continue;
    const c = child.cloneNode(true) as HTMLElement;
    // A route wrapper can be mid-slide when captured (fast double-nav) —
    // snapshot it at rest.
    c.style.transform = '';
    c.style.transition = 'none';
    clone.appendChild(c);
  }
  // The clone stays attached (hidden) between gestures — cloned feed videos
  // must not autoplay and stream in the background. First frame / poster is
  // all a snapshot needs.
  clone.querySelectorAll('video').forEach((v) => {
    v.removeAttribute('autoplay');
    v.autoplay = false;
    v.preload = 'metadata';
  });
  // Keep the web slots transparent: native glass also owns preview chrome.
  copyGlassToPreview(clone);
  // Mark scroll positions by walking corresponding retained top-level branches.
  for (const child of Array.from(node.children) as HTMLElement[]) {
    if (child.getAttribute('aria-hidden') === 'true') continue;
    const branch = clone.children[Array.from(node.children).filter(c => c.getAttribute('aria-hidden') !== 'true').indexOf(child)] as HTMLElement;
    if (!branch) continue;
    const from = [child, ...Array.from(child.querySelectorAll<HTMLElement>('*'))];
    const to = [branch, ...Array.from(branch.querySelectorAll<HTMLElement>('*'))];
    from.forEach((el, i) => {
      if (to[i] && /^(fixed|sticky)$/.test(getComputedStyle(el).position)) {
        to[i].dataset.snapshotViewportY = String(el.getBoundingClientRect().top);
      }
      if (to[i] && (el.scrollTop || el.scrollLeft)) {
        to[i].dataset.snapshotScroll = `${el.scrollLeft},${el.scrollTop}`;
      }
    });
  }
  clone.inert = true;
  const idMap = new Map<string, string>();
  const prefix = `nav-preview-${++snapshotSerial}-`;
  clone.querySelectorAll('[id]').forEach(el => { const id = el.id; idMap.set(id, prefix + id); el.id = prefix + id; });
  clone.querySelectorAll('*').forEach(el => {
    for (const attribute of Array.from(el.attributes)) {
      let value = attribute.value;
      for (const [id, replacement] of idMap) {
        value = value.split(`url(#${id})`).join(`url(#${replacement})`);
        if ((attribute.name === 'href' || attribute.name === 'xlink:href') && value === `#${id}`) value = `#${replacement}`;
      }
      if (value !== attribute.value) el.setAttribute(attribute.name, value);
    }
  });
  // Preview DOM must never impersonate a live route during scroll restoration.
  for (const attribute of ['data-route-entry', 'data-route-stack', 'data-swipe-page']) {
    clone.removeAttribute(attribute);
    clone.querySelectorAll(`[${attribute}]`).forEach(el => el.removeAttribute(attribute));
  }
  clone.style.transform = '';
  clone.style.transition = 'none';
  clone.style.boxShadow = '';
  clone.style.willChange = '';
  clone.style.pointerEvents = 'none';
  return clone;
}

type LeaveSnapshotProps = { navKey: number; snapshotable: boolean; getNode: () => HTMLElement | null };

/** Clones the live page into the store *before* React mutates the DOM. */
class LeaveSnapshot extends React.Component<LeaveSnapshotProps, {}, null> {
  // This repo has no @types/react, so React.Component is inferred from JS and
  // drops `this.props` on a subclass that defines getSnapshotBeforeUpdate.
  // Assert the field (no runtime effect) so the lifecycle body type-checks.
  declare props: LeaveSnapshotProps;
  getSnapshotBeforeUpdate(prev: Readonly<LeaveSnapshotProps>): null {
    if (prev.navKey !== this.props.navKey) {
      const node = this.props.getNode();
      const nav = cloneBottomNav();
      if (node && (prev.snapshotable || nav)) {
        // Canvas/video pages still use a plain reveal, but retain their tab
        // geometry so the bar doesn't arrive late on a return to Reels/Search.
        const snapshot = prev.snapshotable ? clonePageNode(node) : document.createElement('div');
        if (!prev.snapshotable) snapshot.style.cssText = `position:absolute;inset:0;background:${nav?.querySelector('[data-active-tab="/reels"]') ? '#000' : 'var(--color-surface)'}`;
        snapStore.set(prev.navKey, { node: snapshot, nav, scrollY: prev.snapshotable ? getPrimaryScroller(node, true)?.scrollTop ?? window.scrollY : 0 });
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
  navKey: number;             // history index of the current page
  locationKey: string;        // router location.key — changes when a navigation commits
  snapshotable: boolean;      // false for screens we can't clone (map/reels)
  /** History index whose stored snapshot previews the back destination (pop only). */
  revealSnapshotKey: number | null;
  /** True when the back target is a history pop, false when it's a navigate-to-parent. */
  backIsPop: boolean;
  onBack: () => void;
  previewPush?: boolean;
  edgeOnly?: boolean;
  direction?: BackGestureDirection;
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

/** Current translateX of an element, animations included. */
function txOf(el: Element): number {
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return 0;
  const m3 = /matrix3d\(([^)]+)\)/.exec(t);
  if (m3) return parseFloat(m3[1].split(',')[12]) || 0;
  const m = /matrix\(([^)]+)\)/.exec(t);
  if (m) return parseFloat(m[1].split(',')[4]) || 0;
  return 0;
}

export const SwipeBackContainer: React.FC<Props> = ({
  enabled, navKey, locationKey, snapshotable, revealSnapshotKey, backIsPop,
  onBack, onLockTransition, previewPush = false, edgeOnly = false, direction = 'right', children,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);

  const directionRef = useRef(direction); directionRef.current = direction;
  const suppressClickUntil = useRef(0);
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const onBackRef = useRef(onBack); onBackRef.current = onBack;
  const onLockRef = useRef(onLockTransition); onLockRef.current = onLockTransition;
  const navKeyRef = useRef(navKey); navKeyRef.current = navKey;
  const locationKeyRef = useRef(locationKey); locationKeyRef.current = locationKey;
  const revealKeyRef = useRef(revealSnapshotKey); revealKeyRef.current = revealSnapshotKey;
  const backIsPopRef = useRef(backIsPop); backIsPopRef.current = backIsPop;
  const edgeOnlyRef = useRef(edgeOnly); edgeOnlyRef.current = edgeOnly;
  const resetNavigationRef = useRef<() => void>(() => {});
  const pushPreviewRef = useRef<() => void>(() => {});
  const rebuildRef = useRef<() => void>(() => {});

  const g = useRef({
    direction: 'right' as BackGestureDirection,
    commitBack: null as (() => void) | null,
    tracking: false, claimed: false, busy: false, moveBound: false,
    sx: 0, sy: 0, lx: 0, lt: 0, vx: 0, claimDx: 0, w: 0,
    fromEdge: false, deferEl: null as HTMLElement | null,
    x: 0, raf: 0, reduce: false,
    // live reveal (during a gesture)
    revealActive: false,
    destWrap: null as HTMLElement | null,
    scrim: null as HTMLElement | null,
    destScrollY: 0,
    // prepared reveal (built at idle, hidden until a gesture claims)
    prepKey: null as number | null,
    prepWrap: null as HTMLElement | null,
    prepScrim: null as HTMLElement | null,
    prepScrollY: 0,
    rebuildTimer: 0,
    // settle
    settleMode: 'none' as 'none' | 'cancel' | 'commit',
    // One glass hold per gesture (a re-grab mid-cancel must not hold twice).
    glassHeld: false,
    anims: [] as Animation[],
    disarmSettle: null as (() => void) | null,
    // commit finalize
    finalizing: false,
    handoff: null as AbortController | null,
    finalizeTimer: 0,
    finFromLocKey: '',
    finKey: null as number | null,
    finHadSnap: false,
    finScrollY: 0,
    finIsPop: true,
  });

  useEffect(() => {
    const root = rootRef.current;
    const page = pageRef.current;
    const front = frontRef.current;
    const reveal = revealRef.current;
    const shadow = shadowRef.current;
    if (!root || !page || !front || !reveal || !shadow) return;
    const width = () => g.current.direction === 'down' ? window.innerHeight : root.clientWidth || window.innerWidth;
    const coordinate = (t: { clientX: number; clientY: number }) => backCoordinate(t.clientX, t.clientY, g.current.direction);

    const hideFront = () => {
      // Hide before resetting its transform: WebKit's native glass sampler
      // must never see the outgoing preview back at x=0 during cleanup.
      front.style.visibility = 'hidden';
      shadow.style.opacity = '0';
      front.replaceChildren();
      front.style.transform = '';
      front.style.willChange = '';
      shadow.style.transform = '';
      page.style.opacity = '';
    };
    const paintShadow = (distance: number) => {
      const s = g.current;
      shadow.style.transform = backTranslation(distance, s.direction);
      shadow.style.opacity = String(s.reduce ? 0 : backShadowOpacity(distance, s.w || width()));
    };
    const showFront = () => {
      if (front.childElementCount) return;
      const direction = g.current.direction;
      Object.assign(shadow.style, direction === 'down'
        ? { left: '0', top: `-${BACK_SHADOW_WIDTH}px`, width: '100%', height: `${BACK_SHADOW_WIDTH}px`, background: 'linear-gradient(to top, rgba(0,0,0,.18), transparent)' }
        : { left: direction === 'left' ? '100%' : `-${BACK_SHADOW_WIDTH}px`, top: '0', width: `${BACK_SHADOW_WIDTH}px`, height: '100%', background: `linear-gradient(to ${direction === 'left' ? 'right' : 'left'}, rgba(0,0,0,.18), transparent)` });
      paintShadow(g.current.x);
      const host = clonePageNode(page);
      const scrollY = getPrimaryScroller(page, true)?.scrollTop ?? window.scrollY;
      host.style.cssText += ';position:absolute;inset:0 0 auto;';
      front.appendChild(host);
      const nav = cloneBottomNav();
      if (nav?.querySelector('[data-native-tab-preview]')) front.appendChild(nav);
      const inner = getPrimaryScroller(host);
      if (inner) inner.scrollTop = scrollY;
      else host.style.transform = `translateY(${-scrollY}px)`;
      host.querySelectorAll<HTMLElement>('[data-snapshot-scroll]').forEach(el => {
        const [left, top] = el.dataset.snapshotScroll!.split(',').map(Number);
        el.scrollLeft = left; el.scrollTop = top;
      });
      host.querySelectorAll<HTMLElement>('[data-snapshot-viewport-y]').forEach(el => {
        const delta = Number(el.dataset.snapshotViewportY) - el.getBoundingClientRect().top;
        if (Math.abs(delta) > .5) el.style.translate = `0 ${delta}px`;
      });
      front.style.visibility = 'visible';
      page.style.opacity = '0';
      wakeGlassButtons();
    };

    const paintReveal = (x: number) => {
      const s = g.current;
      if (!s.revealActive || !s.destWrap || !s.scrim) return;
      const w = s.w || 1;
      const p = Math.max(0, Math.min(1, x / w));
      s.destWrap.style.transform = backReveal(p, w, s.direction);
      s.scrim.style.opacity = String(SCRIM_MAX * (1 - p));
    };

    const flush = () => {
      g.current.raf = 0;
      const x = g.current.x;
      front.style.transform = x === 0 ? '' : backTranslation(x, g.current.direction);
      paintShadow(x);
      paintReveal(x);
      wakeGlassButtons();
    };
    const schedule = (x: number) => {
      g.current.x = x;
      if (!g.current.raf) g.current.raf = requestAnimationFrame(flush);
    };

    // ── Prepared reveal ─────────────────────────────────────────────────
    // The destination snapshot is attached (hidden) right after each
    // navigation, during idle time: the attach + style + layout + scroll
    // replay all happen while nothing is moving. Claiming a gesture then
    // only flips visibility — that's the difference between a hitch on the
    // first drag frame and none.

    const teardownPrep = () => {
      const s = g.current;
      reveal.textContent = ''; // detaches the snapshot node (store keeps the ref)
      s.prepKey = null; s.prepWrap = null; s.prepScrim = null; s.prepScrollY = 0;
    };

    const buildPrep = () => {
      const s = g.current;
      if (s.revealActive || s.finalizing) return; // never clobber a live reveal
      if (!root.isConnected) return;
      teardownPrep();
      const key = revealKeyRef.current;
      if (!enabledRef.current || key == null) return;
      const snap = snapStore.get(key);
      if (!snap) return;
      const w = width();
      const destWrap = document.createElement('div');
      destWrap.style.cssText = 'position:absolute;inset:0;background:var(--color-surface);';
      const host = snap.node;
      host.style.position = 'absolute';
      host.style.top = '0'; host.style.left = '0'; host.style.right = '0';
      host.style.transform = '';
      destWrap.appendChild(host);
      // The destination's tab bar is part of its preview — but only when the
      // current page doesn't show the real (identical, fixed, z-50) one on
      // top; then the live bar covers seamlessly and a parallaxing copy
      // underneath would just be wasted paint.
      if (snap.nav && (snap.nav.querySelector('[data-native-tab-preview]') || !document.querySelector('[data-bottom-nav]'))) destWrap.appendChild(snap.nav);
      const scrim = document.createElement('div');
      scrim.style.cssText = `position:absolute;inset:0;background:#000;opacity:${SCRIM_MAX};pointer-events:none;`;
      destWrap.style.transform = `translateX(${-PARALLAX * w}px)`;
      reveal.appendChild(destWrap);
      reveal.appendChild(scrim);
      // Replay the destination's scroll onto the clone so the reveal matches
      // where the page was left: an inner scroller gets its scrollTop; a
      // window-scrolled page gets a translateY on the clone.
      if (snap.scrollY > 0) {
        const inner = getPrimaryScroller(host);
        if (inner) inner.scrollTop = snap.scrollY;
        else host.style.transform = `translateY(${-snap.scrollY}px)`;
      }
      host.querySelectorAll<HTMLElement>('[data-snapshot-scroll]').forEach(el => {
        const [left, top] = el.dataset.snapshotScroll!.split(',').map(Number);
        el.scrollLeft = left; el.scrollTop = top;
      });
      // A window-scrolled snapshot translates its content, but pinned chrome
      // must stay at the same viewport position. Replay ancestors first so
      // nested fixed controls are not compensated twice.
      host.querySelectorAll<HTMLElement>('[data-snapshot-viewport-y]').forEach(el => {
        const delta = Number(el.dataset.snapshotViewportY) - el.getBoundingClientRect().top;
        if (Math.abs(delta) > .5) el.style.translate = `0 ${delta}px`;
      });
      s.prepKey = key; s.prepWrap = destWrap; s.prepScrim = scrim; s.prepScrollY = snap.scrollY;
    };

    const scheduleRebuild = () => {
      const s = g.current;
      if (s.rebuildTimer) clearTimeout(s.rebuildTimer);
      // Wait out the route transition, then build when the thread is idle.
      s.rebuildTimer = window.setTimeout(() => {
        s.rebuildTimer = 0;
        const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
        if (w.requestIdleCallback) w.requestIdleCallback(() => buildPrep(), { timeout: 400 });
        else setTimeout(buildPrep, 50); // WKWebView has no requestIdleCallback
      }, 350);
    };
    rebuildRef.current = scheduleRebuild;

    const showReveal = () => {
      const s = g.current;
      // Reduced motion: skip the live parallax/scrim entirely, keep a plain slide.
      if (s.reduce) { s.revealActive = false; return; }
      const key = revealKeyRef.current;
      if (key == null) { s.revealActive = false; return; }
      if (s.prepKey !== key || !s.prepWrap) buildPrep(); // gesture beat the idle build
      if (s.prepKey !== key || !s.prepWrap) { s.revealActive = false; return; } // no snapshot — plain surface
      s.destWrap = s.prepWrap; s.scrim = s.prepScrim; s.destScrollY = s.prepScrollY;
      s.revealActive = true;
      s.destWrap.style.willChange = 'transform';
      paintReveal(s.x);
      reveal.style.visibility = 'visible';
      reveal.style.opacity = '1';
      // Warm the native preview before the first settle frame; don't wait for
      // the router to commit at the far end of the gesture.
      void flushGlassButtons();
    };

    const hideReveal = () => {
      const s = g.current;
      reveal.style.visibility = 'hidden';
      reveal.style.opacity = '0';
      reveal.style.zIndex = '';
      delete reveal.dataset.glassHandoff;
      if (s.destWrap) s.destWrap.style.willChange = '';
      s.revealActive = false; s.destWrap = null; s.scrim = null;
    };

    // ── Gesture plumbing ────────────────────────────────────────────────

    const bindMove = () => {
      if (g.current.moveBound) return;
      g.current.moveBound = true;
      root.addEventListener('touchmove', move, { passive: false });
    };
    const unbindMove = () => {
      if (!g.current.moveBound) return;
      g.current.moveBound = false;
      root.removeEventListener('touchmove', move);
    };
    const stopTracking = () => {
      const s = g.current;
      s.tracking = false; s.deferEl = null;
      unbindMove();
    };

    /** Run `body` exactly once when the settle finishes/cancels/times out. */
    const onSettleOnce = (anim: Animation, ms: number, body: () => void) => {
      let done = false;
      let timer = 0;
      const run = () => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        anim.onfinish = null; anim.oncancel = null;
        body();
      };
      anim.onfinish = run; anim.oncancel = run;
      // Safety net: if the compositor stalls (tab backgrounded mid-settle) the
      // WAAPI finish event may never fire — force completion so we never get
      // stuck with the page parked off-screen.
      timer = window.setTimeout(run, ms + 80);
      return () => { done = true; if (timer) clearTimeout(timer); anim.onfinish = null; anim.oncancel = null; };
    };

    // ── Commit finalize ─────────────────────────────────────────────────
    // The page is parked off-screen over the destination snapshot while the
    // real navigation runs. We hand control back only when the destination is
    // *verifiably* in and at rest — the route-stack wrapper untransformed (or
    // unmounted, for keep-alive destinations) after the location actually
    // changed — instead of trusting a fixed frame count. A timeout guarantees
    // we always complete.

    const finishCommit = async () => {
      const s = g.current;
      if (!s.finalizing || s.handoff) return;
      const handoff = new AbortController();
      s.handoff = handoff;
      if (s.finalizeTimer) { clearTimeout(s.finalizeTimer); s.finalizeTimer = 0; }
      // Land the destination at the right scroll before it covers the snapshot,
      // so there's no jump-to-top flash on commit. Only REMOUNTING stack pages
      // need this; keep-alive destinations keep their inner scrollers live and
      // get their window offset from ScrollRestoration's keep-alive POP branch
      // — writing here would clobber that restore (capture and restore can
      // resolve different scrollers). A navigate-to-parent is a fresh "up"
      // view — it starts at the top.
      const destKeepAlive = isKeepAlivePath(window.location.pathname);
      if (!s.finIsPop) setPageScroll(0);
      else if (s.finHadSnap && !destKeepAlive) setPageScroll(s.finScrollY);
      if (s.finHadSnap) {
        await handoffBackPreview({ page, preview: reveal, syncNative: flushGlassButtons, signal: handoff.signal, reduced: s.reduce });
      } else {
        page.style.opacity = '';
        void flushGlassButtons();
      }
      if (handoff.signal.aborted || !root.isConnected) return;
      s.handoff = null;
      s.finalizing = false;
      page.style.pointerEvents = '';
      hideFront();
      hideReveal();
      wakeGlassButtons();
      if (s.glassHeld) { s.glassHeld = false; releaseGlass(); }
      if (s.finKey != null) snapStore.delete(s.finKey);
      s.x = 0;
      s.settleMode = 'none';
      s.busy = false;
      // Unlock on the next frame so the destination's first real render is
      // still covered by the instant-transition lock.
      requestAnimationFrame(() => onLockRef.current(false));

      scheduleRebuild();
    };

    const beginCommit = (w: number) => {
      const s = g.current;
      // Keep the page off-screen (the snapshot underneath shows the
      // destination) while the real route swaps in, then drop the now-real
      // page to 0 and remove the snapshot.
      front.style.transform = backTranslation(w, s.direction);
      paintShadow(w);
      // At this point the front and its shadow are fully outside the screen.
      // Retire their native preview controls now, not after the handoff fade.
      front.style.visibility = 'hidden';
      wakeGlassButtons();
      s.finalizing = true;
      s.finFromLocKey = locationKeyRef.current;
      s.finKey = revealKeyRef.current;
      s.finHadSnap = s.revealActive;
      s.finScrollY = s.destScrollY;
      s.finIsPop = backIsPopRef.current;
      (s.commitBack || onBackRef.current)();
      s.commitBack = null;
      const started = performance.now();
      let settledFrames = 0;
      const tick = () => {
        if (!s.finalizing) return;
        let ready = false;
        if (locationKeyRef.current !== s.finFromLocKey) {
          const destPath = window.location.pathname;
          const stackEl = page.querySelector<HTMLElement>(`[data-route-entry="${CSS.escape(locationKeyRef.current)}"]`);
          if (isKeepAlivePath(destPath)) {
            // Keep-alive destinations live outside the stack — ready once the
            // exiting stack page is fully gone.
            ready = !(Array.from(page.querySelectorAll('[data-route-stack]')) as HTMLElement[]).some(el => !el.closest('[inert]'));
          } else {
            // Stack destinations must be MOUNTED and at rest. The wrapper has
            // to carry the destination's own pathname: mode="wait" leaves an
            // empty-stack gap between the old page's exit and the new page's
            // enter, and the exiting wrapper itself can sit at x≈0 for a
            // frame — neither may count as done, or the snapshot drops early
            // and the enter slide plays in plain sight.
            ready = !!stackEl
              && stackEl.getAttribute('data-route-stack') === destPath
              && Math.abs(txOf(stackEl)) < 1
              && Number(getComputedStyle(stackEl).opacity || 1) >= .99;
            if (ready && stackEl) {
              const transform = getComputedStyle(stackEl).transform;
              if (transform && transform !== 'none') {
                const matrix = new DOMMatrixReadOnly(transform);
                ready = Math.abs(matrix.m42) < 1 && Math.abs(matrix.m11 - 1) < .01 && Math.abs(matrix.m22 - 1) < .01;
              }
            }
          }
        }
        settledFrames = ready ? settledFrames + 1 : 0;
        if (settledFrames >= 2 || performance.now() - started > FINALIZE_TIMEOUT_MS) { finishCommit(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      s.finalizeTimer = window.setTimeout(finishCommit, FINALIZE_TIMEOUT_MS + 100);
    };

    // ── Settle ──────────────────────────────────────────────────────────

    const settle = (toX: number, commit: boolean) => {
      const s = g.current;
      // Local steps and unsaved-work handlers have the same precedence as Back.
      if (commit && !allowBackNavigation()) { commit = false; toX = 0; }
      const w = s.w || width();
      if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; }
      s.busy = true;
      s.settleMode = commit ? 'commit' : 'cancel';
      if (commit) {
        // Lock route transitions to instant NOW — React gets the whole settle
        // to re-render with the lock before navigate() fires, so the exiting
        // page can never replay the slide the gesture already performed.
        onLockRef.current(true);
        // And nothing on a committed page should still take taps.
        page.style.pointerEvents = 'none';
      }
      // Duration tracks the remaining distance and the release velocity — a
      // hard flick lands fast, a gentle release glides.
      const remaining = Math.abs(toX - s.x);
      const v = Math.abs(s.vx);
      const dur = s.reduce ? 1 : Math.round(Math.min(MAX_SETTLE_MS, Math.max(
        MIN_SETTLE_MS,
        v > 0.15 ? remaining / v : MAX_SETTLE_MS * (0.35 + 0.65 * (remaining / w)),
      )));
      const anims: Animation[] = [];
      anims.push(front.animate(
        [{ transform: backTranslation(s.x, s.direction) }, { transform: backTranslation(toX, s.direction) }],
        { duration: dur, easing: EASE, fill: 'both' },
      ));
      if (!s.reduce) anims.push(shadow.animate(backShadowFrames(s.x, toX, w, s.direction),
        { duration: dur, easing: EASE, fill: 'both' }));
      if (s.revealActive && s.destWrap && s.scrim) {
        const pFrom = Math.max(0, Math.min(1, s.x / w));
        const pTo = commit ? 1 : 0;
        anims.push(s.destWrap.animate(
          [{ transform: backReveal(pFrom, w, s.direction) }, { transform: backReveal(pTo, w, s.direction) }],
          { duration: dur, easing: EASE, fill: 'both' },
        ));
        anims.push(s.scrim.animate(
          [{ opacity: SCRIM_MAX * (1 - pFrom) }, { opacity: SCRIM_MAX * (1 - pTo) }],
          { duration: dur, easing: EASE, fill: 'both' },
        ));
      }
      s.anims = anims;
      s.disarmSettle = onSettleOnce(anims[0], dur, () => {
        s.disarmSettle = null;
        // Pin the reveal at this settle's end state BEFORE cancelling:
        // cancelling a fill:both animation reverts to inline styles, and
        // those still hold the last drag frame (parallax offset + darkened
        // scrim). On a commit that would visibly knock the destination
        // preview left and re-tint it for the whole finalize.
        if (s.revealActive && s.destWrap && s.scrim) {
          const pEnd = commit ? 1 : 0;
          s.destWrap.style.transform = backReveal(pEnd, w, s.direction);
          s.scrim.style.opacity = String(SCRIM_MAX * (1 - pEnd));
        }
        front.style.transform = backTranslation(toX, s.direction);
        paintShadow(toX);
        // Cancelling releases the WAAPI style overrides; the inline styles
        // above take over in the same task — no repaint in between.
        for (const a of s.anims) a.cancel();
        s.anims = [];
        if (commit) {
          beginCommit(w);
        } else {
          hideReveal();
          hideFront();
          if (s.glassHeld) { s.glassHeld = false; releaseGlass(); }
          s.x = 0;
          s.settleMode = 'none';
          s.busy = false;
        }
      });
    };

    /** Re-grab the page mid-cancel-settle (iOS lets you catch the bounce). */
    const grab = (t: Touch, now: number) => {
      const s = g.current;
      s.disarmSettle?.(); s.disarmSettle = null;
      const matrix = new DOMMatrixReadOnly(getComputedStyle(front).transform === 'none' ? undefined : getComputedStyle(front).transform);
      const cur = backCoordinate(matrix.m41, matrix.m42, s.direction);
      for (const a of s.anims) a.cancel();
      s.anims = [];
      s.busy = false;
      s.settleMode = 'none';
      s.x = cur;
      front.style.transform = backTranslation(cur, s.direction);
      paintShadow(cur);
      paintReveal(cur);
      s.tracking = true; s.claimed = true;
      if (!s.glassHeld) { s.glassHeld = true; holdGlass(); }
      s.sx = coordinate(t); s.sy = s.direction === 'down' ? t.clientX : t.clientY;
      s.claimDx = -cur; // continue the drag from where we caught it
      s.lx = coordinate(t); s.lt = now; s.vx = 0;
      s.w = s.w || width();
      s.reduce = prefersReducedMotion();
      bindMove();
    };

    // ── Touch handlers ──────────────────────────────────────────────────

    const start = (e: TouchEvent) => {
      const s = g.current;
      if (e.touches.length !== 1) { if (s.tracking && !s.claimed) stopTracking(); return; }
      const t = e.touches[0];
      if (s.busy) {
        // A commit is past the point of no return; a cancel bounce is catchable.
        if (s.settleMode === 'cancel' && s.anims.length) grab(t, e.timeStamp || Date.now());
        return;
      }
      if (!enabledRef.current || isOverlayOpen()) return;
      const target = e.target instanceof Element ? e.target : null;
      s.direction = directionRef.current;
      const fromEdge = s.direction === 'left' ? t.clientX >= (root.clientWidth || window.innerWidth) - EDGE : t.clientX <= EDGE;
      if (target?.closest('dialog, input, textarea, select, [contenteditable="true"], [role="slider"], [data-swipe-back="off"], [data-sheet-panel], [role="dialog"]')) return;
      if (s.direction === 'down' && !atVerticalStart(target, root)) return;
      if (!fromEdge && (edgeOnlyRef.current || target?.closest('[data-horizontal-gesture], [data-card-swipe], .mapboxgl-map, video, canvas, [draggable=true]') || findHScrollable(e.target, root))) return;
      if (Array.from<HTMLElement>(page.querySelectorAll<HTMLElement>('[data-route-stack]')).some(el => !el.closest('[inert], [aria-hidden="true"]') && Math.abs(txOf(el)) > 2)) return;
      s.commitBack = onBackRef.current;
      s.tracking = true; s.claimed = false;
      s.sx = coordinate(t); s.sy = s.direction === 'down' ? t.clientX : t.clientY; s.lx = coordinate(t); s.lt = e.timeStamp || Date.now();
      s.vx = 0; s.claimDx = 0; s.w = width();
      s.fromEdge = fromEdge;
      s.reduce = prefersReducedMotion();
      s.deferEl = findHScrollable(e.target, root);
      // An edge touch is very likely a back-swipe: promote the page to its
      // own layer while the finger is still, so the first drag frame doesn't
      // pay for it. Mid-screen touches are usually scrolls/taps — for those
      // the promotion happens at claim time instead.
      if (s.fromEdge) front.style.willChange = 'transform';
      bindMove();
    };

    const move = (e: TouchEvent) => {
      const s = g.current;
      if (!s.tracking || s.busy) return;
      if (e.touches.length !== 1) { cancelGesture(); return; }
      const t = e.touches[0];
      const dx = coordinate(t) - s.sx;
      const dy = (s.direction === 'down' ? t.clientX : t.clientY) - s.sy;

      if (!s.claimed) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        const horizontalRight = dx > 0 && Math.abs(dy) <= dx * ANGLE_TAN;
        if (!horizontalRight || (!s.fromEdge && s.deferEl && s.deferEl.scrollLeft > 0)) {
          // Not ours — unbind immediately so the rest of this scroll runs
          // natively, untouched by a non-passive listener.
          stopTracking();
          front.style.willChange = '';
          return;
        }
        s.claimed = true;
        // Keep native geometry tracking live until this gesture settles.
        if (!s.glassHeld) { s.glassHeld = true; holdGlass(); }
        s.claimDx = dx;
        showFront();
        front.style.willChange = 'transform';
        paintShadow(s.x);
        showReveal();
      }

      if (e.cancelable) e.preventDefault();
      const now = e.timeStamp || Date.now();
      const dt = now - s.lt;
      if (dt > 0) {
        // Low-pass the velocity — raw two-sample deltas are too noisy to
        // decide flick-commit vs flick-cancel reliably.
        const inst = (coordinate(t) - s.lx) / dt;
        s.vx = s.vx === 0 ? inst : s.vx * 0.6 + inst * 0.4;
      }
      s.lx = coordinate(t); s.lt = now;
      schedule(Math.max(0, Math.min(s.w, dx - s.claimDx)));
    };

    const end = (event: TouchEvent) => {
      const s = g.current;
      const wasClaimed = s.claimed;
      s.claimed = false;
      stopTracking();
      if (!wasClaimed) {
        if (!s.busy) front.style.willChange = '';
        return;
      }
      suppressClickUntil.current = performance.now() + 600;
      // A held finger is no longer a flick. Old velocity used to commit even
      // after a deliberate pause or cancelled intention.
      if ((event.timeStamp || Date.now()) - s.lt > 100) s.vx = 0;
      const flickBack = s.vx > FLICK_VELOCITY;
      const flickForward = s.vx < CANCEL_VELOCITY;
      const distanceReached = s.x > (s.direction === 'down' ? Math.min(120, s.w * .2) : s.w * COMMIT_RATIO);
      const commit = flickBack || (!flickForward && distanceReached);
      settle(commit ? s.w : 0, commit);
    };

    const cancelGesture = () => {
      const s = g.current;
      if (s.claimed) {
        s.claimed = false;
        stopTracking();
        settle(0, false);
      } else {
        stopTracking();
        if (!s.busy) front.style.willChange = '';
      }
    };

    // Cancel cleanly when the app is backgrounded mid-gesture.
    const requestBack = (event: Event) => {
      if (!enabledRef.current || isOverlayOpen()) return;
      if (prefersReducedMotion()) return;
      if (revealKeyRef.current == null || !snapStore.has(revealKeyRef.current)) return;
      event.preventDefault();
      if (g.current.busy || g.current.tracking) return;
      const s = g.current;
      s.direction = directionRef.current;
      s.w = width(); s.x = 0; s.vx = 0; s.reduce = prefersReducedMotion();
      s.commitBack = (event as CustomEvent<{ perform: () => void }>).detail.perform;
      if (!s.glassHeld) { s.glassHeld = true; holdGlass(); }
      showFront();
      showReveal();
      paintShadow(s.x);
      front.style.willChange = 'transform';
      settle(s.w, true);
    };
    window.addEventListener('app:request-back', requestBack);

    // The source preview stays at its exact scroll position while the new
    // route pushes over it. Live exiting DOM would jump when window scroll
    // resets for the destination.
    let pushAnims: Animation[] = [];
    let pushTimer = 0;
    const clearPush = () => {
      clearTimeout(pushTimer);
      pushAnims.forEach(animation => animation.cancel()); pushAnims = [];
      if (!g.current.claimed && !g.current.busy) hideReveal();
    };
    resetNavigationRef.current = () => {
      const s = g.current;
      // Our own committed pop is finalized only after its destination mounts.
      if (s.finalizing) return;
      clearPush();
      s.disarmSettle?.(); s.disarmSettle = null;
      s.anims.forEach(animation => animation.cancel()); s.anims = [];
      stopTracking();
      if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; }
      s.claimed = false; s.busy = false; s.commitBack = null; s.x = 0;
      page.style.pointerEvents = '';
      shadow.style.opacity = '0'; hideReveal(); hideFront();
      if (s.glassHeld) { s.glassHeld = false; releaseGlass(); }
      if (s.settleMode === 'commit') onLockRef.current(false);
      s.settleMode = 'none';
    };
    pushPreviewRef.current = () => {
      clearPush();
      g.current.reduce = prefersReducedMotion();
      if (g.current.reduce) return;
      g.current.direction = 'right';
      buildPrep(); showReveal();
      const s = g.current;
      if (!s.destWrap || !s.scrim) return;
      const options = { duration: 360, easing: EASE, fill: 'both' as const };
      pushAnims = [
        s.destWrap.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-width() * PARALLAX}px)` }], options),
        s.scrim.animate([{ opacity: 0 }, { opacity: SCRIM_MAX }], options),
      ];
      pushTimer = window.setTimeout(() => { clearPush(); scheduleRebuild(); }, 390);
    };
    const onVisibility = () => { if (document.hidden && g.current.claimed) cancelGesture(); };

    root.addEventListener('touchstart', start, { passive: true });
    root.addEventListener('touchend', end, { passive: true });
    root.addEventListener('touchcancel', cancelGesture, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    scheduleRebuild();
    return () => {
      const s = g.current;
      s.handoff?.abort(); s.handoff = null;
      clearPush();
      window.removeEventListener('app:request-back', requestBack);
      root.removeEventListener('touchstart', start);
      root.removeEventListener('touchend', end);
      root.removeEventListener('touchcancel', cancelGesture);
      document.removeEventListener('visibilitychange', onVisibility);
      unbindMove();
      if (s.glassHeld) { s.glassHeld = false; releaseGlass(); }
      if (s.raf) cancelAnimationFrame(s.raf);
      if (s.rebuildTimer) clearTimeout(s.rebuildTimer);
      if (s.finalizeTimer) clearTimeout(s.finalizeTimer);
      s.disarmSettle?.();
      for (const a of s.anims) a.cancel();
      // Never leave the app with instant transitions locked on.
      if (s.finalizing || s.settleMode === 'commit') onLockRef.current(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    resetNavigationRef.current();
    if (previewPush) pushPreviewRef.current();
  }, [locationKey]);

  // Rebuild the prepared reveal whenever the back target changes.
  useEffect(() => { rebuildRef.current(); }, [navKey, enabled, revealSnapshotKey]);

  return (
    <div ref={rootRef} data-back-gesture={enabled ? direction : undefined} onClickCapture={e => { if (performance.now() < suppressClickUntil.current) { e.preventDefault(); e.stopPropagation(); } }} style={{ position: 'relative', minHeight: '100dvh', background: 'var(--color-surface)' }}>
      <LeaveSnapshot navKey={navKey} snapshotable={snapshotable} getNode={() => pageRef.current} />
      {/* Destination snapshot lives here, behind the page. Prebuilt (hidden)
          at idle after each navigation; shown the moment a back-swipe claims. */}
      {/* data-swipe-reveal: the clone inside keeps live layout (it's only
          visibility-hidden), so scroll helpers must know to skip it — see
          page-scroll.ts / ScrollRestoration. */}
      <div
        ref={revealRef}
        aria-hidden="true"
        inert
        data-swipe-reveal=""
        style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', visibility: 'hidden', opacity: 0, background: 'var(--color-surface)', contain: 'layout paint', pointerEvents: 'none' }}
      />
      {/* A separate clipped compositor layer lets the edge shadow fade with
          progress, without fading page content or animating a painted blur. */}
      <div aria-hidden="true" inert style={{ position: 'fixed', inset: 0, zIndex: 20, overflow: 'hidden', contain: 'layout paint', pointerEvents: 'none' }}>
        <div ref={shadowRef} data-swipe-shadow="" style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />
      </div>
      <div ref={frontRef} data-swipe-front="" aria-hidden="true" inert
        style={{ position: 'fixed', inset: 0, zIndex: 20, visibility: 'hidden', overflow: 'hidden', background: 'var(--color-surface)', pointerEvents: 'none', contain: 'layout paint' }} />
      {/* No z-index here: it would create a stacking context that traps
          in-page bottom sheets (z-[110]) below the bottom nav (z-50). The page
          still paints above the reveal by DOM order (it comes after it), and
          the transform during a drag promotes it for that moment anyway. */}
      <div ref={pageRef} data-swipe-page="" style={{ position: 'relative', minHeight: '100dvh' }}>
        {children}
      </div>
    </div>
  );
};
