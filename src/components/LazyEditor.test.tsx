// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lazyEditor } from './LazyEditor';

vi.mock('../lib/useBottomSheet', () => ({ acquireHardScrollLock: () => vi.fn() }));
vi.mock('../lib/overlay-registry', () => ({ pushOverlay: () => vi.fn() }));
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  HTMLDialogElement.prototype.showModal = vi.fn(function () { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function () { this.open = false; });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const deferred = () => {
  let resolve!: (module: { default: React.ComponentType<any> }) => void;
  const load = vi.fn(() => new Promise<{ default: React.ComponentType<any> }>(r => { resolve = r; }));
  return { load, resolve: (Component: React.ComponentType<any>) => resolve({ default: Component }) };
};
it('does not import or mount a closed editor; shows a cancellable skeleton on first intent', async () => {
  const job = deferred(), Editor = lazyEditor(job.load), close = vi.fn();
  await act(async () => root.render(<Editor active={false} dismiss={close} label="Post" componentProps={{}} />));
  expect(job.load).not.toHaveBeenCalled(); expect(document.querySelector('dialog')).toBeNull();
  await act(async () => root.render(<Editor active dismiss={close} label="Post" componentProps={{}} />));
  expect(document.querySelector('[aria-label="Loading editor"]')).not.toBeNull();
  expect(document.querySelector('[class*=animate-spin]')).toBeNull();
  expect(document.querySelectorAll('[class*=motion-safe\\:animate-pulse]')).toHaveLength(4);
  await act(async () => (document.querySelector('[aria-label="Close editor"]') as HTMLButtonElement).click());
  expect(close).toHaveBeenCalledOnce();
});
it('ignores late completion after dismissal, then opens with the latest draft props', async () => {
  const job = deferred(), Editor = lazyEditor(job.load), mount = vi.fn();
  const render = (active: boolean, draft: string) => root.render(<Editor active={active} dismiss={() => {}} label="Post" componentProps={{ draft }} />);
  await act(async () => render(true, 'Old draft'));
  await act(async () => render(false, ''));
  await act(async () => job.resolve(({ draft }) => { mount(); return <p>{draft}</p>; }));
  expect(mount).not.toHaveBeenCalled(); expect(document.querySelector('dialog')).toBeNull();
  await act(async () => render(true, 'New draft'));
  expect(host.textContent).toBe('New draft'); expect(job.load).toHaveBeenCalledOnce();
});
it('retains the same editor instance through closing and reopening', async () => {
  const job = deferred(), Editor = lazyEditor(job.load), unmount = vi.fn();
  const Form = ({ open }: { open: boolean }) => {
    const [value, setValue] = React.useState(0);
    React.useEffect(() => unmount, []);
    return <button data-open={open} onClick={() => setValue(v => v + 1)}>{value}</button>;
  };
  const render = (active: boolean) => root.render(<Editor active={active} dismiss={() => {}} label="Post" componentProps={{ open: active }} />);
  await act(async () => render(true)); await act(async () => job.resolve(Form));
  const button = host.querySelector('button')!;
  await act(async () => button.click()); await act(async () => render(false));
  expect(button.dataset.open).toBe('false'); expect(unmount).not.toHaveBeenCalled();
  await act(async () => render(true));
  expect(host.querySelector('button')).toBe(button); expect(button.textContent).toBe('1');
});
it('shares preload work and renders a warmed editor without a skeleton flash', async () => {
  const load = vi.fn().mockResolvedValue({ default: () => <p>Ready</p> }), Editor = lazyEditor(load);
  await Promise.all([Editor.preload(), Editor.preload()]);
  await act(async () => root.render(<Editor active dismiss={() => {}} label="Post" componentProps={{}} />));
  expect(host.textContent).toBe('Ready'); expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled(); expect(load).toHaveBeenCalledOnce();
});
it('offers retry when offline and recovers without replacing the page underneath', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ default: () => <p>Recovered</p> }), Editor = lazyEditor(load);
  await act(async () => root.render(<><nav>Home</nav><Editor active dismiss={() => {}} label="Post" componentProps={{}} /></>));
  const nav = host.querySelector('nav');
  expect(document.querySelector('[role=alert]')?.textContent).toContain("Couldn't open this editor");
  const retry = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Try again')!;
  await act(async () => retry.click());
  expect(host.textContent).toContain('Recovered'); expect(host.querySelector('nav')).toBe(nav); expect(load).toHaveBeenCalledTimes(2);
});
it('a failed speculative preload does not poison a later opening', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ default: () => <p>Ready</p> }), Editor = lazyEditor(load);
  await expect(Editor.preload()).rejects.toThrow('Offline');
  await act(async () => root.render(<Editor active dismiss={() => {}} label="Post" componentProps={{}} />));
  expect(host.textContent).toBe('Ready'); expect(load).toHaveBeenCalledTimes(2);
});
it('reopening after a dismissed failure retries automatically and Escape dismisses the placeholder', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockImplementation(() => new Promise(() => {})), Editor = lazyEditor(load), close = vi.fn();
  const render = (active: boolean) => root.render(<Editor active={active} dismiss={close} label="Post" componentProps={{}} />);
  await act(async () => render(true)); await act(async () => render(false)); await act(async () => render(true));
  expect(load).toHaveBeenCalledTimes(2); expect(document.querySelector('[role=alert]')).toBeNull();
  const event = new Event('cancel', { cancelable: true });
  await act(async () => document.querySelector('dialog')!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true); expect(close).toHaveBeenCalledOnce();
});
