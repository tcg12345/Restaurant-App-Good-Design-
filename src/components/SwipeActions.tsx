import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CardAction } from './CardActionMenu';
import { homeHaptic } from '../lib/haptics';
import './CardActions.css';

/** Horizontal capture starts only after direction is clear. Motion follows
 * the pointer directly; a cancelled gesture never invokes an action. */
export function useSwipeActions(count: number) {
  const revealWidth = count * 74 + 6;
  const [tx, setTx] = useState(0), [open, setOpen] = useState(false), [dragging, setDragging] = useState(false);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const position = useRef(0), suppressedUntil = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gesture = useRef<{ x: number; y: number; base: number; horizontal: boolean; lastX: number; lastTime: number; velocity: number } | null>(null);
  const clearPress = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; }, []);
  const closeSwipe = useCallback(() => { clearPress(); gesture.current = null; position.current = 0; setTx(0); setOpen(false); setDragging(false); }, [clearPress]);
  useEffect(() => () => clearPress(), [clearPress]);
  useEffect(() => {
    const other = (e: Event) => { if ((e as CustomEvent).detail !== rowRef.current) closeSwipe(); };
    const outside = (e: PointerEvent) => { if (open && !rowRef.current?.contains(e.target as Node)) closeSwipe(); };
    window.addEventListener('card-swipe-open', other); document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('card-swipe-open', other); document.removeEventListener('pointerdown', outside); };
  }, [open, closeSwipe]);
  const showMenu = (element: HTMLElement) => {
    if (!count) return;
    const rect = element.getBoundingClientRect(); closeSwipe();
    suppressedUntil.current = performance.now() + 700;
    window.dispatchEvent(new CustomEvent('card-swipe-open', { detail: rowRef.current }));
    homeHaptic(); setMenuRect(rect);
  };
  const onSwipeDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!count || !e.isPrimary || e.button !== 0) return;
    clearPress();
    gesture.current = { x: e.clientX, y: e.clientY, base: position.current, horizontal: false, lastX: e.clientX, lastTime: performance.now(), velocity: 0 };
    const target = e.currentTarget;
    if (e.pointerType !== 'mouse') timer.current = setTimeout(() => showMenu(target), 450);
  };
  const onSwipeMove = (e: React.PointerEvent<HTMLElement>) => {
    const g = gesture.current; if (!g) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearPress();
    if (!g.horizontal) {
      if (Math.abs(dx) < 9 && Math.abs(dy) < 9) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.25 || (g.base === 0 && dx > 0)) { gesture.current = null; return; }
      g.horizontal = true; setDragging(true);
      window.dispatchEvent(new CustomEvent('card-swipe-open', { detail: rowRef.current }));
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* Browser without capture. */ }
    }
    const time = performance.now(); g.velocity = (e.clientX - g.lastX) / Math.max(1, time - g.lastTime); g.lastX = e.clientX; g.lastTime = time;
    const next = Math.max(-revealWidth - 14, Math.min(0, g.base + dx));
    position.current = next; setTx(next);
  };
  const onSwipeEnd = () => {
    clearPress(); const g = gesture.current; gesture.current = null; setDragging(false);
    if (!g?.horizontal) return;
    suppressedUntil.current = performance.now() + 350;
    const velocity = performance.now() - g.lastTime < 100 ? g.velocity : 0;
    const nextOpen = Math.abs(velocity) > .45 ? velocity < 0 : position.current < -revealWidth * .4;
    position.current = nextOpen ? -revealWidth : 0; setTx(position.current); setOpen(nextOpen);
    if (nextOpen) homeHaptic();
  };
  const onForegroundClick = (e: React.MouseEvent) => {
    if (performance.now() < suppressedUntil.current || open) { e.preventDefault(); e.stopPropagation(); if (open) closeSwipe(); return true; }
    return false;
  };
  return { rowRef, tx, open, dragging, revealWidth, closeSwipe, menuRect, setMenuRect, onForegroundClick,
    foregroundProps: { 'data-card-swipe': '', onPointerDown: onSwipeDown, onPointerMove: onSwipeMove, onPointerUp: onSwipeEnd,
      onPointerCancel: closeSwipe, onPointerLeave: clearPress,
      onContextMenu: (e: React.MouseEvent<HTMLElement>) => { if (count) { e.preventDefault(); showMenu(e.currentTarget); } },
      onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); showMenu(e.currentTarget); } },
    },
  };
}

export function SwipeActionTray({ actions, width, visible, onClose }: { actions: CardAction[]; width: number; visible: boolean; onClose: () => void }) {
  return <div className="card-swipe-tray" style={{ width }} aria-hidden={!visible} inert={!visible}>
    {actions.map(action => <button key={action.label} type="button" className={action.danger ? 'is-danger' : ''} aria-label={action.label}
      onClick={e => { e.stopPropagation(); onClose(); action.onClick(); }}>{action.icon}<span>{action.label}</span></button>)}
  </div>;
}
