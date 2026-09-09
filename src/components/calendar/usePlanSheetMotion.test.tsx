// @vitest-environment jsdom
import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { usePlanSheetMotion } from './usePlanSheetMotion';
const mock = vi.hoisted(() => ({ reduced: false, closed: vi.fn(), animations: [] as any[] }));
vi.mock('motion/react', async importOriginal => ({
  ...await importOriginal<any>(),
  useReducedMotion: () => mock.reduced,
  animate: (value: any, target: number, options: any) => {
    const animation = { value, target, options, stopped: false, stop() { this.stopped = true; }, finish() { if (!this.stopped) { value.set(target); options.onComplete?.(); } } };
    mock.animations.push(animation); return animation;
  },
}));
let root: Root, host: HTMLDivElement, sheet: ReturnType<typeof usePlanSheetMotion>;
function Harness({ disabled = false }: { disabled?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  sheet = usePlanSheetMotion(panel, true, disabled, mock.closed);
  return <div ref={panel}><header {...sheet.dragHandlers}>Drag here<button onClick={sheet.requestClose}>Close</button></header><input defaultValue="My dinner" /></div>;
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mock.closed.mockReset(); mock.animations = []; mock.reduced = false;
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = () => true; HTMLElement.prototype.releasePointerCapture = vi.fn();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function mount(disabled = false) { await act(async () => root.render(<Harness disabled={disabled} />)); }
function finishAnimations() { mock.animations.forEach(a => a.finish()); }
async function pointer(type: string, y: number, time: number, target: Element = host.querySelector('header')!) {
  await act(async () => {
    const event = new Event(type, { bubbles: true });
    Object.assign(event, { pointerId: 1, clientY: y, button: 0, isPrimary: true });
    Object.defineProperty(event, 'timeStamp', { value: time }); target.dispatchEvent(event);
  });
}
it('opens from below the viewport and preserves the draft on a short pull with spring return', async () => {
  await mount(); expect(sheet.y.get()).toBeGreaterThan(window.innerHeight); finishAnimations();
  await pointer('pointerdown', 100, 0); await pointer('pointermove', 145, 200);
  expect(sheet.y.get()).toBe(45); expect(sheet.backdrop.get()).toBeLessThan(1);
  await pointer('pointerup', 145, 210); expect(mock.closed).not.toHaveBeenCalled();
  expect(mock.animations.some(a => a.options.type === 'spring')).toBe(true);
  finishAnimations(); expect(sheet.y.get()).toBe(0); expect(host.querySelector('input')!.value).toBe('My dinner');
});
it('keeps the popup mounted until a long drag finishes its exit, and closes once', async () => {
  await mount(); finishAnimations();
  await pointer('pointerdown', 100, 0); await pointer('pointermove', 270, 300); await pointer('pointerup', 270, 310);
  expect(mock.closed).not.toHaveBeenCalled(); expect(host.firstElementChild!.hasAttribute('inert')).toBe(true);
  sheet.requestClose(); finishAnimations(); expect(mock.closed).toHaveBeenCalledTimes(1);
});
it('accepts a deliberate flick but ignores stale velocity after a hold', async () => {
  await mount(); finishAnimations();
  await pointer('pointerdown', 100, 0); await pointer('pointermove', 140, 30); await pointer('pointerup', 140, 250);
  finishAnimations(); expect(mock.closed).not.toHaveBeenCalled();
  await pointer('pointerdown', 100, 300); await pointer('pointermove', 140, 330); await pointer('pointerup', 140, 335);
  finishAnimations(); expect(mock.closed).toHaveBeenCalledTimes(1);
});
it('returns after pointer cancellation and leaves form input gestures alone', async () => {
  await mount(); finishAnimations();
  await pointer('pointerdown', 100, 0, host.querySelector('input')!); await pointer('pointermove', 300, 50); expect(sheet.y.get()).toBe(0);
  await pointer('pointerdown', 100, 100); await pointer('pointermove', 300, 150); await pointer('pointercancel', 300, 160);
  finishAnimations(); expect(mock.closed).not.toHaveBeenCalled(); expect(sheet.y.get()).toBe(0);
});
it('prevents dismissal while saving and cancels animation callbacks on unmount', async () => {
  await mount(true); finishAnimations(); sheet.requestClose();
  await pointer('pointerdown', 100, 0); await pointer('pointermove', 400, 50); await pointer('pointerup', 400, 60);
  expect(mock.closed).not.toHaveBeenCalled(); expect(sheet.y.get()).toBe(0);
  await mount(false); sheet.requestClose(); await act(async () => root.render(null)); finishAnimations();
  expect(mock.closed).not.toHaveBeenCalled();
});
it('honors reduced motion for opening and closing', async () => {
  mock.reduced = true; await mount(); expect(sheet.y.get()).toBe(0); expect(sheet.backdrop.get()).toBe(1); expect(mock.animations).toHaveLength(0);
  sheet.requestClose(); expect(mock.closed).toHaveBeenCalledTimes(1);
});
