// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { HomeLocationBar } from './HomeLocationBar';
const mocks = vi.hoisted(() => ({ hide: vi.fn(), glass: vi.fn(), picked: vi.fn(), change: vi.fn(), close: vi.fn() }));
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ phoneMode: true, setHideBottomNav: mocks.hide }) }));
vi.mock('../lib/glass-buttons', () => ({ useGlassOccluder: () => mocks.glass }));
vi.mock('../lib/home-location-store', async original => ({ ...await original<object>(), savePickedLocation: mocks.picked, geolocationPermission: async () => 'unknown' }));
vi.mock('motion/react', async original => ({ ...await original<object>(), useReducedMotion: () => true }));
let root: Root, container: HTMLDivElement;
const location = { label: 'New York, NY', lat: 40.7128, lng: -74.006 };
async function mount(open = true) { await act(async () => root.render(React.createElement(HomeLocationBar, { location, onChange: mocks.change, onUseCurrent: async () => {}, open, onOpenChange: mocks.close, variant: 'headless' }))); }
async function search(value: string) { await act(async () => { const input = document.querySelector<HTMLInputElement>('input[type=search]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); await act(async () => { vi.advanceTimersByTime(225); }); }
const result = (label: string) => ({ ok: true, json: async () => ({ features: [{ place_name: label, center: [12, 34] }] }) });
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear(); window.scrollTo = vi.fn(); window.matchMedia = vi.fn().mockReturnValue({ matches: true, addListener: vi.fn(), removeListener: vi.fn() }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('shows the current location once, selects a city, and owns scroll and accessible focus', async () => {
  localStorage.setItem('goodeats-home-recent-locations', JSON.stringify([location])); await mount();
  expect(document.querySelectorAll('.location-picker-current')).toHaveLength(1);
  expect(document.activeElement?.getAttribute('role')).toBe('dialog');
  expect(document.body.style.position).toBe('fixed');
  await act(async () => Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Los Angeles'))!.click());
  expect(mocks.change).toHaveBeenCalledWith(expect.objectContaining({ label: 'Los Angeles, CA' }));
  expect(mocks.picked).toHaveBeenCalledOnce(); expect(mocks.close).toHaveBeenCalledWith(false);
});
it('ignores old responses and deduplicates city/address matches', async () => {
  const pending: Array<(value: unknown) => void> = [];
  const fetchMock = vi.fn().mockImplementationOnce(() => new Promise(resolve => pending.push(resolve))).mockImplementationOnce(() => new Promise(resolve => pending.push(resolve))).mockResolvedValue(result('Tokyo, Japan'));
  vi.stubGlobal('fetch', fetchMock); await mount(); await search('Paris'); await search('Tokyo');
  await act(async () => { pending.forEach(resolve => resolve(result('Paris, France'))); });
  expect(document.body.textContent).not.toContain('Paris, France');
  expect(Array.from(document.querySelectorAll('button')).filter(button => button.textContent?.includes('Tokyo'))).toHaveLength(1);
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
});
it('shows a retryable search error and clearing cancels pending work', async () => {
  const fetchMock = vi.fn().mockRejectedValue(new Error('offline')); vi.stubGlobal('fetch', fetchMock); await mount(); await search('Tokyo');
  expect(document.body.textContent).toContain('Location search is unavailable'); expect(document.body.textContent).toContain('Try again');
  await search(''); expect(document.body.textContent).not.toContain('Location search is unavailable'); expect(document.querySelector('.location-picker-current')).not.toBeNull();
});
