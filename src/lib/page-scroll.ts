/**
 * The app is inconsistent about what scrolls a page: some routes scroll the
 * window/document, others scroll an inner `overflow-y: auto` container. These
 * helpers find whichever is the primary vertical scroller for the current page
 * so scroll save/restore (and the swipe-back snapshot) work uniformly.
 */

function isVScroller(el: HTMLElement, excludeHidden: boolean): boolean {
  if (el.scrollHeight <= el.clientHeight + 8) return false;
  const cs = getComputedStyle(el);
  // Hidden keep-alive tab layers keep live layout while invisible — their
  // scrollers must never be mistaken for the current page's (reading one
  // saves the wrong offset; writing one corrupts a preserved tab).
  if (excludeHidden && (cs.visibility === 'hidden' || el.closest('[inert]'))) return false;
  const oy = cs.overflowY;
  return oy === 'auto' || oy === 'scroll';
}

/** Largest in-page vertical scroller, or null when the window is the scroller. */
export function getPrimaryScroller(root: ParentNode = document, visibleOnly = false): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestH = 0;
  // Document-wide scans must skip invisible content: the swipe-back reveal
  // (an inert page clone, kept attached between gestures) and anything
  // visibility-hidden. Scoped scans skip neither — the gesture passes the
  // clone itself (inside the hidden reveal) as `root` to replay its scroll.
  const documentScan = root === document;
  root.querySelectorAll<HTMLElement>('div, main, section, ul').forEach((el) => {
    if (documentScan && isOffscreenScrollTarget(el)) return;
    if (el.scrollHeight > bestH && isVScroller(el, documentScan || visibleOnly)) { bestH = el.scrollHeight; best = el; }
  });
  return best;
}

export function getPageScroll(): number {
  const sc = getPrimaryScroller();
  return sc ? sc.scrollTop : window.scrollY;
}

export function setPageScroll(y: number, root?: ParentNode): void {
  const sc = getPrimaryScroller(root ?? document);
  if (sc) sc.scrollTop = y;
  else window.scrollTo(0, y);
}

/** Max scroll offset of the current primary scroller (for restore retries).
 *  Pass `root` to measure inside a specific route wrapper — an unscoped scan
 *  during a transition can pick the EXITING page's scroller. */
export function maxPageScroll(root?: ParentNode): number {
  const sc = getPrimaryScroller(root ?? document);
  if (sc) return sc.scrollHeight - sc.clientHeight;
  return document.documentElement.scrollHeight - window.innerHeight;
}

/**
 * True for a scroll event target that belongs to an off-screen layer rather
 * than the page you are actually looking at.
 *
 * Two things produce those. The keep-alive tab layers are absolutely
 * positioned and hidden with `visibility` (App.tsx), so they keep live layout
 * — and live scroll offsets — while invisible. And `SwipeBackContainer`
 * replays the destination's scroll onto its inert clone after every
 * navigation, which fires a real scroll event carrying a real offset a few
 * hundred milliseconds after you arrive anywhere.
 *
 * Scroll-driven chrome has to ignore both, or it reacts to a page nobody is
 * on. `visibility` is inherited, so the one computed read covers a scroller at
 * any depth inside a hidden layer; the reveal needs its own check because it
 * flips to `visible` for the duration of a back-swipe while its contents are
 * still not the current page. Non-elements (`document`, `window`) are the real
 * page scroll and never off-screen.
 */
export function isOffscreenScrollTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('[data-swipe-reveal], [data-swipe-front], [inert]')) return true;
  const route = target.closest('[data-route-entry]');
  if (route && route.getAttribute('data-route-entry') !== window.history.state?.key) return true;
  return getComputedStyle(target).visibility === 'hidden';
}
