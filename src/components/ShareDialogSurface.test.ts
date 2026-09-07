// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ShareDialogSurface } from './ShareDialogSurface';
import { isOverlayOpen } from '../lib/overlay-registry';
const { occlude } = vi.hoisted(() => ({ occlude: vi.fn() }));
vi.mock('../lib/glass-buttons', () => ({ useGlassOccluder: () => occlude }));
vi.mock('motion/react', async original => ({ ...await original<object>(), useReducedMotion: () => true }));
let container: HTMLDivElement, root: Root;
const send = vi.fn(), copy = vi.fn(), close = vi.fn();
function Preview({ phase = 'idle', empty = false }: { phase?: 'idle' | 'sending' | 'sent'; empty?: boolean }) {
  const [selected, setSelected] = useState(new Set<string>());
  return React.createElement(ShareDialogSurface, { phoneMode: false,
    header: { title: 'Kalaya', subtitle: 'Thai · $$$', cover: null, icon: null },
    targets: empty ? [] : [{ kind: 'friend', key: 'jen', friendId: 'jen', name: 'Jen Ellis', initials: 'JE', avatarColor: '' }], hasTargets: !empty,
    selected, onToggle: key => setSelected(prev => prev.size ? new Set() : new Set([key])),
    search: '', onSearch: vi.fn(), message: '', onMessage: vi.fn(), phase, onSend: send, onClose: close,
    actions: [{ key: 'copy', label: 'Copy link', icon: null, onClick: copy }, { key: 'more', label: 'Share…', icon: null, onClick: vi.fn() }],
  });
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  window.scrollTo = vi.fn();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  send.mockClear(); copy.mockClear(); close.mockClear(); occlude.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); expect(document.body.style.position).toBe(''); expect(isOverlayOpen()).toBe(false); });
const click = async (selector: string) => { await act(async () => container.querySelector<HTMLButtonElement>(selector)!.click()); };
it('reveals a composer only after selecting a recipient, with no hidden quick actions in the tab order', async () => {
  await act(async () => root.render(React.createElement(Preview)));
  expect(container.querySelector('.share-glass-compose')).toBeNull();
  await click('[aria-label="Jen Ellis"]');
  expect(container.querySelector('[aria-label="Jen Ellis"]')?.getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector('.share-glass-options')).toBeNull();
  expect(container.querySelector('[aria-label="Add a message"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Send message"]')).not.toBeNull();
  await click('.share-glass-send'); expect(send).toHaveBeenCalledOnce();
  await click('[aria-label="Jen Ellis"]'); expect(container.querySelector('.share-glass-compose')).toBeNull();
});
it('keeps external share actions available without friends and owns focus, chrome, and scrolling', async () => {
  await act(async () => root.render(React.createElement(Preview, { empty: true })));
  expect(document.activeElement).toBe(container.querySelector('[role="dialog"]'));
  expect(document.body.style.position).toBe('fixed'); expect(isOverlayOpen()).toBe(true);
  expect(occlude).toHaveBeenCalledWith(container.querySelector('.share-glass-layer'));
  await click('.share-glass-primary button'); expect(copy).toHaveBeenCalledOnce();
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(close).toHaveBeenCalledOnce(); expect(send).not.toHaveBeenCalled();
});
