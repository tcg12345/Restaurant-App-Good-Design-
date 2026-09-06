import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'motion/react';
import { liftOverlayToTopLayer, acquireHardScrollLock } from '../lib/useBottomSheet';
import { pushOverlay } from '../lib/overlay-registry';
import { useSocialDialog } from './social/useSocialDialog';
import { homeHaptic } from '../lib/haptics';
import './CardActions.css';

/**
 * Long-press (touch) / right-click (desktop) detector for grid tiles. Because
 * the tiles are rendered in a `.map()`, a per-tile hook would break the Rules
 * of Hooks — so this is one hook that hands back a `getHandlers(item)` factory
 * sharing a single timer. `suppressClickRef` lets a tile's onClick know a
 * long-press just fired so it can skip the normal tap (navigation).
 */
export function useCardLongPress<T>(
  onLongPress: (item: T, target: HTMLElement) => void,
  opts: { delay?: number; moveTolerance?: number } = {},
) {
  const delay = opts.delay ?? 450;
  const moveTolerance = opts.moveTolerance ?? 10;
  const timer = useRef<number | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  const clear = () => {
    if (timer.current != null) { clearTimeout(timer.current); timer.current = null; }
    startPos.current = null;
  };

  useEffect(() => clear, []);

  const getHandlers = (item: T) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      clear();
      suppressClickRef.current = false;
      if (e.pointerType === 'mouse') return; // desktop uses right-click instead
      const target = e.currentTarget;
      startPos.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        suppressClickRef.current = true;
        homeHaptic();
        onLongPress(item, target);
      }, delay);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!startPos.current) return;
      if (Math.abs(e.clientX - startPos.current.x) > moveTolerance ||
          Math.abs(e.clientY - startPos.current.y) > moveTolerance) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
      e.preventDefault(); clear(); onLongPress(item, e.currentTarget);
    },
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      clear();
      suppressClickRef.current = true;
      onLongPress(item, e.currentTarget);
    },
  });

  return { getHandlers, suppressClickRef };
}

export interface CardAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}

/**
 * Floating context menu anchored next to a long-pressed card. Renders a dim
 * scrim (tap to dismiss) plus a small action list positioned beside the tile,
 * flipping above / clamping to the viewport so it never runs off-screen.
 */
export const CardActionMenu: React.FC<{
  rect: DOMRect;
  actions: CardAction[];
  onClose: () => void;
}> = ({ rect, actions, onClose }) => {
  const reduced = useReducedMotion();
  const ref = useSocialDialog(true, onClose);
  useLayoutEffect(() => { liftOverlayToTopLayer(ref.current); const releaseOverlay = pushOverlay(), releaseLock = acquireHardScrollLock(); return () => { releaseOverlay(); releaseLock(); }; }, []);
  const MENU_W = Math.min(252, window.innerWidth - 24);
  const menuH = actions.length * 49 + 10;
  const left = Math.max(12, Math.min(rect.left + rect.width / 2 - MENU_W / 2, window.innerWidth - MENU_W - 12));
  const availableBottom = window.visualViewport ? window.visualViewport.height + window.visualViewport.offsetTop : window.innerHeight;
  const below = rect.bottom + 8 + menuH < availableBottom - 24;
  const top = Math.max(16, Math.min(below ? rect.bottom + 8 : rect.top - menuH - 8, availableBottom - menuH - 24));
  return createPortal(
    <div ref={ref} className="card-menu-layer" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose(); }}>
      <motion.div role="menu" aria-label="Card actions" className="card-action-menu"
        initial={{ opacity: 0, scale: reduced ? 1 : .94, y: reduced ? 0 : below ? -5 : 5 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 480, damping: 35 }}
        style={{ position: 'fixed', left, top, width: MENU_W, transformOrigin: below ? 'top center' : 'bottom center' }}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault(); const buttons = Array.from((e.currentTarget as HTMLElement).querySelectorAll('button')) as HTMLButtonElement[];
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }}>
        {actions.map((action, index) => <button key={index} type="button" role="menuitem" className={action.danger ? 'is-danger' : ''}
          onClick={() => { onClose(); action.onClick(); }}><span>{action.label}</span>{action.icon}</button>)}
      </motion.div>
    </div>, document.body,
  );
};
