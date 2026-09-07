export type BackGestureDirection = 'right' | 'left' | 'down';

export function backCoordinate(x: number, y: number, direction: BackGestureDirection): number {
  return direction === 'down' ? y : direction === 'left' ? -x : x;
}
export function backTranslation(distance: number, direction: BackGestureDirection): string {
  return direction === 'down' ? `translateY(${distance}px)` : `translateX(${direction === 'left' ? -distance : distance}px)`;
}
export function backReveal(progress: number, extent: number, direction: BackGestureDirection): string {
  return direction === 'down' ? `scale(${.96 + .04 * progress})` : backTranslation(-.35 * extent * (1 - progress), direction);
}
/** A sheet's header can always dismiss it; a drag inside scrolled content scrolls first. */
export function atVerticalStart(target: Element | null, root: Element): boolean {
  if (target?.closest('[data-route-drag-handle]')) return true;
  for (let node = target; node && node !== root; node = node.parentElement) {
    if (node.scrollTop > 1 && /(auto|scroll)/.test(getComputedStyle(node).overflowY)) return false;
  }
  return window.scrollY <= 1;
}
