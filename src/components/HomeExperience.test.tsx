// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HomeExperience } from './HomeExperience';
import { homeHaptic } from '../lib/haptics';

vi.mock('motion/react', () => ({ useReducedMotion: () => true, motion: {
  div: React.forwardRef(({ children, initial, animate, transition, onAnimationComplete, ...props }: any, ref: any) => <div ref={ref} {...props}>{children}</div>),
  button: ({ children, whileTap, ...props }: any) => <button {...props}>{children}</button>,
} }));
vi.mock('./HomeHighlights', () => ({ HomeHighlights: () => <div>Ideas</div> }));
vi.mock('../lib/glass-buttons', () => ({ GlassButton: ({ children, label, onClick }: any) => <button aria-label={label} onClick={onClick}>{children}</button> }));
vi.mock('../lib/haptics', () => ({ homeHaptic: vi.fn() }));
vi.mock('../lib/native-glass', () => ({ setGlassNavMinimized: vi.fn() }));
vi.mock('../lib/overlay-registry', () => ({ isOverlayOpen: () => false }));
let root: Root, host: HTMLDivElement;
const search = vi.fn();
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<HomeExperience active city="New York" highlights={[]} header={null} reels={<p>Reels</p>} guides={<p>Guides</p>} feed={<p>Feed contents</p>} onHighlightLink={() => {}} onLocation={() => {}} onSearch={search} onAction={() => {}} />));
  Object.defineProperties(host.querySelector('.home-scroll-viewport')!, {
    scrollHeight: { value: 800 }, clientHeight: { value: 500 },
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('leaves vertical wheel scrolling to Home instead of opening the feed', async () => {
  const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
  await act(async () => host.querySelector('.home-scroll-viewport')!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  expect(host.querySelector('.home-experience')?.getAttribute('data-page')).toBe('home');
});
it('leaves touch scrolling to Home and still opens the feed from the stationary button', async () => {
  const content = host.querySelector('.home-scroll-viewport')!;
  const send = (type: string, y: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: [{ clientX: 180, clientY: y }] });
    content.dispatchEvent(event); return event;
  };
  await act(async () => {
    send('touchstart', 400);
    expect(send('touchmove', 250).defaultPrevented).toBe(false);
    send('touchend', 250);
  });
  expect(host.querySelector('.home-experience')?.getAttribute('data-page')).toBe('home');
  await act(async () => host.querySelector<HTMLButtonElement>('.home-explore')!.click());
  expect(host.querySelector('.home-experience')?.getAttribute('data-page')).toBe('feed');
  expect(host.textContent).toContain('Feed contents');
});

function touch(type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] });
  host.querySelector('.home-scroll-viewport')!.dispatchEvent(event);
  return event;
}
it('opens Search with one haptic after a deliberate downward pull at the top', async () => {
  await act(async () => { touch('touchstart', 180, 200); touch('touchmove', 180, 280); touch('touchend', 180, 280); });
  expect(search).toHaveBeenCalledTimes(1); expect(homeHaptic).toHaveBeenCalledTimes(1);
});
it('preserves a search pull when Home refreshes its props mid-gesture', async () => {
  await act(async () => { touch('touchstart', 180, 200); touch('touchmove', 180, 240); });
  const updatedSearch = vi.fn();
  await act(async () => root.render(<HomeExperience active city="New York" highlights={[]} header={null} reels={<p>Reels</p>} feed={<p>Feed contents</p>} onHighlightLink={() => {}} onLocation={() => {}} onSearch={updatedSearch} onAction={() => {}} />));
  await act(async () => { touch('touchmove', 180, 290); touch('touchend', 180, 290); });
  expect(updatedSearch).toHaveBeenCalledTimes(1);
  expect(search).not.toHaveBeenCalled();
});
it('opens the feed after pulling upward past the bottom', async () => {
  host.querySelector('.home-scroll-viewport')!.scrollTop = 300;
  await act(async () => { touch('touchstart', 180, 400); expect(touch('touchmove', 180, 310).defaultPrevented).toBe(true); touch('touchend', 180, 310); });
  expect(host.querySelector('.home-experience')?.getAttribute('data-page')).toBe('feed');
  expect(homeHaptic).toHaveBeenCalledTimes(1);
});
it('allows a continuing swipe to reach the bottom before counting the navigation pull', async () => {
  const content = host.querySelector('.home-scroll-viewport')!; content.scrollTop = 200;
  await act(async () => {
    touch('touchstart', 180, 400);
    expect(touch('touchmove', 180, 350).defaultPrevented).toBe(false);
    content.scrollTop = 300;
    touch('touchmove', 180, 300);
    touch('touchmove', 180, 225);
    touch('touchend', 180, 225);
  });
  expect(host.querySelector('.home-experience')?.getAttribute('data-page')).toBe('feed');
});
it('ignores horizontal rails, short pulls and cancelled gestures', async () => {
  await act(async () => {
    touch('touchstart', 100, 200); touch('touchmove', 200, 210); touch('touchend', 200, 210);
    touch('touchstart', 100, 200); touch('touchmove', 100, 220); touch('touchend', 100, 220);
    touch('touchstart', 100, 200); touch('touchmove', 100, 280); touch('touchcancel', 100, 280); touch('touchend', 100, 280);
  });
  expect(search).not.toHaveBeenCalled(); expect(homeHaptic).not.toHaveBeenCalled();
});
it('opens the feed at the bottom with a wheel gesture and does not chain momentum into another navigation', async () => {
  host.querySelector('.home-scroll-viewport')!.scrollTop = 300;
  await act(async () => host.querySelector('.home-scroll-viewport')!.dispatchEvent(new WheelEvent('wheel', {deltaY:100,bubbles:true,cancelable:true})));
  expect(host.querySelector('.home-experience')?.getAttribute('data-page')).toBe('feed');
  await act(async () => host.querySelector('.home-experience')!.dispatchEvent(new WheelEvent('wheel', {deltaY:-100,bubbles:true,cancelable:true})));
  expect(host.querySelector('.home-experience')?.getAttribute('data-page')).toBe('feed');
  expect(homeHaptic).toHaveBeenCalledTimes(1);
});
it('prepares the feed before opening it while leaving the Home panel active', async () => {
  await act(async()=>root.unmount());
  vi.useFakeTimers(); root=createRoot(host);
  try {
    await act(async()=>root.render(<HomeExperience active city="New York" highlights={[]} header={null} feed={<p>Prepared feed</p>} onHighlightLink={()=>{}} onLocation={()=>{}} onSearch={()=>{}} onAction={()=>{}}/>));
    expect(host.textContent).not.toContain('Prepared feed');
    await act(async()=>vi.advanceTimersByTimeAsync(700));
    expect(host.textContent).toContain('Prepared feed');
    expect(host.querySelector('.home-experience')?.getAttribute('data-page')).toBe('home');
  } finally {vi.useRealTimers();}
});
