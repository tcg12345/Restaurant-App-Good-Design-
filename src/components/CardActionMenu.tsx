import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

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

  const getHandlers = (item: T) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      suppressClickRef.current = false;
      if (e.pointerType === 'mouse') return; // desktop uses right-click instead
      const target = e.currentTarget;
      startPos.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        suppressClickRef.current = true;
        onLongPress(item, target);
      }, delay);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!startPos.current) return;
      if (Math.abs(e.clientX - startPos.current.x) > moveTolerance ||
          Math.abs(e.clientY - startPos.current.y) > moveTolerance) clear();
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
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
  const MENU_W = 212;
  const ITEM_H = 46;
  const PAD = 8;
  const menuH = actions.length * ITEM_H + PAD * 2;

  // Bottom clearance respects the iOS home indicator, not just a flat
  // 10px — --sat-bottom mirrors env(safe-area-inset-bottom) on :root
  // (index.css) so it's readable from JS.
  const safeBottom = typeof window !== 'undefined'
    ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat-bottom')) || 0)
    : 0;
  const bottomPad = Math.max(10, safeBottom);
  let left = rect.left + rect.width / 2 - MENU_W / 2;
  left = Math.max(10, Math.min(left, window.innerWidth - MENU_W - 10));
  let top = rect.bottom + 8;
  if (top + menuH > window.innerHeight - bottomPad) top = rect.top - menuH - 8;
  top = Math.max(10, top);

  return createPortal(
    <div className="fixed inset-0 z-[100]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.14, ease: 'easeOut' }}
        style={{ position: 'fixed', left, top, width: MENU_W, transformOrigin: 'top center' }}
        onClick={(e) => e.stopPropagation()}
        className="rounded-2xl bg-surface border border-on-surface/10 shadow-2xl shadow-black/30 overflow-hidden p-1"
      >
        {actions.map((a, i) => (
          <button
            key={i}
            type="button"
            onClick={() => { a.onClick(); onClose(); }}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-semibold text-left transition-colors',
              a.danger ? 'text-rose-600 hover:bg-rose-500/10' : 'text-on-surface hover:bg-on-surface/[0.06]',
            )}
          >
            <span className={cn('shrink-0', a.danger ? 'text-rose-600' : 'text-on-surface/70')}>{a.icon}</span>
            {a.label}
          </button>
        ))}
      </motion.div>
    </div>,
    document.body,
  );
};
