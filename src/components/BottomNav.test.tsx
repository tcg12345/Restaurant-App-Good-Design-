// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BottomNav } from './BottomNav';
import { pushOverlay } from '../lib/overlay-registry';

const mocks = vi.hoisted(() => ({
  native: true,
  settings: { hideBottomNav: false, keyboardOpen: false },
  profile: { display_name: 'Test', avatar_url: '' },
  configure: vi.fn(async () => {}),
  visible: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
  registerPlugin: () => ({
    isSupported: async () => ({ supported: mocks.native }),
    configureTabBar: mocks.configure, setVisible: mocks.visible, removeTabBar: mocks.remove,
    setActiveTab: async () => {}, setMinimized: async () => {}, setBarStyle: async () => {},
    addListener: async () => ({ remove: async () => {} }),
  }),
}));
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => mocks.settings }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: mocks.profile, loading: false, adminChecked: true }) }));
vi.mock('../lib/analytics', () => ({ track: vi.fn() }));

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); mocks.native = true;
  mocks.settings = { hideBottomNav: false, keyboardOpen: false };
  mocks.profile = { display_name: 'Test', avatar_url: '' };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(visible: boolean) {
  await act(async () => root.render(<MemoryRouter><BottomNav routeVisible={visible} /></MemoryRouter>));
}

it('keeps the native bar installed through repeated pushes and returns without entrance animations', async () => {
  await render(true);
  expect(host.querySelector('[data-native-tab-source]')).not.toBeNull();
  for (let i = 0; i < 3; i++) {
    await render(false);
    expect(mocks.visible).toHaveBeenLastCalledWith({ visible: false, animated: false });
    await render(true);
    expect(mocks.visible).toHaveBeenLastCalledWith({ visible: true, animated: false });
  }
  expect(mocks.configure).toHaveBeenCalledTimes(1);
  expect(mocks.remove).not.toHaveBeenCalled();
});

it('installs hidden on a detail deep link and preserves that when the avatar arrives', async () => {
  await render(false);
  expect(mocks.configure).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));
  mocks.profile = { display_name: 'New', avatar_url: 'https://example.com/avatar.jpg' };
  await render(false);
  expect(mocks.configure).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));
  expect(mocks.remove).not.toHaveBeenCalled();
});

it('does not show the bar on return while the keyboard or an overlay still covers it', async () => {
  await render(false);
  mocks.settings.keyboardOpen = true;
  await render(true);
  expect(mocks.visible).toHaveBeenLastCalledWith({ visible: false, animated: false });
  let release!: () => void;
  await act(async () => { release = pushOverlay(); });
  mocks.settings.keyboardOpen = false;
  await render(true);
  expect(mocks.visible).toHaveBeenLastCalledWith({ visible: false, animated: false });
  await act(async () => release());
  expect(mocks.visible).toHaveBeenLastCalledWith({ visible: true, animated: false });
});

it('keeps the browser nav DOM and makes hidden routes inert immediately', async () => {
  mocks.native = false;
  await render(true);
  const nav = host.querySelector('nav')!;
  expect(nav.style.visibility).toBe('visible');
  expect(host.querySelector('[data-bottom-nav]')).not.toBeNull();
  await render(false);
  expect(host.querySelector('nav')).toBe(nav);
  expect(nav.style.visibility).toBe('hidden');
  expect(nav.hasAttribute('inert')).toBe(true);
  expect(host.querySelector('[data-bottom-nav]')).toBeNull();
  await render(true);
  expect(host.querySelector('nav')).toBe(nav);
  expect(nav.style.visibility).toBe('visible');
  expect(nav.hasAttribute('inert')).toBe(false);
});
