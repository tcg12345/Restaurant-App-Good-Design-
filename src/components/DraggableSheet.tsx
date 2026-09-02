/**
 * DraggableSheet — the mobile composer's bottom sheet.
 *
 * Overlay-positioned (absolute, pinned to the bottom of a `relative`
 * parent) so dragging never reflows the canvas behind it.
 *
 * **The box is always as tall as its tallest detent; the drag moves it
 * with a transform.** It used to animate `height`, which re-laid-out the
 * whole sheet — a camera roll of a few hundred thumbnails — on every
 * frame of the gesture, and that is what made it stutter. A transform
 * touches no layout, so the sheet tracks the finger exactly. What hangs
 * below the parent's bottom edge while the sheet is down is clipped by
 * the host's own `overflow-hidden`.
 *
 * **Drag from anywhere, not just the pill.** The platform rule, the same
 * one the search page's map sheet follows: with the content at its top,
 * dragging DOWN anywhere moves the sheet; dragging UP while the sheet is
 * below its full detent raises the sheet before the content scrolls.
 * Decided once per gesture, after ~6px, and only for gestures that are
 * more vertical than horizontal — so the selected-media strip keeps its
 * own sideways scroll.
 *
 * Releasing projects the position forward by the release velocity and
 * snaps to whichever detent is nearest the projection: one rule that
 * makes a short flick travel a whole detent and a slow drag stay where
 * it was let go.
 *
 * `fit` mode hugs the content: the resting height follows the measured
 * content (never taller), so short steps show no blank band at the
 * bottom — and because the measurement is live, content that pads
 * itself by --kb-height grows the sheet above the keyboard.
 *
 * Hosts reserve canvas space behind the sheet via `onReserveChange`:
 * it reports min(settled height, resting height) — raising the sheet
 * covers the canvas (reserve unchanged), lowering it hands the canvas
 * the extra room.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';

export type SheetPos = 'peek' | 'default' | 'free' | 'full';

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'; // iOS sheet curve
const SETTLE_MS = 400;
/** Release velocity (px/ms) is projected this far ahead to pick a detent. */
const PROJECTION_MS = 220;
/** Travel before a gesture has declared itself the sheet's or the list's. */
const DECIDE_PX = 6;
/** Resistance past the bottom stop — the platform's rubber band. */
const RUBBER = 0.25;
/** Smallest resting height fit mode will hug down to. */
const FIT_FLOOR = 140;

