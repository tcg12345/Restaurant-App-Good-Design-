// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { handoffBackPreview } from './back-handoff';
let page: HTMLElement, preview: HTMLElement, controller: AbortController;
beforeEach(() => {
  vi.useFakeTimers(); page = document.createElement('div'); preview = document.createElement('div'); controller = new AbortController();
  page.style.opacity = '0'; preview.style.opacity = '1';
  preview.animate = vi.fn().mockImplementation(() => {
    const animation = { onfinish: null as (() => void) | null, oncancel: null, cancel: vi.fn() };
    setTimeout(() => animation.onfinish?.(), 90); return animation;
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('keeps the preview over the destination until native chrome and browser paint are ready', async () => {
  let ready!: () => void;
  const handoff = handoffBackPreview({ page, preview, signal: controller.signal, reduced: false, syncNative: () => new Promise<void>(resolve => { ready = resolve; }) });
  await vi.advanceTimersByTimeAsync(0);
  expect(page.style.opacity).toBe(''); expect(preview.style.zIndex).toBe('19');
  expect(preview.hasAttribute('data-glass-handoff')).toBe(true); expect(preview.animate).not.toHaveBeenCalled();
  ready(); await vi.advanceTimersByTimeAsync(40);
  expect(preview.animate).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(100); await handoff;
  expect(preview.style.opacity).toBe('0');
});
it('respects reduced motion after waiting for the destination paint', async () => {
  const handoff = handoffBackPreview({ page, preview, signal: controller.signal, reduced: true, syncNative: async () => {} });
  await vi.advanceTimersByTimeAsync(40); await handoff;
  expect(preview.animate).not.toHaveBeenCalled();
});
it('does not start a late fade after the page has unmounted', async () => {
  const handoff = handoffBackPreview({ page, preview, signal: controller.signal, reduced: false, syncNative: async () => {} });
  controller.abort(); await vi.advanceTimersByTimeAsync(300); await handoff;
  expect(preview.animate).not.toHaveBeenCalled();
});
it('finishes even when the native bridge and animation frames stall', async () => {
  vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const handoff = handoffBackPreview({ page, preview, signal: controller.signal, reduced: false, syncNative: () => new Promise(() => {}) });
  await vi.advanceTimersByTimeAsync(500); await handoff;
  expect(preview.style.opacity).toBe('0');
});
