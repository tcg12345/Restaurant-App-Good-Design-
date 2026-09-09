// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { SocialHub } from './SocialHub';
import { Circle } from './Circle';
import { RetainedRouteStack } from '../components/RetainedRouteStack';
import { routeInstanceKey } from '../lib/route-instance-key';
import { pushOverlay } from '../lib/overlay-registry';
const mock = vi.hoisted(() => ({ phone: true }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ pendingRequestCount: 2 }) }));
vi.mock('../contexts/ChatContext', () => ({ useChat: () => ({ unreadCount: 3 }) }));
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ phoneMode: mock.phone }) }));
vi.mock('../lib/glass-buttons', () => ({ useGlassSegments: () => ({ ref: () => {}, active: false }), GlassButton: ({ children, label, onClick, suspended }: any) => <button aria-label={label} onClick={onClick} data-suspended={suspended}>{children}</button> }));
vi.mock('../lib/usePageBack', () => ({ usePageBack: () => { const navigate = useNavigate(); return () => navigate(-1); } }));
vi.mock('./Messages', () => ({ Messages: ({ embedded }: any) => <div data-testid="messages" data-embedded={embedded}>Inbox and conversations</div> }));
vi.mock('../components/CirclePanel', () => ({ CirclePanel: ({ variant }: any) => { const navigate = useNavigate(); return <div data-testid="friends" data-variant={variant}>Friends and requests<button onClick={() => navigate('/messages', { state: { openUserId: 'friend-42' } })}>Message friend</button></div>; } }));
let host: HTMLDivElement, root: Root, historyBack: () => void;
function LocationProbe() { const navigate = useNavigate(); historyBack = () => navigate(-1); const location = useLocation(); return <output>{location.pathname}{location.search}{JSON.stringify(location.state)}</output>; }
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mock.phone = true; vi.stubGlobal('matchMedia', () => ({ matches: true, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function AppRouteLayer({ children }: { children: React.ReactElement }) {
  const location = useLocation();
  const key = routeInstanceKey(location.pathname, location.key, 1);
  return <RetainedRouteStack entryKey={key} index={1} pathname={location.pathname} pop={false} instant><div key={key}>{children}</div></RetainedRouteStack>;
}
async function mount(entry: any = '/messages') { await act(async () => root.render(<MemoryRouter initialEntries={['/home', entry]} initialIndex={1}><AppRouteLayer><Routes><Route path="/messages" element={<SocialHub />} /><Route path="/circle" element={<Circle />} /><Route path="/home" element={<div>Home</div>} /></Routes></AppRouteLayer><LocationProbe /></MemoryRouter>)); }
async function click(selector: string) { await act(async () => host.querySelector<HTMLButtonElement>(selector)!.click()); }
it('combines both sections with separate unread and pending-request badges', async () => {
  await mount(); expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2); expect(host.querySelector('[aria-label="3 unread messages"]')).not.toBeNull(); expect(host.querySelector('[aria-label="2 pending requests"]')).not.toBeNull(); expect(host.querySelector('[data-testid="messages"]')!.getAttribute('data-embedded')).toBe('true');
});
it('switches sections without adding back-navigation steps', async () => {
  await mount(); await click('[role="tab"]:last-child');
  expect(host.querySelector('output')!.textContent).toContain('/messages?tab=friends'); expect(host.querySelector('[data-testid="friends"]')!.getAttribute('data-variant')).toBe('embedded');
  expect(host.querySelector('[aria-label="Back"]')).toBeNull(); await act(async () => historyBack()); expect(host.querySelector('output')!.textContent).toContain('/home');
});
it('redirects existing circle links into the Friends tab', async () => {
  await mount('/circle'); expect(host.querySelector('output')!.textContent).toContain('/messages?tab=friends'); expect(host.querySelector('[data-testid="friends"]')).not.toBeNull();
});
it.each(['/messages?conversation=existing-123', '/messages?to=friend-123'])('preserves direct thread link %s without covering the phone conversation', async path => {
  await mount(path); expect(host.querySelector('[role="tablist"]')).toBeNull(); expect(host.querySelector('output')!.textContent).toContain(path); expect(host.querySelector('[data-testid="messages"]')).not.toBeNull();
});
it('opens a friend’s message in the same destination', async () => {
  await mount('/messages?tab=friends'); await click('[data-testid="friends"] button');
  expect(host.querySelector('output')!.textContent).toContain('"openUserId":"friend-42"'); expect(host.querySelector('[data-testid="messages"]')).not.toBeNull(); expect(host.querySelector('[role="tablist"]')).toBeNull();
});
it('keeps both sections reachable next to desktop conversations', async () => {
  mock.phone = false; await mount('/messages?conversation=existing-123'); expect(host.querySelector('[role="tablist"]')).not.toBeNull();
});
it('suspends the hub controls while a compose sheet or other overlay is open', async () => {
  await mount(); let release!: () => void; await act(async () => { release = pushOverlay(); });
  expect(host.querySelector<HTMLButtonElement>('[role="tab"]')!.disabled).toBe(true); expect(host.querySelector('[aria-label="Back"]')).toBeNull();
  await act(async () => release()); expect(host.querySelector<HTMLButtonElement>('[role="tab"]')!.disabled).toBe(false);
});
it('supports keyboard switching between the two tabs', async () => {
  await mount(); await act(async () => host.querySelector('[role="tab"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  expect(host.querySelector('[data-testid="friends"]')).not.toBeNull(); expect(host.querySelector('[role="tab"]:last-child')!.getAttribute('aria-selected')).toBe('true');
});

async function pointer(type: string, x: number) {
  const tabs = host.querySelector<HTMLElement>('[role="tablist"]')!;
  tabs.getBoundingClientRect = () => ({ width: 308 } as DOMRect);
  tabs.setPointerCapture = () => {};
  await act(async () => { const event = new Event(type, { bubbles: true }); Object.assign(event, { pointerId: 1, clientX: x, isPrimary: true, button: 0 }); tabs.dispatchEvent(event); });
}
it('slides between tabs on release, without mounting the destination while dragging', async () => {
  await mount(); await pointer('pointerdown', 50); await pointer('pointermove', 180);
  expect(host.querySelector('[data-testid="friends"]')).toBeNull();
  await pointer('pointerup', 180);
  expect(host.querySelector('[data-testid="friends"]')).not.toBeNull();
  await pointer('pointerdown', 180); await pointer('pointermove', 30); await pointer('pointerup', 30);
  expect(host.querySelector('[data-testid="messages"]')).not.toBeNull();
});
it('cancels a drag without changing tabs and ignores drags under overlays', async () => {
  await mount(); await pointer('pointerdown', 50); await pointer('pointermove', 180); await pointer('pointercancel', 180);
  expect(host.querySelector('[data-testid="friends"]')).toBeNull();
  let release!: () => void; await act(async () => { release = pushOverlay(); });
  await pointer('pointerdown', 50); await pointer('pointermove', 180); await pointer('pointerup', 180);
  expect(host.querySelector('[data-testid="friends"]')).toBeNull();
  await act(async () => release());
});
it('suppresses the click generated after dragging across the tabs', async () => {
  await mount(); await pointer('pointerdown', 50); await pointer('pointermove', 180); await pointer('pointerup', 180);
  await click('[role="tab"]:nth-of-type(1)');
  expect(host.querySelector('[data-testid="friends"]')).not.toBeNull();
});

it('keeps the same page and glass tab control alive through repeated router replacements', async () => {
  await mount();
  const page = host.querySelector('.social-hub');
  const tabs = host.querySelector('[role="tablist"]');
  for (let i = 0; i < 4; i++) {
    await click(i % 2 === 0 ? '[role="tab"]:last-child' : '[role="tab"]:nth-of-type(1)');
    expect(host.querySelector('.social-hub')).toBe(page);
    expect(host.querySelector('[role="tablist"]')).toBe(tabs);
  }
});
