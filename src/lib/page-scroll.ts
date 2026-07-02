/**
 * The app is inconsistent about what scrolls a page: some routes scroll the
 * window/document, others scroll an inner `overflow-y: auto` container. These
 * helpers find whichever is the primary vertical scroller for the current page
 * so scroll save/restore (and the swipe-back snapshot) work uniformly.
 */

function isVScroller(el: HTMLElement): boolean {
  if (el.scrollHeight <= el.clientHeight + 8) return false;
  const oy = getComputedStyle(el).overflowY;
  return oy === 'auto' || oy === 'scroll';
}

/** Largest in-page vertical scroller, or null when the window is the scroller. */
export function getPrimaryScroller(root: ParentNode = document): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestH = 0;
  // The swipe-back reveal keeps an inert page clone attached (hidden) between
  // gestures; its scrollers have live layout and must never be mistaken for
  // the page's. Only when scanning the whole document — the gesture itself
  // passes the clone as `root` to replay its scroll.
  const excludeReveal = root === document;
  root.querySelectorAll<HTMLElement>('div, main, section, ul').forEach((el) => {
    if (excludeReveal && el.closest('[data-swipe-reveal]')) return;
    if (el.scrollHeight > bestH && isVScroller(el)) { bestH = el.scrollHeight; best = el; }
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
