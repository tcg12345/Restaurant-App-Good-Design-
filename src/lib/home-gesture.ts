export type HomeDestination = 'home' | 'feed' | 'search';

/** Home yields at either scroll edge; the feed yields only at its top. */
export function homeSwipeDestination(
  page: 'home' | 'feed', dx: number, dy: number, scrollTop: number, maxScrollTop = 0,
): HomeDestination | null {
  if (Math.abs(dy) < (page === 'feed' ? 48 : 64) || Math.abs(dy) < Math.abs(dx) * 1.4) return null;
  if (page === 'home' && dy < 0) return scrollTop >= maxScrollTop - 2 ? 'feed' : null;
  if (scrollTop > 2) return null;
  if (page === 'home') return 'search';
  return dy > 0 && scrollTop <= 2 ? 'home' : null;
}
