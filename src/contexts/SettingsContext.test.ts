// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { SettingsProvider, useSettings } from './SettingsContext';
import { applyNativeTheme } from '../lib/native-theme';
vi.mock('../lib/native-theme', () => ({ applyNativeTheme: vi.fn().mockResolvedValue(undefined) }));
let root: Root, host: HTMLDivElement, settings: ReturnType<typeof useSettings>;
let dark = false;
let listeners: Set<(event: { matches: boolean }) => void>;
function Probe() { settings = useSettings(); return null; }
async function mount() { await act(async () => root.render(React.createElement(SettingsProvider, null, React.createElement(Probe)))); }
async function deviceTheme(value: boolean) { await act(async () => { dark = value; listeners.forEach(listener => listener({ matches: value })); }); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); vi.clearAllMocks(); dark = false; listeners = new Set();
  window.matchMedia = vi.fn((query: string) => ({ get matches() { return query.includes('color-scheme') ? dark : false; }, addEventListener: (_: string, fn: any) => { if (query.includes('color-scheme')) listeners.add(fn); }, removeEventListener: (_: string, fn: any) => listeners.delete(fn) })) as any;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.documentElement.classList.remove('dark'); });
it('defaults to system and responds to live device changes without recording an override', async () => {
  await mount(); expect(settings.appearance).toBe('system');
  await deviceTheme(true); expect(settings.darkMode).toBe(true); expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(applyNativeTheme).toHaveBeenLastCalledWith(true, true);
  await deviceTheme(false); expect(settings.darkMode).toBe(false);
  expect(localStorage.getItem('goodeats-dark-mode')).toBeNull();
});
it('preserves an existing explicit choice and resumes automatic updates when System is selected', async () => {
  localStorage.setItem('goodeats-dark-mode', '1'); await mount();
  expect(settings.appearance).toBe('dark'); expect(settings.darkMode).toBe(true);
  await deviceTheme(false); expect(settings.darkMode).toBe(true);
  await act(async () => settings.setAppearance('system'));
  expect(settings.darkMode).toBe(false); expect(localStorage.getItem('goodeats-dark-mode')).toBe('system');
  expect(applyNativeTheme).toHaveBeenLastCalledWith(false, true);
  await deviceTheme(true); expect(settings.darkMode).toBe(true);
  await act(async () => settings.setAppearance('light'));
  await deviceTheme(true); expect(settings.darkMode).toBe(false); expect(applyNativeTheme).toHaveBeenLastCalledWith(false, false);
});
it('restores saved System and clears the native override even when the resolved color stays the same', async () => {
  localStorage.setItem('goodeats-dark-mode', 'system'); dark = true; await mount();
  expect(settings.appearance).toBe('system'); expect(settings.darkMode).toBe(true);
  await act(async () => settings.setDarkMode(true)); expect(settings.appearance).toBe('dark');
  expect(applyNativeTheme).toHaveBeenLastCalledWith(true, false);
  await act(async () => settings.setAppearance('system'));
  expect(applyNativeTheme).toHaveBeenLastCalledWith(true, true);
});
