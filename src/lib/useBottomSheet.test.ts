// @vitest-environment jsdom
import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBottomSheet } from './useBottomSheet';
const { start, close } = vi.hoisted(() => ({ start: vi.fn(), close: vi.fn() }));
vi.mock('motion/react', () => ({ useDragControls: () => controls }));
const controls = { start };
let root: Root, container: HTMLDivElement;
let props: ReturnType<typeof useBottomSheet>['dragProps'];
function Sheet() {
  const scroll = useRef<HTMLDivElement>(null);
  const { sheetRef, dragProps } = useBottomSheet(true, close, scroll); props = dragProps;
  return React.createElement('div', { ref: (el: HTMLDivElement | null) => { sheetRef.current = el; } },
    React.createElement('header', null, 'Share'),
    React.createElement('div', { ref: scroll, className: 'scroll' },
      React.createElement('input'), React.createElement('p', null, 'A restaurant'), React.createElement('button', null, 'Recipient')));
}
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  start.mockClear(); close.mockClear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(React.createElement(Sheet)));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
function pointer(type: string, selector: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerType: { value: 'touch' }, clientX: { value: x }, clientY: { value: y } });
  container.querySelector(selector)!.dispatchEvent(event);
}
function veto(selector: string, x: number, y: number) {
  const event = new Event('touchmove', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: [{ clientX: x, clientY: y }] });
  container.querySelector(selector)!.dispatchEvent(event); return event.defaultPrevented;
}
it('tracks a downward content pull and dismisses deliberate drags, keeping short pulls open', () => {
  pointer('pointerdown', 'p', 100, 100); pointer('pointermove', 'p', 101, 125);
  expect(start).toHaveBeenCalledOnce(); expect(veto('p', 101, 125)).toBe(true);
  props.onDragEnd(null, { offset: { y: 35 }, velocity: { y: 40 } }); expect(close).not.toHaveBeenCalled();
  props.onDragEnd(null, { offset: { y: 130 }, velocity: { y: 40 } }); expect(close).toHaveBeenCalledOnce();
});
it('leaves scrolled content alone but still lets the header dismiss', () => {
  container.querySelector('.scroll')!.scrollTop = 50;
  pointer('pointerdown', 'p', 100, 100); pointer('pointermove', 'p', 100, 125);
  expect(start).not.toHaveBeenCalled(); expect(veto('p', 100, 125)).toBe(false);
  pointer('pointerdown', 'header', 100, 100); pointer('pointermove', 'header', 100, 125);
  expect(start).toHaveBeenCalledOnce(); expect(veto('header', 100, 125)).toBe(true);
});
it('preserves horizontal recipient swipes, upward scrolling, and input editing', () => {
  for (const [selector, x, y] of [['button', 140, 102], ['p', 100, 60], ['input', 100, 140]] as const) {
    pointer('pointerdown', selector, 100, 100); pointer('pointermove', selector, x, y);
    expect(veto(selector, x, y)).toBe(false);
  }
  expect(start).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
});
it('never dismisses a canceled drag or an upward release', () => {
  props.onDragEnd(new Event('pointercancel'), { offset: { y: 180 }, velocity: { y: 900 } });
  props.onDragEnd(new Event('touchcancel'), { offset: { y: 180 }, velocity: { y: 900 } });
  props.onDragEnd(null, { offset: { y: -10 }, velocity: { y: 900 } });
  expect(close).not.toHaveBeenCalled();
});
it('leaves a drag that started inside nested scrolled content to the browser', () => {
  const nested = document.createElement('div'); nested.style.overflowY = 'auto'; nested.scrollTop = 40;
  const child = document.createElement('span'); child.className = 'nested-content'; nested.append(child);
  container.querySelector('.scroll')!.append(nested);
  pointer('pointerdown', '.nested-content', 100, 100);
  nested.scrollTop = 0;
  pointer('pointermove', '.nested-content', 100, 140);
  expect(start).not.toHaveBeenCalled();
});
