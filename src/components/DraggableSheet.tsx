/**
 * DraggableSheet — the mobile composer's bottom sheet.
 *
 * Overlay-positioned (absolute, pinned to the bottom of a `relative`
 * parent) so dragging never reflows the canvas behind it. The drag
 * writes the height straight to the DOM — no React render per move —
 * so the sheet tracks the finger 1:1. Releasing carries the flick's
 * momentum and can settle *anywhere* between the peek floor and the
 * full detent; only landings close to a detent get magnetically
 * snapped onto it.
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
/** Landing within this many px of a detent snaps onto it. */
const MAGNET = 56;
/** Momentum: projected extra travel = release velocity (px/ms) × this. */
const MOMENTUM = 190;
/** A flick faster than this (px/ms) goes all the way in its direction. */
const FLICK_VELOCITY = 1.1;
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
  const visRef = useRef(height);
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
    pointerId: number;
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

  /** Write the height straight to the DOM (no render). */
  const applyH = (px: number, animate: boolean) => {
    const el = elRef.current;
    if (!el) return;
    visRef.current = px;
    el.style.transition = animate ? `height ${SETTLE_MS}ms ${EASE}` : 'none';
    el.style.height = `${Math.round(px)}px`;
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
  // re-renders because React never sees `height` in the JSX style object.
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
        // Re-report the reserve — the rest detent may have moved.
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

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canDrag) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startH: visRef.current,
      lastY: e.clientY,
      lastT: performance.now(),
      velocity: 0,
    };
    draggingRef.current = true;
    if (elRef.current) elRef.current.style.transition = 'none';
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    d.velocity = (d.lastY - e.clientY) / dt;
    d.lastY = e.clientY;
    d.lastT = now;
    const { min, max } = detents();
    pendingHRef.current = Math.max(min, Math.min(max, d.startH + (d.startY - e.clientY)));
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (pendingHRef.current !== null && draggingRef.current) {
          applyH(pendingHRef.current, false);
        }
      });
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
    draggingRef.current = false;
    userMovedRef.current = true;
    const { min, rest, max } = detents();
    let target: number;
    if (Math.abs(d.velocity) > FLICK_VELOCITY) {
      // Committed flick — all the way in its direction.
      target = d.velocity > 0 ? max : min;
    } else {
      // Carry the momentum, then settle wherever it lands…
      target = visRef.current + d.velocity * MOMENTUM;
      // …unless a detent is close enough to catch it.
      for (const det of [min, rest, max]) {
        if (Math.abs(target - det) <= MAGNET) {
          target = det;
          break;
        }
      }
    }
    settle(target);
  };

  return (
    <div
      ref={elRef}
      className={cn(
        'absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-3xl',
        className,
      )}
      style={{ willChange: 'height' }}
    >
      {/* Grab-handle strip — full-width touch target for the drag. */}
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
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label={canDrag ? 'Drag to resize' : undefined}
      >
        <div className={cn('w-9 h-1 rounded-full', canDrag ? 'bg-on-surface/25' : 'bg-on-surface/15')} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div ref={contentRef}>
          {children}
        </div>
      </div>
    </div>
  );
};
