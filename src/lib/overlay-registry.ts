/**
 * Ref-counted "is any overlay open" signal.
 *
 * Modals and bottom sheets bump this while they're open so the app-wide
 * swipe-back gesture stands down — otherwise a back-swipe over an open sheet
 * would pop the route underneath instead of letting the sheet's own
 * drag-to-dismiss handle it. Every sheet built on `useBottomSheet` registers
 * automatically; bespoke modals can call `pushOverlay()` directly.
 */
let count = 0;

/** Register an open overlay. Returns a release fn (idempotent). */
export function pushOverlay(): () => void {
  count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count = Math.max(0, count - 1);
  };
}

export function isOverlayOpen(): boolean {
  return count > 0;
}
