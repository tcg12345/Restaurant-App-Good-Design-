import { useLayoutEffect, useRef, type PointerEvent, type RefObject } from 'react';
import { animate, useMotionValue, useReducedMotion } from 'motion/react';

/** Handle/header-only dragging keeps native form scrolling and text selection intact. */
export function usePlanSheetMotion(panel: RefObject<HTMLDivElement | null>, enabled: boolean, disabled: boolean, onClose: () => void) {
  const y = useMotionValue(0);
  const backdrop = useMotionValue(enabled ? 0 : 1);
  const reducedMotion = useReducedMotion();
  const latest = useRef({ disabled, onClose }); latest.current = { disabled, onClose };
  const closing = useRef(false);
  const animations = useRef<Array<{ stop: () => void }>>([]);
  const gesture = useRef<{ id: number; start: number; origin: number; last: number; time: number; velocity: number } | null>(null);
  const stop = () => { animations.current.forEach(a => a.stop()); animations.current = []; };
  const travel = () => {
    const element = panel.current;
    if (!element) return window.innerHeight;
    // Include the space below a centered card or a keyboard-raised sheet.
    return window.innerHeight - (element.getBoundingClientRect().top - y.get()) + 32;
  };
  useLayoutEffect(() => {
    if (!enabled) return;
    closing.current = false;
    const mobile = window.matchMedia('(max-width: 540px)').matches;
    y.set(reducedMotion ? 0 : mobile ? travel() : 36);
    backdrop.set(reducedMotion ? 1 : 0);
    if (!reducedMotion) animations.current = [
      animate(y, 0, { duration: mobile ? .44 : .28, ease: [.22, 1, .36, 1] }),
      animate(backdrop, 1, { duration: .28, ease: 'easeOut' }),
    ];
    return () => { stop(); gesture.current = null; };
  }, [enabled, reducedMotion, y, backdrop]);

  function requestClose() {
    if (latest.current.disabled || closing.current) return;
    if (!enabled) { latest.current.onClose(); return; }
    closing.current = true;
    gesture.current = null;
    stop();
    panel.current?.setAttribute('inert', '');
    if (reducedMotion) { latest.current.onClose(); return; }
    animations.current = [
      animate(backdrop, 0, { duration: .22, ease: 'easeOut' }),
      animate(y, travel(), { duration: .26, ease: [.32, 0, .67, 1], onComplete: () => latest.current.onClose() }),
    ];
  }
  function settle() {
    stop();
    animations.current = [
      animate(y, 0, reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38, mass: 1 }),
      animate(backdrop, 1, { duration: reducedMotion ? 0 : .2 }),
    ];
  }
  function onPointerDown(e: PointerEvent<HTMLElement>) {
    if (!enabled || closing.current || latest.current.disabled || !e.isPrimary || e.button !== 0 || gesture.current) return;
    if ((e.target as HTMLElement).closest('button, input, textarea, select, a')) return;
    stop();
    gesture.current = { id: e.pointerId, start: e.clientY, origin: y.get(), last: e.clientY, time: e.timeStamp, velocity: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    panel.current?.setAttribute('data-dragging', 'true');
  }
  function onPointerMove(e: PointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const elapsed = e.timeStamp - g.time;
    if (elapsed > 0) g.velocity = (e.clientY - g.last) / elapsed * 1000;
    g.last = e.clientY; g.time = e.timeStamp;
    const offset = g.origin + e.clientY - g.start;
    y.set(offset < 0 ? offset * .06 : offset);
    backdrop.set(Math.max(0, 1 - Math.max(0, offset) / Math.max(1, panel.current?.offsetHeight ?? 600)));
  }
  function finish(e: PointerEvent<HTMLElement>, cancelled = false) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    panel.current?.removeAttribute('data-dragging');
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    // A held finger has no flick velocity; cancellation always restores the draft.
    const velocity = e.timeStamp - g.time < 100 ? g.velocity : 0;
    const threshold = Math.min(140, Math.max(80, (panel.current?.offsetHeight ?? 600) * .22));
    if (!cancelled && !latest.current.disabled && (y.get() > threshold || (y.get() > 24 && velocity > 650))) requestClose();
    else settle();
  }
  return { y, backdrop, requestClose, dragHandlers: {
    onPointerDown, onPointerMove,
    onPointerUp: (e: PointerEvent<HTMLElement>) => finish(e),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => finish(e, true),
    onLostPointerCapture: (e: PointerEvent<HTMLElement>) => finish(e, true),
  } };
}
