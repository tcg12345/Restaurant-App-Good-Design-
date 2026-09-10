// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RetainedTabLocation, useTabActive } from './RetainedTabLocation';
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function Tab() {
  const location = useLocation(); const active = useTabActive(); const [count, setCount] = useState(0);
  return <><output>{JSON.stringify({ path: location.pathname, search: location.search, state: location.state, active, count })}</output><button onClick={() => setCount(n => n + 1)}>Count</button></>;
}
function Shell({ path = '/pantry' }) {
  const location = useLocation(); const navigate = useNavigate();
  return <><button onClick={() => navigate('/pantry?view=trips')}>Lists</button><button onClick={() => navigate('/recipe/r?list=unrelated', { state: { openTakeover: true } })}>Recipe</button>
    <RetainedTabLocation path={path} active={location.pathname === path}><Tab /></RetainedTabLocation></>;
}
const read = () => JSON.parse(host.querySelector('output')!.textContent!);
const click = async (text: string) => act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!.click());
it('warms with a clean URL, preserves local state and does not consume another route’s parameters', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/recipe/r?list=unrelated']}><Shell /></MemoryRouter>));
  expect(read()).toMatchObject({ path: '/pantry', search: '', state: null, active: false });
  await click('Lists'); await click('Count');
  expect(read()).toMatchObject({ search: '?view=trips', count: 1, active: true });
  await click('Recipe'); expect(read()).toMatchObject({ path: '/pantry', search: '?view=trips', count: 1, active: false, state: null });
  await click('Lists'); expect(read()).toMatchObject({ count: 1, active: true });
});
it('keeps the real URL available to Home so its media stops when another page is active', async () => {
  await act(async () => root.render(<MemoryRouter><Shell path="/" /></MemoryRouter>));
  expect(read()).toMatchObject({ path: '/', active: true });
  await click('Recipe'); expect(read()).toMatchObject({ path: '/recipe/r', active: false });
});