export const DraggableSheet: React.FC<{
  /** Resting (default detent) height in px. Ignored while `fit` has a
   *  content measurement — the content decides instead. */
  height: number;
  /** How far down the sheet can be pulled (peek floor). */
  minHeight?: number;
  /** Full-screen detent in px. */
  maxHeight?: number;
  draggable?: boolean;
  /** Hug the content: resting height = measured content height
   *  (clamped to maxHeight), and the sheet can't be raised past it. */
  fit?: boolean;
  /** When this changes (e.g. the step), the sheet returns to the
   *  default detent. */
  resetKey?: string | number;
  className?: string;
  /** Notified when the sheet settles. */
  onSnap?: (pos: SheetPos) => void;
  /** Reports the px the host should keep clear behind the sheet:
   *  min(settled height, resting height). */
  onReserveChange?: (px: number) => void;
  /** When the full detent reaches the very top of the screen, pad the
   *  grab handle by the iOS safe-area inset while fully expanded so it
   *  clears the notch/status bar (animates in with the snap). */
  safeTopAtFull?: boolean;
  children: React.ReactNode;
}> = ({
  height,
  minHeight,
  maxHeight,
  draggable = false,
  fit = false,
  resetKey,
  className,
  onSnap,
  onReserveChange,
  safeTopAtFull = false,
  children,
}) => {
  const elRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const visRef = useRef(height);
  /** Last height written to the box, so a drag frame doesn't touch it. */
  const boxHRef = useRef<number | null>(null);
  /** Measured content + handle height; null until the first measure. */
  const fitHRef = useRef<number | null>(null);
  const [pos, setPos] = useState<SheetPos>('default');
  const posRef = useRef<SheetPos>('default');
  /** Has the user positioned the sheet since the last reset? Until they
   *  have, geometry changes always re-follow the rest detent. */
  const userMovedRef = useRef(false);
  const draggingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const pendingHRef = useRef<number | null>(null);
  const dragRef = useRef<{
    startY: number;
    startH: number;
    lastY: number;
    lastT: number;
    velocity: number; // px/ms, positive = expanding
  } | null>(null);

  // Latest callbacks/props via refs so the geometry helpers and the
  // measurement effect never go stale.
  const propsRef = useRef({ height, minHeight, maxHeight, fit });
  propsRef.current = { height, minHeight, maxHeight, fit };
  const onSnapRef = useRef(onSnap);
  onSnapRef.current = onSnap;
  const onReserveRef = useRef(onReserveChange);
  onReserveRef.current = onReserveChange;

  /** Current detents from the latest props + content measurement. */
  const detents = () => {
    const p = propsRef.current;
    const cap = Math.max(p.maxHeight ?? p.height, 120);
    const rest = p.fit && fitHRef.current !== null
      ? Math.round(Math.min(Math.max(fitHRef.current, FIT_FLOOR), cap))
      : Math.min(p.height, cap);
    // In fit mode there's nothing past the content — the hug IS the top.
    const max = p.fit && fitHRef.current !== null ? rest : Math.max(rest, cap);
    const min = Math.min(p.minHeight ?? 88, rest);
    return { min, rest, max };
  };

  const classify = (px: number): SheetPos => {
    const { min, rest, max } = detents();
    // "Full" is only a real state when there's headroom above the rest
    // detent — a sheet whose max equals its rest is just… resting.
    if (max > rest + 40 && px >= max - 24) return 'full';
    if (Math.abs(px - rest) <= 12) return 'default';
    if (px <= min + 12) return 'peek';
    return 'free';
  };

  /** Show `px` of the sheet. The box stays the height of the tallest
   *  detent and slides; only the transform changes per frame. */
  const applyH = (px: number, animate: boolean) => {
    const el = elRef.current;
    if (!el) return;
    visRef.current = px;
    const max = detents().max;
    const boxH = Math.round(max);
    if (boxHRef.current !== boxH) {
      boxHRef.current = boxH;
      el.style.height = `${boxH}px`;
    }
    el.style.transition = animate ? `transform ${SETTLE_MS}ms ${EASE}` : 'none';
    el.style.transform = `translate3d(0, ${Math.round(max - px)}px, 0)`;
  };

  /** Clamp + apply + report a settled position. */
  const settle = (px: number, animate = true) => {
    const { min, rest, max } = detents();
    const clamped = Math.max(min, Math.min(max, px));
    applyH(clamped, animate);
    const p = classify(clamped);
    if (p !== posRef.current) {
      posRef.current = p;
      setPos(p);
    }
    onSnapRef.current?.(p);
    onReserveRef.current?.(Math.round(Math.min(clamped, rest)));
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;

  // First paint at the resting height. Direct style writes stick across
  // re-renders because React never sees them in the JSX style object.
  useLayoutEffect(() => {
    applyH(visRef.current, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live content measurement — drives fit mode's hug and keeps the
  // sheet from ever exceeding the content (blank band).
  useEffect(() => {
    const content = contentRef.current;
    const handle = handleRef.current;
    if (!content || !handle) return;
    const measure = () => {
      const inner = content.offsetHeight;
      // Step swaps (AnimatePresence mode="wait") briefly leave the body
      // empty — ignore those frames rather than collapsing the sheet.
      if (inner < 40) return;
      const next = inner + handle.offsetHeight;
      const first = fitHRef.current === null;
      if (!first && Math.abs(next - (fitHRef.current as number)) < 2) return;
      fitHRef.current = next;
      if (draggingRef.current) return;
      const { rest, max } = detents();
      if (first || !userMovedRef.current || posRef.current === 'default') {
        settleRef.current(rest, !first);
      } else if (visRef.current > max) {
        settleRef.current(max, true);
      } else {
        // The rest detent moved: re-report the reserve, and re-apply so
        // the transform is measured against the new box height.
        applyH(visRef.current, false);
        onReserveRef.current?.(Math.round(Math.min(visRef.current, rest)));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(content);
    return () => ro.disconnect();
  }, [fit]);

  // Step change → glide back to the (possibly new) default detent.
  const firstResetRef = useRef(true);
  useEffect(() => {
    if (firstResetRef.current) {
      firstResetRef.current = false;
      return;
    }
    userMovedRef.current = false;
    settleRef.current(detents().rest, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Geometry props changed (host measured its box, viewport resized) —
  // follow the rest detent unless the user has parked the sheet
  // somewhere themselves; then just re-clamp their position.
  useEffect(() => {
    if (draggingRef.current) return;
    if (!userMovedRef.current || posRef.current === 'default') {
      settleRef.current(detents().rest, true);
    } else {
      settleRef.current(visRef.current, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, minHeight, maxHeight, fit]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const { min: minDet, max: maxDet } = detents();
  const canDrag = draggable && maxDet - minDet > 40;

  /* ── The drag itself, shared by the pill and the body ─────────────── */

  const beginDrag = (clientY: number) => {
    dragRef.current = {
      startY: clientY,
      startH: visRef.current,
      lastY: clientY,
      lastT: performance.now(),
      velocity: 0,
    };
    draggingRef.current = true;
    if (elRef.current) elRef.current.style.transition = 'none';
  };

  const moveDrag = (clientY: number) => {
    const d = dragRef.current;
    if (!d) return;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    d.velocity = (d.lastY - clientY) / dt;
    d.lastY = clientY;
    d.lastT = now;
    const { min, max } = detents();
    let next = d.startH + (d.startY - clientY);
    // Hard stop at the top — the box is only as tall as `max`, so going
    // past it would lift its bottom edge off the screen. The bottom stop
    // rubber-bands, since there the box just hangs further off-screen.
    if (next > max) next = max;
    else if (next < min) next = min - (min - next) * RUBBER;
    pendingHRef.current = next;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (pendingHRef.current !== null && draggingRef.current) {
          applyH(pendingHRef.current, false);
        }
      });
    }
  };

  const endDrag = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    draggingRef.current = false;
    userMovedRef.current = true;
    const { min, rest, max } = detents();
    // Project the release forward and take the nearest detent. A flick
    // projects past the next one and lands there; a slow drag projects
    // nowhere and stays where the finger left it.
    const projected = visRef.current + d.velocity * PROJECTION_MS;
    let target = rest;
    let best = Infinity;
    for (const det of [min, rest, max]) {
      const dist = Math.abs(det - projected);
      if (dist < best) {
        best = dist;
        target = det;
      }
    }
    settle(target);
  };

  // Pill: the explicit handle. Pointer events, so a mouse gets it too;
  // touch is claimed here rather than by the body listener because the
  // pill is `touch-none`.
  const pointerIdRef = useRef<number | null>(null);
  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canDrag) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointerIdRef.current = e.pointerId;
    beginDrag(e.clientY);
  };
  const onHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    moveDrag(e.clientY);
  };
  const onHandleUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    pointerIdRef.current = null;
    endDrag();
  };

  /* ── Body: the content hands the gesture over ──────────────────────
     Native listeners rather than React's, because taking the gesture
     over means preventDefault on touchmove and React registers that
     listener passively. The freshest drag functions come through a ref
     so a re-render mid-gesture can't re-base the drag under the finger. */
  const gestureRef = useRef({ begin: beginDrag, move: moveDrag, end: endDrag, canDrag, detents });
  gestureRef.current = { begin: beginDrag, move: moveDrag, end: endDrag, canDrag, detents };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let gesture: 'idle' | 'sheet' | 'scroll' = 'idle';
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { gesture = 'scroll'; return; }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      gesture = 'idle';
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (gesture === 'idle') {
        const dy = t.clientY - startY;
        const dx = t.clientX - startX;
        if (Math.abs(dy) < DECIDE_PX) return;
        // More sideways than vertical — the selected-media strip's own
        // scroll, not a sheet drag.
        if (Math.abs(dx) > Math.abs(dy)) { gesture = 'scroll'; return; }
        const g = gestureRef.current;
        const { max } = g.detents();
        if (!g.canDrag) { gesture = 'scroll'; return; }
        if (dy > 0 && el.scrollTop <= 0) {
          // Pulling down with the content already at its top.
          gesture = 'sheet';
          g.begin(t.clientY);
        } else if (dy < 0 && visRef.current < max - 1) {
          // Pushing up with room left to rise — the sheet goes first.
          gesture = 'sheet';
          g.begin(t.clientY);
        } else {
          gesture = 'scroll';
        }
      }
      if (gesture === 'sheet') {
        e.preventDefault();
        gestureRef.current.move(t.clientY);
      }
    };
    const onEnd = () => {
      if (gesture === 'sheet') gestureRef.current.end();
      gesture = 'idle';
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  // Same hand-over for a mouse (the phone-frame preview on desktop).
  // Touch is excluded: the listener above already owns it, and pointer
  // events fire alongside touch ones.
  const onBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || !canDrag) return;
    const el = scrollRef.current;
    if (!el) return;
    const startY = e.clientY;
    const startX = e.clientX;
    let claimed = false;
    const onMove = (ev: PointerEvent) => {
      if (!claimed) {
        const dy = ev.clientY - startY;
        if (Math.abs(dy) < DECIDE_PX) return;
        if (Math.abs(ev.clientX - startX) > Math.abs(dy)) { cleanup(); return; }
        const canRise = visRef.current < detents().max - 1;
        if (!((dy > 0 && el.scrollTop <= 0) || (dy < 0 && canRise))) { cleanup(); return; }
        claimed = true;
        beginDrag(ev.clientY);
      }
      moveDrag(ev.clientY);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    const onUp = () => {
      if (claimed) endDrag();
      cleanup();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      ref={elRef}
      className={cn(
        'absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-3xl',
        className,
      )}
      style={{ willChange: 'transform' }}
    >
      {/* Grab-handle strip — still the explicit handle, but no longer the
          only way to move the sheet (see the body listener above). */}
      <div
        ref={handleRef}
        className={cn(
          'flex-shrink-0 flex justify-center pb-2 transition-[padding] duration-300',
          canDrag && 'touch-none cursor-grab active:cursor-grabbing',
        )}
        style={{
          paddingTop: safeTopAtFull && pos === 'full'
            ? 'max(0.875rem, env(safe-area-inset-top, 0px))'
            : '0.625rem',
        }}
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
        aria-label={canDrag ? 'Drag to resize' : undefined}
      >
        <div className={cn('w-9 h-1 rounded-full', canDrag ? 'bg-on-surface/25' : 'bg-on-surface/15')} />
      </div>
      <div
        ref={scrollRef}
        onPointerDown={onBodyPointerDown}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
      >
        <div ref={contentRef}>
          {children}
        </div>
      </div>
    </div>
  );
};
