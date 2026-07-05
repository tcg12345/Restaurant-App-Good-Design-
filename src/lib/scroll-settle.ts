/**
 * Fire a callback when a scroller comes to REST — not on every scroll frame.
 *
 * Built for the reels feed's snap pager: committing the active slide while
 * the native snap glide is still animating triggered React re-renders and
 * media mounts inside the snap container, which made WebKit interrupt the
 * glide and visibly re-correct ("the slide wiggles into place"). Deferring
 * the commit to rest means zero DOM churn between finger-up and landing.
 *
 * Detection is two-pronged:
 *  - `scrollend` where the browser supports it (exact, fires once per rest);
 *  - always also an idle timer reset by each `scroll` event — the fallback
 *    for engines without `scrollend` (notably older iOS WKWebView).
 * The idle path can misfire during a slow deceleration tail whose events
 * are sparse, so callers may pass `isAligned` (e.g. "scrollTop is on a snap
 * multiple") — a not-yet-aligned idle fire re-arms the timer instead of
 * committing, capped so a scroller parked off-grid can never wedge the
 * callback forever. Callbacks must be idempotent: a `scrollend` and a late
 * timer may both fire for one rest.
 */
export function addScrollSettleListener(
  el: HTMLElement,
  onSettle: () => void,
  opts?: { idleMs?: number; isAligned?: (el: HTMLElement) => boolean },
): () => void {
  const idleMs = opts?.idleMs ?? 140;
  const MAX_REARMS = 8;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rearms = 0;

  const fire = () => {
    timer = null;
    if (rearms < MAX_REARMS && opts?.isAligned && !opts.isAligned(el)) {
      rearms++;
      timer = setTimeout(fire, idleMs);
      return;
    }
    rearms = 0;
    onSettle();
  };

  const onScroll = () => {
    rearms = 0;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(fire, idleMs);
  };

  const onScrollEnd = () => {
    rearms = 0;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    onSettle();
  };

  const hasScrollEnd = 'onscrollend' in window;
  el.addEventListener('scroll', onScroll, { passive: true });
  if (hasScrollEnd) el.addEventListener('scrollend', onScrollEnd);

  return () => {
    el.removeEventListener('scroll', onScroll);
    if (hasScrollEnd) el.removeEventListener('scrollend', onScrollEnd);
    if (timer !== null) clearTimeout(timer);
  };
}
