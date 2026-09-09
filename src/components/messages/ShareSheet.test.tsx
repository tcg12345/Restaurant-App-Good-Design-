// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ShareSheet } from './ShareSheet';
vi.mock('../../lib/cuisine', () => ({ displayCuisine: (value: string) => value }));
vi.mock('../../contexts/ListsContext', () => ({ useLists: () => ({ ratings: [{ restaurantId: 'one', name: 'Juniper', cuisine: 'Italian', price: '$$', score: 9.2 }], homeMeals: [{ id: 'recipe', name: 'Tomato pasta', tags: [], ingredients: [] }] }) }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'self' } }) }));
vi.mock('../../contexts/SettingsContext', () => ({ useSettings: () => ({ phoneMode: true }) }));
vi.mock('../../lib/places', () => ({ searchPlacesByText: vi.fn().mockResolvedValue([]), priceLevelToString: () => '$$' }));
vi.mock('../../pages/useRestaurantDetail', () => ({ getCuisineLabel: () => '' }));
vi.mock('../HomeLocationBar', () => ({ loadLastSelectedLocation: () => null }));
vi.mock('../../lib/supabase-community', () => ({ getAllPublicHomeMeals: vi.fn().mockResolvedValue([]), getProfilesByIds: vi.fn().mockResolvedValue({}) }));
vi.mock('../../lib/recipe-display', () => ({ getMealCoverUrl: () => '' }));
vi.mock('../../lib/glass-buttons', () => ({ useGlassField: () => ({ active: false }) }));
let host: HTMLDivElement, root: Root;
const restaurant = vi.fn(), recipe = vi.fn(), close = vi.fn();
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<ShareSheet open recipientName="Alex Smith" onClose={close} onShareRestaurant={restaurant} onShareRecipe={recipe} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function click(selector: string) { await act(async () => host.querySelector<HTMLButtonElement>(selector)!.click()); }
it('requires explicit selection and Send, and lets the selection be cleared', async () => {
  expect(host.querySelector<HTMLButtonElement>('.message-share-send')!.disabled).toBe(true);
  await click('.message-share-row');
  expect(host.querySelector('.message-share-row')!.getAttribute('aria-pressed')).toBe('true');
  expect(host.querySelector('.message-share-send')!.textContent).toBe('Send to Alex');
  expect(restaurant).not.toHaveBeenCalled();
  await click('[aria-label="Clear selection"]');
  expect(host.querySelector<HTMLButtonElement>('.message-share-send')!.disabled).toBe(true);
  await click('.message-share-row'); await click('.message-share-send');
  expect(restaurant).toHaveBeenCalledWith(expect.objectContaining({ restaurantId: 'one', isReview: true }));
  expect(close).toHaveBeenCalledTimes(1);
});
it('clears selection when changing types and sends the chosen recipe', async () => {
  await click('.message-share-row'); await click('.message-share-kinds button:last-child');
  expect(host.querySelector('input')!.placeholder).toBe('Search recipes');
  expect(host.querySelector<HTMLButtonElement>('.message-share-send')!.disabled).toBe(true);
  await click('.message-share-row'); await click('.message-share-send');
  expect(recipe).toHaveBeenCalledWith(expect.objectContaining({ mealId: 'recipe', authorId: 'self' }));
  expect(restaurant).not.toHaveBeenCalled();
});
it('filters the list and restores results when search is cleared', async () => {
  const input = host.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'unknown');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(host.querySelector('.message-share-row')).toBeNull();
  await click('[aria-label="Clear search"]');
  expect(host.querySelector('.message-share-row')!.textContent).toContain('Juniper');
});
