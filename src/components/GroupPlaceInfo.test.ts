// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { GroupPlaceInfo } from './GroupPlaceInfo';
import type { GroupPlace } from '../lib/group-swipe';
const { summary } = vi.hoisted(() => ({ summary: vi.fn() }));
vi.mock('../lib/group-swipe', () => ({ groupPlaceSummary: summary }));
vi.mock('../lib/useMichelinMatch', () => ({ useMichelinMatch: () => ({ michelin: null }) }));
let root: Root, host: HTMLDivElement, account = 0;
const place = (id: string): GroupPlace => ({ id, name: id, address: '1 Main Street', cuisine: 'Italian', rating: 4, priceLevel: 2, distance: 100, fit: 80, reason: '', photoUrl: null });
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; summary.mockReset(); ++account; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function mount(id: string) { await act(async () => root.render(React.createElement(GroupPlaceInfo, { place: place(id), roomId: 'room', userId: String(account), onDetails: vi.fn() }))); }
async function generate() { await act(async () => host.querySelector<HTMLButtonElement>('[aria-label^="AI overview"]')!.click()); }
it('deduplicates pending requests and never displays a late overview on another restaurant', async () => {
  let resolve!: (value: any) => void;
  summary.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await mount('First'); await generate(); await generate(); expect(summary).toHaveBeenCalledTimes(1);
  expect(host.querySelector<HTMLButtonElement>('[aria-label^="AI overview"]')!.disabled).toBe(true);
  await mount('Second'); await act(async () => resolve({ summary: 'Overview for the first restaurant.' }));
  expect(host.textContent).not.toContain('Overview for the first');
  summary.mockResolvedValue({ summary: 'Overview for the second restaurant.' }); await generate();
  expect(host.textContent).toContain('Overview for the second restaurant.');
});
it('shows a retryable error and retries rather than caching failures', async () => {
  summary.mockRejectedValueOnce(Error('Please try again.')).mockResolvedValueOnce({ summary: 'Italian cooking.' });
  await mount('Retry'); await generate(); expect(host.querySelector('[role="alert"]')?.textContent).toBe('Please try again.');
  await generate(); expect(summary).toHaveBeenCalledTimes(2); expect(host.textContent).toContain('Italian cooking.');
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
