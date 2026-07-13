/**
 * DraggableSheet — the mobile composer's bottom sheet.
 *
 * Sits at a resting height (`height`, animated smoothly when the prop
 * changes between steps) and, when `draggable`, can be pulled up to
 * `maxHeight` (full screen) and back down by the grab-handle area.
 * Releasing snaps to the nearest detent with the sheet's easing curve;
 * a quick flick snaps in the flick's direction regardless of distance.
 */
import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** Flick faster than this (px/ms) snaps in the flick direction. */
const FLICK_VELOCITY = 0.5;

export const DraggableSheet: React.FC<{
  /** Resting (default detent) height in px. */
  height: number;
  /** Full-screen detent in px. Omit (or ≤ height) to disable dragging. */
  maxHeight?: number;
  draggable?: boolean;
  /** When this changes (e.g. the step), the sheet returns to the
   *  default detent. */
  resetKey?: string | number;
  className?: string;
  /** Notified when the sheet settles on a detent. */
  onSnap?: (pos: 'default' | 'full') => void;
  children: React.ReactNode;
}> = ({ height, maxHeight, draggable = false, resetKey, className, onSnap, children }) => {
  const canDrag = draggable && maxHeight != null && maxHeight > height + 40;
  const [h, setH] = useState(height);
  const [dragging, setDragging] = useState(false);
  const posRef = useRef<'default' | 'full'>('default');
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startH: number;
    lastY: number;
    lastT: number;
    velocity: number; // px/ms, positive = expanding
  } | null>(null);

  // Step change → glide back to the (possibly new) default detent.
  useEffect(() => {
    posRef.current = 'default';
    setH(height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Resting-height prop changed (e.g. viewport resize) while at the
  // default detent — follow it.
  useEffect(() => {
    if (!dragging && posRef.current === 'default') setH(height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canDrag) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startH: h,
      lastY: e.clientY,
      lastT: performance.now(),
      velocity: 0,
    };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId || maxHeight == null) return;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    d.velocity = (d.lastY - e.clientY) / dt;
    d.lastY = e.clientY;
    d.lastT = now;
    const next = Math.max(height, Math.min(maxHeight, d.startH + (d.startY - e.clientY)));
    setH(next);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId || maxHeight == null) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
    setDragging(false);
    let full: boolean;
    if (Math.abs(d.velocity) > FLICK_VELOCITY) {
      full = d.velocity > 0;
    } else {
      full = h > (height + maxHeight) / 2;
    }
    posRef.current = full ? 'full' : 'default';
    setH(full ? maxHeight : height);
    onSnap?.(full ? 'full' : 'default');
  };

  return (
    <div
      className={cn(
        'flex-shrink-0 flex flex-col overflow-hidden rounded-t-3xl',
        !dragging && 'transition-[height] duration-[420ms]',
        className,
      )}
      style={{ height: h, transitionTimingFunction: dragging ? undefined : EASE }}
    >
      {/* Grab-handle strip — full-width touch target for the drag. */}
      <div
        className={cn('flex-shrink-0 flex justify-center pt-2.5 pb-1.5', canDrag && 'touch-none cursor-grab active:cursor-grabbing')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label={canDrag ? 'Drag to resize' : undefined}
      >
        <div className={cn('w-9 h-1 rounded-full', canDrag ? 'bg-on-surface/25' : 'bg-on-surface/15')} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {children}
      </div>
    </div>
  );
};
