// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GlassButton, holdGlass, releaseGlass, resetGlassHolds, copyGlassToPreview, wakeGlassButtons } from './glass-buttons';
const mock = vi.hoisted(() => ({ push: vi.fn(async (_: any) => {}), clear: vi.fn(async () => {}), events: new Map<string, Function>() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('./native-glass', () => ({ LiquidGlass: { isSupported: async () => ({ supported: true }), setGlassButtons: mock.push, clearGlassButtons: mock.clear, addListener: async (event: string, handler: Function) => { mock.events.set(event, handler); return { remove: async () => {} }; } } }));
let host: HTMLDivElement, root: Root;
const rect = (x = 20, y = 20, width = 44, height = 44) => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON() {} });
const frames = new Map<number, FrameRequestCallback>(); let serial = 0;
async function frame() { const pending = [...frames.values()]; frames.clear(); await act(async () => pending.forEach(callback => callback(performance.now()))); }
const latest = () => mock.push.mock.calls.at(-1)?.[0].buttons as any[];
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mock.push.mockClear(); mock.clear.mockClear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++serial; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect());
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => host.querySelector('button') });
});
afterEach(async () => { await act(async () => root.unmount()); resetGlassHolds(); host.remove(); document.querySelectorAll('[data-swipe-front],[data-swipe-reveal]').forEach(e => e.remove()); await frame(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => root.render(<GlassButton id="back" symbol="chevron.left" label="Back" onClick={() => {}}>Back</GlassButton>)); await frame(); }
it('keeps native ownership and the same registration during nested navigation holds', async () => {
  await mount(); const button = host.querySelector('button')!; const id = button.dataset.glassId;
  expect(button.hasAttribute('data-glass-native')).toBe(true);
  await act(async () => { holdGlass(); holdGlass(); }); await frame();
  expect(button.classList.contains('glass-control')).toBe(false);
  expect(button.dataset.glassId).toBe(id);
  expect(mock.clear).not.toHaveBeenCalled();
  await act(async () => releaseGlass()); await frame();
  expect(button.hasAttribute('data-glass-native')).toBe(true);
  await act(async () => releaseGlass()); await frame();
  expect(latest().find(b => b.id === id)?.alpha).toBe(1);
});
it('tracks moving controls without changing their native ID or drawing CSS', async () => {
  await mount(); const button = host.querySelector('button')!; const id = button.dataset.glassId;
  holdGlass(); button.getBoundingClientRect = () => rect(120); await frame();
  expect(latest().find(b => b.id === id)?.x).toBe(120);
  expect(button.classList.contains('glass-control')).toBe(false);
});
it('renders inert swipe previews as clipped native controls, even after the source unmounts', async () => {
  await mount(); const original = latest()[0].id;
  const clone = host.cloneNode(true) as HTMLElement; clone.inert = true;
  copyGlassToPreview(clone);
  const front = document.createElement('div'); front.dataset.swipeFront = ''; front.inert = true;
  front.getBoundingClientRect = () => rect(100, 0, 393, 852);
  clone.querySelector<HTMLElement>('button')!.getBoundingClientRect = () => rect(120);
  front.append(clone); document.body.append(front);
  await act(async () => root.render(null)); wakeGlassButtons(); await frame();
  const preview = latest().find(b => b.preview);
  expect(preview).toMatchObject({ symbol: 'chevron.left', alpha: 1, preview: true, clip: { x: 100 } });
  expect(preview.id).not.toBe(original);
  expect(clone.querySelector('.glass-control')).toBeNull();
  front.style.visibility = 'hidden'; wakeGlassButtons(); await frame();
  expect(latest().find(b => b.preview)?.alpha).toBe(0);
  front.remove(); wakeGlassButtons(); await frame();
  expect(latest().some(b => b.preview)).toBe(false);
});
it('still uses the CSS fallback when native support is unavailable', async () => {
  await mount(); await act(async () => mock.events.get('supportChanged')!({ supported: false }));
  expect(host.querySelector('button')!.classList.contains('glass-control')).toBe(true);
  expect(mock.clear).toHaveBeenCalled();
  await act(async () => mock.events.get('supportChanged')!({ supported: true }));
});

it('keeps the native material when a sheet suspends taps', async () => {
  await mount(); const id = host.querySelector('button')!.dataset.glassId;
  await act(async () => root.render(<GlassButton id="back" symbol="chevron.left" label="Back" suspended onClick={() => {}}>Back</GlassButton>));
  await frame();
  expect(host.querySelector('button')!.classList.contains('glass-control')).toBe(false);
  expect(latest().find(b => b.id === id)).toMatchObject({ alpha: 1, interactive: false });
  expect(mock.clear).not.toHaveBeenCalled();
});

it('batches the native tab reveal with header geometry and releases it after handoff', async () => {
  await mount();
  const reveal = document.createElement('div'); reveal.dataset.swipeReveal = ''; reveal.inert = true;
  reveal.dataset.glassHandoff = '';
  const marker = document.createElement('div'); marker.dataset.nativeTabPreview = ''; marker.dataset.activeTab = '/pantry';
  marker.getBoundingClientRect = () => rect(0, 0, window.innerWidth, window.innerHeight);
  reveal.append(marker); document.body.append(reveal);
  holdGlass(); await frame();
  expect(mock.push.mock.calls.at(-1)?.[0].tabBarPreview).toMatchObject({ path: '/pantry', x: 0, clip: { width: window.innerWidth } });
  expect(latest().length).toBeGreaterThan(0);
  reveal.style.visibility = 'hidden'; await frame();
  expect(mock.push.mock.calls.at(-1)?.[0].tabBarPreview).toBeNull();
  releaseGlass();
});
