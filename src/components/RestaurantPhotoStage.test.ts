// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RestaurantPhotoStage } from './RestaurantPhotoStage';
import { PullToRefresh } from './PullToRefresh';
import { isOverlayOpen, subscribePresenterOverlay } from '../lib/overlay-registry';
vi.mock('../lib/glass-buttons', () => ({ holdGlass: vi.fn(), releaseGlass: vi.fn() }));
vi.mock('../lib/haptics', () => ({ homeHaptic: vi.fn() }));
vi.mock('motion/react', async original => ({
  ...await original<object>(), useReducedMotion: () => true,
  animate: (value: { set: (n: number) => void }, target: number, options: { onComplete: () => void }) => {
    value.set(target); options.onComplete(); return { stop: vi.fn() };
  },
}));
let root: Root, container: HTMLDivElement;
function Preview({ photos = ['one.jpg', 'two.jpg'] }: { photos?: string[] }) {
  const [open, setOpen] = useState(false), [index, setIndex] = useState(0);
  return React.createElement(RestaurantPhotoStage, {
    communityPhotos: [{ url: 'two.jpg', caption: 'Miso-glazed salmon', user_id: 'test' } as any],
    name: 'Test restaurant', photos, index, onIndexChange: setIndex, open, onOpenChange: setOpen,
    children: React.createElement('main', null, React.createElement('button', null, 'Rate a visit')),
  });
}
async function mount(photos?: string[]) { await act(async () => root.render(React.createElement(Preview, { photos }))); }
async function click(selector: string) { await act(async () => container.querySelector<HTMLButtonElement>(selector)!.click()); }
async function touch(type: string, x: number, y: number, time: number, target = '.rps-details') {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: y }] }, timeStamp: { value: time } });
  await act(async () => container.querySelector(target)!.dispatchEvent(event));
  return event;
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = vi.fn(); HTMLElement.prototype.scrollTo = vi.fn();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); expect(isOverlayOpen()).toBe(false); expect(document.body.style.position).toBe(''); });
describe('restaurant photo reveal', () => {
  it('owns a long downward pull without shrinking the presenter or refreshing', async () => {
    const refresh = vi.fn(), presenter = vi.fn();
    const release = subscribePresenterOverlay(presenter);
    try {
      await act(async () => root.render(React.createElement(React.Fragment, null,
        React.createElement(PullToRefresh, { enabled: true, onRefresh: refresh }), React.createElement(Preview))));
      const canvasHeight = (container.querySelector('.rps-canvas') as HTMLElement).style.height;
      await touch('touchstart', 150, 350, 0);
      const move = await touch('touchmove', 150, 650, 200);
      await touch('touchend', 150, 650, 220);
      expect(move.defaultPrevented).toBe(true);
      expect((container.querySelector('.rps-canvas') as HTMLElement).style.height).toBe(canvasHeight);
      expect(container.querySelector('[role=dialog]')).not.toBeNull();
      expect(refresh).not.toHaveBeenCalled();
      expect(presenter.mock.calls).toEqual([[false]]);
    } finally { release(); }
  });
  it('searches captions and sources, opens the original photo, and preserves typing keys', async () => {
    await mount(); await click('.rps-handle');
    const input = container.querySelector<HTMLInputElement>('input[type=search]')!;
    async function search(value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    await search('SALMON');
    expect(container.querySelectorAll('.rps-grid-items button')).toHaveLength(1);
    const arrow = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    await act(async () => input.dispatchEvent(arrow));
    expect(arrow.defaultPrevented).toBe(false);
    await click('[aria-label="View photo 2"]');
    expect(container.querySelector('.rps-photo-meta')?.textContent).toContain('2 of 2');
    expect(input.value).toBe('');
    await search('pizza');
    expect(container.querySelector('.rps-empty')?.textContent).toContain('No matching photos');
    await search('community');
    expect(container.querySelectorAll('.rps-grid-items button')).toHaveLength(1);
    await click('[aria-label="Clear photo search"]');
    expect(container.querySelector('.rps-photo-meta')?.textContent).toContain('2 of 2');
  });

  it('opens from the handle, navigates photos/grid, and restores details and scroll ownership', async () => {
    await mount(); await click('.rps-handle');
    expect(container.querySelector('[role=dialog]')).not.toBeNull();
    expect(isOverlayOpen()).toBe(true); expect(document.body.style.position).toBe('fixed');
    await click('[aria-label="Next photo"]');
    expect(container.querySelector('.rps-photo-meta')?.textContent).toContain('2 of 2');
    await click('[aria-label="Show all photos"]'); await click('[aria-label="View photo 1"]');
    expect(container.querySelector('.rps-photo-meta')?.textContent).toContain('1 of 2');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(container.querySelector('[role=dialog]')).toBeNull();
    expect(container.querySelector('.rps-details')?.hasAttribute('inert')).toBe(false);
    expect(isOverlayOpen()).toBe(false); expect(document.body.style.position).toBe('');
  });
  it('follows a pull into the gallery and an upward pull back to details', async () => {
    await mount(); await touch('touchstart', 150, 350, 0); await touch('touchmove', 152, 540, 200); await touch('touchend', 152, 540, 220);
    expect(container.querySelector('[role=dialog]')).not.toBeNull();
    await touch('touchstart', 150, 400, 400, '.rps-photo-full'); await touch('touchmove', 152, 180, 600, '.rps-photo-full'); await touch('touchend', 152, 180, 620, '.rps-photo-full');
    expect(container.querySelector('[role=dialog]')).toBeNull(); expect(isOverlayOpen()).toBe(false);
  });
  it('does not hijack native scrolling or horizontal swipes, and cancels interrupted pulls', async () => {
    await mount();
    await touch('touchstart', 150, 350, 0); const up = await touch('touchmove', 150, 200, 50); await touch('touchend', 150, 200, 60);
    expect(up.defaultPrevented).toBe(false); expect(isOverlayOpen()).toBe(false);
    await touch('touchstart', 150, 350, 100); const horizontal = await touch('touchmove', 260, 370, 150); await touch('touchend', 260, 370, 160);
    expect(horizontal.defaultPrevented).toBe(false);
    await touch('touchstart', 150, 350, 200); await touch('touchmove', 150, 500, 250); await touch('touchcancel', 150, 500, 260);
    expect(container.querySelector('[role=dialog]')).toBeNull(); expect(isOverlayOpen()).toBe(false);
  });
  it('keeps a downward swipe as native scrolling when the card is already scrolled', async () => {
    await mount();
    vi.spyOn(container.querySelector('.restaurant-photo-stage')!, 'getBoundingClientRect').mockReturnValue({ top: -200 } as DOMRect);
    await touch('touchstart', 150, 350, 0); const move = await touch('touchmove', 152, 560, 200); await touch('touchend', 152, 560, 220);
    expect(move.defaultPrevented).toBe(false); expect(isOverlayOpen()).toBe(false);
  });
  it('releases gallery ownership when the restaurant is unmounted', async () => {
    await mount(); await click('.rps-handle'); expect(isOverlayOpen()).toBe(true);
    // afterEach unmounts the still-open stage and checks both lock registries.
  });
  it('keeps left-edge navigation free and has no gallery affordance without photos', async () => {
    await mount(); await touch('touchstart', 12, 350, 0); await touch('touchmove', 15, 560, 50); await touch('touchend', 15, 560, 60);
    expect(isOverlayOpen()).toBe(false);
    await mount([]); expect(container.querySelector('.rps-handle')).toBeNull(); expect(container.textContent).toContain('Rate a visit');
  });
});
