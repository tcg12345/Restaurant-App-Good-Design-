/**
 * Ref-counted "is any overlay open" signal.
 *
 * Modals and bottom sheets bump this while they're open so the app-wide
 * swipe-back gesture stands down — otherwise a back-swipe over an open sheet
 * would pop the route underneath instead of letting the sheet's own
 * drag-to-dismiss handle it. Every sheet built on `useBottomSheet` registers
 * automatically; bespoke modals can call `pushOverlay()` directly.
 *
 * The native Liquid Glass tab bar subscribes too, and for it this isn't a
 * nicety: it's a real UIKit view sitting *above* the WKWebView, so a web
 * overlay can't paint over it the way it covers the web tab bar. It has to
 * be told to leave.
 */
let count = 0;
let presenterCount = 0;
const presenterListeners = new Set<OverlayListener>();

type OverlayListener = (open: boolean) => void;
const listeners = new Set<OverlayListener>();

/** Fire only on the 0↔1 edges — subscribers care whether *anything* is
 *  open, not how many. */
function notify(was: number, now: number, subscribers = listeners): void {
  if ((was > 0) === (now > 0)) return;
  for (const fn of subscribers) {
    try {
      fn(now > 0);
    } catch (err) {
      // One bad subscriber must not strand the rest (or the caller's
      // release path, which runs inside a cleanup effect).
      console.warn('[overlay-registry] listener threw', err);
    }
  }
}

/** Register an open overlay. Returns a release fn (idempotent). */
export function pushOverlay({ dimPresenter = true }: { dimPresenter?: boolean } = {}): () => void {
  const was = count;
  count++;
  notify(was, count);
  if (dimPresenter) {
    const before = presenterCount++;
    notify(before, presenterCount, presenterListeners);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const before = count;
    count = Math.max(0, count - 1);
    notify(before, count);
    if (dimPresenter) {
      const before = presenterCount--;
      notify(before, presenterCount, presenterListeners);
    }
  };
}

export function isOverlayOpen(): boolean {
  return count > 0;
}

/** Watch the open/closed edge. Fires immediately with the current state so
 *  a late subscriber can't miss an already-open overlay. Returns an
 *  unsubscribe fn. */
export function subscribeOverlay(fn: OverlayListener): () => void {
  listeners.add(fn);
  fn(count > 0);
  return () => { listeners.delete(fn); };
}

/** In-place photo reveals own gestures without shrinking their own route. */
export function subscribePresenterOverlay(fn: OverlayListener): () => void {
  presenterListeners.add(fn);
  fn(presenterCount > 0);
  return () => { presenterListeners.delete(fn); };
}
