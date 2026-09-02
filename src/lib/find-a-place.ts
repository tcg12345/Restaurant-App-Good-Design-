/**
 * The chat's "Find a place" sheet, opened from anywhere, hosted nowhere
 * near its button.
 *
 * The sheet cannot live inside the assistant chat that opens it: the
 * assistant unmounts itself whenever an overlay registers (see
 * AppAssistant's `phoneMode && overlayOpen` gate, and the comment there
 * about the assistant eating itself), so a sheet rendered as its child
 * takes its own host down and disappears with it. Not registering the
 * overlay instead leaves the native glass tab bar — a UIKit view above
 * the WebView — drawn across the sheet's own button.
 *
 * So the sheet is mounted once at the app root, and the button asks for
 * it through this tiny store. Same shape as overlay-registry: a set of
 * listeners and a function that pokes them.
 */

type Listener = () => void;
const listeners = new Set<Listener>();

/** Ask the app-root host to open the sheet. */
export function openFindAPlace(): void {
  for (const fn of listeners) {
    try { fn(); } catch (err) { console.warn('[find-a-place] listener threw', err); }
  }
}

/** Host subscription. Returns the unsubscribe. */
export function subscribeFindAPlace(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
