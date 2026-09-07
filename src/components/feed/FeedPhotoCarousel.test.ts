// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FeedPhotoCarousel, feedPhotoPages } from './FeedPhotoCarousel';
let root: Root, container: HTMLDivElement;
const photos = Array.from({ length: 6 }, (_, i) => ({ id: String(i), url: `${i}.jpg`, caption: `Dish ${i + 1}` }));
const onOpen = vi.fn(), onError = vi.fn();
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  onOpen.mockClear(); onError.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function mount(count = 6) {
  await act(async () => root.render(React.createElement(FeedPhotoCarousel, { photos: photos.slice(0, count), name: 'Dinner', onOpen, onError })));
  const track = container.querySelector<HTMLDivElement>('.feed-photo-track')!;
  Object.defineProperty(track, 'clientWidth', { value: 390 });
  track.scrollTo = vi.fn((options: ScrollToOptions) => { track.scrollLeft = options.left || 0; track.dispatchEvent(new Event('scroll')); }) as typeof track.scrollTo;
  return track;
}
it('makes every photo available inline, tracks swiping, and expands the selected photo', async () => {
  const track = await mount();
  expect(container.querySelectorAll('img')).toHaveLength(6);
  await act(async () => { track.scrollLeft = 390; track.dispatchEvent(new Event('scroll')); });
  expect(container.querySelector('.feed-photo-count')?.textContent).toBe('4–6 / 6');
  expect(container.querySelectorAll('.feed-photo-dots span')).toHaveLength(2);
  await act(async () => container.querySelectorAll<HTMLButtonElement>('.feed-photo-slide')[4].click());
  expect(onOpen).toHaveBeenCalledWith(4);
});
it('supports arrows and keyboard navigation without passing the album ends', async () => {
  await mount();
  const previous = container.querySelector<HTMLButtonElement>('[aria-label="Previous photo grid"]')!;
  const next = container.querySelector<HTMLButtonElement>('[aria-label="Next photo grid"]')!;
  expect(previous.disabled).toBe(true);
  await act(async () => next.click());
  expect(container.querySelector('.feed-photo-count')?.textContent).toBe('4–6 / 6');
  await act(async () => container.querySelector('.feed-photo-track')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
  expect(next.disabled).toBe(true);
  expect(document.activeElement).toBe(container.querySelectorAll('.feed-photo-slide')[3]);
});
it('does not expand after a drag and keeps single-photo posts free of paging controls', async () => {
  await mount(1);
  const slide = container.querySelector<HTMLButtonElement>('.feed-photo-slide')!;
  await act(async () => {
    slide.dispatchEvent(new MouseEvent('pointerdown', { clientX: 250, clientY: 50, bubbles: true }));
    slide.dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 55, bubbles: true }));
    slide.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
  });
  expect(onOpen).not.toHaveBeenCalled();
  expect(container.querySelector('.feed-photo-count')).toBeNull();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(onError).toHaveBeenCalledWith('0');
});

it('keeps grid pages balanced, complete and in the original photo order', () => {
  expect(feedPhotoPages(5)).toEqual([[0,1,2],[3,4]]);
  expect(feedPhotoPages(4)).toEqual([[0,1],[2,3]]);
  expect(feedPhotoPages(7)).toEqual([[0,1,2],[3,4],[5,6]]);
  for (let count = 0; count <= 30; count++) {
    const pages = feedPhotoPages(count);
    expect(pages.flat()).toEqual(Array.from({length:count},(_,i)=>i));
    if (count > 1) expect(pages.every(page => page.length >= 2 && page.length <= 3)).toBe(true);
  }
});
it('shows all three tiles without paging controls when the album fits in one grid', async () => {
  await mount(3);
  expect(container.querySelectorAll('.feed-photo-page')).toHaveLength(1);
  expect(container.querySelectorAll('.feed-photo-page.has-3 .feed-photo-slide')).toHaveLength(3);
  expect(container.querySelectorAll('.feed-photo-slide[tabindex="0"]')).toHaveLength(3);
  expect(container.querySelector('.feed-photo-count')).toBeNull();
  await act(async () => container.querySelectorAll<HTMLButtonElement>('.feed-photo-slide')[1].click());
  expect(onOpen).toHaveBeenCalledWith(1);
});
