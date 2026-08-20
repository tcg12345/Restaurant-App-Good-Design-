import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMotionValue, useTransform, type MotionValue } from 'motion/react';

/* ── Scroll-linked header fade ──────────────────────────────────────────────
   The mobile Discover header's signature move, packaged for every page: the
   header's opacity is *scrubbed* to the scroll position — it eases away
   gradually as you scroll down (speed and direction don't matter) and eases
   back in as you return to the top. A slight upward drift sells the motion,
   and pointer-events cut off once it's mostly gone so ghost taps can't land
   on invisible controls.

   Usage (inner scroll container — the common case):

     const fade = useHeaderFade({ enabled: phoneMode });
     <motion.div ref={fade.headerRef} style={fade.headerStyle}>…header…</motion.div>
     <div ref={fade.scrollRef} onScroll={fade.onScroll}>…content…</div>

   Pages that scroll the window instead pass `windowScroll: true` and skip
   scrollRef/onScroll. The fade distance defaults to the header's own height
   (re-measured on resize), so by the time the header's bottom edge would
   have scrolled past, it has fully dissolved — pass `fadeDist` to override.

   `condensedStyle` is the mirror image, for pages that want the header to
   hand off to a compact pinned replacement rather than just disappear:

     <motion.div style={fade.headerStyle}>…the full header…</motion.div>
     <div className="sticky top-0 z-30 h-0">
       <motion.div style={fade.condensedStyle} className="absolute inset-x-0 top-0">
         …the glassy condensed bar…
       </motion.div>
     </div>

   The two are staggered rather than cross-faded 1:1, so they never both
   sit at half opacity looking like a double exposure. */

export interface HeaderFade {
  /** Attach to the header element (any element; motion.* for style). */
  headerRef: (el: HTMLElement | null) => void;
  /** Attach to the inner scroll container (unless windowScroll). */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Attach to the inner scroll container's onScroll (unless windowScroll). */
  onScroll: (e: React.UIEvent<HTMLElement>) => void;
  /** Spread into the header's motion style. */
  headerStyle: {
    opacity: MotionValue<number>;
    y: MotionValue<number>;
    pointerEvents: MotionValue<string>;
  };
  /** Spread into a condensed replacement header's motion style. Arrives
   *  as `headerStyle` leaves, and leaves as it returns. */
  condensedStyle: {
    opacity: MotionValue<number>;
    y: MotionValue<number>;
    pointerEvents: MotionValue<string>;
  };
  /** Measured header height (px). Pages that float the header as an
   *  absolute overlay (flex-column layouts, like Discover home) use this
   *  as the scroll content's paddingTop so nothing hides underneath. */
  headerH: number;
}

export function useHeaderFade({
  enabled = true,
  fadeDist,
  windowScroll = false,
}: {
  /** Off on desktop — the style stays pinned at fully visible. */
  enabled?: boolean;
  /** Scroll offset (px) at which the header is fully gone. Defaults to the
   *  measured header height. */
  fadeDist?: number;
  /** The page scrolls the window/body rather than an inner container. */
  windowScroll?: boolean;
} = {}): HeaderFade {
  const headerEl = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fadeDistRef = useRef(fadeDist ?? 96);
  const [headerH, setHeaderH] = useState(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const explicitDist = fadeDist !== undefined;

  const opacity = useMotionValue(1);
  const y = useMotionValue(0);
  const pointerEvents = useTransform(opacity, (o) => (o > 0.35 ? 'auto' : 'none'));

  // Condensed replacement: nothing until the full header is 65% gone,
  // fully in exactly as it hits zero. The late, decisive hand-off is the
  // point — the two occupy the same strip of screen, so an even
  // cross-fade renders them ghosted over each other for most of the
  // scroll (worst on sticky headers, which never move out of the way).
  // Sharing the one `opacity` value keeps them exactly in step with each
  // other and with `enabled` (off → opacity 1 → condensed 0).
  const condensedOpacity = useTransform(opacity, (o) => Math.min(1, Math.max(0, (0.35 - o) / 0.35)));
  const condensedY = useTransform(condensedOpacity, (v) => -(1 - v) * 8);
  const condensedPointerEvents = useTransform(condensedOpacity, (v) => (v > 0.6 ? 'auto' : 'none'));

  const applyScroll = useCallback(
    (top: number) => {
      if (!enabledRef.current) return;
      const dist = Math.max(40, fadeDistRef.current);
      const o = Math.min(1, Math.max(0, 1 - top / dist));
      opacity.set(o);
      y.set(-(1 - o) * 10);
    },
    [opacity, y],
  );

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLElement>) => applyScroll(e.currentTarget.scrollTop),
    [applyScroll],
  );

  // Measure the header for the default fade distance; re-measure on resize
  // (and via ResizeObserver, so async content — avatars, dynamic titles —
  // growing the header keeps the fade zone honest).
  const headerRef = useCallback(
    (el: HTMLElement | null) => {
      headerEl.current = el;
      if (el) {
        if (!explicitDist) fadeDistRef.current = Math.max(40, el.offsetHeight);
        setHeaderH(el.offsetHeight);
      }
    },
    [explicitDist],
  );
  useEffect(() => {
    if (explicitDist) fadeDistRef.current = fadeDist!;
    const el = headerEl.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (!explicitDist) fadeDistRef.current = Math.max(40, el.offsetHeight);
      setHeaderH(el.offsetHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [explicitDist, fadeDist]);

  // Window-scrolling pages listen globally instead of via onScroll.
  useEffect(() => {
    if (!windowScroll || !enabled) return;
    const handler = () => applyScroll(window.scrollY);
    handler();
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, [windowScroll, enabled, applyScroll]);

  // Toggling off (rotate to desktop, phoneMode flip) restores full opacity.
  useEffect(() => {
    if (!enabled) {
      opacity.set(1);
      y.set(0);
    } else {
      // Re-apply current position on enable so a mid-list mount starts faded.
      const top = windowScroll ? window.scrollY : scrollRef.current?.scrollTop ?? 0;
      applyScroll(top);
    }
  }, [enabled, windowScroll, applyScroll, opacity, y]);

  return {
    headerRef,
    scrollRef,
    onScroll,
    headerStyle: { opacity, y, pointerEvents },
    condensedStyle: { opacity: condensedOpacity, y: condensedY, pointerEvents: condensedPointerEvents },
    headerH,
  };
}
