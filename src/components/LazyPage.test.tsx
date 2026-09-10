// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lazyPage } from './LazyPage';
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it('keeps navigation visible while a route downloads and passes its props after loading', async () => {
  let resolve!: (value: any) => void;
  const load = vi.fn(() => new Promise<any>(r => { resolve = r; })); const Page = lazyPage(load);
  expect(load).not.toHaveBeenCalled();
  await act(async () => root.render(<><nav>Navigation</nav><Page name="Guide" /></>));
  expect(host.querySelector('nav')?.textContent).toBe('Navigation'); expect(host.querySelector('[role=status]')).not.toBeNull();
  await act(async () => resolve({ default: ({ name }) => <h1>{name}</h1> }));
  expect(host.querySelector('h1')?.textContent).toBe('Guide'); expect(host.querySelector('[role=status]')).toBeNull();
});
it('retries a rejected route import without reloading or replacing the navigation shell', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ default: () => <h1>Recovered</h1> });
  const Page = lazyPage(load);
  await act(async () => root.render(<><nav>Navigation</nav><Page /></>));
  const nav = host.querySelector('nav'); expect(host.querySelector('[role=alert]')).not.toBeNull();
  await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
  expect(host.querySelector('h1')?.textContent).toBe('Recovered'); expect(host.querySelector('nav')).toBe(nav); expect(load).toHaveBeenCalledTimes(2);
});
it('renders a preloaded page synchronously without inserting a fallback and shares an in-flight import', async () => {
  const load = vi.fn().mockResolvedValue({ default: () => <h1>Ready</h1> });
  const Page = lazyPage(load, 'profile');
  await Promise.all([Page.preload(), Page.preload()]);
  const addedSkeletons: Node[] = [];
  const observer = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (node instanceof Element && (node.matches('[role=status]') || node.querySelector('[role=status]'))) addedSkeletons.push(node);
  })));
  observer.observe(host, { subtree: true, childList: true });
  await act(async () => root.render(<Page />));
  expect(host.textContent).toBe('Ready'); expect(addedSkeletons).toHaveLength(0); expect(load).toHaveBeenCalledTimes(1);
  observer.disconnect();
});
it('recovers from a failed background preload when the user first opens the page', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ default: () => <h1>Online</h1> });
  const Page = lazyPage(load);
  await expect(Page.preload()).rejects.toThrow('offline');
  await act(async () => root.render(<Page />));
  expect(host.textContent).toBe('Online'); expect(load).toHaveBeenCalledTimes(2);
});
it('uses content placeholders with reduced-motion-safe animation while loading', async () => {
  const Page = lazyPage(() => new Promise(() => {}), 'calendar');
  await act(async () => root.render(<Page />));
  expect(host.querySelector('[data-page-skeleton=calendar]')).not.toBeNull();
  expect(host.querySelector('[class*=animate-spin]')).toBeNull();
  expect(host.querySelectorAll('[class*=motion-safe\\:animate-pulse]').length).toBeGreaterThan(30);
});
