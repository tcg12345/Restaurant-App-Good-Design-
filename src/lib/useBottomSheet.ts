import { useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { useDragControls } from 'motion/react';
import { pushOverlay } from './overlay-registry';

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
 *    The drag only triggers from an explicit handle that calls `startDrag`
 *    (typically a header pill). Without that, every pointer-down inside the
 *    sheet — including drags on crop / trim handles — would also begin a
 *    dismiss gesture, which Framer Motion's pointer capture then "owns",
 *    so the consumer's own pointer handlers stop receiving moves and the
 *    sheet collapses out from under them.
 *
 * Usage:
 *
 *   const { dragProps, startDrag } = useBottomSheet(open, () => setOpen(false));
 *   ...
 *   <motion.div {...dragProps} initial={{ y: '100%' }} animate={{ y: 0 }} ... >
 *     <div onPointerDown={startDrag} className="... drag handle ..." />
 *     ...
 *   </motion.div>
 *
 * If the consumer never wires `startDrag` anywhere, drag-to-dismiss is off
 * (close via the existing X / back affordance). Body-scroll lock still
 * applies.
 */
/* Module-level ref-count for the body scroll lock (same pattern as
 * overlay-registry). Per-instance save/restore broke with STACKED sheets:
 * open A (saves ''), open B on top (saves 'hidden'); close A first →
 * restores '' while B is still up (page scrolls behind it); close B →
 * restores 'hidden' → body permanently unscrollable with nothing open.
 * Counting locks instead: set styles on 0→1, clear them on 1→0 — order of
 * closing never matters. */
let bodyLockCount = 0;
let savedOverflow = '';
let savedOverscroll = '';

function acquireBodyScrollLock(): () => void {
  if (typeof document === 'undefined') return () => {};
  const body = document.body;
  if (bodyLockCount === 0) {
    // Save whatever a NON-sheet owner had set (usually '') exactly once.
    savedOverflow = body.style.overflow;
    savedOverscroll = body.style.overscrollBehavior;
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'contain';
  }
  bodyLockCount++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    bodyLockCount = Math.max(0, bodyLockCount - 1);
    if (bodyLockCount === 0) {
      body.style.overflow = savedOverflow;
      body.style.overscrollBehavior = savedOverscroll;
    }
  };
}

export function useBottomSheet(
  open: boolean,
  onClose: () => void,
  /** Pass the sheet's inner scroll container to enable drag-ANYWHERE
   *  dismissal with correct scroll interop: a downward drag begun while
   *  that container sits at its top takes the whole sheet with it (the
   *  iOS gesture); once the content is scrolled, the same drag scrolls
   *  the content instead. Attach the returned `sheetRef` to the sheet
   *  ROOT element (the same node `dragProps` goes on) to opt in. */
  scrollRef?: RefObject<HTMLElement | null>,
): { dragProps: BottomSheetDragProps; startDrag: (e: ReactPointerEvent) => void; sheetRef: RefObject<HTMLElement | null> } {
  // Lock body scroll while the sheet is open — ref-counted so stacked
  // sheets compose regardless of close order (see acquireBodyScrollLock).
  useEffect(() => {
    if (!open) return;
    if (typeof document === 'undefined') return;
    const releaseLock = acquireBodyScrollLock();
    // Stand the page swipe-back down while this sheet owns the screen.
    const releaseOverlay = pushOverlay();
    return () => {
      releaseLock();
      releaseOverlay();
    };
  }, [open]);

  const dragControls = useDragControls();

  // Memoise so the spread on motion.div doesn't change identity each render —
  // Framer Motion's drag controller treats prop identity changes as a reset.
  const dragProps = useMemo<BottomSheetDragProps>(
    () => ({
      drag: 'y',
      dragControls,
      dragListener: false,
      dragConstraints: { top: 0, bottom: 0 },
      // Downward is the dismissal, so it tracks the finger 1:1 — half-rate
      // follow read as the sheet resisting the drag. Upward is a boundary,
      // and a boundary that does not move at all reads as the gesture having
      // broken — a little rubber band says "this is as far as it goes" while
      // staying obviously alive under the finger.
      dragElastic: { top: 0.06, bottom: 1 },
      onDragEnd: (_event, info) => {
        if (info.offset.y > 100 || info.velocity.y > 300) onClose();
      },
    }),
    [onClose, dragControls],
  );

  const startDrag = useCallback(
    (e: ReactPointerEvent) => {
      dragControls.start(e);
    },
    [dragControls],
  );

  // ── Drag-anywhere ────────────────────────────────────────────────────
  // React's synthetic pointermove alone isn't enough: on iOS, WebKit
  // decides whether a touch becomes a native scroll (or a rubber-band
  // bounce) within the first few pixels of movement, and once it does the
  // touch is gone — later pointermoves stop arriving (or arrive as
  // pointercancel). A handler that only calls dragControls.start() after
  // the fact is too late; the sheet just sits there while the page under
  // it tries to scroll. The fix is the one every native-feeling web sheet
  // uses: attach a real (non-passive) listener so `preventDefault()` can
  // claim the gesture for the sheet BEFORE the browser commits to a
  // scroll — which requires bypassing React's synthetic event system,
  // since passivity there isn't guaranteed. Hence a plain DOM listener
  // on `sheetRef`, added imperatively in an effect.
  const sheetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = sheetRef.current;
    if (!open || !root) return;

    let phase: 'idle' | 'undecided' | 'horizontal' | 'content' | 'sheet' = 'idle';
    let startX = 0;
    let startY = 0;

    const reset = () => { phase = 'idle'; };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      phase = 'undecided';
      startX = e.clientX;
      startY = e.clientY;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (phase === 'idle' || phase === 'horizontal' || phase === 'content') return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (phase === 'sheet') {
        // Already committed — keep claiming the gesture so a mid-drag
        // pause doesn't hand it back to native scroll.
        e.preventDefault();
        return;
      }

      // Undecided: horizontal intent releases to the browser untouched.
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { phase = 'horizontal'; return; }
      // Upward, or downward with the content scrolled past its top, is a
      // normal scroll — let it through so momentum / rubber-band still work.
      const scroller = scrollRef?.current;
      if (dy < 0 || (scroller && scroller.scrollTop > 0)) { phase = 'content'; return; }
      // Small residual motion — hold the decision but keep the browser
      // from committing to anything until the gesture is legible.
      if (Math.abs(dy) <= 6) { e.preventDefault(); return; }

      // A genuine downward pull with nowhere left to scroll: claim it.
      phase = 'sheet';
      e.preventDefault();
      dragControls.start(e);
    };

    // { passive: false } is the whole point — it's what makes
    // preventDefault() effective instead of a silent no-op.
    root.addEventListener('pointerdown', onPointerDown, { passive: true });
    root.addEventListener('pointermove', onPointerMove, { passive: false });
    root.addEventListener('pointerup', reset, { passive: true });
    root.addEventListener('pointercancel', reset, { passive: true });
    return () => {
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerup', reset);
      root.removeEventListener('pointercancel', reset);
    };
  }, [open, dragControls, scrollRef]);

  return { dragProps, startDrag, sheetRef };
}

type BottomSheetDragProps = {
  drag: 'y';
  dragControls: ReturnType<typeof useDragControls>;
  dragListener: false;
  dragConstraints: { top: number; bottom: number };
  dragElastic: { top: number; bottom: number };
  onDragEnd: (event: unknown, info: { offset: { y: number }; velocity: { y: number } }) => void;
};
