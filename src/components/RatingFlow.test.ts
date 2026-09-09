// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RatingFlowSheet } from './RatingFlow';
import { isOverlayOpen } from '../lib/overlay-registry';
const { occlude } = vi.hoisted(() => ({ occlude: vi.fn() }));
vi.mock('../contexts/ListsContext', () => ({ useLists: vi.fn() }));
vi.mock('../lib/glass-buttons', () => ({
  useGlassOccluder: () => occlude,
  GlassButton: ({ children, label, onClick }: any) => React.createElement('button', { 'aria-label': label, onClick }, children),
}));
vi.mock('../lib/haptics', () => ({ homeHaptic: vi.fn() }));
vi.mock('motion/react', async original => ({ ...await original<object>(), useReducedMotion: () => true }));
const prior = { restaurantId: 'kalaya', name: 'Kalaya', image: '', cuisine: 'Thai', price: '$$$', address: '4 W Palmer St', score: 8.8, notes: 'Keep this note.', favoriteDishes: ['Dumplings'], visitDate: '2026-08-15', wouldReturn: true, tags: ['Great Service'], photos: [], listIds: ['dinners'], friendIds: ['friend'], createdAt: 1 };
const save = vi.fn();
let root: Root, container: HTMLDivElement, visual: EventTarget & { width: number; height: number; offsetLeft: number; offsetTop: number };
function Preview({ page, visitDate }: { page?: string; visitDate?: string }) {
  const [open, setOpen] = useState(true);
  return React.createElement(RatingFlowSheet, { state: { addRestaurantModalOpen: open, addRestaurantModalMeta: { ...prior, id: prior.restaurantId }, addRestaurantModalInitialPage: page, addRestaurantModalVisitDate: visitDate, closeAddRestaurantModal: () => setOpen(false), getRating: () => prior, ratings: [prior], getRestaurantInfo: () => prior, scoresUnlocked: true, rateRestaurant: save, removeRating: vi.fn() } as any });
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  window.scrollTo = vi.fn();
  visual = Object.assign(new EventTarget(), { width: 393, height: 852, offsetLeft: 0, offsetTop: 0 });
  Object.defineProperty(window, 'visualViewport', { value: visual, configurable: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); save.mockClear(); occlude.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); expect(document.body.style.position).toBe(''); expect(isOverlayOpen()).toBe(false); });
const mount = async (page?: string) => { await act(async () => root.render(React.createElement(Preview, { page }))); };
async function click(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find(el => el.textContent === text || el.getAttribute('aria-label') === text)!;
  expect(button).toBeTruthy(); await act(async () => button.click());
}
it('covers the viewport, registers native chrome occlusion, and adapts to the keyboard', async () => {
  await mount('notes');
  const scrim = document.querySelector<HTMLElement>('.rf-scrim')!;
  expect(scrim.style.width).toBe('393px'); expect(scrim.style.height).toBe('852px');
  expect(occlude).toHaveBeenCalledWith(scrim); expect(document.body.style.position).toBe('fixed');
  expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe(prior.notes);
  await act(async () => { visual.height = 410; visual.offsetTop = 24; visual.dispatchEvent(new Event('resize')); });
  expect(scrim.style.height).toBe('410px'); expect(scrim.style.top).toBe('24px'); expect(scrim.style.width).toBe('393px');
  await click('Close'); await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(document.querySelector('.rf-scrim')).toBeNull(); expect(occlude).toHaveBeenLastCalledWith(null);
  expect(document.body.style.position).toBe('');
});
it('opens existing rating details and preserves the score and visit data when saving', async () => {
  await mount(); expect(document.querySelector('.rf-stage-details')).not.toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>('.rf-cta')!.click());
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ score: 8.8, notes: prior.notes, favoriteDishes: prior.favoriteDishes, listIds: prior.listIds, friendIds: prior.friendIds, visitDate: prior.visitDate }), expect.objectContaining({ isNewVisit: false }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
});
it.each(['notes', 'photos'])('opens the requested %s editor directly', async page => {
  await mount(page); expect(document.querySelector('.rf-editing')).not.toBeNull();
  expect(document.querySelector('.rf-ed')?.textContent).toContain(page === 'notes' ? 'Notes' : 'Photos');
});
it('keeps a new visit separate from editing the existing visit', async () => {
  await mount('new-visit'); expect(document.querySelector('.rf-stage-gut')).not.toBeNull();
  expect(document.querySelector('.rf-step')?.textContent).toContain('NEW VISIT'); expect(save).not.toHaveBeenCalled();
});

it('uses the calendar visit date when saving instead of silently using today', async () => {
  await act(async () => root.render(React.createElement(Preview, { visitDate: '2026-09-07' })));
  await act(async () => document.querySelector<HTMLButtonElement>('.rf-cta')!.click());
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ visitDate: '2026-09-07' }), expect.anything());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
});
