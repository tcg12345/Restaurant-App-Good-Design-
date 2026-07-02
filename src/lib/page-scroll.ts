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
  if (excludeHidden && cs.visibility === 'hidden') return false;
  const oy = cs.overflowY;
  return oy === 'auto' || oy === 'scroll';
}

/** Largest in-page vertical scroller, or null when the window is the scroller. */
export function getPrimaryScroller(root: ParentNode = document): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestH = 0;
  // Document-wide scans must skip invisible content: the swipe-back reveal
  // (an inert page clone, kept attached between gestures) and anything
  // visibility-hidden. Scoped scans skip neither — the gesture passes the
  // clone itself (inside the hidden reveal) as `root` to replay its scroll.
  const documentScan = root === document;
  root.querySelectorAll<HTMLElement>('div, main, section, ul').forEach((el) => {
    if (documentScan && el.closest('[data-swipe-reveal]')) return;
    if (el.scrollHeight > bestH && isVScroller(el, documentScan)) { bestH = el.scrollHeight; best = el; }
  });
  return best;
}

export function getPageScroll(): number {
  const sc = getPrimaryScroller();
  return sc ? sc.scrollTop : window.scrollY;
}

export function setPageScroll(y: number): void {
  const sc = getPrimaryScroller();
  if (sc) sc.scrollTop = y;
  else window.scrollTo(0, y);
}

/** Max scroll offset of the current primary scroller (for restore retries). */
export function maxPageScroll(): number {
  const sc = getPrimaryScroller();
  if (sc) return sc.scrollHeight - sc.clientHeight;
  return document.documentElement.scrollHeight - window.innerHeight;
}
