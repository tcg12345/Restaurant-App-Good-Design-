// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { sampleNativeTabPreview } from './native-tab-preview';

const rect = (x: number, y = 0, width = 400, height = 800) => ({ left: x, top: y, right: x + width, bottom: y + height, width, height }) as DOMRect;
const opacity = (el: HTMLElement) => el.closest('[data-hidden]') ? 0 : 1;
function layer(kind: 'front' | 'reveal', left: number, tab = false, top = 0) {
  const node = document.createElement('div'); node.setAttribute(`data-swipe-${kind}`, '');
  node.getBoundingClientRect = () => rect(left, top);
  if (tab) {
    const marker = document.createElement('div'); marker.dataset.nativeTabPreview = ''; marker.dataset.activeTab = '/pantry';
    marker.getBoundingClientRect = () => rect(left, top); node.append(marker);
  }
  document.body.append(node); return node;
}
beforeEach(() => { Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true }); Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true }); });
afterEach(() => document.body.replaceChildren());

it('has the destination bar ready behind a fully covering page before navigation commits', () => {
  layer('front', 0); layer('reveal', -140, true);
  expect(sampleNativeTabPreview(opacity)).toMatchObject({ path: '/pantry', x: -140, clip: { width: 0 } });
});
it('reveals the bar progressively on a partial swipe and keeps its destination selection', () => {
  layer('front', 160); layer('reveal', -84, true);
  expect(sampleNativeTabPreview(opacity)).toEqual({ path: '/pantry', x: -84, y: 0, alpha: 1, clip: { x: 0, y: 0, width: 160, height: 800 } });
});
it('keeps the same full bar through the handoff even after the live route covers the viewport', () => {
  const front = layer('front', 400); front.dataset.hidden = '';
  const reveal = layer('reveal', 0, true); reveal.dataset.glassHandoff = '';
  const page = document.createElement('div'); page.dataset.swipePage = '';
  const live = document.createElement('div'); live.dataset.routeStack = '/pantry'; live.getBoundingClientRect = () => rect(0);
  page.append(live); document.body.append(page);
  expect(sampleNativeTabPreview(opacity)).toMatchObject({ x: 0, clip: { width: 400, height: 800 } });
  reveal.dataset.hidden = '';
  expect(sampleNativeTabPreview(opacity)).toBeNull();
});
it('releases the preview when a swipe is cancelled', () => {
  layer('front', 0); const reveal = layer('reveal', -140, true);
  expect(sampleNativeTabPreview(opacity)?.clip.width).toBe(0);
  reveal.dataset.hidden = ''; expect(sampleNativeTabPreview(opacity)).toBeNull();
});
it('clips leftward and downward returns along the actual uncovered edge', () => {
  const front = layer('front', -160); layer('reveal', 84, true);
  expect(sampleNativeTabPreview(opacity)?.clip).toEqual({ x: 240, y: 0, width: 160, height: 800 });
  front.getBoundingClientRect = () => rect(0, 500);
  expect(sampleNativeTabPreview(opacity)?.clip).toEqual({ x: 0, y: 0, width: 400, height: 500 });
});
it('keeps a shared bar stationary when both pages have tabs', () => {
  layer('front', 160, true); layer('reveal', -84, true);
  expect(sampleNativeTabPreview(opacity)).toBeNull();
});
it('moves the source bar away when returning to a page without tabs', () => {
  layer('front', 160, true);
  expect(sampleNativeTabPreview(opacity)).toMatchObject({ x: 160, clip: { x: 160, width: 240 } });
});
