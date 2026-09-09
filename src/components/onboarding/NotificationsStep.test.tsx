// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotificationsOnboardingPage } from './NotificationsStep';
import type { NotificationPermission } from '../../lib/native-notifications';

let host: HTMLDivElement, root: Root;
let enable: ReturnType<typeof vi.fn<() => Promise<void>>>, done: ReturnType<typeof vi.fn<() => void>>;
let state: { native: boolean; permission: NotificationPermission; preferences: { enabled: boolean }; loading: boolean; busy: boolean; error: string; enable: () => Promise<void> };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  HTMLElement.prototype.scrollTo = vi.fn();
  enable = vi.fn(async () => {}); done = vi.fn();
  state = { native: true, permission: 'prompt', preferences: { enabled: false }, loading: false, busy: false, error: '', enable };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render() { await act(async () => root.render(<NotificationsOnboardingPage step={7} total={7} onBack={() => {}} onDone={done} notifications={state} />)); }
function button(text: string) { return Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!; }
async function click(text: string) { await act(async () => button(text).click()); }

it('explains notifications without asking for permission until the enable button is tapped', async () => {
  await render(); expect(enable).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Your next meal');
  await click('Enable notifications'); expect(enable).toHaveBeenCalledTimes(1);
  expect(done).not.toHaveBeenCalled();
});
it('lets users skip without changing their preferences or asking for permission', async () => {
  await render(); await click('Not now');
  expect(done).toHaveBeenCalledTimes(1); expect(enable).not.toHaveBeenCalled();
});
it('lets users continue after declining and explains how to change the choice later', async () => {
  state.permission = 'denied'; await render();
  expect(button('Enable notifications')).toBeUndefined();
  expect(host.textContent).toContain('iPhone Settings');
  await click('Start exploring'); expect(done).toHaveBeenCalled(); expect(enable).not.toHaveBeenCalled();
});
it('recognizes already enabled notifications without prompting again', async () => {
  state.permission = 'granted'; state.preferences.enabled = true; await render();
  expect(host.textContent).toContain('You’re in the loop.');
  await click('Start exploring'); expect(done).toHaveBeenCalled(); expect(enable).not.toHaveBeenCalled();
});
it('keeps permission/save errors recoverable and never blocks the skip action', async () => {
  state.permission = 'granted'; state.error = 'Couldn’t save this change.'; await render();
  expect(host.textContent).toContain('Couldn’t save');
  expect(button('Enable notifications')).toBeDefined();
  await click('Not now'); expect(done).toHaveBeenCalled();
});
it('prevents duplicate requests and navigation while the system prompt is pending', async () => {
  let resolve!: () => void;
  enable.mockImplementation(() => new Promise<void>(r => { resolve = r; }));
  await render(); await click('Enable notifications'); await click('Enable notifications');
  expect(enable).toHaveBeenCalledTimes(1); expect(button('Not now').disabled).toBe(true);
  await act(async () => resolve()); expect(button('Not now').disabled).toBe(false);
});
