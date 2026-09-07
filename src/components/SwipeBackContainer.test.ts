// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SwipeBackContainer } from './SwipeBackContainer';
import { pushOverlay } from '../lib/overlay-registry';
import type { BackGestureDirection } from '../lib/back-gesture';
vi.mock('../lib/glass-buttons', () => ({ holdGlass: vi.fn(), releaseGlass: vi.fn() }));
vi.mock('../lib/page-scroll', () => ({ getPrimaryScroller: () => null, setPageScroll: vi.fn() }));
let host: HTMLDivElement, root: Root;
let back: ReturnType<typeof vi.fn>, lock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); back = vi.fn(); lock = vi.fn();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  window.scrollTo = vi.fn();
  Element.prototype.animate = vi.fn().mockImplementation((_frames, options) => {
    const animation = { onfinish: null as null | (() => void), oncancel: null as null | (() => void), cancel: vi.fn() };
    const timer = setTimeout(() => animation.onfinish?.(), options.duration);
    animation.cancel.mockImplementation(() => clearTimeout(timer));
    return animation;
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function mount(direction: BackGestureDirection = 'right', child?: React.ReactNode) {
  await act(async () => root.render(React.createElement(SwipeBackContainer, { enabled: true, direction, navKey: 1, locationKey: 'one', snapshotable: false, revealSnapshotKey: null, backIsPop: true, onBack: back, onLockTransition: lock, children: child ?? React.createElement('main', { 'data-route-stack': '/decide' }, 'Page') })));
}
function touch(target: Element, type: string, x: number, y: number, time: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] }, changedTouches: { value: [{ clientX: x, clientY: y }] }, timeStamp: { value: time } });
  target.dispatchEvent(event);
  return event;
}
async function swipe(target: Element, points: [number, number][], cancel = false) {
  await act(async () => {
    touch(target, 'touchstart', ...points[0], 1);
    touch(target, 'touchmove', ...points[1], 30);
    touch(target, 'touchmove', ...points[2], 80);
    vi.advanceTimersByTime(20);
    touch(target, cancel ? 'touchcancel' : 'touchend', ...points[2], 90);
    vi.advanceTimersByTime(500);
  });
}
it.each(['right','left','down'] as const)('commits a %s return once in its presentation direction', async direction => {
  await mount(direction);
  const points: [number,number][] = direction === 'right' ? [[70,100],[90,100],[280,100]] : direction === 'left' ? [[330,100],[310,100],[100,100]] : [[150,100],[150,120],[150,430]];
  await swipe(host.querySelector('main')!, points);
  expect(back).toHaveBeenCalledOnce(); expect(lock).toHaveBeenCalledWith(true);
});
it('does not let hidden retained-page transforms block a visible page', async () => {
  await mount('right', React.createElement('div', null,
    React.createElement('section', { inert: true }, React.createElement('div', { 'data-route-stack': '/old', style: { transform: 'matrix(1,0,0,1,400,0)' } })),
    React.createElement('main', { 'data-route-stack': '/decide' }, 'Page')));
  await swipe(host.querySelector('main')!, [[70,100],[90,100],[280,100]]);
  expect(back).toHaveBeenCalledOnce();
});
it('leaves voting cards, inputs, horizontal content and wrong-direction drags alone', async () => {
  await mount('left', React.createElement('main', null, React.createElement('div', { 'data-swipe-back': 'off' }, 'Vote'), React.createElement('input'), React.createElement('div', { 'data-horizontal-gesture': '' }, 'Photos')));
  for (const target of [host.querySelector('[data-swipe-back]')!, host.querySelector('input')!, host.querySelector('[data-horizontal-gesture]')!]) await swipe(target, [[230,100],[210,100],[40,100]]);
  await swipe(host.querySelector('main')!, [[70,100],[90,100],[280,100]]);
  expect(back).not.toHaveBeenCalled();
});
it('scrolls sheet content first but lets its header dismiss at any scroll position', async () => {
  await mount('down', React.createElement('main', null, React.createElement('header', { 'data-route-drag-handle': '' }, 'Guides'), React.createElement('div', { className: 'scroll', style: { overflowY: 'auto' } }, 'Cards')));
  host.querySelector('.scroll')!.scrollTop = 100;
  await swipe(host.querySelector('.scroll')!, [[150,100],[150,120],[150,430]]);
  expect(back).not.toHaveBeenCalled();
  await swipe(host.querySelector('header')!, [[150,100],[150,120],[150,430]]);
  expect(back).toHaveBeenCalledOnce();
});
it('cancels interrupted gestures and stands down while an overlay owns the screen', async () => {
  await mount(); const target = host.querySelector('main')!;
  await swipe(target, [[70,100],[90,100],[280,100]], true);
  expect(back).not.toHaveBeenCalled();
  const release = pushOverlay();
  await swipe(target, [[70,100],[90,100],[280,100]]); release();
  expect(back).not.toHaveBeenCalled();
});
it('consults an in-page step before dismissing its route', async () => {
  await mount('left'); const step = vi.fn((event: Event) => event.preventDefault());
  window.addEventListener('app:before-back', step);
  try { await swipe(host.querySelector('main')!, [[330,100],[310,100],[100,100]]); expect(step).toHaveBeenCalledOnce(); expect(back).not.toHaveBeenCalled(); }
  finally { window.removeEventListener('app:before-back', step); }
});
it('dismisses a deliberately lowered sheet without needing a fast flick', async () => {
  await mount('down'); const target = host.querySelector('main')!;
  await act(async () => {
    touch(target,'touchstart',150,100,1); touch(target,'touchmove',150,120,30); touch(target,'touchmove',150,270,80);
    vi.advanceTimersByTime(20); touch(target,'touchend',150,270,400); vi.advanceTimersByTime(500);
  });
  expect(back).toHaveBeenCalledOnce();
});
