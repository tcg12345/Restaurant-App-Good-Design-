import { useEffect, useMemo } from 'react';

/**
 * Behavioural primitives shared by every bottom-sheet in the app:
 *
 *  - Body scroll lock while the sheet is open, so the page underneath can't
 *    scroll behind it on phones. Restores whatever overflow the body had
 *    before, so other sheets nested via portals don't fight over the style.
 *  - Swipe-down-to-dismiss with the same spring feel as the existing hand-
 *    rolled draggable sheets (HomeLocationBar, CircleActivity, FollowingFeed,
 *    the Discover feed sheet) — 100 px drag OR 300 px/s flick velocity
 *    dismisses, otherwise the sheet snaps back.
 *
 * Usage:
 *
 *   const { dragProps } = useBottomSheet(open, () => setOpen(false));
 *   ...
 *   <motion.div {...dragProps} initial={{ y: '100%' }} animate={{ y: 0 }} ... />
 *
 * `dragProps` is a stable reference per (open, onClose) pair so spreading it
 * onto a motion.div doesn't force the drag controller to remount every render.
 */
export function useBottomSheet(
  open: boolean,
  onClose: () => void,
): { dragProps: BottomSheetDragProps } {
  // Lock body scroll while the sheet is open. Save/restore the previous
  // value rather than blindly setting back to '' so a parent that already
  // had its own overflow (e.g. another modal open underneath) isn't broken
  // when this one closes.
  useEffect(() => {
    if (!open) return;
    if (typeof document === 'undefined') return;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevOverscroll = body.style.overscrollBehavior;
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'contain';
    return () => {
      body.style.overflow = prevOverflow;
      body.style.overscrollBehavior = prevOverscroll;
    };
  }, [open]);

  // Memoise so the spread on motion.div doesn't change identity each render —
  // Framer Motion's drag controller treats prop identity changes as a reset.
  const dragProps = useMemo<BottomSheetDragProps>(
    () => ({
      drag: 'y',
      dragConstraints: { top: 0, bottom: 0 },
      dragElastic: { top: 0, bottom: 0.5 },
      onDragEnd: (_event, info) => {
        if (info.offset.y > 100 || info.velocity.y > 300) onClose();
      },
    }),
    [onClose],
  );

  return { dragProps };
}

type BottomSheetDragProps = {
  drag: 'y';
  dragConstraints: { top: number; bottom: number };
  dragElastic: { top: number; bottom: number };
  onDragEnd: (event: unknown, info: { offset: { y: number }; velocity: { y: number } }) => void;
};
