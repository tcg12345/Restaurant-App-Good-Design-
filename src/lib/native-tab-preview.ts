/** Geometry for the existing UIKit tab bar while a route preview covers the
 * live page. Sampled in the same frame/batch as native glass header controls. */
export interface NativeTabPreview {
  path: string; x: number; y: number; alpha: number;
  clip: { x: number; y: number; width: number; height: number };
}

export function sampleNativeTabPreview(opacity: (el: HTMLElement, preview?: boolean) => number): NativeTabPreview | null {
  const width = window.innerWidth, height = window.innerHeight;
  const front = document.querySelector<HTMLElement>('[data-swipe-front]');
  const frontRect = front && opacity(front, true) > .01 ? front.getBoundingClientRect() : null;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('[data-native-tab-preview]'))
    .filter(el => opacity(el, true) > .01);
  const source = candidates.find(el => el.closest('[data-swipe-front]'));
  const destination = candidates.find(el => el.closest('[data-swipe-reveal]'));
  // A push inside a tab keeps the shared bar fixed. A return to/from a page
  // without tabs instead reveals or covers the bar along with that page.
  if (source && destination) return null;
  const marker = source ?? destination;
  if (!marker) return null;
  const rect = marker.getBoundingClientRect();
  const clip = { x: 0, y: 0, width, height };
  if (source && frontRect) {
    clip.x = Math.max(0, frontRect.left); clip.y = Math.max(0, frontRect.top);
    clip.width = Math.max(0, Math.min(width, frontRect.right) - clip.x);
    clip.height = Math.max(0, Math.min(height, frontRect.bottom) - clip.y);
  } else if (!marker.closest('[data-glass-handoff]')) {
    const live = document.querySelector<HTMLElement>('[data-swipe-page] [data-route-stack]:not([inert])');
    const cover = frontRect ?? (live && opacity(live) > .01 ? live.getBoundingClientRect() : null);
    if (cover) {
      if (cover.top > 0) clip.height = Math.min(height, cover.top);
      else if (cover.left >= 0) clip.width = Math.min(width, cover.left);
      else { clip.x = Math.max(0, cover.right); clip.width = Math.max(0, width - clip.x); }
    }
  }
  // UIKit owns the material's size. Never scale Liquid Glass to match a
  // shrinking sheet presenter; only horizontal page parallax translates it.
  const scaled = Math.abs(rect.width - width) > 1;
  return { path: marker.dataset.activeTab ?? '', x: scaled ? 0 : rect.left, y: scaled ? 0 : rect.top, alpha: 1, clip };
}
