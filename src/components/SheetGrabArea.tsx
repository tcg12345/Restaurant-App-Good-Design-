import React from 'react';
import { cn } from '../lib/utils';

/**
 * Swipe-down-to-dismiss for a modal that fills the screen.
 *
 * A partial-height bottom sheet earns its grabber pill: the pill is what
 * says "this is a card sitting over the page, pull it away". A modal that
 * covers the whole screen is not a card — it reads as a page — and the
 * pill on top of one lied twice over. It took a band of its own height
 * out of the layout, pushing the page's real header down and leaving a
 * seam wherever the page tinted its own background differently from the
 * sheet's. So the pill goes, and the gesture stays: this is the same
 * `startDrag` target with nothing drawn.
 *
 * Positioned rather than in flow, so it costs no layout — and CENTRED
 * rather than full-width, which is what lets it sit ABOVE the page's own
 * header. Going underneath was tried first and cannot work: these headers
 * are full-width blocks that own the whole status-bar band, so a strip
 * behind one never sees a touch at all. Centred, it clears the corners
 * where every control in this band actually lives (a close button right,
 * a back chevron left) and covers only the middle, which holds at most a
 * title — text, with nothing to tap.
 *
 * The sheet root needs `relative` for this to anchor to it.
 */
export const SheetGrabArea: React.FC<{
  /** `startDrag` from `useBottomSheet`. */
  onPointerDown: (e: React.PointerEvent) => void;
  className?: string;
}> = ({ onPointerDown, className }) => (
  <div
    onPointerDown={onPointerDown}
    aria-hidden
    className={cn(
      'absolute top-0 left-1/2 -translate-x-1/2 w-2/5 z-20',
      'touch-none cursor-grab active:cursor-grabbing',
      className,
    )}
    style={{ height: 'calc(env(safe-area-inset-top, 0px) + 30px)' }}
  />
);
