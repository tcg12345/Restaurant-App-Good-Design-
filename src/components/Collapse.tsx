import React from 'react';
import { cn } from '../lib/utils';

/**
 * Expand and collapse, interpolated by the browser instead of by JavaScript.
 *
 * What this replaces is `<AnimatePresence>` wrapped around a `motion.div`
 * animating `height: 0 → 'auto'` — the same eight lines copy-pasted at
 * fourteen call sites, four of them stacked on the restaurant page alone.
 * Of what was wrong with it, one part is unavoidable and two are not:
 *
 *  - Unavoidable: an accordion has to move the content beneath it, and there
 *    is no compositor-only way to reflow a document. The layout pass stays.
 *  - Avoidable: that height was interpolated *by JS* — a style write and a
 *    layout from the main thread on every frame of every open.
 *    `grid-template-rows: 0fr → 1fr` hands the identical interpolation to the
 *    engine instead.
 *  - Avoidable: a CSS transition retargets from wherever it currently is, so
 *    hammering the toggle reverses mid-flight. That is the property the
 *    animation playbook asks for on anything reversible, and a JS tween
 *    driven by a mount/unmount cannot have it — the element was being torn
 *    out of the tree and rebuilt on every close.
 *
 * The inner element carries `min-h-0` — without it the `0fr` row cannot
 * collapse, because a grid item's default `min-height: auto` floors it at its
 * content — and `overflow-hidden` so the content is clipped on the way past.
 *
 * `inert` while closed keeps collapsed content out of the tab order and the
 * accessibility tree. `overflow: hidden` only hides it visually; the old
 * unmount-on-close got that for free, and dropping it without `inert` would
 * have left focusable controls inside a zero-height box.
 */
export const Collapse: React.FC<{
  open: boolean;
  children: React.ReactNode;
  /** Applied to the grid wrapper — margins and the like belong here. */
  className?: string;
}> = ({ open, children, className }) => (
  <div
    className={cn(
      'grid transition-[grid-template-rows,opacity] duration-200',
      'ease-[var(--ease-out-strong)]',
      open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      className,
    )}
  >
    <div className="min-h-0 overflow-hidden" inert={!open}>
      {children}
    </div>
  </div>
);
