import { backTranslation, type BackGestureDirection } from './back-gesture';

export const BACK_SHADOW_WIDTH = 64;

/** The departing surface's shadow must be gone BEFORE the surface parks at
 * the viewport edge. Otherwise its blur remains visible during route handoff
 * and removing the parked surface produces a dark-to-light flash. */
export function backShadowOpacity(distance: number, extent: number): number {
  return Math.max(0, Math.min(1, distance / 16, (extent - distance) / BACK_SHADOW_WIDTH));
}

/** Match the page's distance/easing with compositor-only transform + opacity.
 * Include the ramp boundaries so even a short flick or re-grab fades smoothly. */
export function backShadowFrames(from: number, to: number, extent: number, direction: BackGestureDirection): Keyframe[] {
  if (from === to) return [{ transform: backTranslation(to, direction), opacity: backShadowOpacity(to, extent) }];
  const low = Math.min(from, to), high = Math.max(from, to);
  const stops = [from, ...[16, extent - BACK_SHADOW_WIDTH].filter(x => x > low && x < high), to]
    .sort((a, b) => to > from ? a - b : b - a);
  return stops.map(distance => ({ offset: (distance - from) / (to - from), transform: backTranslation(distance, direction), opacity: backShadowOpacity(distance, extent) }));
}
