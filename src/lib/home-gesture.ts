export type HomeDestination = 'home' | 'feed' | 'search';

/** A deliberate vertical swipe, with the feed yielding only at its top. */
export function homeSwipeDestination(
  page: 'home' | 'feed', dx: number, dy: number, scrollTop: number,
): HomeDestination | null {
  if (Math.abs(dy) < (page === 'feed' ? 48 : 64) || Math.abs(dy) < Math.abs(dx) * 1.4) return null;
  if (scrollTop > 2) return null;
  if (page === 'home') return dy < 0 ? 'feed' : 'search';
  return dy > 0 && scrollTop <= 2 ? 'home' : null;
}
