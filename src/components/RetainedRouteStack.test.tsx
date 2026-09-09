// @vitest-environment jsdom
import React, { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RetainedRouteStack, canRetainRoute } from './RetainedRouteStack';
let host: HTMLDivElement, root: Root;
const mounts = vi.fn();
function Page({ title }: { title: string }) { useEffect(() => { mounts(); }, []); const [count, setCount] = useState(0); return <button onClick={() => setCount(count + 1)}>{title} {count}</button>; }
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mounts.mockClear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(key: string, title: string, index = 1, pop = false) { await act(async () => root.render(<RetainedRouteStack entryKey={key} index={index} pathname={key === 'calendar' ? '/calendar' : '/restaurant/test'} pop={pop} instant><div key={key}><Page title={title} /></div></RetainedRouteStack>)); }
it('retains the calendar instance and selected state through a detail visit and Back', async () => {
  await render('calendar', 'Calendar'); const button = host.querySelector('button')!;
  await act(async () => button.click());
  await render('detail', 'Restaurant', 2); await render('calendar', 'Calendar', 1, true);
  expect(host.querySelector('[data-retained-route="calendar"] button')).toBe(button);
  expect(button.textContent).toBe('Calendar 1'); expect(mounts).toHaveBeenCalledTimes(2);
});
it('parks the latest page props rather than briefly replaying its initial render', async () => {
  await render('calendar', 'September'); await render('calendar', 'October'); await render('detail', 'Restaurant', 2);
  expect(host.querySelector('[data-retained-route="calendar"] button')!.textContent).toBe('October 0');
});
it('still releases transient and sensitive pages', () => {
  for (const path of ['/messages', '/create', '/auth', '/guides/id/edit']) expect(canRetainRoute(path)).toBe(false);
});
