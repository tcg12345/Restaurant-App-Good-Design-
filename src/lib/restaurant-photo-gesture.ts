/** Direction lock before taking a touch away from native scrolling. */
export function photoPullIntent(open: boolean, dx: number, dy: number, atTop: boolean): 'wait' | 'scroll' | 'pull' {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return 'wait';
  if (Math.abs(dy) < Math.abs(dx) * 1.25) return 'scroll';
  if (!open && (!atTop || dy < 0)) return 'scroll';
  if (open && dy > 0) return 'scroll';
  return 'pull';
}
export function photoPullDestination(open: boolean, progress: number, velocity: number): boolean {
  // Velocity is in screen pixels/ms; tiny accidental flicks never commit.
  if (!open && progress > .035 && velocity > .55) return true;
  if (open && progress < .965 && velocity < -.55) return false;
  return open ? progress > .72 : progress > .22;
}
